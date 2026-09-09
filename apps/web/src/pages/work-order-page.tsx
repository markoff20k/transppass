import { usePageHeader } from '@/components/shell/page-header.context';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import {
  DOWNTIME_CAUSE_LABELS,
  InspectionResult,
  ReasonCodeList,
  TASK_STATUS_LABELS,
  TaskStatus,
  WORK_ORDER_STATUS_LABELS,
  type FailureCatalogItem,
  type Paginated,
  type ReasonCode,
  type TaskRow,
  type WorkOrderDetail,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime, formatMinutes } from '@/lib/format';
import { useAuth } from '@/features/auth/use-auth';

/**
 * RF-17 a RF-22 — a OS-mãe e seus portões.
 *
 * A tela mostra o relógio único correndo e, ao lado do botão de liberar,
 * exatamente o que ainda falta. O bloqueio de verdade é do servidor; aqui só
 * se torna visível, para ninguém tentar liberar e levar erro sem saber por quê.
 */
export function WorkOrderPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
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
  };

  const action = useMutation({
    mutationFn: (path: string) => api.post<WorkOrderDetail>(`/work-orders/${path}`),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha na operação'),
  });

  usePageHeader({
    eyebrow: 'Execução',
    title: data ? `${data.code} · carro ${data.vehicleCode}` : 'Ordem de serviço',
    description: data ? `${data.vehiclePlate} · relógio único de indisponibilidade` : undefined,
    crumbs: [{ label: 'Ordens de serviço', to: '/os' }],
  });

  if (isPending) return <p className="tp-muted">Carregando OS…</p>;
  if (!data) return <p className="tp-error">OS não encontrada.</p>;

  const canRelease = user?.role === 'MANUTENCAO' || user?.role === 'ADMIN';

  return (
    <>
      <section className="tp-card">
        <div className="tp-card__head">
          <h2>
            {data.code} · carro {data.vehicleCode} ({data.vehiclePlate})
          </h2>
          <span className={`tp-badge ${data.isOverdue ? 'badge-danger' : ''}`}>
            {WORK_ORDER_STATUS_LABELS[data.status]}
          </span>
        </div>

        <div className="tp-kpi-row">
          <div className={`tp-kpi ${data.isOverdue ? 'tp-kpi--warn' : ''}`}>
            <span className="tp-kpi__label">Relógio de indisponibilidade</span>
            <strong className="tp-kpi__value">{formatMinutes(data.downtimeMinutes)}</strong>
          </div>
          <div className="kpi">
            <span className="tp-kpi__label">Aberta em</span>
            <strong className="tp-kpi__value tp-kpi__value--sm">{formatDateTime(data.openedAt)}</strong>
          </div>
          <div className={`tp-kpi ${data.isOverdue ? 'tp-kpi--warn' : ''}`}>
            <span className="tp-kpi__label">Previsão de conclusão</span>
            <strong className="tp-kpi__value tp-kpi__value--sm">
              {formatDateTime(data.estimatedCompletionAt)}
            </strong>
          </div>
          <div className="kpi">
            <span className="tp-kpi__label">Sub-OS concluídas</span>
            <strong className="tp-kpi__value">
              {data.tasks.filter((t) => t.status !== TaskStatus.PENDING).length}/
              {data.tasks.length}
            </strong>
          </div>
        </div>

        {data.breakdown.length > 0 && (
          <div className="breakdown">
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
                  {DOWNTIME_CAUSE_LABELS[b.cause]} — {formatMinutes(b.minutes)} (
                  {(b.share * 100).toFixed(0)}%)
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="tp-card">
        <h2>Sub-OS</h2>
        {data.tasks.length === 0 ? (
          <p className="tp-muted">Nenhuma sub-OS. Acrescente o serviço a executar.</p>
        ) : (
          <div className="task-list">
            {data.tasks.map((task) => (
              <TaskCard key={task.id} task={task} onChanged={invalidate} />
            ))}
          </div>
        )}
        <AddTaskForm workOrderId={id} onAdded={invalidate} />
      </section>

      {data.cleaning && (
        <section className="tp-card">
          <h2>Limpeza</h2>
          <ul className="tp-stack tp-stack--tight">
            {data.cleaning.checklist.map((item) => (
              <li key={item.id}>
                <label className="tp-check">
                  <input
                    type="checkbox"
                    checked={item.isChecked}
                    onChange={(e) =>
                      api
                        .patch(`/work-orders/cleaning/checklist/${item.id}`, {
                          isChecked: e.target.checked,
                        })
                        .then(invalidate)
                        .catch(() => setError('Falha ao marcar o item'))
                    }
                  />
                  {item.description}
                </label>
              </li>
            ))}
          </ul>
          {data.cleaning.damageReports.length > 0 && (
            <>
              <h3>Avarias reportadas (viraram backlog do carro)</h3>
              <ul className="tp-muted">
                {data.cleaning.damageReports.map((d) => (
                  <li key={d.id}>{d.description}</li>
                ))}
              </ul>
            </>
          )}
          <div className="tp-row tp-row--end">
            <button
              type="button"
              className="tp-btn tp-btn--secondary"
              onClick={() => action.mutate(`${id}/cleaning/start`)}
            >
              Iniciar limpeza
            </button>
            <button type="button" className="tp-btn" onClick={() => action.mutate(`${id}/cleaning/finish`)}>
              Concluir limpeza
            </button>
          </div>
        </section>
      )}

      <section className="tp-card">
        <h2>Portões</h2>
        <ul className="tp-gates">
          <Gate ok={data.gates.allTasksSettled} label="Todas as sub-OS concluídas (RF-19)" />
          <Gate ok={data.gates.allInspectionsApproved} label="Todas as inspeções aprovadas (RF-20)" />
          <Gate ok={data.gates.cleaningDone} label="Limpeza concluída (RF-21)" />
        </ul>

        {data.gates.blockingReasons.length > 0 && (
          <div className="tp-alert tp-alert--warning">
            <strong>Falta para liberar:</strong>
            <ul>
              {data.gates.blockingReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="tp-error">{error}</p>}

        <div className="tp-row tp-row--end">
          <button
            type="button"
            className="tp-btn tp-btn--secondary"
            disabled={!data.gates.canTechClose || action.isPending}
            onClick={() => action.mutate(`${id}/tech-close`)}
          >
            Encerrar tecnicamente
          </button>
          <button
            type="button"
            disabled={!data.gates.canRelease || !canRelease || action.isPending}
            title={
              canRelease
                ? undefined
                : 'A liberação é exclusiva da Manutenção (RN-04)'
            }
            onClick={() => action.mutate(`${id}/release`)}
          >
            Liberar carro
          </button>
        </div>

        {!canRelease && (
          <p className="tp-muted">
            Só a Manutenção libera o carro (RN-04). Seu perfil pode acompanhar, mas não liberar.
          </p>
        )}

        {data.releasedAt && (
          <p className="tp-muted">
            Liberado em {formatDateTime(data.releasedAt)} por {data.releasedByName ?? '—'} ·
            indisponibilidade total de {formatMinutes(data.downtimeMinutes)}.
          </p>
        )}
      </section>
    </>
  );
}

function Gate({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={ok ? 'tp-gate tp-gate--open' : 'tp-gate'}>
      <span aria-hidden>{ok ? '✓' : '×'}</span> {label}
    </li>
  );
}

function TaskCard({ task, onChanged }: { task: TaskRow; onChanged: () => void }) {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [causeId, setCauseId] = useState('');
  const [showInspection, setShowInspection] = useState(false);

  const catalog = useQuery({
    queryKey: ['catalog', 'items', 'for-cause'],
    queryFn: () => api.get<Paginated<FailureCatalogItem>>('/catalog/items?perPage=100'),
  });

  const call = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api.post(`/work-orders/${path}`, body),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha na operação'),
  });

  const isInspector = user?.role === 'INSPETOR' || user?.role === 'ADMIN';

  return (
    <article className={`task-card status-${task.status.toLowerCase()}`}>
      <header>
        <strong>
          {task.code} · {task.specialtyName}
        </strong>
        <span className="tp-badge">{TASK_STATUS_LABELS[task.status]}</span>
        {task.reopenedCount > 0 && (
          <span className="tp-badge tp-badge--danger">reaberta {task.reopenedCount}×</span>
        )}
      </header>

      <p>{task.description}</p>

      {task.openMaterialRequests > 0 && (
        <p className="tp-error">
          {task.openMaterialRequests} solicitação(ões) de material em aberto — a sub-OS está
          bloqueada.
        </p>
      )}

      {task.checklist.length > 0 && (
        <ul className="tp-stack tp-stack--tight">
          {task.checklist.map((item) => (
            <li key={item.id}>
              <label className="tp-check">
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
            </li>
          ))}
        </ul>
      )}

      {task.confirmedCause && (
        <p className="tp-muted">Causa constatada: {task.confirmedCause}</p>
      )}

      {task.lastInspection && (
        <p className={task.lastInspection.result === InspectionResult.REJECTED ? 'form-error' : 'muted'}>
          Inspeção {task.lastInspection.result === InspectionResult.REJECTED ? 'reprovada' : 'aprovada'} em{' '}
          {formatDateTime(task.lastInspection.inspectedAt)}
          {task.lastInspection.reasonDescription && ` — ${task.lastInspection.reasonDescription}`}
        </p>
      )}

      {error && <p className="tp-error">{error}</p>}

      <footer>
        {task.status === TaskStatus.PENDING && (
          <button
            type="button"
            className="tp-btn tp-btn--sm"
            onClick={() => call.mutate({ path: `tasks/${task.id}/start` })}
          >
            Iniciar
          </button>
        )}

        {task.status === TaskStatus.IN_PROGRESS && (
          <>
            <select className="tp-select" value={causeId} onChange={(e) => setCauseId(e.target.value)}>
              <option value="">Causa constatada…</option>
              {(catalog.data?.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.description}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="tp-btn tp-btn--sm"
              disabled={!causeId}
              onClick={() =>
                call.mutate({
                  path: `tasks/${task.id}/finish`,
                  body: { confirmedCatalogItemId: causeId },
                })
              }
            >
              Concluir
            </button>
          </>
        )}

        {task.status === TaskStatus.DONE && isInspector && (
          <button type="button" className="tp-btn tp-btn--sm" onClick={() => setShowInspection((v) => !v)}>
            Inspecionar
          </button>
        )}
      </footer>

      {showInspection && (
        <InspectionForm
          taskId={task.id}
          onDone={() => {
            setShowInspection(false);
            onChanged();
          }}
        />
      )}
    </article>
  );
}

function InspectionForm({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const [result, setResult] = useState<InspectionResult>(InspectionResult.APPROVED);
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reasons = useQuery({
    queryKey: ['reason-codes', ReasonCodeList.INSPECTION_REJECTION],
    queryFn: () =>
      api.get<ReasonCode[]>(`/catalog/reason-codes?list=${ReasonCodeList.INSPECTION_REJECTION}`),
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/work-orders/tasks/${taskId}/inspect`, {
        result,
        reasonCodeId: reasonCodeId || undefined,
        note: note || undefined,
        measurements: [],
      }),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha na inspeção'),
  });

  return (
    <div className="inspection-form">
      <label className="inline">
        <input
          type="radio"
          checked={result === InspectionResult.APPROVED}
          onChange={() => setResult(InspectionResult.APPROVED)}
        />
        Aprovar
      </label>
      <label className="inline">
        <input
          type="radio"
          checked={result === InspectionResult.REJECTED}
          onChange={() => setResult(InspectionResult.REJECTED)}
        />
        Reprovar (reabre a sub-OS)
      </label>

      {result === InspectionResult.REJECTED && (
        <select className="tp-select" value={reasonCodeId} onChange={(e) => setReasonCodeId(e.target.value)}>
          <option value="">Motivo da reprovação…</option>
          {(reasons.data ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.code} — {r.description}
            </option>
          ))}
        </select>
      )}

      <input
        type="text"
        placeholder="Observação"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      {error && <p className="tp-error">{error}</p>}

      <button
        type="button"
        className="tp-btn tp-btn--sm"
        disabled={(result === InspectionResult.REJECTED && !reasonCodeId) || mutation.isPending}
        onClick={() => {
          setError(null);
          mutation.mutate();
        }}
      >
        Registrar inspeção
      </button>
    </div>
  );
}

function AddTaskForm({ workOrderId, onAdded }: { workOrderId: string; onAdded: () => void }) {
  const [description, setDescription] = useState('');
  const [specialtyId, setSpecialtyId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const specialties = useQuery({
    queryKey: ['specialties'],
    queryFn: () => api.get<{ id: string; code: string; name: string }[]>('/catalog/specialties'),
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/work-orders/${workOrderId}/tasks`, {
        specialtyId,
        description,
        checklist: [],
      }),
    onSuccess: () => {
      setDescription('');
      setError(null);
      onAdded();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao criar a sub-OS'),
  });

  return (
    <div className="add-task">
      <select className="tp-select" value={specialtyId} onChange={(e) => setSpecialtyId(e.target.value)}>
        <option value="">Especialidade…</option>
        {(specialties.data ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <input
        type="text"
        placeholder="Serviço a executar"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <button
        type="button"
        disabled={!specialtyId || description.trim().length < 3 || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        Acrescentar sub-OS
      </button>
      {error && <p className="tp-error">{error}</p>}
    </div>
  );
}
