# ADR 0008 — Papéis fixos com escopo na Fase 1

**Status:** aceita (04/11/2026)

**Decisão.** O catálogo de permissões e quatro papéis (super administrador, administrador de
unidade, auditor, moderador) ficam no código (`packages/contracts/src/rbac.ts`). O banco guarda
apenas as atribuições: usuário, papel e escopo (global ou uma unidade, incluindo as de baixo).
Somente o super administrador atribui papéis, o que impede escalonamento de privilégio. Fora do
escopo, um usuário é respondido como inexistente, sem revelar quem existe em outras unidades.

**Consequências.** Regras simples de auditar e cobertas por testes. A edição de papéis
personalizados pelo painel entra na Fase 2 sem mudar as atribuições existentes.
