# ADR 0015 — Canais de aviso com membros pela lotação

**Status:** aceita (05/11/2026)

**Decisão.** O canal é um grupo com `is_channel`: só o dono e os administradores publicam e
respondem em thread; os demais leem e reagem. Quem entra vê os avisos anteriores. Um canal pode
ser ligado a uma unidade (com ou sem subunidades). Nesse caso, os membros marcados como
`auto_joined` são mantidos por sincronização. Ela roda ao criar o canal, quando alguém muda de
lotação ou de situação (evento `user.membership_changed`) e quando o organograma muda
(`org.changed`). Membros automáticos não saem nem são removidos à mão, mas podem silenciar. Criar
canal exige `conversations.create_channel` sobre a unidade.

**Por quê.** Reaproveita grupos (membros, menções, busca e notificações), e o organograma vira a
lista de distribuição sem manutenção manual.

**Consequências.** Comunicados avulsos continuam existindo (ADR 0011). O canal serve para avisos
recorrentes de uma unidade; o comunicado, para disparos pontuais com resposta privada.
