import { http, HttpResponse } from 'msw';
import {
  KitSeparationStatus,
  ReplacementDemandStatus,
  ScheduleStatus,
  VehicleStatus,
  type BacklogItemRow,
  type DemandRow,
  type ExpectedReturnRow,
  type KitSeparationRow,
  type KmTimelineRow,
  type OperatorCandidate,
  type OperatorRow,
  type PlanPackageRow,
  type ReserveCandidate,
  type ScheduleDetail,
  type ScheduleSummary,
} from '@app/shared';
import { vehicles } from './fixtures';

/**
 * R2 no modo mock — preventiva (E3) e plantão (E6).
 * Leitura com dados plausíveis; escritas devolvem sucesso e mexem no estado
 * em memória o suficiente para a tela reagir.
 */

const H = 3_600_000;
const DAY = 24 * H;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

const packages: PlanPackageRow[] = [
  { id: 'pkg-1', planId: 'plan-1', planName: 'Plano preventivo — frota diesel', planCode: 'PLAN-DIESEL', planVersion: 1, controlledDocument: 'IT.MAN-01', technology: 'DIESEL', code: 'P1', name: 'Revisão de 7.500 km', intervalKm: 7500, toleranceKm: 500, taskCount: 6, kitId: 'kit-1', kitName: 'Kit 7.500 km diesel' },
  { id: 'pkg-2', planId: 'plan-1', planName: 'Plano preventivo — frota diesel', planCode: 'PLAN-DIESEL', planVersion: 1, controlledDocument: 'IT.MAN-01', technology: 'DIESEL', code: 'P2', name: 'Revisão de 15.000 km', intervalKm: 15000, toleranceKm: 500, taskCount: 11, kitId: 'kit-2', kitName: 'Kit 15.000 km diesel' },
  { id: 'pkg-3', planId: 'plan-2', planName: 'Plano preventivo — eBUS', planCode: 'PLAN-EBUS', planVersion: 1, controlledDocument: 'IT.MAN-54', technology: 'EBUS', code: 'E1', name: 'Revisão de 10.000 km', intervalKm: 10000, toleranceKm: 500, taskCount: 5, kitId: 'kit-3', kitName: 'Kit 10.000 km eBUS' },
];

function nextWindow(km: number, interval: number) {
  return (Math.floor(km / interval) + 1) * interval;
}

const avg: Record<string, number> = { '10001': 218.4, '10002': 195.2, '10003': 231.7, '20001': 176.5, '20002': 168.9 };

function buildTimeline(): KmTimelineRow[] {
  return vehicles.map((v) => {
    const pkg = packages.find((p) => p.technology === v.technology)!;
    const projected = v.currentKm + Math.round((avg[v.code] ?? 200) * 1.5);
    const windowKm = v.code === '10001' ? nextWindow(v.currentKm, 7500) - 7500 + 300 : nextWindow(v.currentKm, pkg.intervalKm);
    const kmTo = windowKm - projected;
    const days = Math.round(kmTo / (avg[v.code] ?? 200));
    const sched = schedules.find((s) => s.vehicleCode === v.code && s.status !== ScheduleStatus.DONE);
    return {
      vehicleId: v.id,
      vehicleCode: v.code,
      vehiclePlate: v.plate,
      technology: v.technology,
      currentKm: v.currentKm,
      projectedKm: projected,
      avgDailyKm: avg[v.code] ?? null,
      isKmDegraded: v.code === '10003',
      nextPackageId: pkg.id,
      nextPackageName: pkg.name,
      nextWindowKm: windowKm,
      kmToWindow: kmTo,
      daysToWindow: days,
      projectedWindowDate: iso(days * DAY),
      scheduleId: sched?.id ?? null,
      scheduleStatus: sched?.status ?? null,
      backlogCount: v.code === '10001' ? 2 : v.code === '10003' ? 1 : 0,
      alert: kmTo < 0 ? 'overdue' : kmTo <= 1000 ? 'due-soon' : 'ok',
    };
  });
}

