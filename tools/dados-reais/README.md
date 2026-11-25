# Dados reais da Transppass

Scripts que transformam as planilhas enviadas pelo cliente nos JSON que o seed carrega (`apps/api/prisma/data/`).

- `xlsx_dump.py`: lê um .xlsx sem dependências.
- `gen_real.py`: gera `frota.json`, `km-real.json` e `cco.json` a partir de `1-VBM0208.xlsx`, `2-VBM0406_km.xlsx` e `3-CCOweb.xlsx`. Ajuste os caminhos no topo do script.
- `gen_consumo.py`: gera `consumo.json` (litros do diesel e kWh dos elétricos, por carro e dia) a partir da planilha de abastecimento/recarga (`--xlsx <arquivo>`, colunas Data, Pref_No, Litros/kwh e tecnologia; "e" no início da tecnologia = elétrico). Com `--synthetic` gera dados plausíveis de desenvolvimento a partir de `frota.json` e `km-real.json`, marcados como "sintético". Carga só do consumo: `npm run db:seed:consumo`.
- `gen_real2.py`: gera `codigos-transppass.json` (5-Serviços + 3-Códigos VBM0503), `os-real.json` (fichas de 3-VBM0503, OS e serviços de 4-VBM0805, peças de 8-VBM0404, ligadas pela O.S. ou por RSOS = FICHA), `eventos.json` (quebras = fichas A/S/T casadas com o CCO + ocorrências só do CCO), `viagens.json` (7-Viagens) e `linhas-dia.json` (7-VBR0306). Depende de `frota.json`, `km-real.json` e `cco.json` já gerados.

Remessas do cliente: 28/10/2026 (agosto e setembro), 19/11/2026 (janeiro a 19 de novembro de 2026, mesmos onze arquivos, com o VBM0805 de agosto corrigido) e 23/11/2026 (`M04 - Litros_kwh.xlsx`, aba VBM0406: consumo de 01/01 a 17/11/2026; prefixos fora da frota ativa são ignorados e listados pelo script). A abrangência fica em `WINDOW` no topo do `gen_real2.py`; as datas podem vir como número do Excel ou como texto `dd/mm/aaaa`.

As regras seguem a carta da Transppass de 28/10/2026 ("Lista dos Arquivos"): frota = STATUS 0/7/17 sem desligamento; prefixo = 81/80 + carro; hodômetro = KM CHASSI menos a rodagem; quebra para MKBF = ficha A, S ou T; preventiva = KM LIM > 0; perdidas = VPOpe − V_moni.

Os JSON gerados contêm dados do cliente (placas, chassi, RENAVAM, matrículas, nomes de motoristas, texto das ocorrências e das fichas) e por isso não entram no repositório por padrão.
