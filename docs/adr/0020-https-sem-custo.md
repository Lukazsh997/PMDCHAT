# ADR 0020 — HTTPS sem custo

**Status:** aceita (07/11/2026). Substitui a [ADR 0004](0004-http-nesta-fase.md).

**Contexto.** O sistema começou em HTTP por decisão da organização. Num órgão público, senhas (do
AD, desde a Fase 3) e mensagens internas não devem trafegar abertas na rede, e o Chrome só libera
notificações, Web Push e instalação como aplicativo em HTTPS. Certificados de ACs públicas não
servem para nomes internos (`.local`) nem para IPs da rede.

**Decisão.** HTTPS por certificado de uma AC que as estações já confiam ou passam a confiar por GPO,
sem custo:

- **AC interna da plataforma** (`infra/scripts/https.sh interna`): AC própria, gerada na VM, com
  **restrição de nomes** (`nameConstraints`) ao domínio do sistema e às faixas de IP privadas.
  Distribuída às estações por GPO, ela não consegue emitir certificados válidos para outros sites,
  mesmo se a chave vazar. A chave da AC fica fora do contêiner (`infra/nginx/ca`, só root) e entra
  no backup. Certificado do site com 825 dias e renovação automática pelo cron (`renovar-auto`).
- **AC existente** (`https.sh importar`): AD CS da organização ou Let's Encrypt (domínio público).
- O Nginx escolhe HTTP ou HTTPS na subida, pela presença do certificado (`40-plataforma.sh`). Com
  HTTPS: porta 80 só redireciona (e serve o certificado público da AC e o healthcheck), TLS 1.2+,
  HSTS de 180 dias, cookie de sessão `Secure`.

**Consequências.**

- Ligar o HTTPS é um comando na VM e uma GPO; não há mudança de código nem custo.
- As estações fora do domínio precisam importar o certificado da AC à mão.
- Desligar o HTTPS depois é possível, mas navegadores que já o viram insistem por até 180 dias
  (HSTS).
