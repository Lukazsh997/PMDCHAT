# ADR 0019 — Lista de lotação importada

**Status:** aceita (06/11/2026)

**Contexto.** No AD do órgão, as OUs são só os setores (com pastas COMPUTADORES, IMPRESSORAS e
USUÁRIOS). A hierarquia secretaria → setor e a lotação de cada pessoa estão em outro sistema, que
exporta uma tabela com login, nome, secretaria, setor e código do setor.

**Decisão.** O painel importa essa tabela (Administração → Lotação), em .sql (INSERTs ou COPY) ou
.csv. O arquivo é só lido como texto: nenhum SQL é executado, e só login, nome, secretaria, setor e
código do setor são usados — senhas, fotos e as demais colunas são descartadas na leitura.

- **Setores pelo código.** O nome da secretaria pode variar para o mesmo setor (exportações de
  sistemas antigos costumam ter a secretaria desatualizada na linha da pessoa). Cada setor fica na
  secretaria em que mais aparece; a prévia mostra os casos em que ele aparece em mais de uma, e o
  administrador escolhe.
- **Secretarias.** Cada nome do arquivo vira uma unidade existente (sugerida pelo nome ou sigla,
  inclusive "ADMINISTRAÇÃO" ↔ "Secretaria Municipal de Administração"), uma secretaria nova ou
  "a mesma que" outro nome do arquivo (ex.: FAZENDA = SMF). Unidades que já existem são reusadas:
  importar de novo não duplica nada.
- **A lista manda na lotação e em quem tem conta pelo AD.** Depois da importação, a lotação deixa
  de vir das OUs (`ldap_settings.org_unit_source = 'roster'`): a sincronização e o 1º login usam o
  setor da lista, e quem é do AD e não está na lista não ganha conta nem entra. Quem já tinha conta
  pelo AD e ficou fora é excluído (ou só desativado, à escolha de quem importa). Contas locais e o
  super administrador nunca são removidos.
- **Trava:** remover mais de 30% das contas do AD (e mais de 5) exige confirmação explícita.
- **Volta atrás:** "Voltar a usar as OUs do AD" desliga a lista (ela fica guardada).

**Consequências.** A lista precisa ser reimportada quando o outro sistema mudar (pessoas novas só
entram no chat depois de estar na lista). A lista guardada tem só login, nome e setor.
