import { PrismaClient } from '@prisma/client';
import { buildDemoScenario } from '../src/demo/demo-scenario';

/**
 * `npm run db:seed:demo` — monta a garagem de demonstração pela linha de
 * comando. É a mesma rotina que o interruptor "Simulação" do cabeçalho
 * executa; a lógica mora em src/demo/demo-scenario.ts.
 */
const prisma = new PrismaClient();

buildDemoScenario(prisma)
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
