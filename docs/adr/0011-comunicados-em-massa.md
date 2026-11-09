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

**Atualização (05/11/2026, tarde).** O comunicado sai direto da lista de conversas (botão
"Comunicado"), numa única tela. Na mesma busca se escolhem pessoas e setores, e o servidor
junta todos sem repetir ninguém. Qualquer pessoa pode mandar para até 50 pessoas escolhidas uma
a uma, o que equivale a mandar mensagens individuais. Escolher setores inteiros continua
exigindo `broadcast.send`. O balão mostra para quem foi ("DCA e 3 pessoas") sem revelar os nomes.

**Atualização (05/11/2026, fim da tarde).** Todos os setores aparecem na busca de destinatários
para qualquer pessoa. A permissão `broadcast.send` deixa de bloquear a escolha do setor e passa a
definir o tamanho do envio. Com a permissão sobre todos os setores escolhidos, o limite é o geral
(5.000). Sem ela, o envio inteiro (setores e pessoas) alcança no máximo 50 pessoas, o mesmo que
mandar mensagens individuais. Antes, quem não tinha a permissão simplesmente não via o setor na
busca, sem explicação.
