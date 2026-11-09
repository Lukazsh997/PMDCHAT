#!/usr/bin/env bash
# Acrescenta ao .env as variáveis novas do .env.example que ainda não existem,
# sem mexer nas que já estão configuradas. Chamado pelo install.sh e pelo update.sh.
# APP_SECRET recebe um valor aleatório na primeira vez.
set -euo pipefail
cd "$(dirname "$0")/../.."

[[ -f .env ]] || { echo "Arquivo .env não encontrado. Rode infra/scripts/install.sh."; exit 1; }
grep -q $'\r' .env && sed -i 's/\r$//' .env

added=()
while IFS= read -r line; do
  [[ "$line" =~ ^([A-Z_][A-Z0-9_]*)= ]] || continue
  key="${BASH_REMATCH[1]}"
  grep -qE "^${key}=" .env && continue
  case "$key" in
    APP_SECRET) line="APP_SECRET=$(openssl rand -hex 32)" ;;
    NODE_ENV) line="NODE_ENV=production" ;;
    FILES_DIR) continue ;; # só para desenvolvimento local
  esac
  printf '%s\n' "$line" >> .env
  added+=("$key")
done < <(tr -d '\r' < .env.example)

if ((${#added[@]})); then
  echo "Variáveis novas adicionadas ao .env: ${added[*]}"
fi
