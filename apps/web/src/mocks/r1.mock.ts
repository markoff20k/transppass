import { http, HttpResponse } from 'msw';
import {
  DowntimeCause,
  EventStatus,
  MaterialRequestStatus,
  PoolComponentStatus,
  QueueStatus,
  TaskStatus,
  WorkOrderStatus,
  WorkOrderType,
  type FailureCodeRule,
  type MaterialRequestRow,
  type PoolComponentRow,
  type QueueChangeRow,
  type QueueEntryRow,
  type R1Metrics,
  type KanbanRow,
  type ToolRow,
  type WorkOrderDetail,
  type WorkOrderSummary,
} from '@app/shared';
import { catalogItems, vehicles } from './fixtures';
import { buildDashboard } from './dashboard.mock';

/**
 * Leitura das telas do R1 no modo mock.
 *
 * Cobre o que as telas precisam para renderizar com dados plausíveis. As
 * escritas devolvem sucesso sem mudar estado — a máquina de estados de verdade
 * mora na API e é o que o teste ponta a ponta exercita.
 */

const H = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * H).toISOString();

const specialties = [
  { id: 'sp-1', code: 'MEC', name: 'Mecânica' },
  { id: 'sp-2', code: 'ELE', name: 'Elétrica' },
  { id: 'sp-3', code: 'PNE', name: 'Pneus' },
  { id: 'sp-4', code: 'AC', name: 'Ar-condicionado' },
];

const queue: QueueEntryRow[] = [
  { id: 'q-1', position: 1, criticality: 100, isFastTrack: true, status: QueueStatus.IN_SERVICE, vehicleId: vehicles[1]!.id, vehicleCode: '10002', vehiclePlate: 'ABC1D24', eventId: 'ev-EV-2026-000141', eventCode: 'EV-2026-000141', failureDescription: 'Válvula APU com vazamento', isSafety: true, workOrderId: 'wo-1', workOrderCode: 'OS-2026-000041', enteredAt: ago(4.2), startedAt: ago(3.8), estimatedCompletionAt: new Date(Date.now() + 1.5 * H).toISOString(), estimatedRepairMinutes: 120, waitingHours: 4.2 },
  { id: 'q-2', position: 1, criticality: 100, isFastTrack: true, status: QueueStatus.WAITING, vehicleId: vehicles[2]!.id, vehicleCode: '10003', vehiclePlate: 'ABC1D25', eventId: 'ev-EV-2026-000142', eventCode: 'EV-2026-000142', failureDescription: 'Cuíca de freio inoperante', isSafety: true, workOrderId: 'wo-2', workOrderCode: 'OS-2026-000040', enteredAt: ago(31.5), startedAt: null, estimatedCompletionAt: new Date(Date.now() + 4 * H).toISOString(), estimatedRepairMinutes: 150, waitingHours: 31.5 },
  { id: 'q-3', position: 2, criticality: 30, isFastTrack: false, status: QueueStatus.WAITING, vehicleId: 'v-207', vehicleCode: '20004', vehiclePlate: 'EBS1A04', eventId: 'ev-x', eventCode: 'EV-2026-000137', failureDescription: 'Porta não fecha completamente', isSafety: true, workOrderId: 'wo-3', workOrderCode: 'OS-2026-000039', enteredAt: ago(3.1), startedAt: null, estimatedCompletionAt: new Date(Date.now() + 5.5 * H).toISOString(), estimatedRepairMinutes: 90, waitingHours: 3.1 },
];

const queueHistory: QueueChangeRow[] = [
  { id: 'qc-1', fromPosition: null, toPosition: 1, reasonCode: 'SISTEMA', reasonDescription: 'Priorização automática do sistema (fast-track do catálogo)', actorName: null, isSystemGenerated: true, note: 'Fast-track automático por flag do catálogo', createdAt: ago(31.5) },
  { id: 'qc-2', fromPosition: 2, toPosition: 1, reasonCode: 'SEG', reasonDescription: 'Risco de segurança', actorName: 'Analista PCM', isSystemGenerated: false, note: 'Falha de freio — não pode esperar', createdAt: ago(20) },
];

