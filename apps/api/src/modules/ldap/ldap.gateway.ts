import { usernameSchema } from '@plataforma/contracts';
import {
  Client,
  type ClientOptions,
  EqualityFilter,
  type Entry,
  InvalidCredentialsError,
} from 'ldapts';
import type { ConnectionOptions } from 'node:tls';

/** O que a integração precisa saber para falar com o AD (senha já decifrada). */
export interface DirectoryConfig {
  url: string;
  startTls: boolean;
  tlsVerify: boolean;
  caCert: string | null;
  bindDn: string;
  bindPassword: string;
  baseDn: string;
  userFilter: string;
  usernameAttribute: string;
  displayNameAttribute: string;
  emailAttribute: string;
  jobTitleAttribute: string;
}

/** Pessoa como vem do AD, já normalizada. */
export interface DirectoryPerson {
  /** objectGUID no formato de texto do Windows. */
  guid: string;
  dn: string;
  username: string;
  displayName: string;
  email: string | null;
  jobTitle: string | null;
  /** DNs dos grupos (memberOf), em minúsculas. */
  groups: string[];
  /** Conta desativada ou expirada no AD. */
  disabled: boolean;
}

export interface DirectoryOu {
  dn: string;
  name: string;
}

export interface DirectoryGroup {
  dn: string;
  name: string;
  description: string | null;
}

/** O AD não respondeu (rede, certificado, conta de serviço): o login local continua. */
export class DirectoryUnavailableError extends Error {}

const PAGE = { pageSize: 500 };
const ACCOUNTDISABLE = 0x2;
/** accountExpires: 0 e este valor significam "nunca expira". */
const NEVER = 9223372036854775807n;

/**
 * Acesso ao Active Directory por LDAP (ldapts). Cada operação abre a conexão, entra
 * com a conta de serviço (só leitura), faz o que precisa e fecha: nada fica aberto.
 */
export class LdapGateway {
  constructor(private readonly cfg: DirectoryConfig) {}

  /** Confere a conexão e a conta de serviço; devolve quantas pessoas a busca encontra. */
  async test(): Promise<{ count: number; sample: DirectoryPerson[]; skipped: number }> {
    const { people, skipped } = await this.listPeople();
    return { count: people.length, sample: people.slice(0, 5), skipped };
  }

  /** Todas as pessoas que a busca configurada encontra, com paginação (o AD limita a 1.000). */
  async listPeople(): Promise<{ people: DirectoryPerson[]; skipped: number }> {
    return this.withServiceBind(async (client) => {
      const { searchEntries } = await client.search(this.cfg.baseDn, {
        scope: 'sub',
        filter: this.cfg.userFilter,
        attributes: this.attributes(),
        explicitBufferAttributes: ['objectGUID'],
        paged: PAGE,
      });
      const people: DirectoryPerson[] = [];
      let skipped = 0;
      for (const e of searchEntries) {
        const p = this.toPerson(e);
        if (p) people.push(p);
        else skipped++;
      }
      return { people, skipped };
    });
  }

  async findPerson(username: string): Promise<DirectoryPerson | null> {
    return this.withServiceBind(async (client) => {
      // O valor digitado entra escapado (RFC 4515): "*" ou ")" não viram parte do filtro.
      const byName = new EqualityFilter({ attribute: this.cfg.usernameAttribute, value: username });
      const filter = `(&${this.cfg.userFilter}${byName.toString()})`;
      const { searchEntries } = await client.search(this.cfg.baseDn, {
        scope: 'sub',
        filter,
        attributes: this.attributes(),
        explicitBufferAttributes: ['objectGUID'],
        sizeLimit: 2,
      });
      // Duas contas com o mesmo login: ambíguo, ninguém entra por aqui.
      if (searchEntries.length !== 1) return null;
      return this.toPerson(searchEntries[0]!);
    });
  }

