import { http, HttpResponse } from 'msw';
import {
  DowntimeCause,
  EventOrigin,
  EventStatus,
  VehicleStatus,
  type DashboardData,
  type DashboardVehicle,
  type FailureEventSummary,
} from '@app/shared';
import { catalogItems, users, vehicles } from './fixtures';
import { composeFailureCode, describeFailureCode } from '@app/shared';

const delay = () => new Promise((r) => setTimeout(r, 120 + Math.random() * 180));

/**
 * Dashboard e notificações no modo mock.
 *
 * Os números são plausíveis para uma garagem de ônibus urbano — MKBF na faixa
 * de milhares de km, disponibilidade caindo nos picos das 6h e 17h, fila e
 * material como maiores fatias da indisponibilidade (as dores da seção 2 do
 * PRD). Servem para a tela ter o que mostrar, não para tirar conclusão.
 */

const DAY_MS = 86_400_000;
const now = () => new Date();

function monthStart(offset: number): Date {
  const d = now();
  return new Date(d.getFullYear(), d.getMonth() - offset, 1);
}

const MKBF_SERIES = [6_840, 7_120, 6_590, 7_880, 8_210, 8_420];

/** Disponibilidade cai nos picos: saída da manhã e retorno da tarde. */
function availabilityCurve(hour: number): number {
  const peaks = [6, 17];
  const dip = peaks.reduce((acc, p) => acc + Math.exp(-((hour - p) ** 2) / 4) * 0.11, 0);
  const night = hour < 5 || hour > 22 ? 0.04 : 0;
  return Math.max(0.72, Math.min(0.97, 0.93 - dip + night));
}

const extraVehicles: DashboardVehicle[] = [
  {
    id: 'v-201',
    code: '10004',
    plate: 'ABC1D26',
    technology: 'DIESEL',
    vehicleClass: 'BASICO_12M',
    status: VehicleStatus.IN_LINE,
    reason: null,
    hoursInState: null,
  },
  {
    id: 'v-202',
    code: '10005',
    plate: 'ABC1D27',
    technology: 'DIESEL',
    vehicleClass: 'BASICO_12M',
    status: VehicleStatus.AWAITING_TRIAGE,
    reason: 'Ar-condicionado sem refrigeração',
    hoursInState: 0.4,
  },
  {
    id: 'v-203',
    code: '10006',
    plate: 'ABC1D28',
    technology: 'DIESEL',
    vehicleClass: 'BASICO_12M',
    status: VehicleStatus.FIELD_SERVICE,
    reason: 'Alternador não carrega',
    hoursInState: 1.2,
  },
  {
    id: 'v-204',
    code: '10007',
    plate: 'ABC1D29',
    technology: 'DIESEL',
    vehicleClass: 'BASICO_12M',
    status: VehicleStatus.IN_LINE,
    reason: null,
    hoursInState: null,
  },
  {
    id: 'v-205',
    code: '10008',
    plate: 'ABC1D30',
    technology: 'DIESEL',
    vehicleClass: 'BASICO_12M',
    status: VehicleStatus.IN_INSPECTION,
    reason: 'OS OS-2026-000041',
    hoursInState: 5.5,
  },
  {
    id: 'v-206',
    code: '20003',
    plate: 'EBS1A03',
    technology: 'EBUS',
    vehicleClass: 'EPADRON_13M',
    status: VehicleStatus.IN_LINE,
    reason: null,
    hoursInState: null,
  },
  {
    id: 'v-207',
    code: '20004',
    plate: 'EBS1A04',
    technology: 'EBUS',
    vehicleClass: 'EPADRON_13M',
    status: VehicleStatus.AWAITING_MAINTENANCE,
    reason: 'Porta não fecha completamente',
    hoursInState: 3.1,
  },
  {
    id: 'v-208',
    code: '20005',
    plate: 'EBS1A05',
    technology: 'EBUS',
    vehicleClass: 'EPADRON_13M',
    status: VehicleStatus.OUT_OF_SERVICE,
    reason: 'Aguardando vistoria',
    hoursInState: 72,
  },
];

