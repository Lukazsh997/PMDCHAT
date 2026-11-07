# ADR 0004 — HTTP sem certificado nesta fase

**Status:** substituída pela [ADR 0020](0020-https-sem-custo.md) (07/11/2026). Era: aceita (03/11/2026), por decisão da organização

**Decisão.** O site roda em HTTP na rede interna. O cookie de sessão não usa o atributo
`Secure` e a API não envia HSTS; ambos são ligados por configuração (`COOKIE_SECURE=true`).
O código não depende de APIs do navegador restritas a contexto seguro nas funções essenciais.

**Consequências.**

- Senhas e mensagens trafegam sem cifra na rede interna: a VM deve ficar em segmento restrito.
- Notificações, Service Worker, Web Push e PWA exigem a política do Chrome
  `OverrideSecurityRestrictionsOnInsecureOrigin` via GPO (ver `docs/implantacao.md`).
- Ativar HTTPS depois não exige mudança de código.
