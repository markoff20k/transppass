/**
 * Calendário de dias atípicos da operação em São Paulo: feriados nacionais,
 * estaduais e municipais, pontos facultativos de uso corrente e as datas de
 * eleição. Serve ao quadro diário para explicar por que um dia fugiu do
 * padrão ("12/10, feriado de N. Sra. Aparecida: tabela de feriado").
 *
 * Datas móveis vêm da Páscoa (algoritmo de Meeus/Jones/Butcher).
 */

function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function plusDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const FIXED: Record<string, string> = {
  '01-01': 'Confraternização Universal',
  '01-25': 'Aniversário de São Paulo',
  '04-21': 'Tiradentes',
  '05-01': 'Dia do Trabalho',
  '07-09': 'Revolução Constitucionalista',
  '09-07': 'Independência',
  '10-12': 'Nossa Senhora Aparecida',
  '11-02': 'Finados',
  '11-15': 'Proclamação da República',
  '11-20': 'Consciência Negra',
  '12-24': 'Véspera de Natal (ponto facultativo)',
  '12-25': 'Natal',
  '12-31': 'Véspera de Ano-Novo (ponto facultativo)',
};

/** Datas em que a operação segue tabela especial sem ser feriado. */
const SPECIAL: Record<string, string> = {
  '2026-10-04': 'Eleições (1º turno)',
  '2026-10-25': 'Eleições (2º turno)',
};

const cache = new Map<number, Map<string, string>>();

function yearTable(year: number): Map<string, string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const table = new Map<string, string>();
  for (const [md, name] of Object.entries(FIXED)) table.set(`${year}-${md}`, name);
  const e = easter(year);
  table.set(iso(plusDays(e, -48)), 'Carnaval');
  table.set(iso(plusDays(e, -47)), 'Carnaval');
  table.set(iso(plusDays(e, -46)), 'Quarta-feira de Cinzas (ponto facultativo)');
  table.set(iso(plusDays(e, -2)), 'Sexta-feira Santa');
  table.set(iso(plusDays(e, 60)), 'Corpus Christi');
  for (const [d, name] of Object.entries(SPECIAL)) if (d.startsWith(String(year))) table.set(d, name);
  cache.set(year, table);
  return table;
}

/** Nome do feriado ou data especial, ou null num dia comum. */
export function holidayName(isoDate: string): string | null {
  return yearTable(Number(isoDate.slice(0, 4))).get(isoDate) ?? null;
}
