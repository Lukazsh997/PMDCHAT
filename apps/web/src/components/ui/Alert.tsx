import { CircleAlert, CircleCheck } from 'lucide-react';
import type { ReactNode } from 'react';

export function Alert({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  const Icon = tone === 'error' ? CircleAlert : CircleCheck;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-[var(--radius-control)] px-3 py-2.5 text-sm ${tone === 'error' ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok'}`}
    >
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
