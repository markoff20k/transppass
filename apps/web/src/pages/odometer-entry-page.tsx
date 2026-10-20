import { usePageHeader } from '@/components/shell/page-header.context';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import {
  classifyOdometerDelta,
  KmSource,
  OdometerStatus,
  type OdometerBatchResult,
  type Paginated,
  type Vehicle,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { todayLocalIso } from '@/lib/format';

/**
 * RF-14 — lançamento diário de km da frota diesel, em lote.
 *
 * O PRD trata a disciplina desse lançamento como o principal risco do R0, então
 * a tela valida o delta enquanto o operador digita, com exatamente o mesmo
 * critério que a API vai aplicar — o erro aparece antes do envio, não depois.
 */
export function OdometerEntryPage() {
  usePageHeader({ eyebrow: 'Gestão', title: 'Lançamento de km', description: 'Leitura diária da frota diesel, validada na origem.' });

  const queryClient = useQueryClient();
  const [readAt, setReadAt] = useState(() => todayLocalIso());
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<OdometerBatchResult | null>(null);

  // Só carros de lançamento manual: eBUS chega por telemetria (RF-15).
  const { data, isPending } = useQuery({
    queryKey: ['vehicles', 'manual-km'],
    queryFn: () =>
      api.get<Paginated<Vehicle>>('/vehicles?perPage=100&onlyActive=true'),
  });

  const vehicles = useMemo(
    () => (data?.data ?? []).filter((v) => v.kmSource === KmSource.MANUAL),
    [data],
  );

  const entries = useMemo(
    () =>
      vehicles
        .map((v) => ({ vehicle: v, raw: values[v.id]?.trim() ?? '' }))
        .filter((e) => e.raw !== '')
        .map((e) => {
          const rawKm = Number(e.raw);
          const adjusted = rawKm + e.vehicle.odometerOffset;
          const deltaKm = e.vehicle.currentKm > 0 ? adjusted - e.vehicle.currentKm : null;
          return { ...e, rawKm, deltaKm, ...classifyOdometerDelta(deltaKm) };
        }),
    [vehicles, values],
  );

  const blocking = entries.filter((e) => e.status === OdometerStatus.REJECTED);
  const suspect = entries.filter((e) => e.status === OdometerStatus.SUSPECT);
  const pending = vehicles.length - entries.length;

  const mutation = useMutation({
    mutationFn: (payload: { entries: { vehicleId: string; rawKm: number; readAt: string }[] }) =>
      api.post<OdometerBatchResult>('/odometer/batch', payload),
    onSuccess: (res) => {
      setResult(res);
      setValues({});
      void queryClient.invalidateQueries({ queryKey: ['fleet-panel'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    mutation.mutate({
      entries: entries.map((entry) => ({
        vehicleId: entry.vehicle.id,
        rawKm: entry.rawKm,
        readAt: new Date(`${readAt}T12:00:00`).toISOString(),
      })),
    });
  };

  if (isPending) return <p className="tp-muted">Carregando frota…</p>;

  return (
    <form onSubmit={submit} className="tp-stack">
      <div className="tp-kpi-row">
        <div className="tp-kpi tp-kpi--brand">
          <span className="tp-kpi__label">Carros a lançar</span>
          <strong className="tp-kpi__value">{vehicles.length}</strong>
          <span className="tp-kpi__note">frota com km manual — eBUS vem por telemetria</span>
        </div>
        <div className={`tp-kpi ${pending === 0 && vehicles.length > 0 ? 'tp-kpi--good' : ''}`}>
          <span className="tp-kpi__label">Preenchidos</span>
          <strong className="tp-kpi__value">
            {entries.length}<small className="tp-kpi__of"> / {vehicles.length}</small>
          </strong>
          <span className="tp-kpi__note">{pending === 0 ? 'dia completo' : `${pending} ainda sem leitura`}</span>
        </div>
        <div className={`tp-kpi ${suspect.length > 0 ? 'tp-kpi--warn' : ''}`}>
          <span className="tp-kpi__label">Com suspeita</span>
          <strong className="tp-kpi__value">{suspect.length}</strong>
          <span className="tp-kpi__note">delta fora da média — entra marcado</span>
        </div>
        <div className={`tp-kpi ${blocking.length > 0 ? 'tp-kpi--danger' : ''}`}>
          <span className="tp-kpi__label">Recusadas</span>
          <strong className="tp-kpi__value">{blocking.length}</strong>
          <span className="tp-kpi__note">km menor que o anterior ou salto impossível</span>
        </div>
      </div>

      <section className="tp-card">
        <div className="tp-card__head">
          <div>
            <h3>Leitura do dia</h3>
            <span className="chart__hint">a validação acontece enquanto você digita, com o mesmo critério da API</span>
          </div>
          <label className="km-date">
            <CalendarDays size={15} aria-hidden />
            <span>Data da leitura</span>
            <input
              type="date"
              className="tp-input"
              value={readAt}
              max={todayLocalIso()}
              onChange={(e) => setReadAt(e.target.value)}
              required
            />
          </label>
        </div>

        {vehicles.length === 0 && (
          <div className="tp-table__empty">
            Nenhum carro com fonte de km manual. A frota eBUS é lida por telemetria.
          </div>
        )}

        {vehicles.length > 0 && (
          <div className="tp-table-wrap">
            <table className="tp-table km-table">
              <thead>
                <tr>
                  <th>Prefixo</th>
                  <th>Placa</th>
                  <th className="is-num">Km anterior</th>
                  <th className="is-num">Leitura do hodômetro</th>
                  <th className="is-num">Delta</th>
                  <th>Validação</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((vehicle) => {
                  const entry = entries.find((e) => e.vehicle.id === vehicle.id);
                  const tone =
                    entry?.status === OdometerStatus.REJECTED
                      ? 'danger'
                      : entry?.status === OdometerStatus.SUSPECT
                        ? 'warning'
                        : entry
                          ? 'success'
                          : null;
                  return (
                    <tr
                      key={vehicle.id}
                      className={tone === 'danger' ? 'is-danger' : tone === 'warning' ? 'is-warning' : undefined}
                    >
                      <td className="is-strong">{vehicle.code}</td>
                      <td className="tp-muted">{vehicle.plate}</td>
                      <td className="is-num">
                        {vehicle.currentKm > 0 ? vehicle.currentKm.toLocaleString('pt-BR') : '—'}
                      </td>
                      <td className="is-num">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          className="tp-input km-input"
                          aria-label={`Leitura do hodômetro do carro ${vehicle.code}`}
                          value={values[vehicle.id] ?? ''}
                          onChange={(e) =>
                            setValues((prev) => ({ ...prev, [vehicle.id]: e.target.value }))
                          }
                          placeholder="—"
                        />
                      </td>
                      <td className="is-num">
                        {entry?.deltaKm === null || entry?.deltaKm === undefined ? (
                          <span className="tp-muted">—</span>
                        ) : (
                          <b>{entry.deltaKm > 0 ? '+' : ''}{entry.deltaKm.toLocaleString('pt-BR')} km</b>
                        )}
                      </td>
                      <td className="validation">
                        {tone === 'success' && <span className="tp-badge tp-badge--success">ok</span>}
                        {tone === 'warning' && <span className="tp-badge tp-badge--warning">suspeita</span>}
                        {tone === 'danger' && <span className="tp-badge tp-badge--danger">recusada</span>}
                        {entry?.message && <span className="validation__text">{entry.message}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {mutation.isError && (
          <p className="tp-error">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Falha ao enviar os lançamentos'}
          </p>
        )}

        {result && (
          <div className="tp-alert tp-alert--info">
            <strong>
              {result.accepted} aceito(s), {result.suspect} com suspeita, {result.rejected} recusado(s).
            </strong>
            <ul>
              {result.items
                .filter((i) => i.message)
                .map((i) => (
                  <li key={i.vehicleId}>
                    <b>{i.vehicleCode}</b>: {i.message}
                  </li>
                ))}
            </ul>
          </div>
        )}

        <div className="tp-card__foot">
          <span className={blocking.length > 0 ? 'tp-error' : 'tp-muted'}>
            {blocking.length > 0
              ? `${blocking.length} leitura(s) serão recusadas — corrija antes de enviar.`
              : entries.length === 0
                ? 'Digite a leitura de pelo menos um carro.'
                : `${entries.length} de ${vehicles.length} carros preenchidos.`}
          </span>
          <button type="submit" className="tp-btn tp-btn--primary" disabled={entries.length === 0 || mutation.isPending}>
            {mutation.isPending ? 'Enviando…' : `Lançar ${entries.length} leitura(s)`}
          </button>
        </div>
      </section>
    </form>
  );
}
