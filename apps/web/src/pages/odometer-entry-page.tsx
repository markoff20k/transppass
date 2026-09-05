import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  classifyOdometerDelta,
  KmSource,
  OdometerStatus,
  type OdometerBatchResult,
  type Paginated,
  type Vehicle,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';

/**
 * RF-14 — lançamento diário de km da frota diesel, em lote.
 *
 * O PRD trata a disciplina desse lançamento como o principal risco do R0, então
 * a tela valida o delta enquanto o operador digita, com exatamente o mesmo
 * critério que a API vai aplicar — o erro aparece antes do envio, não depois.
 */
export function OdometerEntryPage() {
  const queryClient = useQueryClient();
  const [readAt, setReadAt] = useState(() => new Date().toISOString().slice(0, 10));
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

  if (isPending) return <p className="muted">Carregando frota…</p>;

  return (
    <form onSubmit={submit}>
      <div className="toolbar">
        <label className="inline">
          Data da leitura
          <input
            type="date"
            value={readAt}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setReadAt(e.target.value)}
            required
          />
        </label>
        <span className="muted">
          {entries.length} de {vehicles.length} carros preenchidos
        </span>
      </div>

      {vehicles.length === 0 && (
        <p className="muted">
          Nenhum carro com fonte de km manual. A frota eBUS é lida por telemetria.
        </p>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Prefixo</th>
              <th>Placa</th>
              <th className="num">Km anterior</th>
              <th className="num">Leitura do hodômetro</th>
              <th className="num">Delta</th>
              <th>Validação</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((vehicle) => {
              const entry = entries.find((e) => e.vehicle.id === vehicle.id);
              return (
                <tr
                  key={vehicle.id}
                  className={
                    entry?.status === OdometerStatus.REJECTED
                      ? 'row-error'
                      : entry?.status === OdometerStatus.SUSPECT
                        ? 'row-warn'
                        : undefined
                  }
                >
                  <td className="strong">{vehicle.code}</td>
                  <td>{vehicle.plate}</td>
                  <td className="num">
                    {vehicle.currentKm > 0 ? vehicle.currentKm.toLocaleString('pt-BR') : '—'}
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      className="km-input"
                      value={values[vehicle.id] ?? ''}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [vehicle.id]: e.target.value }))
                      }
                      placeholder="—"
                    />
                  </td>
                  <td className="num">
                    {entry?.deltaKm === null || entry?.deltaKm === undefined
                      ? '—'
                      : entry.deltaKm.toLocaleString('pt-BR')}
                  </td>
                  <td className="validation">{entry?.message ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {mutation.isError && (
        <p className="form-error">
          {mutation.error instanceof ApiError
            ? mutation.error.message
            : 'Falha ao enviar os lançamentos'}
        </p>
      )}

      {result && (
        <div className="notice">
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

      <div className="form-actions">
        {blocking.length > 0 && (
          <span className="form-error">
            {blocking.length} leitura(s) serão recusadas — corrija antes de enviar.
          </span>
        )}
        <button type="submit" disabled={entries.length === 0 || mutation.isPending}>
          {mutation.isPending ? 'Enviando…' : `Lançar ${entries.length} leitura(s)`}
        </button>
      </div>
    </form>
  );
}
