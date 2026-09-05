import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  REASON_CODE_LIST_LABELS,
  ReasonCodeList,
  type FailureCatalogItem,
  type Paginated,
  type ReasonCode,
} from '@app/shared';
import { api } from '@/lib/api-client';

/**
 * RF-32/33 — catálogo de falhas e as cinco listas de códigos de motivo.
 *
 * As flags de fast-track e segurança dirigem o processo inteiro (RF-05/RF-06),
 * mas quais falhas recebem cada uma é questão aberta do PRD (seção 12), a
 * fechar com Manutenção e PCM antes do R1. Esta tela já mostra o estado atual
 * da carga para essa conversa acontecer sobre dados, não sobre memória.
 */
export function CatalogPage() {
  const [search, setSearch] = useState('');

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

  const byList = (list: ReasonCodeList) =>
    (reasonCodes.data ?? []).filter((rc) => rc.list === list);

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Catálogo de falhas</h2>
          <input
            type="search"
            placeholder="Código ou descrição"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {items.isPending ? (
          <p className="muted">Carregando…</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th>Sistema</th>
                  <th>Flags</th>
                  <th className="num">Reparo (min)</th>
                  <th className="num">Taxa de campo</th>
                </tr>
              </thead>
              <tbody>
                {(items.data?.data ?? []).map((item) => (
                  <tr key={item.id} className={item.isActive ? undefined : 'row-muted'}>
                    <td className="strong">{item.code}</td>
                    <td>{item.description}</td>
                    <td className="muted">{item.system ?? '—'}</td>
                    <td className="flags">
                      {item.isSafety && <span className="badge badge-danger">segurança</span>}
                      {item.isFastTrack && <span className="badge badge-accent">fast-track</span>}
                      {item.isDeferrable && <span className="badge">deferível</span>}
                    </td>
                    <td className="num">{item.estimatedRepairMinutes ?? '—'}</td>
                    <td className="num">
                      {item.fieldResolutionRate === null
                        ? '—'
                        : `${(item.fieldResolutionRate * 100).toFixed(0)}% (${item.fieldResolutionSamples})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Códigos de motivo</h2>
        <p className="muted">
          Cinco listas. O conteúdo definitivo é dependência declarada do PRD e precisa ser
          fechado por PCM, Estoque, Manutenção e Operação antes do R1 — o que está aqui é carga
          inicial de exemplo.
        </p>

        <div className="reason-grid">
          {Object.values(ReasonCodeList).map((list) => (
            <div key={list} className="reason-col">
              <h3>{REASON_CODE_LIST_LABELS[list]}</h3>
              <ul>
                {byList(list).map((rc) => (
                  <li key={rc.id} className={rc.isActive ? undefined : 'muted'}>
                    <b>{rc.code}</b> — {rc.description}
                    {!rc.isActive && ' (inativo)'}
                  </li>
                ))}
                {byList(list).length === 0 && <li className="muted">Lista vazia</li>}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
