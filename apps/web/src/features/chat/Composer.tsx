import { type Attachment, MESSAGE_RULES } from '@plataforma/contracts';
import { Paperclip, SendHorizontal, X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Avatar, IconButton } from '@/components/ui';
import { PendingAttachments, useAttachmentUploads } from './attachment-uploads';
import type { ChatMessage } from './chat-api';
import { sendTyping } from './live-stores';
import { type Mentionable, mentionedIn, mentionQueryAt, mentionsAllIn, suggest } from './mentions';

export interface ComposerHandle {
  addFiles: (files: FileList | File[]) => void;
  focus: () => void;
}

export interface MentionExtras {
  mentions: string[];
  mentionAll: boolean;
}

/**
 * Caixa de mensagem: Enter envia, Shift+Enter quebra linha, ↑ edita a última mensagem,
 * "@" sugere pessoas da conversa (e @todos em grupos).
 */
export const Composer = forwardRef<
  ComposerHandle,
  {
    conversationId: string;
    editing: ChatMessage | null;
    onCancelEdit: () => void;
    onSubmitEdit: (body: string, extras: MentionExtras) => Promise<void>;
    onSend: (body: string, attachments: Attachment[], extras: MentionExtras) => void;
    onEditLast: () => void;
    /** Quem pode ser mencionado (sem incluir você). */
    mentionables?: Mentionable[];
    allowMentionAll?: boolean;
    /** Rascunho separado (ex.: a caixa da thread). Padrão: a conversa. */
    draftKey?: string;
    inputId?: string;
    placeholder?: string;
  }
