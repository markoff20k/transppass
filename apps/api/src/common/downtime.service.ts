import { Injectable } from '@nestjs/common';
import { DowntimeCause, WorkOrderStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient | PrismaService;

/**
 * O relógio único da OS-mãe (RN-02).
 *
 * Em vez de somar tempos por evento depois, o sistema mantém sempre um segmento
 * aberto com a causa corrente. Trocar de causa fecha o segmento anterior e abre
 * o próximo, então a soma dos segmentos reconstrói o relógio inteiro sem buraco
 * nem sobreposição — é isso que faz a decomposição do RF-39 sair de graça, e o
 * MKBF do RF-38 emergir do processo em vez de apuração manual.
 */
@Injectable()
export class DowntimeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Abre o primeiro segmento junto com a OS. */
  async start(tx: Tx, workOrderId: string, cause: DowntimeCause, at: Date): Promise<void> {
    await tx.downtimeSegment.create({
      data: { workOrderId, cause, startedAt: at },
    });
  }

  /**
   * Troca a causa corrente. Se a causa nova for igual à aberta, não faz nada —
   * fatiar o mesmo motivo em vários segmentos só polui o histórico.
   */
  async switchCause(tx: Tx, workOrderId: string, cause: DowntimeCause, at = new Date()): Promise<void> {
    const open = await tx.downtimeSegment.findFirst({
      where: { workOrderId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    if (open?.cause === cause) return;

    if (open) {
      await tx.downtimeSegment.update({
        where: { id: open.id },
        data: { endedAt: at, minutes: minutesBetween(open.startedAt, at) },
      });
    }

    await tx.downtimeSegment.create({ data: { workOrderId, cause, startedAt: at } });
  }

  /** Fecha o último segmento e devolve o total acumulado da OS. */
  async stop(tx: Tx, workOrderId: string, at = new Date()): Promise<number> {
    const open = await tx.downtimeSegment.findFirst({
      where: { workOrderId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    if (open) {
      await tx.downtimeSegment.update({
        where: { id: open.id },
        data: { endedAt: at, minutes: minutesBetween(open.startedAt, at) },
      });
    }

    const segments = await tx.downtimeSegment.findMany({
      where: { workOrderId },
      select: { minutes: true },
    });

    return segments.reduce((sum, s) => sum + (s.minutes ?? 0), 0);
  }

  /**
   * Total do relógio agora: segmentos fechados mais o tempo corrido do aberto.
   * Uma OS liberada tem o total travado em downtimeMinutes.
   */
  async currentMinutes(workOrderId: string, now = new Date()): Promise<number> {
    const segments = await this.prisma.downtimeSegment.findMany({
      where: { workOrderId },
      select: { minutes: true, startedAt: true, endedAt: true },
    });

    return segments.reduce(
      (sum, s) => sum + (s.endedAt ? (s.minutes ?? 0) : minutesBetween(s.startedAt, now)),
      0,
    );
  }

  /** RF-39 — decomposição por causa, com o segmento aberto já contabilizado. */
  async breakdown(workOrderId: string, now = new Date()) {
    const segments = await this.prisma.downtimeSegment.findMany({ where: { workOrderId } });

    const byCause = new Map<DowntimeCause, number>();
    for (const s of segments) {
      const minutes = s.endedAt ? (s.minutes ?? 0) : minutesBetween(s.startedAt, now);
      byCause.set(s.cause, (byCause.get(s.cause) ?? 0) + minutes);
    }

    const total = [...byCause.values()].reduce((a, b) => a + b, 0);

    return [...byCause.entries()]
      .map(([cause, minutes]) => ({ cause, minutes, share: total ? minutes / total : 0 }))
      .sort((a, b) => b.minutes - a.minutes);
  }

  /**
   * Traduz o estado da OS na causa que deve estar correndo. Concentrar isso num
   * lugar só evita que cada transição escolha a causa por conta própria e o
   * relógio passe a contar coisa errada.
   */
  causeForStatus(status: WorkOrderStatus): DowntimeCause {
    switch (status) {
      case WorkOrderStatus.OPEN:
        return DowntimeCause.QUEUE;
      case WorkOrderStatus.WAITING_PART:
        return DowntimeCause.MATERIAL;
      case WorkOrderStatus.IN_INSPECTION:
        return DowntimeCause.INSPECTION;
      case WorkOrderStatus.IN_CLEANING:
        return DowntimeCause.CLEANING;
      case WorkOrderStatus.TECH_CLOSED:
        return DowntimeCause.RELEASE_WAIT;
      default:
        return DowntimeCause.EXECUTION;
    }
  }
}

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
}
