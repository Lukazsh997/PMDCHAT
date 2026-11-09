import { type Attachment, fileUrl, thumbnailUrl } from '@plataforma/contracts';
import { ChevronLeft, ChevronRight, Download, FileText, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatBytes } from '@/lib/format';

export function Attachments({ items }: { items: Attachment[] }) {
  const [viewing, setViewing] = useState<number | null>(null);
  const images = items.filter((a) => a.isImage);
  const others = items.filter((a) => !a.isImage);
  return (
    <div className="flex flex-col gap-1.5">
      {images.length === 1 && (
        <button
          type="button"
          onClick={() => setViewing(0)}
          className="block max-w-full self-start overflow-hidden rounded-[var(--radius-control)] bg-line/40"
          aria-label={`Abrir imagem ${images[0]!.name}`}
        >
          <InlineImage image={images[0]!} />
        </button>
      )}
      {images.length > 1 && (
        <div className="grid w-[min(24rem,100%)] grid-cols-2 gap-1">
          {images.map((a, i) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setViewing(i)}
              className="overflow-hidden rounded-[var(--radius-control)] bg-line/40"
              aria-label={`Abrir imagem ${a.name}`}
            >
              {/* Na grade, recorte quadrado (sem esticar); a imagem inteira abre no visualizador. */}
              <img
                src={thumbnailUrl(a.id)}
                alt={a.name}
                loading="lazy"
                className="block aspect-square w-full object-cover"
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
      {viewing !== null &&
        // Portal: a linha da mensagem usa `content-visibility`, que prenderia a tela cheia
        // dentro dela. No <body>, o visualizador ocupa a janela inteira.
        createPortal(
          <ImageViewer
            images={images}
            index={viewing}
            onIndex={setViewing}
            onClose={() => setViewing(null)}
          />,
          document.body,
        )}
    </div>
  );
}

/**
 * Imagem única no balão, na proporção original: retrato cresce na vertical (até metade
 * da tela), paisagem ocupa a largura disponível do balão.
 */
function InlineImage({ image }: { image: Attachment }) {
  const { width: w, height: h } = image;
  if (!w || !h) {
    return (
      <img
        src={thumbnailUrl(image.id)}
        alt={image.name}
        loading="lazy"
        className="block max-h-80 max-w-full object-contain"
      />
    );
  }
  const portrait = h > w;
  return (
    <img
      src={thumbnailUrl(image.id)}
      alt={image.name}
      loading="lazy"
      width={w}
      height={h}
      // Com largura e altura reais no elemento, os limites máximos reduzem os dois lados
      // juntos: a imagem nunca é esticada nem ganha faixas.
      className={`block max-h-[min(26rem,55dvh)] max-w-full ${
        portrait ? 'h-auto w-auto' : 'h-auto w-[min(30rem,100%)]'
      }`}
    />
  );
}

/** Quanto a imagem pode crescer além do tamanho real para ocupar a tela. */
const MAX_UPSCALE = 3;

/**
 * Visualizador em tela cheia. A imagem é encaixada na área livre pela proporção real:
 * retrato usa toda a altura, paisagem usa largura e altura até onde couber, sempre
 * centralizada e sem distorcer. Acompanha mudanças de tamanho da janela.
 */
function ImageViewer({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: Attachment[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const image = images[index]!;
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const many = images.length > 1;
  const go = (d: number) => onIndex((index + d + images.length) % images.length);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Dimensões conhecidas pelo servidor; se faltarem, as reais depois de carregar.
  const w = image.width ?? natural?.w;
  const h = image.height ?? natural?.h;
  let size: { width: number; height: number } | undefined;
  if (box && w && h) {
    const scale = Math.min(box.w / w, box.h / h, MAX_UPSCALE);
    size = { width: Math.floor(w * scale), height: Math.floor(h * scale) };
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.name}
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        else if (many && e.key === 'ArrowRight') go(1);
        else if (many && e.key === 'ArrowLeft') go(-1);
      }}
      onClick={onClose}
    >
      <div
        className="flex items-center gap-3 px-4 py-3 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="min-w-0 flex-1 truncate text-sm">
          {image.name}
          {many && (
            <span className="ml-2 text-white/60">
              {index + 1} de {images.length}
            </span>
          )}
        </span>
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
      <div className="relative min-h-0 flex-1 px-3 pb-3 sm:px-14 sm:pb-6">
        <div ref={stage} className="flex h-full w-full items-center justify-center">
          <img
            key={image.id}
            src={fileUrl(image.id)}
            alt={image.name}
            onLoad={(e) =>
              setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
            style={
              size
                ? {
                    ...size,
                    // A miniatura aparece de fundo enquanto a imagem completa carrega.
                    backgroundImage: `url(${thumbnailUrl(image.id)})`,
                    backgroundSize: 'contain',
                  }
                : undefined
            }
            className={`block bg-no-repeat object-contain ${size ? '' : 'max-h-full max-w-full'}`}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        {many && (
          <>
            <button
              type="button"
              aria-label="Imagem anterior"
              onClick={(e) => {
                e.stopPropagation();
                go(-1);
              }}
              className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              aria-label="Próxima imagem"
              onClick={(e) => {
                e.stopPropagation();
                go(1);
              }}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
