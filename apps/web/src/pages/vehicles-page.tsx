import { usePageHeader } from '@/components/shell/page-header.context';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createVehicleSchema,
  KM_SOURCE_LABELS,
  KmSource,
  VEHICLE_STATUS_LABELS,
  VEHICLE_TECHNOLOGY_LABELS,
  VehicleTechnology,
  type CreateVehicleInput,
  type Paginated,
  type Vehicle,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';

/** RF-35 — cadastro da frota com tecnologia, fonte de km e offset de hodômetro. */
export function VehiclesPage() {
  usePageHeader({ eyebrow: 'Cadastros', title: 'Frota', description: 'Tecnologia, fonte de km e offset de hodômetro por carro.' });

  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['vehicles', 'all'],
    queryFn: () => api.get<Paginated<Vehicle>>('/vehicles?perPage=100&onlyActive=false'),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateVehicleInput>({
    resolver: zodResolver(createVehicleSchema),
    defaultValues: {
      technology: VehicleTechnology.DIESEL,
      kmSource: KmSource.MANUAL,
      odometerOffset: 0,
    },
  });

  const create = useMutation({
    mutationFn: (input: CreateVehicleInput) => api.post<Vehicle>('/vehicles', input),
    onSuccess: () => {
      reset();
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      void queryClient.invalidateQueries({ queryKey: ['fleet-panel'] });
    },
    onError: (err) =>
      setFormError(err instanceof ApiError ? err.message : 'Falha ao cadastrar o carro'),
  });

  return (
    <div className="tp-split">
      <section className="tp-card">
        <h2>Frota</h2>
        {isPending ? (
          <p className="tp-muted">Carregando…</p>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Prefixo</th>
                  <th>Placa</th>
                  <th>Tecnologia</th>
                  <th>Fonte de km</th>
                  <th className="is-num">Offset</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {(data?.data ?? []).map((v) => (
                  <tr key={v.id} className={v.isActive ? undefined : 'is-inactive'}>
                    <td className="is-strong">{v.code}</td>
                    <td>{v.plate}</td>
                    <td>{VEHICLE_TECHNOLOGY_LABELS[v.technology]}</td>
                    <td>{KM_SOURCE_LABELS[v.kmSource]}</td>
                    <td className="is-num">{v.odometerOffset.toLocaleString('pt-BR')}</td>
                    <td>{VEHICLE_STATUS_LABELS[v.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="tp-card">
        <h2>Novo carro</h2>
        <form
          className="tp-stack"
          onSubmit={handleSubmit((values) => create.mutate(values))}
          noValidate
        >
          <label>
            Prefixo
            <input className="tp-input" type="text" {...register('code')} />
            {errors.code && <span className="tp-error">{errors.code.message}</span>}
          </label>

          <label>
            Placa
            <input className="tp-input" type="text" placeholder="ABC1D23" {...register('plate')} />
            {errors.plate && <span className="tp-error">{errors.plate.message}</span>}
          </label>

          <label>
            Tecnologia
            <select className="tp-select" {...register('technology')}>
              {Object.entries(VEHICLE_TECHNOLOGY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Fonte de km
            <select className="tp-select" {...register('kmSource')}>
              {Object.entries(KM_SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Offset de hodômetro (km)
            <input className="tp-input" type="number" {...register('odometerOffset')} />
            <small className="tp-muted">
              Diferença entre o hodômetro físico e a quilometragem real acumulada. Use ao trocar
              o hodômetro, para não quebrar a série histórica.
            </small>
          </label>

          <label>
            Fabricante
            <input className="tp-input" type="text" {...register('manufacturer')} />
          </label>

          <label>
            Modelo
            <input className="tp-input" type="text" {...register('model')} />
          </label>

          {formError && <p className="tp-error">{formError}</p>}

          <button type="submit" className="tp-btn tp-btn--primary" disabled={isSubmitting || create.isPending}>
            {create.isPending ? 'Salvando…' : 'Cadastrar'}
          </button>
        </form>
      </section>
    </div>
  );
}
