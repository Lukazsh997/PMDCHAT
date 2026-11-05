# ADR 0008 — Papéis fixos com escopo na Fase 1

**Status:** aceita (04/11/2026)

**Decisão.** O catálogo de permissões e quatro papéis (super administrador, administrador de
unidade, auditor, moderador) ficam no código (`packages/contracts/src/rbac.ts`). O banco guarda
apenas as atribuições: usuário, papel e escopo (global ou uma unidade, incluindo as de baixo).
Somente o super administrador atribui papéis, o que impede escalonamento de privilégio. Fora do
escopo, um usuário é respondido como inexistente, sem revelar quem existe em outras unidades.

**Atualização (05/11/2026).** Entram o papel Comunicador (com escopo, só `broadcast.send`) e as
permissões `broadcast.send` (também do administrador de unidade) e `users.delete` (só do super
administrador). Ver ADRs 0011 e 0012.

**Atualização (05/11/2026, tarde).** Regra nova: só o autor edita ou apaga a própria mensagem,
até 10 minutos após o envio. A permissão `messages.delete_any` e o papel moderador foram
retirados, e a migração `0005` remove as atribuições existentes. O dono ou o administrador do
grupo também não apaga mais mensagens de outras pessoas.

**Consequências.** Regras simples de auditar e cobertas por testes. A edição de papéis
personalizados pelo painel entra na Fase 2 sem mudar as atribuições existentes.
