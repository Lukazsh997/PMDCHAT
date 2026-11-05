import type { Attachment, ConversationDetail } from '@plataforma/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Alert, IconButton, Spinner, toast } from '@/components/ui';
import { useNow } from '@/lib/use-now';
import { type ChatMessage, markRead, type SendExtras, useEditMessage, useThread } from './chat-api';
import { Composer, type MentionExtras } from './Composer';
import type { Mentionable } from './mentions';
import { Bubble, type MessageActions, type PeopleIndex } from './MessageList';

/**
 * Painel lateral da thread: a mensagem que abriu a conversa paralela e as respostas,
 * com a própria caixa de envio. As respostas não entram na linha do tempo principal.
 */
export function ThreadPanel({
  rootId,
  conversationId,
  detail,
  meId,
  actions,
  mentionables,
  allowMentionAll,
  canPost = true,
  send,
  onClose,
}: {
  canPost?: boolean;
  rootId: string;
  conversationId: string;
  detail: ConversationDetail | undefined;
  meId: string;
  actions: MessageActions;
  mentionables: Mentionable[];
  allowMentionAll: boolean;
  send: (body: string, attachments: Attachment[], extras: SendExtras) => Promise<void>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const thread = useThread(rootId);
  const edit = useEditMessage();
  const now = useNow();
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const replies = thread.data?.replies ?? [];
  const lastSeq = replies.findLast((r) => !('status' in r && r.status))?.seq ?? 0;
  const nameOf = (id: string) => detail?.members.find((m) => m.id === id)?.displayName ?? 'Alguém';
  const people: PeopleIndex = { meId, nameOf };
  const threadActions: MessageActions = { ...actions, onEdit: setEditing };

  // Ler a thread conta como leitura (zera as menções feitas nela).
  useEffect(() => {
    if (lastSeq && document.visibilityState === 'visible') markRead(qc, conversationId, lastSeq);
  }, [qc, conversationId, lastSeq]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [replies.length]);

  const root = thread.data?.root;
  return (
    <aside
      aria-label="Thread"
      className="flex h-full w-full flex-col border-l border-line bg-surface lg:w-[26rem]"
    >
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="flex-1 font-bold">
          Thread
          {root && (
            <span className="ml-2 text-sm font-normal text-muted">
              {root.replyCount} {root.replyCount === 1 ? 'resposta' : 'respostas'}
            </span>
          )}
        </h2>
        <IconButton label="Fechar thread" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-chat-bg px-3 py-3">
        {thread.isPending ? (
          <div className="flex justify-center py-8">
            <Spinner label="Carregando thread" />
          </div>
        ) : thread.isError ? (
          <Alert tone="error">{thread.error.message}</Alert>
        ) : (
          <ol className="flex flex-col">
            <Bubble
              m={root!}
              mine={root!.senderId === meId}
              showName={root!.senderId !== meId}
              name={root!.senderId ? nameOf(root!.senderId) : ''}
              continued={false}
              read={false}
              actions={threadActions}
              now={now}
              people={people}
              inThread
            />
            <li className="my-3 flex items-center gap-2 text-xs text-muted" aria-hidden="true">
              <span className="h-px flex-1 bg-line" />
              {replies.length ? 'Respostas' : 'Nenhuma resposta ainda'}
              <span className="h-px flex-1 bg-line" />
            </li>
            {replies.map((m, i) => {
              const prev = replies[i - 1];
              const continued = prev?.senderId === m.senderId;
              return (
                <Bubble
                  key={m.id}
                  m={m}
                  mine={m.senderId === meId}
                  showName={!continued && m.senderId !== meId}
                  name={m.senderId ? nameOf(m.senderId) : ''}
                  continued={continued}
                  read={false}
                  actions={threadActions}
                  now={now}
                  people={people}
                  inThread
                />
              );
            })}
          </ol>
        )}
        <div ref={end} />
      </div>
      {root && !root.deletedAt && canPost && (
        <Composer
          conversationId={conversationId}
          draftKey={`thread:${rootId}`}
          inputId="thread-composer"
          placeholder="Responder na thread"
          editing={editing}
          onCancelEdit={() => setEditing(null)}
          onEditLast={() => undefined}
          onSubmitEdit={async (body, extras: MentionExtras) => {
            await edit
              .mutateAsync({ id: editing!.id, body, ...extras })
              .catch((e: Error) => toast(e.message, 'error'));
            setEditing(null);
          }}
          onSend={(body, attachments, extras) =>
            void send(body, attachments, { ...extras, threadRootId: rootId })
          }
          mentionables={mentionables}
          allowMentionAll={allowMentionAll}
        />
      )}
    </aside>
  );
}