const schedules: ScheduleSummary[] = [
  { id: 'sch-1', status: ScheduleStatus.PLANNED, vehicleCode: '10001', vehiclePlate: 'ABC1D23', packageName: 'Revisão de 7.500 km', targetKm: 187_500, currentKm: 184_320, projectedDate: iso(4 * DAY), plannedDate: iso(3 * DAY), kitReady: false, teamReserved: false, scopeCount: 8, rescheduleCount: 1 },
  { id: 'sch-2', status: ScheduleStatus.CONFIRMED, vehicleCode: '20002', vehiclePlate: 'EBS1A02', packageName: 'Revisão de 10.000 km', targetKm: 40_000, currentKm: 38_902, projectedDate: iso(6 * DAY), plannedDate: iso(2 * DAY), kitReady: true, teamReserved: true, scopeCount: 5, rescheduleCount: 0 },
];

function detail(id: string): ScheduleDetail {
  const s = schedules.find((x) => x.id === id) ?? schedules[0]!;
  const v = vehicles.find((x) => x.code === s.vehicleCode)!;
  const isFirst = s.id === 'sch-1';
  const blocking = [] as string[];
  if (!s.plannedDate) blocking.push('Defina a data da parada');
  if (!s.kitReady) blocking.push('Kit ainda não separado pelo Estoque (RF-25)');
  if (!s.teamReserved) blocking.push('Equipe ainda não reservada pela Manutenção (RF-12)');
  return {
    id: s.id,
    status: s.status,
    vehicleId: v.id,
    vehicleCode: v.code,
    vehiclePlate: v.plate,
    technology: v.technology,
    packageId: isFirst ? 'pkg-1' : 'pkg-3',
    packageName: s.packageName,
    planName: isFirst ? 'Plano preventivo — frota diesel v1' : 'Plano preventivo — eBUS v1',
    targetKm: s.targetKm,
    currentKm: s.currentKm,
    projectedDate: s.projectedDate,
    plannedDate: s.plannedDate,
    createdAt: iso(-3 * DAY),
    kitReady: s.kitReady,
    teamReserved: s.teamReserved,
    canLeaveSchedule: blocking.length === 0,
    blockingReasons: blocking,
    kit: {
      id: `ks-${s.id}`,
      kitId: isFirst ? 'kit-1' : 'kit-3',
      kitName: isFirst ? 'Kit 7.500 km diesel' : 'Kit 10.000 km eBUS',
      status: s.kitReady ? KitSeparationStatus.SEPARATED : KitSeparationStatus.PENDING,
      separatedAt: s.kitReady ? iso(-6 * H) : null,
      confirmedAt: null,
      dueDate: s.plannedDate ? new Date(new Date(s.plannedDate).getTime() - DAY).toISOString() : null,
    },
    scope: isFirst
      ? [
          { id: 'sc-1', kind: 'task', description: 'Troca de óleo e filtro do motor', specialtyName: 'Mecânica', estimatedMinutes: 60 },
          { id: 'sc-2', kind: 'task', description: 'Filtro de ar', specialtyName: 'Mecânica', estimatedMinutes: 20 },
          { id: 'sc-3', kind: 'task', description: 'Filtro de combustível', specialtyName: 'Mecânica', estimatedMinutes: 25 },
          { id: 'sc-4', kind: 'task', description: 'Inspeção de freios e cuícas', specialtyName: 'Pneus', estimatedMinutes: 45 },
          { id: 'sc-5', kind: 'task', description: 'Verificação do sistema de carga', specialtyName: 'Elétrica', estimatedMinutes: 30 },
          { id: 'sc-6', kind: 'task', description: 'Lubrificação de articulações', specialtyName: 'Mecânica', estimatedMinutes: 30 },
          { id: 'sc-7', kind: 'backlog', description: 'Ar-condicionado sem refrigeração (deferido na triagem)', specialtyName: null, estimatedMinutes: null },
          { id: 'sc-8', kind: 'backlog', description: 'Banco 12 com estofado rasgado (avaria da limpeza)', specialtyName: null, estimatedMinutes: null },
        ]
      : [
          { id: 'sc-9', kind: 'task', description: 'Inspeção do pack de baterias', specialtyName: 'Elétrica', estimatedMinutes: 60 },
          { id: 'sc-10', kind: 'task', description: 'Torque das conexões de alta tensão', specialtyName: 'Elétrica', estimatedMinutes: 40 },
          { id: 'sc-11', kind: 'task', description: 'Filtro de ar do inversor', specialtyName: 'Elétrica', estimatedMinutes: 20 },
          { id: 'sc-12', kind: 'task', description: 'Inspeção de freios regenerativos', specialtyName: 'Pneus', estimatedMinutes: 45 },
          { id: 'sc-13', kind: 'task', description: 'Atualização de firmware', specialtyName: 'Elétrica', estimatedMinutes: 30 },
        ],
    reservations: s.teamReserved ? [{ id: 'tr-1', specialtyName: 'Elétrica', headcount: 2, reservedAt: iso(-5 * H) }] : [],
    reschedules: isFirst
      ? [{ id: 'rs-1', fromDate: iso(-1 * DAY), toDate: s.plannedDate!, reasonCode: 'MAT', reasonDescription: 'Falta de material', actorName: 'Analista PCM', note: 'Filtro de combustível em compra', createdAt: iso(-2 * DAY) }]
      : [],
    workOrderId: null,
    workOrderCode: null,
  };
}

