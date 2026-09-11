# Instalação num droplet da DigitalOcean (Ubuntu 24.04 LTS)

Arquitetura no servidor: **nginx** serve o front (arquivos estáticos de `apps/web/dist`) e repassa `/api` para a **API NestJS** (porta 3000, gerenciada pelo **PM2**), que fala com o **PostgreSQL 16** local. Tudo na mesma origem, então não há CORS entre front e API.

Substitua ao longo do roteiro:
- `SEU_IP` → o IP público do droplet
- `SENHA_DO_BANCO` → uma senha forte para o usuário do PostgreSQL

Cada bloco abaixo é para copiar e colar na ordem. Linhas que começam com `#` são comentários.

---

## 1. Entrar no servidor e atualizar o sistema

No seu computador:

```bash
ssh root@SEU_IP
```

No servidor:

```bash
apt update && apt upgrade -y
apt install -y git curl build-essential ufw nginx postgresql postgresql-contrib
```

## 2. Swap (evita ficar sem memória no build em droplets de 1–2 GB)

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
ufw allow 'Nginx Full'
ufw --force enable
ufw status
```

## 4. Node.js 22 LTS e PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v
npm -v
npm install -g pm2
```

## 5. Banco de dados

```bash
sudo -u postgres psql -c "CREATE USER transppass WITH PASSWORD 'SENHA_DO_BANCO';"
sudo -u postgres psql -c "CREATE DATABASE transppass_pcm OWNER transppass;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE transppass_pcm TO transppass;"
```

## 6. Usuário da aplicação e código

```bash
adduser --disabled-password --gecos "" transppass
chmod 755 /home/transppass
su - transppass
git clone https://github.com/markoff20k/transppass.git app
cd app
```

## 7. Variáveis de ambiente

Gere os dois segredos do JWT (guarde a saída):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Crie o `.env` na raiz do projeto (troque `SENHA_DO_BANCO`, os dois segredos e `SEU_IP`):

```bash
cat > .env <<'EOF'
# ---- API ----
NODE_ENV=production
PORT=3000
DATABASE_URL="postgresql://transppass:SENHA_DO_BANCO@localhost:5432/transppass_pcm?schema=public"

JWT_ACCESS_SECRET=COLE_AQUI_O_PRIMEIRO_SEGREDO
JWT_REFRESH_SECRET=COLE_AQUI_O_SEGUNDO_SEGREDO
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

CORS_ORIGIN=http://SEU_IP

# ---- WEB ----
# Vazio de propósito: o front chama /api na mesma origem e o nginx repassa.
VITE_API_URL=
EOF
nano .env
```

O Prisma procura o `.env` dentro de `apps/api`; aponte para o da raiz:

```bash
ln -s ../../.env apps/api/.env
```

## 8. Instalar dependências e compilar

```bash
npm ci
npm run build
```

Ao final devem existir `apps/api/dist/main.js` e `apps/web/dist/index.html`:

```bash
ls apps/api/dist/main.js apps/web/dist/index.html
```

## 9. Criar as tabelas e a carga inicial

```bash
npm run db:generate
npx -w @app/api prisma db push
npm run db:seed
```

> O seed cria as personas com senha padrão (`admin@transppass.local` / `admin123` e as demais em `COMO-RODAR.md`). Troque as senhas assim que entrar — o sistema vai estar exposto na internet.

## 10. Subir a API com PM2

```bash
pm2 start npm --name transppass-api -- run start -w @app/api
pm2 save
pm2 startup
```

O `pm2 startup` imprime um comando começando com `sudo env PATH=...`. Copie-o, saia para o root e execute:

```bash
exit
# (agora como root) cole aqui o comando que o pm2 startup imprimiu
```

Confira que a API responde (401 é o esperado — rota protegida):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/dashboard
```

## 11. nginx: front estático + proxy da API

Ainda como root:

```bash
cat > /etc/nginx/sites-available/transppass <<'EOF'
server {
    listen 80;
    server_name _;

    root /home/transppass/app/apps/web/dist;
    index index.html;

    # Front (SPA): qualquer rota cai no index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API NestJS (mantém o prefixo /api)
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # Assets com hash podem ficar em cache por muito tempo
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript image/svg+xml;
}
EOF
ln -sf /etc/nginx/sites-available/transppass /etc/nginx/sites-enabled/transppass
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

Abra no navegador: `http://SEU_IP` — deve aparecer a tela de login.

## 12. (Opcional, recomendado) HTTPS com domínio

Aponte um registro **A** do seu domínio para `SEU_IP`. Depois, no servidor:

```bash
sed -i 's/server_name _;/server_name SEU_DOMINIO;/' /etc/nginx/sites-available/transppass
nginx -t && systemctl reload nginx
apt install -y certbot python3-certbot-nginx
certbot --nginx -d SEU_DOMINIO
```

E ajuste a origem no `.env` para o domínio com https, reiniciando a API:

```bash
su - transppass
cd app
sed -i 's#^CORS_ORIGIN=.*#CORS_ORIGIN=https://SEU_DOMINIO#' .env
pm2 restart transppass-api
exit
```

---

## Atualizar o sistema depois (nova versão no GitHub)

```bash
su - transppass
cd app
git pull
npm ci
npm run build
npx -w @app/api prisma db push
pm2 restart transppass-api
exit
```

## Comandos úteis

```bash
pm2 status                      # a API está de pé?
pm2 logs transppass-api         # log da API ao vivo
tail -f /var/log/nginx/error.log
sudo -u postgres psql transppass_pcm   # abrir o banco
```
