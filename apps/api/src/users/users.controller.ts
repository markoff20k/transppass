import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createUserSchema,
  updateUserSchema,
  userQuerySchema,
  UserRole,
  type CreateUserInput,
  type Paginated,
  type PublicUser,
  type UpdateUserInput,
  type UserQuery,
} from '@app/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UsersService } from './users.service';

@ApiTags('usuários')
@ApiBearerAuth()
@Controller('users')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(userQuerySchema)) query: UserQuery,
  ): Promise<Paginated<PublicUser>> {
    return this.users.list(query);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<PublicUser> {
    return this.users.create(body, actorId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<PublicUser> {
    return this.users.update(id, body, actorId);
  }
}
