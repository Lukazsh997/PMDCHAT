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

## Política do Chrome para HTTP (obrigatória para notificações)

O Chrome só permite notificações, Service Worker, Web Push e instalação como aplicativo (PWA) em
contexto seguro (HTTPS). Como o site roda em HTTP nesta fase, cadastre o endereço interno na
política `OverrideSecurityRestrictionsOnInsecureOrigin`, distribuída por GPO:

- Modelo administrativo: _Google Chrome → Configurações de conteúdo_ (ADMX do Chrome Enterprise)
- Valor: a mesma lista de `APP_ORIGINS`, sem `localhost`

Até lá, o login, a navegação e as funções desta fase funcionam normalmente; apenas os recursos
acima ficam bloqueados pelo navegador.

## Web Push (avisos com a aba fechada)

Com a política acima, cada pessoa que permitir notificações passa a receber avisos também com a
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

Com a mesma política do Chrome, o sistema pode ser instalado como aplicativo: janela própria e
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
"Indisponível neste endereço", falta a política do Chrome. Se a política existe mas nada chega,
veja `docker compose logs worker | grep push`: falhas de conexão indicam que a VM não alcança
`fcm.googleapis.com` (libere a saída ou configure `PUSH_PROXY`).

Para editar o projeto no Windows, mantenha as quebras de linha Unix (LF). O arquivo
`.gitattributes` já faz isso no Git; no editor, use LF para `.sh`, `.env` e `.conf`.

## Ativar HTTPS depois

Nenhuma mudança de código é necessária:

1. Coloque o certificado e a chave em `infra/nginx/certs/`.
2. Adicione um bloco `listen 443 ssl` ao `infra/nginx/default.conf` (mantendo o de 80
   redirecionando para 443) e publique a porta 443 no `docker-compose.yml`.
3. No `.env`: `COOKIE_SECURE=true` e troque `http://` por `https://` em `APP_ORIGINS`.
4. `docker compose up -d --build`. A API passa a enviar HSTS automaticamente.
5. Remova a política `OverrideSecurityRestrictionsOnInsecureOrigin` das estações.