function workOrder(id: string): WorkOrderDetail {
  const isFirst = id === 'wo-1';
  const v = isFirst ? vehicles[1]! : vehicles[2]!;
  return {
    id,
    code: isFirst ? 'OS-2026-000041' : 'OS-2026-000040',
    type: WorkOrderType.CORRECTIVE,
    status: isFirst ? WorkOrderStatus.IN_PROGRESS : WorkOrderStatus.WAITING_PART,
    vehicleId: v.id,
    vehicleCode: v.code,
    vehiclePlate: v.plate,
    vehicleClass: v.vehicleClass ?? null,
    technology: v.technology,
    reason: isFirst ? 'Válvula APU com vazamento' : 'Cuíca de freio inoperante',
    eventId: isFirst ? 'ev-EV-2026-000141' : 'ev-EV-2026-000142',
    eventCode: isFirst ? 'EV-2026-000141' : 'EV-2026-000142',
    openedAt: ago(isFirst ? 4.2 : 31.5),
    estimatedCompletionAt: new Date(Date.now() + (isFirst ? 1.5 : -6) * H).toISOString(),
    techClosedAt: null,
    releasedAt: null,
    releasedByName: null,
    jbWorkOrderNumber: isFirst ? 'JB-88213' : null,
    execution: 'INTERNAL',
    supplierName: null,
    correctiveKit: null,
    downtimeMinutes: isFirst ? 252 : 1_890,
    isOverdue: !isFirst,
    tasks: [
      {
        id: `${id}-t1`, code: 'S01', description: isFirst ? 'Substituir válvula APU' : 'Substituir cuíca de freio dianteira', specialtyId: 'sp-3', specialtyName: 'Pneus',
        status: isFirst ? TaskStatus.IN_PROGRESS : TaskStatus.BLOCKED_BY_MATERIAL, assignedToId: null, assignedToName: 'Mecânico de turno', technicianId: null, technicianName: null,
        startedAt: ago(isFirst ? 3.5 : 30), finishedAt: null, confirmedCatalogItemId: null, confirmedCause: null, confirmedFailureCode: null, confirmedFailureLabel: null, reopenedCount: 0,
        checklist: [
          { id: `${id}-c1`, sequence: 1, description: 'Despressurizar o sistema', isChecked: true, checkedAt: ago(3), measurement: null, unit: null },
          { id: `${id}-c2`, sequence: 2, description: 'Substituir o componente', isChecked: isFirst, checkedAt: isFirst ? ago(1) : null, measurement: null, unit: null },
          { id: `${id}-c3`, sequence: 3, description: 'Teste de estanqueidade', isChecked: false, checkedAt: null, measurement: null, unit: 'bar' },
        ],
        openMaterialRequests: isFirst ? 0 : 1,
        lastInspection: null,
      },
      ...(isFirst
        ? [{
            id: `${id}-t2`, code: 'S02', description: 'Verificar sistema de carga', specialtyId: 'sp-2', specialtyName: 'Elétrica',
            status: TaskStatus.APPROVED, assignedToId: null, assignedToName: 'Eletricista', technicianId: null, technicianName: null, startedAt: ago(4), finishedAt: ago(2.2),
            confirmedCatalogItemId: catalogItems[0]!.id, confirmedCause: `${catalogItems[0]!.code} — ${catalogItems[0]!.description}`, confirmedFailureCode: 'NC-030-001', confirmedFailureLabel: 'Não carrega / não pressuriza · Geração e partida', reopenedCount: 1,
            checklist: [], openMaterialRequests: 0,
            lastInspection: { result: 'APPROVED' as const, inspectedAt: ago(1.8), note: null, reasonDescription: null },
          }]
        : []),
    ],
    breakdown: isFirst
      ? [
          { cause: DowntimeCause.QUEUE, minutes: 24, share: 24 / 252 },
          { cause: DowntimeCause.EXECUTION, minutes: 228, share: 228 / 252 },
        ]
      : [
          { cause: DowntimeCause.QUEUE, minutes: 90, share: 90 / 1890 },
          { cause: DowntimeCause.EXECUTION, minutes: 110, share: 110 / 1890 },
          { cause: DowntimeCause.MATERIAL, minutes: 1690, share: 1690 / 1890 },
        ],
    cleaning: null,
    gates: {
      allTasksSettled: false,
      allInspectionsApproved: false,
      cleaningDone: false,
      canTechClose: false,
      canRelease: false,
      blockingReasons: isFirst
        ? ['1 sub-OS ainda não concluída(s): S01', 'A limpeza ainda não foi concluída']
        : ['1 sub-OS ainda não concluída(s): S01', 'Há 1 solicitação de material em aberto'],
    },
  };
}

