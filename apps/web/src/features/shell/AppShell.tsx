import { LogOut, MessagesSquare, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { Avatar } from '@/components/ui';
import { APP_NAME } from '@/lib/config';
import { useLogout, useMe } from '../auth/auth-api';

/**
 * Estrutura principal: barra de navegação estreita (petróleo) à esquerda e a área
 * de trabalho à direita. As conversas entram na fase 1 dentro desta mesma moldura.
 */
export function AppShell() {
  const me = useMe();
  const logout = useLogout();
  const user = me.data?.user;

  return (
    <div className="flex h-dvh overflow-hidden">
      <nav
        aria-label="Navegação principal"
        className="flex w-14 shrink-0 flex-col items-center gap-1 bg-rail py-3 text-rail-ink md:w-16"
      >
        <span className="sr-only">{APP_NAME}</span>
        <RailLink to="/" label="Conversas" end>
          <MessagesSquare size={20} aria-hidden="true" />
        </RailLink>
        <div className="flex-1" />
        <RailLink to="/conta" label="Minha conta">
          {user ? <Avatar name={user.displayName} size={28} /> : <UserRound size={20} />}
        </RailLink>
        <button
          type="button"
          onClick={() => logout.mutate()}
          title="Sair"
          aria-label="Sair"
          className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] text-rail-ink/70 hover:bg-rail-strong hover:text-rail-ink focus-visible:outline-ipe"
        >
          <LogOut size={18} aria-hidden="true" />
        </button>
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}

function RailLink({
  to,
  label,
  end,
  children,
}: {
  to: string;
  label: string;
  end?: boolean;
  children: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      aria-label={label}
      className={({ isActive }) =>
        `relative flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] focus-visible:outline-ipe ${
          isActive
            ? 'bg-rail-strong text-rail-ink before:absolute before:top-2 before:-left-2 before:h-6 before:w-1 before:rounded-r before:bg-ipe md:before:-left-3'
            : 'text-rail-ink/70 hover:bg-rail-strong hover:text-rail-ink'
        }`
      }
    >
      {children}
    </NavLink>
  );
}
