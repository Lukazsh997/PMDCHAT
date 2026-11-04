#!/bin/sh
# Ponto de entrada da imagem da API. O mesmo contêiner assume papéis diferentes:
#   api     → aplica migrações, cria o admin inicial (se o banco estiver vazio) e sobe a API
#   worker  → tarefas assíncronas e recorrentes
#   cli ... → comandos de manutenção (ex.: cli reset-password maria.silva)
set -e

case "$1" in
  api)
    node dist/cli.js migrate
    node dist/cli.js bootstrap-admin
    exec node dist/main.js
    ;;
  worker)
    exec node dist/worker.js
    ;;
  cli)
    shift
    exec node dist/cli.js "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
