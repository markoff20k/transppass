import { Body, ConflictException, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TaskStatus, UserRole } from '@prisma/client';
import {
  createTechnicianSchema,
  updateTechnicianSchema,
  type CreateTechnicianInput,
  type TechnicianLevel,
  type TechnicianRow,
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
        _count: { select: { tasks: { where: { status: { in: [TaskStatus.IN_PROGRESS, TaskStatus.PENDING, TaskStatus.BLOCKED_BY_MATERIAL] } } } } },
      },
    });
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
    }));
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
}

@Module({
  controllers: [TechniciansController],
  providers: [TechniciansService],
  exports: [TechniciansService],
})
export class TechniciansModule {}
