import type { OrgUnit } from '@plataforma/contracts';
import { Select } from '@/components/ui';

/** Lista de unidades com recuo pela profundidade, para escolher lotação ou unidade pai. */
export function OrgUnitSelect({
  units,
  value,
  onChange,
  label,
  emptyLabel,
  exclude,
  error,
  hint,
}: {
  units: OrgUnit[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  emptyLabel: string;
  exclude?: (u: OrgUnit) => boolean;
  error?: string;
  hint?: string;
}) {
  return (
    <Select
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
      hint={hint}
    >
      <option value="">{emptyLabel}</option>
      {units
        .filter((u) => !exclude?.(u))
        .map((u) => (
          <option key={u.id} value={u.id} disabled={!u.isActive}>
            {'   '.repeat(u.depth)}
            {u.acronym ? `${u.name} (${u.acronym})` : u.name}
            {!u.isActive ? ' — inativa' : ''}
          </option>
        ))}
    </Select>
  );
}
