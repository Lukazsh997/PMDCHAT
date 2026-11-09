# ADR 0012 — Exclusão de usuários com anonimização

**Status:** aceita (05/11/2026)

**Decisão.** Somente o super administrador exclui usuários (permissão `users.delete`), digitando
o login para confirmar. A exclusão é lógica: a pessoa sai do diretório, do organograma e do
painel, as sessões são encerradas, e o login é liberado para reuso. E-mail, senha, segredo do
MFA, foto, identificador do AD e papéis são apagados. O registro do usuário e o nome continuam
existindo para que as conversas e a auditoria permaneçam legíveis.

**Por quê.** As mensagens trocadas num órgão público são documentos e precisam ser preservadas
(Lei de Acesso à Informação e normas de arquivo). Apagar o registro em cascata apagaria
mensagens de outras pessoas e quebraria a trilha de auditoria. Apagar os dados de contato e as
credenciais atende à minimização da LGPD.

**Consequências.** A conversa com uma pessoa excluída continua visível para quem participou dela,
mas fica sem a caixa de envio. Nos grupos, ela deixa de aparecer na lista de participantes, e as
mensagens antigas mantêm o nome dela.
