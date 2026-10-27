# Relatório de QA — Transppass PCM (MVP: R0 + R1 + R2)

**Rodada:** 20/10/2026 (madrugada da apresentação) · **Ambiente:** Microsoft Edge dirigido por puppeteer **contra a API real** no Postgres local — frota de 453 carros, bases da Transppass carregadas e simulador de demonstração ligado · **Resultado:** 86 verificações funcionais de UI, 86 aprovadas (`QA_API=1 node tools/qa-smoke.mjs`; rodada de 27/10 inclui Técnicos, Daily, Checklist diário, Qualidade de peças, Fornecedores, Auditorias, Vida de componentes e a página do carro); teste e2e da API 78/78 com a nova base; typecheck, lint e build de produção limpos. A rodada anterior (19/10, modo mock) continua válida e o roteiro ainda roda nos dois modos.

Este relatório é o que um analista de QA entregaria ao fim da sprint: o que foi testado, como, o que passou, o que foi corrigido no caminho e — mais importante — **o que ainda não foi exercitado** e por quê.

## 1. Escopo

| Release | Épicos | Cobertura desta rodada |
| --- | --- | --- |
| R0 — Fundações | E7 cadastros, frota, km, permissões | UI funcional (mock) + tipos |
| R1 — Corretivo e execução | E1, E2, E4, E5 | UI funcional (mock) + tipos; API com teste e2e pronto, **não executado** |
| R2 — Preventiva e Plantão | E3, E6 | UI funcional (mock) + tipos; API com teste e2e pronto, **não executado** |
| Fase 2 | RF-16, RF-40, RF-41 | Fora do MVP — não testado |

## 2. Como foi testado

1. **Estático** — `npm run typecheck` (api, web, shared, design-kit), `npx eslint .`, `npm run build`. Tudo limpo.
2. **Funcional de UI, automatizado** — `node tools/qa-smoke.mjs` dirige o Edge real (puppeteer-core) contra `npm run dev:mock`. Cada passo é uma asserção sobre o DOM, não sobre uma captura. Saída em `tools/QA-RESULTADO.json` e 26 capturas em `tools/qa-shots/`.
3. **Visual, manual** — capturas em 1440 px (claro e escuro) e 390 px de todas as telas, revisadas uma a uma para layout, contraste, alinhamento e badges.
4. **API contra Postgres** — `apps/api/test/r1-flow.e2e.ts`, **78 verificações, 78 aprovadas, zero erros no log do servidor**, contra o Postgres local (porta 5433) com o schema sincronizado por `db:push` e os seeds base + demonstração. Cobre R1 (portões, relógio, fila, MKBF), R2 (travas da preventiva, habilitação da reserva), planos/kits/materiais, snapshots, recuperação de senha e a codificação de falhas (posição validada contra o subsistema, regras de criticidade, alinhamento).

## 3. Resultado funcional (mock)

| Grupo | Verificações | Situação |
| --- | --- | --- |
| Autenticação | login renderiza; senha errada é recusada; login válido cai no dashboard | 3/3 |
| Shell | sidebar/header/subheader; recolher 264→72 px e expandir; interruptor de tema (ida e volta); bandeira de idioma (ida e volta); notificações; avatar abre Meu perfil (foto + senha); botão Sair no rodapé da sidebar | 9/9 |
| Dashboard | anel de disponibilidade + 3 KPIs; grade de ônibus ilustrados; gráficos Recharts; fichas de atenção; fluxo da garagem com 6 etapas clicáveis | 5/5 |
| Rotas | 14 telas renderizam com o título correto no subheader | 14/14 |
| Fila (RF-08) | painel lateral abre; histórico imutável; **mover sem motivo fica bloqueado**; Esc fecha | 4/4 |
| Triagem (RF-02/03) | painel com os três destinos (socorro, fila, deferir) | 1/1 |
| Estoque (RF-21) | painel da solicitação; **badges de status com largura uniforme** | 2/2 |
| Preventiva (RF-10/11/12) | painel programar parada; painel da parada com travas (kit + equipe) e escopo | 2/2 |
| Plantão (RF-29/31) | janela em contagem regressiva; painel da demanda | 2/2 |
| OS (RF-19/20) | portões e relógio de parada; painel de nova sub-OS | 2/2 |
| Frota (RF-35) | painel de novo carro; **placa inválida recusada na origem**; carro válido criado | 3/3 |
| Km (RF-15) | delta absurdo sinalizado antes do envio | 1/1 |
| Responsivo | 390 px sem rolagem horizontal; gaveta abre no celular; Esc fecha | 3/3 |
| Consistência | zero erros de JavaScript e zero respostas HTTP ≥ 400 inesperadas em todo o roteiro | 1/1 |

