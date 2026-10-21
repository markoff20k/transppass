import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search } from 'lucide-react';
import {
  createVehicleSchema,
  FLEET_ROLE_LABELS,
  KM_SOURCE_LABELS,
  KmSource,
  VEHICLE_CLASS_LABELS,
  VEHICLE_STATUS_LABELS,
  VEHICLE_TECHNOLOGY_LABELS,
  VehicleTechnology,
  type CreateVehicleInput,
  type Paginated,
  type Vehicle,
} from '@app/shared';
import { VEHICLE_STATE_FAMILY } from '@app/design-kit';
import { ApiError, api } from '@/lib/api-client';
import { formatNumber } from '@/lib/format';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';
import { BrandLoader } from '@/components/brand/brand-loader';

type Mode = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; vehicle: Vehicle };

/** RF-35 — cadastro da frota. Criar e editar abrem o painel lateral. */
export function VehiclesPage() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>({ kind: 'closed' });
  const [search, setSearch] = useState('');
  const [cls, setCls] = useState('');
  const [lot, setLot] = useState('');

  usePageHeader({
    eyebrow: 'Cadastros',
    title: 'Frota',
    description: 'Prefixo, placa, classe, lote, tecnologia e fonte de km por carro.',
    actions: (
      <button type="button" className="tp-btn tp-btn--primary tp-btn--sm" onClick={() => setMode({ kind: 'create' })}>
        <Plus size={14} /> Novo carro
      </button>
    ),
  });

  const { data, isPending } = useQuery({
    queryKey: ['vehicles', 'all'],
    queryFn: () => api.get<Paginated<Vehicle>>('/vehicles?perPage=500&onlyActive=false'),
  });

  const all = data?.data ?? [];
  const lots = [...new Set(all.map((v) => v.lot).filter((l): l is string => Boolean(l)))].sort();
  const q = search.trim().toLowerCase();
  const rows = all
    .filter((v) => (q ? `${v.code} ${v.plate} ${v.model ?? ''}`.toLowerCase().includes(q) : true))
    .filter((v) => (cls ? v.vehicleClass === cls : true))
    .filter((v) => (lot ? v.lot === lot : true));
  const active = all.filter((v) => v.isActive);
  const diesel = active.filter((v) => v.technology === VehicleTechnology.DIESEL).length;
  const ebus = active.filter((v) => v.technology === VehicleTechnology.EBUS).length;
  const telemetry = active.filter((v) => v.kmSource === KmSource.TELEMETRY).length;

  return (
    <>
      <div className="tp-kpi-row">
        <div className="tp-kpi tp-kpi--brand">
          <span className="tp-kpi__label">Carros ativos</span>
          <strong className="tp-kpi__value">{active.length}</strong>
          <span className="tp-kpi__note">{all.length - active.length > 0 ? `${all.length - active.length} desativado(s) fora do painel` : `${active.filter((v) => v.fleetRole === 'RESERVA').length} reservas · ${lots.length} lote(s)`}</span>
        </div>
        <div className="tp-kpi">
          <span className="tp-kpi__label">Diesel</span>
          <strong className="tp-kpi__value">{diesel}</strong>
          <span className="tp-kpi__note">km por lançamento manual diário</span>
        </div>
        <div className="tp-kpi">
          <span className="tp-kpi__label">eBUS</span>
          <strong className="tp-kpi__value">{ebus}</strong>
          <span className="tp-kpi__note">km por telemetria</span>
        </div>
        <div className={`tp-kpi ${telemetry === active.length && active.length > 0 ? 'tp-kpi--good' : ''}`}>
          <span className="tp-kpi__label">Com telemetria</span>
          <strong className="tp-kpi__value">
            {telemetry}<small className="tp-kpi__of"> / {active.length}</small>
          </strong>
          <span className="tp-kpi__note">o restante depende da disciplina do lançamento</span>
        </div>
      </div>

      <section className="tp-card">
        <div className="tp-card__head">
          <div>
            <h3>Frota cadastrada</h3>
            <span className="chart__hint">prefixo, placa, classe, lote e a fonte de km — clique na linha para editar</span>
          </div>
          <span className="tp-muted">{rows.length === all.length ? `${all.length} carro(s)` : `${rows.length} de ${all.length} carro(s)`}</span>
        </div>
        <div className="tp-toolbar">
          <label className="tp-search">
            <Search size={15} aria-hidden />
            <input type="search" className="tp-input" placeholder="Prefixo, placa ou modelo" aria-label="Buscar carro" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <select className="tp-select" aria-label="Classe" value={cls} onChange={(e) => setCls(e.target.value)}>
            <option value="">Todas as classes</option>
            {Object.entries(VEHICLE_CLASS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select className="tp-select" aria-label="Lote" value={lot} onChange={(e) => setLot(e.target.value)}>
            <option value="">Todos os lotes</option>
            {lots.map((l) => <option key={l} value={l}>Lote {l}</option>)}
          </select>
        </div>
        {isPending ? (
          <BrandLoader size={44} label="Carregando" />
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Prefixo</th>
                  <th>Placa</th>
                  <th>Classe</th>
                  <th>Lote</th>
                  <th>Modelo</th>
                  <th>Tecnologia</th>
                  <th>Fonte de km</th>
                  <th className="is-num">Offset</th>
                  <th className="is-num">Km atual</th>
                  <th>Estado</th>
                  <th className="is-action" aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => {
                  const family = VEHICLE_STATE_FAMILY[v.status] ?? 'waiting';
                  return (
                    <tr
                      key={v.id}
                      className={`is-clickable${v.isActive ? '' : ' is-inactive'}${mode.kind === 'edit' && mode.vehicle.id === v.id ? ' is-selected' : ''}`}
                      onClick={() => setMode({ kind: 'edit', vehicle: v })}
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && setMode({ kind: 'edit', vehicle: v })}
                    >
                      <td className="is-strong">{v.code}</td>
                      <td className="tp-mono">{v.plate}</td>
                      <td>{v.vehicleClass ? VEHICLE_CLASS_LABELS[v.vehicleClass] : '—'}{v.fleetRole === 'RESERVA' && <span className="tp-badge tp-badge--status" style={{ marginLeft: 6 }}>reserva</span>}</td>
                      <td className="tp-muted">{v.lot ?? '—'}</td>
                      <td className="tp-muted">{v.model ?? '—'}{v.modelYear ? ` · ${v.modelYear}` : ''}</td>
                      <td>{VEHICLE_TECHNOLOGY_LABELS[v.technology]}</td>
                      <td>{KM_SOURCE_LABELS[v.kmSource]}</td>
                      <td className="is-num">{formatNumber(v.odometerOffset)}</td>
                      <td className="is-num">{formatNumber(v.currentKm)}</td>
                      <td>
                        <span className={`tp-state tp-state--${family}`}>{VEHICLE_STATUS_LABELS[v.status]}</span>
                      </td>
                      <td className="is-action">
                        <span className="tp-row-action"><Pencil size={13} /> Editar</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <VehicleDrawer
        mode={mode}
        onClose={() => setMode({ kind: 'closed' })}
        onSaved={() => {
          setMode({ kind: 'closed' });
          void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
          void queryClient.invalidateQueries({ queryKey: ['fleet-panel'] });
          void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        }}
      />
    </>
  );
}

function VehicleDrawer({ mode, onClose, onSaved }: { mode: Mode; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const editing = mode.kind === 'edit' ? mode.vehicle : null;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateVehicleInput>({
    resolver: zodResolver(createVehicleSchema),
    defaultValues: { technology: VehicleTechnology.DIESEL, kmSource: KmSource.MANUAL, odometerOffset: 0 },
  });

  useEffect(() => {
    if (mode.kind === 'edit') {
      reset({
        code: mode.vehicle.code,
        plate: mode.vehicle.plate,
        technology: mode.vehicle.technology,
        kmSource: mode.vehicle.kmSource,
        odometerOffset: mode.vehicle.odometerOffset,
        manufacturer: mode.vehicle.manufacturer ?? undefined,
        model: mode.vehicle.model ?? undefined,
        modelYear: mode.vehicle.modelYear ?? undefined,
        vehicleClass: mode.vehicle.vehicleClass ?? undefined,
        lot: mode.vehicle.lot ?? undefined,
        fleetRole: mode.vehicle.fleetRole ?? undefined,
      });
    } else if (mode.kind === 'create') {
      reset({ technology: VehicleTechnology.DIESEL, kmSource: KmSource.MANUAL, odometerOffset: 0 });
    }
    setError(null);
  }, [mode, reset]);

  const save = useMutation({
    mutationFn: (input: CreateVehicleInput) =>
      editing
        ? api.patch<Vehicle>(`/vehicles/${editing.id}`, input)
        : api.post<Vehicle>('/vehicles', input),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao salvar o carro'),
  });

  const deactivate = useMutation({
    mutationFn: () => api.patch<Vehicle>(`/vehicles/${editing?.id}`, { isActive: !editing?.isActive }),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao alterar o carro'),
  });

  if (mode.kind === 'closed') return null;

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={editing ? 'Editar carro' : 'Novo carro'}
      title={editing ? `${editing.code} · ${editing.plate}` : 'Cadastrar carro'}
      description="Classe e lote vêm da Escala de Carros; tecnologia, fonte de km e offset são do RF-35."
      footer={
        <>
          {editing && (
            <button
              type="button"
              className="tp-btn tp-btn--ghost"
              style={{ marginRight: 'auto' }}
              disabled={deactivate.isPending}
              onClick={() => deactivate.mutate()}
            >
              {editing.isActive ? 'Desativar' : 'Reativar'}
            </button>
          )}
          <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            form="vehicle-form"
            className="tp-btn tp-btn--primary"
            disabled={isSubmitting || save.isPending}
          >
            {save.isPending ? 'Salvando…' : editing ? 'Salvar alterações' : 'Cadastrar'}
          </button>
        </>
      }
    >
      <form id="vehicle-form" className="tp-stack" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
        <div className="tp-facts" style={{ display: 'grid' }}>
          <div className="tp-field">
            <label className="tp-label" htmlFor="vf-code">Prefixo</label>
            <input id="vf-code" className="tp-input" aria-invalid={errors.code ? 'true' : undefined} {...register('code')} />
            {errors.code && <span className="tp-error">{errors.code.message}</span>}
          </div>
          <div className="tp-field">
            <label className="tp-label" htmlFor="vf-plate">Placa</label>
            <input id="vf-plate" className="tp-input" placeholder="ABC1D23" aria-invalid={errors.plate ? 'true' : undefined} {...register('plate')} />
            {errors.plate && <span className="tp-error">{errors.plate.message}</span>}
          </div>
          <div className="tp-field">
            <label className="tp-label" htmlFor="vf-class">Classe</label>
            <select id="vf-class" className="tp-select" {...register('vehicleClass')}>
              <option value="">—</option>
              {Object.entries(VEHICLE_CLASS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="tp-field">
            <label className="tp-label" htmlFor="vf-role">Papel na escala</label>
            <select id="vf-role" className="tp-select" {...register('fleetRole')}>
              <option value="">—</option>
              {Object.entries(FLEET_ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="tp-field">
            <label className="tp-label" htmlFor="vf-lot">Lote</label>
            <input id="vf-lot" className="tp-input" placeholder="E8" maxLength={8} {...register('lot')} />
          </div>
          <div className="tp-field">
            <label className="tp-label" htmlFor="vf-tech">Tecnologia</label>
            <select id="vf-tech" className="tp-select" {...register('technology')}>
              {Object.entries(VEHICLE_TECHNOLOGY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="tp-field">
            <label className="tp-label" htmlFor="vf-src">Fonte de km</label>
            <select id="vf-src" className="tp-select" {...register('kmSource')}>
              {Object.entries(KM_SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="tp-field is-full">
            <label className="tp-label" htmlFor="vf-offset">Offset de hodômetro (km)</label>
            <input id="vf-offset" className="tp-input tp-input--num" type="number" {...register('odometerOffset')} />
            <span className="tp-help">
              Diferença entre o hodômetro físico e a quilometragem real acumulada. Use ao trocar o
              hodômetro, para não quebrar a série histórica. Toda mudança fica na auditoria.
            </span>
          </div>
          <div className="tp-field">
            <label className="tp-label" htmlFor="vf-mfr">Fabricante</label>
            <input id="vf-mfr" className="tp-input" {...register('manufacturer')} />
          </div>
          <div className="tp-field">
            <label className="tp-label" htmlFor="vf-model">Modelo</label>
            <input id="vf-model" className="tp-input" {...register('model')} />
          </div>
          <div className="tp-field">
            <label className="tp-label" htmlFor="vf-year">Ano</label>
            <input id="vf-year" className="tp-input tp-input--num" type="number" {...register('modelYear')} />
            {errors.modelYear && <span className="tp-error">{errors.modelYear.message}</span>}
          </div>
        </div>
        {error && <div className="tp-alert tp-alert--danger">{error}</div>}
      </form>
    </Drawer>
  );
}
