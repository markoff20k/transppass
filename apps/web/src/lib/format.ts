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

/** Data de hoje no fuso local, no formato do <input type="date"> (AAAA-MM-DD). */
export function todayLocalIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString('pt-BR');
}

/** "há 2 minutos", "há cerca de 1 hora", "ontem", "há 3 dias" — para trilhas e históricos. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diff = Math.max(0, now.getTime() - new Date(iso).getTime());
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} ${min === 1 ? 'minuto' : 'minutos'}`;
  const h = Math.round(min / 60);
  if (h < 24) return h === 1 ? 'há cerca de 1 hora' : `há ${h} horas`;
  const d = Math.round(h / 24);
  if (d === 1) return 'ontem';
  if (d < 30) return `há ${d} dias`;
  const m = Math.round(d / 30);
  if (m < 12) return `há ${m} ${m === 1 ? 'mês' : 'meses'}`;
  const y = Math.round(m / 12);
  return `há ${y} ${y === 1 ? 'ano' : 'anos'}`;
}

/** "janeiro de 2026" — para "membro desde". */
export function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ, month: 'long', year: 'numeric' });
}