const workOrderList: WorkOrderSummary[] = ['wo-1', 'wo-2'].map((id) => {
  const w = workOrder(id);
  return {
    id: w.id, code: w.code, type: w.type, status: w.status, vehicleCode: w.vehicleCode, vehiclePlate: w.vehiclePlate, vehicleClass: w.vehicleClass, technology: w.technology, reason: w.reason,
    openedAt: w.openedAt, estimatedCompletionAt: w.estimatedCompletionAt, downtimeMinutes: w.downtimeMinutes,
    isOverdue: w.isOverdue, execution: w.execution, supplierName: w.supplierName, taskCount: w.tasks.length, tasksDone: w.tasks.filter((t) => t.status === TaskStatus.APPROVED).length,
  };
});

const materialRequests: MaterialRequestRow[] = [
  { id: 'mr-1', status: MaterialRequestStatus.WAITING_PART, materialId: 'm-1', materialCode: 'CUI-FR-DT', materialDescription: 'Cuíca de freio dianteira 24"', isSerialized: true, quantity: 1, serialNumber: null, workOrderId: 'wo-2', workOrderCode: 'OS-2026-000040', workOrderTaskId: 'wo-2-t1', taskDescription: 'Substituir cuíca de freio dianteira', vehicleCode: '10003', requestedAt: ago(30), requestedByName: null, separatedAt: null, deliveredAt: null, receivedByName: null, partWaiting: { reasonDescription: 'Aguardando compra', expectedAt: ago(20), isOverdue: true, escalatedAt: ago(2) } },
  { id: 'mr-2', status: MaterialRequestStatus.REQUESTED, materialId: 'm-2', materialCode: 'FIL-AR-01', materialDescription: 'Filtro de ar motor', isSerialized: false, quantity: 2, serialNumber: null, workOrderId: 'wo-1', workOrderCode: 'OS-2026-000041', workOrderTaskId: 'wo-1-t1', taskDescription: 'Substituir válvula APU', vehicleCode: '10002', requestedAt: ago(1.2), requestedByName: null, separatedAt: null, deliveredAt: null, receivedByName: null, partWaiting: null },
  { id: 'mr-3', status: MaterialRequestStatus.SEPARATED, materialId: 'm-3', materialCode: 'VAL-APU-01', materialDescription: 'Válvula APU', isSerialized: true, quantity: 1, serialNumber: 'APU-77812', workOrderId: 'wo-1', workOrderCode: 'OS-2026-000041', workOrderTaskId: 'wo-1-t1', taskDescription: 'Substituir válvula APU', vehicleCode: '10002', requestedAt: ago(3.9), requestedByName: null, separatedAt: ago(2.5), deliveredAt: null, receivedByName: null, partWaiting: null },
];

const pool: PoolComponentRow[] = [
  { id: 'pc-1', serialNumber: 'ALT-20431', status: PoolComponentStatus.IN_STOCK, materialCode: 'ALT-24V', materialDescription: 'Alternador 24V 110A', currentVehicleCode: null },
  { id: 'pc-2', serialNumber: 'ALT-20432', status: PoolComponentStatus.IN_USE, materialCode: 'ALT-24V', materialDescription: 'Alternador 24V 110A', currentVehicleCode: '10001' },
  { id: 'pc-3', serialNumber: 'ALT-20433', status: PoolComponentStatus.IN_WORKSHOP, materialCode: 'ALT-24V', materialDescription: 'Alternador 24V 110A', currentVehicleCode: null },
  { id: 'pc-4', serialNumber: 'APU-77812', status: PoolComponentStatus.IN_STOCK, materialCode: 'VAL-APU-01', materialDescription: 'Válvula APU', currentVehicleCode: null },
];

