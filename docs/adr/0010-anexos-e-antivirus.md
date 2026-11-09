# ADR 0010 — Anexos em disco com antivírus

**Status:** aceita (04/11/2026)

**Decisão.** Arquivos ficam no volume `filesdata` (`/data/files`), organizados por ano e mês, com
nome igual ao id (nunca o nome enviado). Em cada upload: bloqueio pela extensão e pelo tipo real
do conteúdo, verificação no ClamAV (protocolo INSTREAM), reprocessamento de imagens (orientação
aplicada, metadados removidos) e miniatura WebP. Downloads sempre pela API, conferindo se a pessoa
participa da conversa, com `Content-Security-Policy: sandbox`. Uploads nunca anexados são
apagados em 24 h; anexos de mensagens excluídas, em 48 h.

**Consequências.** Sem dependência de armazenamento externo. A camada de arquivos pode passar a um
servidor compatível com S3 (Garage, SeaweedFS) quando o volume exigir.
