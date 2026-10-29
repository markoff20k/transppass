#!/usr/bin/env bash
# Restaura no servidor o banco que roda na máquina de desenvolvimento.
#
# O arquivo deploy/banco-transppass.sql.gz.enc é um pg_dump (SQL puro, gzip)
# cifrado com AES-256 porque leva dados da Transppass (placas, chassi, RENAVAM,
# nomes de motoristas). A senha é pedida na hora; ela não está no repositório.
#
# Uso, em /opt/transppass/app, depois do git pull e do up -d --build:
#   bash deploy/restaurar-banco.sh
#
# O que acontece: as tabelas são apagadas e recriadas com o conteúdo do dump
# (--clean --if-exists), a API reinicia e volta com o mesmo banco do local,
# inclusive os usuários e as senhas de lá.
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"
ARQ="deploy/banco-transppass.sql.gz.enc"
DB="${POSTGRES_DB:-transppass_pcm}"
USUARIO="${POSTGRES_USER:-transppass}"

if [ -f .env ]; then
  # só POSTGRES_DB e POSTGRES_USER, se existirem no .env do servidor
  DB="$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2- | tr -d '"' || true)"; DB="${DB:-transppass_pcm}"
  USUARIO="$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2- | tr -d '"' || true)"; USUARIO="${USUARIO:-transppass}"
fi

[ -f "$ARQ" ] || { echo "arquivo $ARQ não encontrado (fez git pull?)"; exit 1; }
$COMPOSE ps postgres >/dev/null 2>&1 || { echo "container do postgres não está no ar: rode $COMPOSE up -d"; exit 1; }

read -r -s -p "Senha do dump: " SENHA; echo

echo "Conferindo a senha..."
if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$ARQ" -pass "pass:$SENHA" 2>/dev/null | gunzip 2>/dev/null | head -c 200 | grep -q "PostgreSQL database dump"; then
  echo "senha errada ou arquivo corrompido"; exit 1
fi

echo "Restaurando em $DB (usuário $USUARIO)... isso apaga e recria as tabelas."
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$ARQ" -pass "pass:$SENHA" \
  | gunzip \
  | $COMPOSE exec -T postgres psql -q -U "$USUARIO" -d "$DB" -v ON_ERROR_STOP=0 >/tmp/restauracao.log 2>&1 || true

ERROS="$(grep -c "^ERROR" /tmp/restauracao.log || true)"
echo "Restauração concluída. Erros registrados: ${ERROS:-0} (detalhe em /tmp/restauracao.log)"

echo "Reiniciando a API para ela enxergar o banco novo..."
$COMPOSE restart api >/dev/null
sleep 5
$COMPOSE exec -T postgres psql -U "$USUARIO" -d "$DB" -Atc 'select count(*) || '"'"' carros, '"'"' from "Vehicle"' 2>/dev/null || true
$COMPOSE exec -T postgres psql -U "$USUARIO" -d "$DB" -Atc 'select count(*) || '"'"' OS'"'"' from "WorkOrder"' 2>/dev/null || true
echo "Pronto. Entre no sistema e confira o Dashboard."
