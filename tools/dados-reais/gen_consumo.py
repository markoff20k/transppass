"""Gera consumo.json (diesel em litros e energia em kWh, por carro e por dia).

Dois modos:

  python gen_consumo.py --xlsx "C:/.../Consumo.xlsx" [--out apps/api/prisma/data]
      Lê a planilha do cliente com as colunas Data, Pref_No, Litros/kwh e tecnologia.
      Pref_No vem com 6 caracteres ("80.001": 5 dígitos e ponto na milhar) e vira o
      prefixo do CCO (80001), que a frota.json já liga ao carro (001). A coluna
      tecnologia decide a unidade: começa com "e" (ePadron, eArticulado) é elétrico
      e o número é kWh; o resto é diesel e o número é litros.

  python gen_consumo.py --synthetic [--out apps/api/prisma/data]
      Enquanto a planilha não chega: gera dados plausíveis a partir de frota.json e
      km-real.json (rendimento por tecnologia com variação por carro, alguns carros
      fora do padrão e alguns dias sem registro). O JSON sai marcado com
      "source": "sintético" e o seed avisa ao carregar.

Saída: { source, generatedAt, rows: [{ code, date, energy, amount, tech }] } — uma
linha por carro e dia (abastecimentos do mesmo dia são somados).
"""
import sys, os, json, re, argparse, datetime, random, collections, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from xlsx_dump import read_sheets  # noqa: E402

EPOCH = datetime.date(1899, 12, 30)

# Tecnologia por modelo de chassi, da tabela "1-MODELO DO CHASSI" da Transppass.
# Só é usada no modo sintético (a planilha real já traz a coluna).
TECH_BY_CHASSIS = {
    'MBO500U-AC': 'Padron AC', 'MBO500U': 'Padron', 'MBOF 1721': 'Básico', 'VW18.280 OT LE-AC': 'Padron AC',
    'VOLVOB290R': 'Padron AC', 'MBO500 UA-AC': 'Articulado AC', 'MBO500U A': 'Articulado',
    'MBO500 UDA-AC': 'Articulado 23m AC', 'MBO500 UDA': 'Articulado 23m',
    'SCANIAE-SCANIA': 'ePadron 15m AC', 'SCANIAE-BUS': 'ePadron 15m AC', 'VWE-VOLKS': 'ePadron AC',
    'VWE-BUS': 'ePadron AC', 'VWE-VOLKSBUS 22L': 'ePadron AC', 'BYDE-BYD': 'eArticulado AC', 'BYDBC22LE': 'eArticulado AC',
    'BYDD9W': 'eArticulado', 'E-MILLENIUM BRT': 'eArticulado',
}
TECH_BY_CLASS = {
    'BASICO_12M': 'Básico', 'PADRON_13M': 'Padron AC', 'PADRON_15M': 'Padron 15m', 'ARTICULADO_18M': 'Articulado AC',
    'ARTICULADO_23M': 'Articulado 23m AC', 'EPADRON_13M': 'ePadron AC', 'EPADRON_15M': 'ePadron 15m AC',
    'EARTICULADO_23M': 'eArticulado AC', 'EARTICULADO_18M': 'eArticulado AC',
}
# Rendimento típico (modo sintético): diesel em km por litro, elétrico em kWh por km.
DIESEL_KM_PER_L = {'Básico': 3.1, 'Padron': 2.5, 'Padron AC': 2.25, 'Padron 15m': 2.0, 'Articulado': 1.75,
                   'Articulado AC': 1.6, 'Articulado 23m': 1.45, 'Articulado 23m AC': 1.35}
EBUS_KWH_PER_KM = {'ePadron AC': 1.25, 'ePadron 15m AC': 1.45, 'eArticulado': 1.7, 'eArticulado AC': 1.9}


def is_electric(tech):
    """Regra do cliente: tecnologia que começa com "e" é elétrica (ePadron, eArticulado)."""
    return bool(tech) and tech.strip()[:1] == 'e'


def norm(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]', '', s.lower())


def parse_date(v):
    v = str(v).strip()
    if not v:
        return None
    m = re.fullmatch(r'(\d{1,2})/(\d{1,2})/(\d{4})', v)
    if m:
        return datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    m = re.fullmatch(r'(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?', v)
    if m:
        return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    try:
        n = float(v)
    except ValueError:
        return None
    if 20000 < n < 70000:
        return EPOCH + datetime.timedelta(days=int(n))
    return None


def parse_amount(v):
    v = str(v).strip().replace(' ', '')
    if not v:
        return None
    # "1.234,5" (pt-BR) ou "1234.5"
    if ',' in v:
        v = v.replace('.', '').replace(',', '.')
    try:
        return float(v)
    except ValueError:
        return None


def load_fleet(out_dir):
    fleet = json.load(open(os.path.join(out_dir, 'frota.json'), encoding='utf-8'))
    by_prefix = {v['ccoPrefix']: v for v in fleet if v.get('ccoPrefix')}
    by_code = {v['code']: v for v in fleet}
    return fleet, by_prefix, by_code


