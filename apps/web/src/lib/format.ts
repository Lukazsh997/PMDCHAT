const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

/** Iniciais para o avatar: "Maria da Silva" → "MS". */
export function initials(name: string): string {
  const parts = name
    .split(/\s+/)
    .filter((p) => p.length > 2 || /^[A-ZÀ-Ý]/.test(p))
    .filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Descrição curta do navegador a partir do User-Agent. */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return 'Dispositivo desconhecido';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Navegador';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS/.test(ua)
      ? 'macOS'
      : /Linux/.test(ua)
        ? 'Linux'
        : '';
  return os ? `${browser} no ${os}` : browser;
}