function buildVehicles(): DashboardVehicle[] {
  const base: DashboardVehicle[] = vehicles.map((v) => ({
    id: v.id,
    code: v.code,
    plate: v.plate,
    vehicleClass: v.technology === 'EBUS' ? 'EPADRON_13M' : 'PADRON_13M',
    technology: v.technology,
    status: v.status,
    reason:
      v.status === VehicleStatus.IN_MAINTENANCE
        ? 'Válvula APU com vazamento'
        : v.status === VehicleStatus.AWAITING_PART
          ? 'Cuíca de freio inoperante'
          : v.status === VehicleStatus.IN_CLEANING
            ? 'OS OS-2026-000038'
            : null,
    hoursInState:
      v.status === VehicleStatus.IN_MAINTENANCE
        ? 4.2
        : v.status === VehicleStatus.AWAITING_PART
          ? 31.5
          : v.status === VehicleStatus.IN_CLEANING
            ? 0.6
            : null,
  }));
  return [...base, ...extraVehicles];
}

function recentEvents(): FailureEventSummary[] {
  const items = [
    {
      code: 'EV-2026-000142',
      v: vehicles[2]!,
      cat: catalogItems[2]!,
      status: EventStatus.IN_MAINTENANCE,
      minsAgo: 1_890,
      line: '8012',
    },
    {
      code: 'EV-2026-000141',
      v: vehicles[1]!,
      cat: catalogItems[1]!,
      status: EventStatus.IN_MAINTENANCE,
      minsAgo: 252,
      line: '2290',
    },
    {
      code: 'EV-2026-000140',
      v: vehicles[0]!,
      cat: catalogItems[0]!,
      status: EventStatus.CLOSED,
      minsAgo: 410,
      line: '8012',
    },
    {
      code: 'EV-2026-000139',
      v: vehicles[3]!,
      cat: catalogItems[4]!,
      status: EventStatus.DEFERRED,
      minsAgo: 600,
      line: '3720',
    },
    {
      code: 'EV-2026-000138',
      v: vehicles[4]!,
      cat: catalogItems[5]!,
      status: EventStatus.CLOSED,
      minsAgo: 1_440,
      line: '2290',
    },
  ];

  return items.map((i) => ({
    id: `ev-${i.code}`,
    code: i.code,
    vehicleId: i.v.id,
    vehicleCode: i.v.code,
    vehiclePlate: i.v.plate,
    catalogItemId: i.cat.id,
    catalog: {
      code: i.cat.code,
      description: i.cat.description,
      probableCause: i.cat.probableCause,
      estimatedRepairMinutes: i.cat.estimatedRepairMinutes,
      fieldResolutionRate: i.cat.fieldResolutionRate,
      fieldResolutionSamples: i.cat.fieldResolutionSamples,
      isFastTrack: i.cat.isFastTrack,
      isSafety: i.cat.isSafety,
      isDeferrable: i.cat.isDeferrable,
    },
    failureModeCode: i.cat.failureModeCode,
    subsystemCode: i.cat.subsystemCode,
    position: null,
    failureCode:
      i.cat.failureModeCode && i.cat.subsystemCode
        ? composeFailureCode(i.cat.failureModeCode, i.cat.subsystemCode)
        : null,
    failureLabel: describeFailureCode(i.cat.failureModeCode, i.cat.subsystemCode),
    flags: {
      isFastTrack: i.cat.isFastTrack,
      isSafety: i.cat.isSafety,
      isDeferrable: i.cat.isDeferrable,
      source: 'catalog-item' as const,
    },
    reportedDescription: null,
    origin: EventOrigin.CCO,
    status: i.status,
    reportedAt: new Date(Date.now() - i.minsAgo * 60_000).toISOString(),
    lineCode: i.line,
    locationDescription: null,
    isUnscheduledReturn: i.status !== EventStatus.DEFERRED,
    closedAt: null,
    waitingSeconds: i.minsAgo * 60,
    triage: null,
    fieldService: null,
    workOrderId: null,
    workOrderCode: null,
  }));
}

