import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import {
  DOWNTIME_CAUSE_LABELS,
  InspectionResult,
  ReasonCodeList,
  TASK_STATUS_LABELS,
  TaskStatus,
  WORK_ORDER_STATUS_LABELS,
  WorkOrderStatus,
  type FailureCatalogItem,
  type Paginated,
  type ReasonCode,
  type TaskRow,
  type WorkOrderDetail,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime, formatMinutes } from '@/lib/format';
import { useAuth } from '@/features/auth/use-auth';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';

type Panel =
  | { kind: 'closed' }
  | { kind: 'add-task' }
  | { kind: 'finish-task'; task: TaskRow }
  | { kind: 'inspect'; task: TaskRow };

/**
 * RF-17 a RF-22 — a OS-mãe e seus portões.
 *
 * O relógio único no topo; ao lado do botão de liberar, exatamente o que
 * ainda falta. Concluir sub-OS e inspecionar abrem o painel lateral. O
 * bloqueio de verdade é do servidor; aqui só se torna visível.
 */
export function WorkOrderPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [panel, setPanel] = useState<Panel>({ kind: 'closed' });
  const [error, setError] = useState<string | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['work-order', id],
    queryFn: () => api.get<WorkOrderDetail>(`/work-orders/${id}`),
    refetchInterval: 30_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['work-order', id] });
    void queryClient.invalidateQueries({ queryKey: ['work-orders'] });
    void queryClient.invalidateQueries({ queryKey: ['queue'] });
    void queryClient.invalidateQueries({ queryKey: ['fleet-panel'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const action = useMutation({
    mutationFn: (path: string) => api.post<WorkOrderDetail>(`/work-orders/${path}`),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha na operação'),
  });

  const canRelease = user?.role === 'MANUTENCAO' || user?.role === 'ADMIN';
  const isOpen = data && data.status !== WorkOrderStatus.RELEASED && data.status !== WorkOrderStatus.CANCELLED;

  usePageHeader({
    eyebrow: 'Execução',
    title: data ? `${data.code} · carro ${data.vehicleCode}` : 'Ordem de serviço',
    description: data ? `${data.vehiclePlate} · relógio único de indisponibilidade (RN-02)` : undefined,
    crumbs: [{ label: 'Ordens de serviço', to: '/os' }],
    actions: data && isOpen ? (
      <>
        <button
          type="button"
          className="tp-btn tp-btn--secondary tp-btn--sm"
          disabled={!data.gates.canTechClose || action.isPending}
          onClick={() => action.mutate(`${id}/tech-close`)}
        >
          Encerrar tecnicamente
        </button>
        <button
          type="button"
          className="tp-btn tp-btn--primary tp-btn--sm"
          disabled={!data.gates.canRelease || !canRelease || action.isPending}
          title={canRelease ? undefined : 'A liberação é exclusiva da Manutenção (RN-04)'}
          onClick={() => action.mutate(`${id}/release`)}
        >
          Liberar carro
        </button>
      </>
    ) : undefined,
  });

  if (isPending) return <p className="tp-muted">Carregando OS…</p>;
  if (!data) return <div className="tp-alert tp-alert--danger">OS não encontrada.</div>;

  return (
    <>
      <div className="tp-kpi-row">
        <div className={`tp-kpi ${data.isOverdue ? 'tp-kpi--danger' : 'tp-kpi--brand'}`}>
          <span className="tp-kpi__label">Relógio de indisponibilidade</span>
          <strong className="tp-kpi__value">{formatMinutes(data.downtimeMinutes)}</strong>
          <span className="tp-kpi__note">{data.releasedAt ? 'travado na liberação' : 'correndo'}</span>
        </div>
        <div className="tp-kpi">
          <span className="tp-kpi__label">Estado</span>
          <strong className="tp-kpi__value tp-kpi__value--sm">
            <span className={`tp-badge tp-badge--status ${data.isOverdue ? 'tp-badge--danger' : 'tp-badge--info'}`}>
              {WORK_ORDER_STATUS_LABELS[data.status]}
            </span>
          </strong>
        </div>
        <div className={`tp-kpi ${data.isOverdue ? 'tp-kpi--danger' : ''}`}>
          <span className="tp-kpi__label">Previsão de conclusão</span>
          <strong className="tp-kpi__value tp-kpi__value--sm">{formatDateTime(data.estimatedCompletionAt)}</strong>
          {data.isOverdue && <span className="tp-kpi__note tp-error">estourada</span>}
        </div>
        <div className="tp-kpi">
          <span className="tp-kpi__label">Sub-OS</span>
          <strong className="tp-kpi__value">
            {data.tasks.filter((t) => t.status === TaskStatus.APPROVED || t.status === TaskStatus.DONE).length}/{data.tasks.length}
          </strong>
          <span className="tp-kpi__note">aberta em {formatDateTime(data.openedAt)}</span>
        </div>
      </div>

      <div className="tp-split">
        <div className="tp-stack">
          <section className="tp-card">
            <div className="tp-card__head">
              <h3>Sub-OS por especialidade (RF-18)</h3>
              {isOpen && data.status !== WorkOrderStatus.TECH_CLOSED && (
                <button type="button" className="tp-btn tp-btn--sm" onClick={() => setPanel({ kind: 'add-task' })}>
                  <Plus size={14} /> Sub-OS
                </button>
              )}
            </div>

            {data.tasks.length === 0 ? (
              <div className="tp-table__empty">Nenhuma sub-OS. Acrescente o serviço a executar.</div>
            ) : (
              <div className="tp-stack">
                {data.tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onChanged={invalidate}
                    onFinish={() => setPanel({ kind: 'finish-task', task })}
                    onInspect={() => setPanel({ kind: 'inspect', task })}
                  />
                ))}
              </div>
            )}
          </section>

          {data.cleaning && (
            <section className="tp-card">
              <div className="tp-card__head">
                <h3>Limpeza — padrão do contrato (RF-21)</h3>
                <span className={`tp-badge tp-badge--status ${data.cleaning.status === 'DONE' ? 'tp-badge--success' : ''}`}>
                  {data.cleaning.status === 'DONE' ? 'Concluída' : data.cleaning.status === 'IN_PROGRESS' ? 'Em andamento' : 'Pendente'}
                </span>
              </div>
              <div className="tp-stack tp-stack--tight">
                {data.cleaning.checklist.map((item) => (
                  <label key={item.id} className={`tp-check${item.isChecked ? ' tp-check--done' : ''}`}>
                    <input
                      type="checkbox"
                      checked={item.isChecked}
                      onChange={(e) =>
                        api
                          .patch(`/work-orders/cleaning/checklist/${item.id}`, { isChecked: e.target.checked })
                          .then(invalidate)
                          .catch(() => setError('Falha ao marcar o item'))
                      }
                    />
                    {item.description}
                  </label>
                ))}
              </div>
              {data.cleaning.damageReports.length > 0 && (
                <div className="tp-alert tp-alert--warning">
                  <strong>Avarias reportadas — viraram backlog do carro</strong>
                  <ul>
                    {data.cleaning.damageReports.map((d) => (
                      <li key={d.id}>{d.description}</li>
                    ))}
                  </ul>
                </div>
              )}
              {data.cleaning.status !== 'DONE' && (
                <div className="tp-row tp-row--end">
                  {data.cleaning.status === 'PENDING' && (
                    <button type="button" className="tp-btn tp-btn--secondary tp-btn--sm" onClick={() => action.mutate(`${id}/cleaning/start`)}>
                      Iniciar limpeza
                    </button>
                  )}
                  <button type="button" className="tp-btn tp-btn--sm" onClick={() => action.mutate(`${id}/cleaning/finish`)}>
                    Concluir limpeza
                  </button>
                </div>
              )}
            </section>
          )}
        </div>

        <div className="tp-stack">
          <section className="tp-card">
            <h3>Portões antes de liberar</h3>
            <ul className="tp-gates">
              <li className={`tp-gate${data.gates.allTasksSettled ? ' tp-gate--open' : ''}`}>Todas as sub-OS concluídas (RF-19)</li>
              <li className={`tp-gate${data.gates.allInspectionsApproved ? ' tp-gate--open' : ''}`}>Todas as inspeções aprovadas (RF-20)</li>
              <li className={`tp-gate${data.gates.cleaningDone ? ' tp-gate--open' : ''}`}>Limpeza concluída (RF-21)</li>
            </ul>
            {data.gates.blockingReasons.length > 0 && (
              <div className="tp-alert tp-alert--warning">
                <strong>Falta para liberar</strong>
                <ul>
                  {data.gates.blockingReasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {!canRelease && isOpen && (
              <p className="tp-muted">Só a Manutenção libera o carro (RN-04). Seu perfil acompanha, não libera.</p>
            )}
            {data.releasedAt && (
              <div className="tp-alert tp-alert--success">
                Liberado em {formatDateTime(data.releasedAt)} por {data.releasedByName ?? '—'} · indisponibilidade total de{' '}
                {formatMinutes(data.downtimeMinutes)}.
              </div>
            )}
            {error && <div className="tp-alert tp-alert--danger">{error}</div>}
          </section>

          {data.breakdown.length > 0 && (
            <section className="tp-card">
              <h3>Onde o tempo foi (RF-39)</h3>
              <div className="tp-bar">
                {data.breakdown.map((b) => (
                  <div
                    key={b.cause}
                    className={`tp-bar__seg cause-${b.cause.toLowerCase()}`}
                    style={{ width: `${b.share * 100}%` }}
                    title={`${DOWNTIME_CAUSE_LABELS[b.cause]}: ${formatMinutes(b.minutes)}`}
                  />
                ))}
              </div>
              <ul className="tp-legend">
                {data.breakdown.map((b) => (
                  <li key={b.cause}>
                    <i className={`tp-swatch cause-${b.cause.toLowerCase()}`} />
                    {DOWNTIME_CAUSE_LABELS[b.cause]} — {formatMinutes(b.minutes)} ({(b.share * 100).toFixed(0)}%)
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="tp-card">
            <h3>Vínculos</h3>
            <dl className="tp-facts">
              <div>
                <dt>Evento</dt>
                <dd>{data.eventCode ?? '—'}</dd>
              </div>
              <div>
                <dt>OS no JB</dt>
                <dd>{data.jbWorkOrderNumber ?? '—'}</dd>
              </div>
              <div>
                <dt>Tipo</dt>
                <dd>{data.type === 'CORRECTIVE' ? 'Corretiva' : 'Preventiva'}</dd>
              </div>
              <div>
                <dt>Encerramento técnico</dt>
                <dd>{data.techClosedAt ? formatDateTime(data.techClosedAt) : '—'}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>

      <AddTaskDrawer
        open={panel.kind === 'add-task'}
        workOrderId={id}
        onClose={() => setPanel({ kind: 'closed' })}
        onDone={() => {
          setPanel({ kind: 'closed' });
          invalidate();
        }}
      />
      <FinishTaskDrawer
        task={panel.kind === 'finish-task' ? panel.task : null}
        onClose={() => setPanel({ kind: 'closed' })}
        onDone={() => {
          setPanel({ kind: 'closed' });
          invalidate();
        }}
      />
      <InspectionDrawer
        task={panel.kind === 'inspect' ? panel.task : null}
        onClose={() => setPanel({ kind: 'closed' })}
        onDone={() => {
          setPanel({ kind: 'closed' });
          invalidate();
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function taskBadge(status: TaskStatus): string {
  switch (status) {
    case TaskStatus.APPROVED:
    case TaskStatus.DONE:
      return 'tp-badge--success';
    case TaskStatus.IN_PROGRESS:
    case TaskStatus.IN_INSPECTION:
      return 'tp-badge--info';
    case TaskStatus.BLOCKED_BY_MATERIAL:
    case TaskStatus.REJECTED:
      return 'tp-badge--danger';
    default:
      return '';
  }
}

function TaskCard({
  task,
  onChanged,
  onFinish,
  onInspect,
}: {
  task: TaskRow;
  onChanged: () => void;
  onFinish: () => void;
  onInspect: () => void;
}) {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: () => api.post(`/work-orders/tasks/${task.id}/start`),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao iniciar'),
  });

  const isInspector = user?.role === 'INSPETOR' || user?.role === 'ADMIN';
  const tone =
    task.status === TaskStatus.BLOCKED_BY_MATERIAL || task.status === TaskStatus.REJECTED
      ? 'tp-card--danger'
      : task.status === TaskStatus.APPROVED
        ? 'tp-card--success'
        : task.status === TaskStatus.IN_PROGRESS
          ? 'tp-card--accent'
          : '';

  return (
    <article className={`tp-card ${tone}`} style={{ padding: 'var(--tp-space-3) var(--tp-space-4)' }}>
      <div className="tp-card__head">
        <div className="tp-row">
          <strong>{task.code}</strong>
          <span className="tp-muted">{task.specialtyName}</span>
          {task.reopenedCount > 0 && <span className="tp-badge tp-badge--danger">reaberta {task.reopenedCount}×</span>}
        </div>
        <span className={`tp-badge tp-badge--status ${taskBadge(task.status)}`}>{TASK_STATUS_LABELS[task.status]}</span>
      </div>

      <p>{task.description}</p>

      {task.openMaterialRequests > 0 && (
        <div className="tp-alert tp-alert--danger">
          {task.openMaterialRequests} solicitação(ões) de material em aberto — a sub-OS está bloqueada.
        </div>
      )}

      {task.checklist.length > 0 && (
        <div className="tp-stack tp-stack--tight">
          {task.checklist.map((item) => (
            <label key={item.id} className={`tp-check${item.isChecked ? ' tp-check--done' : ''}`}>
              <input
                type="checkbox"
                checked={item.isChecked}
                onChange={(e) =>
                  api
                    .patch(`/work-orders/checklist/${item.id}`, { isChecked: e.target.checked })
                    .then(onChanged)
                    .catch(() => setError('Falha ao marcar o item'))
                }
              />
              {item.description}
            </label>
          ))}
        </div>
      )}

      {task.confirmedCause && <p className="tp-muted">Causa constatada: {task.confirmedCause}</p>}

      {task.lastInspection && (
        <p className={task.lastInspection.result === InspectionResult.REJECTED ? 'tp-error' : 'tp-muted'}>
          Inspeção {task.lastInspection.result === InspectionResult.REJECTED ? 'reprovada' : 'aprovada'} em{' '}
          {formatDateTime(task.lastInspection.inspectedAt)}
          {task.lastInspection.reasonDescription && ` — ${task.lastInspection.reasonDescription}`}
        </p>
      )}

      {error && <div className="tp-alert tp-alert--danger">{error}</div>}

      <div className="tp-row tp-row--end">
        {task.status === TaskStatus.PENDING && (
          <button type="button" className="tp-btn tp-btn--sm" disabled={start.isPending} onClick={() => start.mutate()}>
            Iniciar
          </button>
        )}
        {task.status === TaskStatus.IN_PROGRESS && (
          <button type="button" className="tp-btn tp-btn--primary tp-btn--sm" onClick={onFinish}>
            Concluir sub-OS
          </button>
        )}
        {task.status === TaskStatus.DONE && isInspector && (
          <button type="button" className="tp-btn tp-btn--sm" onClick={onInspect}>
            Inspecionar
          </button>
        )}
      </div>
    </article>
  );
}

function AddTaskDrawer({ open, workOrderId, onClose, onDone }: { open: boolean; workOrderId: string; onClose: () => void; onDone: () => void }) {
  const [description, setDescription] = useState('');
  const [specialtyId, setSpecialtyId] = useState('');
  const [checklist, setChecklist] = useState('');
  const [error, setError] = useState<string | null>(null);

  const specialties = useQuery({
    queryKey: ['specialties'],
    queryFn: () => api.get<{ id: string; code: string; name: string }[]>('/catalog/specialties'),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/work-orders/${workOrderId}/tasks`, {
        specialtyId,
        description,
        checklist: checklist
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((d) => ({ description: d })),
      }),
    onSuccess: () => {
      setDescription('');
      setChecklist('');
      setError(null);
      onDone();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao criar a sub-OS'),
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Nova sub-OS"
      title="Acrescentar serviço"
      description="Por especialidade, com checklist. A primeira sub-OS tira o carro da fila e começa a execução."
      footer={
        <>
          <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className="tp-btn tp-btn--primary"
            disabled={!specialtyId || description.trim().length < 3 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Criando…' : 'Criar sub-OS'}
          </button>
        </>
      }
    >
      <div className="tp-field">
        <label className="tp-label" htmlFor="at-spec">Especialidade <span className="tp-label__required">obrigatório</span></label>
        <select id="at-spec" className="tp-select" value={specialtyId} onChange={(e) => setSpecialtyId(e.target.value)}>
          <option value="">Selecione…</option>
          {(specialties.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <div className="tp-field">
        <label className="tp-label" htmlFor="at-desc">Serviço a executar <span className="tp-label__required">obrigatório</span></label>
        <input id="at-desc" className="tp-input" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="tp-field">
        <label className="tp-label" htmlFor="at-check">Checklist <span className="tp-label__hint">um item por linha</span></label>
        <textarea id="at-check" className="tp-textarea" rows={5} value={checklist} onChange={(e) => setChecklist(e.target.value)} placeholder={'Despressurizar o sistema\nSubstituir o componente\nTeste de estanqueidade'} />
      </div>
      {error && <div className="tp-alert tp-alert--danger">{error}</div>}
    </Drawer>
  );
}

function FinishTaskDrawer({ task, onClose, onDone }: { task: TaskRow | null; onClose: () => void; onDone: () => void }) {
  const [causeId, setCauseId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const catalog = useQuery({
    queryKey: ['catalog', 'items', 'for-cause'],
    queryFn: () => api.get<Paginated<FailureCatalogItem>>('/catalog/items?perPage=100'),
    enabled: Boolean(task),
  });

  const mutation = useMutation({
    mutationFn: () => api.post(`/work-orders/tasks/${task?.id}/finish`, { confirmedCatalogItemId: causeId }),
    onSuccess: () => {
      setCauseId('');
      setError(null);
      onDone();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao concluir'),
  });

  if (!task) return null;
  const pending = task.checklist.filter((c) => !c.isChecked).length;

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={`Sub-OS ${task.code} · ${task.specialtyName}`}
      title="Concluir sub-OS"
      description={task.description}
      footer={
        <>
          <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="tp-btn tp-btn--primary" disabled={!causeId || pending > 0 || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Concluindo…' : 'Concluir'}
          </button>
        </>
      }
    >
      {pending > 0 && (
        <div className="tp-alert tp-alert--warning">Faltam {pending} item(ns) do checklist. Marque todos antes de concluir.</div>
      )}
      <div className="tp-field">
        <label className="tp-label" htmlFor="ft-cause">Causa constatada <span className="tp-label__required">obrigatório</span></label>
        <select id="ft-cause" className="tp-select" value={causeId} onChange={(e) => setCauseId(e.target.value)}>
          <option value="">Escolha da lista…</option>
          {(catalog.data?.data ?? []).map((item) => (
            <option key={item.id} value={item.id}>{item.code} — {item.description}</option>
          ))}
        </select>
        <span className="tp-help">Vem do catálogo, nunca de texto livre (RN-13). É o que realimenta a inteligência da triagem.</span>
      </div>
      {error && <div className="tp-alert tp-alert--danger">{error}</div>}
    </Drawer>
  );
}

function InspectionDrawer({ task, onClose, onDone }: { task: TaskRow | null; onClose: () => void; onDone: () => void }) {
  const [result, setResult] = useState<InspectionResult>(InspectionResult.APPROVED);
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reasons = useQuery({
    queryKey: ['reason-codes', ReasonCodeList.INSPECTION_REJECTION],
    queryFn: () => api.get<ReasonCode[]>(`/catalog/reason-codes?list=${ReasonCodeList.INSPECTION_REJECTION}`),
    enabled: Boolean(task) && result === InspectionResult.REJECTED,
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/work-orders/tasks/${task?.id}/inspect`, {
        result,
        reasonCodeId: reasonCodeId || undefined,
        note: note || undefined,
        measurements: [],
      }),
    onSuccess: () => {
      setResult(InspectionResult.APPROVED);
      setReasonCodeId('');
      setNote('');
      setError(null);
      onDone();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha na inspeção'),
  });

  if (!task) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={`Sub-OS ${task.code} · ${task.specialtyName}`}
      title="Inspeção (RF-20)"
      description={task.description}
      footer={
        <>
          <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className={`tp-btn ${result === InspectionResult.REJECTED ? 'tp-btn--danger' : 'tp-btn--primary'}`}
            disabled={(result === InspectionResult.REJECTED && !reasonCodeId) || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {result === InspectionResult.REJECTED ? 'Reprovar e reabrir' : 'Aprovar'}
          </button>
        </>
      }
    >
      {task.confirmedCause && (
        <dl className="tp-facts">
          <div className="is-full">
            <dt>Causa constatada pelo mecânico</dt>
            <dd>{task.confirmedCause}</dd>
          </div>
        </dl>
      )}
      <div className="tp-stack">
        <h3>Resultado</h3>
        <label className="tp-radio-card">
          <input type="radio" name="insp" checked={result === InspectionResult.APPROVED} onChange={() => setResult(InspectionResult.APPROVED)} />
          <span>Aprovar</span>
        </label>
        <label className="tp-radio-card">
          <input type="radio" name="insp" checked={result === InspectionResult.REJECTED} onChange={() => setResult(InspectionResult.REJECTED)} />
          <span>
            Reprovar
            <span className="tp-help" style={{ display: 'block' }}>reabre a sub-OS sozinha e conta no retrabalho (RN-05)</span>
          </span>
        </label>
      </div>
      {result === InspectionResult.REJECTED && (
        <div className="tp-field">
          <label className="tp-label" htmlFor="in-reason">Motivo da reprovação <span className="tp-label__required">obrigatório</span></label>
          <select id="in-reason" className="tp-select" value={reasonCodeId} onChange={(e) => setReasonCodeId(e.target.value)}>
            <option value="">Selecione…</option>
            {(reasons.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>{r.code} — {r.description}</option>
            ))}
          </select>
        </div>
      )}
      <div className="tp-field">
        <label className="tp-label" htmlFor="in-note">Observação</label>
        <textarea id="in-note" className="tp-textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <div className="tp-alert tp-alert--danger">{error}</div>}
    </Drawer>
  );
}
