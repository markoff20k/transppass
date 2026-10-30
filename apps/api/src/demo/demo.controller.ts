import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { demoToggleSchema, type DemoPulseResult, type DemoStatus, type DemoToggleInput } from '@app/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DemoSimulatorService } from './demo-simulator.service';

/**
 * Simulador de demonstração pelo cabeçalho: qualquer pessoa autenticada vê se
 * ele está ligado; ADMIN e PCM ligam, desligam e "avançam a garagem" sem
 * esperar os 5 minutos.
 */
@ApiTags('demo')
@ApiBearerAuth()
@Controller('demo')
@UseGuards(RolesGuard)
export class DemoController {
  constructor(private readonly simulator: DemoSimulatorService) {}

  @Get()
  status(): DemoStatus {
    return this.simulator.status();
  }

  @Patch()
  @Roles(UserRole.ADMIN, UserRole.PCM)
  toggle(
    @Body(new ZodValidationPipe(demoToggleSchema)) body: DemoToggleInput,
    @CurrentUser('sub') userId: string,
  ): Promise<DemoStatus> {
    return this.simulator.setEnabled(body.enabled, userId);
  }

  @Post('pulse')
  @Roles(UserRole.ADMIN, UserRole.PCM)
  async pulse(): Promise<DemoPulseResult> {
    if (!this.simulator.isEnabled) return { enabled: false, steps: [] };
    const steps = await this.simulator.pulse();
    return { enabled: true, steps };
  }
}