  /**
   * Confere a senha entrando no AD como a própria pessoa. Senha vazia nunca é aceita:
   * no LDAP, "entrar sem senha" é uma conexão anônima que o servidor aceitaria.
   */
  async verifyPassword(dn: string, password: string): Promise<boolean> {
    if (!password) return false;
    const client = await this.connect();
    try {
      await client.bind(dn, password);
      return true;
    } catch (e) {
      if (e instanceof InvalidCredentialsError) return false;
      throw unavailable(e);
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  async listOus(): Promise<DirectoryOu[]> {
    return this.withServiceBind(async (client) => {
      const { searchEntries } = await client.search(this.cfg.baseDn, {
        scope: 'sub',
        filter: '(objectClass=organizationalUnit)',
        attributes: ['ou', 'name'],
        paged: PAGE,
      });
      return searchEntries.map((e) => ({
        dn: e.dn,
        name: first(e.ou) ?? first(e.name) ?? rdnValue(e.dn),
      }));
    });
  }

  async listGroups(): Promise<DirectoryGroup[]> {
    return this.withServiceBind(async (client) => {
      const { searchEntries } = await client.search(this.cfg.baseDn, {
        scope: 'sub',
        filter: '(objectClass=group)',
        attributes: ['cn', 'description'],
        paged: PAGE,
      });
      return searchEntries.map((e) => ({
        dn: e.dn,
        name: first(e.cn) ?? rdnValue(e.dn),
        description: first(e.description) ?? null,
      }));
    });
  }

  private attributes(): string[] {
    const c = this.cfg;
    return [
      'objectGUID',
      c.usernameAttribute,
      c.displayNameAttribute,
      c.emailAttribute,
      c.jobTitleAttribute,
      'memberOf',
      'userAccountControl',
      'accountExpires',
      'cn',
    ];
  }

  private toPerson(e: Entry): DirectoryPerson | null {
    const c = this.cfg;
    const guidRaw = e.objectGUID;
    const guid = Buffer.isBuffer(guidRaw)
      ? guidToString(guidRaw)
      : Array.isArray(guidRaw) && Buffer.isBuffer(guidRaw[0])
        ? guidToString(guidRaw[0])
        : null;
    const parsed = usernameSchema.safeParse(first(e[c.usernameAttribute]) ?? '');
    if (!guid || !parsed.success) return null;
    const uac = Number(first(e.userAccountControl) ?? 0);
    const expires = BigInt(first(e.accountExpires) ?? '0');
    const expired = expires > 0n && expires < NEVER && fileTimeToMs(expires) < Date.now();
    return {
      guid,
      dn: e.dn,
      username: parsed.data,
      displayName: (first(e[c.displayNameAttribute]) ?? first(e.cn) ?? parsed.data).slice(0, 160),
      email: first(e[c.emailAttribute])?.slice(0, 254) || null,
      jobTitle: first(e[c.jobTitleAttribute])?.slice(0, 160) || null,
      groups: all(e.memberOf).map((g) => g.toLowerCase()),
      disabled: (uac & ACCOUNTDISABLE) !== 0 || expired,
    };
  }

  private async withServiceBind<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.connect();
    try {
      await client.bind(this.cfg.bindDn, this.cfg.bindPassword);
    } catch (e) {
      await client.unbind().catch(() => undefined);
      if (e instanceof InvalidCredentialsError) {
        throw new DirectoryUnavailableError(
          'O AD recusou a conta de serviço: confira o DN e a senha.',
        );
      }
      throw unavailable(e);
    }
    try {
      return await fn(client);
    } catch (e) {
      if (e instanceof DirectoryUnavailableError) throw e;
      throw unavailable(e);
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  private async connect(): Promise<Client> {
    const tls: ConnectionOptions = {
      rejectUnauthorized: this.cfg.tlsVerify,
      ...(this.cfg.caCert ? { ca: [this.cfg.caCert] } : {}),
    };
    const options: ClientOptions = {
      url: this.cfg.url,
      timeout: 15_000,
      connectTimeout: 8_000,
      ...(this.cfg.url.toLowerCase().startsWith('ldaps:') ? { tlsOptions: tls } : {}),
    };
    const client = new Client(options);
    if (this.cfg.startTls) {
      try {
        await client.startTLS(tls);
      } catch (e) {
        await client.unbind().catch(() => undefined);
        throw unavailable(e);
      }
    }
    return client;
  }
}

function unavailable(e: unknown): DirectoryUnavailableError {
  const msg = e instanceof Error ? e.message : String(e);
  return new DirectoryUnavailableError(`Não foi possível falar com o Active Directory: ${msg}`);
}

const first = (v: unknown): string | undefined => {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === 'string' ? x : Buffer.isBuffer(x) ? x.toString('utf8') : undefined;
};
const all = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter(
    (x): x is string => typeof x === 'string',
  );

/** Valor do primeiro componente do DN: "OU=Saúde,DC=…" → "Saúde". */
export function rdnValue(dn: string): string {
  const head = dn.split(/(?<!\\),/)[0] ?? dn;
  return head.slice(head.indexOf('=') + 1).replace(/\\(.)/g, '$1');
}

/** DN do "pai": "CN=João,OU=DCA,OU=SEAD,DC=x" → "ou=dca,ou=sead,dc=x" (em minúsculas). */
export function parentDn(dn: string): string {
  const i = dn.search(/(?<!\\),/);
  return (i < 0 ? '' : dn.slice(i + 1)).trim().toLowerCase();
}

/**
 * objectGUID do AD em texto: os três primeiros blocos ficam em ordem invertida
 * (little-endian), os dois últimos na ordem dos bytes.
 */
export function guidToString(b: Buffer): string {
  if (b.length !== 16) return b.toString('hex');
  const hex = (from: number, to: number, reverse: boolean) => {
    const part = [...b.subarray(from, to)];
    return (reverse ? part.reverse() : part).map((x) => x.toString(16).padStart(2, '0')).join('');
  };
  return [
    hex(0, 4, true),
    hex(4, 6, true),
    hex(6, 8, true),
    hex(8, 10, false),
    hex(10, 16, false),
  ].join('-');
}

/** Data do Windows (100 ns desde 1601) → milissegundos desde 1970. */
function fileTimeToMs(ft: bigint): number {
  return Number(ft / 10_000n - 11_644_473_600_000n);
}
