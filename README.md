# Transppass — Módulo PCM

Sistema de gestão de manutenção e operações da frota, conforme o PRD v1.0 (ProAero, agosto de 2026).

Monorepo React + TypeScript / NestJS, estruturado para que front e back possam ser separados em repositórios distintos sem refatoração.

## Estado atual

| Release | Escopo do PRD | Situação |
| --- | --- | --- |
| **R0 — Fundações** | Cadastros (E7), frota, permissões, entrada de km (RF-14/15), painel da frota | **Implementado** |
| **R1 — Corretivo e execução** | E1, E2, E4, E5 — evento → triagem → fila → OS → portões → liberação | **Implementado e validado contra Postgres** (e2e) |
| **R2 — Preventiva e Plantão** | E3, E6 — linha do tempo por km, escopo pacote + backlog, kit D-1, equipe, reprogramação com motivo; demanda de reposição, reserva habilitada, retorno ao vivo | **Implementado e validado contra Postgres** (e2e) |
| Fase 2 | RF-16, RF-40, RF-41 | Fora do MVP |

O schema Prisma cobre **os oito épicos**; todas as telas do MVP existem em `apps/web` e rodam em modo mock. O QA funcional automatizado (`node tools/qa-smoke.mjs`, 78 verificações de UI) e o relatório em [QA.md](QA.md) registram o que foi exercitado.

> **A API roda contra Postgres e passa no ciclo ponta a ponta.** `npm run test:e2e` (com a API no ar) exercita 78 verificações em `apps/api/test/r1-flow.e2e.ts`: RF-05/06/08, portões e relógio da OS, MKBF, preventiva com travas, plantão com habilitação, planos/kits, snapshots, recuperação de senha e o padrão de codificação de falhas. A primeira rodada real encontrou e corrigiu um bug (lookup de usuário com UUID vazio no detalhe da OS) que o modo mock nunca pegaria.

## Estrutura

```
apps/
  api/          NestJS + Prisma + JWT       → deploy independente
  web/          React 19 + Vite + TS        → deploy independente
packages/
  shared/       schemas Zod + tipos         → único ponto de acoplamento
  design-kit/   tokens, temas, componentes  → sistema visual
  config/       tsconfig base compartilhado
```

**A regra que garante a separação futura:** `apps/web` e `apps/api` nunca se importam. Conversam por HTTP e compartilham apenas `@app/shared`. Para dividir, cada app vira um repo e `@app/shared` vira um pacote num registry privado.

## Como rodar

Para colocar em produção num servidor Ubuntu (DigitalOcean), siga [DEPLOY.md](DEPLOY.md).

O passo a passo completo — pré-requisitos, banco, `.env`, credenciais do seed, roteiro de verificação e problemas comuns — está em **[COMO-RODAR.md](COMO-RODAR.md)**.

Resumo, para quem já configurou o `.env` e o banco:

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev          # API :3000 e web :5173
```

Login inicial: `admin@transppass.local` / `admin123`. Swagger em `http://localhost:3000/api/docs`.

### Bases da Transppass e demonstração viva

`npm run db:seed` carrega, além do básico, as bases que a Transppass entregou no Kaizen "Projeto MKBF" (`apps/api/prisma/data/*.json`, extraídas dos PDFs): **2.496 materiais** do Almoxarifado com classe, referência, prateleira, saldo e custo (os 380 da lista preventiva marcados), **907 motoristas** com categoria de CNH e classes permitidas, **864 cobradores** por lote, **47 ferramentas** da FR.168 e os **planos preventivos por modelo** (IT.MAN-01 diesel, IT.MAN-54 Scania, IT.MAN-60 VW, IT.MAN-16 Eletra) com gatilhos, tolerância dupla, tarefas e kits cruzados com o inventário. Pode rodar quantas vezes quiser (`npm run db:seed:import` só a carga).

