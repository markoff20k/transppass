import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { dashboardQuerySchema, type DashboardData, type DashboardNotices, type DashboardQuery, type UserRole } from '@app/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DashboardService } from './dashboard.service';
import { NoticesService } from './notices.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
@UseGuards(RolesGuard)
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly noticesService: NoticesService,
  ) {}

  /** A foto da garagem numa chamada so — tela inicial apos o login. */
  @Get()
  build(
    @Query(new ZodValidationPipe(dashboardQuerySchema)) query: DashboardQuery,
  ): Promise<DashboardData> {
    return this.dashboard.build(query);
  }

  /** Avisos e alertas do cartão de cima: garagem, dados do ERP-JB, caixa do usuário e quadro. */
  @Get('notices')
  notices(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
  ): Promise<DashboardNotices> {
    return this.noticesService.build(userId, role);
  }
}
