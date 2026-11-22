import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  availabilityDaysQuerySchema,
  availabilityHoursQuerySchema,
  dashboardQuerySchema,
  mkbfSeriesQuerySchema,
  widgetQuerySchema,
  type AvailabilityDays,
  type DashboardDowntime,
  type DashboardEventsSeries,
  type DashboardRecentEvents,
  type AvailabilityDaysQuery,
  type AvailabilityHours,
  type AvailabilityHoursQuery,
  type DashboardData,
  type DashboardNotices,
  type DashboardQuery,
  type DashboardWidget,
  type MkbfSeries,
  type MkbfSeriesQuery,
  type WidgetQuery,
} from '@app/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DashboardService } from './dashboard.service';
import { NoticesService } from './notices.service';
import { WidgetsService } from './widgets.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
@UseGuards(RolesGuard)
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly noticesService: NoticesService,
    private readonly widgets: WidgetsService,
  ) {}

  /** A foto da garagem numa chamada so — tela inicial apos o login. */
  @Get()
  build(
    @Query(new ZodValidationPipe(dashboardQuerySchema)) query: DashboardQuery,
  ): Promise<DashboardData> {
    return this.dashboard.build(query);
  }

  /** Letreiro do Dashboard: fatos em andamento (socorro, SLA de OS e peça, fila, reserva, preventiva), uma linha cada. */
  @Get('notices')
  notices(): Promise<DashboardNotices> {
    return this.noticesService.build();
  }

  /** Série do MKBF por dia ou por mês para o período escolhido no cartão. */
  @Get('mkbf-series')
  mkbfSeries(
    @Query(new ZodValidationPipe(mkbfSeriesQuerySchema)) query: MkbfSeriesQuery,
  ): Promise<MkbfSeries> {
    return this.dashboard.mkbfSeriesRange(query);
  }

  /** Quebras por hora, dia ou semana num intervalo (card "Quebras por…"). */
  @Get('events-series')
  eventsSeries(@Query(new ZodValidationPipe(availabilityDaysQuerySchema)) query: AvailabilityDaysQuery): Promise<DashboardEventsSeries> {
    return this.dashboard.eventsSeries(query);
  }

  /** Últimos 6 eventos de um intervalo, recuando ao último dia com evento (card "Últimos eventos"). */
  @Get('recent-events')
  recentEvents(@Query(new ZodValidationPipe(availabilityDaysQuerySchema)) query: AvailabilityDaysQuery): Promise<DashboardRecentEvents> {
    return this.dashboard.recentEvents(query);
  }

  /** Tempo parado por causa das OS liberadas num intervalo (card "Tempo parado por causa"). */
  @Get('downtime')
  downtime(@Query(new ZodValidationPipe(availabilityDaysQuerySchema)) query: AvailabilityDaysQuery): Promise<DashboardDowntime> {
    return this.dashboard.downtime(query);
  }

  /** Disponibilidade dia a dia num intervalo (eixo em dias quando o período tem vários). */
  @Get('availability-days')
  availabilityDays(@Query(new ZodValidationPipe(availabilityDaysQuerySchema)) query: AvailabilityDaysQuery): Promise<AvailabilityDays> {
    return this.dashboard.availabilityDays(query);
  }

  /** Disponibilidade por hora: média de uma janela e a curva de um dia. */
  @Get('availability-hours')
  availabilityHours(
    @Query(new ZodValidationPipe(availabilityHoursQuerySchema)) query: AvailabilityHoursQuery,
  ): Promise<AvailabilityHours> {
    return this.dashboard.availabilityHours(query);
  }

  /** Um widget da seção de indicadores: indicador + período → valor, anterior e detalhe. */
  @Get('widget')
  widget(
    @Query(new ZodValidationPipe(widgetQuerySchema)) query: WidgetQuery,
  ): Promise<DashboardWidget> {
    return this.widgets.build(query);
  }
}
