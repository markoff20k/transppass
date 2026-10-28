import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  catalogQuerySchema,
  createFailureCatalogItemSchema,
  createFailureCodeRuleSchema,
  createReasonCodeSchema,
  ReasonCodeList,
  updateFailureCatalogItemSchema,
  updateFailureCodeRuleSchema,
  updateReasonCodeSchema,
  UserRole,
  type CatalogQuery,
  type CreateFailureCatalogItemInput,
  type CreateFailureCodeRuleInput,
  type CreateReasonCodeInput,
  type FailureCodeRule,
  type FailureCatalogItem,
  type Paginated,
  type ReasonCode,
  type UpdateFailureCatalogItemInput,
  type UpdateFailureCodeRuleInput,
  type UpdateReasonCodeInput,
  type TransppassCodeRow,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(
    private readonly catalog: CatalogService,
    private readonly prisma: PrismaService,
  ) {}

  /** Classificação de falhas da Transppass (defeito alegado, defeito constatado, tipo de ficha). */
  @Get('transppass-codes')
  async transppassCodes(): Promise<TransppassCodeRow[]> {
    const rows = await this.prisma.transppassCode.findMany({ orderBy: [{ kind: 'asc' }, { code: 'asc' }] });
    return rows.map((r) => ({ kind: r.kind as TransppassCodeRow['kind'], code: r.code, description: r.description, group: r.group }));
  }

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

  // --- Regras de criticidade por código composto -----------------------------

  @Get('failure-rules')
  listRules(): Promise<FailureCodeRule[]> {
    return this.catalog.listRules();
  }

  @Post('failure-rules')
  @Roles(UserRole.ADMIN, UserRole.PCM)
  createRule(@Body(new ZodValidationPipe(createFailureCodeRuleSchema)) body: CreateFailureCodeRuleInput, @CurrentUser('sub') actorId: string): Promise<FailureCodeRule> {
    return this.catalog.createRule(body, actorId);
  }

  @Patch('failure-rules/:id')
  @Roles(UserRole.ADMIN, UserRole.PCM)
  updateRule(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateFailureCodeRuleSchema)) body: UpdateFailureCodeRuleInput, @CurrentUser('sub') actorId: string): Promise<FailureCodeRule> {
    return this.catalog.updateRule(id, body, actorId);
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
