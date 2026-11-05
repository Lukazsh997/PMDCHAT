import { MessagesSquare } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { useMe } from '../auth/auth-api';
import { BroadcastComposer } from './BroadcastComposer';
import { ConversationList } from './ConversationList';
import { ConversationView } from './ConversationView';
import { NewChatDialog, NewGroupDialog } from './NewConversationDialogs';
import { NotificationBanner } from './NotificationBanner';

/** Lista de conversas à esquerda e a conversa aberta à direita (no celular, uma de cada vez). */
export function ChatPage() {
  const me = useMe().data!;
  const { conversationId } = useParams();
  const [dialog, setDialog] = useState<'chat' | 'group' | 'broadcast' | null>(null);
  const canCreate = me.user.kind !== 'guest';

  return (
    <div className="relative flex h-full">
      <aside
        className={`flex w-full shrink-0 flex-col border-r border-line bg-surface md:w-80 lg:w-[22rem] ${conversationId ? 'hidden md:flex' : 'flex'}`}
      >
        <NotificationBanner />
        <ConversationList
          meId={me.user.id}
          canCreate={canCreate}
          onNewChat={() => setDialog('chat')}
          onNewGroup={() => setDialog('group')}
          onBroadcast={() => setDialog('broadcast')}
        />
      </aside>
      <main className={`relative min-w-0 flex-1 ${conversationId ? 'flex' : 'hidden md:flex'}`}>
        {conversationId ? (
          <div className="h-full w-full">
            <ConversationView key={conversationId} conversationId={conversationId} />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center bg-chat-bg px-6">
            <div className="max-w-sm text-center">
              <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface text-primary">
                <MessagesSquare size={26} aria-hidden="true" />
              </span>
              <h2 className="text-lg font-bold">Escolha uma conversa</h2>
              <p className="mt-1 text-sm text-muted">
                {canCreate
                  ? 'Abra uma conversa da lista ou comece uma nova pelo botão ao lado de "Conversas".'
                  : 'Abra uma das conversas em que você foi incluído.'}
              </p>
            </div>
          </div>
        )}
      </main>
      <NewChatDialog open={dialog === 'chat'} onClose={() => setDialog(null)} />
      <NewGroupDialog open={dialog === 'group'} onClose={() => setDialog(null)} />
      <BroadcastComposer open={dialog === 'broadcast'} onClose={() => setDialog(null)} />
    </div>
  );
}
