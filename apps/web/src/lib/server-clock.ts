/**
 * Relógio do servidor. Cada resposta da API traz o cabeçalho `Date`; a diferença para
 * o relógio deste computador é guardada e usada nos prazos (ex.: "editar até 10 min").
 * Assim um computador com a hora errada não mostra opções que o servidor vai recusar.
 * O servidor continua sendo quem decide: isto só evita oferecer o que já expirou.
 */
let offsetMs = 0;

export function noteServerDate(header: string | null): void {
  if (!header) return;
  const t = Date.parse(header);
  // O cabeçalho tem precisão de segundos: soma meio segundo para centralizar o erro.
  if (!Number.isNaN(t)) offsetMs = t + 500 - Date.now();
}

export function serverNow(): number {
  return Date.now() + offsetMs;
}
