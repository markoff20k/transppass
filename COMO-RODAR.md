# Como rodar o sistema

Guia de primeira execução do Transppass — Módulo PCM. Se você já rodou uma vez, pule para [Rotina do dia a dia](#rotina-do-dia-a-dia).

## Atalho: rodar sem banco (modo mock)

Para ver o sistema funcionando **agora**, sem PostgreSQL, sem Docker e sem backend:

```bash
npm install        # se ainda não rodou
npm run dev:mock
```

Abra http://localhost:5173 e entre com `admin@transppass.local` / `admin123`. As mesmas credenciais da tabela do passo 4 valem aqui.

### O que o mock faz

Um service worker ([MSW](https://mswjs.io)) intercepta as chamadas HTTP dentro do navegador e responde com dados em memória. O front roda inteiro: login, painel da frota, lançamento de km, cadastro de carro e catálogo de falhas.

A carga inicial espelha o seed, com uma diferença proposital: os carros já têm histórico de quilometragem, e o carro **10003 está sem leitura há 5 dias** — é o caso de projeção degradada do RF-14, para a tela ter o que destacar.

### O que o mock NÃO cobre

Importante antes de tirar conclusões do que você vê na tela:

- **A API não roda.** Nada de NestJS, Prisma ou Postgres. Bugs de serviço, de query ou de transação não aparecem aqui.
- **Nada persiste.** Recarregar a página descarta tudo e volta à carga inicial.
- **A autenticação é de mentira.** O token é uma string opaca, sem assinatura, sem expiração e sem rotação de refresh. Toda a lógica real de JWT está na API e não é exercitada.
- **Autorização por perfil só muda o menu.** No mock não há `RolesGuard` recusando chamada.

O que **é** genuinamente exercitado: os schemas Zod de `@app/shared` validam a entrada nos handlers, e a classificação de delta de quilometragem chama a mesma `classifyOdometerDelta` que a API chama. Se a validação passar no mock, ela passa na API — é o benefício de manter o contrato num pacote compartilhado.

O MSW é dependência de desenvolvimento e fica **fora do bundle de produção**: o import só acontece quando `VITE_MOCK=true`, definido em `.env.mock` e carregado apenas com `--mode mock`.

### Quando o banco estiver de pé

Volte para `npm run dev`, que sobe a API de verdade contra o Postgres. O modo mock é um atalho para desenvolver telas sem depender da infra, não um substituto do ambiente completo.

---

## Pré-requisitos

| Requisito | Versão | Como conferir |
| --- | --- | --- |
| Node.js | 20 ou superior | `node -v` |
| npm | 10 ou superior | `npm -v` |
| PostgreSQL | 14 ou superior | local ou via Docker — veja o passo 2 |

Git e Docker são opcionais: o Docker só é necessário se você escolher o caminho do container para o banco.

---

## Passo 1 — Instalar dependências

```bash
cd C:\Users\jefer\transppass-pcm
npm install
```

O monorepo usa npm workspaces: um único `npm install` na raiz instala `apps/api`, `apps/web`, `packages/shared` e `packages/config` de uma vez. **Não rode `npm install` dentro das pastas dos apps.**

---

## Passo 2 — Preparar o banco

Escolha **um** dos dois caminhos.

### Caminho A — PostgreSQL instalado na máquina (recomendado nesta máquina)

Esta máquina já tem um `postgresql-x64-17` rodando como serviço do Windows na porta **5432**. Usar ele evita depender do Docker.

Crie o banco (vai pedir a senha definida na instalação do PostgreSQL):

```bash
& "C:\Program Files\PostgreSQL\17\bin\createdb.exe" -U postgres -h localhost transppass_pcm
```

> Se `createdb` não existir nesse caminho, confira a pasta de instalação em `C:\Program Files\PostgreSQL\`. Alternativa pelo psql:
> `& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -h localhost -c "CREATE DATABASE transppass_pcm;"`

### Caminho B — PostgreSQL via Docker

Abra o **Docker Desktop** e espere o ícone da baleia ficar verde (na primeira execução ele pode pedir elevação de administrador ou aceite de termos — sem isso o serviço `com.docker.service` não sobe e o `docker` na linha de comando falha). Depois:

```bash
npm run db:up
```

O container sobe na porta **5433**, de propósito: a 5432 já está ocupada pelo PostgreSQL local desta máquina.

---

## Passo 3 — Configurar o `.env`

```bash
cp .env.example .env
```

Abra o `.env` e ajuste o `DATABASE_URL` conforme o caminho escolhido no passo 2:

```bash
# Caminho A — PostgreSQL local (porta 5432)
DATABASE_URL="postgresql://postgres:SUA_SENHA@localhost:5432/transppass_pcm?schema=public"

# Caminho B — Docker (porta 5433)
DATABASE_URL="postgresql://app:app@localhost:5433/app?schema=public"
```

**Gere segredos JWT de verdade** antes de qualquer ambiente que não seja a sua máquina:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Rode duas vezes e cole os valores em `JWT_ACCESS_SECRET` e `JWT_REFRESH_SECRET`. Os valores do `.env.example` são placeholders e a API recusa segredos com menos de 16 caracteres.

O `.env` fica na raiz e é lido pelos dois apps: a API pelo `ConfigModule` e o front pelo Vite (só as variáveis com prefixo `VITE_`). Ele está no `.gitignore` — nunca comite.

---

## Passo 4 — Criar as tabelas e a carga inicial

```bash
npm run db:migrate    # cria as 47 tabelas do modelo
npm run db:seed       # carga inicial
```

O seed cria:

- **Garagem** `G01`
- **Usuários** — veja as credenciais abaixo
- **5 especialidades** de manutenção (mecânica, elétrica, funilaria, pneus, ar-condicionado)
- **Catálogo de falhas v1 (rascunho)** com 6 itens partindo dos campeões do ranking IIO citados no PRD
- **14 códigos de motivo** distribuídos nas cinco listas do RF-33
- **5 carros de exemplo** — 3 diesel (km manual) e 2 eBUS (telemetria)
- **Plano preventivo diesel** com os pacotes de 7.500 e 15.000 km

> As flags de fast-track/segurança do catálogo e o conteúdo das listas de códigos são **propostas**, não verdade. São questões abertas da seção 12 do PRD, a fechar com PCM, Manutenção, Estoque e Operação antes do R1.

### Credenciais do seed

| E-mail | Senha | Perfil |
| --- | --- | --- |
| `admin@transppass.local` | `admin123` | Administrador |
| `pcm@transppass.local` | `transppass123` | PCM |
| `cco@transppass.local` | `transppass123` | CCO |
| `plantao@transppass.local` | `transppass123` | Plantão |
| `manutencao@transppass.local` | `transppass123` | Manutenção |
| `estoque@transppass.local` | `transppass123` | Estoque |

Cada perfil enxerga um menu diferente — é assim que a autoridade de área vira permissão de sistema (RF-36).

---

## Passo 5 — Subir o sistema

```bash
npm run dev
```

Sobe os três processos em paralelo, com log colorido por origem:

| Processo | Endereço |
| --- | --- |
| `web` — front React | http://localhost:5173 |
| `api` — backend NestJS | http://localhost:3000/api |
| `shared` — compilação dos contratos em watch | — |

Documentação interativa da API (Swagger) em **http://localhost:3000/api/docs**, disponível fora de produção.

Em desenvolvimento o Vite faz proxy de `/api` para a API, então o front não lida com CORS nem precisa de URL absoluta.

Acesse http://localhost:5173 e entre com `admin@transppass.local` / `admin123`.

---

## Roteiro para conferir que está funcionando

1. **Painel da frota** (tela inicial) — 5 carros do seed, todos sem leitura de km ainda. Os KPIs do topo mostram frota total, disponíveis e disponibilidade.
2. **Lançamento de km** — só os 3 carros diesel aparecem; os eBUS são lidos por telemetria (RF-15), não por digitação. Preencha e envie.
3. **Volte ao painel** — o km atual aparece preenchido nos carros lançados.
4. **Teste a validação** — volte ao lançamento, escolha a data de amanhã e digite um valor absurdo (uns 5.000 km acima do anterior). A linha fica vermelha e o botão avisa antes do envio: é o `classifyOdometerDelta` rodando no navegador com exatamente o mesmo critério que o servidor aplicaria.
5. **Cadastros → Catálogo de falhas** — os 6 itens com as flags de segurança e fast-track, mais as cinco listas de códigos de motivo.
6. **Saia e entre como `pcm@`** — o menu muda conforme o perfil.

---

## Rotina do dia a dia

```bash
npm run dev            # sobe tudo
npm run build          # build de produção (shared → api → web)
npm run typecheck      # tsc em todos os workspaces
npm run lint           # ESLint no monorepo inteiro
npm run db:studio      # Prisma Studio, para inspecionar o banco no navegador
```

Rodar só um dos apps:

```bash
npm run dev:api
npm run dev:web
```

### Depois de mexer no schema do Prisma

```bash
npm run db:migrate     # cria a migration e aplica
```

O `migrate dev` já regenera o client. Se precisar regenerar sem migrar (após um `git pull`, por exemplo):

```bash
npm run db:generate
```

### Depois de mexer em `packages/shared`

Nada — o `npm run dev` mantém o pacote em watch e recompila sozinho. Fora do modo dev, rode `npm run build -w @app/shared`.

---

## Problemas comuns

**`docker compose up` falha com "error during connect ... dockerDesktopLinuxEngine"**
O Docker Desktop não está rodando ou o serviço `com.docker.service` está parado. Abra o Docker Desktop e espere ficar verde. Se o serviço continuar parado, ele provavelmente precisa de elevação de administrador na primeira execução. Alternativa: use o Caminho A do passo 2.

**`port is already allocated` ao subir o container**
A porta 5433 está ocupada. Mude o mapeamento no [docker-compose.yml](docker-compose.yml) e ajuste o `DATABASE_URL` no `.env` para a mesma porta.

**`Can't reach database server` no `db:migrate`**
Confira se o serviço do PostgreSQL está de pé e se a porta do `DATABASE_URL` bate com a do passo 2 — 5432 para o local, 5433 para o Docker. Os dois podem coexistir; é fácil apontar para o errado.

**`password authentication failed for user "postgres"`**
Senha errada no `DATABASE_URL`. É a senha definida na instalação do PostgreSQL, não a do Windows.

**`File '@app/config/tsconfig.base.json' not found`**
Os links dos workspaces quebraram — acontece se a pasta do projeto for renomeada ou movida, porque no Windows os junctions guardam caminho absoluto. Corrija com:

```bash
rm -rf node_modules && npm install
```

**`"isApiErrorBody" is not exported by "packages/shared/dist/..."`**
O pacote compartilhado não foi compilado, ou foi compilado só num dos formatos. Ele gera CommonJS (consumido pelo Nest) e ESM (consumido pelo Vite):

```bash
npm run build -w @app/shared
```

**A API sobe mas toda rota devolve 401**
Esperado: todas as rotas são protegidas por padrão. Autentique em `POST /api/auth/login` e mande o `accessToken` no header `Authorization: Bearer ...`. No Swagger, use o botão **Authorize**.

**`JWT_ACCESS_SECRET muito curto` ao subir a API**
Os segredos do `.env` precisam de no mínimo 16 caracteres. Gere os seus conforme o passo 3.

---

## Estrutura, em uma olhada

```
transppass-pcm/
├─ apps/
│  ├─ api/          NestJS + Prisma + JWT        → :3000
│  │  ├─ prisma/    schema.prisma e seed
│  │  └─ src/       auth, users, vehicles, odometer, catalog
│  └─ web/          React 19 + Vite + TS         → :5173
│     └─ src/       pages, features, components, lib
├─ packages/
│  ├─ shared/       schemas Zod + tipos (a ponte entre os dois)
│  └─ config/       tsconfig base
├─ .env             configuração local (não versionado)
└─ docker-compose.yml
```

`apps/web` e `apps/api` **nunca se importam** — conversam por HTTP e compartilham apenas `@app/shared`. É o que permite separá-los em repositórios distintos mais adiante sem refatoração.

Para as decisões de arquitetura e o estado do backlog por release, veja o [README.md](README.md).
