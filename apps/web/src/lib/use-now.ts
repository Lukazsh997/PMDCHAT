import { useEffect, useState } from 'react';
import { serverNow } from './server-clock';

/**
 * Hora atual do servidor, atualizada sozinha (para prazos como "editar até 10 min").
 * A cada intervalo a tela é redesenhada e as opções vencidas somem.
 */
export function useNow(intervalMs = 10_000): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const t = window.setInterval(() => setNow(serverNow()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}
