import { type BeforeApplicationShutdown, Inject, Injectable, Logger } from '@nestjs/common';
import {
  type ClientToServerEvents,
  REALTIME_PATH,
  type ServerToClientEvents,
} from '@plataforma/contracts';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { DomainEvents } from '../../common/events/domain-events.js';
import { isAllowedOrigin } from '../../common/origin-check.js';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { REDIS } from '../../redis/redis.module.js';
import { authenticate, SessionService } from '../auth/index.js';
import { ConversationsService } from '../conversations/index.js';
import { UsersService } from '../users/index.js';
import { PresenceStore } from './presence.js';

interface SocketData {
  userId: string;
  sessionId: string;
  tokenHash: string;
  status: 'online' | 'away';
}
type AppServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

const userRoom = (id: string) => `user:${id}`;
const REVALIDATE_MS = 60_000;
const MEMBERS_CACHE_MS = 30_000;
const uuid = z.uuid();

/**
 * Tempo real: uma conexão Socket.IO por aba, autenticada pelo mesmo cookie de sessão
 * do HTTP. O adaptador do Valkey distribui os eventos entre instâncias da API.
 * O envio de mensagens continua pelo REST (validação, limites e confirmação únicos);
 * a conexão serve para receber eventos e para sinais leves (digitação, presença).
 */
