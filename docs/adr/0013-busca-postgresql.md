# ADR 0013 — Busca no PostgreSQL, sem serviço extra

**Status:** aceita (05/11/2026)

**Decisão.** A busca de mensagens usa a busca textual do próprio PostgreSQL. A coluna
`messages.body_tsv` é gerada com a configuração `pt_unaccent`: dicionário português com o filtro
`unaccent`, então "secretaria" acha "Secretária". Ela tem índice GIN. Cada palavra digitada vira
prefixo (`edit:*` acha "edital"), e o trecho destacado sai do `ts_headline` com marcadores em
texto puro, nunca HTML. Nomes de arquivos usam `unaccent` e índice de trigramas. A consulta só
alcança conversas de que a pessoa participa, a partir de quando entrou, e nunca mensagens
apagadas.

**Por quê.** Atende ao volume previsto (milhões de mensagens) sem outro serviço para operar,
copiar no backup e manter em sincronia. O plano B do documento de arquitetura (Meilisearch)
continua possível se a busca ficar lenta.

**Consequências.** A ordem dos resultados é por data, a mais recente primeiro, e não por
relevância. Abrir um resultado carrega a conversa ao redor da mensagem (`?around=seq`) e destaca
a mensagem.
