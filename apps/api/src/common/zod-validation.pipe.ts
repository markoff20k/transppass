import { Injectable, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Usa os schemas de @app/shared como validação de entrada da API,
 * garantindo que front e back validem exatamente a mesma regra.
 * O ZodError é convertido em 422 pelo HttpExceptionFilter.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
