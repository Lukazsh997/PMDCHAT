# Implantação em VM Linux

## Requisitos da VM

| Recurso | Mínimo                                                 | Recomendado                                       |
| ------- | ------------------------------------------------------ | ------------------------------------------------- |
| Sistema | Debian 12/13, Ubuntu Server 24.04 LTS ou Rocky Linux 9 | —                                                 |
| vCPU    | 2                                                      | 4                                                 |
| RAM     | 4 GB (6 GB com antivírus)                              | 8 GB                                              |
| Disco   | 40 GB SSD                                              | 100 GB SSD + volume separado para anexos (fase 1) |

Software: Docker Engine 24+ com o plugin `docker compose`, `git` e `openssl`.

## Instalação

```bash
sudo git clone <repositório> /opt/plataforma
cd /opt/plataforma
sudo infra/scripts/install.sh
```

O script pergunta o endereço de acesso e o nome da organização, gera o `.env` com senhas
aleatórias (permissão 600), constrói as imagens e sobe os serviços. A senha provisória do
usuário `admin` é exibida uma única vez; a troca é exigida no primeiro acesso.

Sem acesso ao Docker Hub, construa as imagens em outra máquina e leve-as para a VM:

```bash
docker compose build
docker save plataforma/api:0.1.0 plataforma/web:0.1.0 postgres:17-alpine valkey/valkey:8-alpine \
  | gzip > plataforma-0.1.0.tar.gz
# na VM:
gunzip -c plataforma-0.1.0.tar.gz | docker load && docker compose up -d
```

## Antivírus (ClamAV)

Os anexos passam pelo ClamAV antes de serem aceitos. O serviço `clamav` usa cerca de 1,5 GB de
RAM e, na primeira subida, baixa as assinaturas de vírus da internet (alguns minutos). Depois as
atualiza sozinho. Enquanto ele não estiver pronto, os uploads são recusados com a mensagem
"verificação antivírus indisponível".

Para desativar (não recomendado), no `.env`: `COMPOSE_PROFILES=` e `CLAMAV_HOST=` (vazios).

## Atualizar de uma versão anterior

```bash
git pull
infra/scripts/update.sh
```

O `update.sh` faz backup, acrescenta ao `.env` as variáveis novas (como `APP_SECRET`, gerada
automaticamente), reconstrói as imagens e aplica as migrações do banco. Na passagem da Fase 0
para a Fase 1, o usuário `admin` vira super administrador e precisa ativar a verificação em
duas etapas em "Minha conta" para usar o painel.

## Endereço de acesso e `APP_ORIGINS`

O sistema aceita login por qualquer endereço que chegue à VM: nome DNS, IP ou outra porta.
A API só recusa alterações vindas de **outros sites** (proteção CSRF). `APP_ORIGINS` serve
para registrar o endereço principal e origens extras, como o servidor de desenvolvimento.

## HTTPS (recomendado, sem custo)

