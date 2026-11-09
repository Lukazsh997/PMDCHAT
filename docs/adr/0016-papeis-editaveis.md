# ADR 0016 — Papéis editáveis no banco

**Status:** aceita (05/11/2026); substitui em parte a ADR 0008

**Decisão.** O catálogo de permissões continua no código. Os papéis ficam na tabela `roles` (chave,
nome, descrição, se valem numa unidade ou no sistema todo, e lista de permissões), e
`role_assignments.role` passa a referenciá-la. A migração cria os papéis de sistema com as
permissões da Fase 1. Papel de sistema pode ter as permissões ajustadas, mas não pode ser excluído.
O super administrador não muda e tem sempre todas as permissões, inclusive as de versões futuras.

**Regras contra escalada de privilégio.**

- Só se coloca num papel, ou se atribui a alguém, o que você mesmo tem no sistema todo.
- Papel em uso não troca de escopo.
- As permissões são lidas do banco a cada requisição, sem cache, então tirar uma permissão vale na
  hora.
- Papel com `admin.access` exige verificação em duas etapas.

**Consequências.** A Fase 3 (AD) poderá mapear grupos do AD para papéis sem mudança de modelo.
