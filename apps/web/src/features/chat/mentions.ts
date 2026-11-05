/** Pessoa que pode ser mencionada na conversa. */
export interface Mentionable {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR');

/**
 * "@" sendo digitado antes do cursor: devolve onde começa e o que já foi escrito.
 * Só vale no início do texto ou depois de um espaço, e sem quebra de linha.
 */
export function mentionQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/u.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (query.length > 30 || /[\n@]/u.test(query) || /\s{2}/u.test(query)) return null;
  return { start: at, query };
}

/** Sugestões: nomes em que alguma palavra começa pelo que foi digitado. */
export function suggest(people: Mentionable[], query: string, limit = 6): Mentionable[] {
  const q = norm(query.trim());
  if (!q) return people.slice(0, limit);
  return people
    .filter((p) => {
      const n = norm(p.displayName);
      return n.startsWith(q) || n.split(/\s+/u).some((w) => w.startsWith(q));
    })
    .slice(0, limit);
}

/** Quem foi mencionado: quem aparece como "@Nome Completo" no texto. */
export function mentionedIn(text: string, people: Mentionable[]): string[] {
  const t = text.toLocaleLowerCase('pt-BR');
  return people
    .filter((p) => t.includes(`@${p.displayName.toLocaleLowerCase('pt-BR')}`))
    .map((p) => p.id);
}

export const mentionsAllIn = (text: string) => /(^|\s)@todos\b/iu.test(text);
