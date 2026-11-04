import type { PresenceStatus } from '@plataforma/contracts';
import { Users } from 'lucide-react';
import { initials } from '@/lib/format';

const PRESENCE: Record<PresenceStatus, { color: string; label: string }> = {
  online: { color: 'bg-ok', label: 'disponível' },
  away: { color: 'bg-ipe', label: 'ausente' },
  offline: { color: 'bg-muted/50', label: 'desconectado' },
};

/** Avatar com iniciais; a cor de fundo vem do nome, para diferenciar pessoas na lista. */
export function Avatar({
  name,
  size = 32,
  presence,
  group = false,
}: {
  name: string;
  size?: number;
  presence?: PresenceStatus;
  group?: boolean;
}) {
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const dot = Math.max(8, Math.round(size * 0.28));
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        aria-hidden="true"
        style={{
          fontSize: Math.round(size * 0.38),
          background: `hsl(${hue} 32% 86%)`,
          color: `hsl(${hue} 45% 24%)`,
        }}
        className="inline-flex h-full w-full items-center justify-center rounded-full font-bold"
      >
        {group ? <Users size={Math.round(size * 0.48)} /> : initials(name)}
      </span>
      {presence && (
        <span
          title={PRESENCE[presence].label}
          style={{ width: dot, height: dot }}
          className={`absolute right-0 bottom-0 rounded-full ring-2 ring-surface ${PRESENCE[presence].color}`}
        >
          <span className="sr-only">{PRESENCE[presence].label}</span>
        </span>
      )}
    </span>
  );
}