`npm run db:seed:demo` monta a garagem: **453 carros** nas proporções da Escala de Carros (lote E8 com 238, AR9 com 215; prefixos, placas e modelos por classe são mock até a base carro a carro chegar), seis meses de km e de falhas, OS em todas as etapas, preventivas programadas, plantão e notificações. Apaga e recria todo o movimento — rode antes de apresentar.

### O Kaizen no sistema

O Kaizen Estruturante (A3 de 03/06/2026) e os Fluxos de Processo PCM (Rev. 00, agosto/2026) são o desenho; o sistema é onde ele roda:

- **Daily de 15 min** (`/daily`): os cinco KPIs do A3 — MKBF, disponibilidade, taxa de retrabalho, viagens perdidas e número de OS — lidos ontem, na semana e no mês, com as falhas da semana, os carros reincidentes e a rotina do dia. Viagens perdidas usam as janelas de reposição estouradas até a Operação apurar.
- **Checklist diário de conservação** (`/checklist`, Fluxos p.8): faróis, limpadores, iluminação, avarias, pneus, portas e rampa, níveis; no eBUS, BTMS e carga. Item reprovado abre evento corretivo no código composto e segue para a triagem. Na mesma tela o motorista reporta anomalia durante o dia.
- Cadastros que o Kaizen exige: **kit corretivo por falha** (Catálogo; a sub-OS pede o kit inteiro ao Estoque), **ferramental por tarefa** (FR.168 × plano), **técnicos e inspetores** por especialidade, tecnologia e nível 1–3 (Cadastros › Técnicos; sub-OS atribuída ao técnico) e **OS executada por terceiro** com fornecedor.
- **Laboratório de inspeção de peças e fornecedores** (`/qualidade-pecas`, Cadastros › Fornecedores): toda peça reprovada no recebimento, com falha prematura ou em garantia é registrada com motivo, km em serviço e reclamação de garantia (aberta → aceita/negada); o material carrega fornecedor e garantia em meses/km; a tela mostra reincidência por fornecedor e o SLA de resposta.
- **Auditorias 5S mensal e de conformidade trimestral** (`/auditorias`, A3 §9): dez critérios por auditoria, nota calculada (nunca digitada), plano de ação, próxima data pelo calendário e trajetória por área. O que está devendo aparece na Daily.
- **Matriz de treinamentos** (Cadastros › Técnicos › editar): o que cada técnico fez e quando vence; quem atua em eBUS sem treinamento de alta tensão vigente fica sinalizado.
- **Kanban do almoxarifado** (Estoque › "Kanban — repor", A3): ponto de pedido e lote de reposição no cadastro do material; o que está no ponto ou abaixo aparece com fornecedor, SLA e pedidos abertos, e conta na rotina da Daily. Pontos e lotes atuais são ASSUMIDOS a partir do saldo até Suprimentos definir.
- **Carregadores eBUS como recurso** (Estoque › Ferramentas, Fluxos p.8): as baias de recarga entram no ferramental com quantidade necessária × disponível, como qualquer recurso do FR.168 — a insuficiência fica visível antes de faltar carga de manhã.
- **Vida de componentes por km** (`/componentes`): compressor, turbina, bicos, cubos, motor de partida, alternador e baterias de tração, carro a carro, com vida usada contra a esperada. A troca (por falha, preventiva ou garantia) encerra o componente anterior com a vida real que fez e reinicia o relógio do novo — é a corretiva "zerando" o item. A vida média real nas trocas, comparada à esperada, diz se a preventiva está no km certo. Vidas esperadas ASSUMIDAS até a Manutenção fixar por modelo.

