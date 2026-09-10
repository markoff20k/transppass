import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  createFailureCatalogItemSchema,
  createReasonCodeSchema,
  REASON_CODE_LIST_LABELS,
  ReasonCodeList,
  type CreateFailureCatalogItemInput,
  type CreateReasonCodeInput,
  type FailureCatalogItem,
  type Paginated,
  type ReasonCode,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';

type Panel = { kind: 'closed' } | { kind: 'item' } | { kind: 'reason'; list: ReasonCodeList };

/**
 * RF-32/33 — catálogo de falhas e as cinco listas de códigos de motivo.
 *
 * As flags de fast-track e segurança dirigem o processo (RF-05/RF-06), mas
 * quais falhas recebem cada uma é questão aberta do PRD (seção 12). A tela
 * mostra a carga atual para essa conversa acontecer sobre dados.
 */
export function CatalogPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [panel, setPanel] = useState<Panel>({ kind: 'closed' });

  usePageHeader({
    eyebrow: 'Cadastros',
    title: 'Catálogo de falhas',
    description: 'Flags que dirigem o processo e as cinco listas de códigos de motivo.',
    actions: (
      <button type="button" className="tp-btn tp-btn--primary tp-btn--sm" onClick={() => setPanel({ kind: 'item' })}>
        <Plus size={14} /> Nova falha
      </button>
    ),
  });

  const items = useQuery({
    queryKey: ['catalog', 'items', search],
    queryFn: () =>
      api.get<Paginated<FailureCatalogItem>>(
        `/catalog/items?perPage=100&onlyActive=false${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
  });

  const reasonCodes = useQuery({
    queryKey: ['catalog', 'reason-codes'],
    queryFn: () => api.get<ReasonCode[]>('/catalog/reason-codes?onlyActive=false'),
  });

  const byList = (list: ReasonCodeList) => (reasonCodes.data ?? []).filter((rc) => rc.list === list);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['catalog'] });

  return (
    <>
      <section className="tp-card">
        <div className="tp-card__head">
          <h3>Falhas do catálogo</h3>
          <input type="search" className="tp-input" style={{ maxWidth: 260 }} placeholder="Código ou descrição" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {items.isPending ? (
          <p className="tp-muted">Carregando…</p>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th>Sistema</th>
                  <th>Flags</th>
                  <th className="is-num">Reparo (min)</th>
                  <th className="is-num">Taxa de campo</th>
                </tr>
              </thead>
              <tbody>
                {(items.data?.data ?? []).map((item) => (
                  <tr key={item.id} className={item.isActive ? undefined : 'is-inactive'}>
                    <td className="is-strong">{item.code}</td>
                    <td>{item.description}</td>
                    <td className="tp-muted">{item.system ?? '—'}</td>
                    <td>
                      <span className="tp-row">
                        {item.isSafety && <span className="tp-badge tp-badge--danger">segurança</span>}
                        {item.isFastTrack && <span className="tp-badge tp-badge--brand">fast-track</span>}
                        {item.isDeferrable && <span className="tp-badge">deferível</span>}
                      </span>
                    </td>
                    <td className="is-num">{item.estimatedRepairMinutes ?? '—'}</td>
                    <td className="is-num">
                      {item.fieldResolutionRate === null ? '—' : `${(item.fieldResolutionRate * 100).toFixed(0)}% (${item.fieldResolutionSamples})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="tp-card">
        <div className="tp-card__head">
          <h3>Códigos de motivo (RF-33)</h3>
          <span className="tp-muted">desativa, nunca exclui — registros antigos seguem legíveis</span>
        </div>
        <div className="tp-alert tp-alert--warning">
          O conteúdo definitivo das cinco listas é dependência declarada do PRD (seção 9) e precisa ser
          fechado por PCM, Estoque, Manutenção e Operação antes do R1. O que está aqui é carga inicial.
        </div>
        <div className="reason-grid">
          {Object.values(ReasonCodeList).map((list) => (
            <div key={list} className="reason-col">
              <div className="tp-row" style={{ justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0 }}>{REASON_CODE_LIST_LABELS[list]}</h3>
                <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" onClick={() => setPanel({ kind: 'reason', list })} aria-label={`Novo código em ${REASON_CODE_LIST_LABELS[list]}`}>
                  <Plus size={14} />
                </button>
              </div>
              <ul>
                {byList(list).map((rc) => (
                  <li key={rc.id} className={rc.isActive ? undefined : 'tp-muted'}>
                    <b>{rc.code}</b> — {rc.description}
                    {!rc.isActive && ' (inativo)'}
                  </li>
                ))}
                {byList(list).length === 0 && <li className="tp-muted">Lista vazia</li>}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <NewItemDrawer open={panel.kind === 'item'} onClose={() => setPanel({ kind: 'closed' })} onDone={() => { setPanel({ kind: 'closed' }); invalidate(); }} />
      <NewReasonDrawer list={panel.kind === 'reason' ? panel.list : null} onClose={() => setPanel({ kind: 'closed' })} onDone={() => { setPanel({ kind: 'closed' }); invalidate(); }} />
    </>
  );
}

function NewItemDrawer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<CreateFailureCatalogItemInput>({
    resolver: zodResolver(createFailureCatalogItemSchema),
    defaultValues: { isFastTrack: false, isSafety: false, isDeferrable: true },
  });

  const isSafety = watch('isSafety');

  const mutation = useMutation({
    mutationFn: (input: CreateFailureCatalogItemInput) => api.post<FailureCatalogItem>('/catalog/items', input),
    onSuccess: () => {
      reset();
      setError(null);
      onDone();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao criar a falha'),
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Catálogo · versão rascunho"
      title="Nova falha"
      description="Entra na versão rascunho. A versão publicada é imutável (RF-32)."
      footer={
        <>
          <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" form="item-form" className="tp-btn tp-btn--primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Salvando…' : 'Criar falha'}
          </button>
        </>
      }
    >
      <form id="item-form" className="tp-stack" onSubmit={handleSubmit((v) => mutation.mutate(v))} noValidate>
        <div className="tp-facts">
          <div className="tp-field">
            <label className="tp-label" htmlFor="ci-code">Código</label>
            <input id="ci-code" className="tp-input" placeholder="ELE-ALT-02" {...register('code')} />
            {errors.code && <span className="tp-error">{errors.code.message}</span>}
          </div>
          <div className="tp-field">
            <label className="tp-label" htmlFor="ci-min">Reparo estimado (min)</label>
            <input id="ci-min" className="tp-input tp-input--num" type="number" {...register('estimatedRepairMinutes')} />
          </div>
          <div className="tp-field is-full">
            <label className="tp-label" htmlFor="ci-desc">Descrição</label>
            <input id="ci-desc" className="tp-input" {...register('description')} />
            {errors.description && <span className="tp-error">{errors.description.message}</span>}
          </div>
          <div className="tp-field">
            <label className="tp-label" htmlFor="ci-sys">Sistema</label>
            <input id="ci-sys" className="tp-input" {...register('system')} />
          </div>
          <div className="tp-field">
            <label className="tp-label" htmlFor="ci-sub">Subsistema</label>
            <input id="ci-sub" className="tp-input" {...register('subsystem')} />
          </div>
          <div className="tp-field is-full">
            <label className="tp-label" htmlFor="ci-cause">Causa provável</label>
            <input id="ci-cause" className="tp-input" {...register('probableCause')} />
          </div>
        </div>

        <div className="tp-stack tp-stack--tight">
          <h3>Flags que dirigem o processo</h3>
          <label className="tp-check"><input type="checkbox" {...register('isSafety')} /> Segurança — bloqueia retorno à linha e deferimento (RF-05)</label>
          <label className="tp-check"><input type="checkbox" {...register('isFastTrack')} /> Fast-track — abre OS e prioriza sozinho ao recolher (RF-06)</label>
          <label className="tp-check"><input type="checkbox" disabled={isSafety} {...register('isDeferrable')} /> Deferível — pode esperar a parada programada</label>
          {isSafety && <span className="tp-help">Falha de segurança nunca é deferível.</span>}
          {errors.isDeferrable && <span className="tp-error">{errors.isDeferrable.message}</span>}
        </div>

        {error && <div className="tp-alert tp-alert--danger">{error}</div>}
      </form>
    </Drawer>
  );
}

function NewReasonDrawer({ list, onClose, onDone }: { list: ReasonCodeList | null; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateReasonCodeInput>({ resolver: zodResolver(createReasonCodeSchema) });

  const mutation = useMutation({
    mutationFn: (input: CreateReasonCodeInput) => api.post<ReasonCode>('/catalog/reason-codes', input),
    onSuccess: () => {
      reset();
      setError(null);
      onDone();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao criar o código'),
  });

  if (!list) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow="Código de motivo"
      title={REASON_CODE_LIST_LABELS[list]}
      description="Códigos são desativados, nunca excluídos (RF-33)."
      footer={
        <>
          <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" form="reason-form" className="tp-btn tp-btn--primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Salvando…' : 'Criar código'}
          </button>
        </>
      }
    >
      <form id="reason-form" className="tp-stack" onSubmit={handleSubmit((v) => mutation.mutate({ ...v, list }))} noValidate>
        <input type="hidden" value={list} {...register('list')} />
        <div className="tp-field">
          <label className="tp-label" htmlFor="rc-code">Código</label>
          <input id="rc-code" className="tp-input" placeholder="SEG" {...register('code')} />
          {errors.code && <span className="tp-error">{errors.code.message}</span>}
        </div>
        <div className="tp-field">
          <label className="tp-label" htmlFor="rc-desc">Descrição</label>
          <input id="rc-desc" className="tp-input" {...register('description')} />
          {errors.description && <span className="tp-error">{errors.description.message}</span>}
        </div>
        {error && <div className="tp-alert tp-alert--danger">{error}</div>}
      </form>
    </Drawer>
  );
}
