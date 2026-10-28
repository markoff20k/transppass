"""Gera, a partir das planilhas da Transppass e dos JSON do gen_real.py (frota.json, km-real.json, cco.json):
  codigos-transppass.json  classificação (5-Serviços abas 1 e 2 + 3-Códigos VBM0503)
  os-real.json             fichas de manutenção (3-VBM0503) + OS só da oficina (4-VBM0805) + peças por OS (8-VBM0404)
  eventos.json             quebras para o MKBF (fichas A, S e T, conforme a carta do cliente de 28/10/2026) casadas com o CCO,
                           mais as ocorrências do CCO que não viraram ficha
  viagens.json             viagens por linha e dia (7-Viagens)
  linhas-dia.json          km por carro, linha e dia (7-VBR0306)
Ajuste os caminhos no topo."""
import sys, json, re, collections, datetime
sys.path.insert(0, 'C:/Users/jefer/AppData/Local/Temp/claude/c--Users-jefer-transppass-pcm/447116dd-98b7-4131-b571-e2bd32975d88/scratchpad')
from xlsx_dump import read_sheets
C = 'C:/Users/jefer/AppData/Local/Temp/claude/c--Users-jefer-transppass-pcm/447116dd-98b7-4131-b571-e2bd32975d88/scratchpad/cliente/'
OUT = 'C:/Users/jefer/transppass-pcm/apps/api/prisma/data/'
EPOCH = datetime.datetime(1899, 12, 30)
WINDOW = ('2026-08', '2026-09')  # abrangência informada pelo cliente (item 9 da carta)
def num(v, default=None):
    try: return float(str(v).replace(',', '.'))
    except (TypeError, ValueError): return default
def xl_dt(v):
    n = num(v)
    return None if n is None or not (20000 < n < 70000) else EPOCH + datetime.timedelta(days=n)
