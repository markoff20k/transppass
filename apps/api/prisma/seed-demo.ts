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
 * Seed de DEMONSTRAÇÃO — uma garagem inteira em movimento, como no modo mock.
 *
 * Roda depois do seed base (`npm run db:seed`) e escreve direto nas tabelas:
 * 13 carros, seis meses de leituras de km e de eventos (para MKBF, eventos
 * por dia e disponibilidade por hora), OS abertas em cada etapa do fluxo,
 * fila com histórico, materiais aguardando peça, preventivas com kit e
 * equipe, plantão com janela correndo, notificações.
 *
 * É idempotente do jeito bruto: apaga TODO o movimento (eventos, OS, fila,
 * leituras, paradas, demandas, notificações) e recria. Cadastros ficam.
 * Nunca rode em produção com dados reais.
 */

const prisma = new PrismaClient();

const H = 3_600_000;
const D = 24 * H;
const NOW = Date.now();
const ago = (hours: number) => new Date(NOW - hours * H);
const inHours = (hours: number) => new Date(NOW + hours * H);

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

const LINES = ['8012', '2290', '3720', '875A-10', '6262', '4111'] as const;

interface VehicleSpec {
  code: string;
  plate: string;
  technology: VehicleTechnology;
  kmSource: KmSource;
  manufacturer: string;
  model: string;
  modelYear: number;
  odometerOffset: number;
  status: VehicleStatus;
  currentKm: number;
  avgDailyKm: number;
  /** Dias sem leitura (projeção degradada acima de 2). */
  staleDays: number;
}

