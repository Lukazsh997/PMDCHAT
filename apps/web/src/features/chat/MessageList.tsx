import { type ConversationDetail, MESSAGE_RULES, REACTION_EMOJIS } from '@plataforma/contracts';
import {
  AlertCircle,
  ArrowDown,
  Check,
  CheckCheck,
  Clock,
  Megaphone,
  MessageSquareReply,
  MoreHorizontal,
  Pencil,
  SmilePlus,
  Trash2,
} from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Menu, Spinner } from '@/components/ui';
import { formatDayLabel, formatTime, sameDay } from '@/lib/format';
import { useNow } from '@/lib/use-now';
import { Attachments } from './Attachments';
import type { ChatMessage } from './chat-api';
import { MessageText } from './MessageText';
import { systemText } from './system-text';

const GROUP_GAP_MS = 5 * 60_000;

export interface MessageActions {
  onEdit: (m: ChatMessage) => void;
  onDelete: (m: ChatMessage) => void;
  onRetry: (m: ChatMessage) => void;
  onReact: (m: ChatMessage, emoji: string, on: boolean) => void;
  onOpenThread: (m: ChatMessage) => void;
}

export function MessageList({
  items,
  hasMore,
  hasNewer = false,
  loadOlder,
  loadNewer,
  onJumpLatest,
  focusId,
  onFocused,
  detail,
  meId,
  actions,
}: {
  items: ChatMessage[];
  hasMore: boolean;
  /** Aberta no meio da conversa: há mensagens mais novas a carregar. */
  hasNewer?: boolean;
  loadOlder: () => Promise<void>;
  loadNewer?: () => Promise<void>;
  onJumpLatest?: () => void;
  /** Mensagem a mostrar e destacar (vinda da busca ou das menções). */
  focusId?: string | null;
  onFocused?: () => void;
  detail: ConversationDetail | undefined;
  meId: string;
  actions: MessageActions;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const now = useNow();
  const [atBottom, setAtBottom] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingNewer = useRef(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  useEffect(() => {
    if (!highlight) return;
    const t = window.setTimeout(() => setHighlight(null), 2600);
    return () => window.clearTimeout(t);
  }, [highlight]);
  const prevHeight = useRef<number | null>(null);
  const content = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const lastId = items.at(-1)?.id;

  const nameOf = (id: string) => detail?.members.find((m) => m.id === id)?.displayName ?? 'Alguém';
  const people: PeopleIndex = { meId, nameOf };
  const isGroup = detail?.type === 'group';
  const others = detail?.members.filter((m) => m.id !== meId) ?? [];
  const readByAll = (seq: number) => others.length > 0 && others.every((m) => m.lastReadSeq >= seq);

  // Mantém a posição ao carregar mensagens antigas; desce ao chegar mensagem nova.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevHeight.current !== null) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
      return;
    }
    const mine = items.at(-1)?.senderId === meId;
    if (focusId) return;
    if (stick.current || mine) {
      stick.current = true;
      el.scrollTop = el.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando muda a última mensagem
  }, [lastId]);

  // Leva até a mensagem procurada e a destaca.
  useLayoutEffect(() => {
    if (!focusId) return;
    const row = content.current?.querySelector<HTMLElement>(`[data-message-id="${focusId}"]`);
    if (!row) return;
    stick.current = false;
    row.scrollIntoView({ block: 'center' });
    setHighlight(focusId);
    onFocused?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reage à mensagem procurada e ao que foi carregado
  }, [focusId, items.length]);

  // Imagens e anexos mudam a altura depois de carregar: quem estava no fim continua no fim.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !content.current) return;
    if (!focusId) el.scrollTop = el.scrollHeight;
    const ro = new ResizeObserver(() => {
      if (stick.current && prevHeight.current === null) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content.current);
    return () => ro.disconnect();
  }, []);

  async function onScroll() {
    const el = scroller.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = bottom && !hasNewer;
    setAtBottom(bottom && !hasNewer);
    if (bottom && hasNewer && loadNewer && !loadingNewer.current) {
      loadingNewer.current = true;
      await loadNewer().finally(() => (loadingNewer.current = false));
    }
    if (el.scrollTop < 200 && hasMore && !loadingOlder) {
      setLoadingOlder(true);
      prevHeight.current = el.scrollHeight;
      await loadOlder().finally(() => setLoadingOlder(false));
    }
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={() => void onScroll()}
        className="h-full overflow-y-auto bg-chat-bg px-3 py-4 md:px-6"
        role="log"
        aria-label="Mensagens"
        aria-live="polite"
      >
        {loadingOlder && (
          <div className="flex justify-center py-2">
            <Spinner size={16} />
          </div>
        )}
        {!hasMore && items.length > 0 && (
          <p className="py-3 text-center text-xs text-muted">Início da conversa</p>
        )}
        {items.length === 0 && (
          <p className="mx-auto mt-10 max-w-xs text-center text-sm text-muted">
            Nenhuma mensagem ainda. Escreva a primeira abaixo.
          </p>
        )}
        <ol ref={content} className="flex flex-col">
          {items.map((m, i) => {
            const prev = items[i - 1];
            const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
            const continued =
              !newDay &&
              prev?.type === 'text' &&
              prev.senderId === m.senderId &&
              new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_GAP_MS;
            return (
              <Fragment key={m.id}>
                {newDay && (
                  <li className="sticky top-0 z-10 my-3 flex justify-center">
                    <span className="rounded-full bg-surface px-3 py-1 text-xs font-semibold text-muted shadow-sm">
                      {formatDayLabel(m.createdAt)}
                    </span>
                  </li>
                )}
                {m.type === 'system' && m.system ? (
                  <li className="msg-row my-2 text-center text-xs text-muted">
                    {systemText(m.system, nameOf, meId)}
                  </li>
                ) : (
                  <Bubble
                    m={m}
                    mine={m.senderId === meId}
                    showName={isGroup && !continued && m.senderId !== meId}
                    name={m.senderId ? nameOf(m.senderId) : ''}
                    continued={continued}
                    read={readByAll(m.seq)}
                    actions={actions}
                    now={now}
                    people={people}
                    highlight={highlight === m.id}
                  />
                )}
              </Fragment>
            );
          })}
        </ol>
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={() =>
            hasNewer && onJumpLatest
              ? onJumpLatest()
              : scroller.current?.scrollTo({
                  top: scroller.current.scrollHeight,
                  behavior: 'smooth',
                })
          }
          className="absolute right-5 bottom-4 flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-md hover:bg-paper"
          aria-label="Ir para as mensagens mais recentes"
        >
          <ArrowDown size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Quem é quem na conversa: para nomes nas reações e nas menções. */
export interface PeopleIndex {
  meId: string;
  nameOf: (id: string) => string;
}

export function Bubble({
  m,
  mine,
  showName,
  name,
  continued,
  read,
  actions,
  now,
  people,
  inThread = false,
  highlight = false,
}: {
  now: number;
  m: ChatMessage;
  mine: boolean;
  showName: boolean;
  name: string;
  continued: boolean;
  read: boolean;
  actions: MessageActions;
  people: PeopleIndex;
  /** Dentro do painel da thread: sem botão de responder nem resumo da thread. */
  inThread?: boolean;
  /** Mensagem aberta pela busca ou pelas menções. */
  highlight?: boolean;
}) {
  const deleted = !!m.deletedAt;
  // Só quem enviou, e só nos primeiros minutos (contados pelo relógio do servidor).
  const age = now - new Date(m.createdAt).getTime();
  const own = mine && !deleted && !m.status && m.type === 'text';
  const editable = own && age < MESSAGE_RULES.editWindowMinutes * 60_000;
  const canDelete = own && age < MESSAGE_RULES.deleteWindowMinutes * 60_000;
  const interactive = !deleted && !m.status && m.type === 'text';
  const canThread = interactive && !inThread && !m.threadRootId;
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const menu = [
    ...(editable
      ? [
          {
            label: 'Editar',
            icon: <Pencil size={15} aria-hidden="true" />,
            onSelect: () => actions.onEdit(m),
          },
        ]
      : []),
    ...(canDelete
      ? [
          {
            label: 'Apagar para todos',
            icon: <Trash2 size={15} aria-hidden="true" />,
            danger: true,
            onSelect: () => actions.onDelete(m),
          },
        ]
      : []),
  ];
  const myReactions = new Set(
    m.reactions.filter((r) => r.userIds.includes(people.meId)).map((r) => r.emoji),
  );
  const toolButton = 'rounded-full p-1 text-muted hover:bg-line/60 hover:text-ink';

  return (
    <li
      data-message-id={m.id}
      className={`msg-row group flex flex-col ${mine ? 'items-end' : 'items-start'} ${continued ? 'mt-0.5' : 'mt-2.5'} ${highlight ? 'msg-focus' : ''}`}
    >
      <div
        className={`flex max-w-[min(80%,42rem)] items-start gap-1 ${mine ? 'flex-row-reverse' : ''}`}
      >
        <div
          className={`min-w-0 rounded-[14px] px-3 py-1.5 shadow-[0_1px_0_rgb(0_0_0/0.06)] ${mine ? 'bg-bubble-own' : 'bg-bubble-other'} ${
            !continued ? (mine ? 'rounded-tr-[4px]' : 'rounded-tl-[4px]') : ''
          } ${m.status === 'sending' ? 'opacity-80' : ''}`}
        >
          {showName && (
            <p
              className="mb-0.5 text-xs font-bold text-[hsl(var(--hue)_50%_36%)] dark:text-[hsl(var(--hue)_60%_72%)]"
              style={{ '--hue': hue } as React.CSSProperties}
            >
              {name}
            </p>
          )}
          {m.broadcast && !deleted && (
            <p className="mb-1 flex items-center gap-1.5 border-b border-ink/10 pb-1 text-[11px] font-semibold tracking-wide text-primary uppercase">
              <Megaphone size={12} aria-hidden="true" />
              Comunicado para {m.broadcast.label}
            </p>
          )}
          {deleted ? (
            <p className="text-sm text-muted italic">Mensagem apagada</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {m.attachments.length > 0 && <Attachments items={m.attachments} />}
              {m.body && (
                <MessageText
                  text={m.body}
                  mentionNames={m.mentions.map(people.nameOf)}
                  mentionsAll={m.mentionsAll}
                  myName={people.nameOf(people.meId)}
                />
              )}
            </div>
          )}
          <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] leading-4 text-muted">
            {m.editedAt && !deleted && <span>editada</span>}
            <time dateTime={m.createdAt}>{formatTime(m.createdAt)}</time>
            {mine && !deleted && <Status m={m} read={read} />}
          </p>
        </div>
        {interactive && (
          <div className="flex items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
            <Menu
              label="Reagir"
              layout="row"
              align={mine ? 'right' : 'left'}
              items={REACTION_EMOJIS.map((emoji) => ({
                label: emoji,
                onSelect: () => actions.onReact(m, emoji, !myReactions.has(emoji)),
              }))}
              trigger={(p) => (
                <button
                  type="button"
                  {...p}
                  aria-label="Reagir"
                  title="Reagir"
                  className={toolButton}
                >
                  <SmilePlus size={16} aria-hidden="true" />
                </button>
              )}
            />
            {canThread && (
              <button
                type="button"
                onClick={() => actions.onOpenThread(m)}
                aria-label="Responder em thread"
                title="Responder em thread"
                className={toolButton}
              >
                <MessageSquareReply size={16} aria-hidden="true" />
              </button>
            )}
            {menu.length > 0 && (
              <Menu
                label="Ações da mensagem"
                align={mine ? 'right' : 'left'}
                items={menu}
                trigger={(p) => (
                  <button
                    type="button"
                    {...p}
                    aria-label="Ações da mensagem"
                    className={toolButton}
                  >
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </button>
                )}
              />
            )}
          </div>
        )}
      </div>
      {m.reactions.length > 0 && !deleted && (
        <ul className="mt-1 flex max-w-[min(80%,42rem)] flex-wrap gap-1" aria-label="Reações">
          {m.reactions.map((r) => {
            const on = r.userIds.includes(people.meId);
            const who = r.userIds
              .map((u) => (u === people.meId ? 'Você' : people.nameOf(u).split(' ')[0]))
              .join(', ');
            return (
              <li key={r.emoji}>
                <button
                  type="button"
                  onClick={() => actions.onReact(m, r.emoji, !on)}
                  title={who}
                  aria-label={`${r.emoji} ${r.userIds.length}: ${who}${on ? '. Clique para tirar a sua reação' : ''}`}
                  aria-pressed={on}
                  className={`flex h-6 items-center gap-1 rounded-full border px-2 text-xs ${
                    on
                      ? 'border-primary bg-primary-soft font-semibold text-primary'
                      : 'border-line bg-surface text-ink hover:border-muted'
                  }`}
                >
                  <span aria-hidden="true">{r.emoji}</span>
                  <span>{r.userIds.length}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!inThread && m.replyCount > 0 && (
        <button
          type="button"
          onClick={() => actions.onOpenThread(m)}
          className="mt-1 flex items-center gap-1.5 rounded-[var(--radius-control)] px-1.5 py-0.5 text-xs font-semibold text-primary hover:bg-primary-soft"
        >
          <MessageSquareReply size={14} aria-hidden="true" />
          {m.replyCount} {m.replyCount === 1 ? 'resposta' : 'respostas'}
          {m.lastReplyAt && (
            <span className="font-normal text-muted">· última às {formatTime(m.lastReplyAt)}</span>
          )}
        </button>
      )}
      {m.status === 'failed' && (
        <button
          type="button"
          onClick={() => actions.onRetry(m)}
          className="mt-1 text-xs font-semibold text-danger hover:underline"
        >
          Não enviada. Tentar de novo
        </button>
      )}
    </li>
  );
}

function Status({ m, read }: { m: ChatMessage; read: boolean }) {
  if (m.status === 'sending') return <Clock size={13} aria-label="Enviando" />;
  if (m.status === 'failed')
    return <AlertCircle size={13} className="text-danger" aria-label="Falhou" />;
  if (read) return <CheckCheck size={14} className="text-read" aria-label="Lida" />;
  return <Check size={14} aria-label="Enviada" />;
}
