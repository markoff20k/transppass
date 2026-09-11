// QA funcional do front em modo mock, com o Edge da máquina.
//
// Percorre todas as rotas, abre cada painel lateral, executa os fluxos
// principais e registra: erros de console, requisições falhas, elementos
// esperados ausentes. Gera QA-RESULTADO.json e capturas em tools/qa-shots/.
//
// Uso:  npm run dev:mock  (em outro terminal)  →  node tools/qa-smoke.mjs
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.QA_BASE_URL ?? 'http://localhost:5173';
const OUT = 'tools/qa-shots';
mkdirSync(OUT, { recursive: true });

const results = [];
const consoleErrors = [];
let shotIndex = 0;

function record(id, name, ok, detail = '') {
  results.push({ id, name, ok, detail });
  console.log(`  ${ok ? '\x1b[32mok\x1b[0m    ' : '\x1b[31mFALHOU\x1b[0m'} ${id} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  shotIndex += 1;
  const file = `${OUT}/${String(shotIndex).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file });
  return file;
}

async function exists(page, selector) {
  return (await page.$(selector)) !== null;
}

async function textOf(page, selector) {
  return page.$eval(selector, (el) => el.textContent?.trim() ?? '').catch(() => '');
}

async function clickText(page, selector, text) {
  const handles = await page.$$(selector);
  for (const h of handles) {
    const t = await h.evaluate((el) => el.textContent?.trim() ?? '');
    if (t.includes(text)) {
      await h.click();
      return true;
    }
  }
  return false;
}

async function drawerOpen(page) {
  await sleep(350);
  return exists(page, '.tp-drawer[role="dialog"]');
}

async function closeDrawer(page) {
  await page.keyboard.press('Escape');
  await sleep(350);
  return !(await exists(page, '.tp-drawer'));
}

