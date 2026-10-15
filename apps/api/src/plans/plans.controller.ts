import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createKitSchema,
  createMaterialSchema,
  createPackageSchema,
  createPlanSchema,
  createPlanTaskSchema,
  updateKitSchema,
  updateMaterialSchema,
  updatePackageSchema,
  updatePlanSchema,
  updatePlanTaskSchema,
  UserRole,
  type CreateKitInput,
  type CreateMaterialInput,
  type CreatePackageInput,
  type CreatePlanInput,
  type CreatePlanTaskInput,
  type MaterialRow,
  type PlanKitRow,
  type PlanTree,
  type UpdateKitInput,
  type UpdateMaterialInput,
  type UpdatePackageInput,
  type UpdatePlanInput,
  type UpdatePlanTaskInput,
} from '@app/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlansService } from './plans.service';

const EDITORS = [UserRole.ADMIN, UserRole.PCM] as const;
const MATERIAL_EDITORS = [UserRole.ADMIN, UserRole.PCM, UserRole.ESTOQUE] as const;

@ApiTags('planos')
@ApiBearerAuth()
@Controller('plans')
@UseGuards(RolesGuard)
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  list(): Promise<PlanTree[]> {
    return this.plans.list();
  }

  @Post()
  @Roles(...EDITORS)
  createPlan(@Body(new ZodValidationPipe(createPlanSchema)) body: CreatePlanInput, @CurrentUser('sub') actorId: string) {
    return this.plans.createPlan(body, actorId);
  }

  @Patch(':id')
  @Roles(...EDITORS)
  updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updatePlanSchema)) body: UpdatePlanInput, @CurrentUser('sub') actorId: string) {
    return this.plans.updatePlan(id, body, actorId);
  }

  @Post(':id/packages')
  @Roles(...EDITORS)
  createPackage(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(createPackageSchema)) body: CreatePackageInput, @CurrentUser('sub') actorId: string) {
    return this.plans.createPackage(id, body, actorId);
  }

  @Patch('packages/:id')
  @Roles(...EDITORS)
  updatePackage(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updatePackageSchema)) body: UpdatePackageInput, @CurrentUser('sub') actorId: string) {
    return this.plans.updatePackage(id, body, actorId);
  }

  @Post('packages/:id/tasks')
  @Roles(...EDITORS)
  createTask(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(createPlanTaskSchema)) body: CreatePlanTaskInput, @CurrentUser('sub') actorId: string) {
    return this.plans.createTask(id, body, actorId);
  }

  @Patch('tasks/:id')
  @Roles(...EDITORS)
  updateTask(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updatePlanTaskSchema)) body: UpdatePlanTaskInput, @CurrentUser('sub') actorId: string) {
    return this.plans.updateTask(id, body, actorId);
  }

  @Delete('tasks/:id')
  @Roles(...EDITORS)
  @HttpCode(204)
  deleteTask(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('sub') actorId: string): Promise<void> {
    return this.plans.deleteTask(id, actorId);
  }

  @Post('packages/:id/kits')
  @Roles(...MATERIAL_EDITORS)
  createKit(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(createKitSchema)) body: CreateKitInput, @CurrentUser('sub') actorId: string): Promise<PlanKitRow> {
    return this.plans.createKit(id, body, actorId);
  }

  @Patch('kits/:id')
  @Roles(...MATERIAL_EDITORS)
  updateKit(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateKitSchema)) body: UpdateKitInput, @CurrentUser('sub') actorId: string): Promise<PlanKitRow> {
    return this.plans.updateKit(id, body, actorId);
  }

  // --- Materiais -------------------------------------------------------------

  @Get('materials')
  listMaterials(): Promise<MaterialRow[]> {
    return this.plans.listMaterials();
  }

  @Post('materials')
  @Roles(...MATERIAL_EDITORS)
  createMaterial(@Body(new ZodValidationPipe(createMaterialSchema)) body: CreateMaterialInput, @CurrentUser('sub') actorId: string) {
    return this.plans.createMaterial(body, actorId);
  }

  @Patch('materials/:id')
  @Roles(...MATERIAL_EDITORS)
  updateMaterial(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateMaterialSchema)) body: UpdateMaterialInput, @CurrentUser('sub') actorId: string) {
    return this.plans.updateMaterial(id, body, actorId);
  }
}
