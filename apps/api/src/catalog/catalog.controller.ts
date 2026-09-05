import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  catalogQuerySchema,
  createFailureCatalogItemSchema,
  createReasonCodeSchema,
  ReasonCodeList,
  updateFailureCatalogItemSchema,
  updateReasonCodeSchema,
  UserRole,
  type CatalogQuery,
  type CreateFailureCatalogItemInput,
  type CreateReasonCodeInput,
  type FailureCatalogItem,
  type Paginated,
  type ReasonCode,
  type UpdateFailureCatalogItemInput,
  type UpdateReasonCodeInput,
} from '@app/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CatalogService } from './catalog.service';

const reasonCodeQuerySchema = z.object({
  list: z.nativeEnum(ReasonCodeList).optional(),
  onlyActive: z.coerce.boolean().default(true),
});

@ApiTags('catálogo')
@ApiBearerAuth()
@Controller('catalog')
@UseGuards(RolesGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('items')
  listItems(
    @Query(new ZodValidationPipe(catalogQuerySchema)) query: CatalogQuery,
  ): Promise<Paginated<FailureCatalogItem>> {
    return this.catalog.listItems(query);
  }

  @Post('items')
  @Roles(UserRole.ADMIN, UserRole.PCM, UserRole.MANUTENCAO)
  createItem(
    @Body(new ZodValidationPipe(createFailureCatalogItemSchema)) body: CreateFailureCatalogItemInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<FailureCatalogItem> {
    return this.catalog.createItem(body, actorId);
  }

  @Patch('items/:id')
  @Roles(UserRole.ADMIN, UserRole.PCM, UserRole.MANUTENCAO)
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateFailureCatalogItemSchema)) body: UpdateFailureCatalogItemInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<FailureCatalogItem> {
    return this.catalog.updateItem(id, body, actorId);
  }

  @Get('versions/draft')
  @Roles(UserRole.ADMIN, UserRole.PCM, UserRole.MANUTENCAO)
  draftVersion() {
    return this.catalog.currentDraftVersion();
  }

  @Get('versions/published')
  publishedVersion() {
    return this.catalog.publishedVersion();
  }

  @Post('versions/:id/publish')
  @Roles(UserRole.ADMIN, UserRole.PCM)
  publish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('sub') actorId: string) {
    return this.catalog.publishVersion(id, actorId);
  }

  /** Especialidades de manutenção, usadas ao abrir sub-OS (RF-18). */
  @Get('specialties')
  listSpecialties() {
    return this.catalog.listSpecialties();
  }

  // --- Códigos de motivo (RF-33) -------------------------------------------

  @Get('reason-codes')
  listReasonCodes(
    @Query(new ZodValidationPipe(reasonCodeQuerySchema))
    query: z.infer<typeof reasonCodeQuerySchema>,
  ): Promise<ReasonCode[]> {
    return this.catalog.listReasonCodes(query.list, query.onlyActive);
  }

  @Post('reason-codes')
  @Roles(UserRole.ADMIN, UserRole.PCM)
  createReasonCode(
    @Body(new ZodValidationPipe(createReasonCodeSchema)) body: CreateReasonCodeInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<ReasonCode> {
    return this.catalog.createReasonCode(body, actorId);
  }

  @Patch('reason-codes/:id')
  @Roles(UserRole.ADMIN, UserRole.PCM)
  updateReasonCode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateReasonCodeSchema)) body: UpdateReasonCodeInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<ReasonCode> {
    return this.catalog.updateReasonCode(id, body, actorId);
  }
}
