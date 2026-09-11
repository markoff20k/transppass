import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma, type User } from '@prisma/client';
import {
  paginate,
  type ChangePasswordInput,
  type CreateUserInput,
  type Paginated,
  type PublicUser,
  type UpdateProfileInput,
  type UpdateUserInput,
  type UserQuery,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';

/**
 * RF-36 — perfis e permissões por área, com registro de toda mudança.
 *
 * Não há auto-cadastro: a autenticação é individual (seção 8 do PRD) e o perfil
 * carrega autoridade de processo — só o administrador cria e altera contas, e
 * toda troca de perfil vira registro de auditoria.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateUserInput, actorId: string): Promise<PublicUser> {
    const exists = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (exists) throw new ConflictException('Já existe um usuário com este e-mail');

    if (input.registration) {
      const clash = await this.prisma.user.findUnique({
        where: { registration: input.registration },
      });
      if (clash) throw new ConflictException('Já existe um usuário com esta matrícula');
    }

    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        registration: input.registration,
        role: input.role,
        garageId: input.garageId,
        passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }),
      },
    });

    await this.audit.write({
      actorId,
      action: 'user.create',
      entity: 'User',
      entityId: user.id,
      after: { email: user.email, role: user.role, garageId: user.garageId },
    });

    return toPublicUser(user);
  }

  async update(id: string, input: UpdateUserInput, actorId: string): Promise<PublicUser> {
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Usuário não encontrado');

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        name: input.name,
        registration: input.registration,
        role: input.role,
        garageId: input.garageId,
        isActive: input.isActive,
        ...(input.password
          ? { passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }) }
          : {}),
      },
    });

    // Troca de perfil muda a autoridade da pessoa no processo: sempre registrada.
    await this.audit.write({
      actorId,
      action: 'user.update',
      entity: 'User',
      entityId: id,
      before: { role: before.role, isActive: before.isActive, garageId: before.garageId },
      after: {
        role: user.role,
        isActive: user.isActive,
        garageId: user.garageId,
        passwordChanged: Boolean(input.password),
      },
    });

    // Senha trocada ou conta desativada derruba as sessões abertas na hora.
    if (input.password || input.isActive === false) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    return toPublicUser(user);
  }

  async findPublic(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    return toPublicUser(user);
  }

  /** O que a própria pessoa muda na conta: nome, telefone e foto. */
  async updateProfile(id: string, input: UpdateProfileInput): Promise<PublicUser> {
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        name: input.name,
        phone: input.phone ?? null,
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      },
    });
    await this.audit.write({
      actorId: id,
      action: 'user.profile',
      entity: 'User',
      entityId: id,
      after: { name: user.name, phone: user.phone, hasAvatar: Boolean(user.avatarUrl) },
    });
    return toPublicUser(user);
  }

  /** Troca de senha pela própria pessoa: exige a atual e derruba as outras sessões. */
  async changePassword(id: string, input: ChangePasswordInput): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (!(await argon2.verify(user.passwordHash, input.currentPassword))) {
      throw new BadRequestException('Senha atual incorreta');
    }
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await argon2.hash(input.newPassword, { type: argon2.argon2id }) },
    });
    await this.prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.write({ actorId: id, action: 'user.password', entity: 'User', entityId: id });
  }

  async list(query: UserQuery): Promise<Paginated<PublicUser>> {
    const where: Prisma.UserWhereInput = {
      ...(query.onlyActive ? { isActive: true } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { email: { contains: query.search, mode: 'insensitive' as const } },
              { registration: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
        orderBy: { name: 'asc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginate(rows.map(toPublicUser), total, { page: query.page, perPage: query.perPage });
  }
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    registration: user.registration,
    garageId: user.garageId,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt.toISOString(),
  };
}
