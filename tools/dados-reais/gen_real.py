"""Gera frota.json, km-real.json e cco.json a partir das planilhas da Transppass."""
import sys, json, re, collections, datetime
sys.path.insert(0, 'C:/Users/jefer/AppData/Local/Temp/claude/c--Users-jefer-transppass-pcm/447116dd-98b7-4131-b571-e2bd32975d88/scratchpad')
from xlsx_dump import read_sheets
C = 'C:/Users/jefer/AppData/Local/Temp/claude/c--Users-jefer-transppass-pcm/447116dd-98b7-4131-b571-e2bd32975d88/scratchpad/cliente/'
OUT = 'C:/Users/jefer/transppass-pcm/apps/api/prisma/data/'
EPOCH = datetime.date(1899, 12, 30)
def xl_date(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if not (20000 < n < 70000): return None
    return EPOCH + datetime.timedelta(days=int(n))
def xl_datetime(v):
    n = float(v)
    return datetime.datetime(1899, 12, 30) + datetime.timedelta(days=n)
def num(v):
    try: return int(float(v))
    except (TypeError, ValueError): return 0

chassis = {c['code']: c for c in json.load(open(OUT + 'chassis.json', encoding='utf-8'))}

# ---- Frota ---------------------------------------------------------------------------------
fro = read_sheets(C + 'vbm0208.xlsx')['Planilha1']; fh = fro[0]
col = lambda r, n: (r[fh.index(n)].strip() if fh.index(n) < len(r) else '')
frota = []
missing_chassis = collections.Counter()
for r in fro[1:]:
    if col(r, 'STATUS') != '0' or not col(r, 'PLACA'): continue
    code = col(r, 'CARRO')
    cc = (col(r, 'MARCA DO CHASSI') + col(r, 'MODELO DO CHASSI')).strip()
    ch = chassis.get(cc)
    if not ch: missing_chassis[cc] += 1
    lot = col(r, 'MODALIDADE') or None
    km = num(col(r, 'KM CHASSI'))
    acq = xl_date(col(r, 'DATA DE AQUISICAO'))
    frota.append({
        'code': code,
        'ccoPrefix': ('81' if lot == 'E8' else '80') + code,
        'plate': col(r, 'PLACA').replace(' ', ''),
        'chassisCode': cc,
        'manufacturer': ch['manufacturer'] if ch else (col(r, 'MARCA DO CHASSI') or None),
        'model': ch['model'] if ch else (col(r, 'MODELO DO CHASSI') or None),
        'vehicleClass': ch['vehicleClass'] if ch else None,
        'technology': 'EBUS' if (ch and ch['isElectric']) else 'DIESEL',
        'hasAc': bool(ch and ch['hasAc']) or col(r, 'AR CONDICIONADO') == 'S',
        'fabricationYear': num(col(r, 'ANO DE FABRICACAO')) or None,
        'modelYear': num(col(r, 'ANO MODELO')) or None,
        'bodyMaker': col(r, 'MARCA DA CARROCERIA') or None,
        'bodyYear': num(col(r, 'ANO CARROCERIA')) or None,
        'vin': col(r, 'NUMERO DO CHASSI') or None,
        'renavam': col(r, 'RENAVAM') or None,
        'seats': num(col(r, 'LOTACAO')) or None,
        'acquiredAt': acq.isoformat() if acq else None,
        'lot': lot,
        'garageCode': col(r, 'GARAGEM') or None,
        'telemetry': col(r, 'TELEMETRIA') == 'S',
        'currentKm': km if 0 < km < 3_000_000 else 0,
    })
assert len({v['code'] for v in frota}) == len(frota) and len({v['plate'] for v in frota}) == len(frota)
print('frota ativa:', len(frota), '· sem chassi na tabela:', dict(missing_chassis))
print('  por classe:', collections.Counter(v['vehicleClass'] for v in frota).most_common())
print('  por lote:', collections.Counter(v['lot'] for v in frota).most_common(), '· telemetria:', sum(v['telemetry'] for v in frota))
json.dump(frota, open(OUT + 'frota.json', 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, indent=0)
codes = {v['code'] for v in frota}
by_prefix = {v['ccoPrefix']: v['code'] for v in frota}

# ---- Km diário ------------------------------------------------------------------------------
km = {}
for name, rows in read_sheets(C + 'km.xlsx').items():
    m = re.match(r'(\d{4}) (\d{2})', name)
    year, month = int(m.group(1)), int(m.group(2))
    head = rows[0]
    day_cols = [(i, int(h)) for i, h in enumerate(head) if re.fullmatch(r'\d{2}', h.strip())]
    for r in rows[1:]:
        code = r[0].strip() if r else ''
        if code not in codes: continue
        for i, day in day_cols:
            v = num(r[i]) if i < len(r) else 0
            if v > 0:
                km.setdefault(code, {})[f'{year}-{month:02d}-{day:02d}'] = v
tot = sum(sum(d.values()) for d in km.values()); days = sum(len(d) for d in km.values())
print('km real: carros', len(km), '· dias', days, '· total', tot)
json.dump(km, open(OUT + 'km-real.json', 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, separators=(',', ':'))

# ---- Ocorrências do CCO --------------------------------------------------------------------
# Defeito do CCO → Modo de falha × Subsistema VMRS (+ item do catálogo quando existe)
DEFECT = {
    'Mecânica': ('IN', '011-000', None), 'Elétrica': ('IN', '030-000', None), 'Sistema de portas': ('AF', '174-010', 'CAR-POR-01'),
    'Ar Condicionado': ('NR', '031-000', 'AC-CLI-01'), 'Motor Sem Força': ('PF', '011-000', None), 'Nível de Bateria': ('NC', '030-001', None),
    'Superaquecimento': ('SA', '011-003', 'MEC-MOT-01'), 'Funilaria': ('QB', '174-000', None), 'Suspensão': ('AR', '022-000', None),
    'Bilhetagem/ Validador': ('IN', '174-016', None), 'Bilhetagem/ Catraca': ('IN', '174-016', None), 'Sem Partida': ('SP', '030-000', None),
    'Sistema de Freio': ('SF', '021-000', None), 'Compressor': ('IN', '021-004', None), 'Avaria': ('QB', '174-000', None), 'TD 80': ('FE', '034-004', None),
    'Rodagem': ('IN', '025-001', None), 'Câmbio': ('NE', '019-000', None), 'Vazamento de água': ('VZ', '011-003', None), 'Correia do Motor': ('FU', '011-005', None),
    'Desligando em movimento': ('DM', '011-000', None), 'Rodas Travadas': ('TR', '021-000', None), 'Vazamento de óleo': ('VZ', '011-000', None),
    'Anjo da Guarda': ('IN', '030-005', None), 'Coordenada Travada': ('FE', '034-004', None), 'GPS / Wi-Fi': ('IN', '034-004', None),
    'Elevador': ('IN', '174-001', None), 'Sem Transmissão': ('NE', '019-000', None), 'Escotilha': ('AF', '174-006', None), 'Rampa': ('AF', '174-001', None),
    'Itinerários': ('AP', '030-007', None), 'Tacógrafo': ('IN', '032-001', None), 'Alinh. Porta': ('TD', '174-010', None), 'Alçapão': ('AF', '174-006', None),
    'Colisão sem vítimas': None, 'Colisão com vítimas': None, 'Vandalismo': None, 'Falta de frota': None, 'Lacrado / Suspenso': None, 'Atraso falta de frota': None,
}
# Grupos do CCO: o que é manutenção e o que conta como quebra (retorno não programado)
GROUP = {
    'FRO': ('Falha com retorno operacional', True, False),
    'SOS': ('Aguardando socorro', True, True),
    'RAM': ('Recolhida anormal (manutenção)', True, True),
    'PAM': ('Ponto de atendimento da manutenção', True, False),
    'TRO': ('Troca de carro', True, True),
    'SUB': ('Substituição de carro', True, False),
}
subs = set(re.findall(r"sub\('(\d{3}-\d{3})'", open('C:/Users/jefer/transppass-pcm/packages/shared/src/catalog/failure-codes.ts', encoding='utf-8').read()))
for k, v in DEFECT.items():
    if v: assert v[1] in subs, (k, v[1])
cco = read_sheets(C + 'cco.xlsx')['Sheet1']; h = cco[0]
cc = lambda r, n: (r[h.index(n)].strip() if h.index(n) < len(r) else '')
events = []; skipped = collections.Counter(); drivers = 0
for r in cco[1:]:
    grp = cc(r, 'Grupo')[:3]
    if grp not in GROUP: skipped['grupo ' + (cc(r, 'Grupo') or '(vazio)')] += 1; continue
    pref = cc(r, 'Prefixo')
    code = by_prefix.get(pref)
    if not code: skipped['prefixo ' + pref] += 1; continue
    defect = cc(r, 'Defeito')
    m = DEFECT.get(defect, ('IN', '011-000', None))
    if m is None: skipped['defeito ' + defect] += 1; continue
    try:
        at = xl_datetime(cc(r, 'Data_Hora'))
    except (TypeError, ValueError):
        d = xl_date(cc(r, 'ope_data'))
        if not d: skipped['sem data'] += 1; continue
        hh, mm = (cc(r, 'Hora_Ini') + ':0').split(':')[:2]
        at = datetime.datetime(d.year, d.month, d.day, int(hh or 0), int(mm or 0))
    label, maint, ret = GROUP[grp]
    text = cc(r, 'Ocorrência')
    events.append({
        'id': cc(r, 'ope_id').replace('.', ''),
        'at': at.replace(microsecond=0).isoformat(),
        'code': code,
        'driverReg': int(cc(r, 'Motorista')) if cc(r, 'Motorista').isdigit() else None,
        'line': cc(r, 'Linha') or None,
        'defect': defect or None,
        'place': cc(r, 'local') or None,
        'direction': cc(r, 'Sentido') or None,
        'lostTrips': num(cc(r, 'V_Perdida')),
        'group': grp,
        'groupLabel': label,
        'unscheduledReturn': ret,
        'modeCode': m[0], 'subsystemCode': m[1], 'catalogCode': m[2],
        'text': text[:480] if text else None,
    })
events.sort(key=lambda e: e['at'])
print('cco: eventos', len(events), '· descartados', dict(skipped))
sept = [e for e in events if e['at'].startswith('2026-09')]
print('  setembro:', len(sept), '· retornos não programados (SOS+RAM+TRO):', sum(e['unscheduledReturn'] for e in sept), '· só RAM:', sum(1 for e in sept if e['group'] == 'RAM'), '· viagens perdidas:', sum(e['lostTrips'] for e in sept))
ago = [e for e in events if e['at'].startswith('2026-08')]
print('  agosto:', len(ago), '· retornos:', sum(e['unscheduledReturn'] for e in ago), '· viagens perdidas:', sum(e['lostTrips'] for e in ago))
print('  MKBF setembro (SOS+RAM+TRO):', round(sum(km[c].get(d, 0) for c in km for d in km[c] if d.startswith('2026-09')) / max(1, sum(e['unscheduledReturn'] for e in sept))), 'km · só RAM:', round(sum(km[c].get(d, 0) for c in km for d in km[c] if d.startswith('2026-09')) / max(1, sum(1 for e in sept if e['group'] == 'RAM'))), 'km')
json.dump(events, open(OUT + 'cco.json', 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, indent=0)
