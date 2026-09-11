import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  changePasswordSchema,
  updateProfileSchema,
  type ChangePasswordInput,
  type PublicUser,
  type UpdateProfileInput,
} from '@app/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UsersService } from './users.service';

/**
 * O que a própria pessoa administra na conta dela: nome, telefone, foto e
 * senha. Sem guard de perfil — qualquer usuário autenticado; e-mail, matrícula
 * e perfil continuam sendo do administrador (RF-36).
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

  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser('sub') userId: string,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
  ): Promise<void> {
    await this.users.changePassword(userId, body);
  }
}
