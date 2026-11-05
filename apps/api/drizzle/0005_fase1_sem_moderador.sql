-- Regra nova: ninguém apaga mensagem de outra pessoa. O papel "moderador" deixa de existir.
DELETE FROM "role_assignments" WHERE "role" = 'moderator';
