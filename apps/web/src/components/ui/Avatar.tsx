import { initials } from '@/lib/format';

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-rail-ink font-bold text-rail"
    >
      {initials(name)}
    </span>
  );
}