const kanbanRows: KanbanRow[] = [
  { id: 'kb-1', code: 'FIL-OL-01', description: 'Filtro de óleo', unit: 'un', stockQty: 4, reorderPoint: 12, reorderQty: 24, location: 'A-03-2', abcClass: 'A', isPreventive: true, supplierName: 'Mann Filter', supplierSlaDays: 15, pendingRequests: 1 },
  { id: 'kb-2', code: 'PAST-FR-01', description: 'Pastilha de freio (jogo)', unit: 'jg', stockQty: 0, reorderPoint: 6, reorderQty: 12, location: 'B-01-4', abcClass: 'A', isPreventive: false, supplierName: null, supplierSlaDays: null, pendingRequests: 2 },
];

const tools: ToolRow[] = [
  { id: 'tl-1', code: 'TORQ-01', description: 'Torquímetro 40–200 N·m', requiredQty: 2, availableQty: 2, calibrationDueAt: new Date(Date.now() + 40 * 24 * H).toISOString(), isCalibrationExpired: false, loanedToName: 'Mecânico de turno', loanedAt: ago(2) },
  { id: 'tl-2', code: 'TORQ-02', description: 'Torquímetro 200–800 N·m', requiredQty: 2, availableQty: 2, calibrationDueAt: ago(5 * 24), isCalibrationExpired: true, loanedToName: null, loanedAt: null },
  { id: 'tl-3', code: 'MAN-01', description: 'Manômetro de ar 0–12 bar', requiredQty: 2, availableQty: 2, calibrationDueAt: new Date(Date.now() + 120 * 24 * H).toISOString(), isCalibrationExpired: false, loanedToName: null, loanedAt: null },
];

const materialOptions = [
  { id: 'm-1', code: 'CUI-FR-DT', description: 'Cuíca de freio dianteira 24"', unit: 'un', isSerialized: true, manufacturerRef: null, location: null, stockQty: 4 },
  { id: 'm-2', code: 'FIL-AR-01', description: 'Filtro de ar motor', unit: 'un', isSerialized: false, manufacturerRef: null, location: null, stockQty: 4 },
  { id: 'm-3', code: 'VAL-APU-01', description: 'Válvula APU', unit: 'un', isSerialized: true, manufacturerRef: null, location: null, stockQty: 4 },
  { id: 'm-4', code: 'ALT-24V', description: 'Alternador 24V 110A', unit: 'un', isSerialized: true, manufacturerRef: null, location: null, stockQty: 4 },
  { id: 'm-5', code: 'OLEO-15W40', description: 'Óleo motor 15W40', unit: 'L', isSerialized: false, manufacturerRef: null, location: null, stockQty: 4 },
  { id: 'm-6', code: 'CORR-ALT', description: 'Correia do alternador', unit: 'un', isSerialized: false, manufacturerRef: null, location: null, stockQty: 4 },
];

const catalogVersions = {
  draft: { id: 'cv-2', version: 2, notes: null as string | null, publishedAt: null as string | null, createdAt: ago(48) },
  published: { id: 'cv-1', version: 1, notes: 'Carga inicial a partir do ranking IIO', publishedAt: ago(30 * 24), createdAt: ago(31 * 24) } as { id: string; version: number; notes: string | null; publishedAt: string | null; createdAt: string } | null,
};

const failureRules: FailureCodeRule[] = [
  { id: 'rule-1', failureModeCode: 'SF', subsystemCode: null, isFastTrack: true, isSafety: true, isDeferrable: false, note: 'Sem freio, em qualquer sistema', isActive: true },
  { id: 'rule-2a', failureModeCode: null, subsystemCode: '021-000', isFastTrack: true, isSafety: true, isDeferrable: false, note: 'Freios: qualquer modo', isActive: true },
  { id: 'rule-2', failureModeCode: null, subsystemCode: '021-004', isFastTrack: true, isSafety: true, isDeferrable: false, note: 'Sistema de ar dos freios', isActive: true },
  { id: 'rule-3', failureModeCode: 'AF', subsystemCode: '174-010', isFastTrack: false, isSafety: true, isDeferrable: false, note: 'Porta pneumática que não fecha', isActive: true },
  { id: 'rule-4', failureModeCode: 'SA', subsystemCode: '011-003', isFastTrack: true, isSafety: true, isDeferrable: false, note: 'Superaquecimento do motor', isActive: true },
  { id: 'rule-5', failureModeCode: 'NC', subsystemCode: '030-001', isFastTrack: true, isSafety: false, isDeferrable: false, note: 'Alternador não carrega', isActive: true },
  { id: 'rule-6', failureModeCode: 'NR', subsystemCode: null, isFastTrack: false, isSafety: false, isDeferrable: true, note: 'Ar-condicionado: cabe na próxima parada', isActive: true },
  { id: 'rule-7', failureModeCode: 'FA', subsystemCode: null, isFastTrack: false, isSafety: false, isDeferrable: true, note: 'Item ausente: cabe na próxima parada', isActive: true },
];

