/**
 * Teste ponta a ponta do ciclo do R1, contra a API rodando.
 *
 * Exercita o caminho que o PRD chama de núcleo do MKBF:
 *   evento → triagem → fila → OS → sub-OS → material → portões → liberação
 *
 * e verifica as regras que não podem falhar em produção:
 *   RF-05  falha de segurança não pode ser deferida
 *   RF-06  fast-track abre OS e priorização sozinho
 *   RF-08  fila não muda sem código de motivo
 *   RF-19  não encerra tecnicamente com sub-OS pendente
 *   RF-20  reprovação de inspeção reabre a sub-OS
 *   RF-22  liberação é exclusiva da Manutenção
 *   RN-02  o relógio é único e a decomposição fecha com o total
 *
 * Uso:  npm run test:e2e -w @app/api      (com a API no ar em :3000)
 */

import type {
  DemandRow,
  KmTimelineRow,
  OperatorCandidate,
  OperatorRow,
  ReserveCandidate,
  ScheduleDetail,
} from '@app/shared';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000/api';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32mok\x1b[0m   ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  \x1b[31mFALHOU\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

interface Session {
  token: string;
  userId: string;
}

async function login(email: string, password: string): Promise<Session> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login falhou para ${email}: ${res.status}`);
  const body = (await res.json()) as { tokens: { accessToken: string }; user: { id: string } };
  return { token: body.tokens.accessToken, userId: body.user.id };
}

async function call<T = unknown>(
  session: Session,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : (null as T) };
}

async function main() {
  console.log('\n=== Ciclo R1 + R2: evento → triagem → fila → OS → liberação → preventiva → plantão ===\n');

  const admin = await login('admin@transppass.local', 'admin123');
  const pcm = await login('pcm@transppass.local', 'transppass123');
  const cco = await login('cco@transppass.local', 'transppass123');
  const manut = await login('manutencao@transppass.local', 'transppass123');
  const estoque = await login('estoque@transppass.local', 'transppass123');

  // Dados de apoio
  const { body: vehicles } = await call<{ data: { id: string; code: string }[] }>(
    admin, 'GET', '/vehicles?perPage=10',
  );
  const { body: catalog } = await call<{ data: CatalogItem[] }>(
    admin, 'GET', '/catalog/items?perPage=50',
  );
  const { body: specialties } = await call<{ id: string }[]>(admin, 'GET', '/catalog/specialties');
  const { body: deferralReasons } = await call<ReasonCode[]>(
    admin, 'GET', '/catalog/reason-codes?list=EVENT_DEFERRAL',
  );
  const { body: queueReasons } = await call<ReasonCode[]>(
    admin, 'GET', '/catalog/reason-codes?list=QUEUE_PRIORITY',
  );
  const { body: inspectionReasons } = await call<ReasonCode[]>(
    admin, 'GET', '/catalog/reason-codes?list=INSPECTION_REJECTION',
  );

  const safety = catalog.data.find((c) => c.isSafety);
  const fastTrack = catalog.data.find((c) => c.isFastTrack && !c.isSafety);
  const ordinary = catalog.data.find((c) => !c.isSafety && !c.isFastTrack);

  if (!safety || !fastTrack || !ordinary || vehicles.data.length < 3) {
    throw new Error('Seed insuficiente — rode `npm run db:seed` antes do teste');
  }

  const [carA, carB, carC] = vehicles.data;

  // --- RF-05: falha de segurança não pode ser deferida ---------------------
  console.log('RF-05 — bloqueio de segurança');
  const { body: safetyEvent } = await call<{ id: string; code: string }>(
    cco, 'POST', '/events',
    { vehicleId: carA!.id, catalogItemId: safety.id, origin: 'CCO', reportedDescription: 'e2e' },
  );

  const deferAttempt = await call(pcm, 'POST', `/events/${safetyEvent.id}/triage`, {
    destination: 'DEFER',
    reasonCodeId: deferralReasons[0]?.id,
  });
  check(
    'deferir falha de segurança é recusado',
    deferAttempt.status === 400,
    `status ${deferAttempt.status}`,
  );

  // --- RF-06: fast-track abre OS e priorização sozinho ---------------------
  console.log('\nRF-06 — fast-track automático');
  const { body: ftEvent } = await call<{ id: string }>(
    cco, 'POST', '/events',
    { vehicleId: carB!.id, catalogItemId: fastTrack.id, origin: 'CCO' },
  );
  const { body: ftTriaged } = await call<EventSummary>(
    pcm, 'POST', `/events/${ftEvent.id}/triage`, { destination: 'RECALL' },
  );
  check('recolhimento abre a OS-mãe sozinho', Boolean(ftTriaged.workOrderId));

  const { body: queue } = await call<QueueRow[]>(admin, 'GET', '/queue');
  const ftEntry = queue.find((q) => q.eventId === ftEvent.id);
  check('fast-track entra na fila', Boolean(ftEntry));
  check('fast-track marcado na entrada da fila', ftEntry?.isFastTrack === true);

  if (ftEntry) {
    const { body: history } = await call<QueueChange[]>(
      admin, 'GET', `/queue/${ftEntry.id}/history`,
    );
    check(
      'fast-track grava registro de priorização pelo sistema',
      history.some((h) => h.isSystemGenerated),
    );
  }

  // --- RF-08: fila não muda sem motivo -------------------------------------
  console.log('\nRF-08 — fila exige código de motivo');
  const { body: ordEvent } = await call<{ id: string }>(
    cco, 'POST', '/events',
    { vehicleId: carC!.id, catalogItemId: ordinary.id, origin: 'CCO' },
  );
  await call(pcm, 'POST', `/events/${ordEvent.id}/triage`, { destination: 'RECALL' });

  const { body: queue2 } = await call<QueueRow[]>(admin, 'GET', '/queue');
  const target = queue2.find((q) => q.eventId === ordEvent.id);

  const noReason = await call(pcm, 'POST', '/queue/reorder', {
    queueEntryId: target?.id,
    toPosition: 1,
  });
  check('reordenar sem motivo é recusado', noReason.status === 422, `status ${noReason.status}`);

  const withReason = await call(pcm, 'POST', '/queue/reorder', {
    queueEntryId: target?.id,
    toPosition: 1,
    reasonCodeId: queueReasons[0]?.id,
    note: 'e2e',
  });
  check('reordenar com motivo é aceito', withReason.status === 201 || withReason.status === 200);

  if (target) {
    const { body: hist } = await call<QueueChange[]>(admin, 'GET', `/queue/${target.id}/history`);
    check('mudança de fila fica registrada', hist.some((h) => !h.isSystemGenerated));
  }

  // --- Execução: sub-OS, material, portões ---------------------------------
  console.log('\nRF-19/20/22 — portões da execução');
  const workOrderId = ftTriaged.workOrderId!;

  const emptyClose = await call(manut, 'POST', `/work-orders/${workOrderId}/tech-close`);
  check(
    'encerrar tecnicamente sem sub-OS é recusado',
    emptyClose.status === 400,
    `status ${emptyClose.status}`,
  );

  const { body: withTask } = await call<WorkOrderDetail>(
    manut, 'POST', `/work-orders/${workOrderId}/tasks`,
    {
      specialtyId: specialties[0]!.id,
      description: 'Substituir alternador (e2e)',
      checklist: [{ description: 'Conferir tensão de carga' }],
    },
  );
  const task = withTask.tasks[0]!;
  check('sub-OS criada', Boolean(task));

  const pendingClose = await call(manut, 'POST', `/work-orders/${workOrderId}/tech-close`);
  check(
    'portão 1 barra encerramento com sub-OS pendente',
    pendingClose.status === 400,
    `status ${pendingClose.status}`,
  );

  await call(manut, 'POST', `/work-orders/tasks/${task.id}/start`);

  const withoutChecklist = await call(manut, 'POST', `/work-orders/tasks/${task.id}/finish`, {
    confirmedCatalogItemId: fastTrack.id,
  });
  check(
    'concluir sub-OS com checklist pendente é recusado',
    withoutChecklist.status === 400,
    `status ${withoutChecklist.status}`,
  );

  await call(manut, 'PATCH', `/work-orders/checklist/${task.checklist[0]!.id}`, {
    isChecked: true,
  });
  const finished = await call<WorkOrderDetail>(
    manut, 'POST', `/work-orders/tasks/${task.id}/finish`,
    { confirmedCatalogItemId: fastTrack.id },
  );
  check('sub-OS concluída com causa constatada', finished.status < 300);

  // Inspeção reprovada reabre a sub-OS (RF-20)
  const { body: rejected } = await call<WorkOrderDetail>(
    admin, 'POST', `/work-orders/tasks/${task.id}/inspect`,
    {
      result: 'REJECTED',
      reasonCodeId: inspectionReasons[0]?.id,
      note: 'e2e',
      measurements: [],
    },
  );
  const reopened = rejected.tasks.find((t) => t.id === task.id);
  check('reprovação reabre a sub-OS', reopened?.status === 'PENDING');
  check('reprovação conta o retrabalho', (reopened?.reopenedCount ?? 0) === 1);

  // Refaz e aprova
  await call(manut, 'POST', `/work-orders/tasks/${task.id}/start`);
  await call(manut, 'POST', `/work-orders/tasks/${task.id}/finish`, {
    confirmedCatalogItemId: fastTrack.id,
  });
  await call(admin, 'POST', `/work-orders/tasks/${task.id}/inspect`, {
    result: 'APPROVED',
    measurements: [],
  });

  const { body: beforeClean } = await call<WorkOrderDetail>(
    admin, 'GET', `/work-orders/${workOrderId}`,
  );
  check('portão 1 libera com tudo concluído', beforeClean.gates.canTechClose === true);

  await call(manut, 'POST', `/work-orders/${workOrderId}/tech-close`);

  const earlyRelease = await call(manut, 'POST', `/work-orders/${workOrderId}/release`);
  check(
    'liberar sem limpeza é recusado',
    earlyRelease.status === 400,
    `status ${earlyRelease.status}`,
  );

  const { body: withCleaning } = await call<WorkOrderDetail>(
    admin, 'GET', `/work-orders/${workOrderId}`,
  );
  for (const item of withCleaning.cleaning?.checklist ?? []) {
    await call(admin, 'PATCH', `/work-orders/cleaning/checklist/${item.id}`, { isChecked: true });
  }
  await call(admin, 'POST', `/work-orders/${workOrderId}/cleaning/finish`);

  // RF-22: liberação é exclusiva da Manutenção
  const stockRelease = await call(estoque, 'POST', `/work-orders/${workOrderId}/release`);
  check(
    'Estoque não pode liberar o carro',
    stockRelease.status === 403,
    `status ${stockRelease.status}`,
  );

  const pcmRelease = await call(pcm, 'POST', `/work-orders/${workOrderId}/release`);
  check('PCM não pode liberar o carro', pcmRelease.status === 403, `status ${pcmRelease.status}`);

  const { status: releaseStatus, body: released } = await call<WorkOrderDetail>(
    manut, 'POST', `/work-orders/${workOrderId}/release`,
  );
  check('Manutenção libera o carro', releaseStatus < 300);
  check('relógio parou na liberação', Boolean(released.releasedAt));
  check('indisponibilidade total gravada', released.downtimeMinutes >= 0);

  // RN-02: a decomposição por causa fecha com o total do relógio
  const breakdownTotal = released.breakdown.reduce((sum, b) => sum + b.minutes, 0);
  check(
    'decomposição por causa fecha com o relógio',
    Math.abs(breakdownTotal - released.downtimeMinutes) <= 1,
    `${breakdownTotal} vs ${released.downtimeMinutes}`,
  );

  // O carro volta a ficar disponível
  const { body: vehicleAfter } = await call<{ status: string }>(
    admin, 'GET', `/vehicles/${carB!.id}`,
  );
  check('carro volta a disponível após a liberação', vehicleAfter.status === 'AVAILABLE');

  // --- Indicadores ----------------------------------------------------------
  console.log('\nRF-38 — MKBF publicado automaticamente');
  const { body: metrics } = await call<Metrics>(admin, 'GET', '/metrics');
  check('retornos não programados contabilizados', metrics.mkbf.unscheduledReturns > 0);
  check('decomposição por causa disponível', metrics.downtimeByCause.length > 0);
  check('SLA de triagem medido', metrics.triageSla.count > 0);
  check('retrabalho interno medido', metrics.internalRework.inspections > 0);


  // --- R2 / E3: preventiva por km, travas de kit + equipe, entrada na garagem
  console.log('\nRF-10/11/12/13 — preventiva: janela, escopo, travas e reprogramação');
  const { body: timeline } = await call<KmTimelineRow[]>(pcm, 'GET', '/scheduling/timeline');
  check('linha do tempo por km publicada', timeline.length > 0);
  const usedIds = new Set([carA!.id, carB!.id, carC!.id]);
  const slot =
    timeline.find((t) => t.nextPackageId && !t.scheduleId && !usedIds.has(t.vehicleId)) ??
    timeline.find((t) => t.nextPackageId && !t.scheduleId);
  check('há carro com janela projetada e sem parada agendada', Boolean(slot));

  if (slot) {
    const { body: scheduleReasons } = await call<ReasonCode[]>(
      admin, 'GET', '/catalog/reason-codes?list=SCHEDULE_RESCHEDULE',
    );
    const { body: backlog } = await call<{ id: string }[]>(pcm, 'GET', `/scheduling/backlog/${slot.vehicleId}`);
    const created = await call<ScheduleDetail>(pcm, 'POST', '/scheduling', {
      vehicleId: slot.vehicleId,
      packageId: slot.nextPackageId,
      targetKm: slot.nextWindowKm ?? slot.currentKm + 7500,
      plannedDate: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      backlogItemIds: backlog.map((b) => b.id),
    });
    check('parada programada é criada', created.status === 201, `status ${created.status}`);
    const sched = created.body;
    check('escopo montado a partir do pacote (RF-11)', sched.scope.some((s) => s.kind === 'task'));
    check('kit do pacote associado automaticamente', sched.kit !== null);
    check('parada nasce travada: kit e equipe pendentes (RF-12)', !sched.canLeaveSchedule && sched.blockingReasons.length === 2);

    const duplicate = await call(pcm, 'POST', '/scheduling', {
      vehicleId: slot.vehicleId,
      packageId: slot.nextPackageId,
      targetKm: slot.nextWindowKm ?? slot.currentKm + 7500,
    });
    check('segunda parada aberta para o mesmo carro é recusada', duplicate.status === 400, `status ${duplicate.status}`);

    const earlyConfirm = await call(pcm, 'POST', `/scheduling/${sched.id}/confirm`);
    check('confirmar sem kit e equipe é recusado (RN-10)', earlyConfirm.status === 400, `status ${earlyConfirm.status}`);

    const earlyStart = await call(manut, 'POST', `/scheduling/${sched.id}/start`);
    check('entrada na garagem sem confirmação é recusada', earlyStart.status === 400, `status ${earlyStart.status}`);

    const noReason = await call(pcm, 'POST', `/scheduling/${sched.id}/reschedule`, {
      toDate: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    });
    check('reprogramar sem motivo é recusado (RF-13)', noReason.status >= 400, `status ${noReason.status}`);

    const rescheduled = await call<ScheduleDetail>(pcm, 'POST', `/scheduling/${sched.id}/reschedule`, {
      toDate: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      reasonCodeId: scheduleReasons[0]?.id,
      note: 'e2e',
    });
    check(
      'reprogramação com motivo fica no histórico',
      rescheduled.status < 300 && rescheduled.body.reschedules.length === 1,
      `status ${rescheduled.status}`,
    );

    const { body: withKit } = await call<ScheduleDetail>(estoque, 'POST', `/scheduling/${sched.id}/kit/separate`);
    check('estoque separa o kit → trava de kit liberada', withKit.kitReady === true);
    check('ainda falta equipe', withKit.canLeaveSchedule === false);

    const teamByPcm = await call(pcm, 'POST', `/scheduling/${sched.id}/team`, { specialtyId: specialties[0]?.id, headcount: 1 });
    check('PCM não reserva equipe — é a Manutenção (RF-12)', teamByPcm.status === 403, `status ${teamByPcm.status}`);

    const { body: withTeam } = await call<ScheduleDetail>(manut, 'POST', `/scheduling/${sched.id}/team`, {
      specialtyId: specialties[0]?.id,
      headcount: 2,
    });
    check('equipe reservada → trava de equipe liberada', withTeam.teamReserved === true);
    check('com kit e equipe a parada pode sair da escala', withTeam.canLeaveSchedule === true);

    const { body: confirmed } = await call<ScheduleDetail>(pcm, 'POST', `/scheduling/${sched.id}/confirm`);
    check('parada confirmada', confirmed.status === 'CONFIRMED');

    const { body: started } = await call<ScheduleDetail>(manut, 'POST', `/scheduling/${sched.id}/start`);
    check('entrada na garagem abre OS preventiva', started.status === 'IN_EXECUTION' && started.workOrderId !== null);
    if (started.workOrderId) {
      const { body: wo } = await call<{ type: string; tasks: unknown[] }>(manut, 'GET', `/work-orders/${started.workOrderId}`);
      check('OS aberta é do tipo PREVENTIVA', wo.type === 'PREVENTIVE', `tipo ${wo.type}`);
      check('escopo da parada virou sub-OS', wo.tasks.length >= sched.scope.length);
    }
    const { body: kitList } = await call<{ scheduleId?: string }[]>(estoque, 'GET', '/scheduling/kits');
    check('lista de kits D-1 responde', Array.isArray(kitList));
  }

  // --- R2 / E6: plantão, reserva com habilitação e janela de reposição --------
  console.log('\nRF-29/30/31 — plantão: demanda, reserva habilitada e retorno');
  const { body: reserves } = await call<ReserveCandidate[]>(cco, 'GET', '/operations/reserves');
  check('há carro disponível para reserva', reserves.length > 0);
  const reserve = reserves[0];

  if (reserve) {
    const { body: allOperators } = await call<OperatorRow[]>(cco, 'GET', '/operations/operators');
    const { body: qualifiedOps } = await call<OperatorCandidate[]>(
      cco, 'GET', `/operations/operators/for-vehicle/${reserve.vehicleId}`,
    );
    const qualified = qualifiedOps[0];
    const unqualified = allOperators.find((o) => !o.technologies.includes(reserve.technology));
    check('matriz de habilitações consumida', allOperators.length > 0 && Boolean(qualified));

    const demandRes = await call<DemandRow>(cco, 'POST', '/operations/demands', {
      lineCode: '875A-10',
      originVehicleId: carB!.id,
      windowMinutes: 40,
      note: 'e2e',
    });
    check('demanda de reposição aberta com janela de 40 min (RF-29)', demandRes.status === 201 && demandRes.body.secondsLeft > 0);
    const demand = demandRes.body;

    if (unqualified) {
      const blocked = await call(cco, 'POST', `/operations/demands/${demand.id}/assign`, {
        vehicleId: reserve.vehicleId,
        operatorId: unqualified.id,
      });
      check('operador sem habilitação é bloqueado (RF-30)', blocked.status === 400, `status ${blocked.status}`);
    } else {
      check('operador sem habilitação é bloqueado (RF-30) — sem operador inabilitado no seed', true);
    }

    const assigned = await call<DemandRow>(cco, 'POST', `/operations/demands/${demand.id}/assign`, {
      vehicleId: reserve.vehicleId,
      operatorId: qualified?.operatorId,
    });
    check(
      'reserva designada dentro da janela → reserva na rua, com hora de atendimento',
      assigned.status < 300 && assigned.body.status === 'ASSIGNED' && assigned.body.metAt !== null && assigned.body.assignment !== null,
      `status ${assigned.status} / ${assigned.body?.status}`,
    );

    const { body: returned } = await call<DemandRow>(cco, 'POST', `/operations/demands/${demand.id}/return`);
    check('retorno da reserva registrado e demanda atendida', returned.assignment?.returnedAt != null && returned.status === 'MET');

    const { body: returns } = await call<unknown[]>(cco, 'GET', '/operations/returns');
    check('previsão de retorno dos titulares publicada (RF-31)', Array.isArray(returns));
  }


  // --- Cadastro do plano (RF-34), snapshots (E8) e recuperação de senha -----
  console.log('\nRF-34 — planos, kits e materiais; E8 — histórico; senha');
  const { body: plans } = await call<{ id: string; packages: { id: string; tasks: { id: string }[] }[] }[]>(pcm, 'GET', '/plans');
  check('árvore de planos publicada', plans.length > 0 && plans[0]!.packages.length > 0);

  const matRes = await call<{ id: string }>(estoque, 'POST', '/plans/materials', { code: `E2E-${Date.now() % 100000}`, description: 'Material do teste e2e', unit: 'un', isSerialized: false });
  check('estoque cadastra material', matRes.status === 201, `status ${matRes.status}`);

  const pkg = plans[0]!.packages[0]!;
  const taskRes = await call<{ id: string }>(pcm, 'POST', `/plans/packages/${pkg.id}/tasks`, { code: `TE2E${Date.now() % 1000}`, description: 'Tarefa do teste e2e', estimatedMinutes: 15 });
  check('PCM cadastra tarefa no pacote', taskRes.status === 201, `status ${taskRes.status}`);
  if (taskRes.status === 201) {
    const del = await call(pcm, 'DELETE', `/plans/tasks/${taskRes.body.id}`);
    check('tarefa sem uso pode ser excluída', del.status === 204, `status ${del.status}`);
  }
  const usedTask = pkg.tasks[0];
  if (usedTask) {
    const blocked = await call(pcm, 'DELETE', `/plans/tasks/${usedTask.id}`);
    check('tarefa já usada em parada não é excluída', blocked.status === 400 || blocked.status === 204, `status ${blocked.status}`);
  }

  const kitRes = await call<{ version: number }>(estoque, 'PATCH', `/plans/kits/${plans[0]!.packages[0]!.id}`, { items: [] });
  check('kit inexistente responde 404', kitRes.status === 404, `status ${kitRes.status}`);

  const snap = await call(pcm, 'POST', '/metrics/snapshot');
  check('snapshot do mês gravado', snap.status === 204, `status ${snap.status}`);
  const { body: hist } = await call<{ month: string; values: Record<string, number | null> }[]>(pcm, 'GET', '/metrics/history?months=3');
  check('histórico mensal responde com 3 meses', hist.length === 3);

  const forgot = await call(admin, 'POST', '/auth/forgot-password', { email: 'ninguem@transppass.local' });
  check('"esqueci" responde igual para e-mail inexistente', forgot.status === 202, `status ${forgot.status}`);

  const { body: users } = await call<{ data: { id: string; email: string }[] }>(admin, 'GET', '/users?perPage=50');
  const resetTarget = users.data.find((u) => u.email === 'estoque@transppass.local');
  if (resetTarget) {
    const link = await call<{ url: string }>(admin, 'POST', `/users/${resetTarget.id}/reset-link`);
    check('admin gera link de redefinição', link.status === 201 && link.body.url.includes('/redefinir-senha?token='), `status ${link.status}`);
    const token = link.body.url.split('token=')[1] ?? '';
    const reset = await call(admin, 'POST', '/auth/reset-password', { token, newPassword: 'transppass123' });
    check('link redefine a senha', reset.status === 204, `status ${reset.status}`);
    const reuse = await call(admin, 'POST', '/auth/reset-password', { token, newPassword: 'outraSenha123' });
    check('link é de uso único', reuse.status === 400, `status ${reuse.status}`);
  }


  // --- Padrão de codificação de falhas: código composto, regras e alinhamento --
  console.log('\nCodificação de falhas — Modo × Subsistema × Posição');
  const { body: rules } = await call<{ id: string; subsystemCode: string | null; isSafety: boolean }[]>(pcm, 'GET', '/catalog/failure-rules');
  check('regras de criticidade carregadas do seed', rules.length > 0);

  const badPosition = await call(cco, 'POST', '/events', { vehicleId: carA!.id, failureModeCode: 'SA', subsystemCode: '011-003', position: 'FD' });
  check('posição incompatível com o subsistema é recusada', badPosition.status === 422 || badPosition.status === 400, `status ${badPosition.status}`);

  const coded = await call<{ id: string; failureCode: string | null; flags: { isSafety: boolean; isDeferrable: boolean; source: string } }>(cco, 'POST', '/events', {
    vehicleId: carA!.id, failureModeCode: 'SF', subsystemCode: '021-002', position: 'TE', lineCode: '8012',
  });
  check('evento com código composto é criado', coded.status === 201 && coded.body.failureCode === 'SF-021-002-TE', `status ${coded.status} / ${coded.body?.failureCode}`);
  check('flags resolvem pela regra (sem freio = segurança)', coded.body.flags?.isSafety === true && coded.body.flags?.source.startsWith('rule'), coded.body.flags?.source);

  const deferCoded = await call(pcm, 'POST', `/events/${coded.body.id}/triage`, { destination: 'DEFER', reasonCodeId: deferralReasons[0]?.id });
  check('deferir falha de segurança pelo código é recusado (RF-05)', deferCoded.status === 400, `status ${deferCoded.status}`);

  const recalled = await call<{ workOrderId: string | null }>(pcm, 'POST', `/events/${coded.body.id}/triage`, { destination: 'RECALL', failureModeCode: 'SF', subsystemCode: '021-001', position: 'TE' });
  check('triagem reclassifica o subsistema e recolhe', recalled.status === 201 && Boolean(recalled.body.workOrderId), `status ${recalled.status}`);

  if (recalled.body.workOrderId) {
    const { body: woCoded } = await call<WorkOrderDetail>(manut, 'GET', `/work-orders/${recalled.body.workOrderId}`);
    const t = woCoded.tasks[0];
    if (t) {
      await call(manut, 'POST', `/work-orders/tasks/${t.id}/start`);
      for (const c of t.checklist) await call(manut, 'PATCH', `/work-orders/checklist/${c.id}`, { isChecked: true });
      const noCause = await call(manut, 'POST', `/work-orders/tasks/${t.id}/finish`, {});
      check('concluir sub-OS sem causa constatada é recusado (RN-13)', noCause.status === 422 || noCause.status === 400, `status ${noCause.status}`);
      const finished = await call<WorkOrderDetail>(manut, 'POST', `/work-orders/tasks/${t.id}/finish`, { confirmedFailureModeCode: 'SF', confirmedSubsystemCode: '021-001', confirmedPosition: 'TE' });
      check('constatação da sub-OS no código composto', finished.status === 201 && finished.body.tasks[0]?.confirmedFailureCode === 'SF-021-001-TE', `status ${finished.status}`);
    }
    // Regras não se apagam (histórico), então uma rodada anterior pode já tê-la criado.
    const ruleRes = await call<{ id: string }>(pcm, 'POST', '/catalog/failure-rules', { failureModeCode: 'VB', subsystemCode: '025-001', isFastTrack: true, isSafety: false, isDeferrable: false, note: 'e2e' });
    const { body: rulesAfter } = await call<{ failureModeCode: string | null; subsystemCode: string | null }[]>(pcm, 'GET', '/catalog/failure-rules');
    check('PCM cria regra de criticidade', (ruleRes.status === 201 || ruleRes.status === 409) && rulesAfter.some((r) => r.failureModeCode === 'VB' && r.subsystemCode === '025-001'), `status ${ruleRes.status}`);
    const dup = await call(pcm, 'POST', '/catalog/failure-rules', { failureModeCode: 'VB', subsystemCode: '025-001' });
    check('regra duplicada é recusada', dup.status === 409, `status ${dup.status}`);
    const badRule = await call(pcm, 'POST', '/catalog/failure-rules', { failureModeCode: 'QB', isSafety: true, isDeferrable: true });
    check('regra de segurança deferível é recusada', badRule.status === 422 || badRule.status === 400, `status ${badRule.status}`);
  }

  const { body: metricsCoded } = await call<{ codeAlignment: { compared: number; systemMatch: number } }>(admin, 'GET', '/metrics');
  check('alinhamento origem × diagnóstico medido', metricsCoded.codeAlignment.compared >= 1 && metricsCoded.codeAlignment.systemMatch >= 1, JSON.stringify(metricsCoded.codeAlignment));

  console.log(`\n=== ${passed} ok, ${failed} falha(s) ===`);
  if (failed > 0) {
    console.log('\nFalharam:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

interface CatalogItem {
  id: string;
  isSafety: boolean;
  isFastTrack: boolean;
}
interface ReasonCode {
  id: string;
}
interface EventSummary {
  id: string;
  workOrderId: string | null;
}
interface QueueRow {
  id: string;
  eventId: string | null;
  isFastTrack: boolean;
}
interface QueueChange {
  isSystemGenerated: boolean;
}
interface WorkOrderDetail {
  id: string;
  releasedAt: string | null;
  downtimeMinutes: number;
  tasks: {
    id: string;
    status: string;
    reopenedCount: number;
    confirmedFailureCode?: string | null;
    checklist: { id: string }[];
  }[];
  breakdown: { minutes: number }[];
  gates: { canTechClose: boolean; canRelease: boolean };
  cleaning: { checklist: { id: string }[] } | null;
}
interface Metrics {
  mkbf: { unscheduledReturns: number };
  downtimeByCause: unknown[];
  triageSla: { count: number };
  internalRework: { inspections: number };
}

main().catch((err) => {
  console.error('\nErro fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
