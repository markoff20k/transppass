import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@app/shared';

/** Normaliza toda falha para o shape ApiErrorBody definido em @app/shared. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Erro interno do servidor';
    let fields: Record<string, string[]> | undefined;

    if (exception instanceof ZodError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      code = 'VALIDATION_ERROR';
      message = 'Dados inválidos';
      fields = exception.flatten().fieldErrors as Record<string, string[]>;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      code = HttpStatus[status] ?? 'HTTP_ERROR';
      message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message as string) ?? exception.message;
      if (Array.isArray(message)) message = message.join('; ');
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    const payload: ApiErrorBody = {
      statusCode: status,
      code,
      message,
      ...(fields ? { fields } : {}),
      timestamp: new Date().toISOString(),
      path: req.url,
    };

    res.status(status).json(payload);
  }
}