def from_xlsx(path, out_dir):
    fleet, by_prefix, by_code = load_fleet(out_dir)
    sheets = read_sheets(path)
    rows_out = {}
    stats = collections.Counter()
    mismatch = collections.Counter()
    unknown_prefix = collections.Counter()
    for sheet, rows in sheets.items():
        if not rows:
            continue
        head = [norm(h) for h in rows[0]]
        def find(*names):
            for n in names:
                if n in head:
                    return head.index(n)
            return None
        c_date = find('data', 'date', 'dt')
        c_pref = find('prefno', 'prefixo', 'pref', 'prefix', 'carro')
        c_amt = find('litroskwh', 'litros', 'kwh', 'quantidade', 'qtde', 'consumo')
        c_tech = find('tecnologia', 'tech', 'tipo', 'tipoveiculo')
        if None in (c_date, c_pref, c_amt):
            print(f'aba "{sheet}": sem as colunas esperadas (achei {rows[0]}), pulando')
            continue
        for r in rows[1:]:
            get = lambda i: (r[i].strip() if i is not None and i < len(r) else '')
            d = parse_date(get(c_date))
            amount = parse_amount(get(c_amt))
            raw_pref = get(c_pref)
            digits = re.sub(r'\D', '', raw_pref)
            if not d or amount is None or not digits:
                stats['linhas ignoradas (data, prefixo ou valor vazio)'] += 1
                continue
            if amount <= 0:
                stats['linhas ignoradas (valor zero ou negativo)'] += 1
                continue
            v = by_prefix.get(digits) or by_prefix.get(digits.zfill(5)) or by_code.get(digits.zfill(3) if len(digits) <= 3 else digits)
            if not v:
                unknown_prefix[raw_pref] += 1
                continue
            tech = get(c_tech)
            energy = 'EBUS' if is_electric(tech) else 'DIESEL'
            if tech and energy != v['technology']:
                mismatch[(v['code'], tech, v['technology'])] += 1
            key = (v['code'], d.isoformat())
            cur = rows_out.get(key)
            if cur:
                cur['amount'] = round(cur['amount'] + amount, 3)
                stats['abastecimentos somados no mesmo dia'] += 1
            else:
                rows_out[key] = {'code': v['code'], 'date': d.isoformat(), 'energy': energy, 'amount': round(amount, 3), 'tech': tech or None}
            stats['linhas válidas'] += 1
    rows = sorted(rows_out.values(), key=lambda x: (x['date'], x['code']))
    print('consumo:', len(rows), 'carro-dias ·', dict(stats))
    if unknown_prefix:
        print('  prefixos fora da frota ativa (ignorados):', unknown_prefix.most_common(15))
    if mismatch:
        print('  tecnologia da planilha diverge da frota (usei a da planilha):', list(mismatch.items())[:10])
    return {'source': os.path.basename(path), 'generatedAt': datetime.datetime.now().isoformat(timespec='seconds'), 'rows': rows}


def synthetic(out_dir, seed=20261123):
    rnd = random.Random(seed)
    fleet, _, _ = load_fleet(out_dir)
    km = json.load(open(os.path.join(out_dir, 'km-real.json'), encoding='utf-8'))
    rows = []
    per_tech = collections.Counter()
    for v in fleet:
        if v['application'] != 'FROTA' or v['code'] not in km:
            continue
        tech = TECH_BY_CHASSIS.get(v.get('chassisCode') or '') or TECH_BY_CLASS.get(v.get('vehicleClass') or '')
        if not tech:
            continue
        electric = is_electric(tech)
        # Variação por carro: a maioria perto do típico; ~6% claramente piores (motor cansado,
        # ar-condicionado defeituoso, pé pesado), ~3% melhores.
        roll = rnd.random()
        factor = rnd.uniform(1.18, 1.32) if roll < 0.06 else rnd.uniform(0.9, 0.95) if roll < 0.09 else rnd.gauss(1.0, 0.045)
        drift = rnd.uniform(-0.00015, 0.00035)  # desgaste lento ao longo do ano
        for i, (date, day_km) in enumerate(sorted(km[v['code']].items())):
            if not day_km or day_km <= 0:
                continue
            if rnd.random() < 0.025:  # dia sem registro: rodou mas ninguém lançou
                continue
            month = int(date[5:7])
            season = 1.0 + (0.06 if month in (1, 2, 3, 12) else 0.0) + (0.03 if month in (10, 11) else 0.0)  # calor = AC
            noise = rnd.gauss(1.0, 0.07)
            day_factor = factor * season * noise * (1 + drift * i)
            if electric:
                amount = day_km * EBUS_KWH_PER_KM[tech] * day_factor
            else:
                amount = day_km / (DIESEL_KM_PER_L[tech] / day_factor)
            rows.append({'code': v['code'], 'date': date, 'energy': 'EBUS' if electric else 'DIESEL', 'amount': round(amount, 1), 'tech': tech})
            per_tech[tech] += 1
    rows.sort(key=lambda x: (x['date'], x['code']))
    print('consumo sintético:', len(rows), 'carro-dias ·', per_tech.most_common())
    return {'source': 'sintético', 'generatedAt': datetime.datetime.now().isoformat(timespec='seconds'), 'rows': rows}


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--xlsx', help='planilha de consumo do cliente')
    ap.add_argument('--synthetic', action='store_true', help='gera dados plausíveis enquanto a planilha não chega')
    ap.add_argument('--out', default=os.path.normpath(os.path.join(HERE, '..', '..', 'apps', 'api', 'prisma', 'data')))
    a = ap.parse_args()
    if not a.xlsx and not a.synthetic:
        ap.error('informe --xlsx <arquivo> ou --synthetic')
    data = from_xlsx(a.xlsx, a.out) if a.xlsx else synthetic(a.out)
    target = os.path.join(a.out, 'consumo.json')
    json.dump(data, open(target, 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, indent=0)
    print('gravado', target, '· fonte:', data['source'])
