import { PrismaClient } from '@prisma/client';
import { importConsumption } from './seed-import';

/**
 * Carrega só o consumo (apps/api/prisma/data/consumo.json), sem refazer o
 * resto da carga: `npm run db:seed:consumo`. Antes, gere o JSON a partir da
 * planilha com `python tools/dados-reais/gen_consumo.py --xlsx <arquivo>`.
 */
const prisma = new PrismaClient();
importConsumption(prisma)
  .then(() => console.log('Carga do consumo concluída.'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
