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
  type MaterialRequestRow,
  type PoolComponentRow,
  type QueueChangeRow,
  type QueueEntryRow,
  type R1Metrics,
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
    eventId: isFirst ? 'ev-EV-2026-000141' : 'ev-EV-2026-000142',
    eventCode: isFirst ? 'EV-2026-000141' : 'EV-2026-000142',
    openedAt: ago(isFirst ? 4.2 : 31.5),
    estimatedCompletionAt: new Date(Date.now() + (isFirst ? 1.5 : -6) * H).toISOString(),
    techClosedAt: null,
    releasedAt: null,
    releasedByName: null,
    jbWorkOrderNumber: isFirst ? 'JB-88213' : null,
    downtimeMinutes: isFirst ? 252 : 1_890,
    isOverdue: !isFirst,
    tasks: [
      {
        id: `${id}-t1`, code: 'S01', description: isFirst ? 'Substituir válvula APU' : 'Substituir cuíca de freio dianteira', specialtyId: 'sp-3', specialtyName: 'Pneus',
        status: isFirst ? TaskStatus.IN_PROGRESS : TaskStatus.BLOCKED_BY_MATERIAL, assignedToId: null, assignedToName: 'Mecânico de turno',
        startedAt: ago(isFirst ? 3.5 : 30), finishedAt: null, confirmedCatalogItemId: null, confirmedCause: null, reopenedCount: 0,
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
            status: TaskStatus.APPROVED, assignedToId: null, assignedToName: 'Eletricista', startedAt: ago(4), finishedAt: ago(2.2),
            confirmedCatalogItemId: catalogItems[0]!.id, confirmedCause: `${catalogItems[0]!.code} — ${catalogItems[0]!.description}`, reopenedCount: 1,
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
    id: w.id, code: w.code, type: w.type, status: w.status, vehicleCode: w.vehicleCode, vehiclePlate: w.vehiclePlate,
    openedAt: w.openedAt, estimatedCompletionAt: w.estimatedCompletionAt, downtimeMinutes: w.downtimeMinutes,
    isOverdue: w.isOverdue, taskCount: w.tasks.length, tasksDone: w.tasks.filter((t) => t.status === TaskStatus.APPROVED).length,
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

const tools: ToolRow[] = [
  { id: 'tl-1', code: 'TORQ-01', description: 'Torquímetro 40–200 N·m', calibrationDueAt: new Date(Date.now() + 40 * 24 * H).toISOString(), isCalibrationExpired: false, loanedToName: 'Mecânico de turno', loanedAt: ago(2) },
  { id: 'tl-2', code: 'TORQ-02', description: 'Torquímetro 200–800 N·m', calibrationDueAt: ago(5 * 24), isCalibrationExpired: true, loanedToName: null, loanedAt: null },
  { id: 'tl-3', code: 'MAN-01', description: 'Manômetro de ar 0–12 bar', calibrationDueAt: new Date(Date.now() + 120 * 24 * H).toISOString(), isCalibrationExpired: false, loanedToName: null, loanedAt: null },
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
    if (status === EventStatus.FIELD_SERVICE && rows.length === 0) rows = [{ ...all[2]!, id: 'ev-field', code: 'EV-2026-000144', status: EventStatus.FIELD_SERVICE, vehicleCode: '10006', vehiclePlate: 'ABC1D28', reportedAt: ago(1.2), fieldService: { id: 'fs-1', dispatchedAt: ago(1.1), arrivedAt: ago(0.7), startedAt: null, finishedAt: null, outcome: null, supportVehicleCode: 'APOIO-2' } }];
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
  http.post('*/api/materials/escalate-overdue', () => HttpResponse.json({ escalated: 1 }, { status: 201 })),
  http.post('*/api/materials/requests/:id/*', () => HttpResponse.json(materialRequests[0], { status: 201 })),

  http.get('*/api/metrics', () => HttpResponse.json(metrics())),
  http.get('*/api/catalog/specialties', () => HttpResponse.json(specialties)),
];
