import { AtSign, MessageSquareReply, Users } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Alert, Avatar, Spinner } from '@/components/ui';
import { formatListTime } from '@/lib/format';
import { useMe } from '../auth/auth-api';
import { useMentions } from './chat-api';
import { MessageText } from './MessageText';

/** Aba Menções: onde citaram você (ou @todos), da mais recente para a mais antiga. */
export function MentionsPage() {
  const me = useMe().data!;
  const mentions = useMentions();
  const navigate = useNavigate();

  return (
    <div className="h-full overflow-y-auto bg-chat-bg">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <AtSign size={22} aria-hidden="true" className="text-primary" /> Menções
        </h1>
        <p className="mt-1 mb-5 text-sm text-muted">
          Mensagens em que alguém citou você com @ ou usou @todos.
        </p>
        {mentions.isPending ? (
          <Spinner label="Carregando menções" />
        ) : mentions.isError ? (
          <Alert tone="error">{mentions.error.message}</Alert>
        ) : mentions.data.items.length === 0 ? (
          <p className="rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-8 text-center text-sm text-muted">
            Ninguém mencionou você ainda.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {mentions.data.items.map(({ message: m, conversation: c, unread, senderName }) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    const q = new URLSearchParams({ m: m.id });
                    if (m.threadRootId) q.set('thread', m.threadRootId);
                    void navigate(`/c/${c.id}?${q.toString()}`);
                  }}
                  className={`flex w-full gap-3 rounded-[var(--radius-panel)] border bg-surface px-4 py-3 text-left hover:border-primary ${unread ? 'border-primary/50' : 'border-line'}`}
                >
                  {c.type === 'group' ? (
                    <Avatar name={c.title} group size={36} />
                  ) : (
                    <Avatar name={c.title} size={36} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {c.type === 'group' && (
                          <Users size={13} className="mr-1 inline text-muted" aria-hidden="true" />
                        )}
                        {c.title}
                        {m.threadRootId && (
                          <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-muted">
                            <MessageSquareReply size={12} aria-hidden="true" /> na thread
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-muted">
                        {formatListTime(m.createdAt)}
                      </span>
                      {unread && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full bg-accent"
                          aria-label="não lida"
                        />
                      )}
                    </span>
                    {c.type === 'group' && (
                      <span className="block text-xs font-semibold text-muted">{senderName}</span>
                    )}
                    <span className="mt-0.5 line-clamp-3 block text-sm">
                      <MessageText
                        text={m.body}
                        mentionNames={m.mentions.includes(me.user.id) ? [me.user.displayName] : []}
                        mentionsAll={m.mentionsAll}
                        myName={me.user.displayName}
                      />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
