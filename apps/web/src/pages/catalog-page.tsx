import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookCheck, Package, Plus, Trash2 } from 'lucide-react';
import {
  createFailureCatalogItemSchema,
  createReasonCodeSchema,
  REASON_CODE_LIST_LABELS,
  ReasonCodeList,
  createKitSchema,
  type CatalogKitRow,
  type CreateFailureCatalogItemInput,
  type CreateKitInput,
  type CreateReasonCodeInput,
  type FailureCatalogItem,
  type MaterialOption,
  type Paginated,
  type ReasonCode,
  type TransppassCodeRow,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';
import { FailureCodeRules } from '@/components/failure-code/failure-code-rules';
import { BrandLoader } from '@/components/brand/brand-loader';
import { SearchSelect } from '@/components/ui/search-select';
import { formatNumber } from '@/lib/format';

type Panel = { kind: 'closed' } | { kind: 'item' } | { kind: 'reason'; list: ReasonCodeList } | { kind: 'kit'; item: FailureCatalogItem };

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
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['catalog'] });
    void queryClient.invalidateQueries({ queryKey: ['plans', 'catalog-kits'] });
  };
  // Kaizen 2 — kit corretivo vigente de cada falha.
  const kits = useQuery({ queryKey: ['plans', 'catalog-kits'], queryFn: () => api.get<CatalogKitRow[]>('/plans/catalog-kits') });
  const kitOf = (itemId: string) => (kits.data ?? []).find((k) => k.catalogItemId === itemId) ?? null;

  return (
    <>
      <CatalogVersions items={items.data?.data ?? []} onPublished={invalidate} />
      <section className="tp-card">
        <div className="tp-card__head">
          <div><h3>Falhas do catálogo</h3><span className="chart__hint">atalhos de falhas frequentes — cada um pré-preenche o código composto</span></div>
          <input type="search" className="tp-input" style={{ maxWidth: 260 }} placeholder="Código ou descrição" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {items.isPending ? (
          <BrandLoader size={44} label="Carregando" />
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th>Código composto</th>
                  <th>Flags</th>
                  <th className="is-num">Reparo (min)</th>
                  <th className="is-num">Taxa de campo</th>
                  <th>Kit corretivo</th>
                </tr>
              </thead>
              <tbody>
                {(items.data?.data ?? []).map((item) => (
                  <tr key={item.id} className={item.isActive ? undefined : 'is-inactive'}>
                    <td className="is-strong">{item.code}</td>
                    <td>{item.description}</td>
                    <td>{item.failureModeCode && item.subsystemCode ? <code className="fcode__inline">{item.failureModeCode}-{item.subsystemCode}</code> : <span className="tp-muted">{item.system ?? '—'}</span>}</td>
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
                    <td>
                      {(() => {
                        const kit = kitOf(item.id);
                        return (
                          <button type="button" className={`tp-btn tp-btn--sm ${kit ? 'tp-btn--ghost' : 'tp-btn--secondary'}`} onClick={() => setPanel({ kind: 'kit', item })}>
                            <Package size={13} /> {kit ? `${kit.items.length} item(ns) · v${kit.version}` : 'Montar kit'}
                          </button>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <FailureCodeRules />

      <TransppassCodes />

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
      <CorrectiveKitDrawer item={panel.kind === 'kit' ? panel.item : null} kit={panel.kind === 'kit' ? kitOf(panel.item.id) : null} onClose={() => setPanel({ kind: 'closed' })} onDone={() => { setPanel({ kind: 'closed' }); invalidate(); }} />
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

/**
 * Kaizen 2 — o kit corretivo da falha: o que o Estoque separa quando esta
 * falha recolhe um carro. Mudar os itens cria versão nova, como no preventivo.
 */
function CorrectiveKitDrawer({ item, kit, onClose, onDone }: { item: FailureCatalogItem | null; kit: CatalogKitRow | null; onClose: () => void; onDone: () => void }) {
  const [items, setItems] = useState<{ materialId: string; quantity: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const materials = useQuery({ queryKey: ['materials', 'catalog'], queryFn: () => api.get<MaterialOption[]>('/materials/catalog'), enabled: Boolean(item) });
  const byId = new Map((materials.data ?? []).map((m) => [m.id, m]));
  useEffect(() => {
    setError(null);
    setItems((kit?.items ?? []).map((i) => ({ materialId: i.materialId, quantity: String(i.quantity) })));
  }, [item, kit]);
  const save = useMutation({
    mutationFn: (input: CreateKitInput) => api.post(`/plans/catalog-items/${item?.id}/kit`, input),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível salvar o kit'),
  });
  const submit = () => {
    if (!item) return;
    const parsed = createKitSchema.safeParse({ code: kit?.code ?? `KIT-${item.code}`, name: kit?.name ?? `Kit corretivo — ${item.description}`, items: items.filter((i) => i.materialId) });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Dados inválidos');
    if (parsed.data.items.length === 0) return setError('Acrescente ao menos um material');
    setError(null);
    save.mutate(parsed.data);
  };
  const setItem = (i: number, patch: Partial<{ materialId: string; quantity: string }>) => setItems((rows) => rows.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  return (
    <Drawer open={Boolean(item)} onClose={onClose} eyebrow={item ? `${item.code} · ${item.description}` : undefined} title={kit ? `Kit corretivo · v${kit.version}` : 'Montar kit corretivo'}
      description="O que o Estoque separa quando esta falha recolhe um carro. Na OS, a sub-OS pede o kit inteiro com um clique (Kaizen 2)."
      footer={<><button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button><button type="button" className="tp-btn tp-btn--primary" disabled={save.isPending} onClick={submit}>{kit ? 'Salvar nova versão' : 'Criar kit'}</button></>}>
      <div className="tp-stack">
        <div className="tp-field field-materials">
          <span className="tp-label">Materiais do kit</span>
          {items.length === 0 && <span className="tp-help">Nenhum item ainda.</span>}
          {items.map((it, i) => (
            <div key={i} className="field-materials__row field-materials__row--kit">
              <SearchSelect value={it.materialId} onChange={(id) => setItem(i, { materialId: id })} placeholder="Código, descrição ou referência"
                options={(materials.data ?? []).map((m) => ({ id: m.id, label: m.description, hint: `${m.code}${m.manufacturerRef ? ` · ${m.manufacturerRef}` : ''} · saldo ${formatNumber(m.stockQty)}` }))} />
              <input className="tp-input" type="number" min={0} step="any" value={it.quantity} placeholder={byId.get(it.materialId)?.unit ?? 'qtd'} onChange={(e) => setItem(i, { quantity: e.target.value })} />
              <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" aria-label="Remover" onClick={() => setItems((rows) => rows.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" style={{ justifySelf: 'start' }} onClick={() => setItems((rows) => [...rows, { materialId: '', quantity: '1' }])}><Plus size={14} /> Adicionar material</button>
        </div>
        {error && <p className="tp-error">{error}</p>}
      </div>
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

interface CatalogVersion {
  id: string;
  version: number;
  notes: string | null;
  publishedAt: string | null;
  createdAt: string;
}

/**
 * RF-32 — o catálogo é versionado: a constatação de campo nunca reescreve a
 * versão sob a qual um evento passado foi registrado. Itens novos entram no
 * rascunho; publicar é o que os põe em uso.
 */
function CatalogVersions({ items, onPublished }: { items: FailureCatalogItem[]; onPublished: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const published = useQuery({ queryKey: ['catalog', 'versions', 'published'], queryFn: () => api.get<CatalogVersion | null>('/catalog/versions/published') });
  const draft = useQuery({ queryKey: ['catalog', 'versions', 'draft'], queryFn: () => api.get<CatalogVersion>('/catalog/versions/draft') });
  const publish = useMutation({
    mutationFn: () => api.post(`/catalog/versions/${draft.data?.id}/publish`),
    onSuccess: () => { setError(null); onPublished(); },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível publicar'),
  });
  const draftItems = draft.data ? items.filter((i) => i.versionId === draft.data!.id).length : 0;
  return (
    <section className="catalog-versions">
      <div className={`tp-kpi ${published.data ? 'tp-kpi--good' : ''}`}>
        <span className="tp-kpi__label">Versão em uso</span>
        <strong className="tp-kpi__value">{published.data ? `v${published.data.version}` : '—'}</strong>
        <span className="tp-kpi__note">{published.data?.publishedAt ? `publicada em ${formatDateTime(published.data.publishedAt)}` : 'nenhuma versão publicada'}</span>
      </div>
      <div className={`tp-kpi ${draftItems > 0 ? 'tp-kpi--warn' : ''}`}>
        <span className="tp-kpi__label">Rascunho</span>
        <strong className="tp-kpi__value">{draft.data ? `v${draft.data.version}` : '—'}</strong>
        <span className="tp-kpi__note">{draftItems} item(ns) aguardando publicação</span>
      </div>
      <div className="catalog-versions__action">
        <p className="tp-muted">Itens novos entram no rascunho. Publicar põe a versão em uso para triagem, socorro e OS; eventos antigos continuam na versão em que foram registrados.</p>
        <button type="button" className="tp-btn tp-btn--primary tp-btn--sm" disabled={!draft.data || draftItems === 0 || publish.isPending} onClick={() => publish.mutate()}>
          <BookCheck size={14} /> {publish.isPending ? 'Publicando…' : `Publicar v${draft.data?.version ?? ''}`}
        </button>
        {error && <span className="tp-error">{error}</span>}
      </div>
    </section>
  );
}

/** A classificação que a Transppass usa hoje (defeito alegado × defeito constatado), lado a lado com o padrão de codificação. */
function TransppassCodes() {
  const codes = useQuery({ queryKey: ['catalog', 'transppass-codes'], queryFn: () => api.get<TransppassCodeRow[]>('/catalog/transppass-codes'), staleTime: 300_000 });
  const [kind, setKind] = useState<'ALEGADO' | 'CONSTATADO'>('CONSTATADO');
  const [q, setQ] = useState('');
  const rows = (codes.data ?? []).filter((c) => c.kind === kind && (!q || c.code.includes(q) || c.description.toLowerCase().includes(q.toLowerCase()) || (c.group ?? '').toLowerCase().includes(q.toLowerCase())));
  if (!codes.data || codes.data.length === 0) return null;
  const fichas = codes.data.filter((c) => c.kind === 'FICHA');
  return (
    <section className="tp-card">
      <div className="tp-card__head">
        <div><h3>Classificação da Transppass</h3><span className="chart__hint">os códigos do sistema atual (arquivo "Serviços"): o que o motorista alega e o que a oficina constata. O de-para com o padrão Modo × Subsistema é o próximo passo.</span></div>
        <div className="tp-btn-group" role="group" aria-label="Tabela">
          <button type="button" className={`tp-btn tp-btn--sm ${kind === 'ALEGADO' ? '' : 'tp-btn--secondary'}`} aria-pressed={kind === 'ALEGADO'} onClick={() => setKind('ALEGADO')}>Defeito alegado · {codes.data.filter((c) => c.kind === 'ALEGADO').length}</button>
          <button type="button" className={`tp-btn tp-btn--sm ${kind === 'CONSTATADO' ? '' : 'tp-btn--secondary'}`} aria-pressed={kind === 'CONSTATADO'} onClick={() => setKind('CONSTATADO')}>Defeito constatado · {codes.data.filter((c) => c.kind === 'CONSTATADO').length}</button>
        </div>
      </div>
      <div className="tp-toolbar">
        <input type="search" className="tp-input" style={{ maxWidth: 320 }} placeholder="Código, descrição ou grupo" aria-label="Buscar código" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="tp-muted tp-toolbar__count">{rows.length} código(s)</span>
      </div>
      <div className="tp-table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="tp-table tp-table--compact">
          <thead><tr><th>Código</th><th>Descrição</th><th>Grupo</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={`${c.kind}-${c.code}`}><td className="tp-mono is-strong">{c.code}</td><td>{c.description}</td><td className="tp-muted">{c.group ?? '—'}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {fichas.length > 0 && <p className="tp-muted" style={{ margin: 0, fontSize: 'var(--tp-text-xs)' }}>Tipos de ficha: {fichas.map((f) => `${f.code} ${f.description}`).join(' · ')}</p>}
    </section>
  );
}