@Injectable()
export class RealtimeService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(RealtimeService.name);
  private io?: AppServer;
  private presence: PresenceStore;
  private timer?: NodeJS.Timeout;
  private subscribers: Redis[] = [];
  private readonly membersCache = new Map<string, { ids: string[]; at: number }>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly sessions: SessionService,
    private readonly users: UsersService,
    private readonly conversations: ConversationsService,
    private readonly events: DomainEvents,
  ) {
    this.presence = new PresenceStore(redis);
  }

  private closing = false;

  attach(server: HttpServer): void {
    // Sem autopipelining: o unsubscribe do encerramento sai antes do QUIT.
    const pub = this.redis.duplicate({ enableAutoPipelining: false });
    const sub = this.redis.duplicate({ enableAutoPipelining: false });
    this.subscribers = [pub, sub];
    const allowed = new Set(this.config.APP_ORIGINS);
    const io: AppServer = new Server(server, {
      path: REALTIME_PATH,
      serveClient: false,
      pingInterval: 25_000,
      pingTimeout: 20_000,
      maxHttpBufferSize: 64 * 1024,
      adapter: createAdapter(pub, sub, { key: 'rt' }),
      allowRequest: (req, cb) =>
        cb(null, isAllowedOrigin(req.headers.origin, req.headers.host, allowed)),
    });
    this.io = io;

    io.use(async (socket, next) => {
      try {
        const token = readCookie(socket.handshake.headers.cookie, this.config.SESSION_COOKIE_NAME);
        const auth = await authenticate(token, this.sessions, this.users);
        if (auth.user.mustChangePassword) throw new Error('troca de senha pendente');
        socket.data = {
          userId: auth.user.id,
          sessionId: auth.session.id,
          tokenHash: auth.session.tokenHash,
          status: 'online',
        };
        next();
      } catch {
        next(new Error('UNAUTHENTICATED'));
      }
    });
    io.on('connection', (socket) => void this.onConnection(socket));
    this.listen();
    this.timer = setInterval(() => void this.revalidate(), REVALIDATE_MS);
    this.timer.unref();
  }

  /** Fecha as conexões antes que o Valkey e o banco sejam encerrados. */
  async beforeApplicationShutdown(): Promise<void> {
    this.closing = true;
    clearInterval(this.timer);
    await new Promise<void>((r) => (this.io ? this.io.close(() => r()) : r()));
    await Promise.all(this.subscribers.map((c) => c.quit().catch(() => c.disconnect())));
  }

  private async onConnection(socket: AppSocket): Promise<void> {
    const { userId, sessionId } = socket.data;
    await socket.join([userRoom(userId), `session:${sessionId}`]);
    await this.publishPresence(userId, await this.presence.set(userId, socket.id, 'online'));

    socket.on('typing', (p) => void this.onTyping(socket, p?.conversationId).catch(this.ignore));
    socket.on('presence.set', (p) => {
      if (p?.status !== 'online' && p?.status !== 'away') return;
      socket.data.status = p.status;
      void this.presence
        .set(userId, socket.id, p.status)
        .then((s) => this.publishPresence(userId, s))
        .catch(this.ignore);
    });
    socket.on('presence.watch', (p, ack) => {
      const ids = (Array.isArray(p?.userIds) ? p.userIds : [])
        .filter((x) => uuid.safeParse(x).success)
        .slice(0, 2000);
      for (const room of socket.rooms) if (room.startsWith('presence:')) void socket.leave(room);
      void socket.join(ids.map((i) => `presence:${i}`));
      if (typeof ack === 'function') void this.presence.statuses(ids).then(ack).catch(this.ignore);
    });
    socket.on('disconnect', () => {
      // No desligamento do servidor o Valkey pode já estar fechado: a expiração resolve.
      void this.presence
        .remove(userId, socket.id)
        .then((s) => this.publishPresence(userId, s))
        .catch(this.ignore);
    });
  }

  private readonly ignore = (err: unknown) =>
    this.logger.debug(`Evento de tempo real ignorado: ${String(err)}`);

  private async onTyping(socket: AppSocket, conversationId: unknown): Promise<void> {
    if (typeof conversationId !== 'string' || !uuid.safeParse(conversationId).success) return;
    const members = await this.members(conversationId);
    if (!members.includes(socket.data.userId)) return;
    const others = members.filter((m) => m !== socket.data.userId).map(userRoom);
    if (others.length)
      this.io!.to(others).emit('typing', { conversationId, userId: socket.data.userId });
  }

  private async members(conversationId: string): Promise<string[]> {
    const hit = this.membersCache.get(conversationId);
    if (hit && Date.now() - hit.at < MEMBERS_CACHE_MS) return hit.ids;
    const ids = await this.conversations.memberIds(conversationId);
    this.membersCache.set(conversationId, { ids, at: Date.now() });
    return ids;
  }

  private async publishPresence(userId: string, status: Awaited<ReturnType<PresenceStore['set']>>) {
    // No desligamento, as desconexões chegam com o Valkey já fechando: o adaptador do
    // Socket.IO rejeitaria a publicação sem ninguém para tratar.
    if (this.closing) return;
    if (status) this.io?.to(`presence:${userId}`).emit('presence.changed', { userId, status });
  }

  /** Eventos de domínio → conexões dos destinatários. */
  private listen(): void {
    const toUsers = (ids: string[]) => this.io!.to(ids.map(userRoom));
    this.events.on('message.created', ({ message, recipientIds }) =>
      toUsers(recipientIds).emit('message.new', message),
    );
    this.events.on('message.updated', ({ message, recipientIds }) =>
      toUsers(recipientIds).emit('message.updated', message),
    );
    this.events.on('read.updated', ({ recipientIds, ...p }) =>
      toUsers(recipientIds).emit('read.updated', p),
    );
    this.events.on('conversation.changed', ({ summaries }) => {
      for (const [userId, s] of summaries)
        this.io!.to(userRoom(userId)).emit('conversation.updated', s);
      for (const s of summaries.values()) this.membersCache.delete(s.id);
    });
    this.events.on('conversation.left', ({ conversationId, userIds }) => {
      this.membersCache.delete(conversationId);
      toUsers(userIds).emit('conversation.removed', { conversationId });
    });
    this.events.on('session.revoked', ({ sessionIds }) => {
      const rooms = sessionIds.map((s) => `session:${s}`);
      this.io!.to(rooms).emit('session.revoked');
      this.io!.in(rooms).disconnectSockets(true);
    });
  }

  /**
   * Derruba conexões cuja sessão deixou de existir por outro caminho (CLI, expiração,
   * outra instância) e renova o heartbeat da presença.
   */
  private async revalidate(): Promise<void> {
    if (!this.io) return;
    for (const socket of this.io.of('/').sockets.values()) {
      const { userId, tokenHash } = socket.data;
      if (!(await this.sessions.isAlive(tokenHash).catch(() => true))) {
        socket.emit('session.revoked');
        socket.disconnect(true);
        continue;
      }
      await this.presence.refresh(userId).catch(() => undefined);
    }
  }
}

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}
