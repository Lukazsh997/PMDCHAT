# ADR 0005 — Valkey em vez de Redis

**Status:** aceita (03/11/2026)

**Decisão.** Sessões, limites de requisição, filas (BullMQ) e, na fase 1, o pub/sub do tempo real
usam o Valkey 8, fork do Redis mantido pela Linux Foundation sob licença BSD. O protocolo é o
mesmo, então o cliente `ioredis` funciona sem mudanças (e um Redis 7 serve em desenvolvimento).

**Consequências.** Sem restrições de licença. A política `noeviction` é obrigatória porque o
BullMQ não tolera perda de chaves; sessões e contadores expiram por TTL próprio.
