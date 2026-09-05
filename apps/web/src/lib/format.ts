/** Formatacao no padrao brasileiro, exigida na secao 8 do PRD. */

const TZ = 'America/Sao_Paulo';

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ });
}

/** Minutos em "3h20" — a leitura que o chao de fabrica usa. */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
}

/** Segundos em "12min" ou "2h05", para SLA e tempo de espera. */
export function formatDuration(seconds: number): string {
  return formatMinutes(Math.round(seconds / 60));
}

export function formatNumber(value: number): string {
  return value.toLocaleString('pt-BR');
}
