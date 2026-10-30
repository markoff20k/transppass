// Varredura de responsividade: em várias larguras, cada tela é checada por
// rolagem horizontal e por elementos que ultrapassam o cartão/linha onde vivem.
// Uso: node tools/qa-responsivo.mjs [baseWeb] [--shots]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'C:/Users/jefer/AppData/Local/Temp/claude/c--Users-jefer-transppass-pcm/447116dd-98b7-4131-b571-e2bd32975d88/scratchpad/shots/resp';
const BASE = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://localhost:5174';
const SHOTS = process.argv.includes('--shots');
mkdirSync(OUT, { recursive: true });

const widthsArg = process.argv.find((a) => a.startsWith('--widths='));
const WIDTHS = widthsArg ? widthsArg.slice(9).split(',').map(Number) : [2560, 2000, 1920, 1600, 1440, 1280, 1100, 1024, 900, 768, 390];
const PAGES = ['/', '/frota', '/daily', '/checklist', '/eventos', '/triagem', '/fila', '/socorro', '/preventiva', '/plantao', '/os', '/estoque', '/qualidade-pecas', '/componentes', '/indicadores', '/km', '/auditorias', '/cadastros/frota', '/cadastros/catalogo', '/cadastros/planos', '/cadastros/materiais', '/cadastros/tecnicos', '/cadastros/fornecedores', '/cadastros/usuarios', '/perfil'];

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('tp.theme', 'light'); localStorage.setItem('tp.dash.days', '30'); } catch {} });
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.type('#login-email', 'admin@transppass.local');
await page.type('#login-password', 'admin123');
await page.click('button[type="submit"]');
await page.waitForSelector('.dash-hero', { timeout: 30000 });

// Abre a primeira página do carro para incluí-la na varredura.
await page.goto(`${BASE}/frota`, { waitUntil: 'networkidle0', timeout: 60000 });
const carHref = await page.$eval('.fleet-card .flip__link', (a) => a.getAttribute('href')).catch(() => null);
if (carHref) PAGES.push(carHref);
const osHref = await page.goto(`${BASE}/os`, { waitUntil: 'networkidle0', timeout: 60000 }).then(() => page.$eval('a[href^="/os/"]', (a) => a.getAttribute('href'))).catch(() => null);
if (osHref) PAGES.push(osHref);

const findings = [];
for (const width of WIDTHS) {
  await page.setViewport({ width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1 });
  for (const p of PAGES) {
    await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle0', timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));
    // Dashboard e Painel da frota: vira alguns cards para checar o verso também.
    if (p === '/' || p === '/frota') {
      const btns = await page.$$('.flip__btn');
      for (const b of btns.slice(0, 8)) await b.click().catch(() => {});
      await new Promise((r) => setTimeout(r, 1800));
    }
    const res = await page.evaluate(() => {
      const out = [];
      const doc = document.documentElement;
      if (doc.scrollWidth > window.innerWidth + 1) out.push({ kind: 'page-hscroll', sel: 'html', text: `${doc.scrollWidth} > ${window.innerWidth}` });
      const containers = '.tp-card, .dash-kpi, .tp-kpi, .bus-card, .fleet-card__face, .dash-alert, .tp-table-wrap, .recent-list > li, .account__card, .account__tile, .tp-modal, .menu, .subheader, .tp-toolbar, .dash-hero, .wob-card, .vpage__card, .tp-drawer';
      const targets = document.querySelectorAll('.tp-badge, .tp-state, .fleet-chip, .fleet-back__os, .fleet-back__row, .tp-btn, .tp-kpi__note, .dash-kpi__value, .chart__hint, .tp-kpi__label, .tp-segmented, .tp-pager, .tp-input, .tp-select, h1, h2, h3, .bus-card__text, .fleet-card__text, .dash-alert__body, .recent-list__meta, .account__fields, .pref__positions, img, svg.busr, table');
      const seen = new Set();
      for (const el of targets) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cont = el.parentElement?.closest(containers);
        if (!cont || cont === el) continue;
        // Dentro de um invólucro que rola, só a própria tabela interessa (e como aviso, não defeito).
        const wrap = el.closest('.tp-table-wrap');
        if (wrap && getComputedStyle(wrap).overflowX === 'auto') {
          if (el.tagName === 'TABLE') {
            const w = wrap.getBoundingClientRect();
            if (r.width > w.width + 2) out.push({ kind: 'table-scroll', sel: `.${String(el.className).split(' ').slice(0, 2).join('.')} em ${location.pathname}`, text: `${Math.round(r.width - w.width)}px a mais que o invólucro` });
          }
          continue;
        }
        const c = cont.getBoundingClientRect();
        const over = Math.max(r.right - c.right, c.left - r.left);
        if (over > 2) {
          const key = `${el.className}|${cont.className}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ kind: 'overflow', sel: `.${String(el.className).split(' ').slice(0, 2).join('.')} em .${String(cont.className).split(' ')[0]}`, text: `${Math.round(over)}px · "${(el.textContent ?? '').trim().slice(0, 40)}"` });
        }
      }
      return out;
    });
    for (const f of res) findings.push({ width, page: p, ...f });
    if (SHOTS && res.length) await page.screenshot({ path: `${OUT}/${width}${p.replace(/[\/]/g, '_')}.png` });
  }
}
await browser.close();

const byKey = new Map();
for (const f of findings) {
  const k = `${f.kind} ${f.sel}`;
  if (!byKey.has(k)) byKey.set(k, { ...f, widths: new Set(), pages: new Set() });
  byKey.get(k).widths.add(f.width);
  byKey.get(k).pages.add(f.page);
}
for (const v of byKey.values()) console.log(`${v.kind.padEnd(12)} ${v.sel.padEnd(60)} ${[...v.widths].join(',').padEnd(40)} ${[...v.pages].slice(0, 4).join(' ')}  ${v.text}`);
console.log(`\n${findings.length} ocorrências, ${byKey.size} padrões, ${PAGES.length} páginas × ${WIDTHS.length} larguras`);
const defects = findings.filter((f) => f.kind !== 'table-scroll');
console.log(`${defects.length} defeitos (rolagem de página ou elemento fora do cartão); tabelas que rolam no invólucro são aviso.`);
process.exit(defects.length ? 1 : 0);
