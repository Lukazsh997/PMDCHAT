# Implantação em VM Linux

## Requisitos da VM

| Recurso | Mínimo                                                 | Recomendado                                       |
| ------- | ------------------------------------------------------ | ------------------------------------------------- |
| Sistema | Debian 12/13, Ubuntu Server 24.04 LTS ou Rocky Linux 9 | —                                                 |
| vCPU    | 2                                                      | 4                                                 |
| RAM     | 4 GB                                                   | 8 GB                                              |
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

## Endereço de acesso e `APP_ORIGINS`

A API recusa alterações vindas de origens não listadas em `APP_ORIGINS` (proteção CSRF). Liste
todos os endereços que os usuários digitarão no navegador, por exemplo:

```
APP_ORIGINS=http://chat.orgao.local,http://10.0.0.25
```

## Política do Chrome para HTTP (obrigatória para notificações)

O Chrome só permite notificações, Service Worker, Web Push e instalação como aplicativo (PWA) em
contexto seguro (HTTPS). Como o site roda em HTTP nesta fase, cadastre o endereço interno na
política `OverrideSecurityRestrictionsOnInsecureOrigin`, distribuída por GPO:

- Modelo administrativo: _Google Chrome → Configurações de conteúdo_ (ADMX do Chrome Enterprise)
- Valor: a mesma lista de `APP_ORIGINS`, sem `localhost`

Até lá, o login, a navegação e as funções desta fase funcionam normalmente; apenas os recursos
acima ficam bloqueados pelo navegador.

## Operação

| Tarefa                  | Comando                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| Ver estado dos serviços | `docker compose ps`                                                   |
| Logs da API             | `docker compose logs -f api`                                          |
| Saúde                   | `curl http://<endereço>/api/v1/health`                                |
| Backup do banco         | `infra/scripts/backup.sh` (agende no cron, ex.: diariamente às 02:30) |
| Restaurar backup        | `infra/scripts/restore.sh backups/db-AAAAMMDD-HHMMSS.dump`            |
| Atualizar versão        | `infra/scripts/update.sh`                                             |
| Senha temporária        | `docker compose run --rm api cli reset-password <usuário>`            |

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
