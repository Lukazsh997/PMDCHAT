# ADR 0017 — Web Push e PWA

**Status:** aceita (05/11/2026)

**Decisão.** Os avisos com a aba fechada usam Web Push padrão (VAPID, biblioteca `web-push`); no
Chrome, a entrega passa pelo FCM, como decidido no documento de arquitetura.

- **Chaves:** geradas na primeira subida e guardadas em `system_settings`, assim API e worker
  usam as mesmas e as inscrições sobrevivem a atualizações.
- **Inscrição:** uma por navegador, ligada à sessão; o logout ou o encerramento da sessão a
  apaga.
- **Decisão de quem recebe:** fica no worker (fila `push`). Recebe quem não está com nenhuma aba
  aberta (quem está recebe pelo tempo real), conforme o nível de aviso da conversa (padrão:
  diretas e canais avisam tudo, grupos com mais de 50 pessoas avisam só menções). Conversa
  silenciada só avisa menções. Numa thread, só quem foi citado ou abriu a thread.
- **Conteúdo:** o texto enviado tem no máximo 140 caracteres e vai cifrado (RFC 8291).

A interface é instalável (manifest e ícones), e o service worker não guarda páginas em cache: o
sistema depende do servidor.

**Consequências.** Em HTTP, tudo isso depende da política `OverrideSecurityRestrictionsOnInsecureOrigin`.
A VM precisa de saída para `fcm.googleapis.com` (ou de `PUSH_PROXY`). O cliente desktop (Fase 4)
terá notificações nativas, sem depender do FCM.
