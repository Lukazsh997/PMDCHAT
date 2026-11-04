import {
  type Attachment,
  FILE_RULES,
  MESSAGE_RULES,
  type UploadedFile,
} from '@plataforma/contracts';
import { FileText, Paperclip, SendHorizontal, X } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { IconButton, toast } from '@/components/ui';
import { ApiRequestError, uploadFile } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import type { ChatMessage } from './chat-api';
import { sendTyping } from './live-stores';

interface Pending {
  key: string;
  file: File;
  progress: number;
  result?: UploadedFile;
  error?: string;
  abort: AbortController;
  preview?: string;
}

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
  const [pending, setPending] = useState<Pending[]>([]);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const drafts = useRef(new Map<string, string>());

  // Rascunho por conversa: trocar de conversa não perde o que foi escrito.
  useEffect(() => {
    setText(drafts.current.get(conversationId) ?? '');
    setPending([]);
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
    if (editing) return;
    const files = [...list].slice(0, MESSAGE_RULES.maxAttachmentsPerMessage - pending.length);
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if ((FILE_RULES.blockedExtensions as readonly string[]).includes(ext)) {
        toast(`Arquivos .${ext} não são permitidos por segurança.`, 'error');
        continue;
      }
      if (file.size > FILE_RULES.maxSizeBytes) {
        toast(
          `"${file.name}" passa do limite de ${FILE_RULES.maxSizeBytes / 1024 / 1024} MB.`,
          'error',
        );
        continue;
      }
      const item: Pending = {
        key: `${file.name}-${file.size}-${Math.random()}`,
        file,
        progress: 0,
        abort: new AbortController(),
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      };
      setPending((p) => [...p, item]);
      const update = (patch: Partial<Pending>) =>
        setPending((p) => p.map((x) => (x.key === item.key ? { ...x, ...patch } : x)));
      uploadFile<UploadedFile>(
        '/files',
        file,
        (progress) => update({ progress }),
        item.abort.signal,
      )
        .then((result) => update({ result, progress: 1 }))
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          update({ error: e instanceof ApiRequestError ? e.message : 'Falha no envio' });
        });
    }
  }

  function remove(p: Pending) {
    p.abort.abort();
    if (p.preview) URL.revokeObjectURL(p.preview);
    setPending((list) => list.filter((x) => x.key !== p.key));
  }

  const uploading = pending.some((p) => !p.result && !p.error);
  const ready = pending.filter((p) => p.result).map((p) => p.result!);
  const canSend =
    !uploading && (text.trim().length > 0 || ready.length > 0) && !pending.some((p) => p.error);

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
    pending.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
    setPending([]);
    setText('');
    drafts.current.delete(conversationId);
  }

  return (
    <div className="border-t border-line bg-surface px-3 py-2.5 md:px-4">
      {editing && (
        <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-[var(--radius-control)] bg-ipe-soft px-3 py-1.5 text-sm">
          <span className="flex-1 font-semibold">Editando mensagem</span>
          <span className="text-xs text-muted">Esc para cancelar</span>
          <IconButton label="Cancelar edição" className="h-7 w-7" onClick={onCancelEdit}>
            <X size={15} aria-hidden="true" />
          </IconButton>
        </div>
      )}
      {pending.length > 0 && (
        <ul className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-2" aria-label="Anexos">
          {pending.map((p) => (
            <li
              key={p.key}
              className="relative flex w-56 items-center gap-2 overflow-hidden rounded-[var(--radius-control)] border border-line bg-paper py-1.5 pr-1 pl-1.5"
            >
              {p.preview ? (
                <img src={p.preview} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
              ) : (
                <FileText size={22} className="mx-1.5 shrink-0 text-muted" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">{p.file.name}</span>
                <span
                  className={`block truncate text-xs ${p.error ? 'text-danger' : 'text-muted'}`}
                >
                  {p.error ??
                    (p.result
                      ? formatBytes(p.file.size)
                      : `Enviando ${Math.round(p.progress * 100)}%`)}
                </span>
              </span>
              <IconButton
                label={`Remover ${p.file.name}`}
                className="h-7 w-7"
                onClick={() => remove(p)}
              >
                <X size={14} aria-hidden="true" />
              </IconButton>
              {!p.result && !p.error && (
                <span
                  className="absolute bottom-0 left-0 h-0.5 bg-primary transition-[width]"
                  style={{ width: `${p.progress * 100}%` }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mx-auto flex max-w-3xl items-end gap-1.5">
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
