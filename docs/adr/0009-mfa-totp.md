# ADR 0009 — Verificação em duas etapas (TOTP) e APP_SECRET

**Status:** aceita (04/11/2026)

**Decisão.** Códigos TOTP de 6 dígitos (RFC 6238), compatíveis com Microsoft Authenticator,
Google Authenticator, FreeOTP e Aegis, sem serviço externo. Obrigatório para quem acessa o
painel (`MFA_REQUIRED_FOR_ADMINS`). O segredo é cifrado com AES-256-GCM, com chave derivada de
`APP_SECRET`. O login com MFA usa um desafio de 5 minutos que aceita no máximo 5 códigos errados.

**Consequências.** `APP_SECRET` é obrigatório em produção e não deve mudar depois da instalação:
trocá-lo invalida os MFAs ativos (o comando `cli reset-mfa` resolve caso a caso).