Com `DEMO_SIMULATOR=true` no `.env` a garagem **anda sozinha** a cada 5 minutos pela própria API de negócio: telemetria dos eBUS, lançamento de km diesel de manhã (alguns atrasam), falhas na proporção do MKBF, triagem, socorro, fila, material, inspeção, limpeza, liberação e reposição com reserva habilitada. `POST /api/demo/pulse` (admin ou PCM) avança um ciclo na hora; `DEMO_SPEED=12` acelera os tempos de espera e `DEMO_ALL_HOURS=true` ignora o horário de operação (só para testes). Nunca ligue o simulador num banco com dados reais.

## Interface

Shell com **sidebar recolhível** (trilho de 72px no desktop, gaveta abaixo de 1024px), **header** com atalhos de idioma, tema, contraste, notificações e perfil, e **subheader** controlado por cada tela. A tela inicial é o **dashboard**: quatro números que resumem a garagem, o que precisa de atenção, a frota carro a carro e as tendências em gráfico.

O elemento de assinatura é o **render do ônibus** (`BusRender`): o carro da Transppass como um produto em estúdio, vista lateral com volumes, vidro com reflexo, rodas com aro e sombra no chão, na pintura da frota de São Paulo. A carroceria muda com a classe da Escala (Básico 12M, Padron 13M, ePadron 13M/15M, Articulado 18M, Biarticulado 23M e os elétricos com baterias no teto e tomada de recarga). O estado fica no chip do card; só as rodas giram em linha, e param com `prefers-reduced-motion`. O desenho técnico anterior continua no design kit.

O **Painel da frota** mostra cada carro num card com o render, o chip de estado, a barra até a próxima preventiva, km, média e o motorista ou a OS aberta. O card abre a **página do carro** (`/frota/:id`): disponibilidade, km, retornos e MKBF dos últimos 30 dias, o render grande com a ficha ao lado, o que vence primeiro (preventiva e vida dos componentes), km por dia e o histórico de ocorrências e OS.

Responsivo em três faixas: ≥ 1024px sidebar fixa; < 1024px gaveta sobre o conteúdo; < 640px header compacto, subheader empilha e toda ação vira alvo de largura cheia.

## Design kit

O sistema visual vive em [`packages/design-kit`](packages/design-kit/README.md). As duas cores saíram do logo institucional da Transppass — grafite `#444544` e laranja `#f87509` — e viram quatro camadas de tokens com tema claro e escuro.

