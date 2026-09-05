import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createPoolComponentSchema,
  deliverMaterialSchema,
  loanToolSchema,
  materialQuerySchema,
  poolMovementSchema,
  requestMaterialSchema,
  separateMaterialSchema,
  UserRole,
  waitForPartSchema,
  type CreatePoolComponentInput,
  type DeliverMaterialInput,
  type LoanToolInput,
  type MaterialQuery,
  type MaterialRequestRow,
  type PoolComponentRow,
  type PoolMovementInput,
  type RequestMaterialInput,
  type SeparateMaterialInput,
  type ToolRow,
  type WaitForPartInput,
} from '@app/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MaterialsService } from './materials.service';

const STOCK = [UserRole.ADMIN, UserRole.ESTOQUE] as const;
const SHOP_FLOOR = [UserRole.ADMIN, UserRole.MANUTENCAO, UserRole.MECANICO] as const;

@ApiTags('materiais')
@ApiBearerAuth()
@Controller('materials')
@UseGuards(RolesGuard)
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  /** Fila única de solicitações — o que o Estoque abre de manhã. */
  @Get('requests')
  list(
    @Query(new ZodValidationPipe(materialQuerySchema)) query: MaterialQuery,
  ): Promise<MaterialRequestRow[]> {
    return this.materials.list(query);
  }

  @Get('requests/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<MaterialRequestRow> {
    return this.materials.findOne(id);
  }

  @Post('requests')
  @Roles(...SHOP_FLOOR)
  request(
    @Body(new ZodValidationPipe(requestMaterialSchema)) body: RequestMaterialInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<MaterialRequestRow> {
    return this.materials.request(body, actorId);
  }

  @Post('requests/:id/separate')
  @Roles(...STOCK)
  separate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(separateMaterialSchema)) body: SeparateMaterialInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<MaterialRequestRow> {
    return this.materials.separate(id, body, actorId);
  }

  @Post('requests/:id/deliver')
  @Roles(...STOCK)
  deliver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(deliverMaterialSchema)) body: DeliverMaterialInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<MaterialRequestRow> {
    return this.materials.deliver(id, body, actorId);
  }

  @Post('requests/:id/wait-for-part')
  @Roles(...STOCK)
  waitForPart(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(waitForPartSchema)) body: WaitForPartInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<MaterialRequestRow> {
    return this.materials.waitForPart(id, body, actorId);
  }

  /**
   * Escalonamento por prazo vencido. Endpoint em vez de job porque a
   * infraestrutura de agendamento é questão aberta do PRD (seção 12).
   */
  @Post('escalate-overdue')
  @Roles(UserRole.ADMIN, UserRole.PCM, UserRole.ESTOQUE)
  escalate(): Promise<{ escalated: number }> {
    return this.materials.escalateOverdue();
  }

  // --- Pool rotativo (RF-26) ------------------------------------------------

  @Get('pool')
  listPool(): Promise<PoolComponentRow[]> {
    return this.materials.listPool();
  }

  @Post('pool')
  @Roles(...STOCK)
  createPoolComponent(
    @Body(new ZodValidationPipe(createPoolComponentSchema)) body: CreatePoolComponentInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<PoolComponentRow> {
    return this.materials.createPoolComponent(body, actorId);
  }

  @Post('pool/:id/move')
  @Roles(...STOCK, UserRole.MANUTENCAO, UserRole.MECANICO)
  movePoolComponent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(poolMovementSchema)) body: PoolMovementInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<PoolComponentRow> {
    return this.materials.movePoolComponent(id, body, actorId);
  }

  // --- Ferramentas (RF-28) --------------------------------------------------

  @Get('tools')
  listTools(): Promise<ToolRow[]> {
    return this.materials.listTools();
  }

  @Post('tools/loan')
  @Roles(...STOCK, UserRole.MANUTENCAO, UserRole.MECANICO)
  loanTool(
    @Body(new ZodValidationPipe(loanToolSchema)) body: LoanToolInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<ToolRow[]> {
    return this.materials.loanTool(body, actorId);
  }

  @Post('tools/:id/return')
  @Roles(...STOCK, UserRole.MANUTENCAO, UserRole.MECANICO)
  returnTool(@Param('id', ParseUUIDPipe) id: string): Promise<ToolRow[]> {
    return this.materials.returnTool(id);
  }
}
