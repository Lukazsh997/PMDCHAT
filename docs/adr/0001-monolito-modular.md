# ADR 0001 — Monólito modular

**Status:** aceita (03/11/2026)

**Contexto.** A plataforma atende alguns milhares de usuários numa única VM, mantida por uma
equipe pequena. Precisa crescer em funcionalidades sem virar um sistema difícil de manter.

**Decisão.** Um único código de backend, organizado em módulos por domínio (`auth`, `users`,
`audit`, …) em `apps/api/src/modules`. Cada módulo expõe apenas o que está no seu `index.ts`; o
ESLint impede importar arquivos internos de outro módulo. O mesmo código roda em dois papéis:
`api` (HTTP/WebSocket) e `worker` (tarefas assíncronas).

**Consequências.** Implantação e depuração simples, sem custo de rede entre serviços. Se um
módulo precisar escalar sozinho, as fronteiras já existem para extraí-lo.
