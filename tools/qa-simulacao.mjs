// QA: ligar a simulação monta a garagem de demonstração; desligar devolve o banco ao estado só-real.
// Uso: node tools/qa-simulacao.mjs [baseWeb] [baseApi]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'C:/Users/jefer/AppData/Local/Temp/claude/c--Users-jefer-transppass-pcm/447116dd-98b7-4131-b571-e2bd32975d88/scratchpad/shots';
const BASE = process.argv[2] ?? 'http://localhost:5174';
const API = process.argv[3] ?? 'http://localhost:3100/api';
mkdirSync(OUT, { recursive: true });

const results = [];
const record = (id, label, ok, extra = '') => { results.push({ id, label, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${label}${extra ? ` — ${extra}` : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@transppass.local', password: 'admin123' }) }).then((r) => r.json());
const H = { Authorization: `Bearer ${login.tokens.accessToken}`, 'Content-Type': 'application/json' };
const get = (p) => fetch(`${API}${p}`, { headers: H }).then((r) => r.json());
const dash = async () => { const d = await get('/dashboard?days=30'); return { avail: d.fleet.available, total: d.fleet.total, open: d.workOrders.open, queue: d.queue.waiting, mkbf: d.mkbf.period.mkbf, byStatus: d.fleet.byStatus }; };

// estado só-real antes
let st = await get('/demo');
if (st.enabled) { await fetch(`${API}/demo`, { method: 'PATCH', headers: H, body: JSON.stringify({ enabled: false }) }); }
while ((await get('/demo')).phase) await wait(2000);
const before = await dash();
record('SIM-00', 'Ponto de partida só com dados reais (0 OS abertas)', before.open === 0, JSON.stringify(before));

// liga: monta a garagem em segundo plano
const t0 = Date.now();
const on = await fetch(`${API}/demo`, { method: 'PATCH', headers: H, body: JSON.stringify({ enabled: true }) }).then((r) => r.json());
record('SIM-01', 'Ligar responde na hora com fase "building"', on.enabled === true && on.phase === 'building');
const again = await fetch(`${API}/demo`, { method: 'PATCH', headers: H, body: JSON.stringify({ enabled: false }) });
record('SIM-02', 'Desligar durante a montagem é recusado (409)', again.status === 409, String(again.status));
while ((st = await get('/demo')).phase === 'building') await wait(3000);
record('SIM-03', 'Montagem termina sem erro', st.phase === null && !st.phaseError, `${Math.round((Date.now() - t0) / 1000)} s${st.phaseError ? ` · ${st.phaseError}` : ''}`);
const during = await dash();
record('SIM-04', 'Com a simulação a garagem tem OS abertas, fila e carros parados', during.open > 5 && during.queue > 0 && during.avail < during.total, JSON.stringify(during));
record('SIM-05', 'MKBF de 30 dias passa a existir (outubro simulado)', typeof during.mkbf === 'number' && during.mkbf > 0, String(during.mkbf));

// navegador: dashboard com movimento e pílula acesa
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('tp.theme', 'light'); localStorage.setItem('tp.dash.days', '30'); } catch {} });
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.type('#login-email', 'admin@transppass.local');
await page.type('#login-password', 'admin123');
await page.click('button[type="submit"]');
await page.waitForSelector('.dash-hero', { timeout: 30000 });
await wait(2000);
await page.screenshot({ path: `${OUT}/sim-on-dash.png` });
record('SIM-06', 'Pílula "Simulação ligada" acesa no cabeçalho', await page.$eval('.header__sim', (el) => el.classList.contains('is-on') && el.textContent.includes('ligada')));
const flow = await page.$eval('.dash-flow', (el) => el.textContent);
record('SIM-07', 'Fluxo da garagem mostra carros nas etapas', /[1-9]/.test(flow), flow.replace(/\s+/g, ' ').slice(0, 80));

// desliga pela própria tela: abre o menu e vira o interruptor
await page.click('.header__sim');
await page.waitForSelector('.sim-menu .tp-switch', { timeout: 10000 });
await page.click('.sim-menu .tp-switch');
await page.waitForFunction(() => /Limpando|Simulação$/.test(document.querySelector('.header__sim')?.textContent ?? ''), { timeout: 15000 }).catch(() => {});
await page.screenshot({ path: `${OUT}/sim-clearing.png` });
record('SIM-08', 'Desligar pela tela responde com a fase de limpeza', (await get('/demo')).enabled === false);
record('SIM-09', 'Cabeçalho reage ao desligar (limpando ou apagado)', await page.$eval('.header__sim', (el) => /Limpando/.test(el.textContent) || !el.classList.contains('is-on')));
while ((st = await get('/demo')).phase) await wait(2000);
const after = await dash();
const counts = await Promise.all(['/events?page=1&perPage=1', '/work-orders?page=1&perPage=1'].map((p) => get(p).then((r) => r.meta?.total ?? r.total ?? null)));
record('SIM-10', 'Depois de desligar, garagem volta ao estado só-real', after.open === 0 && after.queue === 0 && after.avail === after.total, JSON.stringify(after));
record('SIM-11', 'Eventos e OS voltam ao volume real (3.663 e 0)', counts[0] === 3663 && counts[1] === 0, JSON.stringify(counts));
await page.waitForFunction(() => !document.querySelector('.header__sim')?.classList.contains('is-on') && !/Limpando/.test(document.querySelector('.header__sim')?.textContent ?? ''), { timeout: 20000 }).catch(() => {});
await wait(1500);
await page.screenshot({ path: `${OUT}/sim-off-dash.png` });
record('SIM-12', 'Pílula volta a "Simulação" apagada e a tela recarrega só-real', await page.$eval('.header__sim', (el) => !el.classList.contains('is-on')) && /460/.test(await page.$eval('.dash-gauge__foot', (el) => el.textContent)));

await browser.close();
process.exit(results.some((r) => !r.ok) ? 1 : 0);
