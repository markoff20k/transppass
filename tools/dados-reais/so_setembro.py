"""Recorta as bases da Transppass para um único mês de amostra.

Guarda os arquivos completos em apps/api/prisma/data-full/ (fora do git) e
reescreve apps/api/prisma/data/ só com o mês escolhido. Cadastros (frota,
chassis, códigos, materiais, operadores, planos, ferramentas) ficam inteiros.

Uso: python tools/dados-reais/so_setembro.py [2026-09]
Para voltar à base completa: copie data-full/ por cima de data/.
"""
import io, json, os, shutil, sys

MES = sys.argv[1] if len(sys.argv) > 1 else '2026-09'
ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'apps', 'api', 'prisma')
DATA = os.path.join(ROOT, 'data')
FULL = os.path.join(ROOT, 'data-full')
MOVIMENTO = ['eventos.json', 'cco.json', 'km-real.json', 'os-real.json', 'viagens.json', 'linhas-dia.json']

os.makedirs(FULL, exist_ok=True)
for f in MOVIMENTO:
    src, bak = os.path.join(DATA, f), os.path.join(FULL, f)
    if not os.path.exists(bak):
        shutil.copy2(src, bak)

def load(f): return json.load(io.open(os.path.join(FULL, f), encoding='utf-8'))
def save(f, obj):
    io.open(os.path.join(DATA, f), 'w', encoding='utf-8').write(json.dumps(obj, ensure_ascii=False))

ev = load('eventos.json'); ev2 = [e for e in ev if e['at'].startswith(MES)]
save('eventos.json', ev2)
cco = load('cco.json'); save('cco.json', [e for e in cco if e['at'].startswith(MES)])
km = load('km-real.json'); km2 = {c: {d: v for d, v in days.items() if d.startswith(MES)} for c, days in km.items()}
km2 = {c: days for c, days in km2.items() if days}
save('km-real.json', km2)
osr = load('os-real.json')
osr2 = {'records': [r for r in osr['records'] if str(r['openedAt']).startswith(MES)],
        'looseMaterials': [m for m in osr['looseMaterials'] if str(m['appliedAt']).startswith(MES)]}
save('os-real.json', osr2)
vi = load('viagens.json'); save('viagens.json', [t for t in vi if t['date'].startswith(MES)])
ld = load('linhas-dia.json'); save('linhas-dia.json', [l for l in ld if l['date'].startswith(MES)])

ret = [e for e in ev2 if e['unscheduledReturn']]
print(f"mês {MES}: {len(ev2)} ocorrências ({len(ret)} fichas A/S/T), {sum(len(d) for d in km2.values())} leituras de km em {len(km2)} carros, "
      f"{len(osr2['records'])} OS, {len(osr2['looseMaterials'])} materiais avulsos, {len(vi) and sum(1 for t in vi if t['date'].startswith(MES))} viagens, "
      f"{sum(1 for l in ld if l['date'].startswith(MES))} linha-dia")
