import { type Attachment, fileUrl, thumbnailUrl } from '@plataforma/contracts';
import { Download, FileText, X } from 'lucide-react';
import { useState } from 'react';
import { formatBytes } from '@/lib/format';

export function Attachments({ items }: { items: Attachment[] }) {
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const images = items.filter((a) => a.isImage);
  const others = items.filter((a) => !a.isImage);
  return (
    <div className="flex flex-col gap-1.5">
      {images.length > 0 && (
        <div className={`grid gap-1 ${images.length > 1 ? 'grid-cols-2' : ''}`}>
          {images.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setViewing(a)}
              className="overflow-hidden rounded-[var(--radius-control)] bg-line/40"
              aria-label={`Abrir imagem ${a.name}`}
            >
              <img
                src={thumbnailUrl(a.id)}
                alt={a.name}
                loading="lazy"
                width={a.width ?? undefined}
                height={a.height ?? undefined}
                className={`block w-full object-cover ${images.length > 1 ? 'aspect-square' : 'max-h-80'}`}
              />
            </button>
          ))}
        </div>
      )}
      {others.map((a) => (
        <a
          key={a.id}
          href={`${fileUrl(a.id)}?download=1`}
          className="flex items-center gap-2.5 rounded-[var(--radius-control)] border border-line bg-surface/70 px-3 py-2 hover:border-muted"
        >
          <FileText size={22} className="shrink-0 text-muted" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{a.name}</span>
            <span className="text-xs text-muted">{formatBytes(a.sizeBytes)}</span>
          </span>
          <Download size={16} className="shrink-0 text-muted" aria-label="Baixar" />
        </a>
      ))}
      {viewing && <ImageViewer image={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function ImageViewer({ image, onClose }: { image: Attachment; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.name}
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      onClick={onClose}
    >
      <div
        className="flex items-center gap-3 px-4 py-3 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="min-w-0 flex-1 truncate text-sm">{image.name}</span>
        <a
          href={`${fileUrl(image.id)}?download=1`}
          className="rounded p-2 hover:bg-white/10"
          aria-label="Baixar"
        >
          <Download size={18} />
        </a>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="rounded p-2 hover:bg-white/10"
          aria-label="Fechar"
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <img
          src={fileUrl(image.id)}
          alt={image.name}
          className="max-h-full max-w-full object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}
