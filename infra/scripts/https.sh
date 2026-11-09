#!/usr/bin/env bash
# HTTPS da plataforma, sem custo. Uso:
#
#   infra/scripts/https.sh interna [nome-ou-IP ...]
#       Cria uma Autoridade Certificadora (AC) interna da plataforma e um certificado para os
#       endereços de APP_ORIGINS (e os nomes/IPs extras informados). O certificado da AC deve
#       ser instalado nas estações (por GPO no AD): ver docs/implantacao.md.
#
#   infra/scripts/https.sh importar certificado.pem chave.pem [cadeia.pem]
#       Usa um certificado emitido por outra AC: a AC do Active Directory (AD CS), a da
#       organização ou o Let's Encrypt.
#
#   infra/scripts/https.sh renovar     Emite de novo o certificado da AC interna (mesmos nomes).
#   infra/scripts/https.sh renovar-auto  Renova só se faltar menos de 60 dias (para o cron:
#                                        0 3 1 * * /opt/plataforma/infra/scripts/https.sh renovar-auto)
#   infra/scripts/https.sh status      Mostra o certificado em uso e quando vence.
#   infra/scripts/https.sh desligar    Volta para HTTP (guarda os certificados).
set -euo pipefail
cd "$(dirname "$0")/../.."

CERTS=infra/nginx/certs   # montado (só leitura) no Nginx
CA_DIR=infra/nginx/ca     # chave da AC interna: fica só na VM, nunca vai para o contêiner
SERVER_DAYS=825           # limite aceito por todos os navegadores e sistemas
CA_DAYS=3650

die() { printf 'Erro: %b\n' "$*" >&2; exit 1; }

# Roda o openssl sem o ruído de progresso; se falhar, mostra a saída real (que o
# -2>/dev/null antes escondia) e devolve erro para quem chamou tratar.
ossl() {
  local out
  if ! out=$(openssl "$@" 2>&1 >/dev/null); then
    [[ -n "$out" ]] && printf '%s\n' "$out" >&2
    return 1
  fi
}
command -v openssl >/dev/null || die "openssl não encontrado (apt install openssl)."
[[ -f .env ]] || die "Arquivo .env não encontrado. Rode infra/scripts/install.sh primeiro."
grep -q $'\r' .env && sed -i 's/\r$//' .env
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d '"' || true; }
env_set() {
  if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}

# Endereços de APP_ORIGINS (sem esquema e porta), menos localhost.
origin_hosts() {
  local o h
  IFS=',' read -ra list <<< "$(env_get APP_ORIGINS)"
  for o in "${list[@]}"; do
    h="${o#*://}"; h="${h%%/*}"
    if [[ "$h" == \[* ]]; then h="${h%%]*}"; h="${h#[}"; else h="${h%%:*}"; fi
    [[ -n "$h" && "$h" != localhost && "$h" != 127.0.0.1 ]] && printf '%s\n' "$h"
  done
}

is_ip() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ || "$1" == *:* ]]; }

