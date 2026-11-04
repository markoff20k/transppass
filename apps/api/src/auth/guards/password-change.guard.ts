import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PASSWORD_CHANGE_REQUIRED, type JwtAccessPayload } from '@app/shared';
import { ALLOW_PENDING_PASSWORD_KEY } from '../decorators/allow-pending-password.decorator';

/**
 * Senha provisória bloqueia o sistema, não só a tela: conta criada pelo
 * administrador (ou importada da listagem de funcionários) entra com a senha
 * padrão e só segue depois de definir a sua. O web manda para /primeiro-acesso;
 * aqui se garante que nenhuma chamada direta à API passe antes disso.
 */
@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<{ user?: JwtAccessPayload }>().user;
    if (!user?.mustChangePassword) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;

    throw new ForbiddenException({
      code: PASSWORD_CHANGE_REQUIRED,
      message: 'Defina uma nova senha para continuar usando o sistema',
    });
  }
}
