import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { JwtAccessPayload } from '@app/shared';

/**
 * Limite de requisições por CONTA quando há sessão, e por IP só nas rotas
 * públicas (login, esqueci a senha). Uma garagem inteira sai para a internet
 * pelo mesmo IP: contar por endereço faria vinte pessoas dividirem a cota de
 * uma — foi o que derrubou o dashboard em produção com "429".
 */
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const user = req.user as JwtAccessPayload | undefined;
    if (user?.sub) return `user:${user.sub}`;
    return `ip:${req.ip ?? req.ips?.[0] ?? 'unknown'}`;
  }
}
