import type { Prisma } from '@prisma/client';

/** Modelos que usam codigo sequencial legivel (EV-2026-000123, OS-2026-000045). */
type SequencedModel = 'failureEvent' | 'workOrder';

/**
 * Gera o proximo codigo sequencial do ano corrente.
 *
 * Roda dentro da transacao que cria o registro: duas criacoes simultaneas
 * serializam no banco em vez de gerar o mesmo numero, e o unique do campo
 * `code` e a rede de seguranca caso escapem.
 */
export async function nextSequentialCode(
  tx: Prisma.TransactionClient,
  model: SequencedModel,
  prefix: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const scope = `${prefix}-${year}-`;

  const last = await (tx[model] as {
    findFirst: (args: unknown) => Promise<{ code: string } | null>;
  }).findFirst({
    where: { code: { startsWith: scope } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });

  const lastNumber = last ? Number(last.code.slice(scope.length)) : 0;
  return `${scope}${String(lastNumber + 1).padStart(6, '0')}`;
}
