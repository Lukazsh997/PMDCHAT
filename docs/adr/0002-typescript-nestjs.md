# ADR 0002 — TypeScript de ponta a ponta com NestJS e ES modules

**Status:** aceita (03/11/2026)

**Decisão.** Backend em Node.js com NestJS 12 sobre Fastify; frontend em React; validações e
tipos compartilhados em `packages/contracts` (Zod). Todos os pacotes usam ES modules, padrão das
versões atuais do NestJS, do Drizzle e do driver PostgreSQL. A API é compilada com SWC (rápido e
compatível com os decorators do NestJS); `tsc` faz apenas a verificação de tipos.

**Consequências.** Uma linguagem para todo o sistema e para o futuro cliente desktop. Imports
internos da API usam a extensão `.js`, exigência do Node.js para ES modules.
