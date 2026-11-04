import { ShieldAlert } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router';
import { useMe } from '../auth/auth-api';

export function AdminLayout() {
  const me = useMe().data!;
  const can = (p: string) => me.permissions.includes(p as never);
  const tabs = [
    { to: '/admin', label: 'Visão geral', end: true, show: true },
    { to: '/admin/usuarios', label: 'Usuários', show: can('users.read') },
    { to: '/admin/organograma', label: 'Organograma', show: true },
    { to: '/admin/auditoria', label: 'Auditoria', show: can('audit.read') },
  ].filter((t) => t.show);

  if (me.mfaSetupRequired) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-md text-center">
          <ShieldAlert size={32} className="mx-auto text-primary" aria-hidden="true" />
          <h1 className="mt-3 text-xl font-bold">Ative a verificação em duas etapas</h1>
          <p className="mt-2 text-sm text-muted">
            O painel administrativo dá acesso a dados de toda a organização. Para protegê-lo, quem
            administra o sistema precisa confirmar o login com um código do celular.
          </p>
          <Link
            to="/conta"
            className="mt-5 inline-flex h-9 items-center rounded-[var(--radius-control)] bg-primary px-4 text-sm font-semibold text-primary-ink hover:bg-primary-strong"
          >
            Ativar em Minha conta
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line bg-surface px-6 pt-5">
        <h1 className="text-xl font-bold">Administração</h1>
        <nav
          aria-label="Seções da administração"
          className="-mb-px mt-3 flex gap-5 overflow-x-auto"
        >
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `border-b-2 pb-2.5 text-sm font-semibold whitespace-nowrap ${isActive ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink'}`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
