import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DowntimeCause,
  EventStatus,
  ReasonCodeList,
  TriageDestination,
  VehicleStatus,
  WorkOrderType,
  FieldServiceKind,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import {
  DEFAULT_FIELD_REPAIR_MINUTES,
  EVENT_BACKDATE_MAX_DAYS,
  type FieldEstimateInput,
  FAST_TRACK_ENABLED,
  FIELD_OUTCOMES_RETURNING_TO_LINE,
  FieldOutcome,
  FieldStep,
  composeFailureCode,
  describeFailureCode,
  paginate,
  resolveFailureFlags,
  type FailureCodeRule,
  type ResolvedFlags,
  type CreateEventInput,
  type DispatchFieldServiceInput,
  type EventQuery,
  type EventsSummary,
  type FailureEventSummary,
  type FieldOutcomeInput,
  type FieldStepInput,
  type Paginated,
  type TriageInput,
  PAM_LIMIT_MINUTES,
} from '@app/shared';
import { Cron } from '@nestjs/schedule';
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

    const catalogItem = input.catalogItemId
      ? await this.requireCatalogItem(input.catalogItemId)
      : null;
    // O atalho do catálogo pré-preenche o código; o que vier explícito vence.
    const fields = {
      failureModeCode: input.failureModeCode ?? catalogItem?.failureModeCode ?? null,
      subsystemCode: input.subsystemCode ?? catalogItem?.subsystemCode ?? null,
      position: input.position ?? null,
    };
    const flags = await this.flagsFor(fields, catalogItem);

    // Item 13: a data vem preenchida com o agora e pode ser ajustada, mas nunca para o futuro.
    const now = Date.now();
    const reportedAt = input.reportedAt ?? new Date(now);
    if (reportedAt.getTime() > now + 5 * 60_000) {
      throw new BadRequestException('A data e hora do evento não pode estar no futuro');
    }
    if (reportedAt.getTime() < now - EVENT_BACKDATE_MAX_DAYS * 86_400_000) {
      throw new BadRequestException(`A data do evento pode voltar no máximo ${EVENT_BACKDATE_MAX_DAYS} dias`);
    }
    // Item 12: o RE digitado; sem ele, a matrícula do cadastro de quem registra.
    const reporterRegistration =
      input.reporterRegistration ??
      (await this.prisma.user.findUnique({ where: { id: actorId }, select: { registration: true } }))?.registration ??
      null;

    const event = await this.prisma.$transaction(async (tx) => {
      const created = await tx.failureEvent.create({
        data: {
          code: await nextSequentialCode(tx, 'failureEvent', 'EV'),
          vehicleId: input.vehicleId,
          catalogItemId: input.catalogItemId,
          ...fields,
          failureCode:
            fields.failureModeCode && fields.subsystemCode
              ? composeFailureCode(fields.failureModeCode, fields.subsystemCode, fields.position)
              : null,
          isSafety: flags.isSafety,
          isFastTrack: flags.isFastTrack,
          reportedAt,
          reporterRegistration,
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
      after: {
        code: event.code,
        vehicleId: input.vehicleId,
        catalogItemId: input.catalogItemId,
        failureCode: event.failureCode,
        flags,
      },
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

    // A triagem pode reclassificar a falha que o CCO registrou às pressas —
    // pelo atalho do catálogo ou pelo código composto.
    const catalogItem = input.catalogItemId
      ? await this.requireCatalogItem(input.catalogItemId)
      : event.catalogItem;
    const fields = {
      failureModeCode:
        input.failureModeCode ??
        (input.catalogItemId ? catalogItem?.failureModeCode : event.failureModeCode) ??
        null,
      subsystemCode:
        input.subsystemCode ??
        (input.catalogItemId ? catalogItem?.subsystemCode : event.subsystemCode) ??
        null,
      position: input.position ?? event.position ?? null,
    };
    const flags = await this.flagsFor(fields, catalogItem);
    const failureCode =
      fields.failureModeCode && fields.subsystemCode
        ? composeFailureCode(fields.failureModeCode, fields.subsystemCode, fields.position)
        : null;
    const failureName = failureCode ?? catalogItem?.code ?? 'esta falha';

    // RF-05 — o bloqueio de segurança vale nos dois destinos que deixam o carro
    // rodando: deferir para a parada programada e resolver em campo.
    if (flags.isSafety && input.destination === TriageDestination.DEFER) {
      throw new BadRequestException(
        `Falha de segurança (${failureName}) não pode ser deferida para a parada programada`,
      );
    }

    if (input.destination === TriageDestination.DEFER) {
      if (!flags.isDeferrable) {
        throw new BadRequestException(
          `A falha ${failureName} não é deferível segundo as regras do catálogo`,
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

      await tx.failureEvent.update({
        where: { id: eventId },
        data: {
          ...(input.catalogItemId ? { catalogItemId: input.catalogItemId } : {}),
          ...fields,
          failureCode,
          isSafety: flags.isSafety,
          isFastTrack: flags.isFastTrack,
        },
      });

      switch (input.destination) {
        case TriageDestination.FIELD:
          await tx.failureEvent.update({
            where: { id: eventId },
            data: { status: EventStatus.FIELD_SERVICE },
          });
          // Item 17: o atendimento na rua começa como PAM, salvo quando o PCM já manda Socorro.
          await tx.fieldService.create({ data: { eventId, kind: input.fieldKind ?? FieldServiceKind.PAM } });
          await tx.vehicle.update({
            where: { id: event.vehicleId },
            data: { status: VehicleStatus.FIELD_SERVICE },
          });
          break;

        case TriageDestination.RECALL:
          await this.recallToGarage(tx, {
            eventId,
            vehicleId: event.vehicleId,
            isSafety: flags.isSafety,
            isFastTrack: flags.isFastTrack,
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
                describeFailureCode(
                  fields.failureModeCode,
                  fields.subsystemCode,
                  fields.position,
                ) ??
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
      after: { destination: input.destination, slaSeconds, failureCode, flags },
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

  /**
   * Item 16: o técnico confirma ou ajusta o tempo estimado do reparo na rua. A
   * previsão de término conta a partir do início do reparo (ou de agora, se o
   * reparo ainda não começou).
   */
  async fieldEstimate(eventId: string, input: FieldEstimateInput, actorId: string): Promise<FailureEventSummary> {
    const field = await this.prisma.fieldService.findUnique({ where: { eventId } });
    if (!field) throw new NotFoundException('Atendimento na rua não encontrado para este evento');
    if (field.outcome || field.finishedAt) throw new BadRequestException('Este atendimento já terminou');
    await this.prisma.fieldService.update({
      where: { eventId },
      data: { estimatedRepairMinutes: input.minutes, estimateSetAt: new Date() },
    });
    await this.audit.write({
      actorId,
      action: 'field.estimate',
      entity: 'FieldService',
      entityId: field.id,
      before: { estimatedRepairMinutes: field.estimatedRepairMinutes },
      after: { estimatedRepairMinutes: input.minutes },
    });
    return this.findOne(eventId);
  }

  private repairMediansCache: { at: number; map: Map<string, number> } | null = null;

  /**
   * Mediana real do reparo na rua (início → fim) por subsistema, com no mínimo
   * cinco atendimentos. Guardada por 10 minutos: muda devagar.
   */
  private async fieldRepairMedians(): Promise<Map<string, number>> {
    if (this.repairMediansCache && Date.now() - this.repairMediansCache.at < 600_000) return this.repairMediansCache.map;
    const rows = await this.prisma.$queryRaw<{ subsystem: string; minutes: number }[]>`
      select coalesce(fs."confirmedSubsystemCode", e."subsystemCode") as subsystem,
             percentile_cont(0.5) within group (order by extract(epoch from fs."finishedAt" - fs."startedAt") / 60)::float as minutes
        from field_services fs
        join failure_events e on e.id = fs."eventId"
       where fs."startedAt" is not null and fs."finishedAt" > fs."startedAt"
         and fs."finishedAt" - fs."startedAt" < interval '12 hours'
         and coalesce(fs."confirmedSubsystemCode", e."subsystemCode") is not null
       group by 1
      having count(*) >= 5`;
    const map = new Map(rows.map((r) => [r.subsystem, Math.max(5, Math.round(Number(r.minutes) / 5) * 5)]));
    this.repairMediansCache = { at: Date.now(), map };
    return map;
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
    // Constatação no código composto: explícita, ou herdada do atalho/registro.
    const confirmedFields = {
      confirmedFailureModeCode:
        input.confirmedFailureModeCode ??
        (input.confirmedCatalogItemId ? confirmed?.failureModeCode : event.failureModeCode) ??
        null,
      confirmedSubsystemCode:
        input.confirmedSubsystemCode ??
        (input.confirmedCatalogItemId ? confirmed?.subsystemCode : event.subsystemCode) ??
        null,
      confirmedPosition: input.confirmedPosition ?? event.position ?? null,
    };
    const confirmedFailureCode =
      confirmedFields.confirmedFailureModeCode && confirmedFields.confirmedSubsystemCode
        ? composeFailureCode(
            confirmedFields.confirmedFailureModeCode,
            confirmedFields.confirmedSubsystemCode,
            confirmedFields.confirmedPosition,
          )
        : null;
    const flags = await this.flagsFor(
      {
        failureModeCode: confirmedFields.confirmedFailureModeCode,
        subsystemCode: confirmedFields.confirmedSubsystemCode,
      },
      confirmed,
    );

    // RF-05 — a constatação em campo pode revelar falha de segurança que o
    // registro inicial não capturou. Nesse caso o carro não volta para a linha,
    // independentemente do que o socorrista escolheu.
    const wantsToReturn = FIELD_OUTCOMES_RETURNING_TO_LINE.includes(input.outcome as FieldOutcome);
    if (wantsToReturn && flags.isSafety) {
      throw new BadRequestException(
        `Falha de segurança constatada (${confirmedFailureCode ?? confirmed?.code ?? 'código'}): o carro não pode retornar à linha. ` +
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
          ...confirmedFields,
          confirmedFailureCode,
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
        await tx.failureEvent.update({
          where: { id: eventId },
          data: { isSafety: flags.isSafety, isFastTrack: flags.isFastTrack },
        });
        await this.recallToGarage(tx, {
          eventId,
          vehicleId: event.vehicleId,
          isSafety: flags.isSafety,
          isFastTrack: flags.isFastTrack,
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
      after: {
        outcome: input.outcome,
        confirmedCatalogItemId: input.confirmedCatalogItemId,
        confirmedFailureCode,
      },
    });

    return this.findOne(eventId);
  }

  // --- Consultas ------------------------------------------------------------

  /**
   * Item 17 — PAM que passou de PAM_LIMIT_MINUTES vira Socorro, a cada minuto. Conta
   * do despacho do atendimento; atendimento já encerrado ou com desfecho não muda.
   */
  @Cron('* * * * *', { name: 'pam-to-socorro' })
  async reclassifyStalePam(now = new Date()): Promise<number> {
    const limit = new Date(now.getTime() - PAM_LIMIT_MINUTES * 60_000);
    const r = await this.prisma.fieldService.updateMany({
      where: { kind: FieldServiceKind.PAM, outcome: null, finishedAt: null, dispatchedAt: { lte: limit } },
      data: { kind: FieldServiceKind.SOCORRO, reclassifiedAt: now },
    });
    return r.count;
  }

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
    return toSummary(event, await this.rules(), event.fieldService ? await this.fieldRepairMedians() : undefined);
  }

  async list(query: EventQuery): Promise<Paginated<FailureEventSummary>> {
    const contains = (value: string): Prisma.StringFilter => ({
      contains: value,
      mode: 'insensitive',
    });
    const and: Prisma.FailureEventWhereInput[] = [];
    if (query.vehicle)
      and.push({
        vehicle: { OR: [{ code: contains(query.vehicle) }, { plate: contains(query.vehicle) }] },
      });
    if (query.failure) {
      and.push({
        OR: [
          { catalogItem: { description: contains(query.failure) } },
          { reportedDescription: contains(query.failure) },
          { ccoDefect: contains(query.failure) },
        ],
      });
    }
    const where: Prisma.FailureEventWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.origin ? { origin: query.origin } : {}),
      ...(query.code ? { code: contains(query.code) } : {}),
      ...(query.failureCode ? { failureCode: contains(query.failureCode) } : {}),
      ...(query.workOrder === 'with' ? { workOrder: { isNot: null } } : {}),
      ...(query.workOrder === 'without' ? { workOrder: null } : {}),
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
      ...(and.length ? { AND: and } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.failureEvent.findMany({
        where,
        // Na fila de triagem o mais antigo vem primeiro: o SLA corre contra ele. Com `sort`, a coluna pedida.
        orderBy: eventOrderOf(query.sort, query.dir, query.pendingTriage ?? false),
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

    const rules = await this.rules();
    const medians = rows.some((r) => r.fieldService) ? await this.fieldRepairMedians() : undefined;
    return paginate(
      rows.map((r) => toSummary(r, rules, medians)),
      total,
      { page: query.page, perPage: query.perPage },
    );
  }

  async summary(): Promise<EventsSummary> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const [registeredToday, awaitingTriage, deferred, openRows, rules] = await Promise.all([
      this.prisma.failureEvent.count({ where: { reportedAt: { gte: startOfToday } } }),
      this.prisma.failureEvent.count({
        where: { status: { in: [EventStatus.REGISTERED, EventStatus.IN_TRIAGE] } },
      }),
      this.prisma.failureEvent.count({ where: { status: EventStatus.DEFERRED } }),
      this.prisma.failureEvent.findMany({
        where: { status: { notIn: [EventStatus.CLOSED, EventStatus.CANCELLED] } },
        include: {
          vehicle: { select: { code: true, plate: true } },
          catalogItem: true,
          triage: true,
          fieldService: true,
          workOrder: { select: { id: true, code: true } },
        },
      }),
      this.rules(),
    ]);
    const safetyOpen = openRows.filter((r) => toSummary(r, rules).flags.isSafety).length;
    return { registeredToday, awaitingTriage, safetyOpen, deferred };
  }

  private rules(): Promise<FailureCodeRule[]> {
    return this.prisma.failureCodeRule.findMany({ where: { isActive: true } });
  }

  /** Regra por código > item do catálogo > padrão — a mesma função da tela. */
  private async flagsFor(
    fields: { failureModeCode?: string | null; subsystemCode?: string | null },
    catalogItem: { isFastTrack: boolean; isSafety: boolean; isDeferrable: boolean } | null,
  ): Promise<ResolvedFlags> {
    return resolveFailureFlags(await this.rules(), fields, catalogItem);
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

function toSummary(event: EventWithRelations, rules: FailureCodeRule[], medians?: Map<string, number>): FailureEventSummary {
  const flags = resolveFailureFlags(rules, event, event.catalogItem);
  // Item 16: o sistema sugere — a mediana real do reparo na rua para o subsistema;
  // sem histórico, o PAM sugere o próprio limite (30 min) e o Socorro, o tempo do catálogo.
  const catalogMinutes = event.catalogItem?.estimatedRepairMinutes ?? null;
  const historyMinutes = event.subsystemCode ? (medians?.get(event.subsystemCode) ?? null) : null;
  const isPam = event.fieldService?.kind === FieldServiceKind.PAM;
  const suggestion: { minutes: number; source: 'catalog' | 'history' | 'default' } = historyMinutes
    ? { minutes: historyMinutes, source: 'history' }
    : !isPam && catalogMinutes
      ? { minutes: catalogMinutes, source: 'catalog' }
      : { minutes: DEFAULT_FIELD_REPAIR_MINUTES, source: 'default' };
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
          isFastTrack: event.catalogItem.isFastTrack && FAST_TRACK_ENABLED,
          isSafety: event.catalogItem.isSafety,
          isDeferrable: event.catalogItem.isDeferrable,
        }
      : null,
    failureModeCode: event.failureModeCode,
    subsystemCode: event.subsystemCode,
    position: event.position,
    failureCode: event.failureCode,
    // Ocorrência real importada: o texto da ficha (alegado → constatado) diz mais que o código genérico do de-para.
    failureLabel:
      event.isImported && event.reportedDescription
        ? realEventLabel(event.reportedDescription)
        : describeFailureCode(event.failureModeCode, event.subsystemCode, event.position),
    flags,
    reportedDescription: event.reportedDescription,
    origin: event.origin,
    status: event.status,
    reportedAt: event.reportedAt.toISOString(),
    reporterRegistration: event.reporterRegistration,
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
          kind: event.fieldService.kind,
          reclassifiedAt: event.fieldService.reclassifiedAt?.toISOString() ?? null,
          dispatchedAt: event.fieldService.dispatchedAt.toISOString(),
          arrivedAt: event.fieldService.arrivedAt?.toISOString() ?? null,
          startedAt: event.fieldService.startedAt?.toISOString() ?? null,
          finishedAt: event.fieldService.finishedAt?.toISOString() ?? null,
          outcome: event.fieldService.outcome,
          supportVehicleCode: event.fieldService.supportVehicleCode,
          confirmedFailureCode: event.fieldService.confirmedFailureCode,
          estimatedRepairMinutes: event.fieldService.estimatedRepairMinutes,
          estimateSetAt: event.fieldService.estimateSetAt?.toISOString() ?? null,
          suggestedRepairMinutes: suggestion.minutes,
          suggestionSource: suggestion.source,
        }
      : null,
    workOrderId: event.workOrder?.id ?? null,
    workOrderCode: event.workOrder?.code ?? null,
  };
}

/** Rótulo curto de uma ocorrência importada: o que foi alegado e, quando a oficina constatou, o que constatou. */
export function realEventLabel(text: string): string {
  const parts = text.split(' · ');
  const found = parts.find((p) => p.startsWith('constatado: '));
  const first = parts[0]?.startsWith('CCO: ') ? parts[0].slice(5) : parts[0];
  return [first, found ? `→ ${found.slice('constatado: '.length)}` : null]
    .filter(Boolean)
    .join(' ')
    .slice(0, 90);
}

/** Ordem da lista de eventos; o registro é o desempate para a lista não embaralhar entre páginas. */
function eventOrderOf(sort: EventQuery['sort'], d: EventQuery['dir'], pendingTriage: boolean): Prisma.FailureEventOrderByWithRelationInput[] {
  const dir = d ?? 'desc';
  switch (sort) {
    case 'code':
      return [{ code: dir }];
    case 'vehicleCode':
      return [{ vehicle: { code: dir } }, { reportedAt: 'desc' }];
    case 'failureCode':
      return [{ failureCode: { sort: dir, nulls: 'last' } }, { reportedAt: 'desc' }];
    case 'origin':
      return [{ origin: dir }, { reportedAt: 'desc' }];
    case 'status':
      return [{ status: dir }, { reportedAt: 'desc' }];
    case 'reportedAt':
      return [{ reportedAt: dir }, { code: dir }];
    default:
      return [{ reportedAt: pendingTriage ? 'asc' : 'desc' }];
  }
}
