import ldap from 'ldapjs';
import type { AddressInfo } from 'node:net';

/**
 * Um "Active Directory" de mentira para os testes: servidor LDAP (ldapjs) em memória
 * com os atributos que o AD de verdade devolve (objectGUID binário, sAMAccountName,
 * memberOf, userAccountControl, OUs e grupos).
 */
export const BASE = 'DC=orgao,DC=local';
export const SERVICE_DN = `CN=svc-chat,OU=Servicos,${BASE}`;
export const SERVICE_PASSWORD = 'servico-2026';

export interface FakePerson {
  username: string;
  displayName: string;
  /** OU onde a pessoa está, ex.: "OU=DCA,OU=SEAD". */
  ou: string;
  password?: string;
  email?: string;
  title?: string;
  groups?: string[];
  disabled?: boolean;
  /** 16 bytes; gerado a partir do login se não vier. */
  guid?: Buffer;
}

type Attrs = Record<string, string | string[] | Buffer>;
interface Entry {
  dn: string;
  attrs: Attrs;
  password?: string;
}

export class FakeAd {
  private server = ldap.createServer();
  people = new Map<string, FakePerson>();
  ous: string[] = [];
  groups: { cn: string; description?: string }[] = [];
  /** Computadores e impressoras, como o AD guarda: não podem virar pessoas. */
  computers: { name: string; ou: string }[] = [];
  printers: { name: string; ou: string }[] = [];
  /** Liga/desliga a resposta do servidor (simula o AD fora do ar). */
  down = false;
  url = '';

  async start(): Promise<void> {
    const authorized = (req: any): boolean => {
      const who = String(req.connection.ldap.bindDN ?? '').toLowerCase();
      return who !== '' && who !== 'cn=anonymous';
    };
    this.server.bind(BASE, (req: any, res: any, next: any) => {
      if (this.down) return next(new ldap.UnavailableError('fora do ar'));
      const pw = String(req.credentials ?? '');
      const target = this.entries().find((e) => ldap.parseDN(e.dn).equals(req.dn));
      if (!target || !target.password || target.password !== pw) {
        return next(new ldap.InvalidCredentialsError());
      }
      res.end();
      return next();
    });
    this.server.search(BASE, (req: any, res: any, next: any) => {
      if (this.down) return next(new ldap.UnavailableError('fora do ar'));
      if (!authorized(req)) return next(new ldap.InsufficientAccessRightsError());
      for (const e of this.entries()) {
        const dn = ldap.parseDN(e.dn);
        if (!dn.equals(req.dn) && !dn.childOf(req.dn)) continue;
        if (!req.filter.matches(lowerKeys(e.attrs), false)) continue;
        // Devolve os atributos com o nome como o AD escreve (o ldapjs filtraria em minúsculas).
        const wanted = new Set((req.attributes as string[]).map((a) => a.toLowerCase()));
        const attributes = wanted.size
          ? Object.fromEntries(Object.entries(e.attrs).filter(([k]) => wanted.has(k.toLowerCase())))
          : e.attrs;
        res.attributes = ['*'];
        res.send({ dn: e.dn, attributes }, true);
      }
      res.end();
      return next();
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = (this.server as unknown as { address(): AddressInfo }).address();
    this.url = `ldap://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  reset(): void {
    this.people.clear();
    this.ous = [];
    this.groups = [];
    this.computers = [];
    this.printers = [];
    this.down = false;
  }

  add(...people: FakePerson[]): void {
    for (const p of people) this.people.set(p.username, p);
  }

  personDn(p: FakePerson): string {
    return `CN=${p.displayName},${p.ou},${BASE}`;
  }

  groupDn(cn: string): string {
    return `CN=${cn},OU=Grupos,${BASE}`;
  }

  private entries(): Entry[] {
    const out: Entry[] = [
      {
        dn: SERVICE_DN,
        attrs: { objectClass: ['top', 'person', 'user'], cn: 'svc-chat' },
        password: SERVICE_PASSWORD,
      },
    ];
    for (const ou of this.ous) {
      const name = ou.split(',')[0]!.slice(3);
      out.push({
        dn: `${ou},${BASE}`,
        attrs: { objectClass: ['top', 'organizationalUnit'], ou: name },
      });
    }
    for (const g of this.groups) {
      out.push({
        dn: this.groupDn(g.cn),
        attrs: {
          objectClass: ['top', 'group'],
          cn: g.cn,
          ...(g.description ? { description: g.description } : {}),
        },
      });
    }
    for (const c of this.computers) {
      // No AD, computador também é objectClass=user; o que muda é o objectCategory.
      out.push({
        dn: `CN=${c.name},${c.ou},${BASE}`,
        attrs: {
          objectClass: ['top', 'person', 'organizationalPerson', 'user', 'computer'],
          objectCategory: 'computer',
          objectGUID: guidFor(`pc:${c.name}`),
          sAMAccountName: c.name.toLowerCase(),
          cn: c.name,
          userAccountControl: '4096',
        },
      });
    }
    for (const p of this.printers) {
      out.push({
        dn: `CN=${p.name},${p.ou},${BASE}`,
        attrs: {
          objectClass: ['top', 'leaf', 'connectionPoint', 'printQueue'],
          objectCategory: 'printQueue',
          cn: p.name,
          printerName: p.name,
        },
      });
    }
    for (const p of this.people.values()) {
      out.push({
        dn: this.personDn(p),
        password: p.password ?? 'senhaDoAd2026',
        attrs: {
          objectClass: ['top', 'person', 'organizationalPerson', 'user'],
          objectCategory: 'person',
          objectGUID: p.guid ?? guidFor(p.username),
          sAMAccountName: p.username,
          cn: p.displayName,
          displayName: p.displayName,
          ...(p.email ? { mail: p.email } : {}),
          ...(p.title ? { title: p.title } : {}),
          memberOf: (p.groups ?? []).map((g) => this.groupDn(g)),
          userAccountControl: String(p.disabled ? 514 : 512),
          accountExpires: '9223372036854775807',
        },
      });
    }
    return out;
  }
}

/** GUID estável por login (para os testes conferirem o vínculo). */
export function guidFor(username: string): Buffer {
  const b = Buffer.alloc(16);
  Buffer.from(username).copy(b);
  return b;
}

function lowerKeys(a: Attrs): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) {
    o[k.toLowerCase()] = Buffer.isBuffer(v) ? v.toString('hex') : v;
  }
  return o;
}
