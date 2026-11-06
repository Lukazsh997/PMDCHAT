# Plataforma de Comunicação Interna

Plataforma própria de comunicação da organização: conversas individuais e em grupo em tempo real,
anexos, notificações e painel administrativo. Roda numa VM Linux da própria organização, é usada
pelo Google Chrome e depende só de software livre.

## O que já está pronto

**Fase 2 — Produtividade** (esta versão)

| Área                | Entregue                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Busca               | Mensagens em português sem acento e por pedaço de palavra, com filtros (conversa, pessoa, período, anexo), pessoas e arquivos; abre a conversa na mensagem (Ctrl+K) |
| Reações             | 8 emojis, uma reação por pessoa em cada mensagem, em tempo real                                                                                                     |
| Canais de aviso     | Só administradores publicam; ligados a uma unidade, as pessoas lotadas entram e saem sozinhas                                                                       |
| Papéis e permissões | Papéis editáveis no painel (criar, ajustar permissões, onde valem), com proteção contra escalada de privilégio                                                      |
| Avisos e aplicativo | Web Push com a aba fechada, nível de aviso por conversa (todas ou nenhuma) e instalação como aplicativo (PWA)                                                       |

**Fase 1 — Chat**

| Área             | Entregue                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversas        | Diretas e em grupo, em tempo real (Socket.IO + Valkey), não lidas, confirmação de leitura, "digitando…", presença (disponível, ausente, desconectado), rascunho por conversa                        |
| Mensagens        | Envio que não duplica em quedas de rede, só o autor edita ou apaga, até 10 min após o envio (prazo pelo relógio do servidor); histórico de edições guardado; apagadas somem em definitivo após 48 h |
| Anexos           | Até 50 MB, arrastar e soltar ou colar imagem, bloqueio de executáveis pelo nome e pelo conteúdo, antivírus ClamAV, imagens sem metadados (EXIF/GPS) e com miniatura                                 |
| Grupos           | Dono e administradores, adicionar e remover pessoas (quem entra não vê o histórico anterior), sair do grupo, silenciar                                                                              |
| Notificações     | Notificação do Chrome com a aba em segundo plano, contador no título e no ícone da aba                                                                                                              |
| Organograma      | Aba para todos com a árvore (órgão › secretarias › subsecretarias › setores) e as pessoas de cada unidade, quantas estão online e busca por setor ou pessoa                                         |
| Comunicados      | Botão "Comunicado" na lista de conversas: pessoas e setores na mesma busca, entregue em conversa particular a cada um; setores exigem o papel Comunicador                                           |
| Perfil           | Foto de perfil (recortada e sem metadados no servidor)                                                                                                                                              |
| Active Directory | Login com a senha da rede; sincronização de pessoas, OUs → unidades e grupos → papéis, com prévia e trava contra desativações em massa                                                              |
| Permissões       | Papéis com escopo: super administrador, administrador de unidade (vale para a unidade e as de baixo), comunicador e auditor                                                                         |
| Painel           | Usuários (criar, editar, bloquear, excluir, senha temporária, convidados com prazo), papéis, organograma, auditoria com filtros, indicadores                                                        |
| Segurança        | Verificação em duas etapas (TOTP) obrigatória para quem acessa o painel; sessões no servidor; proteção CSRF; auditoria                                                                              |

**Fase 0 — Fundação:** monorepo, autenticação local, Docker Compose, Nginx, scripts de operação e CI.

