import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DowntimeCause,
  EventStatus,
  ReasonCodeList,
  TriageDestination,
  VehicleStatus,
  WorkOrderType,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import {
  FIELD_OUTCOMES_RETURNING_TO_LINE,
  FieldOutcome,
  FieldStep,
  paginate,
  type CreateEventInput,
  type DispatchFieldServiceInput,
  type EventQuery,
  type FailureEventSummary,
  type FieldOutcomeInput,
  type FieldStepInput,
  type Paginated,
  type TriageInput,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { DowntimeService } from '../common/downtime.service';
import { QueueService } from '../queue/queue.service';
import { nextSequentialCode } from '../common/sequence';

/**
 * E1 — eventos corretivos (RF-01 a RF-06).
 *
 * O evento é o começo do ciclo que o PRD chama de núcleo do MKBF. Duas regras
 * atravessam tudo aqui:
 *
 * - RF-05: falha marcada como de segurança no catálogo não volta para a linha
 *   nem pode ser deferida. É bloqueio, não aviso.
 * - RF-06: falha marcada como fast-track abre OS e registro de priorização
 *   sozinha, sem passar pela decisão manual de fila.
 */
@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly downtime: DowntimeService,
  ) {}

  /** RF-01 — hora automática, falha do catálogo e local. */
  async create(input: CreateEventInput, actorId: string): Promise<FailureEventSummary> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: input.vehicleId } });
    if (!vehicle) throw new NotFoundException('Carro não encontrado');
    if (!vehicle.isActive) throw new BadRequestException('Carro inativo não aceita evento');

    if (input.catalogItemId) await this.requireCatalogItem(input.catalogItemId);

    const event = await this.prisma.$transaction(async (tx) => {
      const created = await tx.failureEvent.create({
        data: {
          code: await nextSequentialCode(tx, 'failureEvent', 'EV'),
          vehicleId: input.vehicleId,
          catalogItemId: input.catalogItemId,
          reportedDescription: input.reportedDescription,
          origin: input.origin,
          operatorId: input.operatorId,
          lineCode: input.lineCode,
          locationDescription: input.locationDescription,
          latitude: input.latitude,
          longitude: input.longitude,
          reportedById: actorId,
          // Todo evento corretivo é um retorno não programado até que a triagem
          // decida o contrário — é este campo que forma o denominador do MKBF.
          isUnscheduledReturn: true,
        },
      });

      await tx.vehicle.update({
        where: { id: input.vehicleId },
        data: { status: VehicleStatus.AWAITING_TRIAGE },
      });

      return created;
    });

    await this.audit.write({
      actorId,
      action: 'event.create',
      entity: 'FailureEvent',
      entityId: event.id,
      after: { code: event.code, vehicleId: input.vehicleId, catalogItemId: input.catalogItemId },
    });

    return this.findOne(event.id);
  }

  /**
   * RF-03 — triagem com três destinos e SLA medido entre registro e decisão.
   * O fast-track do catálogo é resolvido aqui: se a falha tem a flag e o
   * destino é recolher, a OS e a priorização nascem sem intervenção.
   */
  async triage(eventId: string, input: TriageInput, actorId: string): Promise<FailureEventSummary> {
    const event = await this.prisma.failureEvent.findUnique({
      where: { id: eventId },
      include: { catalogItem: true, triage: true, vehicle: true },
    });
    if (!event) throw new NotFoundException('Evento não encontrado');
    if (event.triage) throw new BadRequestException('Este evento já passou pela triagem');
    if (event.status === EventStatus.CANCELLED || event.status === EventStatus.CLOSED) {
      throw new BadRequestException('Evento encerrado não pode ser triado');
    }

    // A triagem pode reclassificar a falha que o CCO registrou às pressas.
    const catalogItem = input.catalogItemId
      ? await this.requireCatalogItem(input.catalogItemId)
      : event.catalogItem;

    // RF-05 — o bloqueio de segurança vale nos dois destinos que deixam o carro
    // rodando: deferir para a parada programada e resolver em campo.
    if (catalogItem?.isSafety && input.destination === TriageDestination.DEFER) {
      throw new BadRequestException(
        `Falha de segurança (${catalogItem.code}) não pode ser deferida para a parada programada`,
      );
    }

    if (input.destination === TriageDestination.DEFER) {
      if (catalogItem && !catalogItem.isDeferrable) {
        throw new BadRequestException(
          `A falha ${catalogItem.code} não é deferível segundo o catálogo`,
        );
      }
      await this.requireReasonCode(input.reasonCodeId, ReasonCodeList.EVENT_DEFERRAL);
    }

    const now = new Date();
    const slaSeconds = Math.round((now.getTime() - event.reportedAt.getTime()) / 1000);

    await this.prisma.$transaction(async (tx) => {
      await tx.triage.create({
        data: {
          eventId,
          destination: input.destination,
          reasonCodeId: input.reasonCodeId,
          decidedById: actorId,
          decidedAt: now,
          slaSeconds,
          note: input.note,
        },
      });

      if (input.catalogItemId) {
        await tx.failureEvent.update({
          where: { id: eventId },
          data: { catalogItemId: input.catalogItemId },
        });
      }

      switch (input.destination) {
        case TriageDestination.FIELD:
          await tx.failureEvent.update({
            where: { id: eventId },
            data: { status: EventStatus.FIELD_SERVICE },
          });
          await tx.fieldService.create({ data: { eventId } });
          await tx.vehicle.update({
            where: { id: event.vehicleId },
            data: { status: VehicleStatus.FIELD_SERVICE },
          });
          break;

        case TriageDestination.RECALL:
          await this.recallToGarage(tx, {
            eventId,
            vehicleId: event.vehicleId,
            isSafety: catalogItem?.isSafety ?? false,
            isFastTrack: catalogItem?.isFastTrack ?? false,
            estimatedRepairMinutes: catalogItem?.estimatedRepairMinutes ?? null,
            actorId,
          });
          break;

        case TriageDestination.DEFER: {
          await tx.failureEvent.update({
            where: { id: eventId },
            data: { status: EventStatus.DEFERRED, isUnscheduledReturn: false, closedAt: now },
          });
          // O deferimento não some: vira backlog e volta como escopo da próxima
          // parada preventiva (RF-11).
          await tx.vehicleBacklogItem.create({
            data: {
              vehicleId: event.vehicleId,
              description:
                catalogItem?.description ??
                event.reportedDescription ??
                'Falha deferida na triagem',
              source: 'DEFERRED_EVENT',
              catalogItemId: catalogItem?.id,
            },
          });
          await tx.vehicle.update({
            where: { id: event.vehicleId },
            data: { status: VehicleStatus.IN_LINE },
          });
          break;
        }
      }
    });

    await this.audit.write({
      actorId,
      action: 'event.triage',
      entity: 'FailureEvent',
      entityId: eventId,
      after: { destination: input.destination, slaSeconds },
      reason: input.note,
    });

    return this.findOne(eventId);
  }

  /**
   * Recolhimento: abre a OS-mãe, inicia o relógio e põe o carro na fila.
   * Compartilhado entre a triagem e o desfecho do socorro que reboca.
   */
  private async recallToGarage(
    tx: Prisma.TransactionClient,
    input: {
      eventId: string;
      vehicleId: string;
      isSafety: boolean;
      isFastTrack: boolean;
      estimatedRepairMinutes: number | null;
      actorId: string;
    },
  ): Promise<void> {
    const now = new Date();
    const minutes = input.estimatedRepairMinutes ?? 180;

    const workOrder = await tx.workOrder.create({
      data: {
        code: await nextSequentialCode(tx, 'workOrder', 'OS'),
        vehicleId: input.vehicleId,
        type: WorkOrderType.CORRECTIVE,
        eventId: input.eventId,
        openedAt: now,
        // RN-03 — previsão obrigatória; o catálogo dá o ponto de partida.
        estimatedCompletionAt: new Date(now.getTime() + minutes * 60_000),
        createdById: input.actorId,
      },
    });

    // RN-02 — o relógio começa aqui e só para na liberação.
    await this.downtime.start(tx, workOrder.id, DowntimeCause.QUEUE, now);

    await this.queue.enqueue(tx, {
      vehicleId: input.vehicleId,
      eventId: input.eventId,
      workOrderId: workOrder.id,
      criticality: this.queue.criticalityFor({
        isSafety: input.isSafety,
        isFastTrack: input.isFastTrack,
      }),
      isFastTrack: input.isFastTrack,
      estimatedRepairMinutes: input.estimatedRepairMinutes,
    });

    await tx.failureEvent.update({
      where: { id: input.eventId },
      data: { status: EventStatus.IN_MAINTENANCE },
    });

    await tx.vehicle.update({
      where: { id: input.vehicleId },
      data: { status: VehicleStatus.AWAITING_MAINTENANCE },
    });
  }

  // --- Socorro em campo (RF-04) ---------------------------------------------

  async dispatch(
    eventId: string,
    input: DispatchFieldServiceInput,
    actorId: string,
  ): Promise<FailureEventSummary> {
    const field = await this.prisma.fieldService.findUnique({ where: { eventId } });
    if (!field) throw new NotFoundException('Socorro não encontrado para este evento');

    await this.prisma.fieldService.update({
      where: { eventId },
      data: {
        technicianId: input.technicianId ?? actorId,
        supportVehicleCode: input.supportVehicleCode,
      },
    });

    return this.findOne(eventId);
  }

  /** Apontamento por toque: cada passo é um botão, sem formulário. */
  async fieldStep(
    eventId: string,
    input: FieldStepInput,
    actorId: string,
  ): Promise<FailureEventSummary> {
    const field = await this.prisma.fieldService.findUnique({ where: { eventId } });
    if (!field) throw new NotFoundException('Socorro não encontrado para este evento');
    if (field.outcome) throw new BadRequestException('Este socorro já foi encerrado');

    const now = new Date();
    const data =
      input.step === FieldStep.ARRIVED
        ? { arrivedAt: now }
        : input.step === FieldStep.STARTED
          ? { startedAt: now }
          : { finishedAt: now };

    await this.prisma.fieldService.update({ where: { eventId }, data });

    await this.audit.write({
      actorId,
      action: `field.${input.step.toLowerCase()}`,
      entity: 'FieldService',
      entityId: field.id,
    });

    return this.findOne(eventId);
  }

  /** Desfecho em um botão. É aqui que a taxa de campo do catálogo se realimenta. */
  async fieldOutcome(
    eventId: string,
    input: FieldOutcomeInput,
    actorId: string,
  ): Promise<FailureEventSummary> {
    const event = await this.prisma.failureEvent.findUnique({
      where: { id: eventId },
      include: { fieldService: true, catalogItem: true },
    });
    if (!event?.fieldService) throw new NotFoundException('Socorro não encontrado');
    if (event.fieldService.outcome) throw new BadRequestException('Este socorro já foi encerrado');

    const confirmed = input.confirmedCatalogItemId
      ? await this.requireCatalogItem(input.confirmedCatalogItemId)
      : event.catalogItem;

    // RF-05 — a constatação em campo pode revelar falha de segurança que o
    // registro inicial não capturou. Nesse caso o carro não volta para a linha,
    // independentemente do que o socorrista escolheu.
    const wantsToReturn = FIELD_OUTCOMES_RETURNING_TO_LINE.includes(input.outcome as FieldOutcome);
    if (wantsToReturn && confirmed?.isSafety) {
      throw new BadRequestException(
        `Falha de segurança constatada (${confirmed.code}): o carro não pode retornar à linha. ` +
          `Use o desfecho de reboque ou retorno à garagem.`,
      );
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.fieldService.update({
        where: { eventId },
        data: {
          outcome: input.outcome,
          confirmedCatalogItemId: input.confirmedCatalogItemId,
          note: input.note,
          finishedAt: event.fieldService?.finishedAt ?? now,
        },
      });

      if (input.materials.length) {
        // RF-27 — material embarcado do veículo de apoio dá baixa por consumo.
        await tx.fieldServiceMaterial.createMany({
          data: input.materials.map((m) => ({
            fieldServiceId: event.fieldService!.id,
            materialId: m.materialId,
            quantity: m.quantity,
            serialNumber: m.serialNumber,
          })),
        });
      }

      if (wantsToReturn) {
        await tx.failureEvent.update({
          where: { id: eventId },
          data: { status: EventStatus.CLOSED, closedAt: now },
        });
        await tx.vehicle.update({
          where: { id: event.vehicleId },
          data: { status: VehicleStatus.IN_LINE },
        });
      } else if (input.outcome === FieldOutcome.CANCELLED) {
        await tx.failureEvent.update({
          where: { id: eventId },
          data: { status: EventStatus.CANCELLED, isUnscheduledReturn: false, closedAt: now },
        });
        await tx.vehicle.update({
          where: { id: event.vehicleId },
          data: { status: VehicleStatus.IN_LINE },
        });
      } else {
        // Rebocado ou voltou por meios próprios: segue para a garagem.
        await this.recallToGarage(tx, {
          eventId,
          vehicleId: event.vehicleId,
          isSafety: confirmed?.isSafety ?? false,
          isFastTrack: confirmed?.isFastTrack ?? false,
          estimatedRepairMinutes: confirmed?.estimatedRepairMinutes ?? null,
          actorId,
        });
      }

      // RF-32 — realimentação do catálogo pelas constatações. A taxa de campo
      // deixa de ser estimativa de alguém e passa a ser o que de fato aconteceu.
      if (confirmed) {
        const samples = confirmed.fieldResolutionSamples + 1;
        const resolved =
          Number(confirmed.fieldResolutionRate ?? 0) * confirmed.fieldResolutionSamples +
          (input.outcome === FieldOutcome.RESOLVED_IN_FIELD ? 1 : 0);

        await tx.failureCatalogItem.update({
          where: { id: confirmed.id },
          data: {
            fieldResolutionSamples: samples,
            fieldResolutionRate: Number((resolved / samples).toFixed(4)),
          },
        });
      }
    });

    await this.audit.write({
      actorId,
      action: 'field.outcome',
      entity: 'FieldService',
      entityId: event.fieldService.id,
      after: { outcome: input.outcome, confirmedCatalogItemId: input.confirmedCatalogItemId },
    });

    return this.findOne(eventId);
  }

  // --- Consultas ------------------------------------------------------------

  async findOne(id: string): Promise<FailureEventSummary> {
    const event = await this.prisma.failureEvent.findUnique({
      where: { id },
      include: {
        vehicle: { select: { code: true, plate: true } },
        catalogItem: true,
        triage: true,
        fieldService: true,
        workOrder: { select: { id: true, code: true } },
      },
    });
    if (!event) throw new NotFoundException('Evento não encontrado');
    return toSummary(event);
  }

  async list(query: EventQuery): Promise<Paginated<FailureEventSummary>> {
    const where: Prisma.FailureEventWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      // Fila de triagem: registrados que ainda não têm decisão.
      ...(query.pendingTriage ? { triage: null, status: EventStatus.REGISTERED } : {}),
      ...(query.from || query.to
        ? {
            reportedAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.failureEvent.findMany({
        where,
        // Na fila de triagem o mais antigo vem primeiro: o SLA corre contra ele.
        orderBy: { reportedAt: query.pendingTriage ? 'asc' : 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
        include: {
          vehicle: { select: { code: true, plate: true } },
          catalogItem: true,
          triage: true,
          fieldService: true,
          workOrder: { select: { id: true, code: true } },
        },
      }),
      this.prisma.failureEvent.count({ where }),
    ]);

    return paginate(rows.map(toSummary), total, { page: query.page, perPage: query.perPage });
  }

  private async requireCatalogItem(id: string) {
    const item = await this.prisma.failureCatalogItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Falha não encontrada no catálogo');
    if (!item.isActive) throw new BadRequestException('Esta falha está desativada no catálogo');
    return item;
  }

  private async requireReasonCode(id: string | undefined, list: ReasonCodeList) {
    if (!id) throw new BadRequestException('Código de motivo obrigatório');
    const reason = await this.prisma.reasonCode.findUnique({ where: { id } });
    if (!reason || reason.list !== list) {
      throw new BadRequestException('Código de motivo inválido para esta operação');
    }
    if (!reason.isActive) throw new BadRequestException('Este código de motivo está desativado');
    return reason;
  }
}