## 4. Defeitos encontrados e corrigidos nesta rodada

| # | Onde | Defeito | Correção |
| --- | --- | --- | --- |
| 1 | `packages/shared` (Zod) | Campo numérico **opcional** vazio (`Ano` do carro, `Tempo estimado` do catálogo) chegava como `''`, era coagido para `0` e reprovava no `min()`. Impedia criar carro sem informar o ano. | Helper `optionalNumber()` transforma `''`/`null` em `undefined` antes da coerção. Vale para tela e API. |
| 2 | `apps/web/index.html` | Sem favicon — 404 em toda carga de página. | Favicon SVG com a marca (grafite + laranja) e `theme-color`. |
| 3 | `apps/api/prisma/seed.ts` | Lookup de material podia retornar `undefined` e passar em silêncio para o Prisma. | Lookup estrito que falha com mensagem clara. |
| 4 | `tools/qa-smoke.mjs` | O roteiro clicava na primeira linha da fila (em execução, sem "Mover") e o 401 esperado do teste de senha errada contava como erro. | Escolhe uma linha aguardando; erros HTTP rastreados por URL, ignorando só o login negativo. |
| 5 | `work-orders.service.ts` (findOne) | `id: { in: [...assigneeIds, releasedById ?? ''] }` mandava string vazia como UUID; o Postgres recusava e **todo detalhe de OS com sub-OS respondia 500**. Invisível no mock. | Só ids reais entram na lista. |
| 6 | `packages/shared` (codificação) | Posição fora do tipo do subsistema (ex.: `FD` em Arrefecimento, que não tem posição) era aceita. | `positionRefinement` nos schemas de evento, triagem, desfecho e sub-OS. |
| 7 | Banco local | Tabelas do R2 nunca criadas; o agendador novo falhava a cada 5 min. `prisma` lia `apps/api/.env`, inexistente. | `scripts/with-env.cjs` carrega o `.env` da raiz para `db:push`, `db:seed`, `db:seed:demo`, `test:e2e`. |

Defeitos de UI corrigidos antes desta rodada (já em commits anteriores): layout do shell sobrescrito por CSS antigo, header no rodapé, rodas do ônibus orbitando, pneus invisíveis no escuro, badges de larguras diferentes, edição inline em vez de painel lateral.

## 4b. Rodada 20/10 — carga real, frota de 453 carros e simulador

O que mudou desde a rodada de 19/10 e foi exercitado nesta:

- **Carga das bases da Transppass** (`npm run db:seed`): 2.496 materiais com classe, referência, prateleira, saldo e custo; 907 motoristas (CNH e classes permitidas); 864 cobradores por lote; 47 ferramentas da FR.168; planos preventivos por modelo (IT.MAN-01, -54, -60, -16) com gatilho offset+intervalo, tolerância dupla, tarefas por seção e kits cruzados com o inventário.
- **Frota mock de 453 carros** (`npm run db:seed:demo`) nas proporções da Escala de Carros, com classe, lote e papel (operacional/reserva). Dashboard e painel da frota foram redesenhados para essa escala: os que rodam viram um cartão-resumo; a grade pagina de 60 em 60; filtros por classe e lote; seleção com busca para carros, operadores e materiais.
- **Simulador vivo** (`DEMO_SIMULATOR=true`): a cada 5 min, pela própria API de negócio, lança telemetria e km manual, abre falhas, tria, despacha socorro, tira OS da fila, pede material, inspeciona, limpa, libera e designa reserva. Validado em modo acelerado (`DEMO_SPEED=12`): o ciclo falha → triagem → socorro/oficina → liberação fechou ponta a ponta no log, sem exceções.

