import {
  BacklogSource,
  CleaningStatus,
  DowntimeCause,
  EventOrigin,
  EventStatus,
  FieldOutcome,
  InspectionResult,
  KitSeparationStatus,
  KmSource,
  MaterialRequestStatus,
  PoolComponentStatus,
  PrismaClient,
  QueueStatus,
  ReasonCodeList,
  ReplacementDemandStatus,
  ScheduleStatus,
  TaskStatus,
  TriageDestination,
  UserRole,
  VehicleStatus,
  VehicleTechnology,
  WorkOrderStatus,
  WorkOrderType,
} from '@prisma/client';

/**
 * Seed de DEMONSTRAÇÃO — a garagem da Transppass inteira, em movimento.
 *
 * Roda depois do seed base (`npm run db:seed`, que já carrega materiais,
 * operadores, ferramentas e planos reais) e escreve direto nas tabelas:
 *
 *  - a frota patrimonial da Escala de Carros: 453 carros em duas garagens
 *    (lote E8 com 238, lote AR9 com 215), por classe e papel (operacional ou
 *    reserva). A base carro a carro (prefixo, placa, chassi) ainda não veio —
 *    prefixos, placas, modelos por classe e ano são MOCK, marcados como tal.
 *  - seis meses de leituras de km e de eventos (MKBF, eventos por dia,
 *    disponibilidade por hora), OS abertas em cada etapa do fluxo, fila com
 *    histórico, materiais aguardando peça, preventivas com kit real e equipe,
 *    plantão com janela correndo, notificações.
 *
 * É idempotente do jeito bruto: apaga TODO o movimento e a frota e recria.
 * Cadastros (usuários, catálogo, materiais, operadores, planos) ficam.
 * Nunca rode em produção com dados reais.
 */

const prisma = new PrismaClient();

const H = 3_600_000;
const D = 24 * H;
const NOW = Date.now();
const ago = (hours: number) => new Date(NOW - hours * H);
const inHours = (hours: number) => new Date(NOW + hours * H);
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Pseudoaleatório determinístico: a mesma garagem a cada execução. */
function rnd(...seeds: (number | string)[]): number {
  let h = 2166136261;
  for (const s of seeds) {
    for (const ch of String(s)) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
  }
  return ((h >>> 0) % 10_000) / 10_000;
}
const pick = <T,>(arr: readonly T[], ...seeds: (number | string)[]): T => arr[Math.floor(rnd(...seeds) * arr.length)]!;

const LINES = ['8012', '2290', '3720', '875A-10', '6262', '4111', '8622', '9784', '7021', '8555'] as const;

// ---- A frota da Escala de Carros ---------------------------------------------

type VehicleClass = 'BASICO_12M' | 'PADRON_13M' | 'EPADRON_13M' | 'EPADRON_15M' | 'ARTICULADO_18M' | 'ARTICULADO_23M' | 'EARTICULADO_23M';
const CLASS_DIGIT: Record<VehicleClass, string> = { BASICO_12M: '1', PADRON_13M: '2', EPADRON_13M: '3', EPADRON_15M: '4', ARTICULADO_18M: '5', ARTICULADO_23M: '6', EARTICULADO_23M: '7' };
const ELECTRIC: VehicleClass[] = ['EPADRON_13M', 'EPADRON_15M', 'EARTICULADO_23M'];

/**
 * Patrimonial por lote, [operacional, reserva], como na Escala (07 - Operação):
 * E8 = 238 carros, AR9 = 215, total 453. A planilha repete a linha "ePadron 15M"
 * com os mesmos números da "ePadron 13M" (erro de cópia); os 71 + 30 ePadron
 * foram divididos meio a meio entre as duas classes — ASSUMIDO até a base
 * carro a carro chegar.
 */
const ESCALA: Record<'E8' | 'AR9', Record<VehicleClass, [number, number]>> = {
  E8: { BASICO_12M: [4, 1], PADRON_13M: [115, 12], EPADRON_13M: [34, 2], EPADRON_15M: [34, 1], ARTICULADO_18M: [2, 0], ARTICULADO_23M: [19, 7], EARTICULADO_23M: [7, 0] },
  AR9: { BASICO_12M: [70, 17], PADRON_13M: [86, 4], EPADRON_13M: [14, 1], EPADRON_15M: [14, 1], ARTICULADO_18M: [0, 0], ARTICULADO_23M: [8, 0], EARTICULADO_23M: [0, 0] },
};

/** Modelo por classe — MOCK até a base carro a carro chegar; os nomes batem com os planos IT.MAN. */
const MODELS: Record<VehicleClass, { manufacturer: string; model: string; share: number; years: [number, number] }[]> = {
  BASICO_12M: [
    { manufacturer: 'Mercedes-Benz', model: 'OF 1721/E5', share: 0.7, years: [2016, 2021] },
    { manufacturer: 'Volkswagen', model: 'VW 18.280', share: 0.3, years: [2017, 2020] },
  ],
  PADRON_13M: [
    { manufacturer: 'Mercedes-Benz', model: 'O500U/E5 AC', share: 0.6, years: [2018, 2023] },
    { manufacturer: 'Mercedes-Benz', model: 'O500U/E3', share: 0.4, years: [2015, 2018] },
  ],
  EPADRON_13M: [{ manufacturer: 'Volkswagen', model: 'VW e-Volksbus', share: 1, years: [2024, 2025] }],
  EPADRON_15M: [{ manufacturer: 'Scania', model: 'Scania eBUS', share: 1, years: [2024, 2025] }],
  ARTICULADO_18M: [{ manufacturer: 'Mercedes-Benz', model: 'O500UA', share: 1, years: [2017, 2019] }],
  ARTICULADO_23M: [
    { manufacturer: 'Mercedes-Benz', model: 'O500UDA', share: 0.6, years: [2018, 2022] },
    { manufacturer: 'Mercedes-Benz', model: 'O500UDA/AR', share: 0.4, years: [2020, 2023] },
  ],
  EARTICULADO_23M: [{ manufacturer: 'Eletra', model: 'Eletra e-Bus', share: 1, years: [2023, 2024] }],
};

interface VehicleSpec {
  code: string;
  plate: string;
  technology: VehicleTechnology;
  kmSource: KmSource;
  manufacturer: string;
  model: string;
  modelYear: number;
  odometerOffset: number;
  vehicleClass: VehicleClass;
  lot: 'E8' | 'AR9';
  fleetRole: 'OPERACIONAL' | 'RESERVA';
  status: VehicleStatus;
  currentKm: number;
  avgDailyKm: number;
  /** Dias sem leitura (projeção degradada acima de 2). */
  staleDays: number;
}

function buildFleet(): VehicleSpec[] {
  const out: VehicleSpec[] = [];
  const letters = 'BCDFGHJKLMNPQRSTVWXZ';
  // Placa Mercosul (LLL D L DD): as letras vêm do hash, os dígitos do índice — nunca repete.
  let idx = 0;
  for (const lot of ['E8', 'AR9'] as const) {
    for (const cls of Object.keys(ESCALA[lot]) as VehicleClass[]) {
      const [op, res] = ESCALA[lot][cls];
      let seq = 0;
      const electric = ELECTRIC.includes(cls);
      for (const role of ['OPERACIONAL', 'RESERVA'] as const) {
        const n = role === 'OPERACIONAL' ? op : res;
        for (let i = 0; i < n; i += 1) {
          seq += 1;
          const code = `${lot === 'E8' ? '8' : '9'}${CLASS_DIGIT[cls]}${String(seq).padStart(3, '0')}`;
          const r = rnd(code, 'model');
          let acc = 0;
          const spec = MODELS[cls].find((m) => (acc += m.share) >= r) ?? MODELS[cls][0]!;
          const year = spec.years[0] + Math.floor(rnd(code, 'year') * (spec.years[1] - spec.years[0] + 1));
          const yearsInService = Math.max(0.6, 2026.8 - year);
          const base = electric ? 150 + rnd(code, 'avg') * 50 : 185 + rnd(code, 'avg') * 55;
          const avgDailyKm = Math.round((role === 'RESERVA' ? base * 0.5 : base) * 10) / 10;
          const currentKm = Math.round(yearsInService * avgDailyKm * 330 * (0.85 + rnd(code, 'km') * 0.3));
          idx += 1;
          const plate = `${letters[Math.floor(rnd(code, 'p1') * 20)]}${letters[Math.floor(rnd(code, 'p2') * 20)]}${letters[Math.floor(rnd(code, 'p3') * 20)]}${Math.floor(idx / 100) % 10}${letters[Math.floor(rnd(code, 'p5') * 20)]}${String(idx % 100).padStart(2, '0')}`;
          const stale = !electric && rnd(code, 'stale') < 0.06 ? 3 + Math.floor(rnd(code, 'stale-d') * 4) : 0;
          out.push({
            code,
            plate,
            technology: electric ? VehicleTechnology.EBUS : VehicleTechnology.DIESEL,
            kmSource: electric ? KmSource.TELEMETRY : KmSource.MANUAL,
            manufacturer: spec.manufacturer,
            model: spec.model,
            modelYear: year,
            odometerOffset: rnd(code, 'offset') < 0.05 ? Math.round(rnd(code, 'offset-v') * 40_000) : 0,
            vehicleClass: cls,
            lot,
            fleetRole: role,
            status: role === 'OPERACIONAL' ? VehicleStatus.IN_LINE : VehicleStatus.AVAILABLE,
            currentKm,
            avgDailyKm,
            staleDays: stale,
          });
        }
      }
    }
  }
  return out;
}