function metrics(): R1Metrics {
  const d = buildDashboard();
  return {
    mkbf: { kmTraveled: 101_040, unscheduledReturns: 12, mkbf: d.mkbf.current, periodStart: d.mkbf.series[d.mkbf.series.length - 1]!.month, periodEnd: d.generatedAt },
    downtimeByCause: d.downtimeByCause,
    totalDowntimeMinutes: d.totalDowntimeMinutes,
    triageSla: { count: 38, medianSeconds: 11 * 60, p90Seconds: 34 * 60 },
    fieldResolution: { total: 17, resolvedInField: 9, rate: 9 / 17 },
    internalRework: { inspections: 41, rejections: 3, rate: 3 / 41 },
    workOrdersReleased: 27,
    averageDowntimeMinutes: 386,
    adherence: { preventive: { due: 9, onTime: 7, rate: 7 / 9 }, adoption: { released: 27, complete: 23, rate: 23 / 27 } },
    codeAlignment: { compared: 31, systemMatch: 27, fullMatch: 19, systemRate: 27 / 31, fullRate: 19 / 31 },
  };
}

const pageOf = <T,>(rows: T[], url: URL) => {
  const page = Number(url.searchParams.get('page') ?? 1);
  const perPage = Number(url.searchParams.get('perPage') ?? 20);
  return { data: rows.slice((page - 1) * perPage, page * perPage), meta: { page, perPage, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / perPage)) } };
};