const backlog: Record<string, BacklogItemRow[]> = {
  [vehicles[0]!.id]: [
    { id: 'bl-1', description: 'Ar-condicionado sem refrigeração (deferido na triagem)', source: 'DEFERRED_EVENT', createdAt: iso(-10 * DAY), catalogCode: 'AC-CLI-01' },
    { id: 'bl-2', description: 'Banco 12 com estofado rasgado', source: 'CLEANING', createdAt: iso(-4 * DAY), catalogCode: null },
  ],
  [vehicles[2]!.id]: [{ id: 'bl-3', description: 'Ruído no eixo traseiro em baixa velocidade', source: 'INSPECTION', createdAt: iso(-7 * DAY), catalogCode: null }],
};

function kits(): KitSeparationRow[] {
  return schedules.map((s) => {
    const d = detail(s.id);
    const due = d.kit?.dueDate ? new Date(d.kit.dueDate) : null;
    const today = new Date();
    const same = due && due.toDateString() === today.toDateString();
    return {
      id: d.kit!.id,
      scheduleId: s.id,
      vehicleCode: s.vehicleCode,
      packageName: s.packageName,
      kitName: d.kit!.kitName,
      status: d.kit!.status,
      plannedDate: s.plannedDate,
      dueDate: d.kit!.dueDate,
      isDueToday: Boolean(same) && d.kit!.status === KitSeparationStatus.PENDING,
      isLate: Boolean(due && due < today && !same) && d.kit!.status === KitSeparationStatus.PENDING,
      items:
        s.id === 'sch-1'
          ? [
              { materialCode: 'OLEO-15W40', materialDescription: 'Óleo motor 15W40', quantity: 28, unit: 'L' },
              { materialCode: 'FIL-OL-01', materialDescription: 'Filtro de óleo', quantity: 1, unit: 'un' },
              { materialCode: 'FIL-AR-01', materialDescription: 'Filtro de ar motor', quantity: 1, unit: 'un' },
              { materialCode: 'FIL-CB-01', materialDescription: 'Filtro de combustível', quantity: 2, unit: 'un' },
            ]
          : [
              { materialCode: 'FIL-INV-01', materialDescription: 'Filtro de ar do inversor', quantity: 1, unit: 'un' },
              { materialCode: 'GRX-HT-01', materialDescription: 'Graxa dielétrica', quantity: 1, unit: 'un' },
            ],
    };
  });
}