type EventWithRelations = Prisma.FailureEventGetPayload<{
  include: {
    vehicle: { select: { code: true; plate: true } };
    catalogItem: true;
    triage: true;
    fieldService: true;
    workOrder: { select: { id: true; code: true } };
  };
}>;

function toSummary(event: EventWithRelations): FailureEventSummary {
  return {
    id: event.id,
    code: event.code,
    vehicleId: event.vehicleId,
    vehicleCode: event.vehicle.code,
    vehiclePlate: event.vehicle.plate,
    catalogItemId: event.catalogItemId,
    catalog: event.catalogItem
      ? {
          code: event.catalogItem.code,
          description: event.catalogItem.description,
          probableCause: event.catalogItem.probableCause,
          estimatedRepairMinutes: event.catalogItem.estimatedRepairMinutes,
          fieldResolutionRate: event.catalogItem.fieldResolutionRate
            ? Number(event.catalogItem.fieldResolutionRate)
            : null,
          fieldResolutionSamples: event.catalogItem.fieldResolutionSamples,
          isFastTrack: event.catalogItem.isFastTrack,
          isSafety: event.catalogItem.isSafety,
          isDeferrable: event.catalogItem.isDeferrable,
        }
      : null,
    reportedDescription: event.reportedDescription,
    origin: event.origin,
    status: event.status,
    reportedAt: event.reportedAt.toISOString(),
    lineCode: event.lineCode,
    locationDescription: event.locationDescription,
    isUnscheduledReturn: event.isUnscheduledReturn,
    closedAt: event.closedAt?.toISOString() ?? null,
    waitingSeconds: Math.round((Date.now() - event.reportedAt.getTime()) / 1000),
    triage: event.triage
      ? {
          destination: event.triage.destination,
          decidedAt: event.triage.decidedAt.toISOString(),
          slaSeconds: event.triage.slaSeconds,
          note: event.triage.note,
        }
      : null,
    fieldService: event.fieldService
      ? {
          id: event.fieldService.id,
          dispatchedAt: event.fieldService.dispatchedAt.toISOString(),
          arrivedAt: event.fieldService.arrivedAt?.toISOString() ?? null,
          startedAt: event.fieldService.startedAt?.toISOString() ?? null,
          finishedAt: event.fieldService.finishedAt?.toISOString() ?? null,
          outcome: event.fieldService.outcome,
          supportVehicleCode: event.fieldService.supportVehicleCode,
        }
      : null,
    workOrderId: event.workOrder?.id ?? null,
    workOrderCode: event.workOrder?.code ?? null,
  };
}