>(function Composer(
  {
    conversationId,
    editing,
    onCancelEdit,
    onSubmitEdit,
    onSend,
    onEditLast,
    mentionables = [],
    allowMentionAll = false,
    draftKey = conversationId,
    inputId = 'composer',
    placeholder = 'Escreva uma mensagem',
  },
  ref,
) {
  const [text, setText] = useState('');
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const pendingCaret = useRef<number | null>(null);
  const options = mention
    ? [
        ...(allowMentionAll && 'todos'.startsWith(mention.query.toLocaleLowerCase('pt-BR'))
          ? [{ id: '@todos', displayName: 'todos', avatarUrl: null }]
          : []),
        ...suggest(mentionables, mention.query),
      ]
    : [];
  const extrasFor = (body: string): MentionExtras => ({
    mentions: mentionedIn(body, mentionables),
    mentionAll: allowMentionAll && mentionsAllIn(body),
  });

  function updateMention(el: HTMLTextAreaElement) {
    const q = mentionQueryAt(el.value, el.selectionStart);
    setMention(q);
    setActive(0);
  }

  function choose(p: Mentionable) {
    const el = area.current;
    if (!el || !mention) return;
    const insert = `@${p.displayName} `;
    const next = text.slice(0, mention.start) + insert + text.slice(el.selectionStart);
    setText(next);
    if (!editing) drafts.current.set(draftKey, next);
    setMention(null);
    // O cursor vai para depois do nome assim que o texto novo for desenhado (antes de
    // qualquer tecla seguinte), senão a próxima letra cairia no fim do texto.
    pendingCaret.current = mention.start + insert.length;
  }
  const uploads = useAttachmentUploads();
  const { pending } = uploads;
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const drafts = useRef(new Map<string, string>());

  // Rascunho por conversa: trocar de conversa não perde o que foi escrito.
  useEffect(() => {
    setText(drafts.current.get(draftKey) ?? '');
    area.current?.focus();
  }, [draftKey]);

  useEffect(() => {
    if (editing) {
      setText(editing.body);
      requestAnimationFrame(() => {
        area.current?.focus();
        area.current?.setSelectionRange(editing.body.length, editing.body.length);
      });
    }
  }, [editing]);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
    if (pendingCaret.current !== null) {
      el.focus();
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [text]);

  useImperativeHandle(ref, () => ({ addFiles, focus: () => area.current?.focus() }));

  function addFiles(list: FileList | File[]) {
    if (!editing) uploads.add(list);
  }

  const { uploading, ready } = uploads;
  const canSend = !uploading && (text.trim().length > 0 || ready.length > 0) && !uploads.failed;

  async function submit() {
    if (editing) {
      const body = text.trim();
      if (body && body !== editing.body) await onSubmitEdit(body, extrasFor(body));
      else onCancelEdit();
      setText(drafts.current.get(draftKey) ?? '');
      return;
    }
    if (!canSend) return;
    const body = text.replace(/\s+$/u, '');
    onSend(body, ready, extrasFor(body));
    uploads.clear();
    setText('');
    setMention(null);
    drafts.current.delete(draftKey);
  }

  return (
    <div className="relative border-t border-line bg-surface px-3 py-2.5 md:px-4">
      {options.length > 0 && (
        <ul
          role="listbox"
          id={`${inputId}-mentions`}
          aria-label="Mencionar"
          className="absolute right-3 bottom-full left-3 z-20 mb-1 max-w-sm overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface py-1 shadow-lg md:left-14"
        >
          {options.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                // mousedown: escolhe antes de a caixa de texto perder o foco.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p);
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm ${i === active ? 'bg-primary-soft' : 'hover:bg-line/40'}`}
              >
                {p.id === '@todos' ? (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-xs font-bold">
                    @
                  </span>
                ) : (
                  <Avatar name={p.displayName} src={p.avatarUrl} size={28} />
                )}
                <span className="font-semibold">
                  {p.id === '@todos' ? '@todos' : p.displayName}
                </span>
                {p.id === '@todos' && (
                  <span className="text-xs text-muted">avisa todos do grupo</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <div className="mb-2 flex items-center gap-2 rounded-[var(--radius-control)] bg-accent-soft px-3 py-1.5 text-sm">
          <span className="flex-1 font-semibold">Editando mensagem</span>
          <span className="text-xs text-muted">Esc para cancelar</span>
          <IconButton label="Cancelar edição" className="h-7 w-7" onClick={onCancelEdit}>
            <X size={15} aria-hidden="true" />
          </IconButton>
        </div>
      )}
      <PendingAttachments items={pending} onRemove={uploads.remove} />
      <div className="flex items-end gap-1.5">
        <IconButton
          label="Anexar arquivo"
          onClick={() => fileInput.current?.click()}
          disabled={!!editing}
        >
          <Paperclip size={19} aria-hidden="true" />
        </IconButton>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <label className="sr-only" htmlFor={inputId}>
          Mensagem
        </label>
        <textarea
          id={inputId}
          ref={area}
          rows={1}
          value={text}
          maxLength={MESSAGE_RULES.maxBodyLength}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={options.length ? `${inputId}-mentions` : undefined}
          aria-autocomplete="list"
          onChange={(e) => {
            setText(e.target.value);
            updateMention(e.target);
            if (!editing) drafts.current.set(draftKey, e.target.value);
            if (e.target.value) sendTyping(conversationId);
          }}
          onClick={(e) => updateMention(e.currentTarget)}
          onBlur={() => setMention(null)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (options.length) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const d = e.key === 'ArrowDown' ? 1 : -1;
                setActive((a) => (a + d + options.length) % options.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                choose(options[active]!);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setMention(null);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            } else if (e.key === 'Escape' && editing) {
              onCancelEdit();
              setText(drafts.current.get(draftKey) ?? '');
            } else if (e.key === 'ArrowUp' && !text && !editing) {
              e.preventDefault();
              onEditLast();
            }
          }}
          className="max-h-42 min-h-10 flex-1 resize-none rounded-[20px] border border-line bg-paper px-4 py-2 text-base leading-6 outline-none placeholder:text-muted focus:border-primary"
        />
        <IconButton
          label={editing ? 'Salvar edição' : 'Enviar'}
          onClick={() => void submit()}
          disabled={editing ? !text.trim() : !canSend}
          className="bg-primary text-primary-ink hover:bg-primary-strong hover:text-primary-ink disabled:bg-line disabled:text-muted"
        >
          <SendHorizontal size={18} aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
});
