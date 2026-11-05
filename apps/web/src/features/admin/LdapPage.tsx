import {
  LDAP_DEFAULTS,
  type LdapChange,
  type LdapGroup,
  type LdapPreview,
  type LdapSettings,
  type LdapSyncRun,
  type OrgUnit,
  type RoleDefinition,
  type UpdateLdapSettingsRequest,
} from '@plataforma/contracts';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Plus,
  RefreshCw,
  Trash2,
  Wand2,
  XCircle,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { Alert, Button, Dialog, Select, Spinner, TextField, toast } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { useOrgUnits, useRoles } from './admin-api';
import {
  useLdapGroups,
  useLdapMutations,
  useLdapOus,
  useLdapRuns,
  useLdapSettings,
} from './ldap-api';
import { OrgUnitSelect } from './OrgUnitSelect';

/**
 * Painel → Active Directory: conexão, OUs → unidades, grupos → papéis e sincronização.
 * Fica numa página só, na ordem em que a configuração é feita.
 */
export function LdapPage() {
  const settings = useLdapSettings();
  if (settings.isPending) {
    return (
      <div className="px-6 py-6">
        <Spinner label="Carregando configuração" />
      </div>
    );
  }
  if (settings.isError) {
    return (
      <div className="px-6 py-6">
        <Alert tone="error">{settings.error.message}</Alert>
      </div>
    );
  }
  const s = settings.data;
  const connected = !!(s.url && s.baseDn && s.bindDn && s.hasBindPassword);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
      <div>
        <h2 className="text-lg font-bold">Active Directory</h2>
        <p className="text-sm text-muted">
          Com a integração ligada, as pessoas entram com o login e a senha da rede (os mesmos do
          Windows). Nome, e-mail, cargo, lotação e papéis vêm do AD. O super administrador local
          continua entrando com a senha própria, como acesso de emergência.
        </p>
      </div>
      <ConnectionSection settings={s} />
      <OuSection enabled={connected} />
      <GroupSection enabled={connected} />
      <SyncSection settings={s} connected={connected} />
    </div>
  );
}

