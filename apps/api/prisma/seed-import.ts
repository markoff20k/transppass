import { PrismaClient, VehicleTechnology } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Carga das bases que a Transppass entregou no Kaizen "Projeto MKBF":
 *
 *  - 10 e 11 Almoxarifado + "Peças para manutenção corretiva" → materiais
 *    (2.496 itens com classe, referência, prateleira, saldo e custo; os 380
 *    da lista preventiva marcados como tal)
 *  - 08 Motorista por tecnologia + 09 Cobrador por lote → operadores
 *    (907 motoristas com categoria de CNH e classes permitidas; 864 cobradores
 *    com lote e admissão)
 *  - 12 Inspeção de ferramentas (FR.168) → ferramentas com quantidade necessária
 *  - IT.MAN-01 / -54 / -60 / -16 → planos preventivos por modelo, com pacotes,
 *    gatilhos (offset + intervalo), tolerância dupla, tarefas e kits
 *
 * Idempotente: tudo é upsert pela chave natural (código, matrícula, código do
 * plano). Pode rodar quantas vezes for preciso; ele nunca apaga nada.
 */

const DATA = resolve(__dirname, 'data');
const readJson = <T>(file: string): T => JSON.parse(readFileSync(resolve(DATA, file), 'utf8')) as T;

interface MaterialJson {
  code: string;
  classCode: string | null;
  description: string;
  manufacturerRef: string | null;
  abcClass: string | null;
  location: string | null;
  stockQty: number | null;
  avgCost: number | null;
  totalValue: number | null;
  isPreventive: boolean;
}

interface OperatorJson {
  registration: string;
  name: string;
  function: 'MOTORISTA' | 'COBRADOR';
  cnhCategory: string | null;
  lot: string | null;
  admittedAt: string | null;
  vehicleClasses: string[];
}

interface ToolJson {
  code: string;
  description: string;
  requiredQty: number;
}

interface DieselModel {
  model: string;
  manufacturer: string;
  classes: string[];
  engineOilL: number;
  oil: string;
  oilFilter: string;
  fuelFilter: string;
  waterSeparator: string;
  airFilter: string | null;
  airFilterSecondary: string | null;
  cabinFilter: string | null;
  gearboxOil: string | null;
  gearboxFilter: string | null;
  diffOil: string | null;
  steeringFilter: string | null;
  beltMotor: string | null;
  beltAlt: string | null;
  hasArla: boolean;
  hasAC: boolean;
  gearbox: string;
}

interface TaskJson {
  pkg?: string;
  code: string;
  section: string;
  specialty: string;
  minutes: number;
  description: string;
  equipmentCondition?: string;
  onlyIf?: string;
}

interface PlansJson {
  dieselModels: DieselModel[];
  dieselPlan: {
    codePrefix: string;
    controlledDocument: string;
    toleranceKm: number;
    toleranceBelowKm: number;
    packages: { code: string; name: string; intervalKm: number; offsetKm: number; includes: string[] }[];
    tasks: TaskJson[];
    kits: Record<string, [string, number | string][]>;
  };
  ebusPlans: {
    code: string;
    name: string;
    manufacturer: string;
    vehicleModel: string;
    controlledDocument: string;
    toleranceKm: number;
    toleranceBelowKm: number;
    packages: { code: string; name: string; intervalKm: number; offsetKm: number; periodDays?: number; tasks: TaskJson[]; kit: [string, number][] }[];
  }[];
}

const ELECTRIC = new Set(['EPADRON_13M', 'EPADRON_15M', 'EARTICULADO_23M']);

/** Código curto do modelo para compor códigos de plano e kit (máx. 24 chars). */
export const modelCode = (model: string): string => model.toUpperCase().replace(/[^A-Z0-9]/g, '');

function unitFor(m: MaterialJson): string {
  const d = m.description.toUpperCase();
  if (/^(FILTRO|BOMBA|SENSOR|VALVULA|RESERV|TAMPA|BUJAO|JUNTA|MANG)/.test(d)) return 'un';
  if (m.classCode?.startsWith('0302') || /OLEO|ADITIVO|LIQUIDO|FLUIDO|DILUENTE|DESENGRAX/.test(d)) return 'L';
  if (/GRAXA|MASSA|COLA|TINTA|PRIMER/.test(d)) return 'kg';
  if (/\bM\b|METRO|MANG |CABO |FITA/.test(d) && !/MANG FILTRO/.test(d)) return 'm';
  return 'un';
}