**Fase 3 — Active Directory:** login com a senha do AD (LDAPS/StartTLS), criação da conta no
primeiro login, sincronização agendada (nome, e-mail, cargo, lotação pela OU, papéis por grupo,
desativação de quem sai do AD) e painel de configuração. Importação da lista de lotação (secretarias, setores e pessoas, a partir
de uma exportação .sql ou .csv; ver [ADR 0019](docs/adr/0019-lista-de-lotacao.md)). Ver
[ADR 0018](docs/adr/0018-active-directory.md) e [implantação](docs/implantacao.md#active-directory).

Próxima fase: cliente para Windows com notificações nativas (Fase 4).

## Estrutura

```
apps/
  api/            NestJS (Fastify): API HTTP, tempo real, worker e CLI de manutenção
    drizzle/      migrações SQL versionadas
    src/modules/  um módulo por domínio, cada um com index.ts público:
                  auth, users, rbac, org, admin, directory, conversations,
                  files, realtime, audit, health
    test/         testes de ponta a ponta (PostgreSQL e Valkey reais)
  web/            React + Vite + Tailwind
    src/features/ auth, chat, admin, account, shell
packages/
  contracts/      tipos, validações e regras compartilhadas entre API e interface
infra/
  docker/         Dockerfile e entrypoint
  nginx/          proxy reverso
  scripts/        install, update, backup, restore, upgrade-env
docs/             guia de implantação e registros de decisão (ADRs)
```

## Implantação na VM

Guia completo em [docs/implantacao.md](docs/implantacao.md).

```bash
git clone https://github.com/Lukazsh997/PMDCHAT.git /opt/plataforma && cd /opt/plataforma
infra/scripts/install.sh      # gera o .env, constrói as imagens e sobe tudo
```

Atualizar uma instalação existente:

```bash
git pull && infra/scripts/update.sh   # backup + variáveis novas + imagens + migrações
```

| Tarefa                        | Comando                                                    |
| ----------------------------- | ---------------------------------------------------------- |
| Backup do banco e dos anexos  | `infra/scripts/backup.sh`                                  |
| Senha temporária              | `docker compose run --rm api cli reset-password <usuário>` |
| Celular perdido (duas etapas) | `docker compose run --rm api cli reset-mfa <usuário>`      |
| Logs da API                   | `docker compose logs -f api`                               |

## Desenvolvimento local

Requisitos: Node.js 24 (ou 22.12+), pnpm 10, PostgreSQL 16+ e Valkey 8 (ou Redis 7).

```bash
cp .env.example .env            # ajuste DATABASE_URL e REDIS_URL; use CLAMAV_HOST= sem antivírus local
pnpm install
pnpm db:migrate
pnpm --filter @plataforma/api build && node --env-file=.env apps/api/dist/cli.js bootstrap-admin
pnpm dev                        # API em :3000 e interface em http://localhost:5173
```

Entre com `admin` e a senha de `BOOTSTRAP_ADMIN_PASSWORD`; a troca de senha é exigida. Para o
painel, ative a verificação em duas etapas em "Minha conta".

| Comando                     | O que faz                                                     |
| --------------------------- | ------------------------------------------------------------- |
| `pnpm lint` / `pnpm format` | ESLint (com regra de fronteira entre módulos) e Prettier      |
| `pnpm typecheck`            | Verificação de tipos em todo o monorepo                       |
| `pnpm test`                 | Testes (a API usa o banco `plataforma_test` e o Valkey db 15) |
| `pnpm build`                | Build de produção                                             |
| `pnpm db:generate`          | Gera migração a partir de mudanças no esquema                 |

O CI (GitHub Actions) roda tudo isso e, em seguida, sobe a plataforma completa no Docker e testa
login, anexos e o antivírus através do Nginx.

## Decisões de arquitetura

1. [Monólito modular](docs/adr/0001-monolito-modular.md)
2. [TypeScript de ponta a ponta com NestJS e ES modules](docs/adr/0002-typescript-nestjs.md)
3. [Sessões no servidor em vez de JWT](docs/adr/0003-sessoes-no-servidor.md)
4. [HTTP sem certificado nesta fase](docs/adr/0004-http-nesta-fase.md)
5. [Valkey em vez de Redis](docs/adr/0005-valkey.md)
6. [Organograma com caminho materializado](docs/adr/0006-organograma-caminho-materializado.md)
7. [Envio por REST, entrega por tempo real](docs/adr/0007-envio-rest-entrega-tempo-real.md)
8. [Papéis fixos com escopo na Fase 1](docs/adr/0008-papeis-com-escopo.md)
9. [Verificação em duas etapas e APP_SECRET](docs/adr/0009-mfa-totp.md)
10. [Anexos em disco com antivírus](docs/adr/0010-anexos-e-antivirus.md)
11. [Comunicados em massa como mensagens diretas](docs/adr/0011-comunicados-em-massa.md)
12. [Exclusão de usuários com anonimização](docs/adr/0012-exclusao-de-usuarios.md)
13. [Busca no PostgreSQL, sem serviço extra](docs/adr/0013-busca-postgresql.md)
14. [Reações (threads e menções retiradas)](docs/adr/0014-threads-mencoes-reacoes.md)
15. [Canais de aviso com membros pela lotação](docs/adr/0015-canais-de-aviso.md)
16. [Papéis editáveis no banco](docs/adr/0016-papeis-editaveis.md)
17. [Web Push e PWA](docs/adr/0017-web-push-pwa.md)
