import { type Attachment, MESSAGE_RULES } from '@plataforma/contracts';
import { Paperclip, SendHorizontal, X } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { IconButton } from '@/components/ui';
import { PendingAttachments, useAttachmentUploads } from './attachment-uploads';
import type { ChatMessage } from './chat-api';
import { sendTyping } from './live-stores';

export interface ComposerHandle {
  addFiles: (files: FileList | File[]) => void;
  focus: () => void;
}

/** Caixa de mensagem: Enter envia, Shift+Enter quebra linha, ↑ edita a última mensagem. */
export const Composer = forwardRef<
  ComposerHandle,
  {
    conversationId: string;
    editing: ChatMessage | null;
    onCancelEdit: () => void;
    onSubmitEdit: (body: string) => Promise<void>;
    onSend: (body: string, attachments: Attachment[]) => void;
    onEditLast: () => void;
  }
>(function Composer(
  { conversationId, editing, onCancelEdit, onSubmitEdit, onSend, onEditLast },
  ref,
) {
  const [text, setText] = useState('');
  const uploads = useAttachmentUploads();
  const { pending } = uploads;
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const drafts = useRef(new Map<string, string>());

  // Rascunho por conversa: trocar de conversa não perde o que foi escrito.
  useEffect(() => {
    setText(drafts.current.get(conversationId) ?? '');
    area.current?.focus();
  }, [conversationId]);

  useEffect(() => {
    if (editing) {
      setText(editing.body);
      requestAnimationFrame(() => {
        area.current?.focus();
        area.current?.setSelectionRange(editing.body.length, editing.body.length);
      });
    }
  }, [editing]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
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
      if (body && body !== editing.body) await onSubmitEdit(body);
      else onCancelEdit();
      setText(drafts.current.get(conversationId) ?? '');
      return;
    }
    if (!canSend) return;
    onSend(text.replace(/\s+$/u, ''), ready);
    uploads.clear();
    setText('');
    drafts.current.delete(conversationId);
  }

  return (
    <div className="border-t border-line bg-surface px-3 py-2.5 md:px-4">
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
        <label className="sr-only" htmlFor="composer">
          Mensagem
        </label>
        <textarea
          id="composer"
          ref={area}
          rows={1}
          value={text}
          maxLength={MESSAGE_RULES.maxBodyLength}
          placeholder="Escreva uma mensagem"
          onChange={(e) => {
            setText(e.target.value);
            if (!editing) drafts.current.set(conversationId, e.target.value);
            if (e.target.value) sendTyping(conversationId);
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            } else if (e.key === 'Escape' && editing) {
              onCancelEdit();
              setText(drafts.current.get(conversationId) ?? '');
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
