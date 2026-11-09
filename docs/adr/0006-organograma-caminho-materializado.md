# ADR 0006 — Organograma com caminho materializado

**Status:** aceita (04/11/2026)

**Contexto.** Permissões de unidade valem para a unidade e para todas as de baixo. A pergunta
"esta pessoa está dentro da unidade X?" aparece em quase toda tela do painel.

**Decisão.** Cada unidade guarda `path = /<id-raiz>/…/<id>/`. Descendentes de X são
`path LIKE 'caminho-de-X%'`, com índice `text_pattern_ops`. Mover uma unidade reescreve o caminho
de toda a subárvore numa única instrução, dentro de uma transação. Optou-se por texto em vez da
extensão `ltree` para depender só de extensões confiáveis (`pg_trgm`, `unaccent`), que o dono do
banco cria sem privilégio de superusuário.

**Consequências.** Consultas de escopo simples e rápidas. Mover unidades grandes custa uma
atualização proporcional ao tamanho da subárvore, operação rara.