export function buildDashboard(): DashboardData {
  const vs = buildVehicles();
  const byStatus = Object.fromEntries(Object.values(VehicleStatus).map((s) => [s, 0])) as Record<
    VehicleStatus,
    number
  >;
  for (const v of vs) byStatus[v.status] += 1;
  const available = byStatus.AVAILABLE + byStatus.IN_LINE;

  const eventsPerDay = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * DAY_MS);
    const weekday = d.getDay();
    const base = weekday === 0 || weekday === 6 ? 1 : 3;
    // Determinístico por dia, para a curva não mudar a cada reload.
    const jitter = ((d.getDate() * 7 + d.getMonth() * 3) % 5) - 1;
    return { date: d.toISOString().slice(0, 10), count: Math.max(0, base + jitter) };
  });

  const downtime = [
    { cause: DowntimeCause.QUEUE, minutes: 2_310 },
    { cause: DowntimeCause.MATERIAL, minutes: 1_760 },
    { cause: DowntimeCause.EXECUTION, minutes: 1_490 },
    { cause: DowntimeCause.INSPECTION, minutes: 610 },
    { cause: DowntimeCause.CLEANING, minutes: 405 },
    { cause: DowntimeCause.RELEASE_WAIT, minutes: 205 },
  ];
  const totalDowntime = downtime.reduce((a, b) => a + b.minutes, 0);

  return {
    generatedAt: now().toISOString(),
    period: {
      days: 30,
      from: new Date(now().getTime() - 29 * 86_400_000).toISOString(),
      to: now().toISOString(),
    },
    fleet: {
      total: vs.length,
      available,
      availabilityRate: available / vs.length,
      byStatus,
      availabilityDelta: 2.4,
    },
    mkbf: {
      current: MKBF_SERIES[MKBF_SERIES.length - 1] ?? null,
      series: MKBF_SERIES.map((mkbf, i) => ({
        month: monthStart(MKBF_SERIES.length - 1 - i).toISOString(),
        kmTraveled: mkbf * (11 + (i % 3)),
        unscheduledReturns: 11 + (i % 3),
        mkbf,
      })),
      period: { kmTraveled: 412_300, unscheduledReturns: 106, mkbf: 3_890 },
    },
    availabilityByHour: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      rate: availabilityCurve(hour),
      today: hour <= 17 ? availabilityCurve(hour) - 0.02 : null,
    })),
    downtimeByCause: downtime.map((d) => ({ ...d, share: d.minutes / totalDowntime })),
    totalDowntimeMinutes: totalDowntime,
    eventsPerDay,
    eventsBucket: 'day',
    queue: { waiting: 2, inService: 1, oldestWaitingHours: 3.1 },
    workOrders: { open: 4, overdue: 1, releasedInPeriod: 23, averageDowntimeMinutes: 386 },
    materials: { pending: 3, overdueParts: 1 },
    alerts: { degradedKm: 1, pendingTriage: 1, safetyEventsOpen: 2 },
    backs: {
      mkbf: {
        previous: { kmTraveled: 398_100, unscheduledReturns: 112, mkbf: 3_554 },
        topSystems: [
          { name: 'Motor', count: 31 },
          { name: 'Elétrica', count: 24 },
          { name: 'Portas', count: 17 },
        ],
        worstVehicle: { code: '10003', count: 6 },
      },
      queue: {
        oldest: [
          { code: '10001', hours: 3.1 },
          { code: '10004', hours: 1.4 },
        ],
        averageWaitHours: 2.6,
        enteredToday: 3,
        startedToday: 2,
      },
      workOrders: {
        byStage: {
          open: 1,
          inProgress: 1,
          waitingPart: 1,
          techClosed: 0,
          inInspection: 1,
          inCleaning: 0,
        },
        mostOverdue: { id: 'wo-1', code: 'OS-2026-0392', vehicleCode: '10003', lateHours: 26.2 },
      },
    },
    recentEvents: recentEvents(),
    vehicles: vs,
  };
}

const notifications: {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}[] = [
  {
    id: 'n-1',
    title: 'Previsão de retorno do carro 10002 mudou',
    body: 'Nova previsão de conclusão: hoje, 16:40.',
    createdAt: new Date(Date.now() - 22 * 60_000).toISOString(),
    readAt: null,
  },
  {
    id: 'n-2',
    title: 'Prazo de peça vencido — carro 10003',
    body: 'PNE-CUI-01 — Cuíca de freio. Prazo era ontem (Aguardando compra).',
    createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    readAt: null,
  },
  {
    id: 'n-3',
    title: 'Projeção de km degradada — carro 10003',
    body: 'Sem leitura de odômetro há 5 dias. A projeção segue publicada em modo degradado.',
    createdAt: new Date(Date.now() - 26 * 3_600_000).toISOString(),
    readAt: null,
  },
];

