import { MessagesSquare } from 'lucide-react';
import { useMe } from '../auth/auth-api';

/** Moldura das conversas. A lista e a janela de mensagens chegam na fase 1. */
export function ConversationsPage() {
  const me = useMe();
  const firstName = me.data?.user.displayName.split(' ')[0] ?? '';

  return (
    <div className="flex h-full">
      <aside className="hidden w-80 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <header className="px-4 pt-4 pb-3">
          <h1 className="text-lg font-bold">Conversas</h1>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <p className="text-sm font-semibold">Nenhuma conversa ainda</p>
          <p className="mt-1 text-sm text-muted">Suas conversas e grupos vão aparecer aqui.</p>
        </div>
      </aside>

      <section className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-md text-center">
          <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-rail/10 text-rail dark:bg-rail-ink/10 dark:text-rail-ink">
            <MessagesSquare size={26} aria-hidden="true" />
          </span>
          <h2 className="text-xl font-bold">Olá, {firstName}</h2>
          <p className="mt-2 text-base text-muted">
            Você está conectado. As conversas individuais e em grupo serão liberadas na próxima
            versão da plataforma.
          </p>
        </div>
      </section>
    </div>
  );
}
