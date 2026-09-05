# Transppass — Módulo PCM

Sistema de gestão de manutenção e operações da frota, conforme o PRD v1.0 (ProAero, agosto de 2026).

Monorepo React + TypeScript / NestJS, estruturado para que front e back possam ser separados em repositórios distintos sem refatoração.

## Estado atual

| Release | Escopo do PRD | Situação |
| --- | --- | --- |
| **R0 — Fundações** | Cadastros (E7), frota, permissões, entrada de km (RF-14/15), painel da frota | **Implementado** |
| **R1 — Corretivo e execução** | E1, E2, E4, E5 — evento → triagem → fila → OS → portões → liberação | **Implementado, não validado contra banco** |
| R2 — Preventiva e Plantão | E3, E6 | Modelado no banco, sem API/telas |
| Fase 2 | RF-16, RF-40, RF-41 | Fora do MVP |

O schema Prisma já cobre **os oito épicos** — o R2 acrescenta serviços e telas sobre um modelo de dados que não vai precisar mudar.

> **O R1 ainda não rodou contra um banco.** Compila, o lint passa e as 65 rotas sobem com o grafo de dependências resolvido, mas a máquina de estados (portões, relógio, fila) não foi exercitada. O teste que faz isso está pronto em `apps/api/test/r1-flow.e2e.ts` — rode `npm run test:e2e` com a API no ar assim que o Postgres existir.

## Estrutura

```
apps/
  api/        NestJS + Prisma + JWT       → deploy independente
  web/        React 19 + Vite + TS        → deploy independente
packages/
  shared/     schemas Zod + tipos         → único ponto de acoplamento
  config/     tsconfig base compartilhado
```

**A regra que garante a separação futura:** `apps/web` e `apps/api` nunca se importam. Conversam por HTTP e compartilham apenas `@app/shared`. Para dividir, cada app vira um repo e `@app/shared` vira um pacote num registry privado.

## Como rodar

O passo a passo completo — pré-requisitos, banco, `.env`, credenciais do seed, roteiro de verificação e problemas comuns — está em **[COMO-RODAR.md](COMO-RODAR.md)**.

Resumo, para quem já configurou o `.env` e o banco:

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev          # API :3000 e web :5173
```

Login inicial: `admin@transppass.local` / `admin123`. Swagger em `http://localhost:3000/api/docs`.

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
