import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}

const GAP = 4;
const MARGIN = 8;

/**
 * Menu suspenso, navegável por teclado. É desenhado num portal com posição fixa:
 * assim nunca é cortado por listas com rolagem ou por linhas com `content-visibility`,
 * e abre para cima quando não cabe abaixo do botão.
 */
export function Menu({
  trigger,
  items,
  align = 'right',
  label,
  layout = 'list',
}: {
  trigger: (props: {
    onClick: (e: React.MouseEvent<HTMLElement>) => void;
    'aria-expanded': boolean;
    'aria-haspopup': 'menu';
  }) => ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
  label: string;
  /** `row`: itens lado a lado, só o ícone/rótulo curto (ex.: escolher um emoji). */
  layout?: 'list' | 'row';
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [host, setHost] = useState<Element | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const p = panel.current;
      if (!a || !p) return;
      const w = p.offsetWidth;
      const h = p.offsetHeight;
      let left = align === 'right' ? a.right - w : a.left;
      left = Math.min(Math.max(MARGIN, left), window.innerWidth - w - MARGIN);
      let top = a.bottom + GAP;
      if (top + h > window.innerHeight - MARGIN) top = Math.max(MARGIN, a.top - GAP - h);
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    // Rolar a lista por baixo fecha o menu, como nos menus nativos.
    const onScroll = (e: Event) => !panel.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) =>
      anchor.current?.contains(t as Node) || panel.current?.contains(t as Node);
    const onDoc = (e: MouseEvent) => !inside(e.target) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      anchor.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open && pos)
      panel.current?.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus();
  }, [open, pos]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Tab') return setOpen(false);
    const next = layout === 'row' ? 'ArrowRight' : 'ArrowDown';
    const prev = layout === 'row' ? 'ArrowLeft' : 'ArrowUp';
    if (e.key !== next && e.key !== prev) return;
    e.preventDefault();
    const els = [
      ...(panel.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ??
        []),
    ];
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    els.at((i + (e.key === next ? 1 : -1)) % els.length)?.focus();
  }

  return (
    <div ref={anchor} className="relative">
      {trigger({
        onClick: (e) => {
          setPos(null);
          // Dentro de um <dialog> modal, o menu precisa estar no mesmo "top layer".
          setHost(e.currentTarget.closest('dialog') ?? document.body);
          setOpen((o) => !o);
        },
        'aria-expanded': open,
        'aria-haspopup': 'menu',
      })}
      {open &&
        host &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            aria-label={label}
            onKeyDown={onKeyDown}
            style={pos ?? { top: 0, left: 0, visibility: 'hidden' }}
            className={`fixed z-50 rounded-[var(--radius-control)] border border-line bg-surface shadow-lg ${
              layout === 'row' ? 'flex gap-0.5 p-1' : 'min-w-48 py-1'
            }`}
          >
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={
                  layout === 'row'
                    ? 'flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] text-xl hover:bg-line/50 focus-visible:bg-line/50 focus-visible:outline-none'
                    : `flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-line/50 focus-visible:bg-line/50 focus-visible:outline-none disabled:opacity-50 ${it.danger ? 'text-danger' : 'text-ink'}`
                }
              >
                {it.icon}
                {it.label}
              </button>
            ))}
          </div>,
          host,
        )}
    </div>
  );
}
