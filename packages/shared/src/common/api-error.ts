/**
 * Formato único de erro devolvido pela API. O frontend só precisa
 * conhecer este shape para tratar qualquer falha.
 */
export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  /** Erros de validação por campo, quando houver. */
  fields?: Record<string, string[]>;
  timestamp: string;
  path: string;
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'statusCode' in value &&
    'code' in value &&
    'message' in value
  );
}
