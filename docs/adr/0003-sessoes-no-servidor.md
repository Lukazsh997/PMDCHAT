# ADR 0003 — Sessões no servidor em vez de JWT

**Status:** aceita (03/11/2026)

**Decisão.** O cookie `plataforma_sid` (HttpOnly, SameSite=Strict) carrega só um token aleatório
de 256 bits. O Valkey guarda a sessão com expiração por inatividade (padrão 8 h) e limite
absoluto (padrão 72 h), indexada pelo SHA-256 do token. O PostgreSQL mantém o histórico para o
painel "dispositivos conectados" e a auditoria.

**Consequências.** Uma sessão pode ser encerrada na hora (logout, troca de senha, usuário
bloqueado), o que JWT não permite sem lista de revogação. Custa uma consulta ao Valkey por
requisição, desprezível nesta escala.
