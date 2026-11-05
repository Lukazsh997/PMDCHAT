import { LogOut, MessagesSquare, Network, Shield, UserRound, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Avatar, ErrorBoundary } from '@/components/ui';
import { APP_NAME } from '@/lib/config';
import { connectionStore } from '@/lib/socket';
import { useLogout, useMe } from '../auth/auth-api';
import { useConversations } from '../chat/chat-api';
import { useRealtimeSync } from '../chat/useRealtimeSync';

/**
 * Estrutura principal: barra de navegação estreita (grafite) à esquerda e a área
 * de trabalho à direita.
 */
export function AppShell() {
  const me = useMe();
  const { pathname } = useLocation();
  const logout = useLogout();
  const user = me.data?.user;
  useRealtimeSync(user?.id);
  const unread = (useConversations().data ?? []).reduce((n, c) => n + c.unreadCount, 0);
  const connection = connectionStore.use((s) => s);
  const isAdmin = me.data?.permissions.includes('admin.access');

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {connection === 'offline' && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 bg-accent px-4 py-1.5 text-sm font-semibold text-rail-strong"
        >
          <WifiOff size={15} aria-hidden="true" /> Sem conexão com o servidor. Tentando reconectar…
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Navegação principal"
          className="flex w-14 shrink-0 flex-col items-center gap-1 bg-rail py-3 text-rail-ink md:w-16"
        >
          <span className="sr-only">{APP_NAME}</span>
          <RailLink to="/" label="Conversas" badge={unread}>
            <MessagesSquare size={20} aria-hidden="true" />
          </RailLink>
          {user?.kind !== 'guest' && (
            <RailLink to="/organograma" label="Organograma">
              <Network size={20} aria-hidden="true" />
            </RailLink>
          )}
          {isAdmin && (
            <RailLink to="/admin" label="Administração">
              <Shield size={20} aria-hidden="true" />
            </RailLink>
          )}
          <div className="flex-1" />
          <RailLink to="/conta" label="Minha conta">
            {user ? (
              <Avatar name={user.displayName} size={28} src={user.avatarUrl} />
            ) : (
              <UserRound size={20} />
            )}
          </RailLink>
          <button
            type="button"
            onClick={() => logout.mutate()}
            title="Sair"
            aria-label="Sair"
            className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] text-rail-ink/70 hover:bg-rail-ink/8 hover:text-rail-ink focus-visible:outline-accent"
          >
            <LogOut size={18} aria-hidden="true" />
          </button>
        </nav>
        <div className="min-w-0 flex-1 overflow-hidden">
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}

function RailLink({
  to,
  label,
  badge,
  children,
}: {
  to: string;
  label: string;
  badge?: number;
  children: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      title={label}
      aria-label={badge ? `${label}, ${badge} não lidas` : label}
      className={({ isActive }) => {
        const active = isActive || (to === '/' && location.pathname.startsWith('/c/'));
        return `relative flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] focus-visible:outline-accent ${
          active
            ? 'bg-rail-ink/12 text-rail-ink before:absolute before:top-2 before:-left-2 before:h-6 before:w-1 before:rounded-r before:bg-accent md:before:-left-3'
            : 'text-rail-ink/70 hover:bg-rail-ink/8 hover:text-rail-ink'
        }`;
      }}
    >
      {children}
      {!!badge && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] leading-4 font-bold text-rail-strong"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  );
}