def br_date(s):
    m = re.fullmatch(r'(\d{2})/(\d{2})/(\d{4})', (s or '').strip())
    return datetime.datetime(int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else None
def pad3(code):
    code = (code or '').strip()
    if re.fullmatch(r'\d{1,3}', code): return code.zfill(3)
    if re.fullmatch(r'\d{5}', code): return code[-3:]
    return code
_fleet = json.load(open(OUT + 'frota.json', encoding='utf-8'))
frota = {v['code'] for v in _fleet}
operacao = {v['code'] for v in _fleet if v.get('application', 'FROTA') == 'FROTA'}  # só a frota entra no km do MKBF
dump = lambda name, obj: json.dump(obj, open(OUT + name, 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, separators=(',', ':'))

# ---- Códigos da Transppass (5-Serviços + 3-Códigos) ----
codes = []
sv = read_sheets(C + 'servicos.xlsx')
for name, kind in (('1', 'ALEGADO'), ('2', 'CONSTATADO')):
    group = None
    for r in sv[name][1:]:
        if not r or not r[0].strip(): continue
        code, desc = r[0].strip(), (r[1].strip() if len(r) > 1 else '')
        if code.endswith('00') and desc: group = desc
        codes.append({'kind': kind, 'code': code, 'description': desc, 'group': group if not code.endswith('00') else desc})
for r in read_sheets(C + 'codigos0503.xlsx')['Planilha1'][1:]:
    if r and r[0].strip(): codes.append({'kind': 'FICHA', 'code': r[0].strip(), 'description': r[1].strip(), 'group': None})
seen = set(); codes = [c for c in codes if not ((c['kind'], c['code']) in seen or seen.add((c['kind'], c['code'])))]
ficha_label = {c['code']: c['description'] for c in codes if c['kind'] == 'FICHA'}
ficha_label.setdefault('D', 'Diário')
print('códigos:', collections.Counter(c['kind'] for c in codes))
dump('codigos-transppass.json', codes)

# Grupo do defeito constatado (2 primeiros dígitos, aba 2 do 5-Serviços) -> Modo x Subsistema VMRS do sistema.
# De-para aproximado: o grupo da Transppass é mais grosso que o VMRS; refinar com o cliente.
GROUP_VMRS = {
    '11': ('IN', '011-000'), '12': ('IN', '022-000'), '13': ('IN', '025-000'), '14': ('IN', '021-000'), '15': ('IN', '019-000'),
    '16': ('IN', '011-001'), '17': ('IN', '021-004'), '21': ('IN', '030-000'), '22': ('IN', '034-004'), '25': ('IN', '031-000'),
    '30': ('QB', '174-000'), '31': ('IN', '174-000'), '41': ('IN', '025-001'), '42': ('IN', '011-002'), '90': ('IN', '174-000'),
}

# ---- Fichas de manutenção (3-VBM0503) ----
rows = read_sheets(C + 'vbm0503.xlsx')['Plan1']; h = [x.strip() for x in rows[0]]
cods = [i for i, x in enumerate(h) if x == 'COD']
ci = lambda r, i: (r[i].strip() if i < len(r) else '')
col = lambda r, n: ci(r, h.index(n))
records = {}
skipped = collections.Counter()
for r in rows[1:]:
    d = xl_dt(col(r, 'DATA'))
    if not d: skipped['sem data'] += 1; continue
    hour = num(col(r, 'HORA'), 0) or 0
    at = d + datetime.timedelta(days=hour if hour < 1 else 0)
    car = pad3(col(r, 'CARRO'))
    if car not in frota: skipped['carro fora da frota'] += 1; continue
    os_ = col(r, 'O.S.')
    if not os_: skipped['sem OS'] += 1; continue
    t = col(r, 'T')
    records[os_] = {
        'externalOs': os_, 'ficha': col(r, 'FICHA') or None, 'code': car, 'openedAt': at.replace(microsecond=0).isoformat(),
        'kind': t, 'kindLabel': ficha_label.get(t, t), 'isPreventive': False,
        'allegedCode': ci(r, cods[0]) or None, 'allegedText': col(r, 'OCORRENCIA').strip() or None, 'allegedDetail': col(r, 'DEFEITO ALEGADO').strip() or None,
        'foundCode': ci(r, cods[1]) or None, 'foundText': col(r, 'DEFEITO CONSTATADO').strip() or None,
        'actions': col(r, 'PROVIDENCIAS').strip() or None, 'fieldActions': col(r, 'PROVIDENCIAS ADOTADA (SOCORRO)').strip() or None,
        'driverName': col(r, 'MOTORISTA') or None, 'driverReg': col(r, 'N.REG') or None, 'line': col(r, 'LINHA') or None, 'mechanicReg': col(r, 'MEC') or None,
        'cost': num(col(r, 'R$ CUSTO')), 'lot': col(r, 'MOD') or None, 'items': [], 'materials': [],
    }
by_ficha = {x['ficha']: x for x in records.values() if x['ficha']}
print('fichas:', len(records), 'descartadas', dict(skipped), '· por tipo', collections.Counter(x['kind'] for x in records.values()).most_common())

# ---- Serviços e componentes por OS (4-VBM0805) ----
# Liga pela O.S. (ou RSOS = FICHA, item 3.1.4/4.1.6 da carta). As OS sem ficha são a manutenção programada e a corretiva
# de oficina: entram como registro próprio; KM LIM > 0 em algum item = preventiva (item 6 da carta).
rows = read_sheets(C + 'vbm0805.xlsx')['Planilha1']; h = [x.strip() for x in rows[0]]
col = lambda r, n: (r[h.index(n)].strip() if h.index(n) < len(r) else '')
items_ok = items_new = 0; out_of_window = collections.Counter(); off_fleet = 0
for r in rows[1:]:
    d = br_date(col(r, 'DATA')) or xl_dt(col(r, 'DATA'))
    if not d or d.strftime('%Y-%m') not in WINDOW: out_of_window[(d.strftime('%Y-%m') if d else 'sem data') + ' série ' + col(r, 'O.S.')[:1]] += 1; continue
    os_ = col(r, 'O.S.')
    rec = records.get(os_) or by_ficha.get(col(r, 'RSOS'))
    if not rec:
        car = pad3(col(r, 'CARRO'))
        if car not in frota: off_fleet += 1; continue
        rec = records[os_] = {
            'externalOs': os_, 'ficha': col(r, 'RSOS') or None, 'code': car, 'openedAt': d.replace(hour=8).isoformat(), 'kind': 'OF', 'kindLabel': 'Oficina (sem ficha)', 'isPreventive': False,
            'allegedCode': None, 'allegedText': None, 'allegedDetail': None, 'foundCode': None, 'foundText': None, 'actions': None, 'fieldActions': None,
            'driverName': None, 'driverReg': None, 'line': None, 'mechanicReg': col(r, 'MEC') or None, 'cost': None, 'lot': None, 'items': [], 'materials': [],
        }
        items_new += 1
    else:
        items_ok += 1
    comp = col(r, 'COMPONENTE')
    m = re.match(r'(\d{3})-\s*(.*)', comp)
    km_lim = int(num(col(r, 'KM LIM'), 0) or 0) or None
    rec['items'].append({'componentCode': m.group(1) if m else None, 'componentLabel': (m.group(2) if m else comp).strip()[:80], 'kmAtService': int(num(col(r, 'KM SERV'), 0) or 0) or None, 'kmLimit': km_lim, 'mechanicReg': col(r, 'MEC') or None, 'note': col(r, 'OBSERVACOES').strip()[:120] or None})
    if km_lim: rec['isPreventive'] = True
for rec in records.values():
    if rec['kind'] == 'OF' and rec['isPreventive']: rec['kind'], rec['kindLabel'] = 'PV', 'Preventiva por km'
print('itens de serviço: em fichas', items_ok, '· em OS só da oficina', items_new, '· fora da abrangência (ignorados)', dict(out_of_window), '· carro fora da frota', off_fleet)
print('  registros:', collections.Counter(x['kind'] for x in records.values()).most_common(), '· preventivas', sum(x['isPreventive'] for x in records.values()))

# ---- Peças por OS (8-VBM0404) ----
rows = read_sheets(C + 'vbm0404.xlsx')['VBE0404']; h = [x.strip() for x in rows[0]]
col = lambda r, n: (r[h.index(n)].strip() if h.index(n) < len(r) else '')
mats_ok = mats_orphan = 0; orphan_rows = []
for r in rows[1:]:
    d = xl_dt(col(r, 'DATA'))
    mat = col(r, 'MATERIAL')
    mm = re.match(r'(.*?)\s{2,}(\d{6})\s*$', mat) or re.match(r'(.*)\s(\d{6})$', mat)
    desc, mcode = (mm.group(1).strip(), mm.group(2)) if mm else (mat.strip(), None)
    cls = col(r, 'CLASSE/DENOMINACAO'); cm = re.match(r'(\d{6})\s+(.*)', cls)
    row = {'materialCode': mcode, 'description': desc[:120], 'classCode': cm.group(1) if cm else None, 'className': (cm.group(2).strip() if cm else cls.strip())[:60] or None,
           'quantity': num(col(r, 'QUANT'), 0) or 0, 'unitCost': num(col(r, 'UNIT'), 0) or 0, 'totalCost': num(col(r, 'TOTAL'), 0) or 0,
           'mechanicReg': col(r, 'FUNC.') or None, 'kmAtService': int(num(col(r, 'KM CHASSI'), 0) or 0) or None, 'appliedAt': d.date().isoformat() if d else None,
           'code': pad3(col(r, 'CARRO')), 'externalOs': col(r, 'O.S.') or None}
    rec = records.get(row['externalOs'])
    if rec: rec['materials'].append(row); mats_ok += 1
    else:
        mats_orphan += 1
        if row['code'] in frota and d: orphan_rows.append(row)
print('peças por OS: ligadas', mats_ok, '· sem OS conhecida', mats_orphan, '(mantidas como avulsas:', len(orphan_rows), ')')
dump('os-real.json', {'records': list(records.values()), 'looseMaterials': orphan_rows})
print('  custo de peças ligado às OS: R$', round(sum(m['totalCost'] for x in records.values() for m in x['materials']), 2))

# ---- Quebras (MKBF) e ocorrências ----
# Carta do cliente, item 3.1.5: contam para o MKBF as fichas de tipo A (recolhida anormal), S (socorro) e T (troca).
# Cada uma vira um evento com retorno não programado; quando o CCO registrou a mesma quebra (mesmo carro, mesmo dia,
# grupo SOS/RAM/TRO) os dados do CCO (viagens perdidas, local, linha) entram no mesmo evento, sem duplicar.
cco = json.load(open(OUT + 'cco.json', encoding='utf-8'))
PAIR = {'S': 'SOS', 'A': 'RAM', 'T': 'TRO'}
pool = collections.defaultdict(list)
for e in cco:
    if e['group'] in ('SOS', 'RAM', 'TRO'): pool[(e['code'], e['at'][:10])].append(e)
used = set(); events = []
fichas_ast = sorted((x for x in records.values() if x['kind'] in PAIR), key=lambda x: x['openedAt'])
for f in fichas_ast:
    cands = [e for e in pool.get((f['code'], f['openedAt'][:10]), []) if e['id'] not in used]
    match = next((e for e in cands if e['group'] == PAIR[f['kind']]), None) or (cands[0] if cands else None)
    if match: used.add(match['id'])
    mode = GROUP_VMRS.get((f['foundCode'] or '')[:2]) or ((match['modeCode'], match['subsystemCode']) if match else ('IN', '011-000'))
    text = ' · '.join(x for x in [f['allegedText'], f['allegedDetail'], ('constatado: ' + f['foundText']) if f['foundText'] else None, f['actions'] or f['fieldActions']] if x)
    events.append({
        'id': 'FICHA-' + f['externalOs'], 'source': 'FICHA', 'fichaKind': f['kind'], 'externalOs': f['externalOs'], 'at': f['openedAt'], 'code': f['code'],
        'driverReg': (int(f['driverReg']) if f['driverReg'] and f['driverReg'].isdigit() else (match['driverReg'] if match else None)),
        'line': f['line'] or (match['line'] if match else None), 'defect': match['defect'] if match else None, 'place': match['place'] if match else None,
        'direction': match['direction'] if match else None, 'lostTrips': match['lostTrips'] if match else 0,
        'group': match['group'] if match else None, 'groupLabel': ficha_label.get(f['kind'], f['kind']), 'unscheduledReturn': True,
        'modeCode': mode[0], 'subsystemCode': mode[1], 'catalogCode': match['catalogCode'] if match else None, 'text': text[:480] or None,
    })
matched = sum(1 for e in events if e['group'])
for e in cco:
    if e['id'] in used: continue
    events.append({**e, 'id': 'CCO-' + e['id'], 'source': 'CCO', 'fichaKind': None, 'externalOs': None, 'unscheduledReturn': False})
events.sort(key=lambda e: e['at'])
print('eventos:', len(events), '· quebras (fichas A/S/T)', len(fichas_ast), 'das quais com registro no CCO', matched, '· CCO sem ficha', sum(1 for e in events if e['source'] == 'CCO'), '(SOS/RAM/TRO sem ficha:', sum(1 for e in events if e['source'] == 'CCO' and e['group'] in ('SOS', 'RAM', 'TRO')), ')')
km = json.load(open(OUT + 'km-real.json', encoding='utf-8'))
for m in WINDOW:
    k = sum(v for c in km for d, v in km[c].items() if d.startswith(m) and c in operacao)
    q = sum(1 for e in events if e['unscheduledReturn'] and e['at'].startswith(m))
    print(f'  {m}: km {k:,} · quebras {q} · MKBF {round(k / max(1, q)):,} km · viagens perdidas (CCO) {sum(e["lostTrips"] for e in events if e["at"].startswith(m))}')
dump('eventos.json', events)

# ---- Viagens por linha e dia (7-Viagens) ----
# V_prog inclui as viagens reservadas (VPRes); perdida = programada para operar (VPOpe) menos monitorada.
rows = read_sheets(C + 'viagens.xlsx')['1']; h = [x.strip() for x in rows[0]]
col = lambda r, n: (r[h.index(n)].strip() if h.index(n) < len(r) else '')
trips = []
for r in rows[1:]:
    d = xl_dt(col(r, 'Data_ope'))
    if not d or not col(r, 'Linha'): continue
    prog, ops, moni = int(num(col(r, 'V_prog'), 0) or 0), int(num(col(r, 'VPOpe'), 0) or 0), int(num(col(r, 'V_moni'), 0) or 0)
    trips.append({'date': d.date().isoformat(), 'line': col(r, 'Linha'), 'direction': col(r, 'Sentido') or '', 'plannedReserve': int(num(col(r, 'VPRes'), 0) or 0), 'plannedOps': ops, 'planned': prog, 'monitored': moni, 'lost': max(0, ops - moni)})
by_month = collections.defaultdict(lambda: [0, 0, 0])
for t in trips:
    m = by_month[t['date'][:7]]; m[0] += t['plannedOps']; m[1] += t['monitored']; m[2] += t['lost']
print('viagens: linhas', len(trips), '· por mês (programadas p/ operar, monitoradas, perdidas):', dict(by_month))
dump('viagens.json', trips)

# ---- Km por carro, linha e dia (7-VBR0306) ----
rows = read_sheets(C + 'vbr0306.xlsx')['Sheet1']; h = [x.strip() for x in rows[0]]
col = lambda r, n: (r[h.index(n)].strip() if h.index(n) < len(r) else '')
lines = []; skip = collections.Counter()
for r in rows[1:]:
    d = xl_dt(col(r, 'DATA')); car = pad3(col(r, 'P_Base'))
    if not d: skip['sem data'] += 1; continue
    if car not in frota: skip['carro fora da frota'] += 1; continue
    reg = col(r, 'REGISTRO')
    lines.append({'code': car, 'date': d.date().isoformat(), 'line': col(r, 'LINHA') or None, 'table': (col(r, 'TABELA') if col(r, 'TABELA') not in ('. .', '') else None),
                  'driverReg': reg or None, 'isSubstitution': reg == '00.000',
                  'kmInLine': round(num(col(r, 'KLIM'), 0) or 0, 1), 'kmIdle': round(num(col(r, 'KOCI'), 0) or 0, 1), 'trips': int(num(col(r, 'VTOT'), 0) or 0)})
print('km por linha: linhas', len(lines), 'descartadas', dict(skip), '· substituições', sum(x['isSubstitution'] for x in lines), '· km em linha total', round(sum(x['kmInLine'] for x in lines)), '· ocioso', round(sum(x['kmIdle'] for x in lines)), '· viagens', sum(x['trips'] for x in lines))
dump('linhas-dia.json', lines)
