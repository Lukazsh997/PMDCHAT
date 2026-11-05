import {
  effectiveNotificationLevel,
  type NotificationLevel,
  type PushPayload,
} from '@plataforma/contracts';
import { inArray, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type WebPush from 'web-push';
import type { Database } from '../database/database.js';
import { pushSubscriptions, type PushSubscriptionRow } from '../database/schema/index.js';
import { hasLiveConnection } from '../modules/realtime/index.js';

export const PUSH_QUEUE = 'push';

export interface PushJob {
  messageId: string;
  /** Membros da conversa, sem quem enviou. */
  userIds: string[];
}

/** Envia uma notificação; `gone` = inscrição não existe mais (apagar). */
export type PushSender = (
  sub: PushSubscriptionRow,
  payload: PushPayload,
) => Promise<{ ok: boolean; gone: boolean }>;

interface Row {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  body: string;
  thread_root_id: string | null;
  root_sender_id: string | null;
  mentions_all: boolean;
  attachment: string | null;
  sender_name: string | null;
  broadcast_label: string | null;
  type: 'direct' | 'group';
  name: string | null;
  is_channel: boolean;
  member_count: string;
}

/**
 * Decide quem recebe o push de uma mensagem e envia. Recebe quem:
 *  - não está com nenhuma aba aberta (quem está recebe pelo tempo real);
 *  - tem nível de aviso que inclui esta mensagem ("só menções" exige ser citado);
 *  - não silenciou a conversa, a menos que tenha sido citado;
 *  - numa resposta de thread, foi citado ou abriu a thread.
 */
export async function deliverPush(
  ctx: { db: Database; redis: Redis },
  job: PushJob,
  send: PushSender,
): Promise<{ sent: number; skipped: number; removed: number }> {
  const [m] = (await ctx.db.execute(sql`
    select m.id, m.conversation_id, m.sender_id, m.body, m.thread_root_id, r.sender_id as root_sender_id,
           m.mentions_all, s.display_name as sender_name, b.unit_name as broadcast_label,
           c.type, c.name, c.is_channel,
           (select count(*) from conversation_members x where x.conversation_id = c.id) as member_count,
           (select f.original_name from message_attachments a join files f on f.id = a.file_id
             where a.message_id = m.id order by a.position limit 1) as attachment
      from messages m
      join conversations c on c.id = m.conversation_id
      left join messages r on r.id = m.thread_root_id
      left join users s on s.id = m.sender_id
      left join broadcasts b on b.id = m.broadcast_id
     where m.id = ${job.messageId} and m.deleted_at is null
  `)) as unknown as Row[];
  if (!m || !job.userIds.length) return { sent: 0, skipped: job.userIds.length, removed: 0 };

  const members = (await ctx.db.execute(sql`
    select cm.user_id, cm.muted_until, cm.notification_level,
           exists (select 1 from message_mentions mm where mm.message_id = ${m.id} and mm.user_id = cm.user_id) as mentioned
      from conversation_members cm
     where cm.conversation_id = ${m.conversation_id}
       and cm.user_id in (${sql.join(
         job.userIds.map((u) => sql`${u}`),
         sql`, `,
       )})
  `)) as unknown as {
    user_id: string;
    muted_until: Date | null;
    notification_level: NotificationLevel | null;
    mentioned: boolean;
  }[];

  const targets: string[] = [];
  for (const r of members) {
    const mentioned = r.mentioned || m.mentions_all;
    const level = effectiveNotificationLevel({
      notificationSetting: r.notification_level,
      type: m.type,
      memberCount: Number(m.member_count),
      isChannel: m.is_channel,
    });
    if (level === 'none') continue;
    if (level === 'mentions' && !mentioned) continue;
    if (r.muted_until && new Date(r.muted_until) > new Date() && !mentioned) continue;
    if (m.thread_root_id && !mentioned && m.root_sender_id !== r.user_id) continue;
    if (await hasLiveConnection(ctx.redis, r.user_id)) continue;
    targets.push(r.user_id);
  }
  if (!targets.length) return { sent: 0, skipped: job.userIds.length, removed: 0 };

  const subs = await ctx.db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, targets));

  const who = m.sender_name ?? 'Nova mensagem';
  const where = m.type === 'group' ? ` em ${m.name ?? 'Grupo'}` : '';
  const text = m.body || (m.attachment ? `📎 ${m.attachment}` : '');
  const payloadFor = (userId: string): PushPayload => {
    const mentioned = m.mentions_all || members.some((x) => x.user_id === userId && x.mentioned);
    return {
      title: m.broadcast_label
        ? `Comunicado de ${who} para ${m.broadcast_label}`
        : mentioned
          ? `${who} mencionou você${where}`
          : m.thread_root_id
            ? `${who} respondeu na thread${where}`
            : `${who}${where}`,
      // A mensagem inteira não vai para o serviço de push: só o começo.
      body: text.length > 140 ? `${text.slice(0, 137)}…` : text,
      url: `/c/${m.conversation_id}${m.thread_root_id ? `?thread=${m.thread_root_id}` : ''}`,
      tag: m.thread_root_id ?? m.conversation_id,
    };
  };

  let sent = 0;
  const gone: string[] = [];
  const ok: string[] = [];
  for (const sub of subs) {
    const r = await send(sub, payloadFor(sub.userId));
    if (r.ok) {
      sent++;
      ok.push(sub.id);
    }
    if (r.gone) gone.push(sub.id);
  }
  if (gone.length)
    await ctx.db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
  if (ok.length) {
    await ctx.db
      .update(pushSubscriptions)
      .set({ lastSuccessAt: new Date() })
      .where(inArray(pushSubscriptions.id, ok));
  }
  return { sent, skipped: job.userIds.length - targets.length, removed: gone.length };
}

/** Um envio com web-push (VAPID). Erros 404/410 = navegador cancelou a inscrição. */
export function webPushSender(webpush: typeof WebPush, opts: { proxy?: string }): PushSender {
  return async (sub, payload) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60, urgency: 'high', ...(opts.proxy ? { proxy: opts.proxy } : {}) },
      );
      return { ok: true, gone: false };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      return { ok: false, gone: status === 404 || status === 410 };
    }
  };
}
