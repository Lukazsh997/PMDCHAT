import type { SystemEvent } from '@plataforma/contracts';

/** Frase de uma mensagem de sistema, do ponto de vista de quem lê. */
export function systemText(e: SystemEvent, nameOf: (id: string) => string, meId: string): string {
  const who = (id: string) => (id === meId ? 'Você' : nameOf(id));
  switch (e.event) {
    case 'group_created':
      return `${who(e.actorId)} criou o grupo`;
    case 'members_added':
      return `${who(e.actorId)} adicionou ${listNames(e.userIds.map((u, i) => (u === meId ? 'você' : (e.names[i] ?? nameOf(u)))))}`;
    case 'member_removed':
      return `${who(e.actorId)} removeu ${e.userId === meId ? 'você' : e.name}`;
    case 'member_left':
      return `${who(e.actorId)} saiu do grupo`;
    case 'renamed':
      return `${who(e.actorId)} mudou o nome do grupo para "${e.name}"`;
  }
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`;
}
