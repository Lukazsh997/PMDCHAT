import { type SelectHTMLAttributes, useId } from 'react';

export function Select({
  label,
  error,
  hint,
  className = '',
  children,
  id,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: string }) {
  const auto = useId();
  const sid = id ?? auto;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={sid} className="text-sm font-semibold">
        {label}
      </label>
      <select
        id={sid}
        aria-invalid={error ? true : undefined}
        className={`h-10 rounded-[var(--radius-control)] border bg-surface px-2.5 text-base text-ink ${error ? 'border-danger' : 'border-line hover:border-muted'}`}
        {...rest}
      >
        {children}
      </select>
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs font-semibold text-danger">{error}</p>}
    </div>
  );
}