function buildNotices() {
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const items = [
    {
      id: 'rescue:1',
      severity: 'critical',
      kind: 'rescue',
      area: 'Socorro',
      title:
        'Carro 10001 quebrado na linha 8012 (Av. Raimundo Pereira de Magalhães) há 52 min, aguardando socorro há 40 min',
      text: 'Ficha EV-2026-0418: motor sem partida. Registrada às 09:12.',
      to: '/socorro',
      at: ago(52),
      vehicleCode: '10001',
    },
    {
      id: 'wo:1',
      severity: 'critical',
      kind: 'workorders',
      area: 'Oficina',
      title: 'OS OS-2026-0392 do carro 10003 estourou o prazo há 1 dia, parada aguardando peça',
      text: 'Aberta há 3 dias, previsão de conclusão era 20/11, 16:00.',
      to: '/os/wo-1',
      at: ago(26 * 60),
      vehicleCode: '10003',
    },
    {
      id: 'triage:1',
      severity: 'warning',
      kind: 'triage',
      area: 'CCO',
      title: 'Carro 10004 na linha 8056 com porta não fecha aguardando triagem há 14 min',
      text: 'Ficha EV-2026-0421 sem decisão: ninguém disse ainda se o carro recebe socorro, recolhe ou segue viagem.',
      to: '/triagem',
      at: ago(14),
      vehicleCode: '10004',
    },
    {
      id: 'part:1',
      severity: 'warning',
      kind: 'parts',
      area: 'Almoxarifado',
      title:
        'Cuíca de freio dianteira do carro 10003 com prazo vencido há 5 h, OS OS-2026-0392 parada',
      text: 'Motivo da espera: aguardando compra. Escalonada ao PCM há 2 h.',
      to: '/os/wo-1',
      at: ago(5 * 60),
      vehicleCode: '10003',
    },
    {
      id: 'replacement:1',
      severity: 'warning',
      kind: 'replacement',
      area: 'Plantão',
      title: 'Linha 8012 ainda sem carro reserva, janela fecha em 12 min',
      text: 'Troca pedida há 18 min para substituir o carro 10001. Sem reserva a viagem se perde.',
      to: '/plantao',
      at: ago(-12),
      vehicleCode: '10001',
    },
    {
      id: 'preventive:1',
      severity: 'warning',
      kind: 'preventive',
      area: 'PCM',
      title: 'Preventiva Revisão B do carro 10002 vencida desde 18/11, carro rodando',
      text: 'Prevista para 120.000 km e ainda sem parada agendada na oficina.',
      to: '/preventiva',
      at: ago(3 * 24 * 60),
      vehicleCode: '10002',
    },
    {
      id: 'release:1',
      severity: 'good',
      kind: 'release',
      area: 'Oficina',
      title: 'Carro 10005 liberado para a linha há 35 min após 6 h parado',
      text: 'OS OS-2026-0401 encerrada com inspeção aprovada.',
      to: '/os/wo-2',
      at: ago(35),
      vehicleCode: '10005',
    },
  ];
  const counts = { critical: 0, warning: 0, info: 0, good: 0 } as Record<string, number>;
  for (const i of items) counts[i.severity] = (counts[i.severity] ?? 0) + 1;
  return {
    generatedAt: new Date().toISOString(),
    items,
    counts,
    dataThrough: {
      km: '2026-11-18',
      consumption: '2026-11-18',
      failures: '2026-11-18',
      lineDays: '2026-11-18',
    },
  };
}

const WIDGET_SAMPLE: Record<
  string,
  { value: number; previous: number; unit: string; detail: string; higherIsBetter: boolean }
> = {
  mkbf: {
    value: 3890,
    previous: 3554,
    unit: 'km',
    detail: '412.300 km ÷ 106 quebras',
    higherIsBetter: true,
  },
  breakdowns: {
    value: 4,
    previous: 6,
    unit: 'count',
    detail: '13.900 km rodados',
    higherIsBetter: false,
  },
  km: { value: 13900, previous: 13410, unit: 'km', detail: '4 quebras', higherIsBetter: true },
  availability: {
    value: 91.4,
    previous: 89.2,
    unit: 'pct',
    detail: 'carros prontos ÷ frota, amostrado a cada 6 h',
    higherIsBetter: true,
  },
  lostTrips: {
    value: 12,
    previous: 19,
    unit: 'count',
    detail: '2.310 programadas · 0,5% perdidas',
    higherIsBetter: false,
  },
  tripsDone: {
    value: 99.5,
    previous: 99.2,
    unit: 'pct',
    detail: '2.298 de 2.310 viagens',
    higherIsBetter: true,
  },
  downtime: {
    value: 386,
    previous: 412,
    unit: 'minutes',
    detail: '23 OS liberadas',
    higherIsBetter: false,
  },
  woReleased: {
    value: 23,
    previous: 20,
    unit: 'count',
    detail: 'média de 6 h parado por OS',
    higherIsBetter: true,
  },
  woOpened: { value: 25, previous: 22, unit: 'count', detail: '', higherIsBetter: false },
  rescues: {
    value: 3,
    previous: 5,
    unit: 'count',
    detail: '67% resolvidos na rua',
    higherIsBetter: false,
  },
  fieldResolution: {
    value: 66.7,
    previous: 60,
    unit: 'pct',
    detail: '2 de 3 socorros',
    higherIsBetter: true,
  },
  triageSla: {
    value: 6.5,
    previous: 8.1,
    unit: 'minutes',
    detail: '14 triagens · p90 12 min',
    higherIsBetter: false,
  },
  rework: {
    value: 4.2,
    previous: 5.1,
    unit: 'pct',
    detail: '2 reprovações em 48 inspeções',
    higherIsBetter: false,
  },
  consumptionDiesel: {
    value: 2.31,
    previous: 2.27,
    unit: 'kml',
    detail: '312 carros · 9 acima da faixa',
    higherIsBetter: true,
  },
  consumptionEbus: {
    value: 1.12,
    previous: 1.09,
    unit: 'kmkwh',
    detail: '148 carros · 3 acima da faixa',
    higherIsBetter: true,
  },
};

