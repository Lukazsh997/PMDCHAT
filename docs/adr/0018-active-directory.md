# ADR 0018 — Integração com o Active Directory

**Status:** aceita (05/11/2026)

**Decisão.** O AD é a fonte das contas de quem trabalha no órgão. A integração usa LDAP com a
biblioteca `ldapts` (MIT), sem agente instalado no AD e sem gravar nada nele: a conta de serviço
só lê.

- **Login:** quem tem conta do AD entra com o login da rede (`joao`, `ORGAO\joao` ou
  `joao@orgao.local`) e a senha do AD. A API procura a pessoa com a conta de serviço (o login
  digitado entra escapado no filtro, RFC 4515) e confere a senha com um bind como a própria
  pessoa. Senha vazia é recusada antes (no LDAP, bind sem senha é anônimo e seria aceito). A
  senha local dessas contas deixa de valer; trocar ou redefinir senha pelo sistema é recusado.
- **Criação no 1º login (opcional):** quem está no AD e ainda não tem conta é criado ao entrar,
  com a lotação e os papéis vindos do AD.
- **Vínculo:** pelo `objectGUID` (não muda com renomeação ou troca de OU). Uma conta local com o
  mesmo login passa a ser do AD na primeira sincronização. O super administrador local nunca é
  ligado ao AD: fica como acesso de emergência, com a senha própria.
- **Lotação:** cada OU pode ser ligada a uma unidade do organograma; vale a OU mais próxima da
  pessoa que tiver unidade. Sem nenhuma, vale a unidade padrão ou fica a lotação atual.
- **Papéis:** regras "grupo do AD → papel (numa unidade)". A sincronização só mexe nos papéis que
  ela deu (`role_assignments.source = 'ldap'`); os atribuídos à mão ficam. Super administrador
  nunca vem de grupo.
- **Desativação:** conta desativada ou expirada no AD, ou que sumiu da busca, é desativada aqui
  e perde as sessões na hora. Volta a ficar ativa se reaparecer — a menos que tenha sido
  desativada à mão no painel.
- **Trava de segurança:** se a sincronização fosse desativar mais de 30% das contas do AD (e mais
  de 5), ou se a busca voltasse vazia, ela para sem gravar nada ("parada") e só segue com
  confirmação no painel. Isso protege contra base de busca errada ou AD respondendo pela metade.
- **Agenda:** a sincronização roda no processo da API, por um agendamento do BullMQ (um só
  mesmo com várias instâncias) que verifica a cada 5 minutos se o intervalo configurado passou;
  uma trava no Valkey impede duas ao mesmo tempo. Fica na API, e não no worker, porque as
  consequências — canais de unidade acompanharem a nova lotação, sessões caírem no tempo real —
  são eventos de domínio que vivem na API.
- **Segredo:** a senha da conta de serviço fica cifrada com `APP_SECRET` (como os segredos do
  MFA) e nunca volta para a tela nem para a auditoria.

**Consequências.** A comunicação com o AD deve usar LDAPS (636) ou StartTLS: a senha das pessoas
passa por ela. Com o AD fora do ar, as contas do AD não entram (resposta 503 com mensagem clara)
e as contas locais continuam funcionando. Desligar a integração impede o login das contas do AD
sem apagá-las. O MFA continua valendo para quem administra, inclusive contas do AD.
