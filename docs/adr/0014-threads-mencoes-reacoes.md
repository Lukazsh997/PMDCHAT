# ADR 0014 — Threads, menções e reações

**Status:** aceita (05/11/2026); threads e menções foram retiradas no mesmo dia (ver o fim)

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

**Atualização (05/11/2026): threads retiradas.** A pedido da organização, as threads saíram do
produto. Toda resposta volta a ser uma mensagem comum na conversa. A migração `0010` apaga
`thread_root_id`, `reply_count` e `last_reply_at`. Respostas que já existiam passam a aparecer
na conversa principal, na ordem em que foram enviadas, sem perda de conteúdo.

**Atualização (05/11/2026): menções retiradas e reação única.** As menções também saíram: "@Nome"
volta a ser texto comum, sem sugestão, aba, contador ou aviso especial. A migração `0011` apaga
`message_mentions` e `messages.mentions_all`, tira a permissão `messages.mention_all` dos papéis
e converte o nível de aviso "só menções" em "nenhuma". As reações passam a ser **uma por pessoa
em cada mensagem**: escolher outro emoji troca a anterior e tocar no mesmo retira. A chave da
tabela vira (mensagem, pessoa); de quem tinha mais de uma, fica a mais recente.
