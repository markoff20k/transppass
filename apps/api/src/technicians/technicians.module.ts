import { Body, ConflictException, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TaskStatus, UserRole } from '@prisma/client';
import {
  createTechnicianSchema,
  createTrainingSchema,
  updateTechnicianSchema,
  type CreateTechnicianInput,
  type CreateTrainingInput,
  type TechnicianLevel,
  type TechnicianRow,
  type TrainingRow,
  type UpdateTechnicianInput,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

/**
 * Kaizen 15–17 — técnicos de manutenção e inspetores. O cadastro é da
 * Manutenção; a sub-OS é atribuída ao técnico e a inspeção fica com quem é
 * inspetor. Técnico é desativado, nunca apagado: a sub-OS antiga precisa
 * continuar dizendo quem fez.
 */
@Injectable()
export class TechniciansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(onlyActive: boolean): Promise<TechnicianRow[]> {
    const rows = await this.prisma.technician.findMany({
      where: onlyActive ? { isActive: true } : undefined,
      orderBy: [{ specialty: { code: 'asc' } }, { level: 'desc' }, { name: 'asc' }],
      include: {
        specialty: true,
        trainings: { select: { kind: true, validUntil: true } },
        _count: { select: { tasks: { where: { status: { in: [TaskStatus.IN_PROGRESS, TaskStatus.PENDING, TaskStatus.BLOCKED_BY_MATERIAL] } } } } },
      },
    });
    const now = Date.now();
    const soon = now + 30 * 86_400_000;
    return rows.map((t) => ({
      id: t.id,
      registration: t.registration,
      name: t.name,
      specialtyId: t.specialtyId,
      specialtyCode: t.specialty.code,
      specialtyName: t.specialty.name,
      technologies: t.technologies,
      level: t.level as TechnicianLevel,
      isInspector: t.isInspector,
      isActive: t.isActive,
      userId: t.userId,
      openTasks: t._count.tasks,
      trainings: t.trainings.length,
      trainingsExpiring: t.trainings.filter((x) => x.validUntil && x.validUntil.getTime() < soon).length,
      missingHighVoltage: t.technologies.includes('EBUS') && !t.trainings.some((x) => x.kind === 'ALTA_TENSAO' && (!x.validUntil || x.validUntil.getTime() >= now)),
    }));
  }

  // --- Matriz de treinamentos ------------------------------------------------------

  async listTrainings(technicianId: string): Promise<TrainingRow[]> {
    const rows = await this.prisma.technicianTraining.findMany({ where: { technicianId }, orderBy: { completedAt: 'desc' } });
    const now = Date.now();
    return rows.map((r) => ({ id: r.id, kind: r.kind as TrainingRow['kind'], title: r.title, completedAt: r.completedAt.toISOString(), validUntil: r.validUntil?.toISOString() ?? null, hours: r.hours, note: r.note, isExpired: Boolean(r.validUntil && r.validUntil.getTime() < now) }));
  }

  async addTraining(technicianId: string, input: CreateTrainingInput, actorId: string): Promise<TrainingRow[]> {
    const tech = await this.prisma.technician.findUnique({ where: { id: technicianId } });
    if (!tech) throw new NotFoundException('Técnico não encontrado');
    await this.prisma.technicianTraining.create({ data: { technicianId, kind: input.kind, title: input.title, completedAt: input.completedAt, validUntil: input.validUntil ?? null, hours: input.hours ?? null, note: input.note ?? null } });
    await this.audit.write({ actorId, action: 'technician.training.add', entity: 'Technician', entityId: technicianId, after: { kind: input.kind, title: input.title } });
    return this.listTrainings(technicianId);
  }

  async removeTraining(technicianId: string, trainingId: string, actorId: string): Promise<TrainingRow[]> {
    await this.prisma.technicianTraining.deleteMany({ where: { id: trainingId, technicianId } });
    await this.audit.write({ actorId, action: 'technician.training.remove', entity: 'Technician', entityId: technicianId, after: { trainingId } });
    return this.listTrainings(technicianId);
  }

  async create(input: CreateTechnicianInput, actorId: string): Promise<TechnicianRow> {
    const clash = await this.prisma.technician.findUnique({ where: { registration: input.registration } });
    if (clash) throw new ConflictException(`Já existe técnico com a matrícula ${input.registration}`);
    const row = await this.prisma.technician.create({ data: input });
    await this.audit.write({ actorId, action: 'technician.create', entity: 'Technician', entityId: row.id, after: { registration: row.registration, level: row.level } });
    return (await this.list(false)).find((t) => t.id === row.id)!;
  }

  async update(id: string, input: UpdateTechnicianInput, actorId: string): Promise<TechnicianRow> {
    const before = await this.prisma.technician.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Técnico não encontrado');
    if (input.registration && input.registration !== before.registration) {
      const clash = await this.prisma.technician.findUnique({ where: { registration: input.registration } });
      if (clash) throw new ConflictException(`Já existe técnico com a matrícula ${input.registration}`);
    }
    await this.prisma.technician.update({ where: { id }, data: input });
    await this.audit.write({ actorId, action: 'technician.update', entity: 'Technician', entityId: id, before: { level: before.level, isActive: before.isActive }, after: input });
    return (await this.list(false)).find((t) => t.id === id)!;
  }
}

const EDITORS = [UserRole.ADMIN, UserRole.PCM, UserRole.MANUTENCAO] as const;

@ApiTags('técnicos')
@ApiBearerAuth()
@Controller('technicians')
@UseGuards(RolesGuard)
export class TechniciansController {
  constructor(private readonly technicians: TechniciansService) {}

  @Get()
  list(@Query('onlyActive') onlyActive?: string): Promise<TechnicianRow[]> {
    return this.technicians.list(onlyActive !== 'false');
  }

  @Post()
  @Roles(...EDITORS)
  create(@Body(new ZodValidationPipe(createTechnicianSchema)) body: CreateTechnicianInput, @CurrentUser('sub') actorId: string): Promise<TechnicianRow> {
    return this.technicians.create(body, actorId);
  }

  @Patch(':id')
  @Roles(...EDITORS)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateTechnicianSchema)) body: UpdateTechnicianInput, @CurrentUser('sub') actorId: string): Promise<TechnicianRow> {
    return this.technicians.update(id, body, actorId);
  }

  @Get(':id/trainings')
  trainings(@Param('id', ParseUUIDPipe) id: string): Promise<TrainingRow[]> {
    return this.technicians.listTrainings(id);
  }

  @Post(':id/trainings')
  @Roles(...EDITORS)
  addTraining(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(createTrainingSchema)) body: CreateTrainingInput, @CurrentUser('sub') actorId: string): Promise<TrainingRow[]> {
    return this.technicians.addTraining(id, body, actorId);
  }

  @Delete(':id/trainings/:trainingId')
  @Roles(...EDITORS)
  removeTraining(@Param('id', ParseUUIDPipe) id: string, @Param('trainingId', ParseUUIDPipe) trainingId: string, @CurrentUser('sub') actorId: string): Promise<TrainingRow[]> {
    return this.technicians.removeTraining(id, trainingId, actorId);
  }
}

@Module({
  controllers: [TechniciansController],
  providers: [TechniciansService],
  exports: [TechniciansService],
})
export class TechniciansModule {}
