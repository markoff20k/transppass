// QA: período do dashboard, atalhos, simulador, perfil (conta) — capturas e checagens de ponta a ponta.
// Uso: node tools/qa-conta.mjs [baseWeb] [baseApi]
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

// --- API direta ------------------------------------------------------------
const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'QA/1.0 (Windows NT 10.0) Chrome/130' }, body: JSON.stringify({ email: 'admin@transppass.local', password: 'admin123' }) }).then((r) => r.json());
const token = login.tokens?.accessToken;
record('API-01', 'Login devolve usuário com preferências', Boolean(token) && Array.isArray(login.user?.preferences?.shortcuts));
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const d90 = await fetch(`${API}/dashboard?days=90`, { headers: H }).then((r) => r.json());
record('API-02', 'Dashboard 90 dias traz MKBF do período de setembro', d90.period?.days === 90 && d90.mkbf?.period?.unscheduledReturns > 0, `${d90.mkbf?.period?.kmTraveled} km ÷ ${d90.mkbf?.period?.unscheduledReturns} = ${d90.mkbf?.period?.mkbf}`);
const d30 = await fetch(`${API}/dashboard?days=30`, { headers: H }).then((r) => r.json());
record('API-03', 'Dashboard 30 dias tem 30 pontos diários', d30.eventsPerDay?.length === 30 && d30.eventsBucket === 'day');
const d365 = await fetch(`${API}/dashboard?days=365`, { headers: H }).then((r) => r.json());
record('API-04', 'Dashboard 365 dias agrupa por semana', d365.eventsBucket === 'week' && d365.eventsPerDay?.length === 53, `${d365.eventsPerDay?.length} semanas`);
const bad = await fetch(`${API}/dashboard?days=45`, { headers: H });
record('API-05', 'Período fora da lista é recusado', bad.status === 422 || bad.status === 400, String(bad.status));

const prefs = await fetch(`${API}/users/me/preferences`, { method: 'PATCH', headers: H, body: JSON.stringify({ shortcuts: ['events', 'workOrders', 'stock'], toastPosition: 'top-right' }) }).then((r) => r.json());
record('API-06', 'Preferências salvas na conta', prefs.preferences?.shortcuts?.length === 3 && prefs.preferences?.toastPosition === 'top-right');
const tooMany = await fetch(`${API}/users/me/preferences`, { method: 'PATCH', headers: H, body: JSON.stringify({ shortcuts: ['a', 'b', 'c', 'd', 'e'] }) });
record('API-07', 'Mais de 4 atalhos é recusado', tooMany.status === 422 || tooMany.status === 400);
const summary = await fetch(`${API}/users/me/summary`, { headers: H }).then((r) => r.json());
record('API-08', 'Resumo da conta tem último login', typeof summary.lastLoginAt === 'string' && typeof summary.activeSessions === 'number');
const activity = await fetch(`${API}/users/me/activity?category=security`, { headers: H }).then((r) => r.json());
record('API-09', 'Atividade de segurança registra o login com IP e navegador', Array.isArray(activity) && activity[0]?.action === 'auth.login' && Boolean(activity[0]?.userAgent));

const demo = await fetch(`${API}/demo`, { headers: H }).then((r) => r.json());
record('API-10', 'Estado do simulador consultável', typeof demo.enabled === 'boolean' && ['env', 'setting'].includes(demo.source));
const on = await fetch(`${API}/demo`, { method: 'PATCH', headers: H, body: JSON.stringify({ enabled: true }) }).then((r) => r.json());
const off = await fetch(`${API}/demo`, { method: 'PATCH', headers: H, body: JSON.stringify({ enabled: false }) }).then((r) => r.json());
record('API-11', 'Simulador liga e desliga pelo sistema, com estado persistido', on.enabled === true && on.source === 'setting' && off.enabled === false);

// --- navegador ---------------------------------------------------------------
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('tp.theme', 'light'); localStorage.removeItem('tp.dash.days'); } catch {} });

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.type('#login-email', 'admin@transppass.local');
await page.type('#login-password', 'admin123');
await page.click('button[type="submit"]');
await page.waitForSelector('.dash-hero', { timeout: 30000 });
await wait(1200);
record('UI-01', 'Controle de período aparece no subheader', Boolean(await page.$('.tp-segmented')));
record('UI-02', 'Três atalhos salvos aparecem no cabeçalho', (await page.$$('.header__shortcut')).length === 3);
record('UI-03', 'Ícone de perfil é o boneco', Boolean(await page.$('.header__profile svg')));
await page.screenshot({ path: `${OUT}/conta-dash-30.png` });