export async function importBases(prisma: PrismaClient): Promise<void> {
  // ---- Materiais ------------------------------------------------------------
  const materials = readJson<MaterialJson[]>('materiais.json');
  const CHUNK = 150;
  for (let i = 0; i < materials.length; i += CHUNK) {
    const slice = materials.slice(i, i + CHUNK);
    await prisma.$transaction(
      slice.map((m) => {
        const data = {
          description: m.description.slice(0, 255),
          unit: unitFor(m),
          // Recondicionados (classe 2001xx) circulam no pool rotativo por número de série (RF-26).
          isSerialized: Boolean(m.classCode?.startsWith('2001')),
          manufacturerRef: m.manufacturerRef?.slice(0, 80) ?? null,
          location: m.location?.slice(0, 24) ?? null,
          abcClass: m.abcClass && /^[ABC]$/.test(m.abcClass) ? m.abcClass : null,
          classCode: m.classCode?.slice(0, 8) ?? null,
          stockQty: m.stockQty ?? 0,
          avgCost: m.avgCost,
          isPreventive: m.isPreventive,
        };
        return prisma.material.upsert({ where: { code: m.code }, update: data, create: { code: m.code, ...data } });
      }),
    );
  }
  console.log(`  ${materials.length} materiais (${materials.filter((m) => m.isPreventive).length} da lista preventiva)`);

  // ---- Kanban (A3): ponto de pedido e lote — ASSUMIDOS a partir do saldo até Suprimentos definir ----
  // Entram no kanban os itens da lista preventiva e os de classe A. Uma parte nasce abaixo do ponto
  // para a lista de reposição ter o que mostrar; o restante fica com ponto em ~45% do saldo atual.
  const kanbanTargets = await prisma.material.findMany({ where: { OR: [{ isPreventive: true }, { abcClass: 'A' }], reorderPoint: null, stockQty: { gt: 0 } }, select: { id: true, code: true, stockQty: true } });
  let kanbanBelow = 0;
  for (const m of kanbanTargets) {
    const qty = Number(m.stockQty);
    const h = [...m.code].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 100;
    // Saldo pequeno: repõe quando zerar. Saldo maior: ponto em ~45% do saldo; 10% nascem abaixo do ponto.
    const point = qty < 4 ? 0 : h < 10 ? Math.ceil(qty * 1.2) : Math.floor(qty * 0.45);
    if (point >= qty) kanbanBelow += 1;
    await prisma.material.update({ where: { id: m.id }, data: { reorderPoint: point, reorderQty: Math.max(2, Math.ceil(point * 1.5)) } });
  }
  console.log(`  ${kanbanTargets.length} materiais com ponto de pedido (kanban) · ${kanbanBelow} abaixo do ponto`);

  // ---- Modelos de chassi (arquivo "1-MODELO DO CHASSI" enviado pela Transppass em 28/10/2026) ----
  const chassis = readJson<{ code: string; description: string; manufacturer: string; model: string; vehicleClass: string; rawClass: string; hasAc: boolean; isElectric: boolean }[]>('chassis.json');
  for (const c of chassis) {
    const data = { description: c.description, manufacturer: c.manufacturer, model: c.model, vehicleClass: c.vehicleClass, rawClass: c.rawClass, hasAc: c.hasAc, isElectric: c.isElectric };
    await prisma.chassisModel.upsert({ where: { code: c.code }, update: data, create: { code: c.code, ...data } });
  }
  console.log(`  ${chassis.length} modelos de chassi (tabela da Transppass)`);

  // ---- Operadores -----------------------------------------------------------
  const operators = readJson<OperatorJson[]>('operadores.json');
  for (let i = 0; i < operators.length; i += CHUNK) {
    const slice = operators.slice(i, i + CHUNK);
    await prisma.$transaction(
      slice.map((o) => {
        const data = {
          name: o.name.slice(0, 120),
          function: o.function,
          cnhCategory: o.cnhCategory,
          lot: o.lot,
          admittedAt: o.admittedAt ? new Date(o.admittedAt) : null,
          vehicleClasses: o.vehicleClasses,
          isActive: true,
        };
        return prisma.operator.upsert({ where: { registration: o.registration }, update: data, create: { registration: o.registration, ...data } });
      }),
    );
  }
  // Habilitação por tecnologia derivada das classes permitidas (RF-30 consome; não administra).
  const rows = await prisma.operator.findMany({ where: { function: 'MOTORISTA' }, select: { id: true, vehicleClasses: true } });
  const quals: { operatorId: string; technology: VehicleTechnology }[] = [];
  for (const r of rows) {
    if (r.vehicleClasses.some((c) => !ELECTRIC.has(c))) quals.push({ operatorId: r.id, technology: VehicleTechnology.DIESEL });
    if (r.vehicleClasses.some((c) => ELECTRIC.has(c))) quals.push({ operatorId: r.id, technology: VehicleTechnology.EBUS });
  }
  await prisma.operatorQualification.createMany({ data: quals, skipDuplicates: true });
  // Os quatro operadores de exemplo do seed inicial saem de cena.
  await prisma.operator.updateMany({ where: { registration: { in: ['30412', '30877', '31105', '29980'] } }, data: { isActive: false } });
  console.log(`  ${operators.length} operadores (${operators.filter((o) => o.function === 'MOTORISTA').length} motoristas, ${operators.filter((o) => o.function === 'COBRADOR').length} cobradores)`);

  // ---- Ferramentas (FR.168) -------------------------------------------------
  const tools = readJson<ToolJson[]>('ferramentas.json');
  for (const t of tools) {
    const needsCalibration = /TESTE|STAR DIAGNOSIS|TORQU/i.test(t.description);
    await prisma.tool.upsert({
      where: { code: t.code },
      update: { description: t.description, requiredQty: t.requiredQty, availableQty: t.requiredQty },
      create: {
        code: t.code,
        description: t.description,
        requiredQty: t.requiredQty,
        availableQty: t.requiredQty,
        calibrationDueAt: needsCalibration ? new Date(Date.now() + (90 + (t.code.charCodeAt(5) % 7) * 30) * 86_400_000) : null,
      },
    });
  }
  console.log(`  ${tools.length} ferramentas (${tools.reduce((s, t) => s + t.requiredQty, 0)} unidades necessárias)`);

  // ---- Carregadores eBUS como recurso (Fluxos p.8: carregamento de 2–3 h e liberação dos carregadores) ----
  // Quantidade ASSUMIDA: 101 eBUS em três ciclos de 2–3 h na madrugada pedem ~34 baias; duas estão fora.
  for (const c of [
    { code: 'CAR-EBUS', description: 'Carregadores eBUS — baias de recarga (ciclo 2–3 h)', requiredQty: 34, availableQty: 32 },
    { code: 'CAR-MOVEL', description: 'Carregador móvel eBUS (socorro no pátio)', requiredQty: 2, availableQty: 2 },
  ]) {
    await prisma.tool.upsert({ where: { code: c.code }, update: c, create: c });
  }
  console.log('  2 recursos de recarga eBUS (carregadores) no ferramental');

  // ---- Planos preventivos ---------------------------------------------------
  const plans = readJson<PlansJson>('planos.json');
  const specialties = Object.fromEntries((await prisma.specialty.findMany()).map((s) => [s.code, s.id])) as Record<string, string>;
  const materialIdByCode = new Map((await prisma.material.findMany({ select: { id: true, code: true } })).map((m) => [m.code, m.id]));

  const effectiveFrom = new Date('2026-01-01');

  async function upsertPlan(input: {
    code: string;
    name: string;
    technology: VehicleTechnology;
    manufacturer: string;
    vehicleModel: string;
    controlledDocument: string;
  }) {
    return prisma.maintenancePlan.upsert({
      where: { code_version: { code: input.code, version: 1 } },
      update: { name: input.name, manufacturer: input.manufacturer, vehicleModel: input.vehicleModel, controlledDocument: input.controlledDocument, isActive: true },
      create: { ...input, version: 1, effectiveFrom },
    });
  }

  async function upsertPackage(planId: string, pkg: { code: string; name: string; intervalKm: number; offsetKm: number; periodDays?: number | null; toleranceKm: number; toleranceBelowKm: number }, tasks: TaskJson[], kit: [string, number][], kitCode: string) {
    const row = await prisma.maintenancePackage.upsert({
      where: { planId_code: { planId, code: pkg.code } },
      update: { name: pkg.name, intervalKm: pkg.intervalKm, offsetKm: pkg.offsetKm, periodDays: pkg.periodDays ?? null, toleranceKm: pkg.toleranceKm, toleranceBelowKm: pkg.toleranceBelowKm },
      create: { planId, code: pkg.code, name: pkg.name, intervalKm: pkg.intervalKm, offsetKm: pkg.offsetKm, periodDays: pkg.periodDays ?? null, toleranceKm: pkg.toleranceKm, toleranceBelowKm: pkg.toleranceBelowKm },
    });
    for (const t of tasks) {
      const data = { description: t.description, specialtyId: specialties[t.specialty] ?? null, estimatedMinutes: t.minutes, section: t.section, equipmentCondition: t.equipmentCondition ?? null };
      await prisma.maintenanceTask.upsert({ where: { packageId_code: { packageId: row.id, code: t.code } }, update: data, create: { packageId: row.id, code: t.code, ...data } });
    }
    const items = kit
      .map(([code, qty]) => ({ materialId: materialIdByCode.get(code), quantity: qty }))
      .filter((i): i is { materialId: string; quantity: number } => Boolean(i.materialId) && i.quantity > 0);
    if (items.length) {
      const kitRow = await prisma.kit.upsert({
        where: { code_version: { code: kitCode, version: 1 } },
        update: { name: `Kit ${pkg.name}`, packageId: row.id, isActive: true },
        create: { code: kitCode, name: `Kit ${pkg.name}`, packageId: row.id, version: 1, effectiveFrom },
      });
      for (const it of items) {
        await prisma.kitItem.upsert({ where: { kitId_materialId: { kitId: kitRow.id, materialId: it.materialId } }, update: { quantity: it.quantity }, create: { kitId: kitRow.id, materialId: it.materialId, quantity: it.quantity } });
      }
    }
    return row;
  }

  // Diesel: um plano por modelo, a partir do gabarito do IT.MAN-01.
  const d = plans.dieselPlan;
  const tasksByPkg = (code: string) => d.tasks.filter((t) => t.pkg === code);
  for (const m of plans.dieselModels) {
    const mc = modelCode(m.model);
    const plan = await upsertPlan({
      code: `ITMAN01-${mc}`.slice(0, 24),
      name: `Preventiva diesel — ${m.model}`,
      technology: VehicleTechnology.DIESEL,
      manufacturer: m.manufacturer,
      vehicleModel: m.model,
      controlledDocument: d.controlledDocument,
    });
    const applies = (t: TaskJson): boolean => {
      switch (t.onlyIf) {
        case undefined: return true;
        case 'hasArla': return m.hasArla;
        case 'hasAC': return m.hasAC;
        case 'airFilterSecondary': return Boolean(m.airFilterSecondary);
        case 'manual': return /manual/i.test(m.gearbox);
        case 'automatic': return /autom/i.test(m.gearbox);
        case 'catracas': return /1721|18\.280/.test(m.model);
        default: return true;
      }
    };
    const resolveKit = (code: string): [string, number][] =>
      (d.kits[code] ?? []).flatMap(([key, qty]) => {
        const materialCode = key in m ? (m[key as keyof DieselModel] as string | null) : key;
        if (!materialCode) return [];
        const quantity = typeof qty === 'number' ? qty : Number(m[qty as keyof DieselModel]);
        return [[materialCode, quantity]];
      });
    for (const pkg of d.packages) {
      // A revisão maior inclui tudo o que a menor faria (A = I + A; E = tudo).
      const codes = [...pkg.includes, pkg.code];
      const tasks = codes.flatMap(tasksByPkg).filter(applies);
      const kit = codes.flatMap(resolveKit);
      await upsertPackage(plan.id, { ...pkg, toleranceKm: d.toleranceKm, toleranceBelowKm: d.toleranceBelowKm }, tasks, kit, `KIT-${mc}-${pkg.code}`.slice(0, 24));
    }
  }
  console.log(`  ${plans.dieselModels.length} planos diesel (IT.MAN-01) com ${d.packages.length} pacotes cada`);

  for (const p of plans.ebusPlans) {
    const plan = await upsertPlan({
      code: p.code.replace('.', ''),
      name: p.name,
      technology: VehicleTechnology.EBUS,
      manufacturer: p.manufacturer,
      vehicleModel: p.vehicleModel,
      controlledDocument: p.controlledDocument,
    });
    for (const pkg of p.packages) {
      await upsertPackage(plan.id, { ...pkg, toleranceKm: p.toleranceKm, toleranceBelowKm: p.toleranceBelowKm }, pkg.tasks, pkg.kit, `KIT-${modelCode(p.vehicleModel)}-${pkg.code}`.slice(0, 24));
    }
  }
  console.log(`  ${plans.ebusPlans.length} planos eBUS (IT.MAN-54, -60, -16)`);

  // Os planos genéricos de exemplo do R0 saem de cena: os reais são por modelo.
  await prisma.maintenancePlan.updateMany({ where: { code: { in: ['PLAN-DIESEL', 'PLAN-EBUS'] } }, data: { isActive: false } });

  // ---- Kaizen 3: ferramental por tarefa (FR.168 × IT.MAN-01) ------------------
  // A lista por tarefa é do item 3 do Kaizen (Danilo). Até ela chegar, o cruzamento
  // abaixo é o óbvio da oficina: o que cada tarefa do diesel não faz sem.
  const TASK_TOOLS: Record<string, string[]> = {
    I01: ['FER-020', 'FER-012'], // óleo e filtro: cinta de sacar filtro, chave de grifo
    I03: ['FER-047'], // arrefecimento: teste de radiador
    I06: ['FER-014', 'FER-037'], // torque das porcas de roda: impacto 3/4 e soquete 33
    I09: ['FER-045'], // baterias: teste de bateria
    A07: ['FER-043'], // sistema de carga: Star Diagnosis
    B04: ['FER-009', 'FER-014'], // cubos: chave de cubo dianteira
    C03: ['FER-046'], // intercooler: teste de intercooler
  };
  const toolIdByCode = new Map((await prisma.tool.findMany({ select: { id: true, code: true } })).map((t) => [t.code, t.id]));
  const dieselTasks = await prisma.maintenanceTask.findMany({ where: { package: { plan: { technology: VehicleTechnology.DIESEL, isActive: true } } }, select: { id: true, code: true } });
  let taskToolLinks = 0;
  for (const t of dieselTasks) {
    for (const code of TASK_TOOLS[t.code] ?? []) {
      const toolId = toolIdByCode.get(code);
      if (!toolId) continue;
      await prisma.maintenanceTaskTool.upsert({ where: { taskId_toolId: { taskId: t.id, toolId } }, update: {}, create: { taskId: t.id, toolId, quantity: 1 } });
      taskToolLinks += 1;
    }
  }
  console.log(`  ${taskToolLinks} vínculos tarefa × ferramenta (Kaizen 3)`);

  // ---- Kaizen 2: kits corretivos por falha do catálogo ----------------------------
  // Cruzamento das seis falhas do catálogo inicial com o inventário real.
  const CORRECTIVE_KITS: Record<string, [string, number][]> = {
    'ELE-ALT-01': [['102000', 1], ['002495', 1], ['006454', 1]],
    'PNE-APU-01': [['008916', 1], ['008627', 1]],
    'PNE-CUI-01': [['008450', 1]],
    'MEC-MOT-01': [['102014', 1], ['006454', 1], ['000910', 4]],
    'AC-CLI-01': [['122599', 1], ['100592', 1], ['122330', 1]],
    'CAR-POR-01': [['140266', 1]],
  };
  const catalogItems = await prisma.failureCatalogItem.findMany({ where: { isActive: true } });
  let correctiveKits = 0;
  for (const item of catalogItems) {
    const spec = CORRECTIVE_KITS[item.code];
    if (!spec) continue;
    const existing = await prisma.kit.findFirst({ where: { catalogItemId: item.id, isActive: true } });
    if (existing) continue;
    const items = spec.map(([code, qty]) => ({ materialId: materialIdByCode.get(code), quantity: qty })).filter((i): i is { materialId: string; quantity: number } => Boolean(i.materialId));
    if (!items.length) continue;
    await prisma.kit.create({
      data: { code: `KIT-${item.code}`.slice(0, 24), name: `Kit corretivo — ${item.description}`, catalogItemId: item.id, version: 1, effectiveFrom, items: { create: items } },
    });
    correctiveKits += 1;
  }
  console.log(`  ${correctiveKits} kits corretivos (Kaizen 2)`);

  // ---- Kaizen 15–17: técnicos e inspetores — MOCK até a lista da Manutenção chegar ----
  const TECHNICIANS: { registration: string; name: string; specialty: string; technologies: VehicleTechnology[]; level: number; isInspector: boolean }[] = [
    { registration: '70012', name: 'Carlos Henrique de Souza', specialty: 'MEC', technologies: ['DIESEL'], level: 3, isInspector: true },
    { registration: '70034', name: 'Edson Luiz Ferreira', specialty: 'MEC', technologies: ['DIESEL'], level: 3, isInspector: false },
    { registration: '70051', name: 'Marcos Vinícius Pereira', specialty: 'MEC', technologies: ['DIESEL', 'EBUS'], level: 2, isInspector: false },
    { registration: '70077', name: 'Anderson Ribeiro da Silva', specialty: 'MEC', technologies: ['DIESEL'], level: 2, isInspector: false },
    { registration: '70088', name: 'Jonas Alves Moreira', specialty: 'MEC', technologies: ['DIESEL'], level: 1, isInspector: false },
    { registration: '70093', name: 'Rafael Augusto Lima', specialty: 'MEC', technologies: ['DIESEL', 'EBUS'], level: 1, isInspector: false },
    { registration: '70104', name: 'Wellington Santos Costa', specialty: 'MEC', technologies: ['DIESEL'], level: 2, isInspector: false },
    { registration: '70120', name: 'Luiz Fernando Barbosa', specialty: 'ELE', technologies: ['DIESEL', 'EBUS'], level: 3, isInspector: true },
    { registration: '70131', name: 'Thiago Martins Rocha', specialty: 'ELE', technologies: ['DIESEL', 'EBUS'], level: 2, isInspector: false },
    { registration: '70145', name: 'Bruno César Oliveira', specialty: 'ELE', technologies: ['EBUS'], level: 2, isInspector: false },
    { registration: '70158', name: 'Diego Nascimento Araújo', specialty: 'ELE', technologies: ['DIESEL'], level: 1, isInspector: false },
    { registration: '70166', name: 'Sérgio Ricardo Gomes', specialty: 'FUN', technologies: ['DIESEL', 'EBUS'], level: 3, isInspector: false },
    { registration: '70172', name: 'Paulo Roberto Dias', specialty: 'FUN', technologies: ['DIESEL', 'EBUS'], level: 1, isInspector: false },
    { registration: '70180', name: 'Rogério Mendes Carvalho', specialty: 'PNE', technologies: ['DIESEL', 'EBUS'], level: 3, isInspector: true },
    { registration: '70191', name: 'Fábio Henrique Teixeira', specialty: 'PNE', technologies: ['DIESEL', 'EBUS'], level: 2, isInspector: false },
    { registration: '70205', name: 'André Luís Cardoso', specialty: 'AC', technologies: ['DIESEL', 'EBUS'], level: 2, isInspector: false },
  ];
  for (const t of TECHNICIANS) {
    const specialtyId = specialties[t.specialty];
    if (!specialtyId) continue;
    await prisma.technician.upsert({
      where: { registration: t.registration },
      update: { name: t.name, specialtyId, technologies: t.technologies, level: t.level, isInspector: t.isInspector },
      create: { registration: t.registration, name: t.name, specialtyId, technologies: t.technologies, level: t.level, isInspector: t.isInspector },
    });
  }
  console.log(`  ${TECHNICIANS.length} técnicos (mock — Kaizen 15–17)`);

  // ---- Fornecedores: lidos da referência do fabricante no inventário ---------------
  // O inventário traz a referência (ex.: "WK-1060/4", "GARDINOTEC 553D"); a marca
  // identificável vira fornecedor e a peça fica vinculada. O SLA de garantia e o
  // contato são ASSUMIDOS até Suprimentos cadastrar.
  const SUPPLIERS: { name: string; match: RegExp; claimSlaDays: number }[] = [
    { name: 'Mann Filter', match: /WK-|\bHU ?\d|\bC ?\d{4,5}\b|MANN/i, claimSlaDays: 15 },
    { name: 'Gardinotec', match: /GARDINOTEC/i, claimSlaDays: 30 },
    { name: 'Cofap', match: /COFAP/i, claimSlaDays: 30 },
    { name: 'Sabó', match: /\bSABO\b/i, claimSlaDays: 30 },
    { name: 'SKF', match: /\bSKF\b/i, claimSlaDays: 30 },
    { name: 'WEG', match: /\bWEG\b/i, claimSlaDays: 20 },
    { name: 'Bitzer', match: /BITZER/i, claimSlaDays: 30 },
    { name: 'Voith', match: /VOITH|DIWA/i, claimSlaDays: 30 },
    { name: 'ZF', match: /\bZF\b|ECOLIFE/i, claimSlaDays: 30 },
    { name: 'Shell', match: /RIMULA|SPIRAX|GADUS|TELLUS/i, claimSlaDays: 15 },
    { name: 'Lubrax (Petrobras)', match: /LUBRAX/i, claimSlaDays: 15 },
    { name: 'Michelin', match: /MICHELIN/i, claimSlaDays: 45 },
    { name: '3M', match: /\b3M\b/i, claimSlaDays: 15 },
    { name: 'KGM', match: /\bKGM\b/i, claimSlaDays: 30 },
    { name: 'Farj', match: /\bFARJ\b/i, claimSlaDays: 30 },
    { name: 'Haldex', match: /HALDEX/i, claimSlaDays: 30 },
    { name: 'Eberspächer', match: /EBERSPACHER|EBERSP/i, claimSlaDays: 30 },
    { name: 'Mercedes-Benz (peças genuínas)', match: /\bMBB\b|^[A0]\d{9,}$|^\d{10}$/i, claimSlaDays: 30 },
    { name: 'Volkswagen (peças genuínas)', match: /^\d{2}[A-Z]\d{6}[A-Z]?$|VW|VOLKS/i, claimSlaDays: 30 },
  ];
  const supplierIds = new Map<string, string>();
  for (const sp of SUPPLIERS) {
    const row = await prisma.supplier.upsert({ where: { name: sp.name }, update: { claimSlaDays: sp.claimSlaDays }, create: { name: sp.name, claimSlaDays: sp.claimSlaDays } });
    supplierIds.set(sp.name, row.id);
  }
  const unassigned = await prisma.material.findMany({ where: { supplierId: null, manufacturerRef: { not: null } }, select: { id: true, manufacturerRef: true, description: true } });
  let linked = 0;
  for (const m of unassigned) {
    const hay = `${m.manufacturerRef ?? ''} ${m.description}`;
    const sp = SUPPLIERS.find((x) => x.match.test(m.manufacturerRef ?? '')) ?? SUPPLIERS.find((x) => x.match.test(hay) && !/Mercedes|Volkswagen/.test(x.name));
    if (!sp) continue;
    await prisma.material.update({ where: { id: m.id }, data: { supplierId: supplierIds.get(sp.name) } });
    linked += 1;
  }
  console.log(`  ${SUPPLIERS.length} fornecedores (da referência do inventário) · ${linked} materiais vinculados`);

  // ---- Matriz de treinamentos — MOCK até a Manutenção enviar (Kaizen, capacitação) ----
  const techs = await prisma.technician.findMany({ where: { isActive: true } });
  let trainings = 0;
  for (const t of techs) {
    const has = await prisma.technicianTraining.count({ where: { technicianId: t.id } });
    if (has) continue;
    const base = new Date('2026-03-10');
    await prisma.technicianTraining.create({ data: { technicianId: t.id, kind: 'PLANO_MANUTENCAO', title: 'Plano de manutenção IT.MAN-01 Rev.09', completedAt: base, hours: 8 } });
    trainings += 1;
    if (t.technologies.includes(VehicleTechnology.EBUS) && t.registration !== '70093') {
      await prisma.technicianTraining.create({ data: { technicianId: t.id, kind: 'ALTA_TENSAO', title: 'NR-10 + alta tensão eBUS (Scania/VW)', completedAt: new Date('2026-01-20'), validUntil: new Date('2028-01-20'), hours: 40 } });
      trainings += 1;
    }
  }
  console.log(`  ${trainings} treinamentos (mock) — 70093 propositalmente sem alta tensão`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  importBases(prisma)
    .then(() => console.log('Carga das bases concluída.'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
