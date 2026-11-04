import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // A foto de perfil viaja como data URL (até ~300 KB); o padrão de 100 KB não cabe.
  app.useBodyParser('json', { limit: '2mb' });
  const config = app.get(ConfigService);

  app.use(helmet());
  // Em produção a API fica atrás de Caddy e nginx (rede interna do Docker):
  // sem isto, req.ip é o IP do nginx para todo mundo — o limitador de
  // requisições e a trilha de auditoria tratariam a empresa inteira como um
  // cliente só. Só endereços de rede privada/loopback são tidos como proxy.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: config.get<string>('CORS_ORIGIN', 'http://localhost:5173').split(','),
    credentials: true,
  });
  // A validacao de entrada e toda feita por ZodValidationPipe com os schemas de
  // @app/shared — nao ha DTO de class-validator, entao nao ha pipe global.
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  if (config.get('NODE_ENV') !== 'production') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('API')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  }

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(`API em http://localhost:${port}/api (docs em /api/docs)`);
}

void bootstrap();
