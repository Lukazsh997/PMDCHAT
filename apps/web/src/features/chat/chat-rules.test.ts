import type { Message } from '@plataforma/contracts';
import { describe, expect, it } from 'vitest';
import { type ChatMessage, merge } from './chat-api';
import { systemText } from './system-text';

const msg = (p: Partial<ChatMessage>): ChatMessage => ({
  id: 'id',
  conversationId: 'c',
  seq: 1,
  senderId: 'u1',
  type: 'text',
  body: 'oi',
  broadcast: null,
  threadRootId: null,
  replyCount: 0,
  lastReplyAt: null,
  reactions: [],
  mentions: [],
  mentionsAll: false,
  system: null,
  attachments: [],
  clientId: null,
  createdAt: '2026-11-04T10:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  ...p,
});

describe('merge de mensagens', () => {
  it('troca a mensagem otimista pela confirmada, sem duplicar', () => {
    const pending = msg({
      id: 'local-x',
      clientId: 'x',
      seq: Number.MAX_SAFE_INTEGER,
      status: 'sending',
    });
    const saved = msg({ id: 'srv-1', clientId: 'x', seq: 7 });
    expect(merge([pending], [saved])).toEqual([saved]);
    // A confirmação chegando antes pelo tempo real não é desfeita pela otimista.
    expect(merge([saved], [pending])).toEqual([saved]);
  });

  it('ordena por sequência e deixa as pendentes no fim', () => {
    const items = merge(
      [
        msg({ id: 'b', seq: 2 }),
        msg({ id: 'p', clientId: 'p', status: 'sending', seq: Number.MAX_SAFE_INTEGER }),
      ],
      [msg({ id: 'a', seq: 1 })],
    );
    expect(items.map((m) => m.id)).toEqual(['a', 'b', 'p']);
  });

  it('versão editada ou apagada substitui a anterior', () => {
    const original = msg({ id: 'm' });
    const edited: Message = msg({ id: 'm', body: 'oi!', editedAt: '2026-11-04T10:01:00.000Z' });
    expect(merge([original], [edited])[0]!.body).toBe('oi!');
    const deleted = msg({
      id: 'm',
      body: '',
      deletedAt: '2026-11-04T10:02:00.000Z',
      editedAt: '2026-11-04T10:01:00.000Z',
    });
    expect(merge([edited], [deleted])[0]!.deletedAt).not.toBeNull();
  });
});

describe('mensagens de sistema', () => {
  const names: Record<string, string> = { a: 'Ana Lima', b: 'Bruno Costa' };
  const nameOf = (id: string) => names[id] ?? '?';
  it('escreve do ponto de vista de quem lê', () => {
    expect(systemText({ event: 'group_created', actorId: 'a' }, nameOf, 'a')).toBe(
      'Você criou o grupo',
    );
    expect(
      systemText(
        {
          event: 'members_added',
          actorId: 'a',
          userIds: ['b', 'c'],
          names: ['Bruno Costa', 'Carla'],
        },
        nameOf,
        'c',
      ),
    ).toBe('Ana Lima adicionou Bruno Costa e você');
    expect(
      systemText(
        { event: 'member_removed', actorId: 'a', userId: 'b', name: 'Bruno Costa' },
        nameOf,
        'x',
      ),
    ).toBe('Ana Lima removeu Bruno Costa');
  });
});
