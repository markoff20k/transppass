import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_PASSWORD_KEY = 'allowPendingPassword';

/**
 * Rota que uma conta com senha provisória ainda pode usar: ver a própria
 * conta, definir a nova senha e sair. Todo o resto espera a troca
 * (PasswordChangeGuard).
 */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);