async function run() {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('pageerror', (e) => consoleErrors.push({ type: 'pageerror', text: e.message, at: page.url() }));
  page.on('response', (r) => {
    const url = r.url();
    // 401 no login com senha errada é o comportamento testado em AUTH-02.
    if (r.status() >= 400 && !url.includes('/auth/login')) consoleErrors.push({ type: 'http', text: `${r.status()} ${url}` });
  });
  page.on('console', (m) => {
    // "Failed to update a ServiceWorker" é o navegador rechecando o worker do
    // MSW enquanto o Vite recarrega — corrida do ambiente, não erro da tela.
    if (m.type() === 'error' && !m.text().includes('Failed to load resource') && !m.text().includes('Failed to update a ServiceWorker')) consoleErrors.push({ type: 'console', text: m.text().slice(0, 200), at: page.url() });
  });

  console.log('\n=== QA funcional — Transppass PCM (modo mock) ===\n');

  // ---- Autenticação -------------------------------------------------------
  console.log('Autenticação');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
  record('AUTH-01', 'Tela de login renderiza com logo e formulário', await exists(page, '#login-email') && await exists(page, '.tp-logo'));

  await page.type('#login-email', 'admin@transppass.local');
  await page.type('#login-password', 'senha-errada');
  await page.click('button[type="submit"]');
  await sleep(800);
  record('AUTH-02', 'Senha errada mostra erro e não entra', await exists(page, '.tp-alert--danger') && page.url().includes('/login'));

  await page.$eval('#login-password', (el) => (el.value = ''));
  await page.type('#login-password', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname === '/', { timeout: 20000 }).catch(() => {});
  await page.waitForSelector('.dash-hero', { timeout: 20000 }).catch(() => {});
  record('AUTH-03', 'Login válido leva ao dashboard', page.url().endsWith('/') && await exists(page, '.dash-hero'));
  await shot(page, 'dashboard');

  // ---- Shell ----------------------------------------------------------------
  console.log('\nShell');
  record('SHELL-01', 'Sidebar, header e subheader presentes', await exists(page, '.sidebar') && await exists(page, '.header') && await exists(page, '.subheader'));
  const w1 = await page.$eval('.sidebar', (el) => el.getBoundingClientRect().width);
  await page.click('.sidebar__collapse');
  await sleep(450);
  const w2 = await page.$eval('.sidebar', (el) => el.getBoundingClientRect().width);
  await page.click('.sidebar__collapse');
  await sleep(450);
  const w3 = await page.$eval('.sidebar', (el) => el.getBoundingClientRect().width);
  record('SHELL-02', 'Sidebar recolhe (264→72) e expande de volta', w1 === 264 && w2 === 72 && w3 === 264, `${w1}→${w2}→${w3}`);

  // Tema: interruptor de um toque (claro ↔ escuro)
  await page.click('button[aria-label="Tema"]');
  await sleep(300);
  const themeAttr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  record('SHELL-03', 'Interruptor de tema marca data-theme=dark', themeAttr === 'dark');
  await shot(page, 'dashboard-dark');
  await page.click('button[aria-label="Tema"]');
  await sleep(300);
  record('SHELL-03b', 'Segundo toque volta ao claro', (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'light');

  // Idioma: bandeira circular (pt-BR ↔ en), sem menu
  await page.click('button[aria-label="Idioma"]');
  await sleep(300);
  record('SHELL-04', 'Bandeira troca o idioma e traduz o shell', (await textOf(page, '.subheader__title')) === 'Dashboard' && (await page.evaluate(() => document.documentElement.lang)) === 'en' && (await exists(page, 'button[aria-label="Language"] .flag')));
  await page.click('button[aria-label="Language"]');
  await sleep(300);
  record('SHELL-04b', 'Segundo toque volta ao português', (await page.evaluate(() => document.documentElement.lang)) === 'pt-BR');

  await page.click('button[aria-label="Notificações"]');
  await sleep(300);
  record('SHELL-05', 'Painel de notificações abre com itens', await exists(page, '.notif .notif__item'));
  await page.keyboard.press('Escape');
  await sleep(200);

  // ---- Dashboard -----------------------------------------------------------
  console.log('\nDashboard');
  record('DASH-01', 'Anel de disponibilidade + três KPIs', (await page.$$('.dash-kpi')).length === 3 && (await exists(page, '.ring__value')));
  record('DASH-05', 'Fluxo da garagem com seis etapas clicáveis', (await page.$$('.dash-flow__node')).length === 6);
  record('DASH-02', 'Grade de ônibus com ilustrações', (await page.$$('.bus-grid .bus')).length >= 5);
  record('DASH-03', 'Gráficos Recharts renderizados', (await page.$$('.recharts-surface')).length >= 3);
  record('DASH-04', 'Bloco de atenção com links', (await page.$$('.attention-item a')).length >= 1);

  // ---- Rotas e painéis ------------------------------------------------------
  console.log('\nTelas e painéis laterais');
  const routes = [
    { path: '/frota', name: 'Painel da frota', check: '.bus-grid, .tp-table' },
    { path: '/eventos', name: 'Eventos', check: '.tp-table' },
    { path: '/triagem', name: 'Triagem', check: '.tp-table' },
    { path: '/fila', name: 'Fila', check: '.tp-table' },
    { path: '/socorro', name: 'Socorro', check: '.field-list, .tp-card' },
    { path: '/preventiva', name: 'Preventiva', check: '.tp-table' },
    { path: '/plantao', name: 'Plantão', check: '.tp-table' },
    { path: '/os', name: 'Ordens de serviço', check: '.tp-table' },
    { path: '/estoque', name: 'Estoque', check: '.tp-table' },
    { path: '/indicadores', name: 'Indicadores', check: '.tp-kpi' },
    { path: '/km', name: 'Quilometragem', check: 'table' },
    { path: '/cadastros/frota', name: 'Cadastro da frota', check: '.tp-table' },
    { path: '/cadastros/catalogo', name: 'Catálogo', check: '.tp-table' },
    { path: '/design', name: 'Design kit', check: '.bus-gallery' },
  ];
  let i = 0;
  for (const r of routes) {
    i += 1;
    await page.goto(`${BASE}${r.path}`, { waitUntil: 'networkidle0', timeout: 60000 });
    await sleep(400);
    const ok = await exists(page, r.check);
    const title = await textOf(page, '.subheader__title');
    record(`ROUTE-${String(i).padStart(2, '0')}`, `${r.name} renderiza com subheader "${title}"`, ok && title.length > 0);
    await shot(page, r.path.replace(/\//g, '_').slice(1) || 'root');
  }

  // Fila: abrir painel, ver histórico, tentar mover sem motivo
  await page.goto(`${BASE}/fila`, { waitUntil: 'networkidle0' });
  await sleep(400);
  // A primeira linha pode estar em execução (sem "Mover"); escolhe uma aguardando.
  await page.$$eval('.tp-table tbody tr.is-clickable', (rows) => {
    const row = rows.find((r) => /Aguardando/i.test(r.textContent || '')) ?? rows[0];
    row?.click();
  });
  record('QUEUE-01', 'Clicar na fila abre o painel lateral', await drawerOpen(page));
  record('QUEUE-02', 'Painel mostra histórico imutável', await exists(page, '.tp-timeline li'));
  await clickText(page, '.tp-drawer__foot button', 'Mover na fila');
  await sleep(300);
  const moveDisabled = await page.$eval('.tp-drawer__foot .tp-btn--primary', (b) => b.disabled).catch(() => null);
  record('QUEUE-03', 'Mover sem motivo fica bloqueado (RF-08)', moveDisabled === true);
  await shot(page, 'fila-mover');
  record('QUEUE-04', 'Esc fecha o painel', await closeDrawer(page));

  // Triagem: deferir bloqueado para falha de segurança
  await page.goto(`${BASE}/triagem`, { waitUntil: 'networkidle0' });
  await sleep(400);
  const triageRows = await page.$$('.tp-table tbody tr.is-clickable');
  if (triageRows.length) {
    await triageRows[0].click();
    record('TRI-01', 'Painel de triagem abre com os três destinos', (await drawerOpen(page)) && (await page.$$('.tp-radio-card')).length === 3);
    await shot(page, 'triagem-painel');
    await closeDrawer(page);
  } else {
    record('TRI-01', 'Fila de triagem sem eventos no mock (nada a abrir)', true);
  }

  // Estoque: painel de solicitação
  await page.goto(`${BASE}/estoque`, { waitUntil: 'networkidle0' });
  await sleep(400);
  await page.click('.tp-table tbody tr.is-clickable');
  record('STK-01', 'Painel da solicitação abre com fatos e ações', (await drawerOpen(page)) && await exists(page, '.tp-facts'));
  const badges = await page.$$eval('.tp-badge--status', (els) => els.map((e) => e.getBoundingClientRect().width));
  const minW = Math.min(...badges), maxW = Math.max(...badges);
  record('STK-02', 'Badges de status com largura uniforme', badges.length > 1 && maxW - minW < 2, `${minW.toFixed(0)}–${maxW.toFixed(0)}px`);
  await shot(page, 'estoque-painel');
  await closeDrawer(page);

  // Preventiva: programar parada
  await page.goto(`${BASE}/preventiva`, { waitUntil: 'networkidle0' });
  await sleep(400);
  await clickText(page, '.subheader__actions button', 'Programar');
  record('PREV-01', 'Painel de programar parada abre', await drawerOpen(page));
  await shot(page, 'preventiva-programar');
  await closeDrawer(page);
  const schedRows = await page.$$('.tp-split .tp-table tbody tr.is-clickable');
  if (schedRows.length) {
    await schedRows[0].click();
    record('PREV-02', 'Painel da parada mostra travas (kit + equipe) e escopo', (await drawerOpen(page)) && (await page.$$('.tp-gates .tp-gate')).length === 3);
    await shot(page, 'preventiva-parada');
    await closeDrawer(page);
  }

  // Plantão: demanda com contagem
  await page.goto(`${BASE}/plantao`, { waitUntil: 'networkidle0' });
  await sleep(400);
  record('PLT-01', 'Janela em contagem visível', await exists(page, '.countdown'));
  await page.click('.tp-table tbody tr.is-clickable');
  record('PLT-02', 'Painel da demanda abre', await drawerOpen(page));
  await shot(page, 'plantao-demanda');
  await closeDrawer(page);

  // OS: painéis de sub-OS
  await page.goto(`${BASE}/os`, { waitUntil: 'networkidle0' });
  await sleep(400);
  await page.click('.tp-table tbody tr a');
  await page.waitForSelector('.tp-gates', { timeout: 20000 }).catch(() => {});
  record('OS-01', 'Detalhe da OS com portões e relógio', await exists(page, '.tp-gates') && await exists(page, '.tp-kpi'));
  await shot(page, 'os-detalhe');
  const addTask = await clickText(page, '.tp-card__head button', 'Sub-OS');
  if (addTask) {
    record('OS-02', 'Painel de nova sub-OS abre', await drawerOpen(page));
    await closeDrawer(page);
  }

  // Frota: novo carro pelo painel, com validação de placa
  await page.goto(`${BASE}/cadastros/frota`, { waitUntil: 'networkidle0' });
  await sleep(400);
  await clickText(page, '.subheader__actions button', 'Novo carro');
  record('VEH-01', 'Painel de novo carro abre', await drawerOpen(page));
  await page.type('#vf-code', '10099');
  await page.type('#vf-plate', 'PLACA-INVALIDA');
  await page.click('.tp-drawer__foot button[type="submit"]');
  await sleep(400);
  record('VEH-02', 'Placa inválida é recusada na origem (Zod compartilhado)', await exists(page, '.tp-drawer .tp-error'));
  await page.$eval('#vf-plate', (el) => (el.value = ''));
  await page.type('#vf-plate', 'XYZ9A88');
  await page.click('.tp-drawer__foot button[type="submit"]');
  await sleep(700);
  record('VEH-03', 'Carro válido é criado e o painel fecha', !(await exists(page, '.tp-drawer')));
  await shot(page, 'frota-cadastro');

  // Km: validação de delta na tela
  await page.goto(`${BASE}/km`, { waitUntil: 'networkidle0' });
  await sleep(400);
  const kmInputs = await page.$$('.km-input');
  if (kmInputs.length) {
    await kmInputs[0].type('999999');
    await sleep(200);
    record('KM-01', 'Delta absurdo é sinalizado antes do envio', await exists(page, 'tr.is-danger, tr.row-error'));
    await shot(page, 'km-validacao');
  }

  // Responsivo: 390px, gaveta
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await sleep(500);
  const hOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  record('RESP-01', 'Dashboard a 390px sem rolagem horizontal', !hOverflow);
  await page.click('.header__menu');
  await sleep(450);
  record('RESP-02', 'Gaveta abre no celular com botão de fechar', await exists(page, '.shell--drawer .sidebar__collapse--close'));
  await shot(page, 'mobile-gaveta');
  await page.keyboard.press('Escape');
  await sleep(350);
  record('RESP-03', 'Esc fecha a gaveta', !(await exists(page, '.shell--drawer')));

  // Erros de console
  record('CONS-01', 'Sem erros de JavaScript em nenhuma tela', consoleErrors.length === 0, consoleErrors.map((e) => e.text).join(' | ').slice(0, 300));

  await browser.close();

  const passed = results.filter((r) => r.ok).length;
  const summary = { ranAt: new Date().toISOString(), base: BASE, passed, failed: results.length - passed, results, consoleErrors };
  writeFileSync('tools/QA-RESULTADO.json', JSON.stringify(summary, null, 2));
  console.log(`\n=== ${passed} ok, ${results.length - passed} falha(s) — tools/QA-RESULTADO.json ===\n`);
  process.exit(passed === results.length ? 0 : 1);
}

run().catch((e) => {
  console.error('Erro fatal no QA:', e);
  process.exit(2);
});