// --- Plantão -----------------------------------------------------------------

const operators: OperatorRow[] = [
  { id: 'op-1', registration: '30412', name: 'Operador de reserva A', isActive: true, technologies: ['DIESEL', 'EBUS'] },
  { id: 'op-2', registration: '30877', name: 'Operador de reserva B', isActive: true, technologies: ['DIESEL'] },
  { id: 'op-3', registration: '31105', name: 'Operador de reserva C', isActive: true, technologies: ['EBUS'] },
  { id: 'op-4', registration: '29980', name: 'Operador de reserva D', isActive: true, technologies: ['DIESEL'] },
];

const demands: DemandRow[] = [
  {
    id: 'dm-1', status: ReplacementDemandStatus.OPEN, lineCode: '8012', originVehicleId: vehicles[2]!.id, originVehicleCode: '10003', originReason: 'Cuíca de freio inoperante',
    requestedAt: iso(-12 * 60_000), windowEndsAt: iso(28 * 60_000), secondsLeft: 28 * 60, metAt: null, assignment: null,
    titularReturn: { workOrderId: 'wo-2', workOrderCode: 'OS-2026-000040', estimatedCompletionAt: iso(-6 * H), status: 'WAITING_PART', isOverdue: true },
  },
  {
    id: 'dm-2', status: ReplacementDemandStatus.ASSIGNED, lineCode: '2290', originVehicleId: vehicles[1]!.id, originVehicleCode: '10002', originReason: 'Válvula APU com vazamento',
    requestedAt: iso(-4.5 * H), windowEndsAt: iso(-4 * H), secondsLeft: -4 * 3600, metAt: iso(-4.2 * H),
    assignment: { id: 'ra-1', vehicleId: 'v-201', vehicleCode: '10004', operatorId: 'op-2', operatorName: 'Operador de reserva B', assignedAt: iso(-4.2 * H), returnedAt: null },
    titularReturn: { workOrderId: 'wo-1', workOrderCode: 'OS-2026-000041', estimatedCompletionAt: iso(1.5 * H), status: 'IN_PROGRESS', isOverdue: false },
  },
  {
    id: 'dm-3', status: ReplacementDemandStatus.MISSED, lineCode: '3720', originVehicleId: null, originVehicleCode: null, originReason: null,
    requestedAt: iso(-26 * H), windowEndsAt: iso(-25.3 * H), secondsLeft: -25.3 * 3600, metAt: iso(-25 * H),
    assignment: { id: 'ra-2', vehicleId: 'v-206', vehicleCode: '20003', operatorId: 'op-3', operatorName: 'Operador de reserva C', assignedAt: iso(-25 * H), returnedAt: iso(-18 * H) },
    titularReturn: null,
  },
];

const reserves: ReserveCandidate[] = [
  { vehicleId: 'v-204', vehicleCode: '10007', vehiclePlate: 'ABC1D29', technology: 'DIESEL', status: VehicleStatus.AVAILABLE },
  { vehicleId: vehicles[3]!.id, vehicleCode: '20001', vehiclePlate: 'EBS1A01', technology: 'EBUS', status: VehicleStatus.AVAILABLE },
];

function returns(): ExpectedReturnRow[] {
  return [
    { workOrderId: 'wo-1', workOrderCode: 'OS-2026-000041', vehicleId: vehicles[1]!.id, vehicleCode: '10002', vehiclePlate: 'ABC1D24', status: 'IN_PROGRESS', estimatedCompletionAt: iso(1.5 * H), isOverdue: false, minutesToReturn: 90, coveredByDemandId: 'dm-2' },
    { workOrderId: 'wo-2', workOrderCode: 'OS-2026-000040', vehicleId: vehicles[2]!.id, vehicleCode: '10003', vehiclePlate: 'ABC1D25', status: 'WAITING_PART', estimatedCompletionAt: iso(-6 * H), isOverdue: true, minutesToReturn: -360, coveredByDemandId: null },
    { workOrderId: 'wo-3', workOrderCode: 'OS-2026-000039', vehicleId: 'v-207', vehicleCode: '20004', vehiclePlate: 'EBS1A04', status: 'OPEN', estimatedCompletionAt: iso(5.5 * H), isOverdue: false, minutesToReturn: 330, coveredByDemandId: null },
  ];
}

