import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { OdometerModule } from './odometer/odometer.module';
import { CatalogModule } from './catalog/catalog.module';
import { EventsModule } from './events/events.module';
import { QueueModule } from './queue/queue.module';
import { WorkOrdersModule } from './work-orders/work-orders.module';
import { MaterialsModule } from './materials/materials.module';
import { MetricsModule } from './metrics/metrics.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { OperationsModule } from './operations/operations.module';
import { PlansModule } from './plans/plans.module';
import { JobsModule } from './jobs/jobs.module';
import { DemoModule } from './demo/demo.module';
import { TechniciansModule } from './technicians/technicians.module';
import { DailyChecksModule } from './daily-checks/daily-checks.module';
import { QualityModule } from './quality/quality.module';
import { AuditsModule } from './audits/audits.module';
import { ComponentsModule } from './components/components.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { envSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      validate: (raw) => envSchema.parse(raw),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    CommonModule,
    AuthModule,
    UsersModule,
    // R0 — Fundacoes (secao 11 do PRD)
    VehiclesModule,
    OdometerModule,
    CatalogModule,
    // R1 — Corretivo e execucao: evento -> triagem -> fila -> OS -> portoes -> liberacao
    EventsModule,
    QueueModule,
    WorkOrdersModule,
    MaterialsModule,
    MetricsModule,
    DashboardModule,
    NotificationsModule,
    // R2 — Preventiva e Plantao
    SchedulingModule,
    OperationsModule,
    // Cadastro do plano preventivo (RF-34) e rotinas agendadas
    PlansModule,
    JobsModule,
    // Cadastros que o Kaizen MKBF exige (técnicos, kits corretivos, ferramental por tarefa)
    TechniciansModule,
    // Manutenção diária (Fluxos PCM p.8): checklist de conservação que abre OS
    DailyChecksModule,
    // Qualidade de peças e fornecedores (laboratório de inspeção do Kaizen)
    QualityModule,
    // Auditorias 5S e de conformidade (A3 §9)
    AuditsModule,
    // Componentes rastreáveis com vida por km
    ComponentsModule,
    // Simulador de demonstração — só age com DEMO_SIMULATOR=true
    DemoModule,
  ],
  providers: [
    // Tudo é protegido por padrão; rotas abertas usam @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
