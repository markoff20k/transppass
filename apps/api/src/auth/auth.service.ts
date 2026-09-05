import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { User } from '@prisma/client';
import type {
  AuthResponse,
  AuthTokens,
  JwtAccessPayload,
  LoginInput,
  PublicUser,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toPublicUser } from '../users/users.service';

interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(input: LoginInput, meta: SessionMeta = {}): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });

    // Mensagem generica de proposito: nao revela se o e-mail existe.
    if (!user || !user.isActive || !(await argon2.verify(user.passwordHash, input.password))) {
      throw new UnauthorizedException('E-mail ou senha invalidos');
    }

    return { user: toPublicUser(user), tokens: await this.issueTokens(user, meta) };
  }

  /** Rotaciona o refresh token: o antigo e revogado a cada uso. */
  async refresh(refreshToken: string, meta: SessionMeta = {}): Promise<AuthTokens> {
    try {
      await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token invalido ou expirado');
    }

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || !stored.user.isActive) {
      // Reuso de token ja revogado indica roubo: derruba todas as sessoes do usuario.
      if (stored?.revokedAt) await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException('Refresh token invalido ou expirado');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(stored.user, meta);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Sessao invalida');
    return toPublicUser(user);
  }

  private async issueTokens(user: User, meta: SessionMeta): Promise<AuthTokens> {
    const payload: JwtAccessPayload = { sub: user.id, email: user.email, role: user.role };
    const accessTtl = this.config.get<string>('JWT_ACCESS_TTL', '15m');
    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL', '7d');

    // expiresIn em segundos: evita depender do formato de string do pacote `ms`.
    const accessTtlSec = Math.floor(parseDuration(accessTtl) / 1000);
    const refreshTtlMs = parseDuration(refreshTtl);

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: accessTtlSec,
    });

    // O jti aleatorio garante que dois refresh tokens do mesmo segundo sejam distintos.
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti: randomBytes(16).toString('hex') },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: Math.floor(refreshTtlMs / 1000),
      },
    );

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtlMs),
        userAgent: meta.userAgent?.slice(0, 255),
        ip: meta.ip?.slice(0, 64),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTtlSec,
    };
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Converte "15m" / "7d" / "3600s" em milissegundos. */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)$/.exec(value.trim());
  if (!match) throw new Error(`Duracao invalida: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2] as 'ms' | 's' | 'm' | 'h' | 'd';
  const factor = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return amount * factor;
}
