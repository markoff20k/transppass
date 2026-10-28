# Dados reais da Transppass

Scripts que transformam as planilhas enviadas pelo cliente nos JSON que o seed carrega (`apps/api/prisma/data/`).

- `xlsx_dump.py`: lê um .xlsx sem dependências.
- `gen_real.py`: gera `frota.json`, `km-real.json` e `cco.json` a partir de `1-VBM0208.xlsx`, `2-VBM0406_km.xlsx` e `3-CCOweb.xlsx`. Ajuste os caminhos no topo do script.

Os JSON gerados contêm dados do cliente (placas, chassi, RENAVAM, matrículas, texto das ocorrências) e por isso não entram no repositório por padrão.
