import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, CalendarClock, Check, HardHat, Lock, Package, Plus, Unlock } from 'lucide-react';
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
  type TechnicianRow,
  type WorkOrderDetail,
  WORK_ORDER_EXECUTION_LABELS,
  WorkOrderExecution,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime, formatMinutes } from '@/lib/format';
import { useAuth } from '@/features/auth/use-auth';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';
import { FailureCodePicker } from '@/components/failure-code/failure-code-picker';
import { EMPTY_FAILURE_CODE, toCodeFields, type FailureCodeValue } from '@/components/failure-code/failure-code.utils';
import { BrandLoader } from '@/components/brand/brand-loader';
import { SearchSelect } from '@/components/ui/search-select';

type Panel =
  | { kind: 'closed' }
  | { kind: 'add-task' }
  | { kind: 'estimate' }
  | { kind: 'damage' }
  | { kind: 'finish-task'; task: TaskRow }
  | { kind: 'inspect'; task: TaskRow };

interface NextStep {
  tone: 'brand' | 'success' | 'warning' | 'danger';
  title: string;
  text: string;
  /** Botão principal: ou executa, ou abre o painel, ou leva a um ponto da tela. */
  action?: { label: string; run: () => void };
  link?: { label: string; to: string };
}

const settledStatuses: TaskStatus[] = [TaskStatus.DONE, TaskStatus.IN_INSPECTION, TaskStatus.APPROVED];

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * O que a pessoa precisa fazer agora nesta OS, em uma frase, com um botão.
 * Segue a ordem real do processo: serviço → encerramento técnico → inspeção
 * → limpeza → liberação. O servidor continua sendo quem bloqueia; aqui só se
 * aponta o caminho.
 */