| # | Onde | Defeito | Correção |
| --- | --- | --- | --- |
| 8 | Painel da frota | "Projeção degradada" sem explicação; 13 carros em alerta porque o seed envelhecia. | Conceito renomeado para **odômetro atrasado**, tooltip "i" com a regra do RF-14, rodapé do card com a idade da leitura e atalho "lançar km"; o simulador mantém as leituras vivas. |
| 9 | `scheduling.service.ts` | Pacotes por tempo (intervalo 0) geravam `Invalid time value` e o `/scheduling/timeline` respondia 500. | Pacotes por dias ficam fora da linha do km; `daysToWindow` só quando finito. |
| 10 | KPI (`design-kit`) | `overflow: hidden` cortava o balão do "i" nos cartões de KPI. | Foco de cor passou a gradiente interno; card sem overflow. |
| 11 | Planos | Tabela de tarefas invadia a coluna do kit com descrições longas. | `table-layout: fixed` com larguras por coluna nas duas tabelas do pacote. |
| 12 | Seed de demonstração | Placas geradas por hash colidiam; a Escala repete a linha "ePadron 15M" e o total dava 554. | Placa única por índice; 71 + 30 ePadron divididos entre 13M e 15M (assumido) — total 238 + 215 = 453. |
| 13 | Importador | Filtros entravam como "L" por conter "OLEO" na descrição; classe grudada na descrição em 3 itens. | Unidade por prefixo (FILTRO, BOMBA…) e separação da classe no parse por coordenadas do PDF. |
| 14 | `tools/qa-smoke.mjs` | Roteiro assumia dados do mock (carro 10099, token de redefinição fixo, fila com a 1ª linha em espera, demanda aberta do seed). | Modo `QA_API=1`: prefixo/placa únicos e carro desativado ao final, link de redefinição real gerado pelo admin e senha devolvida, OS escolhida pelo estado, demanda criada e cancelada pelo próprio roteiro. |

## 4c. Rodada 27/10 — Kaizen MKBF como base do sistema

- **Modelo para os itens que estavam em lacuna**: kit corretivo por falha do catálogo (pedido inteiro ao Estoque a partir da sub-OS), ferramental por tarefa do plano (FR.168), OS executada por terceiro com fornecedor, técnicos e inspetores por especialidade, tecnologia e nível 1–3 com atribuição na sub-OS.
- **Carga**: 357 vínculos tarefa × ferramenta no diesel, 6 kits corretivos cruzados com o inventário, 16 técnicos (mock até a lista da Manutenção) e uma OS de terceiro de exemplo.
- **Tela da OS guiada** (20/10, noite): "próximo passo" com um botão e caminho de cinco etapas; o botão "Inspecionar" passou a aparecer também na sub-OS já encaminhada à inspeção.

## 4d. Rodada 27/10 (tarde) — o Kaizen rodando no sistema

Base: A3 "Kaizen Estruturante" (03/06/2026) e "Fluxos de Processo PCM" Rev. 00 (08/2026), p.8 "Manutenção diária".

- **Checklist diário** (`/checklist`): itens por tecnologia; reprovação abre evento corretivo no código composto (verificado: carro 82006, item Limpadores → EV-2026-002488 na triagem). Reporte de anomalia pelo motorista na mesma tela.
- **Daily 15 min** (`/daily`): `GET /metrics/daily` com os cinco KPIs do A3 §9, falhas da semana, carros reincidentes (≥ 2 retornos em 30 dias) e rotina do dia.
- Rotas novas no roteiro de QA; a tela Kaizen MKBF (painel sobre o Kaizen) foi removida a pedido: o Kaizen roda no sistema, não numa página.

## 4f. Rodada 28/10 — a frota como produto

- **Render do ônibus por classe** (`BusRender`): vista lateral em estilo de produto com variantes Básico 12M, Padron 13M, ePadron 13M/15M, Articulado 18M, Biarticulado 23M e elétricos; galeria no design kit. Capturas conferidas em 2x: adesivos no maior vão livre entre as portas, três eixos no 15M, sanfona nos articulados.
- **Cards da frota** com chip de estado, barra até a próxima preventiva (`nextPackageName`/`kmToNextPackage` no `GET /vehicles/panel`), motorista do checklist de hoje ou OS aberta; o card abre o carro.
- **Página do carro** (`/frota/:id`, `GET /vehicles/:id/overview`): KPIs de 30 dias, render grande com ficha, manutenção (preventiva + vida de componentes), km por dia, ocorrências e OS. Conferida em 1440 px e 390 px (overflow do render corrigido com `minmax(0, 1fr)`).
- Dashboard usa o mesmo render nos cards de "A frota agora". Novo check VEH-00 no roteiro.

## 4e. Rodada 27/10 (noite) — laboratório de peças, fornecedores, auditorias e treinamentos

