import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AvailabilityCars } from '@app/shared';
import { api } from '@/lib/api-client';
import { shiftDays } from '@/lib/period';
import { BrandLoader } from '@/components/brand/brand-loader';
import { formatHours } from './downtime-cars';

type Car = AvailabilityCars['cars'][number];

const carsQuery = (day: string) => ({
  queryKey: ['dashboard', 'availability-cars', day],
  queryFn: () => api.get<AvailabilityCars>(`/dashboard/availability-cars?day=${day}`),
  staleTime: 60_000,
});

/** Medidas da lista no tooltip (CSS em .ave): servem para decidir quantas colunas cabem na tela. */
const ROW_H = 18;
const COL_W = 262;
const HEAD_H = 196;
const ROWS_PER_COL = 20;

/** O mouse corre pelo gráfico: só busca o dia em que ele parou. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/**
 * Os eventos do dia dentro do tooltip do gráfico de disponibilidade: cada
 * carro que derrubou o número (retido na saída ou parado com o dia em
 * andamento) e por quantas horas. Reserva e imobilizado não entram: não mexem
 * na conta. Com `hour`, só os carros indisponíveis naquela faixa do dia.
 * A lista inteira aparece, em colunas; só corta se não couber na tela.
 */
export function AvailabilityEvents({ day, hour }: { day: string; hour?: number }) {
  const qc = useQueryClient();
  const settled = useSettled(day, 120);
  const query = useQuery({ ...carsQuery(day), enabled: settled === day });
  // Os dias vizinhos já ficam prontos: passar o mouse para o lado não espera.
  useEffect(() => {
    for (const n of [-1, 1]) void qc.prefetchQuery(carsQuery(shiftDays(settled, n)));
  }, [settled, qc]);

  const d = query.data;
  if (!d) {
    return (
      <div className="ave ave--loading">
        <BrandLoader size={22} label="Carregando os eventos" />
      </div>
    );
  }
  if (d.day !== day) {
    return (
      <div className="ave">
        <span className="tp-muted">Sem dado de operação neste dia.</span>
      </div>
    );
  }

  const slot = hour === undefined ? null : (hour < 4 ? hour + 24 : hour) * 60;
  const inSlot = (c: Car) => slot === null || c.intervals.some(([a, b]) => a < slot + 60 && b > slot);
  const events = d.cars
    .filter((c) => (c.state === 'RETAINED' || c.state === 'PARTIAL') && c.minutes > 0 && inSlot(c))
    .sort((a, b) => b.minutes - a.minutes || a.code.localeCompare(b.code, 'pt-BR', { numeric: true }));
  const n = events.length;
  if (n === 0) {
    return (
      <div className="ave">
        <span className="tp-muted">{slot === null ? 'Nenhum veículo indisponível neste dia.' : 'Nenhum veículo indisponível nesta faixa.'}</span>
      </div>
    );
  }
  const retained = events.filter((c) => c.state === 'RETAINED').length;
  const partial = n - retained;
  const minutes = events.reduce((a, c) => a + c.minutes, 0);

  // Colunas: perto de 20 linhas cada; mais colunas se a tela for baixa, nunca mais do que cabe na largura.
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const maxRows = Math.max(4, Math.floor((vh - HEAD_H) / ROW_H));
  const maxCols = Math.max(1, Math.floor((vw - 48) / COL_W));
  const cols = Math.min(maxCols, Math.max(Math.ceil(n / ROWS_PER_COL), Math.ceil(n / maxRows)));
  const fits = n <= cols * maxRows;
  const shown = fits ? events : events.slice(0, cols * maxRows - 1);
  const rows = Math.ceil((shown.length + (fits ? 0 : 1)) / cols);

  return (
    <div className="ave">
      <div className="ave__head">
        <b>
          {n} {n === 1 ? 'veículo indisponível' : 'veículos indisponíveis'}
          {slot !== null && ' nesta faixa'}
        </b>
        <span className="tp-muted">{slot === null ? `${formatHours(minutes)} no dia` : 'horas de cada um no dia'}</span>
      </div>
      <div className="ave__legend">
        {retained > 0 && (
          <span>
            <i className="ave__dot ave__dot--retained" aria-hidden />
            {retained} {retained === 1 ? 'retido na saída' : 'retidos na saída'}
          </span>
        )}
        {partial > 0 && (
          <span>
            <i className="ave__dot ave__dot--partial" aria-hidden />
            {partial} {partial === 1 ? 'parou no dia' : 'pararam no dia'}
          </span>
        )}
      </div>
      <ul className="ave__list" style={{ gridTemplateRows: `repeat(${rows}, ${ROW_H}px)` }}>
        {shown.map((c) => (
          <li key={c.vehicleId}>
            <i className={`ave__dot ave__dot--${c.state === 'RETAINED' ? 'retained' : 'partial'}`} aria-hidden />
            Veículo <b>{c.code}</b> ficou indisponível por <b>{formatHours(c.minutes)}</b>
          </li>
        ))}
        {!fits && <li className="tp-muted">+ {n - shown.length} veículos · clique para ver todos</li>}
      </ul>
      <span className="chart-tip__hint">Clique no gráfico para abrir os carros do dia.</span>
    </div>
  );
}