async function main() {
  console.log('Seed de demonstração — apagando o movimento anterior…');

  // ---- Referências do seed base ------------------------------------------
  const users = await prisma.user.findMany();
  const byRole = (role: UserRole) => {
    const u = users.find((x) => x.role === role) ?? users.find((x) => x.role === UserRole.ADMIN);
    if (!u) throw new Error('Rode `npm run db:seed` antes do seed de demonstração');
    return u;
  };
  const admin = byRole(UserRole.ADMIN);
  const cco = byRole(UserRole.CCO);
  const pcm = byRole(UserRole.PCM);
  const manut = byRole(UserRole.MANUTENCAO);
  const estoque = byRole(UserRole.ESTOQUE);

  const specialties = await prisma.specialty.findMany();
  const spec = (code: string) => {
    const s = specialties.find((x) => x.code === code) ?? specialties[0];
    if (!s) throw new Error('Seed base sem especialidades');
    return s;
  };

  const catalog = await prisma.failureCatalogItem.findMany({ where: { isActive: true } });
  const cat = (code: string) => {
    const c = catalog.find((x) => x.code === code);
    if (!c) throw new Error(`Catálogo sem ${code}`);
    return c;
  };
  const SPECIALTY_BY_SYSTEM: Record<string, string> = { Elétrica: 'ELE', Pneumático: 'MEC', Motor: 'MEC', Conforto: 'AC', Carroceria: 'FUN' };

  const reasons = await prisma.reasonCode.findMany();
  const reason = (list: ReasonCodeList, code: string) => {
    const r = reasons.find((x) => x.list === list && x.code === code);
    if (!r) throw new Error(`Motivo ${list}/${code} não existe`);
    return r;
  };

  const materials = await prisma.material.findMany({ where: { isActive: true } });
  const matLike = (term: string) => materials.find((m) => m.description.includes(term)) ?? materials[0]!;

  const plans = await prisma.maintenancePlan.findMany({ where: { isActive: true }, include: { packages: { include: { tasks: true, kits: { where: { isActive: true } } } } } });
  const modelKey = (m: string | null | undefined) => (m ?? '').toUpperCase().replace(/\b(E3|E5|AC|AR|OT|LE|VW|MB)\b/g, ' ').replace(/[^A-Z0-9]/g, '');
  const planFor = (model: string, technology?: VehicleTechnology, manufacturer?: string | null) => {
    const tech = technology ?? VehicleTechnology.DIESEL;
    const family = plans.filter((p) => p.technology === tech && p.vehicleModel && modelKey(p.vehicleModel) === modelKey(model));
    const wantsAc = /\bAC\b/i.test(model);
    const maker = (manufacturer ?? '').toUpperCase().replace(/[^A-Z]/g, '');
    return (wantsAc ? family.find((p) => /\bAC\b/i.test(p.vehicleModel ?? '')) : family.find((p) => !/\bAC\b/i.test(p.vehicleModel ?? ''))) ?? family[0] ?? (maker ? plans.find((p) => p.technology === tech && (p.manufacturer ?? '').toUpperCase().replace(/[^A-Z]/g, '') === maker) : undefined) ?? plans.find((p) => p.technology === tech && !p.vehicleModel);
  };

  const motoristas = await prisma.operator.findMany({ where: { isActive: true, function: 'MOTORISTA' }, orderBy: { registration: 'asc' } });
  const driverFor = (cls: VehicleClass, seed: string) => {
    const ok = motoristas.filter((o) => o.vehicleClasses.includes(cls));
    return pick(ok.length ? ok : motoristas, seed);
  };

  // ---- Limpeza do movimento anterior e da frota ----------------------------
  await prisma.notification.deleteMany();
  await prisma.partInspection.deleteMany();
  await prisma.dailyCheck.deleteMany();
  await prisma.processAudit.deleteMany();
  await prisma.vehicleComponent.deleteMany();
  await prisma.replacementDemand.deleteMany();
  await prisma.toolLoan.deleteMany();
  await prisma.poolMovement.deleteMany();
  await prisma.materialRequest.deleteMany();
  await prisma.queueEntry.deleteMany();
  await prisma.workOrder.deleteMany();
  await prisma.scheduledMaintenance.deleteMany();
  await prisma.vehicleBacklogItem.deleteMany();
  // Dados reais da Transppass (frota, km diário, ocorrências do CCO) ficam; só o movimento de demonstração sai.
  await prisma.failureEvent.deleteMany({ where: { isImported: false } });
  await prisma.odometerReading.deleteMany({ where: { isImported: false } });
  await prisma.kmProjection.deleteMany();
  await prisma.metricSnapshot.deleteMany();
  await prisma.poolComponent.updateMany({ data: { status: PoolComponentStatus.IN_STOCK, currentVehicleId: null } });
  const realFleet = await prisma.vehicle.findMany({ where: { isImported: true, isActive: true }, orderBy: { code: 'asc' } });
  const real = realFleet.length > 0;
  // Com frota real, só os carros de exemplo (não importados) saem; sem ela, a frota mock é refeita do zero.
  await prisma.vehicle.deleteMany({ where: real ? { isImported: false } : {} });

  // ---- Garagens e frota -------------------------------------------------------
  const garages = {
    E8: await prisma.garage.upsert({ where: { code: 'E8' }, update: { name: 'Garagem E8' }, create: { code: 'E8', name: 'Garagem E8' } }),
    AR9: await prisma.garage.upsert({ where: { code: 'AR9' }, update: { name: 'Garagem AR9' }, create: { code: 'AR9', name: 'Garagem AR9' } }),
  };

  // Com a frota real carregada, a demonstração roda nos carros de verdade: a média diária vem do km real
  // do último mês; reservas (~8% por classe) e dias sem leitura são ASSUMIDOS só para a demonstração.
  const realAvg = new Map<string, number>();
  if (real) {
    const imported = await prisma.odometerReading.findMany({ where: { isImported: true }, select: { vehicleId: true, readAt: true, deltaKm: true } });
    const lastAt = imported.reduce((m, r) => Math.max(m, r.readAt.getTime()), 0);
    for (const r of imported) {
      if (r.readAt.getTime() < lastAt - 30 * D) continue;
      realAvg.set(r.vehicleId, (realAvg.get(r.vehicleId) ?? 0) + (r.deltaKm ?? 0));
    }
  }
  const VEHICLES: VehicleSpec[] = real
    ? realFleet.map((v) => {
        const electric = v.technology === VehicleTechnology.EBUS;
        const cls = ((v.vehicleClass as VehicleClass | null) ?? (electric ? 'EPADRON_13M' : 'BASICO_12M')) as VehicleClass;
        const avg = realAvg.has(v.id) ? Math.round((realAvg.get(v.id)! / 30) * 10) / 10 : electric ? 180 : 200;
        const reserve = rnd(v.code, 'reserva') < 0.08;
        const stale = v.kmSource === KmSource.MANUAL && rnd(v.code, 'stale') < 0.3 ? 3 + Math.floor(rnd(v.code, 'stale-d') * 4) : 0;
        return {
          code: v.code, plate: v.plate, technology: v.technology, kmSource: v.kmSource, manufacturer: v.manufacturer ?? '', model: v.model ?? '', modelYear: v.modelYear ?? 2019,
          odometerOffset: v.odometerOffset, vehicleClass: cls, lot: (v.lot === 'AR9' ? 'AR9' : 'E8') as 'E8' | 'AR9', fleetRole: reserve ? 'RESERVA' : 'OPERACIONAL',
          status: reserve ? VehicleStatus.AVAILABLE : VehicleStatus.IN_LINE, currentKm: v.currentKm, avgDailyKm: reserve ? Math.round(avg * 0.5) : avg, staleDays: stale,
        };
      })
    : buildFleet();
  /** n-ésimo carro de uma classe num lote (0 = primeiro operacional); cai para a classe em qualquer lote, depois para qualquer carro. */
  const carOf = (lot: 'E8' | 'AR9', cls: VehicleClass, n: number) =>
    VEHICLES.filter((v) => v.lot === lot && v.vehicleClass === cls)[n] ?? VEHICLES.filter((v) => v.vehicleClass === cls)[n % Math.max(1, VEHICLES.filter((v) => v.vehicleClass === cls).length)] ?? VEHICLES[n % VEHICLES.length]!;

  // A garagem AGORA — quem está em cada etapa do fluxo (cenários para operar na mão).
  const S = {
    off: carOf('E8', 'EPADRON_15M', 5),
    cuica: carOf('E8', 'PADRON_13M', 7),
    insp: carOf('AR9', 'BASICO_12M', 3),
    clean: carOf('E8', 'EPADRON_13M', 4),
    apu: carOf('E8', 'PADRON_13M', 12),
    porta: carOf('AR9', 'EPADRON_13M', 2),
    alt: carOf('AR9', 'BASICO_12M', 9),
    ac: carOf('E8', 'PADRON_13M', 20),
    prev1: carOf('E8', 'PADRON_13M', 30),
    prev2: carOf('E8', 'EPADRON_15M', 9),
  };
  S.off.status = VehicleStatus.OUT_OF_SERVICE; S.off.avgDailyKm = 0; S.off.staleDays = 3;
  S.cuica.status = VehicleStatus.AWAITING_PART; S.cuica.staleDays = 5;
  S.insp.status = VehicleStatus.IN_INSPECTION;
  S.clean.status = VehicleStatus.IN_CLEANING;
  S.apu.status = VehicleStatus.IN_MAINTENANCE;
  S.porta.status = VehicleStatus.AWAITING_MAINTENANCE;
  S.alt.status = VehicleStatus.FIELD_SERVICE;
  S.ac.status = VehicleStatus.AWAITING_TRIAGE;

  // Mais carros na garagem, em etapas genéricas, para a oficina parecer uma oficina.
  type Stage = 'queue' | 'exec' | 'part' | 'inspection' | 'cleaning' | 'triage' | 'field';
  const generic: { v: VehicleSpec; stage: Stage; hours: number; code: string }[] = [];
  const stages: Stage[] = ['queue', 'queue', 'queue', 'queue', 'queue', 'exec', 'exec', 'exec', 'exec', 'exec', 'exec', 'exec', 'exec', 'part', 'part', 'part', 'inspection', 'inspection', 'cleaning', 'cleaning', 'triage', 'triage', 'field', 'field'];
  const taken = new Set(Object.values(S).map((v) => v.code));
  const operational = VEHICLES.filter((v) => v.fleetRole === 'OPERACIONAL' && !taken.has(v.code));
  for (const [i, stage] of stages.entries()) {
    const v = operational[Math.floor(rnd('generic', i) * operational.length)]!;
    if (taken.has(v.code)) continue;
    taken.add(v.code);
    v.status = { queue: VehicleStatus.AWAITING_MAINTENANCE, exec: VehicleStatus.IN_MAINTENANCE, part: VehicleStatus.AWAITING_PART, inspection: VehicleStatus.IN_INSPECTION, cleaning: VehicleStatus.IN_CLEANING, triage: VehicleStatus.AWAITING_TRIAGE, field: VehicleStatus.FIELD_SERVICE }[stage];
    generic.push({ v, stage, hours: { queue: 0.5 + rnd('gh', i) * 5, exec: 1 + rnd('gh', i) * 7, part: 10 + rnd('gh', i) * 40, inspection: 3 + rnd('gh', i) * 6, cleaning: 2 + rnd('gh', i) * 5, triage: rnd('gh', i) * 0.4, field: 0.3 + rnd('gh', i) * 1.2 }[stage], code: pick(['ELE-ALT-01', 'PNE-APU-01', 'MEC-MOT-01', 'AC-CLI-01', 'CAR-POR-01', 'PNE-CUI-01'], 'gc', i) });
  }

  const vehicleIds = new Map<string, string>();
  if (real) {
    // Frota real: só o estado de agora, o papel na escala e a última leitura mudam
    for (const v of VEHICLES) {
      await prisma.vehicle.update({ where: { code: v.code }, data: { status: v.status, fleetRole: v.fleetRole, lastReadingAt: ago(v.staleDays * 24 + 2) } });
    }
  } else {
    for (let i = 0; i < VEHICLES.length; i += 100) {
      const slice = VEHICLES.slice(i, i + 100);
      await prisma.vehicle.createMany({
        data: slice.map(({ avgDailyKm: _a, staleDays, lot, ...v }) => ({ ...v, lot, garageId: garages[lot].id, lastReadingAt: ago(staleDays * 24 + 2) })),
      });
    }
  }
  for (const row of await prisma.vehicle.findMany({ select: { id: true, code: true } })) vehicleIds.set(row.code, row.id);
  const vid = (code: string) => vehicleIds.get(code)!;
  console.log(`  ${VEHICLES.length} carros (E8 ${VEHICLES.filter((v) => v.lot === 'E8').length}, AR9 ${VEHICLES.filter((v) => v.lot === 'AR9').length}; ${VEHICLES.filter((v) => v.fleetRole === 'RESERVA').length} reservas)`);

  // ---- Seis meses de leituras de km (a base do MKBF e da projeção) --------
  const DAYS = 185;
  const readings: { vehicleId: string; rawKm: number; adjustedKm: number; deltaKm: number | null; readAt: Date; source: KmSource; enteredById: string }[] = [];
  // Leituras reais (quando existem) ancoram a série: a demonstração só preenche os dias sem dado.
  const realKm = new Map<string, Map<string, number>>();
  if (real) {
    for (const r of await prisma.odometerReading.findMany({ where: { isImported: true }, select: { vehicleId: true, readAt: true, adjustedKm: true } })) {
      const key = localDay(r.readAt);
      if (!realKm.has(r.vehicleId)) realKm.set(r.vehicleId, new Map());
      realKm.get(r.vehicleId)!.set(key, r.adjustedKm);
    }
  }
  for (const v of VEHICLES) {
    if (v.avgDailyKm === 0) continue;
    const mine = realKm.get(vid(v.code));
    const realDays = mine ? [...mine.keys()].sort() : [];
    const firstReal = realDays[0] ?? null;
    const lastReal = realDays[realDays.length - 1] ?? null;
    // km por dia (índice = dias atrás), já com os dias reais no lugar
    const series = new Map<number, number>();
    const dayKey = (day: number) => localDay(new Date(NOW - day * D));
    const weight = (day: number) => {
      const date = new Date(NOW - day * D);
      const weekend = date.getDay() === 0 || date.getDay() === 6;
      return (weekend ? 0.55 : 1) * (0.82 + 0.36 * rnd(v.code, day));
    };
    const synthetic: number[] = [];
    if (mine && firstReal && lastReal) {
      // Depois do último dia real: distribui o que falta até o km de hoje
      const after: number[] = [];
      for (let day = v.staleDays; day < DAYS; day += 1) {
        const k = dayKey(day);
        if (k > lastReal) after.push(day);
        else break;
      }
      const kmLast = mine.get(lastReal)!;
      const total = Math.max(0, v.currentKm - kmLast);
      const wsum = after.reduce((acc, d) => acc + weight(d), 0) || 1;
      let acc = 0;
      for (const day of after) {
        series.set(day, Math.round(v.currentKm - (acc / wsum) * total));
        acc += weight(day);
        synthetic.push(day);
      }
      // Dias reais
      for (let day = 0; day < DAYS; day += 1) {
        const k = dayKey(day);
        if (mine.has(k)) series.set(day, mine.get(k)!);
      }
      // Antes do primeiro dia real: segue para trás pela média
      let km = mine.get(firstReal)!;
      for (let day = 0; day < DAYS; day += 1) {
        if (dayKey(day) >= firstReal) continue;
        km = Math.max(0, km - Math.round(v.avgDailyKm * weight(day)));
        series.set(day, km);
        synthetic.push(day);
      }
    } else {
      let km = v.currentKm;
      for (let day = v.staleDays; day < DAYS; day += 1) {
        series.set(day, km);
        synthetic.push(day);
        km = Math.max(0, km - Math.round(v.avgDailyKm * weight(day)));
      }
    }
    const known = [...series.keys()].sort((a, b) => a - b);
    for (const day of synthetic.sort((a, b) => a - b)) {
      const km = series.get(day)!;
      const olderDay = known.find((d) => d > day);
      const older = olderDay === undefined ? null : series.get(olderDay)!;
      readings.push({ vehicleId: vid(v.code), rawKm: Math.max(0, km - v.odometerOffset), adjustedKm: km, deltaKm: older === null ? null : Math.max(0, km - older), readAt: new Date(NOW - day * D - 2 * H), source: v.kmSource, enteredById: v.kmSource === KmSource.MANUAL ? pcm.id : admin.id });
    }
  }
  for (let i = 0; i < readings.length; i += 5000) await prisma.odometerReading.createMany({ data: readings.slice(i, i + 5000) });
  console.log(`  ${readings.length} leituras de km`);

  await prisma.kmProjection.createMany({
    data: VEHICLES.map((v) => ({
      vehicleId: vid(v.code),
      avgDailyKm: v.avgDailyKm,
      projectedKm: v.currentKm + Math.round(v.avgDailyKm * (v.staleDays + 0.1)),
      projectedAt: new Date(NOW),
      lastReadingAt: ago(v.staleDays * 24 + 2),
      isDegraded: v.staleDays > 2,
      degradedSince: v.staleDays > 2 ? ago((v.staleDays - 2) * 24) : null,
      sampleDays: 30,
    })),
  });

  // ---- Seis meses de eventos encerrados (MKBF, eventos por dia, SLA) ------
  type Hist = { reportedAt: Date; vehicle: VehicleSpec; catalogCode: string; kind: 'deferred' | 'field' | 'shop'; line: string };
  const history: Hist[] = [];
  const CATALOG_CODES = ['ELE-ALT-01', 'PNE-APU-01', 'PNE-CUI-01', 'MEC-MOT-01', 'AC-CLI-01', 'CAR-POR-01'];
  const runners = VEHICLES.filter((v) => v.avgDailyKm > 0 && v.fleetRole === 'OPERACIONAL');
  // Nos dias cobertos pelas ocorrências reais do CCO não se inventa falha nenhuma.
  const realEvents = real ? await prisma.failureEvent.aggregate({ where: { isImported: true }, _min: { reportedAt: true }, _max: { reportedAt: true } }) : null;
  const realFrom = realEvents?._min.reportedAt ? new Date(realEvents._min.reportedAt).setHours(0, 0, 0, 0) : null;
  const realTo = realEvents?._max.reportedAt ? new Date(realEvents._max.reportedAt).setHours(23, 59, 59, 999) : null;
  for (let day = 1; day <= DAYS; day += 1) {
    // ~15 falhas/dia numa frota de 453 (MKBF perto de 5.500 km), menos no fim de semana.
    const date = new Date(NOW - day * D);
    if (realFrom !== null && realTo !== null && date.getTime() >= realFrom && date.getTime() <= realTo) continue;
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const n = Math.round((weekend ? 9 : 15) * (0.7 + rnd('events', day) * 0.6));
    for (let i = 0; i < n; i += 1) {
      const k = rnd('kind', day, i);
      const catalogCode = pick(CATALOG_CODES, 'cat', day, i);
      const safety = cat(catalogCode).isSafety;
      const kind: Hist['kind'] = !safety && k < 0.38 ? 'deferred' : k < 0.72 ? 'field' : 'shop';
      history.push({ reportedAt: new Date(NOW - day * D - (5 + Math.floor(rnd('hour', day, i) * 17)) * H - Math.floor(rnd('min', day, i) * 60) * 60_000), vehicle: pick(runners, 'veh', day, i), catalogCode, kind, line: pick(LINES, 'line', day, i) });
    }
  }
  history.sort((a, b) => a.reportedAt.getTime() - b.reportedAt.getTime());

  let eventSeq = 0;
  let woSeq = 0;
  const year = new Date().getFullYear();
  const eventCode = () => `EV-${year}-${String(++eventSeq).padStart(6, '0')}`;
  const woCode = () => `OS-${year}-${String(++woSeq).padStart(6, '0')}`;

  let shopCount = 0;
  let inspections = 0;
  for (const h of history) {
    const item = cat(h.catalogCode);
    const t0 = h.reportedAt.getTime();
    const sla = Math.round((4 + rnd('sla', t0) * 36) * 60);
    const decidedAt = new Date(t0 + sla * 1000);
    const driver = driverFor(h.vehicle.vehicleClass, `drv${t0}`);

    if (h.kind === 'deferred') {
      await prisma.failureEvent.create({
        data: {
          code: eventCode(), vehicleId: vid(h.vehicle.code), catalogItemId: item.id, origin: EventOrigin.CCO, operatorId: driver.id,
          status: EventStatus.DEFERRED, reportedById: cco.id, reportedAt: h.reportedAt, lineCode: h.line,
          isUnscheduledReturn: false, closedAt: decidedAt,
          triage: { create: { destination: TriageDestination.DEFER, decidedById: pcm.id, decidedAt, slaSeconds: sla, reasonCodeId: reason(ReasonCodeList.EVENT_DEFERRAL, rnd('def', t0) < 0.5 ? 'BAIXO' : 'JANELA').id } },
        },
      });
      await prisma.vehicleBacklogItem.create({ data: { vehicleId: vid(h.vehicle.code), description: `${item.description} (deferido na triagem)`, source: BacklogSource.DEFERRED_EVENT, catalogItemId: item.id, createdAt: decidedAt, resolvedAt: t0 < NOW - 12 * D ? new Date(t0 + 9 * D) : null } });
      continue;
    }

    if (h.kind === 'field') {
      const dispatched = new Date(decidedAt.getTime() + 5 * 60_000);
      const arrived = new Date(dispatched.getTime() + (20 + rnd('arr', t0) * 40) * 60_000);
      const started = new Date(arrived.getTime() + 5 * 60_000);
      const finished = new Date(started.getTime() + (25 + rnd('fin', t0) * 70) * 60_000);
      await prisma.failureEvent.create({
        data: {
          code: eventCode(), vehicleId: vid(h.vehicle.code), catalogItemId: item.id, origin: EventOrigin.OPERATOR, operatorId: driver.id,
          status: EventStatus.CLOSED, reportedById: cco.id, reportedAt: h.reportedAt, lineCode: h.line,
          locationDescription: pick(['Terminal Barra Funda', 'Av. Marginal, km 12', 'Ponto final da linha', 'Av. Paulista, 1500', 'Terminal Lapa', 'Terminal Pirituba'], 'loc', t0),
          isUnscheduledReturn: true, closedAt: finished,
          triage: { create: { destination: TriageDestination.FIELD, decidedById: cco.id, decidedAt, slaSeconds: sla } },
          fieldService: { create: { dispatchedAt: dispatched, arrivedAt: arrived, startedAt: started, finishedAt: finished, supportVehicleCode: pick(['APOIO-1', 'APOIO-2', 'APOIO-3'], 'apoio', t0), confirmedCatalogItemId: item.id, outcome: rnd('out', t0) < 0.78 ? FieldOutcome.RESOLVED_IN_FIELD : FieldOutcome.RETURNED_UNDER_OWN_POWER } },
        },
      });
      continue;
    }

    // Recolhido: OS completa, liberada, com o relógio decomposto por causa.
    shopCount += 1;
    const opened = new Date(decidedAt.getTime() + 40 * 60_000);
    const queueMin = Math.round(30 + rnd('q', t0) * 300);
    const execMin = Math.round((item.estimatedRepairMinutes ?? 120) * (0.8 + rnd('e', t0) * 0.7));
    const materialMin = rnd('m', t0) < 0.25 ? Math.round(600 + rnd('mm', t0) * 1200) : 0;
    const inspMin = Math.round(25 + rnd('i', t0) * 40);
    const cleanMin = Math.round(20 + rnd('c', t0) * 25);
    const releaseMin = Math.round(10 + rnd('r', t0) * 50);
    const total = queueMin + execMin + materialMin + inspMin + cleanMin + releaseMin;
    const released = new Date(opened.getTime() + total * 60_000);
    const rejected = rnd('rej', t0) < 0.07;
    const specialty = spec(SPECIALTY_BY_SYSTEM[item.system ?? ''] ?? 'MEC');

    let cursor = opened.getTime();
    const seg = (cause: DowntimeCause, minutes: number) => {
      const s = { cause, startedAt: new Date(cursor), endedAt: new Date(cursor + minutes * 60_000), minutes };
      cursor += minutes * 60_000;
      return s;
    };
    const segments = [seg(DowntimeCause.QUEUE, queueMin)];
    if (materialMin) {
      segments.push(seg(DowntimeCause.EXECUTION, Math.round(execMin * 0.4)));
      segments.push(seg(DowntimeCause.MATERIAL, materialMin));
      segments.push(seg(DowntimeCause.EXECUTION, execMin - Math.round(execMin * 0.4)));
    } else {
      segments.push(seg(DowntimeCause.EXECUTION, execMin));
    }
    segments.push(seg(DowntimeCause.INSPECTION, inspMin), seg(DowntimeCause.CLEANING, cleanMin), seg(DowntimeCause.RELEASE_WAIT, releaseMin));
    const taskStart = segments[1]!.startedAt;
    const taskEnd = segments[segments.length - 3]!.startedAt;
    const inspectedAt = segments[segments.length - 3]!.endedAt;

    const ev = await prisma.failureEvent.create({
      data: {
        code: eventCode(), vehicleId: vid(h.vehicle.code), catalogItemId: item.id, origin: EventOrigin.CCO, operatorId: driver.id,
        status: EventStatus.CLOSED, reportedById: cco.id, reportedAt: h.reportedAt, lineCode: h.line,
        isUnscheduledReturn: true, closedAt: released,
        triage: { create: { destination: TriageDestination.RECALL, decidedById: pcm.id, decidedAt, slaSeconds: sla } },
      },
    });
    await prisma.workOrder.create({
      data: {
        code: woCode(), vehicleId: vid(h.vehicle.code), type: WorkOrderType.CORRECTIVE, status: WorkOrderStatus.RELEASED,
        eventId: ev.id, openedAt: opened, estimatedCompletionAt: new Date(opened.getTime() + (queueMin + execMin + 90) * 60_000),
        techClosedAt: taskEnd, releasedAt: released, releasedById: manut.id, downtimeMinutes: total, createdById: pcm.id,
        jbWorkOrderNumber: rnd('jb', t0) < 0.6 ? `JB-${80_000 + Math.floor(rnd('jbn', t0) * 9_000)}` : null,
        downtimeSegments: { create: segments },
        cleaning: { create: { status: CleaningStatus.DONE, startedAt: segments[segments.length - 2]!.startedAt, finishedAt: segments[segments.length - 2]!.endedAt, performedById: admin.id } },
        queueEntry: { create: { vehicleId: vid(h.vehicle.code), eventId: ev.id, position: 1, criticality: item.isSafety ? 100 : 40, isFastTrack: item.isFastTrack, status: QueueStatus.DONE, enteredAt: opened, startedAt: taskStart, finishedAt: released, estimatedCompletionAt: released } },
        tasks: {
          create: [{
            code: 'S01', specialtyId: specialty.id, description: `Corrigir: ${item.description.toLowerCase()}`, status: TaskStatus.APPROVED,
            assignedToId: manut.id, startedAt: taskStart, finishedAt: taskEnd, confirmedCatalogItemId: item.id, reopenedCount: rejected ? 1 : 0,
            checklistItems: { create: [
              { sequence: 1, description: 'Diagnóstico confirmado', isChecked: true, checkedAt: taskStart, checkedById: manut.id },
              { sequence: 2, description: 'Componente substituído/reparado', isChecked: true, checkedAt: taskEnd, checkedById: manut.id },
              { sequence: 3, description: 'Teste funcional', isChecked: true, checkedAt: taskEnd, checkedById: manut.id },
            ] },
            inspections: { create: [
              ...(rejected ? [{ inspectorId: admin.id, inspectedAt: new Date(inspectedAt.getTime() - 30 * 60_000), result: InspectionResult.REJECTED, reasonCodeId: reason(ReasonCodeList.INSPECTION_REJECTION, pick(['FOLGA', 'VAZ', 'ACAB'], 'rr', t0)).id, note: 'Reaberta para acerto' }] : []),
              { inspectorId: admin.id, inspectedAt, result: InspectionResult.APPROVED },
            ] },
          }],
        },
      },
    });
    inspections += rejected ? 2 : 1;
  }
  console.log(`  ${history.length} eventos históricos (${shopCount} OS liberadas, ${inspections} inspeções)`);

  // ---- A garagem AGORA: cenários para operar na mão ---------------------------
  const openEvents: { key: keyof typeof S; hoursAgo: number; catalogCode: string; line: string; origin: EventOrigin }[] = [
    { key: 'off', hoursAgo: 72, catalogCode: 'MEC-MOT-01', line: '6262', origin: EventOrigin.GARAGE },
    { key: 'cuica', hoursAgo: 31.5, catalogCode: 'PNE-CUI-01', line: '8012', origin: EventOrigin.CCO },
    { key: 'insp', hoursAgo: 9.5, catalogCode: 'MEC-MOT-01', line: '4111', origin: EventOrigin.OPERATOR },
    { key: 'clean', hoursAgo: 7.4, catalogCode: 'AC-CLI-01', line: '2290', origin: EventOrigin.OPERATOR },
    { key: 'apu', hoursAgo: 4.6, catalogCode: 'PNE-APU-01', line: '2290', origin: EventOrigin.CCO },
    { key: 'porta', hoursAgo: 3.4, catalogCode: 'CAR-POR-01', line: '3720', origin: EventOrigin.OPERATOR },
    { key: 'alt', hoursAgo: 1.3, catalogCode: 'ELE-ALT-01', line: '8012', origin: EventOrigin.OPERATOR },
    { key: 'ac', hoursAgo: 0.4, catalogCode: 'AC-CLI-01', line: '875A-10', origin: EventOrigin.OPERATOR },
  ];
  const ev: Record<string, { id: string; vehicleId: string; reportedAt: Date }> = {};
  for (const o of openEvents) {
    const item = cat(o.catalogCode);
    const v = S[o.key];
    const row = await prisma.failureEvent.create({
      data: {
        code: eventCode(), vehicleId: vid(v.code), catalogItemId: item.id, origin: o.origin, operatorId: o.origin === EventOrigin.OPERATOR ? driverFor(v.vehicleClass, o.key).id : null,
        status: EventStatus.REGISTERED, reportedById: o.origin === EventOrigin.CCO ? cco.id : admin.id,
        reportedAt: ago(o.hoursAgo), lineCode: o.line,
        locationDescription: o.key === 'alt' ? 'Av. Marginal Tietê, altura da ponte da Casa Verde' : null,
        reportedDescription: o.key === 'off' ? 'Aguardando vistoria após colisão leve' : null,
        isUnscheduledReturn: o.key !== 'off',
      },
    });
    ev[o.key] = { id: row.id, vehicleId: row.vehicleId, reportedAt: row.reportedAt };
  }
  const E = (k: string) => ev[k]!;

  // off — fora de operação: evento deferido (aguarda vistoria), vira backlog.
  await prisma.failureEvent.update({ where: { id: E('off').id }, data: { status: EventStatus.DEFERRED, closedAt: ago(71), triage: { create: { destination: TriageDestination.DEFER, decidedById: pcm.id, decidedAt: ago(71), slaSeconds: 3600, reasonCodeId: reason(ReasonCodeList.EVENT_DEFERRAL, 'BAIXO').id, note: 'Carro fora de operação até a vistoria da seguradora' } } } });
  await prisma.vehicleBacklogItem.create({ data: { vehicleId: vid(S.off.code), description: 'Vistoria da seguradora e reparo de funilaria (lateral esquerda)', source: BacklogSource.MANUAL, createdAt: ago(71) } });

  // alt — socorro em campo: chegou, ainda não começou o reparo.
  await prisma.failureEvent.update({ where: { id: E('alt').id }, data: { status: EventStatus.FIELD_SERVICE, triage: { create: { destination: TriageDestination.FIELD, decidedById: cco.id, decidedAt: ago(1.2), slaSeconds: 6 * 60 } }, fieldService: { create: { dispatchedAt: ago(1.1), arrivedAt: ago(0.7), supportVehicleCode: 'APOIO-2', technicianId: manut.id } } } });

  // cuica — aguardando peça há 31,5h: OS parada por material, fila em 1º com histórico.
  const cuicaMat = matLike('CUICA FREIO DIANT');
  const woCuica = await prisma.workOrder.create({
    data: {
      code: woCode(), vehicleId: vid(S.cuica.code), type: WorkOrderType.CORRECTIVE, status: WorkOrderStatus.WAITING_PART, eventId: E('cuica').id,
      openedAt: ago(31.2), estimatedCompletionAt: ago(6), createdById: pcm.id,
      downtimeSegments: { create: [
        { cause: DowntimeCause.QUEUE, startedAt: ago(31.2), endedAt: ago(29.7), minutes: 90 },
        { cause: DowntimeCause.EXECUTION, startedAt: ago(29.7), endedAt: ago(27.9), minutes: 110 },
        { cause: DowntimeCause.MATERIAL, startedAt: ago(27.9) },
      ] },
      tasks: { create: [{
        code: 'S01', specialtyId: spec('MEC').id, description: 'Substituir cuíca de freio dianteira', status: TaskStatus.BLOCKED_BY_MATERIAL, assignedToId: manut.id, startedAt: ago(29.7),
        checklistItems: { create: [
          { sequence: 1, description: 'Despressurizar o sistema', isChecked: true, checkedAt: ago(29.5), checkedById: manut.id },
          { sequence: 2, description: 'Substituir o componente', isChecked: false },
          { sequence: 3, description: 'Teste de estanqueidade', isChecked: false, unit: 'bar' },
        ] },
      }] },
      cleaning: { create: { status: CleaningStatus.PENDING } },
    },
    include: { tasks: true },
  });
  await prisma.failureEvent.update({ where: { id: E('cuica').id }, data: { status: EventStatus.IN_MAINTENANCE, triage: { create: { destination: TriageDestination.RECALL, decidedById: pcm.id, decidedAt: ago(31.3), slaSeconds: 12 * 60 } } } });
  await prisma.materialRequest.create({
    data: { workOrderId: woCuica.id, workOrderTaskId: woCuica.tasks[0]!.id, materialId: cuicaMat.id, quantity: 1, status: MaterialRequestStatus.WAITING_PART, requestedById: manut.id, requestedAt: ago(28.5),
      partWaiting: { create: { reasonCodeId: reason(ReasonCodeList.PART_WAITING, 'COMPRA').id, expectedAt: ago(20), escalatedAt: ago(2), createdAt: ago(27.9) } } },
  });
  const qCuica = await prisma.queueEntry.create({ data: { vehicleId: vid(S.cuica.code), eventId: E('cuica').id, workOrderId: woCuica.id, position: 1, criticality: 100, isFastTrack: true, status: QueueStatus.WAITING, enteredAt: ago(31.5), estimatedCompletionAt: inHours(4) } });
  await prisma.queueChangeLog.createMany({ data: [
    { queueEntryId: qCuica.id, fromPosition: null, toPosition: 1, reasonCodeId: reason(ReasonCodeList.QUEUE_PRIORITY, 'SEG').id, isSystemGenerated: true, note: 'Fast-track automático por flag do catálogo', createdAt: ago(31.5) },
    { queueEntryId: qCuica.id, fromPosition: 2, toPosition: 1, reasonCodeId: reason(ReasonCodeList.QUEUE_PRIORITY, 'SEG').id, actorId: pcm.id, note: 'Falha de freio — não pode esperar', createdAt: ago(20) },
  ] });

  // insp — em inspeção: sub-OS concluída, inspetor no carro.
  await prisma.workOrder.create({
    data: {
      code: woCode(), vehicleId: vid(S.insp.code), type: WorkOrderType.CORRECTIVE, status: WorkOrderStatus.IN_INSPECTION, eventId: E('insp').id,
      openedAt: ago(9.1), estimatedCompletionAt: inHours(1), createdById: pcm.id, techClosedAt: ago(0.9), jbWorkOrderNumber: 'JB-88201',
      downtimeSegments: { create: [
        { cause: DowntimeCause.QUEUE, startedAt: ago(9.1), endedAt: ago(8.3), minutes: 48 },
        { cause: DowntimeCause.EXECUTION, startedAt: ago(8.3), endedAt: ago(0.9), minutes: 444 },
        { cause: DowntimeCause.INSPECTION, startedAt: ago(0.9) },
      ] },
      tasks: { create: [{ code: 'S01', specialtyId: spec('MEC').id, description: 'Substituir bomba d’água e correia', status: TaskStatus.IN_INSPECTION, assignedToId: manut.id, startedAt: ago(8.3), finishedAt: ago(0.9), confirmedCatalogItemId: cat('MEC-MOT-01').id,
        checklistItems: { create: [
          { sequence: 1, description: 'Drenar o sistema de arrefecimento', isChecked: true, checkedAt: ago(8), checkedById: manut.id },
          { sequence: 2, description: 'Substituir bomba e correia', isChecked: true, checkedAt: ago(3), checkedById: manut.id },
          { sequence: 3, description: 'Sangria e teste de temperatura', isChecked: true, checkedAt: ago(1), checkedById: manut.id, measurement: 88, unit: '°C' },
        ] } }] },
      cleaning: { create: { status: CleaningStatus.PENDING } },
      queueEntry: { create: { vehicleId: vid(S.insp.code), eventId: E('insp').id, position: 1, criticality: 100, isFastTrack: false, status: QueueStatus.DONE, enteredAt: ago(9.1), startedAt: ago(8.3), finishedAt: ago(0.9) } },
    },
  });
  await prisma.failureEvent.update({ where: { id: E('insp').id }, data: { status: EventStatus.IN_MAINTENANCE, triage: { create: { destination: TriageDestination.RECALL, decidedById: cco.id, decidedAt: ago(9.3), slaSeconds: 11 * 60 } } } });

  // clean — em limpeza: tudo aprovado, checklist da limpeza pela metade.
  const woClean = await prisma.workOrder.create({
    data: {
      code: woCode(), vehicleId: vid(S.clean.code), type: WorkOrderType.CORRECTIVE, status: WorkOrderStatus.IN_CLEANING, eventId: E('clean').id,
      openedAt: ago(7), estimatedCompletionAt: inHours(0.5), createdById: pcm.id, techClosedAt: ago(1.4),
      downtimeSegments: { create: [
        { cause: DowntimeCause.QUEUE, startedAt: ago(7), endedAt: ago(6.4), minutes: 36 },
        { cause: DowntimeCause.EXECUTION, startedAt: ago(6.4), endedAt: ago(1.4), minutes: 300 },
        { cause: DowntimeCause.INSPECTION, startedAt: ago(1.4), endedAt: ago(0.6), minutes: 48 },
        { cause: DowntimeCause.CLEANING, startedAt: ago(0.6) },
      ] },
      tasks: { create: [{ code: 'S01', specialtyId: spec('AC').id, description: 'Recarga de gás e teste do compressor', status: TaskStatus.APPROVED, assignedToId: manut.id, startedAt: ago(6.4), finishedAt: ago(1.4), confirmedCatalogItemId: cat('AC-CLI-01').id,
        inspections: { create: [{ inspectorId: admin.id, inspectedAt: ago(0.6), result: InspectionResult.APPROVED }] } }] },
      cleaning: { create: { status: CleaningStatus.IN_PROGRESS, startedAt: ago(0.6), performedById: admin.id, checklistItems: { create: [
        { sequence: 1, description: 'Varrição e recolhimento de resíduos', isChecked: true, checkedAt: ago(0.4) },
        { sequence: 2, description: 'Limpeza de vidros e corrimãos', isChecked: true, checkedAt: ago(0.2) },
        { sequence: 3, description: 'Lavagem do piso', isChecked: false },
        { sequence: 4, description: 'Conferência de bancos e avarias', isChecked: false },
      ] }, damageReports: { create: [{ description: 'Banco 12 com estofado rasgado', createdAt: ago(0.3) }] } } },
      queueEntry: { create: { vehicleId: vid(S.clean.code), eventId: E('clean').id, position: 1, criticality: 40, isFastTrack: false, status: QueueStatus.DONE, enteredAt: ago(7), startedAt: ago(6.4), finishedAt: ago(1.4) } },
    },
    include: { cleaning: { include: { damageReports: true } } },
  });
  await prisma.failureEvent.update({ where: { id: E('clean').id }, data: { status: EventStatus.IN_MAINTENANCE, triage: { create: { destination: TriageDestination.RECALL, decidedById: cco.id, decidedAt: ago(7.2), slaSeconds: 9 * 60 } } } });
  await prisma.vehicleBacklogItem.create({ data: { vehicleId: vid(S.clean.code), description: 'Banco 12 com estofado rasgado (avaria da limpeza)', source: BacklogSource.CLEANING, cleaningDamageReportId: woClean.cleaning!.damageReports[0]!.id, createdAt: ago(0.3) } });

  // apu — em manutenção há 4,2h: S01 em andamento, S02 aprovada; material separado e outro pedido.
  const apuMat = matLike('VALVULA APU');
  const filtroAr = matLike('FILTRO AR OF 1721/O500');
  const woApu = await prisma.workOrder.create({
    data: {
      code: woCode(), vehicleId: vid(S.apu.code), type: WorkOrderType.CORRECTIVE, status: WorkOrderStatus.IN_PROGRESS, eventId: E('apu').id,
      openedAt: ago(4.2), estimatedCompletionAt: inHours(1.5), createdById: pcm.id, jbWorkOrderNumber: 'JB-88213',
      downtimeSegments: { create: [
        { cause: DowntimeCause.QUEUE, startedAt: ago(4.2), endedAt: ago(3.8), minutes: 24 },
        { cause: DowntimeCause.EXECUTION, startedAt: ago(3.8) },
      ] },
      tasks: { create: [
        { code: 'S01', specialtyId: spec('MEC').id, description: 'Substituir válvula APU', status: TaskStatus.IN_PROGRESS, assignedToId: manut.id, startedAt: ago(3.5),
          checklistItems: { create: [
            { sequence: 1, description: 'Despressurizar o sistema', isChecked: true, checkedAt: ago(3), checkedById: manut.id },
            { sequence: 2, description: 'Substituir o componente', isChecked: true, checkedAt: ago(1), checkedById: manut.id },
            { sequence: 3, description: 'Teste de estanqueidade', isChecked: false, unit: 'bar' },
          ] } },
        { code: 'S02', specialtyId: spec('ELE').id, description: 'Verificar sistema de carga', status: TaskStatus.APPROVED, assignedToId: manut.id, startedAt: ago(4), finishedAt: ago(2.2), confirmedCatalogItemId: cat('ELE-ALT-01').id, reopenedCount: 1,
          inspections: { create: [
            { inspectorId: admin.id, inspectedAt: ago(2.6), result: InspectionResult.REJECTED, reasonCodeId: reason(ReasonCodeList.INSPECTION_REJECTION, 'FOLGA').id, note: 'Tensão de correia fora da faixa' },
            { inspectorId: admin.id, inspectedAt: ago(1.8), result: InspectionResult.APPROVED },
          ] } },
      ] },
      cleaning: { create: { status: CleaningStatus.PENDING } },
    },
    include: { tasks: true },
  });
  await prisma.failureEvent.update({ where: { id: E('apu').id }, data: { status: EventStatus.IN_MAINTENANCE, triage: { create: { destination: TriageDestination.RECALL, decidedById: cco.id, decidedAt: ago(4.4), slaSeconds: 10 * 60 } } } });
  const s01 = woApu.tasks.find((t) => t.code === 'S01')!;
  await prisma.materialRequest.createMany({ data: [
    { workOrderId: woApu.id, workOrderTaskId: s01.id, materialId: apuMat.id, quantity: 1, status: MaterialRequestStatus.SEPARATED, requestedById: manut.id, requestedAt: ago(3.9), separatedById: estoque.id, separatedAt: ago(2.5), serialNumber: apuMat.isSerialized ? 'APU-77812' : null },
    { workOrderId: woApu.id, workOrderTaskId: s01.id, materialId: filtroAr.id, quantity: 2, status: MaterialRequestStatus.REQUESTED, requestedById: manut.id, requestedAt: ago(1.2) },
  ] });
  await prisma.queueEntry.create({ data: { vehicleId: vid(S.apu.code), eventId: E('apu').id, workOrderId: woApu.id, position: 1, criticality: 100, isFastTrack: true, status: QueueStatus.IN_SERVICE, enteredAt: ago(4.2), startedAt: ago(3.8), estimatedCompletionAt: inHours(1.5) } });

  // porta — na fila há 3,1h: OS aberta, esperando valeta.
  const woPorta = await prisma.workOrder.create({
    data: {
      code: woCode(), vehicleId: vid(S.porta.code), type: WorkOrderType.CORRECTIVE, status: WorkOrderStatus.OPEN, eventId: E('porta').id,
      openedAt: ago(3.1), estimatedCompletionAt: inHours(5.5), createdById: pcm.id,
      downtimeSegments: { create: [{ cause: DowntimeCause.QUEUE, startedAt: ago(3.1) }] },
      tasks: { create: [{ code: 'S01', specialtyId: spec('FUN').id, description: 'Regular cilindro e sensor da porta 2', status: TaskStatus.PENDING }] },
      cleaning: { create: { status: CleaningStatus.PENDING } },
    },
  });
  await prisma.failureEvent.update({ where: { id: E('porta').id }, data: { status: EventStatus.IN_MAINTENANCE, triage: { create: { destination: TriageDestination.RECALL, decidedById: cco.id, decidedAt: ago(3.2), slaSeconds: 14 * 60 } } } });
  const qPorta = await prisma.queueEntry.create({ data: { vehicleId: vid(S.porta.code), eventId: E('porta').id, workOrderId: woPorta.id, position: 2, criticality: 60, isFastTrack: false, status: QueueStatus.WAITING, enteredAt: ago(3.1), estimatedCompletionAt: inHours(5.5) } });
  await prisma.queueChangeLog.create({ data: { queueEntryId: qPorta.id, fromPosition: null, toPosition: 2, reasonCodeId: reason(ReasonCodeList.QUEUE_PRIORITY, 'SEG').id, isSystemGenerated: true, note: 'Posição inicial por criticidade', createdAt: ago(3.1) } });

  // ---- Garagem genérica: mais carros em cada etapa ---------------------------
  let queuePos = 3;
  for (const g of generic) {
    const item = cat(g.code);
    const specialty = spec(SPECIALTY_BY_SYSTEM[item.system ?? ''] ?? 'MEC');
    const t = g.hours;
    const line = pick(LINES, 'gl', g.v.code);
    const driver = driverFor(g.v.vehicleClass, `gd${g.v.code}`);
    const base = { code: eventCode(), vehicleId: vid(g.v.code), catalogItemId: item.id, origin: rnd('go', g.v.code) < 0.6 ? EventOrigin.OPERATOR : EventOrigin.CCO, operatorId: driver.id, reportedById: cco.id, reportedAt: ago(t + 0.3), lineCode: line, isUnscheduledReturn: true };

    if (g.stage === 'triage') {
      await prisma.failureEvent.create({ data: { ...base, status: EventStatus.REGISTERED } });
      continue;
    }
    if (g.stage === 'field') {
      await prisma.failureEvent.create({ data: { ...base, status: EventStatus.FIELD_SERVICE, locationDescription: pick(['Terminal Lapa', 'Av. Francisco Matarazzo, 1000', 'Rod. Anhanguera, km 18'], 'gloc', g.v.code), triage: { create: { destination: TriageDestination.FIELD, decidedById: cco.id, decidedAt: ago(t + 0.1), slaSeconds: 12 * 60 } }, fieldService: { create: { dispatchedAt: ago(t), supportVehicleCode: pick(['APOIO-1', 'APOIO-3'], 'ga', g.v.code), technicianId: manut.id, ...(t > 0.8 ? { arrivedAt: ago(t - 0.5) } : {}) } } } });
      continue;
    }

    const evRow = await prisma.failureEvent.create({ data: { ...base, status: EventStatus.IN_MAINTENANCE, triage: { create: { destination: TriageDestination.RECALL, decidedById: pcm.id, decidedAt: ago(t + 0.1), slaSeconds: 9 * 60 } } } });
    const execMin = Math.round((item.estimatedRepairMinutes ?? 120) * (0.8 + rnd('ge', g.v.code) * 0.6));
    const status = { queue: WorkOrderStatus.OPEN, exec: WorkOrderStatus.IN_PROGRESS, part: WorkOrderStatus.WAITING_PART, inspection: WorkOrderStatus.IN_INSPECTION, cleaning: WorkOrderStatus.IN_CLEANING }[g.stage as Exclude<Stage, 'triage' | 'field'>];
    const taskStatus = { queue: TaskStatus.PENDING, exec: TaskStatus.IN_PROGRESS, part: TaskStatus.BLOCKED_BY_MATERIAL, inspection: TaskStatus.IN_INSPECTION, cleaning: TaskStatus.APPROVED }[g.stage as Exclude<Stage, 'triage' | 'field'>];
    const started = g.stage === 'queue' ? null : ago(Math.max(0.2, t - 0.5));
    const finished = g.stage === 'inspection' || g.stage === 'cleaning' ? ago(Math.max(0.1, t - 0.5 - execMin / 60)) : null;
    const segments: { cause: DowntimeCause; startedAt: Date; endedAt?: Date; minutes?: number }[] = [{ cause: DowntimeCause.QUEUE, startedAt: ago(t), ...(started ? { endedAt: started, minutes: 30 } : {}) }];
    if (started) segments.push({ cause: DowntimeCause.EXECUTION, startedAt: started, ...(g.stage === 'part' ? { endedAt: ago(t - 1), minutes: 60 } : finished ? { endedAt: finished, minutes: execMin } : {}) });
    if (g.stage === 'part') segments.push({ cause: DowntimeCause.MATERIAL, startedAt: ago(t - 1) });
    if (finished) segments.push({ cause: DowntimeCause.INSPECTION, startedAt: finished, ...(g.stage === 'cleaning' ? { endedAt: ago(0.4), minutes: 40 } : {}) });
    if (g.stage === 'cleaning') segments.push({ cause: DowntimeCause.CLEANING, startedAt: ago(0.4) });

    const wo = await prisma.workOrder.create({
      data: {
        code: woCode(), vehicleId: vid(g.v.code), type: WorkOrderType.CORRECTIVE, status, eventId: evRow.id,
        openedAt: ago(t), estimatedCompletionAt: inHours(Math.max(0.5, execMin / 60 + 2 - t)), createdById: pcm.id,
        techClosedAt: finished, jbWorkOrderNumber: rnd('gjb', g.v.code) < 0.5 ? `JB-${88_300 + Math.floor(rnd('gjbn', g.v.code) * 500)}` : null,
        downtimeSegments: { create: segments },
        tasks: { create: [{
          code: 'S01', specialtyId: specialty.id, description: `Corrigir: ${item.description.toLowerCase()}`, status: taskStatus, assignedToId: started ? manut.id : null, startedAt: started, finishedAt: finished,
          confirmedCatalogItemId: finished ? item.id : null,
          checklistItems: { create: [
            { sequence: 1, description: 'Diagnóstico confirmado', isChecked: Boolean(started), checkedAt: started, checkedById: started ? manut.id : null },
            { sequence: 2, description: 'Componente substituído/reparado', isChecked: Boolean(finished), checkedAt: finished, checkedById: finished ? manut.id : null },
            { sequence: 3, description: 'Teste funcional', isChecked: Boolean(finished), checkedAt: finished, checkedById: finished ? manut.id : null },
          ] },
          ...(g.stage === 'cleaning' ? { inspections: { create: [{ inspectorId: admin.id, inspectedAt: ago(0.4), result: InspectionResult.APPROVED }] } } : {}),
        }] },
        cleaning: { create: g.stage === 'cleaning'
          ? { status: CleaningStatus.IN_PROGRESS, startedAt: ago(0.4), performedById: admin.id, checklistItems: { create: ['Varrição e recolhimento de resíduos', 'Limpeza de vidros e corrimãos', 'Lavagem do piso', 'Conferência de bancos e avarias'].map((d, i) => ({ sequence: i + 1, description: d, isChecked: i < 2, checkedAt: i < 2 ? ago(0.2) : null })) } }
          : { status: CleaningStatus.PENDING } },
        queueEntry: { create: { vehicleId: vid(g.v.code), eventId: evRow.id, position: g.stage === 'queue' ? queuePos++ : 1, criticality: item.isSafety ? 100 : 50, isFastTrack: item.isFastTrack, status: g.stage === 'queue' ? QueueStatus.WAITING : QueueStatus.IN_SERVICE, enteredAt: ago(t), startedAt: started, estimatedCompletionAt: inHours(Math.max(0.5, execMin / 60 + 2 - t)) } },
      },
      include: { tasks: true },
    });
    if (g.stage === 'part') {
      const m = pick(materials.filter((x) => x.isPreventive && !x.isSerialized), 'gm', g.v.code);
      await prisma.materialRequest.create({ data: { workOrderId: wo.id, workOrderTaskId: wo.tasks[0]!.id, materialId: m.id, quantity: 1, status: MaterialRequestStatus.WAITING_PART, requestedById: manut.id, requestedAt: ago(t - 0.9), partWaiting: { create: { reasonCodeId: reason(ReasonCodeList.PART_WAITING, pick(['SEMEST', 'COMPRA', 'OFIC'], 'gpw', g.v.code)).id, expectedAt: t > 24 ? ago(t - 24) : inHours(8), escalatedAt: t > 24 ? ago(1) : null, createdAt: ago(t - 1) } } } });
    } else if (g.stage === 'exec' && rnd('greq', g.v.code) < 0.5) {
      const m = pick(materials.filter((x) => x.isPreventive && !x.isSerialized), 'gm2', g.v.code);
      await prisma.materialRequest.create({ data: { workOrderId: wo.id, workOrderTaskId: wo.tasks[0]!.id, materialId: m.id, quantity: 1, status: rnd('gst', g.v.code) < 0.5 ? MaterialRequestStatus.REQUESTED : MaterialRequestStatus.SEPARATED, requestedById: manut.id, requestedAt: ago(Math.max(0.1, t - 0.8)), ...(rnd('gst', g.v.code) >= 0.5 ? { separatedById: estoque.id, separatedAt: ago(Math.max(0.05, t - 1)) } : {}) } });
    }
  }
  console.log(`  garagem atual: ${Object.keys(S).length - 2} cenários + ${generic.length} carros em etapas genéricas`);

  // ---- Pool, ferramentas ---------------------------------------------------
  const alt2 = await prisma.poolComponent.findUnique({ where: { serialNumber: 'ALT-20432' } });
  const alt3 = await prisma.poolComponent.findUnique({ where: { serialNumber: 'ALT-20433' } });
  if (alt2) {
    await prisma.poolComponent.update({ where: { id: alt2.id }, data: { status: PoolComponentStatus.IN_USE, currentVehicleId: vid(S.prev1.code) } });
    await prisma.poolMovement.create({ data: { componentId: alt2.id, fromStatus: PoolComponentStatus.IN_STOCK, toStatus: PoolComponentStatus.IN_USE, actorId: manut.id, occurredAt: ago(60), note: `Instalado no ${S.prev1.code}` } });
  }
  if (alt3) {
    await prisma.poolComponent.update({ where: { id: alt3.id }, data: { status: PoolComponentStatus.IN_WORKSHOP } });
    await prisma.poolMovement.create({ data: { componentId: alt3.id, fromStatus: PoolComponentStatus.IN_USE, toStatus: PoolComponentStatus.IN_WORKSHOP, actorId: estoque.id, occurredAt: ago(30), note: 'Enviado para recuperação' } });
  }
  const torq = await prisma.tool.findUnique({ where: { code: 'TORQ-01' } });
  if (torq) await prisma.toolLoan.create({ data: { toolId: torq.id, borrowerId: manut.id, workOrderTaskId: s01.id, loanedAt: ago(2) } });

  // ---- Preventiva: backlog e paradas com os planos reais ---------------------
  const bl1 = await prisma.vehicleBacklogItem.create({ data: { vehicleId: vid(S.prev1.code), description: 'Ar-condicionado sem refrigeração (deferido na triagem)', source: BacklogSource.DEFERRED_EVENT, catalogItemId: cat('AC-CLI-01').id, createdAt: ago(5 * 24) } });
  const bl2 = await prisma.vehicleBacklogItem.create({ data: { vehicleId: vid(S.prev1.code), description: 'Banco 7 com estofado rasgado (avaria da limpeza)', source: BacklogSource.CLEANING, createdAt: ago(9 * 24) } });
  await prisma.vehicleBacklogItem.create({ data: { vehicleId: vid(S.cuica.code), description: 'Espelho retrovisor direito trincado', source: BacklogSource.INSPECTION, createdAt: ago(12 * 24) } });

  const nextTrigger = (km: number, pkg: { intervalKm: number; offsetKm: number }) => pkg.offsetKm + (Math.floor(Math.max(0, km - pkg.offsetKm) / pkg.intervalKm) + 1) * pkg.intervalKm;
  const scheduleFor = async (v: VehicleSpec, pkgCode: string, opts: { status: ScheduleStatus; plannedInDays: number; kit: KitSeparationStatus | null; team?: string; reschedule?: boolean; backlog?: string[] }) => {
    const plan = planFor(v.model, v.technology, v.manufacturer);
    const pkg = plan?.packages.find((p) => p.code === pkgCode) ?? plan?.packages[0];
    if (!plan || !pkg) return;
    const targetKm = nextTrigger(v.currentKm, pkg);
    const days = Math.max(1, Math.round((targetKm - v.currentKm) / Math.max(50, v.avgDailyKm)));
    const kit = pkg.kits[0];
    await prisma.scheduledMaintenance.create({
      data: {
        vehicleId: vid(v.code), packageId: pkg.id, targetKm, projectedDate: inHours(days * 24), plannedDate: inHours(opts.plannedInDays * 24), status: opts.status,
        kitReady: opts.kit === KitSeparationStatus.SEPARATED, teamReserved: Boolean(opts.team), createdAt: ago(3 * 24),
        scopeItems: { create: [...pkg.tasks.map((t) => ({ maintenanceTaskId: t.id })), ...(opts.backlog ?? []).map((id) => ({ backlogItemId: id }))] },
        ...(opts.reschedule ? { reschedules: { create: [{ fromDate: ago(24), toDate: inHours(opts.plannedInDays * 24), reasonCodeId: reason(ReasonCodeList.SCHEDULE_RESCHEDULE, 'MAT').id, actorId: pcm.id, note: 'Filtro de combustível em falta no estoque', createdAt: ago(2 * 24) }] } } : {}),
        ...(opts.team ? { reservations: { create: [{ specialtyId: spec(opts.team).id, headcount: 2, reservedById: manut.id, reservedAt: ago(20) }] } } : {}),
        ...(kit && opts.kit ? { kitSeparation: { create: { kitId: kit.id, status: opts.kit, ...(opts.kit === KitSeparationStatus.SEPARATED ? { separatedById: estoque.id, separatedAt: ago(6) } : {}) } } } : {}),
      },
    });
  };
  await scheduleFor(S.prev1, 'A', { status: ScheduleStatus.PLANNED, plannedInDays: 3, kit: KitSeparationStatus.PENDING, reschedule: true, backlog: [bl1.id, bl2.id] });
  await scheduleFor(S.prev2, 'M', { status: ScheduleStatus.CONFIRMED, plannedInDays: 2, kit: KitSeparationStatus.SEPARATED, team: 'ELE' });
  await scheduleFor(carOf('AR9', 'PADRON_13M', 11), 'I', { status: ScheduleStatus.PLANNED, plannedInDays: 1, kit: KitSeparationStatus.PENDING });
  await scheduleFor(carOf('AR9', 'BASICO_12M', 22), 'B', { status: ScheduleStatus.CONFIRMED, plannedInDays: 4, kit: KitSeparationStatus.SEPARATED, team: 'MEC' });
  await scheduleFor(carOf('E8', 'ARTICULADO_23M', 3), 'I', { status: ScheduleStatus.PLANNED, plannedInDays: 6, kit: null });
  await scheduleFor(carOf('E8', 'EPADRON_13M', 15), 'L', { status: ScheduleStatus.PLANNED, plannedInDays: 2, kit: KitSeparationStatus.PENDING });
  console.log('  6 paradas preventivas programadas com os pacotes dos planos IT.MAN');

  // ---- Plantão: três demandas de reposição ---------------------------------
  const reserveOf = (cls: VehicleClass, lot: 'E8' | 'AR9', n: number) =>
    VEHICLES.filter((v) => v.lot === lot && v.vehicleClass === cls && v.fleetRole === 'RESERVA')[n] ?? VEHICLES.filter((v) => v.vehicleClass === cls && v.fleetRole === 'RESERVA')[0] ?? VEHICLES.filter((v) => v.fleetRole === 'RESERVA')[n % Math.max(1, VEHICLES.filter((v) => v.fleetRole === 'RESERVA').length)]!;
  const resB = reserveOf('PADRON_13M', 'E8', 0);
  const resC = reserveOf('EPADRON_13M', 'AR9', 0);
  resB.status = VehicleStatus.IN_LINE;
  await prisma.vehicle.update({ where: { id: vid(resB.code) }, data: { status: VehicleStatus.IN_LINE } });
  await prisma.replacementDemand.create({ data: { lineCode: '8012', originVehicleId: vid(S.cuica.code), status: ReplacementDemandStatus.OPEN, requestedById: cco.id, requestedAt: ago(0.08), windowEndsAt: inHours(0.58) } });
  await prisma.replacementDemand.create({ data: { lineCode: '2290', originVehicleId: vid(S.apu.code), status: ReplacementDemandStatus.ASSIGNED, requestedById: cco.id, requestedAt: ago(4.1), windowEndsAt: ago(3.4), metAt: ago(3.9),
    assignments: { create: [{ vehicleId: vid(resB.code), operatorId: driverFor('PADRON_13M', 'resB').id, assignedById: cco.id, assignedAt: ago(3.9) }] } } });
  await prisma.replacementDemand.create({ data: { lineCode: '3720', status: ReplacementDemandStatus.MISSED, requestedById: cco.id, requestedAt: ago(26), windowEndsAt: ago(25.3),
    assignments: { create: [{ vehicleId: vid(resC.code), operatorId: driverFor('EPADRON_13M', 'resC').id, assignedById: cco.id, assignedAt: ago(25.1), returnedAt: ago(18) }] } } });

  // ---- Notificações -----------------------------------------------------
  await prisma.notification.createMany({ data: [
    { role: UserRole.PCM, title: 'Peça com prazo vencido escalonada', body: `Cuíca de freio dianteira (OS do carro ${S.cuica.code}) passou do prazo previsto e foi escalonada ao PCM.`, entity: 'MaterialRequest', createdAt: ago(2) },
    { role: UserRole.PCM, title: 'Previsão de conclusão estourada', body: `A OS do carro ${S.cuica.code} passou da previsão de conclusão. Carro aguardando peça há mais de 24h.`, entity: 'WorkOrder', createdAt: ago(6) },
    { role: UserRole.CCO, title: 'Janela de reposição estourada', body: 'Linha 3720 ficou 12 minutos sem reserva designada na janela de 40 min.', entity: 'ReplacementDemand', createdAt: ago(25.3) },
    { role: UserRole.PCM, title: 'Odômetro atrasado', body: `Carro ${S.cuica.code} está sem leitura de km há 5 dias; a projeção da preventiva está desatualizada.`, entity: 'KmProjection', createdAt: ago(3 * 24) },
    { role: UserRole.ESTOQUE, title: 'Kit para separar em D-1', body: `Kit da revisão A do carro ${S.prev1.code}: separar até amanhã para a parada programada.`, entity: 'KitSeparation', createdAt: ago(1) },
    { role: UserRole.ADMIN, title: 'Inspeção reprovada e sub-OS reaberta', body: `S02 da OS do carro ${S.apu.code} reprovada (tensão de correia fora da faixa) e reaberta.`, entity: 'Inspection', createdAt: ago(2.6) },
  ] });

  // ---- Auditorias 5S (mensal) e conformidade (trimestral) — exemplos dos últimos meses ----
  const AREAS = ['Almoxarifado', 'Oficina mecânica', 'Elétrica e eBUS', 'Funilaria', 'Borracharia', 'Pátio e lavagem', 'Ferramentaria'];
  const FIVE_S = ['SEIRI_1', 'SEIRI_2', 'SEITON_1', 'SEITON_2', 'SEISO_1', 'SEISO_2', 'SEIKETSU_1', 'SEIKETSU_2', 'SHITSUKE_1', 'SHITSUKE_2'];
  const COMPL = ['ITMAN01', 'ITMAN54_60', 'ITMAN03', 'FR168', 'CHECKLIST', 'TRIAGEM', 'PORTOES', 'LIMPEZA', 'ESTOQUE', 'KM'];
  let auditsN = 0;
  for (const [ai, area] of AREAS.entries()) {
    // três meses de 5S: nota subindo onde o Kaizen já começou (Almoxarifado e oficina)
    for (const monthsAgo of [3, 2, 1]) {
      if (ai >= 4 && monthsAgo > 1) continue;
      const at = new Date(NOW - (monthsAgo * 30 - 14 + ai * 3) * D);
      const items = FIVE_S.map((key, i) => ({ key, label: key, max: 4, score: Math.min(4, Math.max(0, Math.round(1 + (3 - monthsAgo) * 0.6 + rnd('5s', area, key) * 2.2 - (ai >= 4 ? 0.6 : 0) + (i % 3 === 0 ? -0.3 : 0)))) }));
      const score = Math.round((items.reduce((s, x) => s + x.score, 0) / 40) * 100);
      await prisma.processAudit.create({ data: { kind: 'FIVE_S', area, auditedAt: at, auditorId: pcm.id, score, actions: score < 75 ? 'Demarcar piso e etiquetar prateleiras; definir responsável pela limpeza do turno' : null, nextDueAt: new Date(at.getTime() + 30 * D), items: { create: items } } });
      auditsN += 1;
    }
    if (ai < 3) {
      const at = new Date(NOW - (70 + ai * 3) * D);
      const items = COMPL.map((key) => ({ key, label: key, max: 1, score: rnd('compl', area, key) < 0.8 ? 1 : 0 }));
      const score = Math.round((items.reduce((s, x) => s + x.score, 0) / 10) * 100);
      await prisma.processAudit.create({ data: { kind: 'COMPLIANCE', area, auditedAt: at, auditorId: pcm.id, score, actions: 'Treinar equipe no checklist de saída; cobrar código de motivo na fila', nextDueAt: new Date(at.getTime() + 90 * D), items: { create: items } } });
      auditsN += 1;
    }
  }
  console.log(`  ${auditsN} auditorias (5S e conformidade)`);

  // ---- Componentes rastreáveis com vida por km (Kaizen) — carga inicial ASSUMIDA ----
  // Cada carro leva os componentes do seu tipo de tração; parte já passou da vida, parte
  // teve troca anterior (com vida real menor que a esperada quando foi por falha).
  const CMP: Record<string, { lifeKm: number; diesel: boolean; ebus: boolean }> = {
    COMPRESSOR: { lifeKm: 300_000, diesel: true, ebus: true },
    TURBINA: { lifeKm: 350_000, diesel: true, ebus: false },
    BICO_INJETOR: { lifeKm: 250_000, diesel: true, ebus: false },
    CUBO_RODA: { lifeKm: 400_000, diesel: true, ebus: true },
    MOTOR_PARTIDA: { lifeKm: 300_000, diesel: true, ebus: false },
    ALTERNADOR: { lifeKm: 200_000, diesel: true, ebus: false },
    BATERIA_TRACAO: { lifeKm: 600_000, diesel: false, ebus: true },
  };
  type CmpRow = { vehicleId: string; kind: string; serialNumber: string | null; installedAt: Date; installedAtKm: number; expectedLifeKm: number; installReason: string; removedAt?: Date; removedAtKm?: number; removalReason?: string };
  const cmpRows: CmpRow[] = [];
  for (const v of VEHICLES) {
    const isEbus = v.technology === VehicleTechnology.EBUS;
    const daily = Math.max(60, v.avgDailyKm);
    for (const [kind, def] of Object.entries(CMP)) {
      if (isEbus ? !def.ebus : !def.diesel) continue;
      const usedKm = Math.min(v.currentKm, Math.round(def.lifeKm * Math.pow(rnd('cmp', v.code, kind), 1.1) * 1.15));
      const installedAtKm = v.currentKm - usedKm;
      const installedAt = new Date(NOW - Math.round(usedKm / daily) * D);
      const replaced = installedAtKm > def.lifeKm * 0.4 && rnd('cmpPrev', v.code, kind) < 0.55;
      cmpRows.push({ vehicleId: vid(v.code), kind, serialNumber: `${kind.slice(0, 3)}-${v.code}${Math.floor(rnd('cmpSn', v.code, kind) * 900 + 100)}`, installedAt, installedAtKm, expectedLifeKm: def.lifeKm, installReason: replaced ? (rnd('cmpWhy', v.code, kind) < 0.6 ? 'FALHA' : 'PREVENTIVA') : 'INICIAL' });
      if (replaced) {
        const realLife = Math.round(def.lifeKm * (0.5 + rnd('cmpLife', v.code, kind) * 0.65));
        cmpRows.push({ vehicleId: vid(v.code), kind, serialNumber: null, installedAt: new Date(installedAt.getTime() - Math.round(realLife / daily) * D), installedAtKm: Math.max(0, installedAtKm - realLife), expectedLifeKm: def.lifeKm, installReason: 'INICIAL', removedAt: installedAt, removedAtKm: installedAtKm, removalReason: realLife < def.lifeKm * 0.9 ? 'FALHA' : 'PREVENTIVA' });
      }
    }
  }
  for (let i = 0; i < cmpRows.length; i += 500) await prisma.vehicleComponent.createMany({ data: cmpRows.slice(i, i + 500) });
  console.log(`  ${cmpRows.length} componentes rastreados (${cmpRows.filter((r) => !r.removedAt).length} em uso)`);

  // ---- Laboratório de inspeção de peças: exemplos para a conversa de garantia -----
  const labItems = [
    { term: 'CUICA FREIO DIANT 1721', reason: 'FALHA_PREMATURA', km: 18_400, warranty: true, claim: 'OPENED', note: 'Diafragma rompido com 18 mil km; dentro da garantia de 12 meses', hours: 30 },
    { term: 'ALTERNADOR 80A 1721/O500 REC', reason: 'FALHA_PREMATURA', km: 9_200, warranty: true, claim: 'ACCEPTED', note: 'Regulador de tensão falhou; fornecedor aceitou a troca', hours: 26 * 24 },
    { term: 'FILTRO SEPARADOR AGUA MBB', reason: 'FORA_DE_ESPEC', km: null, warranty: true, claim: 'DENIED', note: 'Rosca fora de medida no recebimento; fornecedor alegou lote correto', hours: 40 * 24 },
    { term: 'CORREIA VENTI O500 2X13X1610', reason: 'DANO_TRANSPORTE', km: null, warranty: true, claim: 'OPENED', note: 'Embalagem amassada, correia com corte', hours: 6 * 24 },
    { term: 'FILTRO ANTI POLEN EBERSPACHER', reason: 'DESGASTE_NORMAL', km: 31_000, warranty: false, claim: 'NONE', note: 'Saturado após 31 mil km: desgaste normal, sem reclamação', hours: 12 * 24 },
  ];
  let labCount = 0;
  for (const it of labItems) {
    const m = materials.find((x) => x.description.startsWith(it.term));
    if (!m) continue;
    await prisma.partInspection.create({
      data: { materialId: m.id, supplierId: (await prisma.material.findUnique({ where: { id: m.id }, select: { supplierId: true } }))?.supplierId ?? null, vehicleId: vid(pick(runners, 'lab', it.term).code), quantity: 1, result: it.reason === 'DESGASTE_NORMAL' ? 'APPROVED' : 'REJECTED', reason: it.reason, kmInService: it.km, underWarranty: it.warranty, claimStatus: it.claim, note: it.note, inspectedById: estoque.id, inspectedAt: ago(it.hours) },
    });
    labCount += 1;
  }
  console.log(`  ${labCount} inspeções de peça no laboratório`);

  // ---- Checklist diário de hoje: a maior parte da frota em linha já saiu com checklist feito ----
  const CHECK_ITEMS: [string, string, boolean][] = [
    ['FAROIS', 'Faróis e lanternas', false], ['LIMPADORES', 'Limpadores e lavador', false], ['ILUMINACAO', 'Iluminação interna', false],
    ['AVARIAS', 'Avarias externas', false], ['PNEUS', 'Pneus e rodas', false], ['PORTAS_RAMPA', 'Portas e rampa', false],
    ['NIVEIS', 'Níveis e vazamentos', false], ['SALAO', 'Salão e bancos', false], ['BTMS', 'BTMS e carga', true],
  ];
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const garageToday = await prisma.failureEvent.findMany({ where: { origin: EventOrigin.GARAGE, reportedAt: { gte: new Date(todayStart) } }, select: { id: true, vehicleId: true, catalogItem: { select: { description: true } } }, take: 3 });
  const nokVehicles = new Set(garageToday.map((e) => e.vehicleId));
  let checksN = 0;
  for (const v of runners) {
    const id = vid(v.code);
    const nokEvent = garageToday.find((e) => e.vehicleId === id);
    if (!nokEvent && rnd('check', v.code) > 0.72) continue; // ainda não saiu / não registrou
    const at = new Date(todayStart + (4 * H) + Math.floor(rnd('checkAt', v.code) * 150) * 60_000);
    if (at.getTime() > NOW) continue;
    const items = CHECK_ITEMS.filter(([, , ebusOnly]) => !ebusOnly || v.technology === VehicleTechnology.EBUS);
    const nokKey = nokEvent ? 'AVARIAS' : null;
    await prisma.dailyCheck.create({
      data: {
        vehicleId: id, checkedAt: at, checkedById: admin.id, operatorId: motoristas[Math.floor(rnd('checkOp', v.code) * motoristas.length)]?.id ?? null,
        result: nokEvent ? 'NOK' : 'OK', eventId: nokEvent?.id ?? null,
        note: nokEvent ? `Checklist diário reprovado: ${nokEvent.catalogItem?.description ?? 'anomalia'}` : null,
        items: { create: items.map(([key, label]) => ({ key, label, ok: key !== nokKey })) },
      },
    });
    checksN += 1;
  }
  console.log(`  ${checksN} checklists diários de hoje (${nokVehicles.size} reprovados)`);

  // ---- Kaizen 16: sub-OS abertas com técnico responsável, por especialidade ------
  const technicians = await prisma.technician.findMany({ where: { isActive: true } });
  const openTasks = await prisma.workOrderTask.findMany({ where: { technicianId: null, workOrder: { status: { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] } } }, select: { id: true, specialtyId: true } });
  const rr: Record<string, number> = {};
  for (const task of openTasks) {
    const pool = technicians.filter((t) => t.specialtyId === task.specialtyId);
    if (!pool.length) continue;
    rr[task.specialtyId] = (rr[task.specialtyId] ?? 0) + 1;
    await prisma.workOrderTask.update({ where: { id: task.id }, data: { technicianId: pool[rr[task.specialtyId]! % pool.length]!.id } });
  }
  // ---- Kaizen 6: uma OS executada por terceiro, para a governança ter exemplo ------
  const thirdParty = await prisma.workOrder.findFirst({ where: { status: WorkOrderStatus.IN_PROGRESS, event: { catalogItem: { code: 'MEC-MOT-01' } } }, orderBy: { openedAt: 'asc' } });
  if (thirdParty) await prisma.workOrder.update({ where: { id: thirdParty.id }, data: { execution: 'THIRD_PARTY', supplierName: 'Retífica externa (mock)' } });

  const byStatus = await prisma.vehicle.groupBy({ by: ['status'], _count: { _all: true } });
  console.log('Seed de demonstração concluído.');
  console.log('  frota agora: ' + byStatus.map((s) => `${s.status} ${s._count._all}`).join(', '));
  console.log(`  cenários: fora ${S.off.code} · peça ${S.cuica.code} · inspeção ${S.insp.code} · limpeza ${S.clean.code} · execução ${S.apu.code} · fila ${S.porta.code} · socorro ${S.alt.code} · triagem ${S.ac.code} · preventiva ${S.prev1.code}/${S.prev2.code}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
