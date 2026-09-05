import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { QueueStatus, ReasonCodeList, WorkOrderType } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import {
  CRITICALITY,
  DEFAULT_REPAIR_MINUTES,
  type QueueChangeRow,
  type QueueEntryRow,
  type QueueQuery,
  type ReorderQueueInput,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NotificationsService } from '../common/notifications.service';

type Tx = Prisma.TransactionClient;

/** Motivo usado quando o próprio sistema move a fila (fast-track, RF-06). */
const SYSTEM_REASON_CODE = 'SISTEMA';

/**
 * E2 — a fila de manutenção.
 *
 * O PRD descreve o problema atual como "a ordem de atendimento muda por
 * conversa; não há como auditar nem aprender com as decisões". A resposta aqui
 * é estrutural: a posição nunca muda sem passar por `reorder`, que exige código
 * de motivo e grava um registro imutável antes de confirmar.
 */
@Injectable()
export class QueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Entrada na fila. A posição inicial vem da criticidade: o carro se encaixa
   * antes do primeiro de criticidade menor, e não simplesmente no fim.
   */
  async enqueue(
    tx: Tx,
    input: {
      vehicleId: string;
      eventId?: string;
      workOrderId?: string;
      criticality: number;
      isFastTrack: boolean;
      estimatedRepairMinutes?: number | null;
    },
  ) {
    const waiting = await tx.queueEntry.findMany({
      where: { status: QueueStatus.WAITING },
      orderBy: { position: 'asc' },
      select: { id: true, position: true, criticality: true },
    });

    const insertIndex = waiting.findIndex((e) => e.criticality < input.criticality);
    const position = insertIndex === -1 ? waiting.length + 1 : insertIndex + 1;

    // Abre espaço empurrando quem está da posição em diante.
    await tx.queueEntry.updateMany({
      where: { status: QueueStatus.WAITING, position: { gte: position } },
      data: { position: { increment: 1 } },
    });

    const entry = await tx.queueEntry.create({
      data: {
        vehicleId: input.vehicleId,
        eventId: input.eventId,
        workOrderId: input.workOrderId,
        position,
        criticality: input.criticality,
        isFastTrack: input.isFastTrack,
      },
    });

    if (input.isFastTrack) {
      // RF-06 — o fast-track é uma priorização como outra qualquer: entra na
      // mesma trilha de auditoria, só que gravada pelo próprio sistema (P-06).
      const reason = await this.systemReasonCode(tx);
      await tx.queueChangeLog.create({
        data: {
          queueEntryId: entry.id,
          fromPosition: null,
          toPosition: position,
          reasonCodeId: reason.id,
          isSystemGenerated: true,
          note: 'Fast-track automático por flag do catálogo',
        },
      });
    }

    await this.recalculateForecasts(tx);
    return entry;
  }

  /** RF-08 — mudança manual de posição. Sem motivo, não confirma. */
  async reorder(input: ReorderQueueInput, actorId: string): Promise<QueueEntryRow[]> {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.queueEntry.findUnique({
        where: { id: input.queueEntryId },
        include: { vehicle: { select: { code: true } } },
      });
      if (!entry) throw new NotFoundException('Item da fila não encontrado');
      if (entry.status !== QueueStatus.WAITING) {
        throw new BadRequestException('Só é possível reordenar itens que ainda aguardam');
      }

      const reason = await tx.reasonCode.findUnique({ where: { id: input.reasonCodeId } });
      if (!reason || reason.list !== ReasonCodeList.QUEUE_PRIORITY) {
        throw new BadRequestException('Código de motivo inválido para priorização de fila');
      }
      if (!reason.isActive) {
        throw new BadRequestException('Este código de motivo está desativado');
      }

      const waiting = await tx.queueEntry.findMany({
        where: { status: QueueStatus.WAITING },
        orderBy: { position: 'asc' },
        select: { id: true },
      });

      const from = entry.position;
      const to = Math.min(Math.max(1, input.toPosition), waiting.length);
      if (from === to) return this.list({ includeFinished: false });

      // Reescreve as posições da lista inteira: mais simples de raciocinar do
      // que deslocamentos condicionais, e a fila é pequena o bastante.
      const ids = waiting.map((w) => w.id);
      const moving = ids.splice(from - 1, 1)[0]!;
      ids.splice(to - 1, 0, moving);

      for (const [index, id] of ids.entries()) {
        await tx.queueEntry.update({ where: { id }, data: { position: index + 1 } });
      }

      // O registro é append-only: escrito antes de qualquer coisa poder falhar
      // depois, e nunca atualizado nem apagado por caminho nenhum da API.
      await tx.queueChangeLog.create({
        data: {
          queueEntryId: entry.id,
          fromPosition: from,
          toPosition: to,
          reasonCodeId: reason.id,
          actorId,
          isSystemGenerated: false,
          note: input.note,
        },
      });

      await this.audit.write({
        actorId,
        action: 'queue.reorder',
        entity: 'QueueEntry',
        entityId: entry.id,
        before: { position: from },
        after: { position: to },
        reason: `${reason.code} — ${reason.description}`,
      });

      // RF-09 — mexer na fila muda a previsão de todo mundo atrás, não só de
      // quem foi movido. Recalcula e avisa os afetados.
      const affected = await this.recalculateForecasts(tx);
      for (const item of affected) {
        await this.notifications.notifyForecastChange(
          tx,
          item.vehicleCode,
          item.id,
          item.estimatedCompletionAt,
        );
      }

      return this.listWithin(tx, { includeFinished: false });
    });
  }

  /**
   * RF-09 — previsão de conclusão de cada item, encadeando as durações de quem
   * está na frente. Simplificação assumida: uma valeta virtual, atendimento em
   * série. Com o número de valetas cadastrado dá para paralelizar depois.
   */
  private async recalculateForecasts(tx: Tx) {
    const entries = await tx.queueEntry.findMany({
      where: { status: { in: [QueueStatus.WAITING, QueueStatus.IN_SERVICE] } },
      orderBy: [{ status: 'asc' }, { position: 'asc' }],
      include: {
        vehicle: { select: { code: true } },
        event: { include: { catalogItem: { select: { estimatedRepairMinutes: true } } } },
      },
    });

    const now = new Date();
    let cursor = now.getTime();
    const affected: { id: string; vehicleCode: string; estimatedCompletionAt: Date }[] = [];

    for (const entry of entries) {
      const minutes = entry.event?.catalogItem?.estimatedRepairMinutes ?? DEFAULT_REPAIR_MINUTES;
      cursor += minutes * 60_000;
      const estimatedCompletionAt = new Date(cursor);

      if (entry.estimatedCompletionAt?.getTime() !== estimatedCompletionAt.getTime()) {
        await tx.queueEntry.update({
          where: { id: entry.id },
          data: { estimatedCompletionAt },
        });
        affected.push({ id: entry.id, vehicleCode: entry.vehicle.code, estimatedCompletionAt });
      }
    }

    return affected;
  }

  async startService(tx: Tx, queueEntryId: string): Promise<void> {
    await tx.queueEntry.update({
      where: { id: queueEntryId },
      data: { status: QueueStatus.IN_SERVICE, startedAt: new Date() },
    });
    await this.compact(tx);
  }

  async finish(tx: Tx, workOrderId: string): Promise<void> {
    await tx.queueEntry.updateMany({
      where: { workOrderId, status: { not: QueueStatus.DONE } },
      data: { status: QueueStatus.DONE, finishedAt: new Date() },
    });
    await this.compact(tx);
    await this.recalculateForecasts(tx);
  }

  /** Fecha buracos de posição deixados por quem saiu da fila. */
  private async compact(tx: Tx): Promise<void> {
    const waiting = await tx.queueEntry.findMany({
      where: { status: QueueStatus.WAITING },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });

    for (const [index, entry] of waiting.entries()) {
      if (entry.position !== index + 1) {
        await tx.queueEntry.update({ where: { id: entry.id }, data: { position: index + 1 } });
      }
    }
  }

  async list(query: QueueQuery): Promise<QueueEntryRow[]> {
    return this.listWithin(this.prisma, query);
  }

  private async listWithin(
    client: Tx | PrismaService,
    query: QueueQuery,
  ): Promise<QueueEntryRow[]> {
    const rows = await client.queueEntry.findMany({
      where: query.status
        ? { status: query.status }
        : query.includeFinished
          ? {}
          : { status: { in: [QueueStatus.WAITING, QueueStatus.IN_SERVICE] } },
      orderBy: [{ status: 'asc' }, { position: 'asc' }],
      include: {
        vehicle: { select: { code: true, plate: true } },
        event: { include: { catalogItem: true } },
        workOrder: { select: { code: true, type: true } },
      },
    });

    const now = Date.now();

    return rows.map((r) => ({
      id: r.id,
      position: r.position,
      criticality: r.criticality,
      isFastTrack: r.isFastTrack,
      status: r.status,
      vehicleId: r.vehicleId,
      vehicleCode: r.vehicle.code,
      vehiclePlate: r.vehicle.plate,
      eventId: r.eventId,
      eventCode: r.event?.code ?? null,
      failureDescription: r.event?.catalogItem?.description ?? r.event?.reportedDescription ?? null,
      isSafety: r.event?.catalogItem?.isSafety ?? false,
      workOrderId: r.workOrderId,
      workOrderCode: r.workOrder?.code ?? null,
      enteredAt: r.enteredAt.toISOString(),
      startedAt: r.startedAt?.toISOString() ?? null,
      estimatedCompletionAt: r.estimatedCompletionAt?.toISOString() ?? null,
      estimatedRepairMinutes:
        r.event?.catalogItem?.estimatedRepairMinutes ?? DEFAULT_REPAIR_MINUTES,
      waitingHours: Math.round(((now - r.enteredAt.getTime()) / 3_600_000) * 10) / 10,
    }));
  }

  /** Histórico imutável de uma posição na fila, para auditoria e aprendizado. */
  async history(queueEntryId: string): Promise<QueueChangeRow[]> {
    const rows = await this.prisma.queueChangeLog.findMany({
      where: { queueEntryId },
      orderBy: { createdAt: 'asc' },
      include: { reasonCode: true },
    });

    const actorIds = rows.map((r) => r.actorId).filter((id): id is string => Boolean(id));
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true },
        })
      : [];
    const byId = new Map(actors.map((a) => [a.id, a.name]));

    return rows.map((r) => ({
      id: r.id,
      fromPosition: r.fromPosition,
      toPosition: r.toPosition,
      reasonCode: r.reasonCode.code,
      reasonDescription: r.reasonCode.description,
      actorName: r.actorId ? (byId.get(r.actorId) ?? null) : null,
      isSystemGenerated: r.isSystemGenerated,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Criticidade da entrada (RF-07). Derivada das flags que o PRD já usa para
   * dirigir o processo — ver CRITICALITY em @app/shared para as premissas.
   */
  criticalityFor(input: {
    isSafety?: boolean;
    isFastTrack?: boolean;
    type?: WorkOrderType;
    wasDeferred?: boolean;
  }): number {
    if (input.isSafety) return CRITICALITY.SAFETY;
    if (input.isFastTrack) return CRITICALITY.FAST_TRACK;
    if (input.wasDeferred) return CRITICALITY.DEFERRED;
    if (input.type === WorkOrderType.PREVENTIVE) return CRITICALITY.PREVENTIVE;
    return CRITICALITY.STANDARD;
  }

  /** Cria sob demanda o motivo reservado às movimentações do próprio sistema. */
  private async systemReasonCode(tx: Tx) {
    const existing = await tx.reasonCode.findUnique({
      where: { list_code: { list: ReasonCodeList.QUEUE_PRIORITY, code: SYSTEM_REASON_CODE } },
    });
    if (existing) return existing;

    return tx.reasonCode.create({
      data: {
        list: ReasonCodeList.QUEUE_PRIORITY,
        code: SYSTEM_REASON_CODE,
        description: 'Priorização automática do sistema (fast-track do catálogo)',
      },
    });
  }
}