export const r2Handlers = [
  http.get('*/api/scheduling/timeline', () => HttpResponse.json(buildTimeline())),
  http.get('*/api/scheduling/packages', () => HttpResponse.json(packages)),
  http.get('*/api/scheduling/kits', () => HttpResponse.json(kits())),
  http.get('*/api/scheduling/backlog/:vehicleId', ({ params }) => HttpResponse.json(backlog[String(params.vehicleId)] ?? [])),
  http.get('*/api/scheduling', () => HttpResponse.json(schedules)),
  http.get('*/api/scheduling/:id', ({ params }) => HttpResponse.json(detail(String(params.id)))),
  http.post('*/api/scheduling', async ({ request }) => {
    const body = (await request.json()) as { vehicleId: string; targetKm: number; plannedDate?: string; backlogItemIds?: string[] };
    const v = vehicles.find((x) => x.id === body.vehicleId);
    const s: ScheduleSummary = {
      id: `sch-${Date.now()}`, status: ScheduleStatus.PLANNED, vehicleCode: v?.code ?? '?', vehiclePlate: v?.plate ?? '', packageName: 'Revisão de 7.500 km',
      targetKm: body.targetKm, currentKm: v?.currentKm ?? 0, projectedDate: iso(5 * DAY), plannedDate: body.plannedDate ?? null,
      kitReady: false, teamReserved: false, scopeCount: 6 + (body.backlogItemIds?.length ?? 0), rescheduleCount: 0,
    };
    schedules.push(s);
    return HttpResponse.json(detail(s.id), { status: 201 });
  }),
  http.post('*/api/scheduling/:id/reschedule', async ({ params, request }) => {
    const body = (await request.json()) as { toDate: string };
    const s = schedules.find((x) => x.id === params.id);
    if (s) { s.plannedDate = body.toDate; s.kitReady = false; s.teamReserved = false; s.status = ScheduleStatus.PLANNED; s.rescheduleCount += 1; }
    return HttpResponse.json(detail(String(params.id)), { status: 201 });
  }),
  http.post('*/api/scheduling/:id/kit/separate', ({ params }) => {
    const s = schedules.find((x) => x.id === params.id);
    if (s) s.kitReady = true;
    return HttpResponse.json(detail(String(params.id)), { status: 201 });
  }),
  http.post('*/api/scheduling/:id/team', ({ params }) => {
    const s = schedules.find((x) => x.id === params.id);
    if (s) s.teamReserved = true;
    return HttpResponse.json(detail(String(params.id)), { status: 201 });
  }),
  http.post('*/api/scheduling/:id/confirm', ({ params }) => {
    const s = schedules.find((x) => x.id === params.id);
    if (s && s.kitReady && s.teamReserved && s.plannedDate) s.status = ScheduleStatus.CONFIRMED;
    else return HttpResponse.json({ statusCode: 400, code: 'BAD_REQUEST', message: 'Kit ainda não separado pelo Estoque (RF-25); Equipe ainda não reservada pela Manutenção (RF-12)', timestamp: new Date().toISOString(), path: '' }, { status: 400 });
    return HttpResponse.json(detail(String(params.id)), { status: 201 });
  }),
  http.post('*/api/scheduling/:id/start', ({ params }) => {
    const s = schedules.find((x) => x.id === params.id);
    if (s) s.status = ScheduleStatus.IN_EXECUTION;
    return HttpResponse.json(detail(String(params.id)), { status: 201 });
  }),

  http.get('*/api/operations/demands', () => HttpResponse.json(demands.map((d) => ({ ...d, secondsLeft: Math.round((new Date(d.windowEndsAt).getTime() - Date.now()) / 1000) })))),
  http.get('*/api/operations/demands/:id', ({ params }) => HttpResponse.json(demands.find((d) => d.id === params.id) ?? demands[0])),
  http.post('*/api/operations/demands', async ({ request }) => {
    const body = (await request.json()) as { lineCode: string; originVehicleId?: string; windowMinutes?: number };
    const v = vehicles.find((x) => x.id === body.originVehicleId);
    const d: DemandRow = {
      id: `dm-${Date.now()}`, status: ReplacementDemandStatus.OPEN, lineCode: body.lineCode, originVehicleId: body.originVehicleId ?? null, originVehicleCode: v?.code ?? null, originReason: null,
      requestedAt: iso(0), windowEndsAt: iso((body.windowMinutes ?? 40) * 60_000), secondsLeft: (body.windowMinutes ?? 40) * 60, metAt: null, assignment: null, titularReturn: null,
    };
    demands.unshift(d);
    return HttpResponse.json(d, { status: 201 });
  }),
  http.post('*/api/operations/demands/:id/assign', async ({ params, request }) => {
    const body = (await request.json()) as { vehicleId: string; operatorId: string };
    const d = demands.find((x) => x.id === params.id);
    const r = reserves.find((x) => x.vehicleId === body.vehicleId);
    const o = operators.find((x) => x.id === body.operatorId);
    if (d && r && o) {
      if (!o.technologies.includes(r.technology)) {
        return HttpResponse.json({ statusCode: 400, code: 'BAD_REQUEST', message: `${o.name} não tem habilitação vigente para ${r.technology === 'EBUS' ? 'eBUS' : 'diesel'}`, timestamp: new Date().toISOString(), path: '' }, { status: 400 });
      }
      const met = new Date(d.windowEndsAt).getTime() >= Date.now();
      d.status = met ? ReplacementDemandStatus.ASSIGNED : ReplacementDemandStatus.MISSED;
      d.metAt = iso(0);
      d.assignment = { id: `ra-${Date.now()}`, vehicleId: r.vehicleId, vehicleCode: r.vehicleCode, operatorId: o.id, operatorName: o.name, assignedAt: iso(0), returnedAt: null };
    }
    return HttpResponse.json(d ?? demands[0], { status: 201 });
  }),
  http.post('*/api/operations/demands/:id/return', ({ params }) => {
    const d = demands.find((x) => x.id === params.id);
    if (d?.assignment) { d.assignment.returnedAt = iso(0); if (d.status === ReplacementDemandStatus.ASSIGNED) d.status = ReplacementDemandStatus.MET; }
    return HttpResponse.json(d ?? demands[0], { status: 201 });
  }),
  http.post('*/api/operations/demands/:id/cancel', ({ params }) => {
    const d = demands.find((x) => x.id === params.id);
    if (d) d.status = ReplacementDemandStatus.CANCELLED;
    return HttpResponse.json(d ?? demands[0], { status: 201 });
  }),
  http.get('*/api/operations/reserves', () => HttpResponse.json(reserves)),
  http.get('*/api/operations/operators', () => HttpResponse.json(operators)),
  http.get('*/api/operations/operators/for-vehicle/:vehicleId', ({ params }) => {
    const r = reserves.find((x) => x.vehicleId === params.vehicleId);
    const list: OperatorCandidate[] = operators
      .filter((o) => !r || o.technologies.includes(r.technology))
      .map((o) => ({ operatorId: o.id, registration: o.registration, name: o.name, technologies: o.technologies }));
    return HttpResponse.json(list);
  }),
  http.get('*/api/operations/returns', () => HttpResponse.json(returns())),
];
