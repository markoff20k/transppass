import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  KM_SOURCE_LABELS,
  VEHICLE_STATUS_LABELS,
  VEHICLE_TECHNOLOGY_LABELS,
  type VehicleStatus,
  type VehicleTechnology,
  type FleetPanelRow,
  type FleetPanelSummary,
} from '@app/shared';
import { api } from '@/lib/api-client';

interface PanelResponse {
  summary: FleetPanelSummary;
  rows: FleetPanelRow[];
}

/** RF-37 — painel da frota com estados ao vivo e KPIs no topo. */
export function FleetPanelPage() {
  const [technology, setTechnology] = useState<VehicleTechnology | ''>('');
  const [status, setStatus] = useState<VehicleStatus | ''>('');
  const [search, setSearch] = useState('');

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (technology) p.set('technology', technology);
    if (status) p.set('status', status);
    if (search.trim()) p.set('search', search.trim());
    return p.toString();
  }, [technology, status, search]);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['fleet-panel', params],
    queryFn: () => api.get<PanelResponse>(`/vehicles/panel${params ? `?${params}` : ''}`),
    // O painel precisa refletir a garagem quase em tempo real (seção 8 do PRD).
    refetchInterval: 30_000,
  });

  if (isPending) return <p className="muted">Carregando painel…</p>;
  if (isError) return <p className="form-error">{(error as Error).message}</p>;

  const { summary, rows } = data;

  return (
    <>
      <div className="kpi-row">
        <Kpi label="Frota" value={summary.total.toString()} />
        <Kpi label="Disponíveis" value={summary.available.toString()} />
        <Kpi
          label="Disponibilidade"
          value={`${(summary.availabilityRate * 100).toFixed(1)}%`}
          tone={summary.availabilityRate >= 0.85 ? 'good' : 'warn'}
        />
        <Kpi
          label="Km degradado"
          value={summary.degradedKmCount.toString()}
          tone={summary.degradedKmCount > 0 ? 'warn' : 'good'}
          hint="Carros sem leitura de odômetro há mais de 2 dias"
        />
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Prefixo ou placa"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={technology} onChange={(e) => setTechnology(e.target.value as VehicleTechnology | '')}>
          <option value="">Todas as tecnologias</option>
          {Object.entries(VEHICLE_TECHNOLOGY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as VehicleStatus | '')}>
          <option value="">Todos os estados</option>
          {Object.entries(VEHICLE_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Prefixo</th>
              <th>Placa</th>
              <th>Tecnologia</th>
              <th>Estado</th>
              <th className="num">Km atual</th>
              <th className="num">Km projetado</th>
              <th className="num">Média/dia</th>
              <th>Última leitura</th>
              <th>Fonte de km</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.isKmDegraded ? 'row-warn' : undefined}>
                <td className="strong">{row.code}</td>
                <td>{row.plate}</td>
                <td>{VEHICLE_TECHNOLOGY_LABELS[row.technology]}</td>
                <td>
                  <span className={`badge status-${row.status.toLowerCase()}`}>
                    {VEHICLE_STATUS_LABELS[row.status]}
                  </span>
                </td>
                <td className="num">{row.currentKm.toLocaleString('pt-BR')}</td>
                <td className="num">
                  {row.projectedKm === null ? '—' : row.projectedKm.toLocaleString('pt-BR')}
                </td>
                <td className="num">
                  {row.avgDailyKm === null ? '—' : row.avgDailyKm.toLocaleString('pt-BR')}
                </td>
                <td>
                  {row.daysSinceLastReading === null ? (
                    <span className="muted">sem leitura</span>
                  ) : (
                    <span className={row.isKmDegraded ? 'text-warn' : undefined}>
                      há {row.daysSinceLastReading} {row.daysSinceLastReading === 1 ? 'dia' : 'dias'}
                    </span>
                  )}
                </td>
                <td className="muted">{KM_SOURCE_LABELS[row.kmSource]}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="muted center">
                  Nenhum carro encontrado com esses filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Kpi({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'warn';
  hint?: string;
}) {
  return (
    <div className={`kpi${tone ? ` kpi-${tone}` : ''}`} title={hint}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
    </div>
  );
}
