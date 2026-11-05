/**
 * Autenticação por um diretório externo (o Active Directory, na Fase 3). O módulo de
 * autenticação não conhece o LDAP: só pergunta a quem implementar esta interface.
 */
export interface ExternalAuthenticator {
  /**
   * Confere usuário e senha no diretório. Se a pessoa ainda não existe no sistema e a
   * criação automática está ligada, cria a conta.
   * - `{ userId }`: senha certa;
   * - `'invalid'`: usuário ou senha errados (ou conta desativada no diretório);
   * - `'not_provisioned'`: senha certa, mas a conta não existe aqui e não pode ser criada;
   * - `null`: integração desligada.
   * Lança `ExternalAuthUnavailableError` se o diretório não responder.
   */
  authenticate(
    username: string,
    password: string,
  ): Promise<{ userId: string } | 'invalid' | 'not_provisioned' | null>;
}

export const EXTERNAL_AUTH = Symbol('EXTERNAL_AUTH');

export class ExternalAuthUnavailableError extends Error {}