Referência visual: **[artifact compartilhável](https://claude.ai/code/artifact/0beb3e1d-8f90-4dcb-ada4-f98154f6fcef)** · referência viva: rota `/design` no sistema.

**Achado que mudou o desenho:** branco sobre o laranja da marca dá 2,79:1 e reprova em AA. Por isso o kit separa `--color-brand` (preenche) de `--color-brand-text` (escreve), e o texto sobre o laranja é grafite escuro (6,45:1), nunca branco.

## Padrão de codificação de falhas

O registro, a triagem e a constatação (socorro e sub-OS) usam o código composto **Modo de Falha × Sistema/Subsistema (VMRS) × Posição** — ex. `IN-174-011-FD` — do documento [docs/Codificacao-de-Falhas_Proposta.pdf](docs/Codificacao-de-Falhas_Proposta.pdf) (Eng. de Confiabilidade, Garagem Jaguaré). As três listas (32 modos, 13 sistemas / 52 subsistemas, posições por tipo) vivem em `packages/shared/src/catalog/failure-codes.ts`, versionadas com o código; o PCM administra as **regras de criticidade** por combinação (fast-track, segurança, deferível) em Cadastros › Catálogo. Os itens do catálogo antigo viraram atalhos que pré-preenchem o código. O indicador "alinhamento origem × diagnóstico" (seção 8.2 do documento) é medido pelo sistema.

## Decisões de arquitetura ligadas ao PRD

**A OS-mãe é o único relógio de indisponibilidade** (RN-02). Tudo que prende o carro vira um `DowntimeSegment` com causa (fila, material, execução, inspeção, limpeza), então a decomposição do RF-39 e o MKBF do RF-38 saem dos próprios estados do processo — nunca de apuração manual.

**Autoridade vira permissão de sistema.** Não há auto-cadastro: perfis carregam autoridade de processo, contas são criadas pelo administrador e toda troca de perfil vira registro de auditoria (RF-36). Trocar a senha ou desativar a conta revoga as sessões abertas na hora.

**Registros de decisão são append-only.** `QueueChangeLog` (RF-08) e `AuditLog` (seção 8) só têm caminho de escrita — nenhum endpoint atualiza ou apaga. Códigos de motivo são desativados, nunca excluídos (RF-33), para que registros antigos continuem legíveis.

**O catálogo é versionado e a versão publicada é imutável** (RF-32). Um evento registrado sob a versão 3 continua apontando para a versão 3 mesmo depois da 4 entrar. Edição só acontece na versão rascunho.

**A validação de km mora no pacote compartilhado.** `classifyOdometerDelta` roda igual na tela e na API: o digitador vê a recusa antes de enviar, com o mesmo critério que o servidor aplicaria depois. O PRD trata a disciplina do lançamento diesel como o principal risco do R0 (seção 10), e a resposta é validar na origem.

**Ausência de lançamento gera sinal.** Sem leitura há mais de 2 dias, a projeção continua publicada mas marcada como degradada, e o PCM recebe notificação automática (RF-14). A degradação aparece no painel da frota, no mesmo lugar onde o PCM já olha.

**O offset de hodômetro preserva a série histórica.** A leitura crua fica gravada como está no painel do carro; `adjustedKm` aplica o offset. Trocar hodômetro não quebra o histórico nem a projeção.

## Autenticação

JWT próprio: access token de 15 min no header `Authorization`, refresh de 7 dias **hasheado com SHA-256** no banco e **rotativo** — cada uso revoga o anterior, e reapresentar um token já revogado derruba todas as sessões do usuário. Senhas em Argon2id. Toda rota é protegida por padrão (guard global); rotas abertas usam `@Public()`, autorização por perfil usa `@Roles()`.

No front, o `api-client.ts` intercepta 401, faz um único refresh compartilhado entre requisições concorrentes e repete o request.

## Pendências herdadas do PRD

Questões abertas (seção 12) e dependências (seção 9) que afetam o código:

- **Flags de fast-track e segurança do catálogo** — a estrutura existe e o seed traz uma proposta partindo do ranking IIO, mas a definição é de Manutenção + PCM antes do R1. Bloqueia RF-05 e RF-06.
- **Conteúdo das cinco listas de códigos de motivo** — o seed traz exemplos estruturais. O PRD registra que isso bloqueia as telas 6.3 e 6.4.
- **Valores de SLA** de triagem e socorro — `Triage.slaSeconds` já é gravado; falta o limite contra o qual comparar.
- **Escopo de espelhamento no JB** — `WorkOrder.jbWorkOrderNumber` reserva o vínculo; o que espelhar é decisão da controladoria.
- **Infraestrutura de hospedagem e backup** — o refresh de projeções está exposto como endpoint (`POST /api/odometer/projections/refresh`) em vez de agendador interno, justamente porque a plataforma ainda não foi definida.

Além disso, a **Especificação do MVP v1.1** (14 telas, regras RN-01 a RN-16, princípios P-01 a P-10) é referenciada pelo PRD mas não faz parte deste repositório. Ela é necessária para o R1: as regras RN definem os comportamentos exatos que o PRD só resume.

## Onde o R1 e o R2 entram

- `apps/api/src/events/`, `triage/`, `queue/`, `work-orders/`, `materials/` — módulos Nest sobre os modelos já existentes
- `packages/shared/src/<módulo>/` — schemas do módulo
- `apps/web/src/features/<módulo>/` — telas; as do chão (sub-OS, socorro, inspeção, limpeza) são mobile-first por exigência da seção 8
- `apps/web/src/routes.tsx` — rotas protegidas
