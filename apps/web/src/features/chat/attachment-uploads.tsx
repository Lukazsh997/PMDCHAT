import { FILE_RULES, MESSAGE_RULES, type UploadedFile } from '@plataforma/contracts';
import { FileText, X } from 'lucide-react';
import { useState } from 'react';
import { IconButton, toast } from '@/components/ui';
import { ApiRequestError, uploadFile } from '@/lib/api';
import { formatBytes } from '@/lib/format';

export interface PendingUpload {
  key: string;
  file: File;
  progress: number;
  result?: UploadedFile;
  error?: string;
  abort: AbortController;
  preview?: string;
}

/**
 * Anexos que estão subindo para o servidor antes do envio. Usado pela caixa de
 * mensagem e pelo comunicado em massa: mesmas regras, mesmo progresso.
 */
export function useAttachmentUploads() {
  const [pending, setPending] = useState<PendingUpload[]>([]);

  function add(list: FileList | File[]) {
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
      const item: PendingUpload = {
        key: `${file.name}-${file.size}-${Math.random()}`,
        file,
        progress: 0,
        abort: new AbortController(),
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      };
      setPending((p) => [...p, item]);
      const update = (patch: Partial<PendingUpload>) =>
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

  function remove(p: PendingUpload) {
    p.abort.abort();
    if (p.preview) URL.revokeObjectURL(p.preview);
    setPending((list) => list.filter((x) => x.key !== p.key));
  }

  /** Limpa a lista depois do envio (os arquivos já subiram). */
  function clear() {
    pending.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
    setPending([]);
  }

  return {
    pending,
    add,
    remove,
    clear,
    uploading: pending.some((p) => !p.result && !p.error),
    failed: pending.some((p) => p.error),
    ready: pending.filter((p) => p.result).map((p) => p.result!),
  };
}

export function PendingAttachments({
  items,
  onRemove,
}: {
  items: PendingUpload[];
  onRemove: (p: PendingUpload) => void;
}) {
  if (!items.length) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-2" aria-label="Anexos">
      {items.map((p) => (
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
            <span className={`block truncate text-xs ${p.error ? 'text-danger' : 'text-muted'}`}>
              {p.error ??
                (p.result ? formatBytes(p.file.size) : `Enviando ${Math.round(p.progress * 100)}%`)}
            </span>
          </span>
          <IconButton
            label={`Remover ${p.file.name}`}
            className="h-7 w-7"
            onClick={() => onRemove(p)}
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
  );
}
