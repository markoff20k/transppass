import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  checklistItemSchema,
  cleaningChecklistSchema,
  cleaningDamageSchema,
  createTaskSchema,
  finishTaskSchema,
  inspectionSchema,
  openWorkOrderSchema,
  updateEstimateSchema,
  UserRole,
  workOrderQuerySchema,
  type ChecklistItemInput,
  type CleaningChecklistInput,
  type CleaningDamageInput,
  type CreateTaskInput,
  type FinishTaskInput,
  type InspectionInput,
  type OpenWorkOrderInput,
  type Paginated,
  type UpdateEstimateInput,
  type WorkOrderDetail,
  type WorkOrderQuery,
  type WorkOrderSummary,
} from '@app/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { WorkOrdersService } from './work-orders.service';

/** Quem põe a mão no carro: mecânico, manutenção e o administrador. */
const SHOP_FLOOR = [UserRole.ADMIN, UserRole.MANUTENCAO, UserRole.MECANICO] as const;

@ApiTags('ordens de serviço')
@ApiBearerAuth()
@Controller('work-orders')
@UseGuards(RolesGuard)
export class WorkOrdersController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(workOrderQuerySchema)) query: WorkOrderQuery,
  ): Promise<Paginated<WorkOrderSummary>> {
    return this.workOrders.list(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<WorkOrderDetail> {
    return this.workOrders.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.PCM, UserRole.MANUTENCAO)
  open(
    @Body(new ZodValidationPipe(openWorkOrderSchema)) body: OpenWorkOrderInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.open(body, actorId);
  }

  @Patch(':id/estimate')
  @Roles(UserRole.ADMIN, UserRole.PCM, UserRole.MANUTENCAO)
  updateEstimate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateEstimateSchema)) body: UpdateEstimateInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.updateEstimate(id, body, actorId);
  }

  // --- Sub-OS (RF-18) -------------------------------------------------------

  @Post(':id/tasks')
  @Roles(...SHOP_FLOOR, UserRole.PCM)
  addTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createTaskSchema)) body: CreateTaskInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.addTask(id, body, actorId);
  }

  @Post('tasks/:taskId/start')
  @Roles(...SHOP_FLOOR)
  startTask(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser('sub') actorId: string,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.startTask(taskId, actorId);
  }

  @Patch('checklist/:itemId')
  @Roles(...SHOP_FLOOR)
  toggleChecklist(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(new ZodValidationPipe(checklistItemSchema)) body: ChecklistItemInput,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.toggleChecklistItem(itemId, body);
  }

  @Post('tasks/:taskId/finish')
  @Roles(...SHOP_FLOOR)
  finishTask(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body(new ZodValidationPipe(finishTaskSchema)) body: FinishTaskInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.finishTask(taskId, body, actorId);
  }

  // --- Portão 1 (RF-19) -----------------------------------------------------

  @Post(':id/tech-close')
  @Roles(UserRole.ADMIN, UserRole.MANUTENCAO)
  techClose(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') actorId: string,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.techClose(id, actorId);
  }

  // --- Portão 2: inspeção (RF-20) -------------------------------------------

  @Post('tasks/:taskId/inspect')
  @Roles(UserRole.ADMIN, UserRole.INSPETOR)
  inspect(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body(new ZodValidationPipe(inspectionSchema)) body: InspectionInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.inspect(taskId, body, actorId);
  }

  // --- Limpeza (RF-21) ------------------------------------------------------

  @Post(':id/cleaning/start')
  @Roles(UserRole.ADMIN, UserRole.LIMPEZA)
  startCleaning(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') actorId: string,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.startCleaning(id, actorId);
  }

  @Patch('cleaning/checklist/:itemId')
  @Roles(UserRole.ADMIN, UserRole.LIMPEZA)
  toggleCleaningItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(new ZodValidationPipe(cleaningChecklistSchema)) body: CleaningChecklistInput,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.toggleCleaningItem(itemId, body.isChecked);
  }

  @Post(':id/cleaning/finish')
  @Roles(UserRole.ADMIN, UserRole.LIMPEZA)
  finishCleaning(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') actorId: string,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.finishCleaning(id, actorId);
  }

  @Post(':id/cleaning/damage')
  @Roles(UserRole.ADMIN, UserRole.LIMPEZA)
  reportDamage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cleaningDamageSchema)) body: CleaningDamageInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.reportCleaningDamage(id, body, actorId);
  }

  // --- Liberação (RF-22) ----------------------------------------------------

  /**
   * O RolesGuard já barra quem não é Manutenção, mas o serviço confere de novo:
   * a exclusividade da liberação é regra de negócio (RN-04), não configuração
   * de rota, e não pode depender de quem montou o decorator.
   */
  @Post(':id/release')
  @Roles(UserRole.ADMIN, UserRole.MANUTENCAO)
  release(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') actorId: string,
    @CurrentUser('role') actorRole: UserRole,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.release(id, actorId, actorRole);
  }
}
