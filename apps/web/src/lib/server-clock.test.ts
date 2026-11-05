import { afterEach, describe, expect, it, vi } from 'vitest';
import { noteServerDate, serverNow } from './server-clock';

describe('relógio do servidor', () => {
  afterEach(() => vi.useRealTimers());

  it('corrige o relógio errado do computador pelo cabeçalho Date da API', () => {
    vi.useFakeTimers();
    // Computador 20 minutos adiantado em relação ao servidor.
    const server = Date.parse('2026-11-05T14:00:00Z');
    vi.setSystemTime(server + 20 * 60_000);
    noteServerDate(new Date(server).toUTCString());
    expect(Math.abs(serverNow() - server)).toBeLessThan(1000);
  });

  it('ignora cabeçalho ausente ou inválido', () => {
    const before = serverNow();
    noteServerDate(null);
    noteServerDate('não é data');
    expect(Math.abs(serverNow() - before)).toBeLessThan(50);
  });
});