function nextStepFor(
  d: WorkOrderDetail,
  ctx: { isInspector: boolean; canRelease: boolean; post: (path: string) => void; open: (p: Panel) => void },
): NextStep {
  if (d.releasedAt) {
    return { tone: 'success', title: 'Carro liberado', text: `Liberado em ${formatDateTime(d.releasedAt)} por ${d.releasedByName ?? '—'}. Indisponibilidade total de ${formatMinutes(d.downtimeMinutes)}.` };
  }
  if (d.status === WorkOrderStatus.CANCELLED) return { tone: 'warning', title: 'OS cancelada', text: 'Esta OS foi cancelada e não prende mais o carro.' };

  const tasks = d.tasks.filter((t) => t.status !== TaskStatus.CANCELLED);
  if (tasks.length === 0) {
    return { tone: 'brand', title: 'Acrescente o serviço a executar', text: 'A OS ainda não tem sub-OS. Cada especialidade (mecânica, elétrica, funilaria…) recebe a sua, com checklist.', action: { label: 'Adicionar sub-OS', run: () => ctx.open({ kind: 'add-task' }) } };
  }
  const blocked = tasks.find((t) => t.status === TaskStatus.BLOCKED_BY_MATERIAL);
  if (blocked) {
    return { tone: 'danger', title: `${blocked.code} está parada aguardando material`, text: 'O Estoque precisa separar e entregar a peça. Quando o material chega, a sub-OS volta a ficar liberada para o mecânico.', link: { label: 'Ver no Estoque', to: '/estoque' } };
  }
  const reopened = tasks.find((t) => t.status === TaskStatus.PENDING && t.reopenedCount > 0);
  if (reopened) {
    return { tone: 'danger', title: `${reopened.code} foi reprovada na inspeção: refaça o serviço`, text: `${reopened.lastInspection?.reasonDescription ?? 'A inspeção reprovou o serviço'}. Reinicie a sub-OS, corrija e conclua de novo.`, action: { label: `Reiniciar ${reopened.code}`, run: () => ctx.post(`tasks/${reopened.id}/start`) } };
  }
  const pending = tasks.find((t) => t.status === TaskStatus.PENDING);
  if (pending) {
    return { tone: 'brand', title: `Inicie a sub-OS ${pending.code} (${pending.specialtyName})`, text: 'O mecânico começa o serviço e o relógio passa a contar como execução.', action: { label: `Iniciar ${pending.code}`, run: () => ctx.post(`tasks/${pending.id}/start`) } };
  }
  const inProgress = tasks.find((t) => t.status === TaskStatus.IN_PROGRESS);
  if (inProgress) {
    const missing = inProgress.checklist.filter((c) => !c.isChecked).length;
    if (missing > 0) {
      return { tone: 'brand', title: `Marque o checklist da ${inProgress.code}`, text: `${missing} item(ns) ainda não marcado(s). Com o checklist completo, a sub-OS pode ser concluída com a causa constatada.`, action: { label: `Ir para a ${inProgress.code}`, run: () => scrollTo(`task-${inProgress.id}`) } };
    }
    return { tone: 'brand', title: `Conclua a sub-OS ${inProgress.code}`, text: 'Checklist completo. Informe a causa constatada e o serviço fica pronto para a inspeção.', action: { label: `Concluir ${inProgress.code}`, run: () => ctx.open({ kind: 'finish-task', task: inProgress }) } };
  }
  if (!d.techClosedAt) {
    return { tone: 'brand', title: 'Encerre tecnicamente a OS', text: 'Todo o serviço terminou. O encerramento manda o carro para a inspeção e abre o checklist de limpeza.', action: { label: 'Encerrar tecnicamente', run: () => ctx.post(`${d.id}/tech-close`) } };
  }
  const toInspect = tasks.find((t) => settledStatuses.includes(t.status) && t.status !== TaskStatus.APPROVED);
  if (toInspect) {
    return ctx.isInspector
      ? { tone: 'brand', title: `Inspecione a ${toInspect.code}`, text: 'Aprove ou reprove o serviço feito. Reprovar reabre a sub-OS automaticamente para o mecânico corrigir.', action: { label: `Inspecionar ${toInspect.code}`, run: () => ctx.open({ kind: 'inspect', task: toInspect }) } }
      : { tone: 'warning', title: `Aguardando a inspeção da ${toInspect.code}`, text: 'Um inspetor precisa aprovar o serviço antes de o carro seguir. Seu perfil acompanha, não inspeciona.' };
  }
  const cleaning = d.cleaning;
  if (cleaning && cleaning.status !== 'DONE') {
    if (cleaning.status === 'PENDING') {
      return { tone: 'brand', title: 'Inicie a limpeza do carro', text: 'Serviço aprovado. Falta a limpeza no padrão do contrato antes de o carro voltar à operação.', action: { label: 'Iniciar limpeza', run: () => ctx.post(`${d.id}/cleaning/start`) } };
    }
    const missing = cleaning.checklist.filter((c) => !c.isChecked).length;
    if (missing > 0) {
      return { tone: 'brand', title: 'Marque o checklist da limpeza', text: `${missing} item(ns) ainda não marcado(s). Avarias encontradas na limpeza viram backlog do carro.`, action: { label: 'Ir para a limpeza', run: () => scrollTo('limpeza') } };
    }
    return { tone: 'brand', title: 'Conclua a limpeza', text: 'Checklist da limpeza completo. Concluir abre o último portão.', action: { label: 'Concluir limpeza', run: () => ctx.post(`${d.id}/cleaning/finish`) } };
  }
  if (d.gates.canRelease) {
    return ctx.canRelease
      ? { tone: 'success', title: 'Tudo pronto: libere o carro', text: 'Sub-OS aprovadas e limpeza concluída. Liberar devolve o carro à operação e trava o relógio de indisponibilidade.', action: { label: 'Liberar carro', run: () => ctx.post(`${d.id}/release`) } }
      : { tone: 'warning', title: 'Aguardando a Manutenção liberar', text: 'Os três portões estão abertos. Só a Manutenção libera o carro (RN-04).' };
  }
  return { tone: 'warning', title: 'Ainda falta algo para liberar', text: d.gates.blockingReasons.join('; ') || 'Confira os portões ao lado.' };
}

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
    description: data ? `${data.vehiclePlate} · ${data.execution === WorkOrderExecution.THIRD_PARTY ? `executada por terceiro${data.supplierName ? ` (${data.supplierName})` : ''}` : 'oficina própria'} · relógio único de indisponibilidade (RN-02)` : undefined,
    crumbs: [{ label: 'Ordens de serviço', to: '/os' }],
    actions: data && isOpen ? (
      <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" onClick={() => setPanel({ kind: 'estimate' })}>
        <CalendarClock size={14} /> Previsão e execução
      </button>
    ) : undefined,
  });

  if (isPending) return <BrandLoader size={44} label="Carregando OS" />;
  if (!data) return <div className="tp-alert tp-alert--danger">OS não encontrada.</div>;

  const isInspector = user?.role === 'INSPETOR' || user?.role === 'ADMIN';
  const step = nextStepFor(data, { isInspector, canRelease, post: (path) => action.mutate(path), open: setPanel });
  const settledCount = data.tasks.filter((t) => settledStatuses.includes(t.status)).length;
  const approvedCount = data.tasks.filter((t) => t.status === TaskStatus.APPROVED).length;
  const path = [
    { label: 'Serviço', done: data.tasks.length > 0 && data.gates.allTasksSettled, hint: data.tasks.length ? `${settledCount} de ${data.tasks.length} sub-OS concluída(s)` : 'nenhuma sub-OS ainda' },
    { label: 'Encerramento técnico', done: Boolean(data.techClosedAt), hint: data.techClosedAt ? formatDateTime(data.techClosedAt) : 'manda o carro para a inspeção' },
    { label: 'Inspeção', done: data.tasks.length > 0 && data.gates.allInspectionsApproved, hint: `${approvedCount} de ${data.tasks.length} aprovada(s)` },
    { label: 'Limpeza', done: data.gates.cleaningDone, hint: data.cleaning ? (data.cleaning.status === 'DONE' ? 'checklist fechado' : data.cleaning.status === 'IN_PROGRESS' ? 'em andamento' : 'ainda não iniciada') : 'abre com o encerramento técnico' },
    { label: 'Liberação', done: Boolean(data.releasedAt), hint: data.releasedAt ? `${formatDateTime(data.releasedAt)} · ${data.releasedByName ?? '—'}` : canRelease ? 'a Manutenção libera' : 'só a Manutenção libera (RN-04)' },
  ];
  const currentIndex = path.findIndex((p) => !p.done);

  return (
    <>
      <section className={`wo-next wo-next--${step.tone}`} aria-live="polite">
        <div className="wo-next__body">
          <span className="wo-next__eyebrow">{data.releasedAt ? 'Situação' : 'Próximo passo'}</span>
          <h2 className="wo-next__title">{step.title}</h2>
          <p className="wo-next__text">{step.text}</p>
          {error && <div className="tp-alert tp-alert--danger">{error}</div>}
        </div>
        {step.action && (
          <button type="button" className="tp-btn tp-btn--primary wo-next__btn" disabled={action.isPending} onClick={step.action.run}>
            {step.action.label} <ArrowRight size={16} />
          </button>
        )}
        {step.link && (
          <Link to={step.link.to} className="tp-btn tp-btn--secondary wo-next__btn">
            {step.link.label} <ArrowRight size={16} />
          </Link>
        )}
      </section>

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
              <div>
                <h3>Serviços desta OS</h3>
                <span className="chart__hint">cada especialidade faz a sua sub-OS com checklist; tudo passa pela inspeção antes de liberar</span>
              </div>
              {isOpen && data.status !== WorkOrderStatus.TECH_CLOSED && (
                <button type="button" className="tp-btn tp-btn--sm" onClick={() => setPanel({ kind: 'add-task' })}>
                  <Plus size={14} /> Sub-OS
                </button>
              )}
            </div>

            {data.correctiveKit && (
              <div className="wo-kit">
                <Package size={15} aria-hidden />
                <div>
                  <b>Kit corretivo da falha: {data.correctiveKit.name}</b>
                  <span>{data.correctiveKit.items.map((i) => `${i.materialCode} ${i.materialDescription} × ${i.quantity} ${i.unit}`).join(' · ')}</span>
                </div>
              </div>
            )}
            {data.tasks.length === 0 ? (
              <div className="tp-table__empty">Nenhuma sub-OS. Acrescente o serviço a executar.</div>
            ) : (
              <div className="tp-stack">
                {data.tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    hasKit={Boolean(data.correctiveKit)}
                    onRequestKit={() => action.mutate(`tasks/${task.id}/request-kit`)}
                    onChanged={invalidate}
                    onFinish={() => setPanel({ kind: 'finish-task', task })}
                    onInspect={() => setPanel({ kind: 'inspect', task })}
                  />
                ))}
              </div>
            )}
          </section>

          {data.cleaning && (
            <section className="tp-card" id="limpeza">
              <div className="tp-card__head">
                <h3>Limpeza antes de liberar</h3>
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
                  <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" onClick={() => setPanel({ kind: 'damage' })}>
                    Reportar avaria
                  </button>
                  {data.cleaning.status === 'PENDING' && (
                    <button type="button" className="tp-btn tp-btn--secondary tp-btn--sm" onClick={() => action.mutate(`${id}/cleaning/start`)}>
                      Iniciar limpeza
                    </button>
                  )}
                  {data.cleaning.status === 'IN_PROGRESS' && (
                    <button type="button" className="tp-btn tp-btn--primary tp-btn--sm" onClick={() => action.mutate(`${id}/cleaning/finish`)}>
                      Concluir limpeza
                    </button>
                  )}
                </div>
              )}
            </section>
          )}
        </div>

        <div className="tp-stack">
          <section className="tp-card">
            <div className="tp-card__head">
              <div>
                <h3>Caminho até liberar o carro</h3>
                <span className="chart__hint">na ordem em que acontece — o passo atual está em laranja</span>
              </div>
            </div>
            <ol className="wo-gates">
              {path.map((g, i) => {
                const current = i === currentIndex;
                const last = i === path.length - 1;
                return (
                  <li key={g.label} className={`wo-gate${g.done ? ' wo-gate--open' : ''}${current ? ' wo-gate--current' : ''}${last ? ' wo-gate--final' : ''}`}>
                    <span className="wo-gate__dot" aria-hidden>
                      {g.done ? (last ? <Unlock size={14} strokeWidth={2.5} /> : <Check size={14} strokeWidth={3} />) : last ? <Lock size={13} strokeWidth={2.5} /> : i + 1}
                    </span>
                    <div className="wo-gate__text">
                      <span className="wo-gate__label">{g.label}</span>
                      <span className="wo-gate__hint">{g.hint}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
            {!data.releasedAt && data.gates.blockingReasons.length > 0 && (
              <details className="wo-blocking">
                <summary>O que ainda falta, em detalhe</summary>
                <ul>
                  {data.gates.blockingReasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          {data.breakdown.length > 0 && (
            <section className="tp-card">
              <h3>Onde o tempo foi</h3>
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

      <EstimateDrawer
        open={panel.kind === 'estimate'}
        workOrder={data}
        onClose={() => setPanel({ kind: 'closed' })}
        onDone={() => { setPanel({ kind: 'closed' }); invalidate(); }}
      />
      <DamageDrawer
        open={panel.kind === 'damage'}
        workOrderId={id}
        onClose={() => setPanel({ kind: 'closed' })}
        onDone={() => { setPanel({ kind: 'closed' }); invalidate(); }}
      />
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
  hasKit,
  onRequestKit,
  onChanged,
  onFinish,
  onInspect,
}: {
  task: TaskRow;
  hasKit: boolean;
  onRequestKit: () => void;
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
      ? 'wo-task--danger'
      : task.status === TaskStatus.APPROVED || task.status === TaskStatus.DONE
        ? 'wo-task--done'
        : task.status === TaskStatus.IN_PROGRESS || task.status === TaskStatus.IN_INSPECTION
          ? 'wo-task--progress'
          : '';

  const checked = task.checklist.filter((c) => c.isChecked).length;
  const pct = task.checklist.length ? Math.round((checked / task.checklist.length) * 100) : 0;

  return (
    <article className={`wo-task ${tone}`} id={`task-${task.id}`}>
      <div className="wo-task__head">
        <span className="wo-task__code">{task.code}</span>
        <span className="tp-badge">{task.specialtyName}</span>
        {task.reopenedCount > 0 && <span className="tp-badge tp-badge--danger">reaberta {task.reopenedCount}×</span>}
        <span className={`tp-badge tp-badge--status ${taskBadge(task.status)}`} style={{ marginLeft: 'auto' }}>{TASK_STATUS_LABELS[task.status]}</span>
      </div>

      <p className="wo-task__title">{task.description}</p>
      {(task.technicianName || task.assignedToName) && (
        <p className="tp-muted wo-task__who"><HardHat size={12} aria-hidden /> {task.technicianName ?? task.assignedToName}</p>
      )}

      {task.openMaterialRequests > 0 && (
        <div className="tp-alert tp-alert--danger">
          {task.openMaterialRequests} solicitação(ões) de material em aberto — a sub-OS está bloqueada.
        </div>
      )}

      {task.checklist.length > 0 && (
        <div className="wo-task__check">
          <div className="wo-task__progress">
            <span className="tp-progress">
              <i className="tp-progress__bar" aria-hidden><b style={{ width: `${pct}%` }} /></i>
              <span className="tp-progress__text">{checked}/{task.checklist.length}</span>
            </span>
            <span className="tp-muted">checklist</span>
          </div>
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

      {(task.confirmedFailureCode || task.confirmedCause) && (
        <p className="tp-muted">Causa constatada: {task.confirmedFailureCode && <code className="fcode__inline">{task.confirmedFailureCode}</code>} {task.confirmedFailureLabel ?? task.confirmedCause}</p>
      )}

      {task.lastInspection && (
        <p className={task.lastInspection.result === InspectionResult.REJECTED ? 'tp-error' : 'tp-muted'}>
          Inspeção {task.lastInspection.result === InspectionResult.REJECTED ? 'reprovada' : 'aprovada'} em{' '}
          {formatDateTime(task.lastInspection.inspectedAt)}
          {task.lastInspection.reasonDescription && ` — ${task.lastInspection.reasonDescription}`}
        </p>
      )}

      {error && <div className="tp-alert tp-alert--danger">{error}</div>}

      <div className="wo-task__foot">
        {task.status === TaskStatus.PENDING && (
          <button type="button" className="tp-btn tp-btn--sm" disabled={start.isPending} onClick={() => start.mutate()}>
            Iniciar
          </button>
        )}
        {task.status === TaskStatus.IN_PROGRESS && hasKit && task.openMaterialRequests === 0 && (
          <button type="button" className="tp-btn tp-btn--secondary tp-btn--sm" onClick={onRequestKit} title="Pede ao Estoque todos os itens do kit corretivo desta falha">
            <Package size={13} /> Pedir kit corretivo
          </button>
        )}
        {task.status === TaskStatus.IN_PROGRESS && (
          <button type="button" className="tp-btn tp-btn--primary tp-btn--sm" onClick={onFinish}>
            Concluir sub-OS
          </button>
        )}
        {(task.status === TaskStatus.DONE || task.status === TaskStatus.IN_INSPECTION) && isInspector && (
          <button type="button" className="tp-btn tp-btn--primary tp-btn--sm" onClick={onInspect}>
            Inspecionar
          </button>
        )}
        {(task.status === TaskStatus.DONE || task.status === TaskStatus.IN_INSPECTION) && !isInspector && (
          <span className="tp-muted" style={{ fontSize: 'var(--tp-text-xs)' }}>aguardando inspetor (RF-20)</span>
        )}
      </div>
    </article>
  );
}

function AddTaskDrawer({ open, workOrderId, onClose, onDone }: { open: boolean; workOrderId: string; onClose: () => void; onDone: () => void }) {
  const [description, setDescription] = useState('');
  const [specialtyId, setSpecialtyId] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [checklist, setChecklist] = useState('');
  const technicians = useQuery({ queryKey: ['technicians', true], queryFn: () => api.get<TechnicianRow[]>('/technicians?onlyActive=true'), enabled: open });
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
        technicianId: technicianId || undefined,
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
        <label className="tp-label" htmlFor="at-tech">Técnico responsável <span className="tp-label__hint">Kaizen 16</span></label>
        <SearchSelect id="at-tech" value={technicianId} onChange={setTechnicianId} placeholder="Nome ou matrícula (opcional)"
          options={(technicians.data ?? []).filter((t) => !specialtyId || t.specialtyId === specialtyId).map((t) => ({ id: t.id, label: t.name, hint: `${t.registration} · ${t.specialtyName} · N${t.level}` }))} />
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
  const [code, setCode] = useState<FailureCodeValue>(EMPTY_FAILURE_CODE);
  const [error, setError] = useState<string | null>(null);

  const catalog = useQuery({
    queryKey: ['catalog', 'items', 'for-cause'],
    queryFn: () => api.get<Paginated<FailureCatalogItem>>('/catalog/items?perPage=100'),
    enabled: Boolean(task),
  });

  const mutation = useMutation({
    mutationFn: () => api.post(`/work-orders/tasks/${task?.id}/finish`, { confirmedCatalogItemId: causeId || undefined, ...toCodeFields(code, 'confirmed') }),
    onSuccess: () => {
      setCauseId('');
      setCode(EMPTY_FAILURE_CODE);
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
          <button type="button" className="tp-btn tp-btn--primary" disabled={!(causeId || (code.failureModeCode && code.subsystemCode)) || pending > 0 || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Concluindo…' : 'Concluir'}
          </button>
        </>
      }
    >
      {pending > 0 && (
        <div className="tp-alert tp-alert--warning">Faltam {pending} item(ns) do checklist. Marque todos antes de concluir.</div>
      )}
      <div className="tp-stack">
        <h3>Causa constatada <span className="tp-label__hint">RN-13 — de lista, no código composto</span></h3>
        <FailureCodePicker value={code} onChange={setCode} idPrefix="ft" />
        <label className="tp-field">
          <span className="tp-label">Ou um atalho do catálogo</span>
          <select id="ft-cause" className="tp-select" value={causeId} onChange={(e) => { setCauseId(e.target.value); const item = (catalog.data?.data ?? []).find((i) => i.id === e.target.value); if (item?.failureModeCode && item.subsystemCode) setCode({ failureModeCode: item.failureModeCode, subsystemCode: item.subsystemCode, position: '' }); }}>
            <option value="">—</option>
            {(catalog.data?.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>{item.code} — {item.description}</option>
            ))}
          </select>
        </label>
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

/** Valor de <input type="datetime-local"> a partir de um ISO, no fuso local. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** RN-03 — a previsão de conclusão é obrigatória e pode ser ajustada; cada ajuste notifica os interessados (RF-09). */
function EstimateDrawer({ open, workOrder, onClose, onDone }: { open: boolean; workOrder: WorkOrderDetail; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState(() => toLocalInput(workOrder.estimatedCompletionAt));
  const [execution, setExecution] = useState<WorkOrderExecution>(workOrder.execution);
  const [supplierName, setSupplierName] = useState(workOrder.supplierName ?? '');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => api.patch(`/work-orders/${workOrder.id}/estimate`, { estimatedCompletionAt: new Date(value).toISOString(), execution, supplierName: execution === WorkOrderExecution.THIRD_PARTY ? supplierName.trim() || null : null }),
    onSuccess: () => { setError(null); onDone(); },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao ajustar a previsão'),
  });
  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={`${workOrder.code} · carro ${workOrder.vehicleCode}`}
      title="Ajustar previsão de conclusão"
      description="O Plantão e o CCO recebem a nova previsão na hora (RF-09)."
      footer={
        <>
          <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="tp-btn tp-btn--primary" disabled={!value || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Salvando…' : 'Salvar previsão'}
          </button>
        </>
      }
    >
      <div className="tp-stack">
        <dl className="tp-facts">
          <div><dt>Previsão atual</dt><dd>{formatDateTime(workOrder.estimatedCompletionAt)}</dd></div>
          <div><dt>Relógio</dt><dd>{formatMinutes(workOrder.downtimeMinutes)}</dd></div>
        </dl>
        <label className="tp-field">
          <span className="tp-label">Nova previsão</span>
          <input className="tp-input" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <label className="tp-field">
          <span className="tp-label">Quem executa <span className="tp-label__hint">Kaizen 6</span></span>
          <select className="tp-select" value={execution} onChange={(e) => setExecution(e.target.value as WorkOrderExecution)}>
            {Object.values(WorkOrderExecution).map((x) => <option key={x} value={x}>{WORK_ORDER_EXECUTION_LABELS[x]}</option>)}
          </select>
        </label>
        <label className="tp-field" hidden={execution !== WorkOrderExecution.THIRD_PARTY}>
          <span className="tp-label">Fornecedor</span>
          <input className="tp-input" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Oficina ou retífica externa" />
          <span className="tp-help">A OS de terceiro continua com o relógio único; o portão de liberação é o mesmo.</span>
        </label>
        {error && <p className="tp-error">{error}</p>}
      </div>
    </Drawer>
  );
}

/** RF-21 / RN-07 — avaria vista na limpeza vira backlog do carro para a próxima parada. */
function DamageDrawer({ open, workOrderId, onClose, onDone }: { open: boolean; workOrderId: string; onClose: () => void; onDone: () => void }) {
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => api.post(`/work-orders/${workOrderId}/cleaning/damage`, { description: description.trim() }),
    onSuccess: () => { setError(null); setDescription(''); onDone(); },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao reportar a avaria'),
  });
  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Limpeza"
      title="Reportar avaria"
      description="Banco rasgado, vidro trincado, corrimão solto — vira backlog do carro e entra na próxima parada (RN-07)."
      footer={
        <>
          <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="tp-btn tp-btn--primary" disabled={description.trim().length < 3 || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Registrando…' : 'Registrar avaria'}
          </button>
        </>
      }
    >
      <div className="tp-stack">
        <label className="tp-field">
          <span className="tp-label">O que foi encontrado</span>
          <textarea className="tp-textarea" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: banco 12 com estofado rasgado" maxLength={500} autoFocus />
        </label>
        {error && <p className="tp-error">{error}</p>}
      </div>
    </Drawer>
  );
}