- **Qualidade de peças** (`/qualidade-pecas`) e **Fornecedores** (`/cadastros/fornecedores`): 19 fornecedores derivados da referência de fabricante do inventário (SLA de garantia ASSUMIDO), materiais vinculados, 5 inspeções de exemplo; reclamação de garantia muda na própria tabela (`PATCH /quality/part-inspections/:id`).
- **Auditorias** (`/auditorias`): `POST /audits` com os dez critérios → nota 80% na Ferramentaria, próxima data +30 dias, "auditorias devendo" caiu de 6 para 5 no resumo e na Daily. Seed com três meses de 5S nas quatro áreas do roadmap (trajetória de ~50% para ~75%) e conformidade trimestral nas três primeiras.
- **Treinamentos**: `POST /technicians/:id/trainings` (NR-10 + alta tensão) tirou o técnico 70093 da sinalização "sem alta tensão"; listagem de técnicos passa a trazer treinamentos, vencimentos em 30 dias e a lacuna de alta tensão.
- **Checklist diário no seed**: 292 dos 453 carros com checklist de hoje, para a Daily nascer preenchida.
- Capturas conferidas em 1440 px: laboratório (tabela em largura cheia, motivo com quebra de linha), fornecedores, auditorias (card por área com tendência, última e próxima data), técnicos e Daily.
- **Vida de componentes** (`/componentes`, `GET/POST /components`): carga inicial para toda a frota (compressor, turbina, bicos, cubos, motor de partida, alternador, baterias de tração), com histórico de trocas; registrar a troca encerra o anterior com a vida real e abre o novo no km do carro. Contagem "além da vida" na Daily.
- **Kanban** (`GET /materials/kanban`): ponto de pedido e lote no cadastro do material (ASSUMIDOS a partir do saldo); lista "Kanban — repor" no Estoque com fornecedor, SLA e pedidos abertos; contagem na Daily. **Carregadores eBUS** entram no ferramental (34 baias necessárias × 32 disponíveis, ASSUMIDO) e aparecem em vermelho na suficiência.

## 5. O que NÃO foi testado (e o risco)

| Lacuna | Risco | Como fechar |
| --- | --- | --- |
| Mock ≠ API | **Fechado em 20/10:** o roteiro de UI roda contra a API real (`QA_API=1`) e passa 78/78. | — |
| Base carro a carro | Prefixos, placas, modelos por classe e ano da frota são mock (a Escala só traz totais). Planos por modelo só casam com o campo "modelo" do carro. | Carregar a base real de veículos quando a Operação enviar. |
| Tarefas dos planos | Estrutura (pacotes, gatilhos, tolerâncias, kits) vem dos IT.MAN; a lista de tarefas é síntese das seções e precisa ser conferida item a item com a Manutenção. | Revisão conjunta com Manutenção antes de virar escopo de parada. |
| Valores de SLA e fórmula de criticidade | Médio. Marcados como ARBITRADO no código; o PRD não os fixa. | Definição com PCM + Manutenção. |
| Especificação MVP v1.1 (RN-01…16, P-01…10) | Médio. Não está no repositório; as regras RN foram implementadas pelo resumo do PRD. | Anexar o documento e revisar regra a regra. |
| Integração com telemetria / API do JB (km) | Baixo no MVP. Só o lançamento manual está exercitado. | Fase seguinte. |
| Acessibilidade com leitor de tela | Baixo. Foco, Esc e contraste foram checados; navegação por leitor não. | Rodada dedicada com NVDA. |
| Carga / concorrência | Não avaliado. | Fora do MVP. |

## 6. Ambiente e reprodução

```bash
npm install
npm run dev:mock            # web em http://localhost:5173, sem banco
node tools/qa-smoke.mjs     # roteiro funcional (precisa do Edge)
node tools/screenshot.mjs 1440 dark   # capturas avulsas
```

Credenciais do mock: `admin@transppass.local` / `admin123` (demais personas em `COMO-RODAR.md`).

## 7. Parecer

Do ponto de vista de **interface e experiência**, o MVP está completo e consistente: todas as telas do PRD existem, seguem o design kit, respondem a 390 px sem quebrar, e os bloqueios de negócio visíveis ao usuário (motivo obrigatório, placa, km, travas da preventiva) acontecem na origem. Do ponto de vista de **regra de negócio no servidor**, o parecer passa a ser **favorável**: o ciclo completo rodou contra Postgres (78/78) sem erro no log. A rodada real revelou um defeito que o mock escondia — `findOne` da OS enviava `''` como UUID ao buscar quem liberou o carro (corrigido) — e um buraco de validação no padrão de codificação (posição fora do tipo do subsistema era aceita; agora recusada no Zod compartilhado, tela e API). Pendências restantes são de definição com o cliente (flags de criticidade, SLAs, Especificação MVP v1.1), não de código.
