# ADR 0014 — Threads, menções e reações

**Status:** aceita (05/11/2026)

**Decisão.**

- **Threads:** a resposta é uma mensagem comum da conversa com `thread_root_id`. Ela fica fora
  da linha do tempo, da última mensagem e das não lidas, mas conta nas menções. A raiz guarda o
  número de respostas e a hora da última. Não existe resposta a resposta.
- **Menções:** o texto guarda "@Nome Completo". O servidor só aceita como mencionados os membros
  da conversa cujo nome aparece no texto, então editar e apagar o nome tira a menção. @todos
  (`messages.mentions_all`) vale em grupos de até 50 pessoas para qualquer membro. Acima disso,
  só administradores do grupo ou quem tem `messages.mention_all`.
- **Reações:** um conjunto fixo de 8 emojis, uma linha por pessoa e emoji.

**Por quê.** Guardar o nome legível no texto mantém a busca e a exportação sem códigos internos.
A checagem no servidor impede menções forjadas por requisição direta.

**Consequências.** Duas pessoas com o mesmo nome na conversa são citadas juntas.
