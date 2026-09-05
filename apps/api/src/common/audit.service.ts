import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface AuditInput {
  actorId?: string;
  action: string;
  entity: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  ip?: string;
}

/**
 * Trilha append-only exigida na seção 8 do PRD (retenção mínima de 5 anos).
 * Só existe `write`: nenhum caminho da aplicação atualiza ou apaga um registro.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async write(input: AuditInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        before: input.before === undefined ? undefined : (input.before as object),
        after: input.after === undefined ? undefined : (input.after as object),
        reason: input.reason?.slice(0, 255),
        ip: input.ip?.slice(0, 64),
      },
    });
  }
}