export const r1Handlers = [
  http.get('*/api/events', ({ request }) => {
    const url = new URL(request.url);
    const all = buildDashboard().recentEvents;
    const pending = url.searchParams.get('pendingTriage') === 'true';
    const status = url.searchParams.get('status');
    let rows = all;
    if (pending) rows = all.filter((e) => e.status === EventStatus.REGISTERED);
    else if (status) rows = all.filter((e) => e.status === status);
    // Um evento aguardando triagem e um socorro em campo, para os contadores da sidebar.
    if (pending && rows.length === 0) rows = [{ ...all[3]!, id: 'ev-pend', code: 'EV-2026-000143', status: EventStatus.REGISTERED, vehicleCode: '10005', vehiclePlate: 'ABC1D27', waitingSeconds: 25 * 60, reportedAt: ago(0.4) }];
    if (status === EventStatus.FIELD_SERVICE && rows.length === 0) rows = [{ ...all[2]!, id: 'ev-field', code: 'EV-2026-000144', status: EventStatus.FIELD_SERVICE, vehicleCode: '10006', vehiclePlate: 'ABC1D28', reportedAt: ago(1.2), fieldService: { id: 'fs-1', dispatchedAt: ago(1.1), arrivedAt: ago(0.7), startedAt: null, finishedAt: null, outcome: null, supportVehicleCode: 'APOIO-2', confirmedFailureCode: null } }];
    return HttpResponse.json(pageOf(rows, url));
  }),
  http.post('*/api/events', () => HttpResponse.json(buildDashboard().recentEvents[0], { status: 201 })),
  http.post('*/api/events/:id/triage', () => HttpResponse.json(buildDashboard().recentEvents[0], { status: 201 })),
  http.post('*/api/events/:id/field/step', () => HttpResponse.json(buildDashboard().recentEvents[2], { status: 201 })),
  http.post('*/api/events/:id/field/outcome', () => HttpResponse.json(buildDashboard().recentEvents[2], { status: 201 })),

  http.get('*/api/queue', () => HttpResponse.json(queue)),
  http.get('*/api/queue/:id/history', () => HttpResponse.json(queueHistory)),
  http.post('*/api/queue/reorder', () => HttpResponse.json(queue, { status: 201 })),

  http.get('*/api/work-orders', ({ request }) => HttpResponse.json(pageOf(workOrderList, new URL(request.url)))),
  http.get('*/api/work-orders/:id', ({ params }) => HttpResponse.json(workOrder(String(params.id)))),
  http.post('*/api/work-orders/*', () => HttpResponse.json(workOrder('wo-1'), { status: 201 })),
  http.patch('*/api/work-orders/*', () => HttpResponse.json(workOrder('wo-1'))),

  http.get('*/api/materials/requests', () => HttpResponse.json(materialRequests)),
  http.get('*/api/materials/pool', () => HttpResponse.json(pool)),
  http.get('*/api/materials/tools', () => HttpResponse.json(tools)),
  http.get('*/api/materials/kanban', () => HttpResponse.json(kanbanRows)),
  http.post('*/api/materials/escalate-overdue', () => HttpResponse.json({ escalated: 1 }, { status: 201 })),
  http.post('*/api/materials/requests/:id/*', () => HttpResponse.json(materialRequests[0], { status: 201 })),

  http.get('*/api/materials/catalog', () => HttpResponse.json(materialOptions)),
  http.post('*/api/materials/tools/loan', async ({ request }) => {
    const body = (await request.json()) as { toolId: string };
    const t = tools.find((x) => x.id === body.toolId);
    if (t?.isCalibrationExpired) return HttpResponse.json({ statusCode: 400, code: 'BAD_REQUEST', message: 'Ferramenta com calibração vencida não pode ser emprestada (RF-28)', timestamp: new Date().toISOString(), path: '/api/materials/tools/loan' }, { status: 400 });
    if (t) { t.loanedToName = 'Administrador'; t.loanedAt = new Date().toISOString(); }
    return HttpResponse.json(tools, { status: 201 });
  }),
  http.post('*/api/materials/tools/:id/return', ({ params }) => {
    const t = tools.find((x) => x.id === params.id);
    if (t) { t.loanedToName = null; t.loanedAt = null; }
    return HttpResponse.json(tools, { status: 201 });
  }),
  http.post('*/api/materials/pool/:id/move', async ({ request, params }) => {
    const body = (await request.json()) as { toStatus: PoolComponentStatus };
    const c = pool.find((x) => x.id === params.id);
    if (c) { c.status = body.toStatus; if (body.toStatus !== PoolComponentStatus.IN_USE) c.currentVehicleCode = null; }
    return HttpResponse.json(c ?? pool[0], { status: 201 });
  }),
  http.get('*/api/catalog/versions/draft', () => HttpResponse.json(catalogVersions.draft)),
  http.get('*/api/catalog/versions/published', () => HttpResponse.json(catalogVersions.published)),
  http.post('*/api/catalog/versions/:id/publish', () => {
    catalogVersions.published = { ...catalogVersions.draft, publishedAt: new Date().toISOString() };
    catalogVersions.draft = { id: 'cv-next', version: catalogVersions.draft.version + 1, notes: null, publishedAt: null, createdAt: new Date().toISOString() };
    return HttpResponse.json(catalogVersions.published, { status: 201 });
  }),
  http.post('*/api/events/:id/field/dispatch', () => HttpResponse.json(buildDashboard().recentEvents[2], { status: 201 })),

  http.get('*/api/catalog/failure-rules', () => HttpResponse.json(failureRules)),
  http.post('*/api/catalog/failure-rules', async ({ request }) => {
    const body = (await request.json()) as Omit<FailureCodeRule, 'id' | 'isActive'>;
    const rule: FailureCodeRule = { id: `rule-${Date.now()}`, isActive: true, ...body, note: body.note ?? null, failureModeCode: body.failureModeCode ?? null, subsystemCode: body.subsystemCode ?? null };
    failureRules.push(rule);
    return HttpResponse.json(rule, { status: 201 });
  }),
  http.patch('*/api/catalog/failure-rules/:id', async ({ request, params }) => {
    const rule = failureRules.find((r) => r.id === params.id);
    if (rule) Object.assign(rule, await request.json());
    return HttpResponse.json(rule ?? failureRules[0]);
  }),

  http.get('*/api/metrics', () => HttpResponse.json(metrics())),
  http.get('*/api/catalog/specialties', () => HttpResponse.json(specialties)),
];
