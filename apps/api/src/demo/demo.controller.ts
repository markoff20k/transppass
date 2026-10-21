import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DemoSimulatorService } from './demo-simulator.service';

/** Pulso manual do simulador: o apresentador "avança a garagem" sem esperar 5 minutos. */
@ApiTags('demo')
@ApiBearerAuth()
@Controller('demo')
@UseGuards(RolesGuard)
export class DemoController {
  constructor(private readonly simulator: DemoSimulatorService) {}

  @Post('pulse')
  @Roles(UserRole.ADMIN, UserRole.PCM)
  async pulse() {
    if (!this.simulator.isEnabled) return { enabled: false, steps: [] };
    const steps = await this.simulator.pulse();
    return { enabled: true, steps };
  }
}