// 90 dias: setembro aparece
await page.click('.tp-segmented__item:nth-child(3)');
await page.waitForFunction(() => location.search.includes('dias=90'), { timeout: 10000 });
await page.waitForFunction(() => /÷/.test(document.querySelector('.dash-hero__kpis')?.textContent ?? ''), { timeout: 30000 }).catch(() => {});
await wait(800);
const kpi = await page.$eval('.dash-hero__kpis', (el) => el.textContent);
record('UI-04', 'Com 90 dias o MKBF de setembro aparece no card', /÷/.test(kpi) && !/—/.test(kpi.split('MKBF')[1]?.slice(0, 40) ?? '—'), kpi.slice(0, 120));
await page.screenshot({ path: `${OUT}/conta-dash-90.png` });
await page.screenshot({ path: `${OUT}/conta-dash-90-full.png`, fullPage: true });
const stored = await page.evaluate(() => localStorage.getItem('tp.dash.days'));
record('UI-05', 'Período lembrado no navegador', stored === '90');

// diálogo de atalhos
await page.click('.header__shortcut-add');
await page.waitForSelector('.tp-modal', { timeout: 10000 });
await wait(400);
await page.screenshot({ path: `${OUT}/conta-atalhos.png` });
record('UI-06', 'Diálogo de atalhos mostra 3/4 e tiles disponíveis', (await page.$eval('.tp-modal', (el) => el.textContent)).includes('3/4') && (await page.$$('.shortcut-tile__pick')).length > 5);
await page.click('.shortcut-tile__pick');
await wait(200);
const btnDisabled = await page.$$eval('.shortcut-tile__pick', (els) => els.every((e) => e.disabled));
record('UI-07', 'Com 4 atalhos os demais ficam bloqueados', btnDisabled);
await page.click('.tp-modal__foot .tp-btn--primary');
await page.waitForFunction(() => !document.querySelector('.tp-modal'), { timeout: 15000 });
await wait(600);
record('UI-08', 'Salvar fecha o diálogo e o cabeçalho mostra 4 atalhos', (await page.$$('.header__shortcut')).length === 4);

// simulador (fecha o toast de 'atalhos salvos' antes, para não cobrir o cabeçalho)
await page.keyboard.press('Escape');
await wait(500);
await page.click('.header__sim');
await page.waitForSelector('.sim-menu', { timeout: 10000 });
await wait(300);
await page.screenshot({ path: `${OUT}/conta-simulador.png` });
record('UI-09', 'Menu do simulador tem interruptor e botão de avançar', Boolean(await page.$('.sim-menu .tp-switch')) && Boolean(await page.$('.sim-menu__advance')));
await page.click('.sim-menu .tp-switch');
await page.waitForFunction(() => document.querySelector('.header__sim')?.classList.contains('is-on'), { timeout: 15000 });
await wait(500);
await page.screenshot({ path: `${OUT}/conta-simulador-on.png` });
record('UI-10', 'Interruptor liga o simulador e a pílula acende', true);
await page.click('.sim-menu .tp-switch');
await page.waitForFunction(() => !document.querySelector('.header__sim')?.classList.contains('is-on'), { timeout: 15000 });
await page.keyboard.press('Escape');

// perfil
await page.goto(`${BASE}/perfil`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForSelector('.activity', { timeout: 20000 }).catch(() => {});
await wait(800);
await page.screenshot({ path: `${OUT}/conta-perfil.png` });
await page.screenshot({ path: `${OUT}/conta-perfil-full.png`, fullPage: true });
const cards = await page.$$eval('.account__card', (els) => els.length);
record('UI-11', 'Página da conta tem 5 cartões (perfil, resumo, preferências, senha, atividades)', cards === 5, String(cards));
record('UI-12', 'Atividades listam login com IP', (await page.$eval('.activity__list', (el) => el.textContent)).includes('IP '));
await page.click('.pos-pick--bottom-left');
await page.waitForFunction(() => document.querySelector('.pos-pick--bottom-left')?.classList.contains('is-active'), { timeout: 15000 });
await wait(300);
record('UI-13', 'Posição dos avisos salva e o toast aparece embaixo à esquerda', Boolean(await page.$('.tp-toaster--bottom-left')));
await page.screenshot({ path: `${OUT}/conta-perfil-toast.png` });

// restaura preferências de QA
await fetch(`${API}/users/me/preferences`, { method: 'PATCH', headers: H, body: JSON.stringify({ shortcuts: [], toastPosition: 'bottom-right', notifications: true }) });

// celular
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.goto(`${BASE}/perfil`, { waitUntil: 'networkidle0', timeout: 60000 });
await wait(600);
await page.screenshot({ path: `${OUT}/conta-perfil-390.png`, fullPage: true });
await page.goto(`${BASE}/?dias=90`, { waitUntil: 'networkidle0', timeout: 60000 });
await wait(800);
await page.screenshot({ path: `${OUT}/conta-dash-390.png` });
const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
record('UI-14', 'Sem rolagem horizontal no celular', noHScroll);

console.log('erros de página:', errors.length ? errors : 'nenhum');
await browser.close();
process.exit(results.some((r) => !r.ok) ? 1 : 0);