function Section({
  title,
  description,
  step,
  actions,
  children,
}: {
  title: string;
  description: ReactNode;
  step: number;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`ldap-step-${step}`}
      className="rounded-[var(--radius-panel)] border border-line bg-surface"
    >
      <header className="flex flex-wrap items-start gap-3 border-b border-line px-5 py-4">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-ink"
        >
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={`ldap-step-${step}`} className="font-bold">
            {title}
          </h3>
          <p className="text-sm text-muted">{description}</p>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/* --------------------------------- Conexão -------------------------------- */

type Form = Omit<UpdateLdapSettingsRequest, 'caCert'> & { caCert: string };

const toForm = (s: LdapSettings): Form => ({
  enabled: s.enabled,
  url: s.url,
  startTls: s.startTls,
  tlsVerify: s.tlsVerify,
  caCert: s.caCert ?? '',
  bindDn: s.bindDn,
  bindPassword: '',
  baseDn: s.baseDn,
  userFilter: s.userFilter,
  usernameAttribute: s.usernameAttribute,
  displayNameAttribute: s.displayNameAttribute,
  emailAttribute: s.emailAttribute,
  jobTitleAttribute: s.jobTitleAttribute,
  defaultOrgUnitId: s.defaultOrgUnitId,
  autoProvision: s.autoProvision,
  syncIntervalMinutes: s.syncIntervalMinutes,
});

function ConnectionSection({ settings }: { settings: LdapSettings }) {
  // Recomeça o formulário quando a configuração salva muda.
  return <ConnectionForm key={settings.updatedAt ?? 'nova'} settings={settings} />;
}

function ConnectionForm({ settings }: { settings: LdapSettings }) {
  const units = useOrgUnits();
  const { save, test } = useLdapMutations();
  const [form, setForm] = useState<Form>(() => toForm(settings));
  const [advanced, setAdvanced] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    test.reset();
  };
  const ldaps = form.url.toLowerCase().startsWith('ldaps:');
  const insecure = !ldaps && !form.startTls && form.url !== '';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(form, {
      onSuccess: (s) =>
        toast(
          s.enabled ? 'Integração salva e ligada.' : 'Configuração salva (integração desligada).',
        ),
    });
  };

  return (
    <Section
      step={1}
      title="Conexão"
      description="Use uma conta de serviço só de leitura. A senha fica cifrada no servidor e nunca volta para esta tela."
    >
      <form onSubmit={submit} className="space-y-4">
        <label className="flex items-start gap-3 rounded-[var(--radius-control)] border border-line p-3">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-[var(--color-primary)]"
            checked={form.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
          />
          <span>
            <span className="block text-sm font-semibold">Integração ligada</span>
            <span className="block text-xs text-muted">
              Desligada, contas vindas do AD não conseguem entrar e a sincronização automática para.
              Contas locais não são afetadas.
            </span>
          </span>
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="Servidor"
            placeholder="ldaps://ad.orgao.local:636"
            value={form.url}
            onChange={(e) => set('url', e.target.value)}
            hint="ldaps:// (porta 636) é o recomendado."
            required
          />
          <TextField
            label="Base de busca"
            placeholder="OU=Prefeitura,DC=orgao,DC=local"
            value={form.baseDn}
            onChange={(e) => set('baseDn', e.target.value)}
            hint="Onde estão as pessoas (e as OUs e grupos)."
            required
          />
          <TextField
            label="Conta de serviço (DN)"
            placeholder="CN=svc-chat,OU=Servicos,DC=orgao,DC=local"
            value={form.bindDn}
            onChange={(e) => set('bindDn', e.target.value)}
            required
          />
          <TextField
            label="Senha da conta de serviço"
            type="password"
            autoComplete="new-password"
            value={form.bindPassword ?? ''}
            onChange={(e) => set('bindPassword', e.target.value)}
            placeholder={settings.hasBindPassword ? '•••••••• (guardada)' : ''}
            hint={settings.hasBindPassword ? 'Deixe em branco para manter a guardada.' : undefined}
            required={!settings.hasBindPassword}
          />
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Check
            label="Usar StartTLS (para ldap:// na porta 389)"
            checked={form.startTls}
            disabled={ldaps}
            onChange={(v) => set('startTls', v)}
          />
          <Check
            label="Conferir o certificado do servidor"
            checked={form.tlsVerify}
            onChange={(v) => set('tlsVerify', v)}
          />
          <Check
            label="Criar automaticamente quem está no AD e ainda não tem conta"
            checked={form.autoProvision}
            onChange={(v) => set('autoProvision', v)}
          />
        </div>
        {insecure && (
          <Alert tone="error">
            Sem LDAPS nem StartTLS, as senhas das pessoas trafegam abertas na rede. Use
            ldaps://…:636 ou ligue o StartTLS.
          </Alert>
        )}
        {!form.tlsVerify && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-danger">
            <AlertTriangle size={14} aria-hidden="true" /> Sem conferir o certificado, a conexão
            pode ser interceptada. Use só para testes; em produção, informe o certificado da AC.
          </p>
        )}

        <button
          type="button"
          onClick={() => setAdvanced((a) => !a)}
          aria-expanded={advanced}
          className="flex items-center gap-1 text-sm font-semibold text-primary"
        >
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={advanced ? 'rotate-180 transition-transform' : 'transition-transform'}
          />
          Opções avançadas
        </button>
        {advanced && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <label htmlFor="ldap-ca" className="text-sm font-semibold">
                Certificado da AC interna (PEM)
              </label>
              <textarea
                id="ldap-ca"
                rows={4}
                value={form.caCert}
                onChange={(e) => set('caCert', e.target.value)}
                placeholder="-----BEGIN CERTIFICATE-----"
                className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 font-mono text-xs text-ink outline-none hover:border-muted focus-visible:border-primary"
              />
              <p className="text-xs text-muted">
                Necessário quando o AD usa certificado emitido pela AC da própria organização.
              </p>
            </div>
            <TextField
              label="Filtro de pessoas"
              value={form.userFilter}
              onChange={(e) => set('userFilter', e.target.value)}
              hint={`Padrão: ${LDAP_DEFAULTS.userFilter}`}
              className="md:col-span-2"
            />
            <TextField
              label="Atributo do login"
              value={form.usernameAttribute}
              onChange={(e) => set('usernameAttribute', e.target.value)}
            />
            <TextField
              label="Atributo do nome"
              value={form.displayNameAttribute}
              onChange={(e) => set('displayNameAttribute', e.target.value)}
            />
            <TextField
              label="Atributo do e-mail"
              value={form.emailAttribute}
              onChange={(e) => set('emailAttribute', e.target.value)}
            />
            <TextField
              label="Atributo do cargo"
              value={form.jobTitleAttribute}
              onChange={(e) => set('jobTitleAttribute', e.target.value)}
            />
            <TextField
              label="Sincronizar a cada (minutos)"
              type="number"
              min={15}
              max={1440}
              value={form.syncIntervalMinutes}
              onChange={(e) => set('syncIntervalMinutes', Number(e.target.value))}
            />
            {units.data && (
              <OrgUnitSelect
                units={units.data}
                label="Lotação de quem está numa OU sem unidade"
                emptyLabel="Manter a lotação atual"
                value={form.defaultOrgUnitId ?? ''}
                onChange={(id) => set('defaultOrgUnitId', id || null)}
              />
            )}
          </div>
        )}

        {save.isError && <Alert tone="error">{save.error.message}</Alert>}
        {test.data && (
          <div
            role="status"
            className={`rounded-[var(--radius-control)] border px-3 py-2.5 text-sm ${test.data.ok ? 'border-primary/40 bg-primary/5' : 'border-danger/40 bg-danger/5'}`}
          >
            <p className="flex items-center gap-2 font-semibold">
              {test.data.ok ? (
                <CheckCircle2 size={16} className="text-primary" aria-hidden="true" />
              ) : (
                <XCircle size={16} className="text-danger" aria-hidden="true" />
              )}
              {test.data.message}
            </p>
            {!!test.data.sample?.length && (
              <ul className="mt-1.5 space-y-0.5 pl-6 text-xs text-muted">
                {test.data.sample.map((p) => (
                  <li key={p.dn}>
                    <span className="font-semibold text-ink">{p.username}</span> — {p.displayName}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {test.isError && <Alert tone="error">{test.error.message}</Alert>}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" loading={test.isPending} onClick={() => test.mutate(form)}>
            Testar conexão
          </Button>
          <Button type="submit" loading={save.isPending}>
            Salvar
          </Button>
        </div>
      </form>
    </Section>
  );
}

function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        className="size-4 accent-[var(--color-primary)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function NeedsConnection() {
  return <p className="text-sm text-muted">Salve a conexão acima para listar o que há no AD.</p>;
}

/* ------------------------------ OUs → unidades ----------------------------- */

function OuSection({ enabled }: { enabled: boolean }) {
  const ous = useLdapOus(enabled);
  const units = useOrgUnits();
  const { saveOus } = useLdapMutations();
  // Só as alterações feitas na tela; o resto vem do servidor.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const valueOf = (dn: string, saved: string | null) => edits[dn] ?? saved ?? '';

  const suggestions =
    ous.data?.filter((o) => !valueOf(o.dn, o.orgUnitId) && o.suggestedOrgUnitId) ?? [];
  const dirty = !!ous.data?.some((o) => valueOf(o.dn, o.orgUnitId) !== (o.orgUnitId ?? ''));

  const save = () =>
    saveOus.mutate(
      (ous.data ?? [])
        .map((o) => ({ dn: o.dn, orgUnitId: valueOf(o.dn, o.orgUnitId) }))
        .filter((m) => m.orgUnitId),
      {
        onSuccess: (r) => {
          setEdits({});
          toast(r.saved === 1 ? '1 OU ligada a unidade.' : `${r.saved} OUs ligadas a unidades.`);
        },
      },
    );

  return (
    <Section
      step={2}
      title="OUs → unidades do organograma"
      description="A lotação de cada pessoa vem da OU onde ela está no AD. Vale a OU mais próxima que tiver unidade: quem está numa sub-OU sem unidade herda a da OU de cima."
      actions={
        enabled &&
        ous.data && (
          <>
            {suggestions.length > 0 && (
              <Button
                variant="secondary"
                onClick={() =>
                  setEdits((d) => ({
                    ...d,
                    ...Object.fromEntries(suggestions.map((o) => [o.dn, o.suggestedOrgUnitId!])),
                  }))
                }
              >
                <Wand2 size={15} aria-hidden="true" /> Ligar {suggestions.length} pelo nome
              </Button>
            )}
            <Button onClick={save} disabled={!dirty} loading={saveOus.isPending}>
              Salvar
            </Button>
          </>
        )
      }
    >
      {!enabled ? (
        <NeedsConnection />
      ) : ous.isPending || units.isPending ? (
        <Spinner label="Lendo as OUs do AD" />
      ) : ous.isError ? (
        <Alert tone="error">{ous.error.message}</Alert>
      ) : !ous.data.length ? (
        <p className="text-sm text-muted">Nenhuma OU encontrada na base de busca.</p>
      ) : (
        <ul className="divide-y divide-line">
          {ous.data.map((o) => (
            <li key={o.dn} className="flex flex-wrap items-center gap-3 py-2">
              <div className="min-w-48 flex-1" style={{ paddingLeft: `${o.depth * 18}px` }}>
                <p className="text-sm font-semibold">{o.name}</p>
                <p className="truncate text-xs text-muted" title={o.dn}>
                  {o.dn}
                </p>
              </div>
              <UnitPicker
                units={units.data ?? []}
                value={valueOf(o.dn, o.orgUnitId)}
                onChange={(id) => setEdits((d) => ({ ...d, [o.dn]: id }))}
                label={`Unidade da OU ${o.name}`}
                emptyLabel={o.depth > 0 ? 'Herda da OU de cima' : 'Sem unidade'}
              />
            </li>
          ))}
        </ul>
      )}
      {saveOus.isError && (
        <div className="mt-3">
          <Alert tone="error">{saveOus.error.message}</Alert>
        </div>
      )}
    </Section>
  );
}

function UnitPicker({
  units,
  value,
  onChange,
  label,
  emptyLabel,
}: {
  units: OrgUnit[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  emptyLabel: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full max-w-xs rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm hover:border-muted focus-visible:border-primary sm:w-72"
    >
      <option value="">{emptyLabel}</option>
      {units.map((u) => (
        <option key={u.id} value={u.id} disabled={!u.isActive}>
          {'   '.repeat(u.depth)}
          {u.acronym ? `${u.name} (${u.acronym})` : u.name}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------ Grupos → papéis ---------------------------- */

interface GroupRule {
  dn: string;
  role: string;
  orgUnitId: string | null;
}

function GroupSection({ enabled }: { enabled: boolean }) {
  const groups = useLdapGroups(enabled);
  const roles = useRoles();
  const units = useOrgUnits();
  const { saveGroups } = useLdapMutations();
  const savedRules = useMemo(
    () => groups.data?.flatMap((g) => g.mappings.map((m) => ({ dn: g.dn, ...m }))) ?? [],
    [groups.data],
  );
  // null = sem alterações na tela (vale o que está salvo).
  const [edited, setEdited] = useState<GroupRule[] | null>(null);
  const rules = edited ?? savedRules;
  const setRules = (fn: (rs: GroupRule[]) => GroupRule[]) => setEdited(fn(rules));
  const [adding, setAdding] = useState(false);

  const assignable = (roles.data ?? []).filter((r) => r.key !== 'super_admin');
  const groupName = new Map(groups.data?.map((g) => [g.dn.toLowerCase(), g.name]));
  const roleOf = new Map(roles.data?.map((r) => [r.key, r]));
  const unitName = new Map(units.data?.map((u) => [u.id, u.acronym || u.name]));
  const dirty = edited !== null && JSON.stringify(edited) !== JSON.stringify(savedRules);

  const save = () =>
    saveGroups.mutate(rules, {
      onSuccess: (r) => {
        setEdited(null);
        toast(
          r.saved === 1
            ? '1 regra de grupo salva.'
            : r.saved
              ? `${r.saved} regras de grupo salvas.`
              : 'Regras removidas.',
        );
      },
    });

  return (
    <Section
      step={3}
      title="Grupos do AD → papéis"
      description="Quem está no grupo recebe o papel; quem sai do grupo perde. Papéis dados à mão no painel não são mexidos. Super administrador nunca vem de grupo."
      actions={
        enabled &&
        groups.data && (
          <>
            <Button variant="secondary" onClick={() => setAdding(true)}>
              <Plus size={15} aria-hidden="true" /> Nova regra
            </Button>
            <Button onClick={save} disabled={!dirty} loading={saveGroups.isPending}>
              Salvar
            </Button>
          </>
        )
      }
    >
      {!enabled ? (
        <NeedsConnection />
      ) : groups.isPending || roles.isPending ? (
        <Spinner label="Lendo os grupos do AD" />
      ) : groups.isError ? (
        <Alert tone="error">{groups.error.message}</Alert>
      ) : !rules.length ? (
        <p className="text-sm text-muted">
          Nenhuma regra. Sem regras, ninguém recebe papel pelo AD — os papéis continuam sendo dados
          no painel.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {rules.map((r, i) => {
            const role = roleOf.get(r.role);
            return (
              <li key={`${r.dn}|${r.role}|${r.orgUnitId}`} className="flex items-center gap-3 py-2">
                <p className="min-w-0 flex-1 text-sm">
                  Grupo{' '}
                  <span className="font-semibold">{groupName.get(r.dn.toLowerCase()) ?? r.dn}</span>{' '}
                  → <span className="font-semibold">{role?.name ?? r.role}</span>
                  {r.orgUnitId && (
                    <>
                      {' '}
                      em <span className="font-semibold">{unitName.get(r.orgUnitId) ?? '?'}</span>
                    </>
                  )}
                  {!groupName.has(r.dn.toLowerCase()) && (
                    <span className="ml-2 text-xs font-semibold text-danger">
                      grupo não encontrado no AD
                    </span>
                  )}
                </p>
                <Button
                  variant="ghost"
                  aria-label="Remover regra"
                  onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {saveGroups.isError && (
        <div className="mt-3">
          <Alert tone="error">{saveGroups.error.message}</Alert>
        </div>
      )}
      {adding && groups.data && (
        <GroupRuleDialog
          groups={groups.data}
          roles={assignable}
          units={units.data ?? []}
          onClose={() => setAdding(false)}
          onAdd={(rule) => {
            setRules((rs) =>
              rs.some(
                (x) => x.dn === rule.dn && x.role === rule.role && x.orgUnitId === rule.orgUnitId,
              )
                ? rs
                : [...rs, rule],
            );
            setAdding(false);
          }}
        />
      )}
    </Section>
  );
}

function GroupRuleDialog({
  groups,
  roles,
  units,
  onClose,
  onAdd,
}: {
  groups: LdapGroup[];
  roles: RoleDefinition[];
  units: OrgUnit[];
  onClose: () => void;
  onAdd: (r: GroupRule) => void;
}) {
  const [q, setQ] = useState('');
  const [dn, setDn] = useState('');
  const [roleKey, setRoleKey] = useState(roles[0]?.key ?? '');
  const [unit, setUnit] = useState('');
  const role = roles.find((r) => r.key === roleKey);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? groups.filter((g) => g.name.toLowerCase().includes(t)) : groups;
  }, [groups, q]);
  const valid = dn && role && (!role.scoped || unit);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Nova regra de grupo"
      description="Quem estiver no grupo do AD recebe o papel na próxima sincronização ou login."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!valid}
            onClick={() => onAdd({ dn, role: roleKey, orgUnitId: role?.scoped ? unit : null })}
          >
            Adicionar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <TextField
            label="Grupo do AD"
            placeholder="Procurar grupo"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <ul
            role="listbox"
            aria-label="Grupos"
            className="mt-2 max-h-52 overflow-y-auto rounded-[var(--radius-control)] border border-line"
          >
            {filtered.slice(0, 200).map((g) => (
              <li
                key={g.dn}
                role="option"
                aria-selected={dn === g.dn}
                tabIndex={0}
                onClick={() => setDn(g.dn)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setDn(g.dn)}
                className={`cursor-pointer px-3 py-2 text-sm ${dn === g.dn ? 'bg-primary/10 font-semibold' : 'hover:bg-line/40'}`}
              >
                {g.name}
                {g.description && <span className="block text-xs text-muted">{g.description}</span>}
              </li>
            ))}
            {!filtered.length && <li className="px-3 py-2 text-sm text-muted">Nenhum grupo.</li>}
          </ul>
        </div>
        <Select label="Papel" value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </Select>
        {role?.scoped && (
          <OrgUnitSelect
            units={units}
            label="Vale na unidade"
            emptyLabel="Escolha a unidade"
            value={unit}
            onChange={setUnit}
            hint="E nas unidades abaixo dela."
          />
        )}
      </div>
    </Dialog>
  );
}

/* -------------------------------- Sincronização ---------------------------- */

const KIND: Record<LdapChange['kind'], { label: string; tone: string }> = {
  create: { label: 'Nova conta', tone: 'bg-primary/10 text-primary' },
  update: { label: 'Atualiza', tone: 'bg-line/60 text-ink' },
  roles: { label: 'Papéis', tone: 'bg-line/60 text-ink' },
  disable: { label: 'Desativa', tone: 'bg-danger/10 text-danger' },
  reenable: { label: 'Reativa', tone: 'bg-primary/10 text-primary' },
};

const STATUS: Record<LdapSyncRun['status'], string> = {
  running: 'Em andamento',
  success: 'Concluída',
  failed: 'Falhou',
  blocked: 'Parada (precisa de confirmação)',
};

function SyncSection({ settings, connected }: { settings: LdapSettings; connected: boolean }) {
  const runs = useLdapRuns();
  const { preview, sync } = useLdapMutations();
  const [confirming, setConfirming] = useState<LdapSyncRun | null>(null);

  const run = (confirm: boolean) =>
    sync.mutate(confirm, {
      onSuccess: (r) => {
        setConfirming(null);
        preview.reset();
        if (r.status === 'blocked') setConfirming(r);
        else if (r.status === 'success') toast('Sincronização concluída.');
        else toast(r.error ?? 'A sincronização falhou.', 'error');
      },
    });

  return (
    <Section
      step={4}
      title="Sincronização"
      description={
        settings.enabled
          ? `Roda sozinha a cada ${settings.syncIntervalMinutes} minutos. Quem sai do AD (ou é desativado lá) é desativado aqui e perde as sessões abertas.`
          : 'A sincronização automática só roda com a integração ligada; aqui dá para conferir e rodar à mão.'
      }
      actions={
        connected && (
          <>
            <Button
              variant="secondary"
              loading={preview.isPending}
              onClick={() => preview.mutate()}
            >
              Ver o que muda
            </Button>
            <Button loading={sync.isPending} onClick={() => run(false)}>
              <RefreshCw size={15} aria-hidden="true" /> Sincronizar agora
            </Button>
          </>
        )
      }
    >
      {!connected && <NeedsConnection />}
      {preview.isError && <Alert tone="error">{preview.error.message}</Alert>}
      {sync.isError && <Alert tone="error">{sync.error.message}</Alert>}
      {preview.data && <PreviewResult preview={preview.data} />}

      <h4 className="mt-2 mb-2 text-sm font-bold">Histórico</h4>
      {runs.isPending ? (
        <Spinner label="Carregando histórico" />
      ) : runs.isError ? (
        <Alert tone="error">{runs.error.message}</Alert>
      ) : !runs.data.length ? (
        <p className="text-sm text-muted">Nenhuma sincronização ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1.5 pr-3 font-semibold">Quando</th>
                <th className="py-1.5 pr-3 font-semibold">Origem</th>
                <th className="py-1.5 pr-3 font-semibold">Resultado</th>
                <th className="py-1.5 font-semibold">Mudanças</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {runs.data.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(r.startedAt)}</td>
                  <td className="py-2 pr-3">
                    {r.trigger === 'schedule' ? 'Automática' : (r.actorName ?? 'Manual')}
                  </td>
                  <td
                    className={`py-2 pr-3 font-semibold ${r.status === 'failed' || r.status === 'blocked' ? 'text-danger' : ''}`}
                  >
                    {STATUS[r.status]}
                  </td>
                  <td className="py-2 text-muted">
                    {r.error ?? (r.summary ? summaryText(r.summary) : '—')}
                    {!!r.summary?.problems.length && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs font-semibold text-ink">
                          {r.summary.problems.length} avisos
                        </summary>
                        <ul className="mt-1 list-disc pl-5 text-xs">
                          {r.summary.problems.map((p) => (
                            <li key={p}>{p}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirming?.summary && (
        <Dialog
          open
          onClose={() => setConfirming(null)}
          title="Confirmar a sincronização?"
          description="Ela foi parada antes de gravar nada porque mudaria muita coisa de uma vez."
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(null)}>
                Cancelar
              </Button>
              <Button variant="danger" loading={sync.isPending} onClick={() => run(true)}>
                Desativar {confirming.summary.disabled} e continuar
              </Button>
            </>
          }
        >
          <p className="text-sm">
            Esta sincronização <strong>desativaria {confirming.summary.disabled} contas</strong>.
            Isso costuma acontecer quando a base de busca ou o filtro mudou, ou quando o AD
            respondeu pela metade. Confira com “Ver o que muda” antes de seguir.
          </p>
        </Dialog>
      )}
    </Section>
  );
}

function summaryText(
  s: LdapPreview | NonNullable<LdapSyncRun['summary']>,
  empty = 'Nada mudou',
): string {
  const n = (count: number, one: string, many: string) =>
    count && `${count} ${count === 1 ? one : many}`;
  const parts = [
    n(s.created, 'criada', 'criadas'),
    n(s.updated, 'atualizada', 'atualizadas'),
    n(s.disabled, 'desativada', 'desativadas'),
    n(s.reenabled, 'reativada', 'reativadas'),
    n(s.roleChanges, 'mudança de papel', 'mudanças de papel'),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : empty;
}

function PreviewResult({ preview }: { preview: LdapPreview }) {
  return (
    <div className="mb-5 rounded-[var(--radius-control)] border border-line p-3">
      <p className="text-sm font-semibold">Prévia: {summaryText(preview, 'nada a mudar')}</p>
      {preview.needsConfirmation && (
        <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-danger">
          <AlertTriangle size={15} aria-hidden="true" /> Desativaria muitas contas: a sincronização
          vai pedir confirmação.
        </p>
      )}
      {!!preview.problems.length && (
        <ul className="mt-2 list-disc pl-5 text-xs text-muted">
          {preview.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {!!preview.changes.length && (
        <ul className="mt-3 max-h-80 divide-y divide-line overflow-y-auto">
          {preview.changes.map((c) => (
            <li key={`${c.kind}-${c.username}`} className="flex items-start gap-3 py-1.5 text-sm">
              <span
                className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${KIND[c.kind].tone}`}
              >
                {KIND[c.kind].label}
              </span>
              <span className="min-w-0">
                <span className="font-semibold">{c.displayName}</span>{' '}
                <span className="text-muted">({c.username})</span>
                {!!c.details.length && (
                  <span className="block text-xs text-muted">{c.details.join(' · ')}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {preview.truncated && (
        <p className="mt-2 text-xs text-muted">Mostrando só as primeiras mudanças.</p>
      )}
    </div>
  );
}
