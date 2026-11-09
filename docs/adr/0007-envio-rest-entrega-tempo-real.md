# ADR 0007 — Envio por REST, entrega por tempo real

**Status:** aceita (04/11/2026). Ajusta a seção 6 do documento de arquitetura.

**Decisão.** O navegador envia mensagens por `POST /conversations/:id/messages` com um `clientId`
gerado por ele; a conexão Socket.IO serve para **receber** eventos (mensagem nova, edição,
leitura, presença, digitação). Depois de gravar, a API publica um evento de domínio que o módulo
de tempo real entrega aos membros, em todas as instâncias, pelo adaptador do Valkey.

**Por quê.** Um único caminho para validação, limite de requisições, auditoria e confirmação; o
`clientId` torna o reenvio após queda de rede idempotente; a latência é a mesma (conexão HTTP
reaproveitada). O padrão Outbox fica para quando houver consumidores assíncronos que não podem
perder eventos (e-mail e Web Push, Fase 2).

**Consequências.** Ao reconectar, o cliente recarrega a lista e as mensagens abertas para cobrir o
intervalo sem conexão. Sessões encerradas derrubam as conexões na hora (evento) e uma
revalidação a cada minuto cobre encerramentos feitos por outro processo, como a CLI.