export const dashboardHandlers = [
  http.get('*/api/dashboard/mkbf-series', async ({ request }) => {
    await delay();
    const url = new URL(request.url);
    const bucket = url.searchParams.get('bucket') ?? 'day';
    const from = url.searchParams.get('from') ?? '2026-11-01';
    const to = url.searchParams.get('to') ?? '2026-11-22';
    const points = [];
    let km = 0;
    let ret = 0;
    if (bucket === 'month') {
      MKBF_SERIES.forEach((mkbf, i) => {
        const d = monthStart(MKBF_SERIES.length - 1 - i);
        const kmM = mkbf * (11 + (i % 3));
        km += kmM;
        ret += 11 + (i % 3);
        points.push({
          key: d.toISOString().slice(0, 7),
          kmTraveled: kmM,
          unscheduledReturns: 11 + (i % 3),
          mkbf,
          mkbfToDate: Math.round(km / ret),
        });
      });
    } else {
      const start = new Date(`${from}T12:00:00`);
      const end = new Date(`${to}T12:00:00`);
      for (let d = new Date(start), i = 0; d <= end; d.setDate(d.getDate() + 1), i += 1) {
        const kmD = 13_000 + (i % 5) * 900;
        const r = i % 4 === 3 ? 5 : 3;
        km += kmD;
        ret += r;
        points.push({
          key: d.toISOString().slice(0, 10),
          kmTraveled: kmD,
          unscheduledReturns: r,
          mkbf: Math.round(kmD / r),
          mkbfToDate: Math.round(km / ret),
        });
      }
    }
    return HttpResponse.json({
      bucket,
      points,
      requested: { from, to },
      used: { from, to },
      fellBack: false,
    });
  }),
  http.get('*/api/dashboard/availability-hours', async ({ request }) => {
    await delay();
    const url = new URL(request.url);
    const day = url.searchParams.get('day');
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      rate: availabilityCurve(hour),
      today: day ? (hour <= 17 ? availabilityCurve(hour) - 0.02 : null) : null,
    }));
    return HttpResponse.json({ hours, day, requestedDay: day, fellBack: false, days: 30 });
  }),
  http.get('*/api/dashboard/widget', async ({ request }) => {
    await delay();
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind') ?? 'mkbf';
    const s = WIDGET_SAMPLE[kind] ?? WIDGET_SAMPLE['mkbf']!;
    return HttpResponse.json({
      kind,
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
      ...s,
      detail: s.detail || null,
      vehicleCode: url.searchParams.get('vehicleId') ? '10001' : null,
      used: { from: url.searchParams.get('from'), to: url.searchParams.get('to') },
      fellBack: false,
    });
  }),
  http.get('*/api/dashboard/notices', async () => {
    await new Promise((r) => setTimeout(r, 180));
    return HttpResponse.json(buildNotices());
  }),

  http.get('*/api/dashboard', async ({ request }) => {
    const auth = request.headers.get('Authorization');
    if (!auth || !users.some((u) => auth.endsWith(u.id))) {
      return HttpResponse.json(
        {
          statusCode: 401,
          code: 'UNAUTHORIZED',
          message: 'Sessão inválida',
          timestamp: new Date().toISOString(),
          path: '/api/dashboard',
        },
        { status: 401 },
      );
    }
    await new Promise((r) => setTimeout(r, 220));
    return HttpResponse.json(buildDashboard());
  }),

  http.get('*/api/notifications', () => HttpResponse.json(notifications.filter((n) => !n.readAt))),

  http.post('*/api/notifications/:id/read', ({ params }) => {
    const n = notifications.find((x) => x.id === params.id);
    if (n) n.readAt = new Date().toISOString();
    return new HttpResponse(null, { status: 201 });
  }),
];
