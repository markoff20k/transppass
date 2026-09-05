import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient | PrismaService;

interface NotifyInput {
  role?: UserRole;
  userId?: string;
  title: string;
  body: string;
  entity?: string;
  entityId?: string;
}

/**
 * RF-09 / RN-16 — "toda comunicação vira registro".
 *
 * O PRD é explícito: o Plantão recebe cada previsão automaticamente, sem
 * telefone. Notificar é parte da transação que muda o estado, não um efeito
 * colateral opcional — por isso os métodos aceitam o cliente da transação.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async notify(tx: Tx, input: NotifyInput): Promise<void> {
    await tx.notification.create({
      data: {
        role: input.role,
        userId: input.userId,
        title: input.title.slice(0, 160),
        body: input.body.slice(0, 800),
        entity: input.entity,
        entityId: input.entityId,
      },
    });
  }

  async notifyMany(tx: Tx, inputs: NotifyInput[]): Promise<void> {
    if (inputs.length === 0) return;
    await tx.notification.createMany({
      data: inputs.map((i) => ({
        role: i.role,
        userId: i.userId,
        title: i.title.slice(0, 160),
        body: i.body.slice(0, 800),
        entity: i.entity,
        entityId: i.entityId,
      })),
    });
  }

  /**
   * Previsão de retorno mudou: quem cobre a linha precisa saber sem perguntar.
   * O Plantão trabalha com a janela em contagem, então uma previsão desatualizada
   * custa reserva parada ou linha descoberta.
   */
  async notifyForecastChange(
    tx: Tx,
    vehicleCode: string,
    entityId: string,
    estimatedCompletionAt: Date | null,
  ): Promise<void> {
    const quando = estimatedCompletionAt
      ? estimatedCompletionAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      : 'sem previsão';

    await this.notifyMany(tx, [
      {
        role: UserRole.PLANTAO,
        title: `Previsão de retorno do carro ${vehicleCode} mudou`,
        body: `Nova previsão de conclusão: ${quando}.`,
        entity: 'QueueEntry',
        entityId,
      },
      {
        role: UserRole.CCO,
        title: `Previsão de retorno do carro ${vehicleCode} mudou`,
        body: `Nova previsão de conclusão: ${quando}.`,
        entity: 'QueueEntry',
        entityId,
      },
    ]);
  }

  async markRead(id: string, userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id, OR: [{ userId }, { userId: null }] },
      data: { readAt: new Date() },
    });
  }

  /** Caixa do usuário: o que é dele mais o que é do perfil dele. */
  async inbox(userId: string, role: UserRole, onlyUnread = true) {
    return this.prisma.notification.findMany({
      where: {
        OR: [{ userId }, { role }],
        ...(onlyUnread ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
