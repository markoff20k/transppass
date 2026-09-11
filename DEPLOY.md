# Instalação com Docker num droplet da DigitalOcean (Ubuntu 24.04 LTS)

Tudo em containers, a partir de [docker-compose.prod.yml](docker-compose.prod.yml):

| Serviço | Imagem | Faz o quê |
| --- | --- | --- |
| `postgres` | `postgres:16-alpine` | Banco, com os dados num volume (`pgdata`) |
| `api` | construída de [apps/api/Dockerfile](apps/api/Dockerfile) | API NestJS na porta 3000 (só na rede interna); sincroniza o schema ao subir |
| `web` | construída de [apps/web/Dockerfile](apps/web/Dockerfile) | nginx servindo o front e repassando `/api` para a API (rede interna) |
| `caddy` | `caddy:2-alpine` | Porta de entrada (80/443): HTTPS automático via Let's Encrypt para o domínio, repassando ao `web` |

Pré-requisito: um registro **A** do domínio (ex.: `transppass.online`) apontando para o IP do droplet — e, se quiser `www`, um CNAME `www` para o domínio (o Caddy emite o certificado dos dois e redireciona `www` para o endereço sem `www`). Substitua `SEU_IP` pelo IP público.

Cada bloco é para copiar e colar, na ordem. Linhas que começam com `#` são comentários.

---

## 1. Entrar no servidor e atualizar

No seu computador:

```bash
ssh root@SEU_IP
```

No servidor:

```bash
apt update && apt upgrade -y
apt install -y git curl ufw
```

## 2. Swap (o build das imagens precisa de memória; droplets de 1–2 GB agradecem)

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 3. Firewall

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

## 4. Docker (repositório oficial)

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker --version
docker compose version
```

## 5. Código

```bash
mkdir -p /opt/transppass && cd /opt/transppass
git clone https://github.com/markoff20k/transppass.git app
cd app
```

## 6. Variáveis de ambiente

Gere a senha do banco e os dois segredos do JWT (guarde as três saídas):

```bash
openssl rand -hex 24        # POSTGRES_PASSWORD (só letras e números: ela entra numa URL)
openssl rand -base64 48     # JWT_ACCESS_SECRET
openssl rand -base64 48     # JWT_REFRESH_SECRET
```

Crie o `.env` a partir do exemplo e preencha `POSTGRES_PASSWORD`, os dois `JWT_*_SECRET`, `DOMAIN` e `CORS_ORIGIN` (`https://` + o domínio):

```bash
cp .env.prod.example .env
nano .env
```

## 7. Construir e subir

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

O primeiro build leva alguns minutos. Acompanhe a API subindo (ela cria as tabelas e depois imprime `API em http://localhost:3000/api`):

```bash
docker compose -f docker-compose.prod.yml logs -f api
```

Saia do log com `Ctrl+C` e confira os quatro containers `running`/`healthy`:

```bash
docker compose -f docker-compose.prod.yml ps
```

## 8. Carga inicial (uma vez)

```bash
docker compose -f docker-compose.prod.yml exec api npm run db:seed
```

> O seed cria as personas com senha padrão (`admin@transppass.local` / `admin123` e as demais em `COMO-RODAR.md`). Troque as senhas assim que entrar — o sistema vai estar exposto na internet.

Para apresentar o sistema com uma garagem em movimento (13 carros, seis meses de histórico, fila, OS em todas as etapas, preventiva, plantão), rode também o **seed de demonstração**:

```bash
docker compose -f docker-compose.prod.yml exec api npm run db:seed:demo
```

> Ele apaga todo o movimento anterior (eventos, OS, fila, leituras, paradas, demandas) e recria o cenário. Cadastros e usuários ficam. Pode rodar de novo quando quiser "resetar" a demonstração — nunca com dados reais.

## 9. Conferir

```bash
docker compose -f docker-compose.prod.yml logs caddy | tail -20
curl -s -o /dev/null -w "%{http_code}\n" https://transppass.online/api/dashboard
```

No log do Caddy deve aparecer `certificate obtained successfully`; o `curl` responde `401` (rota protegida, API respondendo por trás do HTTPS). Abra no navegador: `https://transppass.online` — tela de login. `http://` redireciona para `https://` sozinho.

---

## Atualizar depois (nova versão no GitHub)

```bash
cd /opt/transppass/app
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml image prune -f
```

A API sincroniza o schema sozinha ao subir (`prisma db push`); os dados ficam no volume `pgdata`.

## Backup e restauração do banco

```bash
# backup (arquivo no host)
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U transppass transppass_pcm > backup-$(date +%F).sql

# restaurar
cat backup-2026-09-11.sql | docker compose -f docker-compose.prod.yml exec -T postgres psql -U transppass transppass_pcm
```

## Comandos úteis

```bash
docker compose -f docker-compose.prod.yml ps                 # estado dos containers
docker compose -f docker-compose.prod.yml logs -f api        # log da API
docker compose -f docker-compose.prod.yml logs -f web        # log do nginx
docker compose -f docker-compose.prod.yml restart api        # reiniciar só a API
docker compose -f docker-compose.prod.yml down               # parar tudo (mantém os dados)
docker compose -f docker-compose.prod.yml exec postgres psql -U transppass transppass_pcm   # abrir o banco
```

## Trocar o domínio depois

Aponte o novo registro A para o IP, edite `DOMAIN` e `CORS_ORIGIN` no `.env` e suba de novo:

```bash
cd /opt/transppass/app
nano .env
docker compose -f docker-compose.prod.yml up -d
```

O Caddy emite o certificado novo sozinho.
