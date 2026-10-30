import { Body, Controller, Get, HttpCode, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  accountActivityQuerySchema,
  changePasswordSchema,
  updatePreferencesSchema,
  updateProfileSchema,
  type AccountActivity,
  type AccountActivityQuery,
  type AccountSummary,
  type ChangePasswordInput,
  type PublicUser,
  type UpdatePreferencesInput,
  type UpdateProfileInput,
} from '@app/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UsersService } from './users.service';

/**
 * O que a própria pessoa administra na conta dela: nome, telefone, foto,
 * senha e preferências. Sem guard de perfil — qualquer usuário autenticado;
 * e-mail, matrícula e perfil continuam sendo do administrador (RF-36).
 */
@ApiTags('perfil')
@ApiBearerAuth()
@Controller('users/me')
export class ProfileController {
  constructor(private readonly users: UsersService) {}

  @Get()
  me(@CurrentUser('sub') userId: string): Promise<PublicUser> {
    return this.users.findPublic(userId);
  }

  @Patch()
  update(
    @CurrentUser('sub') userId: string,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
  ): Promise<PublicUser> {
    return this.users.updateProfile(userId, body);
  }

  /** Atalhos do cabeçalho, avisos e notificações — guardados na conta. */
  @Patch('preferences')
  updatePreferences(
    @CurrentUser('sub') userId: string,
    @Body(new ZodValidationPipe(updatePreferencesSchema)) body: UpdatePreferencesInput,
    @Req() req: Request,
  ): Promise<PublicUser> {
    return this.users.updatePreferences(userId, body, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Get('summary')
  summary(@CurrentUser('sub') userId: string): Promise<AccountSummary> {
    return this.users.summary(userId);
  }

  @Get('activity')
  activity(
    @CurrentUser('sub') userId: string,
    @Query(new ZodValidationPipe(accountActivityQuerySchema)) query: AccountActivityQuery,
  ): Promise<AccountActivity[]> {
    return this.users.activity(userId, query);
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser('sub') userId: string,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
  ): Promise<void> {
    await this.users.changePassword(userId, body);
  }
}
