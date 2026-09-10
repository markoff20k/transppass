# Relatório de QA — Transppass PCM (MVP: R0 + R1 + R2)

**Rodada:** 09/09/2026 · **Ambiente:** modo mock (MSW) no Microsoft Edge, sem banco · **Resultado:** 47 verificações funcionais de UI, 47 aprovadas · typecheck, lint e build do monorepo limpos.

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
4. **API** — `apps/api/test/r1-flow.e2e.ts` cobre o ciclo completo (R1: 25 verificações; R2: 27 verificações adicionadas nesta rodada). **Não rodou**: não há Postgres acessível nesta máquina (serviço Docker parado, senha do PG local desconhecida). O teste compila e está pronto para `npm run test:e2e`.

## 3. Resultado funcional (mock)

| Grupo | Verificações | Situação |
| --- | --- | --- |
| Autenticação | login renderiza; senha errada é recusada; login válido cai no dashboard | 3/3 |
| Shell | sidebar/header/subheader; recolher 264→72 px e expandir; tema escuro; idioma EN; notificações | 5/5 |
| Dashboard | 4 KPIs com valor; grade de ônibus ilustrados; gráficos Recharts; bloco de atenção | 4/4 |
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

Defeitos de UI corrigidos antes desta rodada (já em commits anteriores): layout do shell sobrescrito por CSS antigo, header no rodapé, rodas do ônibus orbitando, pneus invisíveis no escuro, badges de larguras diferentes, edição inline em vez de painel lateral.

## 5. O que NÃO foi testado (e o risco)

| Lacuna | Risco | Como fechar |
| --- | --- | --- |
| **API contra Postgres** (R1 e R2) | Alto. Portões de encerramento, relógio de parada por causa, fila append-only, travas RN-10 e bloqueio RF-30 só existem como código compilado. | Subir Postgres (`COMO-RODAR.md`, Caminho A ou B), `npm run db:migrate && npm run db:seed`, `npm run test:e2e`. |
| Mock ≠ API | Médio. O MSW espelha os contratos de `packages/shared`, mas não a lógica de estado. Uma tela pode passar no mock e receber outro código de erro da API. | O e2e acima. |
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

Do ponto de vista de **interface e experiência**, o MVP está completo e consistente: todas as telas do PRD existem, seguem o design kit, respondem a 390 px sem quebrar, e os bloqueios de negócio visíveis ao usuário (motivo obrigatório, placa, km, travas da preventiva) acontecem na origem. Do ponto de vista de **regra de negócio no servidor**, o parecer é **condicional**: o código está escrito e testável, mas a evidência de execução contra banco ainda não existe. A primeira ação da próxima sessão deve ser `npm run test:e2e` com o Postgres de pé.