Com HTTPS, senhas e mensagens trafegam cifradas na rede, e o Chrome libera notificações, avisos
com a aba fechada (Web Push) e a instalação como aplicativo — sem política especial nas estações.
Ver [HTTPS](#https) abaixo. Enquanto o site estiver em HTTP, esses recursos só funcionam com a
política `OverrideSecurityRestrictionsOnInsecureOrigin` do Chrome (GPO, modelo _Google Chrome →
Configurações de conteúdo_), com a lista de endereços de `APP_ORIGINS` sem `localhost`.

## Web Push (avisos com a aba fechada)

Com HTTPS (ou a política acima), cada pessoa que permitir notificações passa a receber avisos também com a
aba do sistema fechada, desde que o Chrome esteja aberto. O envio passa pelo serviço de push do
Google (FCM), então:

- a **VM** precisa sair para a internet em `https://fcm.googleapis.com` (porta 443). Se a saída for
  por proxy, informe-o em `PUSH_PROXY` no `.env` (ex.: `http://proxy.orgao.local:3128`);
- as **estações** precisam alcançar o Google (o próprio Chrome mantém essa conexão);
- `PUSH_SUBJECT` deve ser um contato da organização (`mailto:ti@orgao.gov.br`): o protocolo exige;
- o texto enviado ao serviço do Google é só o começo da mensagem (até 140 caracteres), cifrado de
  ponta a ponta entre o servidor e o navegador; o Google não consegue ler.

As chaves VAPID são geradas na primeira subida e ficam no banco (entram no backup). Para desligar o
recurso, use `PUSH_ENABLED=false`. Quem quiser, ajusta os avisos por conversa (todas ou
nenhuma) no painel da conversa, e vê o estado dos avisos em **Minha conta → Notificações e
aplicativo**.

## Aplicativo instalável (PWA)

Com HTTPS (ou a mesma política do Chrome), o sistema pode ser instalado como aplicativo: janela própria e
ícone na barra de tarefas, sem instalador. Em **Minha conta → Notificações e aplicativo** aparece o
botão **Instalar** quando o Chrome oferece; também pelo menu ⋮ → _Transmitir, salvar e
compartilhar → Instalar página como app_. Para instalar em todas as estações, use a política
`WebAppInstallForceList` do Chrome com o endereço do sistema.

## Active Directory

Configurado no painel, em **Administração → Active Directory** (só o super administrador). Antes:

1. **Conta de serviço só de leitura** no AD (ex.: `svc-chat`), com senha que não expira. Ela não
   precisa de nenhuma permissão além da leitura padrão de usuários, grupos e OUs.
2. **Conexão protegida:** use `ldaps://servidor:636` (recomendado) ou `ldap://servidor:389` com
   StartTLS ligado. Sem uma das duas, a senha das pessoas trafega aberta na rede.
3. **Certificado:** se o AD usa um certificado da AC interna da organização, cole o certificado da
   AC (PEM, "Base-64") em _Opções avançadas_. Exporte em `certlm.msc` → _Autoridades de
   Certificação Raiz Confiáveis_ → certificado da AC → _Exportar_ → _X.509 codificado em Base-64_.
4. **Rede:** a VM precisa alcançar o controlador de domínio na porta 636 (ou 389). Teste com
   `docker compose exec api node -e "require('net').connect(636,'ad.orgao.local').on('connect',()=>{console.log('ok');process.exit()})"`.

No painel, siga as quatro etapas na ordem: **Conexão** (preencha, _Testar conexão_ e _Salvar_),
**OUs → unidades** (o botão _Ligar pelo nome_ sugere pela sigla/nome), **Grupos → papéis** e
**Sincronização** (_Ver o que muda_ mostra a prévia sem gravar nada; depois _Sincronizar agora_).
A partir daí a sincronização roda sozinha no intervalo configurado (padrão: 60 min).

- Só pessoas são importadas. O filtro padrão (`objectCategory=person` e `objectClass=user`) deixa de
  fora computadores (que no AD também são `objectClass=user`), impressoras e contatos.
- Estruturas com pastas por tipo dentro de cada setor (`TI › COMPUTADORES`, `TI › IMPRESSORAS`,
  `TI › USUÁRIOS`) funcionam como estão: ligue só a OU do setor (`TI`) a uma unidade; quem está em
  `USUÁRIOS` fica na unidade do setor. O painel esconde as OUs sem pessoas e as pastas de contas.
- Para importar só uma parte das pessoas, restrinja o filtro em _Opções avançadas_, por exemplo a
  um grupo: `(&(objectCategory=person)(objectClass=user)(memberOf=CN=Chat-Usuarios,OU=Grupos,DC=orgao,DC=local))`.
- As pessoas entram com o login da rede: `joao`, `ORGAO\joao` ou `joao@orgao.local`.
- O super administrador local continua entrando com a senha própria. Mantenha-o como acesso de
  emergência para quando o AD estiver fora do ar.
- Uma conta local com o mesmo login de alguém do AD passa a ser do AD (a senha local deixa de valer).
- Se a sincronização fosse desativar muita gente de uma vez (mais de 30%), ela para e pede
  confirmação no painel — geralmente é sinal de base de busca ou filtro errados.

### Lista de lotação

Se a hierarquia secretaria → setor e a lotação de cada pessoa estão em outro sistema (e não nas
OUs do AD), importe a lista em **Administração → Lotação**. Aceita a exportação da tabela em .sql
(INSERTs com os nomes das colunas, ou COPY do pg_dump) ou uma planilha .csv. Colunas reconhecidas:

| Dado                                    | Nomes aceitos                               |
| --------------------------------------- | ------------------------------------------- |
| Login (o mesmo do AD)                   | `username`, `login`, `usuario`, `matricula` |
| Nome                                    | `nome`, `name`, `nome_completo`             |
| Secretaria                              | `unidade`, `secretaria`, `orgao`            |
| Setor                                   | `setor`, `departamento`, `lotacao`          |
| Código do setor (opcional, recomendado) | `setor_id`, `id_setor`, `cod_setor`         |

Exporte só essas colunas: o resto (senhas, fotos, CPF…) é ignorado, mas não precisa sair do
sistema de origem. A prévia mostra o que muda e nada é gravado antes de confirmar. Depois da
importação, **só tem conta pelo AD quem está na lista**; reimporte quando houver mudanças.

**Problemas comuns:** "O AD recusou a conta de serviço" → DN ou senha da conta de serviço; "self
signed certificate" ou "unable to verify" → falta o certificado da AC; "ECONNREFUSED"/"timeout" →
porta bloqueada entre a VM e o AD; a busca encontra 0 pessoas → base de busca ou filtro.

## Operação

| Tarefa                       | Comando                                                               |
| ---------------------------- | --------------------------------------------------------------------- |
| Ver estado dos serviços      | `docker compose ps`                                                   |
| Logs da API                  | `docker compose logs -f api`                                          |
| Saúde                        | `curl http://<endereço>/api/v1/health`                                |
| Backup do banco e dos anexos | `infra/scripts/backup.sh` (agende no cron, ex.: diariamente às 02:30) |
| Restaurar backup             | `infra/scripts/restore.sh backups/db-….dump backups/files-….tar.gz`   |
| Redefinir duas etapas        | `docker compose run --rm api cli reset-mfa <usuário>`                 |
| Atualizar versão             | `infra/scripts/update.sh`                                             |
| Senha temporária             | `docker compose run --rm api cli reset-password <usuário>`            |

Backups ficam em `./backups` por 14 dias (`BACKUP_DIR` e `BACKUP_KEEP_DAYS` alteram isso).
Copie-os para outro servidor; um backup na mesma VM não protege contra perda do disco.

## Solução de problemas

**`dependency failed to start: container plataforma-api-1 is unhealthy`**: a API não
conseguiu iniciar. O `install.sh` mostra as últimas linhas do log; manualmente:
`docker compose logs --tail 50 api`. Causas comuns:

| Mensagem no log                                                                | Causa e correção                                                                                                                                                                          |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Configuração inválida: APP_ORIGINS…`                                          | Endereço sem `http://` no `.env`. Corrija para `APP_ORIGINS=http://192.168.0.10` e rode `docker compose up -d`                                                                            |
| `exec api-entrypoint failed: Permission denied` ou `No such file or directory` | Script sem permissão de execução ou com quebras de linha do Windows, numa imagem antiga. Atualize o código e rode `docker compose build --no-cache` (a imagem atual corrige isso sozinha) |
| `ECONNREFUSED … 5432` ou `password authentication failed`                      | O volume do banco foi criado com outra senha. Se ainda não há dados: `docker compose down -v` e instale de novo                                                                           |

**Avisos com a aba fechada não chegam:** em _Minha conta_, o estado deve ser "Ativo". Se aparecer
"Indisponível neste endereço", o site está em HTTP: ligue o [HTTPS](#https). Se a política existe mas nada chega,
veja `docker compose logs worker | grep push`: falhas de conexão indicam que a VM não alcança
`fcm.googleapis.com` (libere a saída ou configure `PUSH_PROXY`).

**Depois de ligar o HTTPS:**

- _"Sua conexão não é particular"_ (`NET::ERR_CERT_AUTHORITY_INVALID`): a estação ainda não confia
  na AC. Confira a GPO (`gpupdate /force`; no Windows, `certlm.msc` → _Autoridades de Certificação
  Raiz Confiáveis_ deve listar a AC) e feche e abra o Chrome.
- `NET::ERR_CERT_COMMON_NAME_INVALID`: o endereço digitado não está no certificado. Inclua-o
  (`https.sh interna novo-nome`) ou acesse pelo nome principal.
- O site não abre em `https://`: a porta 443 está bloqueada no firewall da VM ou da rede.
- O login volta para a tela de entrada sem erro: acesso por `http://` com `COOKIE_SECURE=true`.
  Use o endereço `https://` (o `https.sh` mantém os dois ajustes juntos).

Para editar o projeto no Windows, mantenha as quebras de linha Unix (LF). O arquivo
`.gitattributes` já faz isso no Git; no editor, use LF para `.sh`, `.env` e `.conf`.

## HTTPS

O HTTPS não tem custo. Tudo é feito pelo `infra/scripts/https.sh`, que gera ou importa o
certificado, ajusta o `.env` (`COOKIE_SECURE=true` e `https://` em `APP_ORIGINS`) e reinicia o Nginx
e a API. Depois disso, quem digitar `http://` é levado ao `https://` automaticamente.

Libere a porta **443** no firewall da VM (e `HTTPS_PORT` no `.env`, se quiser outra).

### Qual certificado usar

| Situação                                                                                     | Opção                                                                            |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| O AD tem **Serviços de Certificados (AD CS)**                                                | **B** — o certificado da AC do AD já é confiável em todas as estações do domínio |
| Não há AD CS (ou a TI prefere não usar)                                                      | **A** — AC interna da plataforma, distribuída por GPO                            |
| O sistema tem nome num **domínio público** da organização (ex.: `chat.prefeitura.rj.gov.br`) | **B** com Let's Encrypt (validação por DNS)                                      |

Nomes internos (`.local`) e IPs da rede interna não conseguem certificado do Let's Encrypt nem de
outra AC pública: use A ou B com o AD CS. O Let's Encrypt vence a cada 90 dias e, para um servidor
interno, exige validar por DNS (ex.: `certbot certonly --manual --preferred-challenges dns -d
chat.prefeitura.rj.gov.br`) a cada renovação; por isso A ou o AD CS costumam ser mais simples.

### A. AC interna da plataforma

```bash
cd /opt/plataforma
sudo infra/scripts/https.sh interna                       # usa os endereços de APP_ORIGINS
sudo infra/scripts/https.sh interna chat 192.168.0.10     # + nomes/IPs extras
```

O script cria uma Autoridade Certificadora (AC) só da plataforma e emite o certificado do site
(válido por 825 dias). A AC é **restrita por nome**: ela só vale para o domínio do sistema (ex.:
`orgao.local`) e IPs da rede interna. Mesmo instalada em todas as estações, não consegue se passar
por nenhum outro site.

Falta só fazer as estações confiarem na AC, **uma vez**, por GPO:

1. Copie `infra/nginx/ca/ca.crt` da VM (ou baixe em `http://<endereço>/certificado-ac.crt`).
2. No _Gerenciamento de Política de Grupo_, numa GPO ligada às OUs dos computadores:
   _Configuração do Computador → Políticas → Configurações do Windows → Configurações de
   Segurança → Políticas de Chave Pública → Autoridades de Certificação Raiz Confiáveis_ →
   botão direito → _Importar_ → `ca.crt`.
3. Nas estações: `gpupdate /force` (ou aguarde a próxima atualização da política). Chrome e Edge
   usam o repositório do Windows e passam a confiar sozinhos.

Computadores fora do domínio precisam importar o `ca.crt` manualmente (duplo clique → _Instalar
certificado_ → _Máquina local_ → _Autoridades de Certificação Raiz Confiáveis_).

**Guarde a pasta `infra/nginx/ca` fora da VM** (o `backup.sh` já a inclui). Sem a chave da AC, a
renovação exige gerar e distribuir uma AC nova. Para renovar sozinho, agende no cron da VM:

```
0 3 1 * * /opt/plataforma/infra/scripts/https.sh renovar-auto
```

(renova quando faltam menos de 60 dias; o `update.sh` também avisa).

### B. Certificado de uma AC existente (AD CS, Let's Encrypt…)

1. Peça à equipe do AD um certificado de **servidor web** para o nome do sistema (e o IP, se for
   acessado por IP), com a chave privada exportável. No AD CS: modelo _Servidor Web_; exporte em
   `.pfx` e converta na VM:
   ```bash
   openssl pkcs12 -in chat.pfx -nocerts -nodes -out chave.pem
   openssl pkcs12 -in chat.pfx -clcerts -nokeys -out certificado.pem
   openssl pkcs12 -in chat.pfx -cacerts -nokeys -out cadeia.pem
   ```
2. Importe:
   ```bash
   sudo infra/scripts/https.sh importar certificado.pem chave.pem cadeia.pem
   ```
   O script confere se a chave corresponde ao certificado, se ele está válido e se cobre os
   endereços de `APP_ORIGINS`. Aceita `.cer` (DER) do Windows. Apague `chave.pem` e o `.pfx`
   depois.
3. Antes de vencer, importe o certificado novo da mesma forma.

### Comandos úteis

```bash
sudo infra/scripts/https.sh status     # certificado em uso, nomes e vencimento
sudo infra/scripts/https.sh desligar   # volta para HTTP (guarda os certificados)
```

Ao desligar, navegadores que já abriram o site em HTTPS insistem nele por até 180 dias (HSTS):
desligue só se for voltar a ligar, ou para resolver um problema pontual.
