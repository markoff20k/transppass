import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MATERIAL_REQUEST_STATUS_LABELS,
  MaterialRequestStatus,
  POOL_STATUS_LABELS,
  PoolComponentStatus,
  ReasonCodeList,
  type MaterialRequestRow,
  type PoolComponentRow,
  type ReasonCode,
  type KanbanRow,
  type ToolRow,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { materialRequestStatusTone } from '@/lib/tones';
import { useAuth } from '@/features/auth/use-auth';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';
import { BrandLoader } from '@/components/brand/brand-loader';
import { Pager } from '@/components/ui/pager';
import { usePager } from '@/lib/pager';

/**
 * E5 — a tela do Estoque.
 *
 * O PRD pede "fila única de solicitações e pendências com prazo". É isso: uma
 * lista só, mais antiga primeiro, porque é ela que segura carro na valeta.
 * Agir sobre uma solicitação abre o painel lateral — a fila fica no lugar.
 */
export function StockPage() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<MaterialRequestRow | null>(null);

  const escalate = useMutation({
    meta: { success: (d: unknown) => `${(d as { escalated?: number } | undefined)?.escalated ?? 0} pendência(s) escalada(s)` },
    mutationFn: () => api.post<{ escalated: number }>('/materials/escalate-overdue'),
    onSuccess: (r) => {
      setNotice(
        r.escalated > 0
          ? `${r.escalated} pendência(s) com prazo vencido escalonada(s).`
          : 'Nenhuma pendência com prazo vencido.',
      );
      invalidate();
    },
  });

  usePageHeader({
    eyebrow: 'Execução',
    title: 'Estoque',
    description: 'Fila única de solicitações, pool rotativo e ferramentas.',
    actions: (
      <button
        type="button"
        className="tp-btn tp-btn--secondary tp-btn--sm"
        disabled={escalate.isPending}
        onClick={() => escalate.mutate()}
      >
        Escalonar prazos vencidos
      </button>
    ),
  });

  const requests = useQuery({
    queryKey: ['materials', 'pending'],
    queryFn: () => api.get<MaterialRequestRow[]>('/materials/requests?onlyPending=true'),
    refetchInterval: 20_000,
  });

  const [tool, setTool] = useState<ToolRow | null>(null);
  const [component, setComponent] = useState<PoolComponentRow | null>(null);

  const pool = useQuery({
    queryKey: ['materials', 'pool'],
    queryFn: () => api.get<PoolComponentRow[]>('/materials/pool'),
  });

  const tools = useQuery({
    queryKey: ['materials', 'tools'],
    queryFn: () => api.get<ToolRow[]>('/materials/tools'),
  });

  const kanban = useQuery({
    queryKey: ['materials', 'kanban'],
    queryFn: () => api.get<KanbanRow[]>('/materials/kanban'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['materials'] });
    void queryClient.invalidateQueries({ queryKey: ['work-order'] });
  };

  const rows = requests.data ?? [];

  const pager = usePager('estoque-pedidos', rows.length);
  const kanbanPager = usePager('estoque-kanban', (kanban.data ?? []).length);
  const poolPager = usePager('estoque-pool', (pool.data ?? []).length);
  const toolsPager = usePager('estoque-ferramentas', (tools.data ?? []).length);
  return (
    <>
      {notice && <div className="tp-alert tp-alert--info">{notice}</div>}

      <section className="tp-card">
        <div className="tp-card__head">
          <h3>Fila de solicitações</h3>
          <span className="tp-muted">{rows.length} pendente(s) · mais antiga primeiro</span>
        </div>

        {requests.isPending ? (
          <BrandLoader size={44} label="Carregando" />
        ) : rows.length === 0 ? (
          <div className="tp-table__empty">Nenhuma solicitação pendente.</div>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Carro</th>
                  <th>OS</th>
                  <th>Material</th>
                  <th className="is-num">Qtd</th>
                  <th>Estado</th>
                  <th>Pendência</th>
                  <th>Solicitado</th>
                </tr>
              </thead>
              <tbody>
                {pager.slice(rows).map((row) => (
                  <tr
                    key={row.id}
                    className={`is-clickable${row.partWaiting?.isOverdue ? ' is-danger' : ''}${selected?.id === row.id ? ' is-selected' : ''}`}
                    onClick={() => setSelected(row)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setSelected(row)}
                  >
                    <td className="is-strong">{row.vehicleCode ?? '—'}</td>
                    <td className="tp-muted">{row.workOrderCode ?? '—'}</td>
                    <td>
                      {row.materialCode} — {row.materialDescription}
                      {row.isSerialized && <span className="tp-badge" style={{ marginLeft: 6 }}>série</span>}
                    </td>
                    <td className="is-num">{row.quantity}</td>
                    <td>
                      <span className={`tp-badge tp-badge--status ${materialRequestStatusTone(row.status)}`}>
                        {MATERIAL_REQUEST_STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td className="tp-muted">
                      {row.partWaiting ? (
                        <>
                          {row.partWaiting.reasonDescription} · prazo {formatDate(row.partWaiting.expectedAt)}
                          {row.partWaiting.isOverdue && (
                            <span className="tp-badge tp-badge--danger" style={{ marginLeft: 6 }}>vencido</span>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="tp-muted">{formatDateTime(row.requestedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager pager={pager} label="pedidos" />
          </div>
        )}
      </section>

      <section className="tp-card stock-kanban">
        <div className="tp-card__head">
          <div><h3>Kanban — repor</h3><span className="chart__hint">materiais no ponto de pedido ou abaixo; o ponto e o lote ficam no cadastro do material</span></div>
          <span className={`tp-muted${(kanban.data?.length ?? 0) > 0 ? ' tp-error' : ''}`}>{kanban.data?.length ?? 0} item(ns)</span>
        </div>
        {kanban.isPending ? (
          <BrandLoader size={40} label="Carregando" />
        ) : (kanban.data ?? []).length === 0 ? (
          <div className="tp-table__empty">Nenhum material abaixo do ponto de pedido.</div>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table tp-table--compact">
              <thead>
                <tr><th>Código</th><th>Material</th><th>Local</th><th className="is-num">Saldo</th><th className="is-num">Ponto</th><th className="is-num">Repor</th><th>Fornecedor</th><th className="is-num">Pedidos abertos</th></tr>
              </thead>
              <tbody>
                {kanbanPager.slice((kanban.data ?? [])).map((k) => (
                  <tr key={k.id} className={k.stockQty <= 0 ? 'is-danger' : undefined}>
                    <td className="is-strong tp-mono">{k.code}</td>
                    <td style={{ whiteSpace: 'normal', minWidth: 220 }}>
                      <span className="mat-desc">{k.description}</span>
                      <span className="mat-sub">{k.abcClass ? `ABC ${k.abcClass}` : 'sem classe ABC'}{k.isPreventive ? ' · preventiva' : ''}</span>
                    </td>
                    <td className="tp-muted tp-mono">{k.location ?? '—'}</td>
                    <td className={`is-num${k.stockQty <= 0 ? ' tp-error' : ''}`}>{formatNumber(k.stockQty)} <small className="tp-muted">{k.unit}</small></td>
                    <td className="is-num tp-muted">{formatNumber(k.reorderPoint)}</td>
                    <td className="is-num is-strong">{k.reorderQty === null ? '—' : formatNumber(k.reorderQty)}</td>
                    <td className="tp-muted">{k.supplierName ?? '—'}{k.supplierSlaDays ? <span className="mat-sub">SLA {k.supplierSlaDays} dias</span> : null}</td>
                    <td className={`is-num${k.pendingRequests ? ' tp-error' : ' tp-muted'}`}>{k.pendingRequests}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager pager={kanbanPager} label="itens" />
          </div>
        )}
      </section>

      <div className="tp-split">
        <section className="tp-card stock-pool">
          <div className="tp-card__head">
            <h3>Pool rotativo</h3>
            <span className="tp-muted">clique para movimentar</span>
          </div>
          <p className="tp-muted">
            Componentes controlados por número de série — alternadores, válvulas APU e cuícas, os
            campeões do ranking IIO.
          </p>
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Série</th>
                  <th>Componente</th>
                  <th>Estado</th>
                  <th>Carro</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {poolPager.slice((pool.data ?? [])).map((c) => (
                  <tr key={c.id} className="is-clickable" tabIndex={0} onClick={() => setComponent(c)} onKeyDown={(e) => e.key === 'Enter' && setComponent(c)}>
                    <td className="is-strong">{c.serialNumber}</td>
                    <td>{c.materialDescription}</td>
                    <td>
                      <span className={`tp-badge tp-badge--status ${poolBadge(c.status)}`}>{POOL_STATUS_LABELS[c.status]}</span>
                    </td>
                    <td className="tp-muted">{c.currentVehicleCode ?? '—'}</td>
                    <td className="is-num">
                      <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" onClick={(e) => { e.stopPropagation(); setComponent(c); }}>
                        Movimentar
                      </button>
                    </td>
                  </tr>
                ))}
                {(pool.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="tp-table__empty">Nenhum componente no pool.</td>
                  </tr>
                )}
              </tbody>
            </table>
            <Pager pager={poolPager} label="componentes" />
          </div>
        </section>

        <section className="tp-card stock-tools">
          <div className="tp-card__head">
            <h3>Ferramentas</h3>
            <span className="tp-muted">FR.168 — disponível × necessária; calibração vencida bloqueia o empréstimo (RF-28)</span>
          </div>
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Ferramenta</th>
                  <th className="is-num" title="Disponível / necessária (FR.168)">Qtd</th>
                  <th>Calibração</th>
                  <th>Com quem</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {toolsPager.slice((tools.data ?? [])).map((t) => (
                  <tr key={t.id} className={t.isCalibrationExpired ? 'is-danger' : undefined}>
                    <td className="is-strong">{t.code}</td>
                    <td>{t.description}</td>
                    <td className={`is-num${t.availableQty < t.requiredQty ? ' tp-error' : ''}`}>{t.availableQty} / {t.requiredQty}</td>
                    <td className="tp-muted">
                      {t.calibrationDueAt ? formatDate(t.calibrationDueAt) : '—'}
                      {t.isCalibrationExpired && (
                        <span className="tp-badge tp-badge--danger" style={{ marginLeft: 6 }}>vencida</span>
                      )}
                    </td>
                    <td className="tp-muted">{t.loanedToName ?? 'disponível'}</td>
                    <td className="is-num">
                      <button
                        type="button"
                        className="tp-btn tp-btn--ghost tp-btn--sm"
                        disabled={!t.loanedToName && t.isCalibrationExpired}
                        title={!t.loanedToName && t.isCalibrationExpired ? 'Calibração vencida — não pode sair da ferramentaria' : undefined}
                        onClick={() => setTool(t)}
                      >
                        {t.loanedToName ? 'Devolver' : 'Emprestar'}
                      </button>
                    </td>
                  </tr>
                ))}
                {(tools.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="tp-table__empty">Nenhuma ferramenta cadastrada.</td>
                  </tr>
                )}
              </tbody>
            </table>
            <Pager pager={toolsPager} label="ferramentas" />
          </div>
        </section>
      </div>

      <RequestDrawer
        request={selected}
        onClose={() => setSelected(null)}
        onChanged={() => {
          setSelected(null);
          invalidate();
        }}
      />
      <ToolDrawer tool={tool} onClose={() => setTool(null)} onChanged={() => { setTool(null); invalidate(); }} />
      <PoolDrawer component={component} onClose={() => setComponent(null)} onChanged={() => { setComponent(null); invalidate(); }} />
    </>
  );
}

function poolBadge(status: PoolComponentStatus): string {
  switch (status) {
    case PoolComponentStatus.IN_STOCK: return 'tp-badge--success';
    case PoolComponentStatus.IN_USE: return 'tp-badge--info';
    case PoolComponentStatus.IN_WORKSHOP: return 'tp-badge--warning';
    default: return '';
  }
}

/** RF-28 — empréstimo e devolução; a calibração vencida é bloqueio do servidor, antecipado aqui. */
function ToolDrawer({ tool, onClose, onChanged }: { tool: ToolRow | null; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    meta: { success: 'Movimentação da ferramenta registrada' },
    mutationFn: () => (tool?.loanedToName ? api.post(`/materials/tools/${tool.id}/return`) : api.post('/materials/tools/loan', { toolId: tool?.id })),
    onSuccess: () => { setError(null); onChanged(); },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha na operação'),
  });
  if (!tool) return null;
  const returning = Boolean(tool.loanedToName);
  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={`Ferramenta · ${tool.code}`}
      title={returning ? 'Devolver à ferramentaria' : 'Emprestar ferramenta'}
      description={tool.description}
      footer={
        <>
          <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="tp-btn tp-btn--primary" disabled={mutation.isPending || (!returning && tool.isCalibrationExpired)} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Registrando…' : returning ? 'Confirmar devolução' : 'Confirmar empréstimo'}
          </button>
        </>
      }
    >
      <dl className="tp-facts">
        <div>
          <dt>Calibração</dt>
          <dd>{tool.calibrationDueAt ? formatDate(tool.calibrationDueAt) : '—'}{tool.isCalibrationExpired && <span className="tp-badge tp-badge--danger" style={{ marginLeft: 6 }}>vencida</span>}</dd>
        </div>
        <div>
          <dt>{returning ? 'Com quem' : 'Sai com'}</dt>
          <dd>{returning ? `${tool.loanedToName} · desde ${tool.loanedAt ? formatDateTime(tool.loanedAt) : '—'}` : (user?.name ?? '—')}</dd>
        </div>
      </dl>
      {!returning && tool.isCalibrationExpired && (
        <div className="tp-alert tp-alert--danger">Calibração vencida: a ferramenta não pode sair da ferramentaria até ser recalibrada (RF-28).</div>
      )}
      {error && <p className="tp-error">{error}</p>}
    </Drawer>
  );
}

const POOL_MOVES: { to: PoolComponentStatus; label: string; hint: string }[] = [
  { to: PoolComponentStatus.IN_STOCK, label: 'Voltou ao saldo', hint: 'Recuperado ou retirado de um carro, pronto para aplicar.' },
  { to: PoolComponentStatus.IN_USE, label: 'Aplicado no carro', hint: 'Instalado numa sub-OS — informe a sub-OS quando houver.' },
  { to: PoolComponentStatus.IN_WORKSHOP, label: 'Enviado à Oficina', hint: 'Em recuperação; sai do saldo até voltar.' },
  { to: PoolComponentStatus.SCRAPPED, label: 'Sucateado', hint: 'Sem recuperação. Movimento definitivo.' },
];

/** RF-26 — pool rotativo por número de série: cada mudança de estado é um movimento registrado. */
function PoolDrawer({ component, onClose, onChanged }: { component: PoolComponentRow | null; onClose: () => void; onChanged: () => void }) {
  const [toStatus, setToStatus] = useState<PoolComponentStatus | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    meta: { success: 'Componente movimentado no pool' },
    mutationFn: () => api.post(`/materials/pool/${component?.id}/move`, { toStatus, note: note || undefined }),
    onSuccess: () => { setError(null); setToStatus(null); setNote(''); onChanged(); },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao movimentar'),
  });
  if (!component) return null;
  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={`Pool rotativo · ${component.materialCode}`}
      title={component.serialNumber}
      description={`${component.materialDescription} · hoje: ${POOL_STATUS_LABELS[component.status]}${component.currentVehicleCode ? ` no ${component.currentVehicleCode}` : ''}`}
      footer={
        <>
          <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="tp-btn tp-btn--primary" disabled={!toStatus || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Registrando…' : 'Registrar movimento'}
          </button>
        </>
      }
    >
      <div className="tp-stack">
        <div className="tp-field">
          <span className="tp-label">Para onde vai</span>
          <div className="tp-stack tp-stack--tight">
            {POOL_MOVES.filter((m) => m.to !== component.status).map((m) => (
              <label key={m.to} className="tp-radio-card">
                <input type="radio" name="pool-move" value={m.to} checked={toStatus === m.to} onChange={() => setToStatus(m.to)} />
                <span className="field-outcomes__text"><b>{m.label}</b><small>{m.hint}</small></span>
              </label>
            ))}
          </div>
        </div>
        <label className="tp-field">
          <span className="tp-label">Observação</span>
          <input className="tp-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional — carro, OS ou motivo" maxLength={255} />
        </label>
        {error && <p className="tp-error">{error}</p>}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

function RequestDrawer({
  request,
  onClose,
  onChanged,
}: {
  request: MaterialRequestRow | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<'view' | 'deliver' | 'wait'>('view');
  const [receivedByName, setReceivedByName] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reasons = useQuery({
    queryKey: ['reason-codes', ReasonCodeList.PART_WAITING],
    queryFn: () => api.get<ReasonCode[]>(`/catalog/reason-codes?list=${ReasonCodeList.PART_WAITING}`),
    enabled: mode === 'wait',
  });

  const call = useMutation({
    meta: { success: 'Solicitação atualizada' },
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api.post(`/materials/requests/${request?.id}/${path}`, body),
    onSuccess: () => {
      setMode('view');
      setError(null);
      onChanged();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha na operação'),
  });

  const close = () => {
    setMode('view');
    setError(null);
    onClose();
  };

  if (!request) return null;

  const canSeparate =
    request.status === MaterialRequestStatus.REQUESTED ||
    request.status === MaterialRequestStatus.WAITING_PART;
  const canDeliver = request.status === MaterialRequestStatus.SEPARATED;
  const canWait = request.status !== MaterialRequestStatus.WAITING_PART;

  return (
    <Drawer
      open
      onClose={close}
      eyebrow="Solicitação de material"
      title={`${request.materialCode} — ${request.materialDescription}`}
      description={`Carro ${request.vehicleCode ?? '—'} · ${request.workOrderCode ?? 'sem OS'}${request.taskDescription ? ` · ${request.taskDescription}` : ''}`}
      footer={
        mode === 'view' ? (
          <>
            <button type="button" className="tp-btn tp-btn--ghost" onClick={close}>
              Fechar
            </button>
            {canWait && (
              <button type="button" className="tp-btn tp-btn--secondary" onClick={() => setMode('wait')}>
                Aguardando peça
              </button>
            )}
            {canSeparate && (
              <button
                type="button"
                className="tp-btn"
                disabled={call.isPending}
                onClick={() => call.mutate({ path: 'separate', body: {} })}
              >
                Separar
              </button>
            )}
            {canDeliver && (
              <button type="button" className="tp-btn tp-btn--primary" onClick={() => setMode('deliver')}>
                Entregar na valeta
              </button>
            )}
          </>
        ) : mode === 'deliver' ? (
          <>
            <button type="button" className="tp-btn tp-btn--ghost" onClick={() => setMode('view')}>
              Voltar
            </button>
            <button
              type="button"
              className="tp-btn tp-btn--primary"
              disabled={receivedByName.trim().length < 2 || call.isPending}
              onClick={() =>
                call.mutate({
                  path: 'deliver',
                  body: { receivedByName, serialNumber: serialNumber || undefined },
                })
              }
            >
              Confirmar entrega
            </button>
          </>
        ) : (
          <>
            <button type="button" className="tp-btn tp-btn--ghost" onClick={() => setMode('view')}>
              Voltar
            </button>
            <button
              type="button"
              className="tp-btn tp-btn--primary"
              disabled={!reasonCodeId || !expectedAt || call.isPending}
              onClick={() =>
                call.mutate({
                  path: 'wait-for-part',
                  body: { reasonCodeId, expectedAt: new Date(`${expectedAt}T12:00:00`).toISOString() },
                })
              }
            >
              Confirmar
            </button>
          </>
        )
      }
    >
      <dl className="tp-facts">
        <div>
          <dt>Estado</dt>
          <dd>
            <span className={`tp-badge tp-badge--status ${materialRequestStatusTone(request.status)}`}>{MATERIAL_REQUEST_STATUS_LABELS[request.status]}</span>
          </dd>
        </div>
        <div>
          <dt>Quantidade</dt>
          <dd>{request.quantity}</dd>
        </div>
        <div>
          <dt>Solicitado</dt>
          <dd>{formatDateTime(request.requestedAt)}</dd>
        </div>
        <div>
          <dt>Separado</dt>
          <dd>{request.separatedAt ? formatDateTime(request.separatedAt) : '—'}</dd>
        </div>
        {request.isSerialized && (
          <div>
            <dt>Número de série</dt>
            <dd>{request.serialNumber ?? 'a informar na entrega'}</dd>
          </div>
        )}
        {request.partWaiting && (
          <div className="is-full">
            <dt>Aguardando peça</dt>
            <dd>
              {request.partWaiting.reasonDescription} · prazo {formatDate(request.partWaiting.expectedAt)}
              {request.partWaiting.isOverdue && (
                <span className="tp-badge tp-badge--danger" style={{ marginLeft: 6 }}>vencido</span>
              )}
            </dd>
          </div>
        )}
      </dl>

      {mode === 'deliver' && (
        <div className="tp-stack">
          <h3>Entrega na valeta (RF-23)</h3>
          <div className="tp-field">
            <label className="tp-label" htmlFor="dl-name">
              Quem recebeu <span className="tp-label__required">obrigatório</span>
            </label>
            <input
              id="dl-name"
              className="tp-input"
              value={receivedByName}
              onChange={(e) => setReceivedByName(e.target.value)}
            />
            <span className="tp-help">Fica registrado com a entrega.</span>
          </div>
          {request.isSerialized && (
            <div className="tp-field">
              <label className="tp-label" htmlFor="dl-serial">
                Número de série entregue
              </label>
              <input
                id="dl-serial"
                className="tp-input"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                placeholder={request.serialNumber ?? ''}
              />
            </div>
          )}
        </div>
      )}

      {mode === 'wait' && (
        <div className="tp-stack">
          <h3>Aguardando peça (RF-24)</h3>
          <div className="tp-field">
            <label className="tp-label" htmlFor="wt-reason">
              Motivo <span className="tp-label__required">obrigatório</span>
            </label>
            <select id="wt-reason" className="tp-select" value={reasonCodeId} onChange={(e) => setReasonCodeId(e.target.value)}>
              <option value="">Selecione…</option>
              {(reasons.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.description}
                </option>
              ))}
            </select>
          </div>
          <div className="tp-field">
            <label className="tp-label" htmlFor="wt-date">
              Prazo previsto <span className="tp-label__required">obrigatório</span>
            </label>
            <input id="wt-date" className="tp-input" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
            <span className="tp-help">Vencido o prazo, o PCM e o Estoque são escalonados automaticamente.</span>
          </div>
        </div>
      )}

      {error && <div className="tp-alert tp-alert--danger">{error}</div>}
    </Drawer>
  );
}