const VEHICLES: VehicleSpec[] = [
  { code: '10001', plate: 'ABC1D23', technology: 'DIESEL', kmSource: 'MANUAL', manufacturer: 'Mercedes-Benz', model: 'O-500U', modelYear: 2021, odometerOffset: 0, status: 'IN_LINE', currentKm: 184_320, avgDailyKm: 218.4, staleDays: 0 },
  { code: '10002', plate: 'ABC1D24', technology: 'DIESEL', kmSource: 'MANUAL', manufacturer: 'Mercedes-Benz', model: 'O-500U', modelYear: 2020, odometerOffset: 12_500, status: 'IN_MAINTENANCE', currentKm: 241_870, avgDailyKm: 195.2, staleDays: 0 },
  { code: '10003', plate: 'ABC1D25', technology: 'DIESEL', kmSource: 'MANUAL', manufacturer: 'Mercedes-Benz', model: 'O-500U', modelYear: 2019, odometerOffset: 0, status: 'AWAITING_PART', currentKm: 312_045, avgDailyKm: 231.7, staleDays: 5 },
  { code: '10004', plate: 'ABC1D26', technology: 'DIESEL', kmSource: 'MANUAL', manufacturer: 'Mercedes-Benz', model: 'O-500U', modelYear: 2021, odometerOffset: 0, status: 'IN_LINE', currentKm: 176_910, avgDailyKm: 224.0, staleDays: 0 },
  { code: '10005', plate: 'ABC1D27', technology: 'DIESEL', kmSource: 'MANUAL', manufacturer: 'Scania', model: 'K270', modelYear: 2020, odometerOffset: 0, status: 'AWAITING_TRIAGE', currentKm: 203_455, avgDailyKm: 209.3, staleDays: 0 },
  { code: '10006', plate: 'ABC1D28', technology: 'DIESEL', kmSource: 'MANUAL', manufacturer: 'Scania', model: 'K270', modelYear: 2020, odometerOffset: 0, status: 'FIELD_SERVICE', currentKm: 198_120, avgDailyKm: 214.8, staleDays: 0 },
  { code: '10007', plate: 'ABC1D29', technology: 'DIESEL', kmSource: 'MANUAL', manufacturer: 'Mercedes-Benz', model: 'O-500U', modelYear: 2022, odometerOffset: 0, status: 'IN_LINE', currentKm: 121_380, avgDailyKm: 227.5, staleDays: 0 },
  { code: '10008', plate: 'ABC1D30', technology: 'DIESEL', kmSource: 'MANUAL', manufacturer: 'Mercedes-Benz', model: 'O-500U', modelYear: 2022, odometerOffset: 0, status: 'IN_INSPECTION', currentKm: 118_940, avgDailyKm: 221.1, staleDays: 0 },
  { code: '20001', plate: 'EBS1A01', technology: 'EBUS', kmSource: 'TELEMETRY', manufacturer: 'VW', model: 'e-Delivery', modelYear: 2025, odometerOffset: 0, status: 'AVAILABLE', currentKm: 42_180, avgDailyKm: 176.5, staleDays: 0 },
  { code: '20002', plate: 'EBS1A02', technology: 'EBUS', kmSource: 'TELEMETRY', manufacturer: 'VW', model: 'e-Delivery', modelYear: 2025, odometerOffset: 0, status: 'IN_CLEANING', currentKm: 38_902, avgDailyKm: 168.9, staleDays: 0 },
  { code: '20003', plate: 'EBS1A03', technology: 'EBUS', kmSource: 'TELEMETRY', manufacturer: 'BYD', model: 'D9W', modelYear: 2024, odometerOffset: 0, status: 'IN_LINE', currentKm: 61_240, avgDailyKm: 181.2, staleDays: 0 },
  { code: '20004', plate: 'EBS1A04', technology: 'EBUS', kmSource: 'TELEMETRY', manufacturer: 'BYD', model: 'D9W', modelYear: 2024, odometerOffset: 0, status: 'AWAITING_MAINTENANCE', currentKm: 57_880, avgDailyKm: 172.6, staleDays: 0 },
  { code: '20005', plate: 'EBS1A05', technology: 'EBUS', kmSource: 'TELEMETRY', manufacturer: 'BYD', model: 'D9W', modelYear: 2024, odometerOffset: 0, status: 'OUT_OF_SERVICE', currentKm: 49_310, avgDailyKm: 0, staleDays: 3 },
];

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
  const SPECIALTY_BY_SYSTEM: Record<string, string> = {
    Elétrica: 'ELE',
    Pneumático: 'PNE',
    Motor: 'MEC',
    Conforto: 'AC',
    Carroceria: 'FUN',
  };

  const reasons = await prisma.reasonCode.findMany();
  const reason = (list: ReasonCodeList, code: string) => {
    const r = reasons.find((x) => x.list === list && x.code === code);
    if (!r) throw new Error(`Motivo ${list}/${code} não existe`);
    return r;
  };

  const materials = await prisma.material.findMany();
  const mat = (code: string) => {
    const m = materials.find((x) => x.code === code);
    if (!m) throw new Error(`Material ${code} não existe`);
    return m;
  };
  const cuica = await prisma.material.upsert({
    where: { code: 'CUI-FR-DT' },
    update: {},
    create: { code: 'CUI-FR-DT', description: 'Cuíca de freio dianteira 24"', unit: 'un', isSerialized: true },
  });

  const dieselPlan = await prisma.maintenancePlan.findFirst({ where: { code: 'PLAN-DIESEL' }, include: { packages: { include: { tasks: true, kits: true } } } });
  const ebusPlan = await prisma.maintenancePlan.findFirst({ where: { code: 'PLAN-EBUS' }, include: { packages: { include: { tasks: true, kits: true } } } });
  const p1 = dieselPlan?.packages.find((p) => p.code === 'P1');
  const e1 = ebusPlan?.packages.find((p) => p.code === 'E1');
  if (!p1 || !e1) throw new Error('Planos preventivos do seed base não encontrados');

  const operators = await prisma.operator.findMany({ orderBy: { registration: 'asc' } });
  const opB = operators.find((o) => o.registration === '30877') ?? operators[0]!;
  const opC = operators.find((o) => o.registration === '31105') ?? operators[0]!;

  // ---- Limpeza do movimento anterior --------------------------------------
  await prisma.notification.deleteMany();
  await prisma.replacementDemand.deleteMany();
  await prisma.toolLoan.deleteMany();
  await prisma.poolMovement.deleteMany();
  await prisma.materialRequest.deleteMany();
  await prisma.queueEntry.deleteMany();
  await prisma.workOrder.deleteMany();
  await prisma.scheduledMaintenance.deleteMany();
  await prisma.vehicleBacklogItem.deleteMany();
  await prisma.failureEvent.deleteMany();
  await prisma.odometerReading.deleteMany();
  await prisma.kmProjection.deleteMany();
  await prisma.metricSnapshot.deleteMany();
  await prisma.poolComponent.updateMany({ data: { status: PoolComponentStatus.IN_STOCK, currentVehicleId: null } });

  // ---- Frota ---------------------------------------------------------------
  const garage = await prisma.garage.findFirst();
  const vehicleIds = new Map<string, string>();
  for (const v of VEHICLES) {
    const { avgDailyKm: _avg, staleDays: _stale, ...data } = v;
    void _avg;
    void _stale;
    const row = await prisma.vehicle.upsert({
      where: { code: v.code },
      update: { ...data, lastReadingAt: ago(v.staleDays * 24 + 2), garageId: garage?.id, isActive: true },
      create: { ...data, lastReadingAt: ago(v.staleDays * 24 + 2), garageId: garage?.id },
    });
    vehicleIds.set(v.code, row.id);
  }
  const vid = (code: string) => vehicleIds.get(code)!;
  console.log(`  ${VEHICLES.length} carros`);

  // ---- Seis meses de leituras de km (a base do MKBF e da projeção) --------
  const DAYS = 185;
  const readings: { vehicleId: string; rawKm: number; adjustedKm: number; deltaKm: number | null; readAt: Date; source: KmSource; enteredById: string }[] = [];
  for (const v of VEHICLES) {
    if (v.avgDailyKm === 0) continue;
    // Do presente para trás: a leitura de hoje é o km atual.
    let km = v.currentKm;
    const rows: { day: number; km: number }[] = [];
    for (let day = v.staleDays; day < DAYS; day += 1) {
      rows.push({ day, km });
      const date = new Date(NOW - day * D);
      const weekend = date.getDay() === 0 || date.getDay() === 6;
      const delta = Math.round(v.avgDailyKm * (weekend ? 0.55 : 1) * (0.82 + 0.36 * rnd(v.code, day)));
      km -= delta;
    }
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i]!;
      const older = rows[i + 1];
      readings.push({
        vehicleId: vid(v.code),
        rawKm: r.km - v.odometerOffset,
        adjustedKm: r.km,
        deltaKm: older ? r.km - older.km : null,
        readAt: new Date(NOW - r.day * D - 2 * H),
        source: v.kmSource,
        enteredById: v.kmSource === KmSource.MANUAL ? pcm.id : admin.id,
      });
    }
  }
  await prisma.odometerReading.createMany({ data: readings });
  console.log(`  ${readings.length} leituras de km`);

  for (const v of VEHICLES) {
    await prisma.kmProjection.create({
      data: {
        vehicleId: vid(v.code),
        avgDailyKm: v.avgDailyKm,
        projectedKm: v.currentKm + Math.round(v.avgDailyKm * 1.5),
        projectedAt: new Date(NOW),
        lastReadingAt: ago(v.staleDays * 24 + 2),
        isDegraded: v.staleDays > 2,
        degradedSince: v.staleDays > 2 ? ago((v.staleDays - 2) * 24) : null,
        sampleDays: 30,
      },
    });
  }

  // ---- Seis meses de eventos encerrados (MKBF, eventos por dia, SLA) ------
  type Hist = {
    reportedAt: Date;
    vehicle: VehicleSpec;
    catalogCode: string;
    kind: 'deferred' | 'field' | 'shop';
    line: string;
  };
  const history: Hist[] = [];
  const CATALOG_CODES = ['ELE-ALT-01', 'PNE-APU-01', 'PNE-CUI-01', 'MEC-MOT-01', 'AC-CLI-01', 'CAR-POR-01'];
  for (let day = 1; day <= DAYS; day += 1) {
    const r = rnd('events', day);
    const n = r < 0.3 ? 0 : r < 0.82 ? 1 : 2;
    for (let i = 0; i < n; i += 1) {
      const k = rnd('kind', day, i);
      const catalogCode = pick(CATALOG_CODES, 'cat', day, i);
      const safety = cat(catalogCode).isSafety;
      // Falha de segurança não pode ser deferida (RF-05).
      const kind: Hist['kind'] = !safety && k < 0.42 ? 'deferred' : k < 0.76 ? 'field' : 'shop';
      history.push({
        reportedAt: new Date(NOW - day * D - (5 + Math.floor(rnd('hour', day, i) * 15)) * H),
        vehicle: pick(VEHICLES.filter((v) => v.avgDailyKm > 0), 'veh', day, i),
        catalogCode,
        kind,
        line: pick(LINES, 'line', day, i),
      });
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

    if (h.kind === 'deferred') {
      const ev = await prisma.failureEvent.create({
        data: {
          code: eventCode(), vehicleId: vid(h.vehicle.code), catalogItemId: item.id, origin: EventOrigin.CCO,
          status: EventStatus.DEFERRED, reportedById: cco.id, reportedAt: h.reportedAt, lineCode: h.line,
          isUnscheduledReturn: false, closedAt: decidedAt,
          triage: { create: { destination: TriageDestination.DEFER, decidedById: pcm.id, decidedAt, slaSeconds: sla, reasonCodeId: reason(ReasonCodeList.EVENT_DEFERRAL, rnd('def', t0) < 0.5 ? 'BAIXO' : 'JANELA').id } },
        },
      });
      // Deferido vira backlog; os antigos já foram resolvidos numa preventiva.
      await prisma.vehicleBacklogItem.create({
        data: { vehicleId: vid(h.vehicle.code), description: `${item.description} (deferido na triagem)`, source: BacklogSource.DEFERRED_EVENT, catalogItemId: item.id, createdAt: decidedAt, resolvedAt: t0 < NOW - 20 * D ? new Date(t0 + 12 * D) : null },
      });
      void ev;
      continue;
    }

    if (h.kind === 'field') {
      const dispatched = new Date(decidedAt.getTime() + 5 * 60_000);
      const arrived = new Date(dispatched.getTime() + (20 + rnd('arr', t0) * 40) * 60_000);
      const started = new Date(arrived.getTime() + 5 * 60_000);
      const finished = new Date(started.getTime() + (25 + rnd('fin', t0) * 70) * 60_000);
      await prisma.failureEvent.create({
        data: {
          code: eventCode(), vehicleId: vid(h.vehicle.code), catalogItemId: item.id, origin: EventOrigin.OPERATOR,
          status: EventStatus.CLOSED, reportedById: cco.id, reportedAt: h.reportedAt, lineCode: h.line,
          locationDescription: pick(['Terminal Barra Funda', 'Av. Marginal, km 12', 'Ponto final da linha', 'Av. Paulista, 1500'], 'loc', t0),
          isUnscheduledReturn: true, closedAt: finished,
          triage: { create: { destination: TriageDestination.FIELD, decidedById: cco.id, decidedAt, slaSeconds: sla } },
          fieldService: { create: { dispatchedAt: dispatched, arrivedAt: arrived, startedAt: started, finishedAt: finished, supportVehicleCode: pick(['APOIO-1', 'APOIO-2'], 'apoio', t0), confirmedCatalogItemId: item.id, outcome: rnd('out', t0) < 0.8 ? FieldOutcome.RESOLVED_IN_FIELD : FieldOutcome.RETURNED_UNDER_OWN_POWER } },
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
        code: eventCode(), vehicleId: vid(h.vehicle.code), catalogItemId: item.id, origin: EventOrigin.CCO,
        status: EventStatus.CLOSED, reportedById: cco.id, reportedAt: h.reportedAt, lineCode: h.line,
        isUnscheduledReturn: true, closedAt: released,
        triage: { create: { destination: TriageDestination.RECALL, decidedById: pcm.id, decidedAt, slaSeconds: sla } },
      },
    });
    const wo = await prisma.workOrder.create({
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
    void wo;
  }
  console.log(`  ${history.length} eventos históricos (${shopCount} OS liberadas, ${inspections} inspeções)`);

  // ---- A garagem AGORA ------------------------------------------------------
  // Ordem cronológica dos eventos abertos, para os códigos seguirem a sequência.
  const openEvents: { key: string; hoursAgo: number; vehicle: string; catalogCode: string; line: string; origin: EventOrigin }[] = [
    { key: 'off', hoursAgo: 72, vehicle: '20005', catalogCode: 'MEC-MOT-01', line: '6262', origin: EventOrigin.GARAGE },
    { key: 'cuica', hoursAgo: 31.5, vehicle: '10003', catalogCode: 'PNE-CUI-01', line: '8012', origin: EventOrigin.CCO },
    { key: 'insp', hoursAgo: 9.5, vehicle: '10008', catalogCode: 'MEC-MOT-01', line: '4111', origin: EventOrigin.OPERATOR },
    { key: 'clean', hoursAgo: 7.4, vehicle: '20002', catalogCode: 'AC-CLI-01', line: '2290', origin: EventOrigin.OPERATOR },
    { key: 'apu', hoursAgo: 4.6, vehicle: '10002', catalogCode: 'PNE-APU-01', line: '2290', origin: EventOrigin.CCO },
    { key: 'porta', hoursAgo: 3.4, vehicle: '20004', catalogCode: 'CAR-POR-01', line: '3720', origin: EventOrigin.OPERATOR },
    { key: 'alt', hoursAgo: 1.3, vehicle: '10006', catalogCode: 'ELE-ALT-01', line: '8012', origin: EventOrigin.OPERATOR },
    { key: 'ac', hoursAgo: 0.4, vehicle: '10005', catalogCode: 'AC-CLI-01', line: '875A-10', origin: EventOrigin.OPERATOR },
  ];
  const ev: Record<string, { id: string; vehicleId: string; reportedAt: Date }> = {};
  for (const o of openEvents) {
    const item = cat(o.catalogCode);
    const row = await prisma.failureEvent.create({
      data: {
        code: eventCode(), vehicleId: vid(o.vehicle), catalogItemId: item.id, origin: o.origin,
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

  // 20005 — fora de operação: evento deferido (aguarda vistoria), vira backlog.
  await prisma.failureEvent.update({ where: { id: E('off').id }, data: { status: EventStatus.DEFERRED, closedAt: ago(71), triage: { create: { destination: TriageDestination.DEFER, decidedById: pcm.id, decidedAt: ago(71), slaSeconds: 3600, reasonCodeId: reason(ReasonCodeList.EVENT_DEFERRAL, 'BAIXO').id, note: 'Carro fora de operação até a vistoria da seguradora' } } } });
  await prisma.vehicleBacklogItem.create({ data: { vehicleId: vid('20005'), description: 'Vistoria da seguradora e reparo de funilaria (lateral esquerda)', source: BacklogSource.MANUAL, createdAt: ago(71) } });

  // 10005 — aguardando triagem: só o registro, há 25 minutos.

  // 10006 — socorro em campo: chegou, ainda não começou o reparo.
  await prisma.failureEvent.update({ where: { id: E('alt').id }, data: { status: EventStatus.FIELD_SERVICE, triage: { create: { destination: TriageDestination.FIELD, decidedById: cco.id, decidedAt: ago(1.2), slaSeconds: 6 * 60 } }, fieldService: { create: { dispatchedAt: ago(1.1), arrivedAt: ago(0.7), supportVehicleCode: 'APOIO-2' } } } });

  // 10003 — aguardando peça há 31,5h: OS parada por material, fila em 1º com histórico.
  const woCuica = await prisma.workOrder.create({
    data: {
      code: woCode(), vehicleId: vid('10003'), type: WorkOrderType.CORRECTIVE, status: WorkOrderStatus.WAITING_PART, eventId: E('cuica').id,
      openedAt: ago(31.2), estimatedCompletionAt: ago(6), createdById: pcm.id,
      downtimeSegments: { create: [
        { cause: DowntimeCause.QUEUE, startedAt: ago(31.2), endedAt: ago(29.7), minutes: 90 },
        { cause: DowntimeCause.EXECUTION, startedAt: ago(29.7), endedAt: ago(27.9), minutes: 110 },
        { cause: DowntimeCause.MATERIAL, startedAt: ago(27.9) },
      ] },
      tasks: { create: [{
        code: 'S01', specialtyId: spec('PNE').id, description: 'Substituir cuíca de freio dianteira', status: TaskStatus.BLOCKED_BY_MATERIAL, assignedToId: manut.id, startedAt: ago(29.7),
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
  const mrCuica = await prisma.materialRequest.create({
    data: { workOrderId: woCuica.id, workOrderTaskId: woCuica.tasks[0]!.id, materialId: cuica.id, quantity: 1, status: MaterialRequestStatus.WAITING_PART, requestedById: manut.id, requestedAt: ago(28.5),
      partWaiting: { create: { reasonCodeId: reason(ReasonCodeList.PART_WAITING, 'COMPRA').id, expectedAt: ago(20), escalatedAt: ago(2), createdAt: ago(27.9) } } },
  });
  void mrCuica;
  const qCuica = await prisma.queueEntry.create({ data: { vehicleId: vid('10003'), eventId: E('cuica').id, workOrderId: woCuica.id, position: 1, criticality: 100, isFastTrack: true, status: QueueStatus.WAITING, enteredAt: ago(31.5), estimatedCompletionAt: inHours(4) } });
  await prisma.queueChangeLog.createMany({ data: [
    { queueEntryId: qCuica.id, fromPosition: null, toPosition: 1, reasonCodeId: reason(ReasonCodeList.QUEUE_PRIORITY, 'SEG').id, isSystemGenerated: true, note: 'Fast-track automático por flag do catálogo', createdAt: ago(31.5) },
    { queueEntryId: qCuica.id, fromPosition: 2, toPosition: 1, reasonCodeId: reason(ReasonCodeList.QUEUE_PRIORITY, 'SEG').id, actorId: pcm.id, note: 'Falha de freio — não pode esperar', createdAt: ago(20) },
  ] });

  // 10008 — em inspeção: sub-OS concluída, inspetor no carro.
  const woInsp = await prisma.workOrder.create({
    data: {
      code: woCode(), vehicleId: vid('10008'), type: WorkOrderType.CORRECTIVE, status: WorkOrderStatus.IN_INSPECTION, eventId: E('insp').id,
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
      queueEntry: { create: { vehicleId: vid('10008'), eventId: E('insp').id, position: 1, criticality: 100, isFastTrack: false, status: QueueStatus.DONE, enteredAt: ago(9.1), startedAt: ago(8.3), finishedAt: ago(0.9) } },
    },
  });
  await prisma.failureEvent.update({ where: { id: E('insp').id }, data: { status: EventStatus.IN_MAINTENANCE, triage: { create: { destination: TriageDestination.RECALL, decidedById: cco.id, decidedAt: ago(9.3), slaSeconds: 11 * 60 } } } });
  void woInsp;

  // 20002 — em limpeza: tudo aprovado, checklist da limpeza pela metade.
  const woClean = await prisma.workOrder.create({
    data: {
      code: woCode(), vehicleId: vid('20002'), type: WorkOrderType.CORRECTIVE, status: WorkOrderStatus.IN_CLEANING, eventId: E('clean').id,
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
      queueEntry: { create: { vehicleId: vid('20002'), eventId: E('clean').id, position: 1, criticality: 40, isFastTrack: false, status: QueueStatus.DONE, enteredAt: ago(7), startedAt: ago(6.4), finishedAt: ago(1.4) } },
    },
    include: { cleaning: { include: { damageReports: true } } },
  });
  await prisma.failureEvent.update({ where: { id: E('clean').id }, data: { status: EventStatus.IN_MAINTENANCE, triage: { create: { destination: TriageDestination.RECALL, decidedById: cco.id, decidedAt: ago(7.2), slaSeconds: 9 * 60 } } } });
  await prisma.vehicleBacklogItem.create({ data: { vehicleId: vid('20002'), description: 'Banco 12 com estofado rasgado (avaria da limpeza)', source: BacklogSource.CLEANING, cleaningDamageReportId: woClean.cleaning!.damageReports[0]!.id, createdAt: ago(0.3) } });

  // 10002 — em manutenção há 4,2h: S01 em andamento, S02 aprovada; material separado e outro pedido.
  const woApu = await prisma.workOrder.create({
    data: {
      code: woCode(), vehicleId: vid('10002'), type: WorkOrderType.CORRECTIVE, status: WorkOrderStatus.IN_PROGRESS, eventId: E('apu').id,
      openedAt: ago(4.2), estimatedCompletionAt: inHours(1.5), createdById: pcm.id, jbWorkOrderNumber: 'JB-88213',
      downtimeSegments: { create: [
        { cause: DowntimeCause.QUEUE, startedAt: ago(4.2), endedAt: ago(3.8), minutes: 24 },
        { cause: DowntimeCause.EXECUTION, startedAt: ago(3.8) },
      ] },
      tasks: { create: [
        { code: 'S01', specialtyId: spec('PNE').id, description: 'Substituir válvula APU', status: TaskStatus.IN_PROGRESS, assignedToId: manut.id, startedAt: ago(3.5),
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
    { workOrderId: woApu.id, workOrderTaskId: s01.id, materialId: mat('VAL-APU-01').id, quantity: 1, status: MaterialRequestStatus.SEPARATED, requestedById: manut.id, requestedAt: ago(3.9), separatedById: estoque.id, separatedAt: ago(2.5), serialNumber: 'APU-77812' },
    { workOrderId: woApu.id, workOrderTaskId: s01.id, materialId: mat('FIL-AR-01').id, quantity: 2, status: MaterialRequestStatus.REQUESTED, requestedById: manut.id, requestedAt: ago(1.2) },
  ] });
  await prisma.queueEntry.create({ data: { vehicleId: vid('10002'), eventId: E('apu').id, workOrderId: woApu.id, position: 1, criticality: 100, isFastTrack: true, status: QueueStatus.IN_SERVICE, enteredAt: ago(4.2), startedAt: ago(3.8), estimatedCompletionAt: inHours(1.5) } });

  // 20004 — na fila há 3,1h: OS aberta, esperando valeta.
  const woPorta = await prisma.workOrder.create({
    data: {
      code: woCode(), vehicleId: vid('20004'), type: WorkOrderType.CORRECTIVE, status: WorkOrderStatus.OPEN, eventId: E('porta').id,
      openedAt: ago(3.1), estimatedCompletionAt: inHours(5.5), createdById: pcm.id,
      downtimeSegments: { create: [{ cause: DowntimeCause.QUEUE, startedAt: ago(3.1) }] },
      tasks: { create: [{ code: 'S01', specialtyId: spec('FUN').id, description: 'Regular cilindro e sensor da porta 2', status: TaskStatus.PENDING }] },
      cleaning: { create: { status: CleaningStatus.PENDING } },
    },
  });
  await prisma.failureEvent.update({ where: { id: E('porta').id }, data: { status: EventStatus.IN_MAINTENANCE, triage: { create: { destination: TriageDestination.RECALL, decidedById: cco.id, decidedAt: ago(3.2), slaSeconds: 14 * 60 } } } });
  const qPorta = await prisma.queueEntry.create({ data: { vehicleId: vid('20004'), eventId: E('porta').id, workOrderId: woPorta.id, position: 2, criticality: 60, isFastTrack: false, status: QueueStatus.WAITING, enteredAt: ago(3.1), estimatedCompletionAt: inHours(5.5) } });
  await prisma.queueChangeLog.create({ data: { queueEntryId: qPorta.id, fromPosition: null, toPosition: 2, reasonCodeId: reason(ReasonCodeList.QUEUE_PRIORITY, 'SEG').id, isSystemGenerated: true, note: 'Posição inicial por criticidade', createdAt: ago(3.1) } });

  console.log('  garagem atual: 1 socorro, 1 triagem, 2 na fila, 1 em execução, 1 aguardando peça, 1 em inspeção, 1 em limpeza');

  // ---- Pool, ferramentas ---------------------------------------------------
  const alt2 = await prisma.poolComponent.findUnique({ where: { serialNumber: 'ALT-20432' } });
  const alt3 = await prisma.poolComponent.findUnique({ where: { serialNumber: 'ALT-20433' } });
  if (alt2) {
    await prisma.poolComponent.update({ where: { id: alt2.id }, data: { status: PoolComponentStatus.IN_USE, currentVehicleId: vid('10001') } });
    await prisma.poolMovement.create({ data: { componentId: alt2.id, fromStatus: PoolComponentStatus.IN_STOCK, toStatus: PoolComponentStatus.IN_USE, actorId: manut.id, occurredAt: ago(60), note: 'Instalado no 10001' } });
  }
  if (alt3) {
    await prisma.poolComponent.update({ where: { id: alt3.id }, data: { status: PoolComponentStatus.IN_WORKSHOP } });
    await prisma.poolMovement.create({ data: { componentId: alt3.id, fromStatus: PoolComponentStatus.IN_USE, toStatus: PoolComponentStatus.IN_WORKSHOP, actorId: estoque.id, occurredAt: ago(30), note: 'Enviado para recuperação' } });
  }
  const torq = await prisma.tool.findUnique({ where: { code: 'TORQ-01' } });
  if (torq) await prisma.toolLoan.create({ data: { toolId: torq.id, borrowerId: manut.id, workOrderTaskId: s01.id, loanedAt: ago(2) } });

  // ---- Preventiva: backlog do 10001, duas paradas ---------------------------
  const bl1 = await prisma.vehicleBacklogItem.create({ data: { vehicleId: vid('10001'), description: 'Ar-condicionado sem refrigeração (deferido na triagem)', source: BacklogSource.DEFERRED_EVENT, catalogItemId: cat('AC-CLI-01').id, createdAt: ago(5 * 24) } });
  const bl2 = await prisma.vehicleBacklogItem.create({ data: { vehicleId: vid('10001'), description: 'Banco 7 com estofado rasgado (avaria da limpeza)', source: BacklogSource.CLEANING, createdAt: ago(9 * 24) } });
  await prisma.vehicleBacklogItem.create({ data: { vehicleId: vid('10003'), description: 'Espelho retrovisor direito trincado', source: BacklogSource.INSPECTION, createdAt: ago(12 * 24) } });

  const kitP1 = p1.kits[0];
  const kitE1 = e1.kits[0];
  await prisma.scheduledMaintenance.create({
    data: {
      vehicleId: vid('10001'), packageId: p1.id, targetKm: 187_500, projectedDate: inHours(4 * 24), plannedDate: inHours(3 * 24), status: ScheduleStatus.PLANNED, createdAt: ago(3 * 24),
      scopeItems: { create: [...p1.tasks.map((t) => ({ maintenanceTaskId: t.id })), { backlogItemId: bl1.id }, { backlogItemId: bl2.id }] },
      reschedules: { create: [{ fromDate: ago(24), toDate: inHours(3 * 24), reasonCodeId: reason(ReasonCodeList.SCHEDULE_RESCHEDULE, 'MAT').id, actorId: pcm.id, note: 'Filtro de combustível em falta no estoque', createdAt: ago(2 * 24) }] },
      ...(kitP1 ? { kitSeparation: { create: { kitId: kitP1.id, status: KitSeparationStatus.PENDING } } } : {}),
    },
  });
  await prisma.scheduledMaintenance.create({
    data: {
      vehicleId: vid('20002'), packageId: e1.id, targetKm: 40_000, projectedDate: inHours(6 * 24), plannedDate: inHours(2 * 24), status: ScheduleStatus.CONFIRMED, kitReady: true, teamReserved: true, createdAt: ago(4 * 24),
      scopeItems: { create: e1.tasks.map((t) => ({ maintenanceTaskId: t.id })) },
      reservations: { create: [{ specialtyId: spec('ELE').id, headcount: 2, reservedById: manut.id, reservedAt: ago(20) }] },
      ...(kitE1 ? { kitSeparation: { create: { kitId: kitE1.id, status: KitSeparationStatus.SEPARATED, separatedById: estoque.id, separatedAt: ago(6) } } } : {}),
    },
  });

  // ---- Plantão: três demandas de reposição ---------------------------------
  await prisma.replacementDemand.create({ data: { lineCode: '8012', originVehicleId: vid('10003'), status: ReplacementDemandStatus.OPEN, requestedById: cco.id, requestedAt: ago(0.2), windowEndsAt: inHours(0.47) } });
  await prisma.replacementDemand.create({ data: { lineCode: '2290', originVehicleId: vid('10002'), status: ReplacementDemandStatus.MET, requestedById: cco.id, requestedAt: ago(4.1), windowEndsAt: ago(3.4), metAt: ago(3.9),
    assignments: { create: [{ vehicleId: vid('10004'), operatorId: opB.id, assignedById: cco.id, assignedAt: ago(3.9) }] } } });
  await prisma.replacementDemand.create({ data: { lineCode: '3720', status: ReplacementDemandStatus.MISSED, requestedById: cco.id, requestedAt: ago(26), windowEndsAt: ago(25.3),
    assignments: { create: [{ vehicleId: vid('20003'), operatorId: opC.id, assignedById: cco.id, assignedAt: ago(25.1), returnedAt: ago(18) }] } } });

  // ---- Notificações -----------------------------------------------------
  await prisma.notification.createMany({ data: [
    { role: UserRole.PCM, title: 'Peça com prazo vencido escalonada', body: 'Cuíca de freio dianteira (OS do carro 10003) passou do prazo previsto e foi escalonada ao PCM.', entity: 'MaterialRequest', createdAt: ago(2) },
    { role: UserRole.PCM, title: 'Previsão de conclusão estourada', body: 'A OS do carro 10003 passou da previsão de conclusão. Carro aguardando peça há mais de 24h.', entity: 'WorkOrder', createdAt: ago(6) },
    { role: UserRole.CCO, title: 'Janela de reposição estourada', body: 'Linha 3720 ficou 12 minutos sem reserva designada na janela de 40 min.', entity: 'ReplacementDemand', createdAt: ago(25.3) },
    { role: UserRole.PCM, title: 'Projeção de km degradada', body: 'Carro 10003 está sem leitura de km há 5 dias; a projeção da preventiva está degradada.', entity: 'KmProjection', createdAt: ago(3 * 24) },
    { role: UserRole.ESTOQUE, title: 'Kit para separar em D-1', body: 'Kit 7.500 km diesel do carro 10001: separar até amanhã para a parada programada.', entity: 'KitSeparation', createdAt: ago(1) },
    { role: UserRole.ADMIN, title: 'Inspeção reprovada e sub-OS reaberta', body: 'S02 da OS do carro 10002 reprovada (tensão de correia fora da faixa) e reaberta.', entity: 'Inspection', createdAt: ago(2.6) },
  ] });

  console.log('Seed de demonstração concluído.');
  console.log('  dashboard: 13 carros, fila, OS em todas as etapas, preventiva, plantão, 6 meses de histórico');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
