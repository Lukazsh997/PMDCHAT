# ADR 0011 — Comunicados em massa como mensagens diretas

**Status:** aceita (05/11/2026)

**Decisão.** Um comunicado para uma unidade (com ou sem as subunidades) é entregue como uma
mensagem na conversa direta entre quem enviou e cada pessoa ativa da unidade, no modelo de
"lista de transmissão". Cada envio fica registrado na tabela `broadcasts` e cada mensagem
aponta para ele (`messages.broadcast_id`), o que mostra no balão "Comunicado para…". Enviar
exige a permissão `broadcast.send` sobre a unidade: o super administrador pode em qualquer uma,
e o administrador de unidade e o novo papel **Comunicador** podem na unidade em que receberam o
papel e abaixo dela. O envio é idempotente pelo `clientId`, limitado a 5.000 destinatários e
auditado (`broadcast.sent`).

**Por quê.** Reaproveita tudo o que as conversas diretas já têm: tempo real, notificação,
não lidas, confirmação de leitura, anexos com controle de acesso e retenção. A resposta vai só
para quem enviou, e ninguém vê a lista de destinatários. Um canal de grupo por unidade exigiria
manter a lista de membros sincronizada com o organograma e exporia as respostas a todos.

**Consequências.** Quem envia não ganha uma conversa por destinatário na lista: a conversa
direta só aparece para quem enviou quando houver algo além dos próprios comunicados (uma
resposta, por exemplo). Os anexos são gravados uma vez e ligados a todas as mensagens.
