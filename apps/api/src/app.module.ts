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
  ],
  providers: [
    // Tudo é protegido por padrão; rotas abertas usam @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