# APP_ORIGINS passa para https:// (o servidor de desenvolvimento fica como está).
switch_origins() {
  local scheme="$1" port out=() o
  port=$(env_get HTTPS_PORT); port="${port:-443}"
  IFS=',' read -ra list <<< "$(env_get APP_ORIGINS)"
  for o in "${list[@]}"; do
    # Servidor de desenvolvimento (localhost com porta, ex.: :5173) fica como está.
    if [[ "$o" =~ ://(localhost|127\.0\.0\.1):[0-9]+$ ]]; then out+=("$o"); continue; fi
    local h="${o#*://}"; h="${h%%/*}"
    if [[ "$h" != \[* ]]; then h="${h%%:*}"; fi
    if [[ "$scheme" == https && "$port" != 443 ]]; then out+=("https://$h:$port");
    else out+=("$scheme://$h"); fi
  done
  env_set APP_ORIGINS "$(IFS=,; echo "${out[*]}")"
}

restart() {
  echo "Reiniciando o Nginx e a API com a configuração nova…"
  docker compose up -d --wait --wait-timeout 300 nginx api worker
}

enable_env() {
  env_set COOKIE_SECURE true
  grep -qE '^HTTPS_PORT=' .env || env_set HTTPS_PORT 443
  switch_origins https
}

summary() {
  local crt="$CERTS/server.crt"
  echo
  echo "Certificado: $(openssl x509 -in "$crt" -noout -subject -nameopt multiline,utf8,-esc_msb | sed -n 's/ *commonName *= //p')"
  echo "Emitido por: $(openssl x509 -in "$crt" -noout -issuer -nameopt multiline,utf8,-esc_msb | sed -n 's/ *commonName *= //p')"
  echo "Nomes:       $(openssl x509 -in "$crt" -noout -ext subjectAltName 2>/dev/null | tail -n +2 | sed 's/^ *//')"
  echo "Vence em:    $(openssl x509 -in "$crt" -noout -enddate | cut -d= -f2)"
  echo "Endereço:    $(env_get APP_ORIGINS | cut -d, -f1)"
}

# ---------------------------------------------------------------------------

issue_server() {
  # $@ = nomes e IPs do certificado
  local san="" cn="$1" n tmp="$WORK/server"
  for n in "$@"; do
    if is_ip "$n"; then san+="IP:$n,"; else san+="DNS:$n,"; fi
  done
  san="${san%,}"
  mkdir -p "$tmp"
  ossl req -new -newkey rsa:2048 -nodes -keyout "$tmp/server.key" \
    -subj "/CN=$cn" -out "$tmp/server.csr" ||
    die "não consegui gerar a chave do certificado (veja o erro do OpenSSL acima)."
  cat > "$tmp/ext.cnf" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
subjectAltName=$san
EOF
  # Assina o certificado com a AC interna. OpenSSL recente recusa aqui mesmo quando a AC
  # não permite os nomes pedidos (versões antigas só reprovavam no 'verify' abaixo).
  if ! ossl x509 -req -in "$tmp/server.csr" -CA "$CA_DIR/ca.crt" -CAkey "$CA_DIR/ca.key" \
    -CAcreateserial -CAserial "$CA_DIR/ca.srl" -days "$SERVER_DAYS" -sha256 \
    -extfile "$tmp/ext.cnf" -out "$tmp/server.crt" ||
    ! openssl verify -CAfile "$CA_DIR/ca.crt" "$tmp/server.crt" >/dev/null 2>&1; then
    die "a AC interna atual não cobre os endereços pedidos (${san//,/, }) — provavelmente foi criada para outros nomes.\nSe ela ainda NÃO foi distribuída às estações, apague e gere uma nova:\n  sudo rm -rf $CA_DIR $CERTS && sudo infra/scripts/https.sh interna"
  fi
  mkdir -p "$CERTS"
  install -m 600 "$tmp/server.key" "$CERTS/server.key"
  install -m 644 "$tmp/server.crt" "$CERTS/server.crt"
  install -m 644 "$CA_DIR/ca.crt" "$CERTS/ca.crt"
}

create_ca() {
  local org; org=$(env_get ORG_NAME); org="${org:-Plataforma}"
  # Restrições de nome: a AC só vale para os domínios do sistema e IPs da rede interna.
  # Mesmo instalada em todas as estações, ela não consegue se passar por outros sites.
  local nc="" n d seen=" "
  for n in "$@"; do
    is_ip "$n" && continue
    d="${n#*.}"; [[ "$d" == "$n" ]] && d="$n"   # chat.orgao.local → orgao.local
    [[ "$seen" == *" $d "* ]] && continue
    seen+="$d "; nc+="permitted;DNS:$d,"
  done
  # Sem nenhum nome DNS: proíbe todos (".invalid" não existe), para a AC não valer para sites.
  [[ -n "$nc" ]] || nc="permitted;DNS:plataforma.invalid,"
  nc+="permitted;IP:10.0.0.0/255.0.0.0,permitted;IP:172.16.0.0/255.240.0.0,permitted;IP:192.168.0.0/255.255.0.0"
  mkdir -p "$CA_DIR"; chmod 700 "$CA_DIR"
  ossl req -x509 -new -utf8 -newkey rsa:4096 -nodes -sha256 -days "$CA_DAYS" \
    -keyout "$CA_DIR/ca.key" -out "$CA_DIR/ca.crt" \
    -subj "/O=$org/CN=AC interna da Comunicação Interna - $org" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash" \
    -addext "nameConstraints=critical,$nc" ||
    die "não consegui criar a AC interna (veja o erro do OpenSSL acima)."
  chmod 600 "$CA_DIR/ca.key"
  echo "AC interna criada (vale até $(openssl x509 -in "$CA_DIR/ca.crt" -noout -enddate | cut -d= -f2))."
}

cmd_interna() {
  local names=() n
  while IFS= read -r n; do names+=("$n"); done < <(origin_hosts)
  for n in "$@"; do names+=("$n"); done
  # Sem repetidos, mantendo a ordem (o primeiro vira o nome principal).
  mapfile -t names < <(printf '%s\n' "${names[@]}" | awk 'NF && !seen[$0]++')
  ((${#names[@]})) || die "nenhum endereço em APP_ORIGINS. Informe os nomes/IPs: https.sh interna chat.orgao.local 192.168.0.10"
  echo "Endereços do certificado: ${names[*]}"
  if [[ ! -s "$CA_DIR/ca.key" ]]; then create_ca "${names[@]}"; else echo "Usando a AC interna existente."; fi
  issue_server "${names[@]}"
  enable_env
  restart
  summary
  cat <<EOF

Falta um passo nas estações: confiar na AC interna.
  - Certificado da AC: $CA_DIR/ca.crt
    (também em http://${names[0]}/certificado-ac.crt)
  - Distribua por GPO: Configuração do Computador → Políticas → Configurações do Windows →
    Configurações de Segurança → Políticas de Chave Pública → Autoridades de Certificação
    Raiz Confiáveis → Importar. Chrome e Edge passam a confiar sozinhos.
  - Guarde uma cópia de $CA_DIR fora da VM: sem a chave da AC, renovar exige distribuir uma AC nova.
EOF
}

cmd_importar() {
  local cert="${1:-}" key="${2:-}" chain="${3:-}"
  [[ -f "$cert" && -f "$key" ]] || die "uso: https.sh importar certificado.pem chave.pem [cadeia.pem]"
  # Aceita .cer em DER (comum no Windows) convertendo para PEM.
  local tmp="$WORK/import"
  mkdir -p "$tmp"
  for f in cert chain; do
    local src="${!f}"; [[ -n "$src" ]] || continue
    if grep -q "BEGIN CERTIFICATE" "$src"; then tr -d '\r' < "$src" > "$tmp/$f.pem"
    else openssl x509 -inform der -in "$src" -out "$tmp/$f.pem" 2>/dev/null || die "não consegui ler $src como certificado."; fi
  done
  tr -d '\r' < "$key" > "$tmp/key.pem"
  openssl pkey -in "$tmp/key.pem" -noout 2>/dev/null \
    || die "a chave $key está protegida por senha ou não é uma chave. Exporte sem senha (openssl pkey -in chave -out chave-sem-senha.pem)."
  [[ "$(openssl x509 -in "$tmp/cert.pem" -noout -pubkey | openssl sha256)" == "$(openssl pkey -in "$tmp/key.pem" -pubout | openssl sha256)" ]] \
    || die "a chave não corresponde ao certificado."
  openssl x509 -in "$tmp/cert.pem" -noout -checkend 0 >/dev/null || die "o certificado já venceu."
  local sans h missing=()
  sans=$(openssl x509 -in "$tmp/cert.pem" -noout -ext subjectAltName 2>/dev/null | tail -n +2)
  while IFS= read -r h; do
    grep -qE "(DNS:|IP Address:)${h//./\\.}(,|$)" <<< "$sans" || missing+=("$h")
  done < <(origin_hosts)
  if ((${#missing[@]})); then
    echo "Atenção: o certificado não cobre ${missing[*]} (APP_ORIGINS). O navegador vai avisar nesses endereços."
  fi
  mkdir -p "$CERTS"
  { cat "$tmp/cert.pem"; [[ -f "$tmp/chain.pem" ]] && cat "$tmp/chain.pem"; } > "$tmp/full.pem"
  install -m 600 "$tmp/key.pem" "$CERTS/server.key"
  install -m 644 "$tmp/full.pem" "$CERTS/server.crt"
  if [[ -f "$tmp/chain.pem" ]]; then install -m 644 "$tmp/chain.pem" "$CERTS/ca.crt"; else rm -f "$CERTS/ca.crt"; fi
  enable_env
  restart
  summary
}

cmd_renovar() {
  [[ -s "$CA_DIR/ca.key" ]] || die "não há AC interna nesta VM. Para certificado de outra AC, use 'importar' com o novo arquivo."
  [[ -s "$CERTS/server.crt" ]] || die "não há certificado em uso. Use 'interna' primeiro."
  local names=()
  mapfile -t names < <(openssl x509 -in "$CERTS/server.crt" -noout -ext subjectAltName | tail -n +2 \
    | tr ',' '\n' | sed -E 's/^ *(DNS:|IP Address:)//' | awk 'NF')
  issue_server "${names[@]}"
  restart
  summary
}

cmd_status() {
  if [[ ! -s "$CERTS/server.crt" ]]; then
    echo "HTTPS desligado: o site está em HTTP. Para ligar: infra/scripts/https.sh interna"
    return
  fi
  summary
  if ! openssl x509 -in "$CERTS/server.crt" -noout -checkend $((60 * 86400)) >/dev/null; then
    echo
    echo "ATENÇÃO: o certificado vence em menos de 60 dias. Renove: infra/scripts/https.sh renovar"
  fi
  [[ -s "$CA_DIR/ca.crt" ]] && echo "AC interna vence em: $(openssl x509 -in "$CA_DIR/ca.crt" -noout -enddate | cut -d= -f2)"
  return 0
}

cmd_desligar() {
  [[ -s "$CERTS/server.crt" ]] || { echo "O HTTPS já está desligado."; return; }
  local keep; keep="$CERTS/desligado-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$keep"
  mv "$CERTS"/server.crt "$CERTS"/server.key "$keep"/
  [[ -f "$CERTS/ca.crt" ]] && mv "$CERTS/ca.crt" "$keep"/
  env_set COOKIE_SECURE false
  switch_origins http
  restart
  echo "HTTPS desligado (certificados guardados em $keep)."
  echo "Atenção: navegadores que já abriram o site em HTTPS insistem nele por até 180 dias (HSTS)."
}

case "${1:-}" in
  interna) shift; cmd_interna "$@" ;;
  importar) shift; cmd_importar "$@" ;;
  renovar) cmd_renovar ;;
  renovar-auto)
    if [[ -s "$CERTS/server.crt" && -s "$CA_DIR/ca.key" ]] \
      && ! openssl x509 -in "$CERTS/server.crt" -noout -checkend $((60 * 86400)) >/dev/null; then
      cmd_renovar
    fi
    ;;
  status) cmd_status ;;
  desligar) cmd_desligar ;;
  *) awk 'NR > 1 && /^set -euo/ { exit } NR > 1' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
