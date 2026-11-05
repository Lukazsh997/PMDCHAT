import { z } from 'zod';
import type { DirectoryUser } from './users.js';

/** Regras de negócio decididas para o produto. */
export const MESSAGE_RULES = {
  maxBodyLength: 8000,
  /**
   * Quem enviou pode editar ou apagar a mensagem até este prazo, contado pela hora de
   * envio registrada no servidor. Ninguém apaga mensagem de outra pessoa.
   */
  editWindowMinutes: 10,
  deleteWindowMinutes: 10,
  /** Mensagens excluídas são removidas definitivamente após este prazo. */
  deletedRetentionHours: 48,
  maxAttachmentsPerMessage: 10,
  maxGroupMembers: 1000,
  /** Em grupos até este tamanho qualquer membro usa @todos; acima, só admins do grupo ou quem tem a permissão. */
  mentionAllFreeUpTo: 50,
} as const;

/** Reações disponíveis (conjunto fixo: leve, sem seletor de emojis completo). */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '✅', '👀'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export interface Reaction {
  emoji: string;
  userIds: string[];
}

export type ConversationType = 'direct' | 'group';

/** Quando avisar sobre uma conversa. */
export type NotificationLevel = 'all' | 'mentions' | 'none';
export const NOTIFICATION_LEVELS: Record<NotificationLevel, string> = {
  all: 'Todas as mensagens',
  mentions: 'Só quando me mencionarem',
  none: 'Nenhuma',
};
/** Grupos maiores que isto avisam só menções, salvo escolha da pessoa. */
export const LARGE_GROUP_SIZE = 50;

/** Nível que vale: o escolhido, ou o padrão (diretas e canais: todas; grupos grandes: menções). */
export function effectiveNotificationLevel(c: {
  notificationSetting: NotificationLevel | null;
  type: ConversationType;
  memberCount: number;
  isChannel: boolean;
}): NotificationLevel {
  if (c.notificationSetting) return c.notificationSetting;
  return c.type === 'group' && !c.isChannel && c.memberCount > LARGE_GROUP_SIZE
    ? 'mentions'
    : 'all';
}
export type MemberRole = 'owner' | 'admin' | 'member';

export interface ConversationMember extends DirectoryUser {
  role: MemberRole;
  lastReadSeq: number;
  /** Canal de unidade: entrou pela lotação (sai sozinho se mudar de unidade). */
  autoJoined: boolean;
}

/** Canal de avisos: só administradores publicam. */
export interface ChannelInfo {
  /** Unidade cujas pessoas são membros automáticos. */
  orgUnit: { id: string; name: string; acronym: string | null } | null;
  includeSubunits: boolean;
}

export interface MessagePreview {
  id: string;
  seq: number;
  senderId: string | null;
  senderName: string | null;
  type: MessageType;
  text: string;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  type: ConversationType;
  /** Nome do grupo, ou o nome da outra pessoa numa conversa direta. */
  title: string;
  description: string | null;
  /** Conversa direta: a outra pessoa. */
  peer: DirectoryUser | null;
  /** Preenchido quando o grupo é um canal de avisos. */
  channel: ChannelInfo | null;
  memberCount: number;
  myRole: MemberRole;
  lastSeq: number;
  lastReadSeq: number;
  unreadCount: number;
  /** Não lidas que mencionam você (ou @todos). */
  unreadMentions: number;
  mutedUntil: string | null;
  /** Escolha da pessoa (null = padrão). */
  notificationSetting: NotificationLevel | null;
  /** O que vale de fato. */
  notificationLevel: NotificationLevel;
  lastMessage: MessagePreview | null;
  lastMessageAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  members: ConversationMember[];
}

export type MessageType = 'text' | 'system';

export type SystemEvent =
  | { event: 'group_created'; actorId: string }
  | { event: 'channel_created'; actorId: string }
  | { event: 'members_added'; actorId: string; userIds: string[]; names: string[] }
  | { event: 'member_removed'; actorId: string; userId: string; name: string }
  | { event: 'member_left'; actorId: string }
  | { event: 'renamed'; actorId: string; name: string };

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
  width: number | null;
  height: number | null;
}

/** Mensagem entregue por um comunicado em massa. */
export interface BroadcastRef {
  id: string;
  /** Para quem foi, ex.: "SEAD e subunidades, DCA e 3 pessoas". */
  label: string;
}

export interface Message {
  id: string;
  conversationId: string;
  seq: number;
  senderId: string | null;
  type: MessageType;
  /** Vazio quando a mensagem foi apagada. */
  body: string;
  system: SystemEvent | null;
  attachments: Attachment[];
  clientId: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  broadcast: BroadcastRef | null;
  reactions: Reaction[];
  /** Pessoas mencionadas (@Nome). */
  mentions: string[];
  /** @todos */
  mentionsAll: boolean;
}

/** Item da aba Menções. */
export interface MentionItem {
  message: Message;
  senderName: string;
  conversation: { id: string; type: ConversationType; title: string };
  unread: boolean;
}

export interface MentionPage {
  items: MentionItem[];
  hasMore: boolean;
}

export interface MessagePage {
  items: Message[];
  /** Há mensagens mais antigas. */
  hasMore: boolean;
  /** Há mensagens mais novas (página aberta no meio da conversa, ex.: pela busca). */
  hasNewer?: boolean;
}

export const createDirectSchema = z.object({ userId: z.uuid() });

export const createGroupSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do grupo').max(120),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((v) => v || null)
    .nullable()
    .optional(),
  memberIds: z.array(z.uuid()).max(MESSAGE_RULES.maxGroupMembers),
});
export type CreateGroupRequest = z.input<typeof createGroupSchema>;

export const createChannelSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe o nome do canal').max(120),
    description: z
      .string()
      .trim()
      .max(500)
      .transform((v) => v || null)
      .nullable()
      .optional(),
    /** Unidade cujas pessoas entram automaticamente. */
    orgUnitId: z.uuid().nullable().default(null),
    includeSubunits: z.boolean().default(true),
    /** Pessoas escolhidas uma a uma (além das da unidade). */
    memberIds: z.array(z.uuid()).max(MESSAGE_RULES.maxGroupMembers).default([]),
  })
  .refine((v) => v.orgUnitId || v.memberIds.length, {
    message: 'Escolha uma unidade ou ao menos uma pessoa',
    path: ['memberIds'],
  });
export type CreateChannelRequest = z.input<typeof createChannelSchema>;

/** Onde a pessoa tem uma permissão (para oferecer só as unidades possíveis). */
export interface PermissionScopes {
  global: boolean;
  unitIds: string[];
}

export const updateConversationSchema = createGroupSchema
  .pick({ name: true, description: true })
  .partial();

export const addMembersSchema = z.object({ userIds: z.array(z.uuid()).min(1).max(200) });

export const setMemberRoleSchema = z.object({ role: z.enum(['admin', 'member']) });

export const updateMySettingsSchema = z
  .object({
    mutedUntil: z.iso.datetime({ offset: true }).nullable(),
    notificationLevel: z.enum(['all', 'mentions', 'none']).nullable(),
  })
  .partial();

export const sendMessageSchema = z
  .object({
    clientId: z.string().min(8).max(64),
    body: z.string().max(MESSAGE_RULES.maxBodyLength, 'Mensagem muito longa').default(''),
    attachmentIds: z.array(z.uuid()).max(MESSAGE_RULES.maxAttachmentsPerMessage).default([]),
    /** Pessoas mencionadas; o texto precisa conter "@Nome" de cada uma. */
    mentions: z.array(z.uuid()).max(100).default([]),
    mentionAll: z.boolean().default(false),
  })
  .transform((v) => ({ ...v, body: v.body.replace(/\s+$/u, '').replace(/^\s*\n/u, '') }))
  .refine((v) => v.body.trim().length > 0 || v.attachmentIds.length > 0, {
    message: 'Escreva uma mensagem ou anexe um arquivo',
    path: ['body'],
  });
export type SendMessageRequest = z.input<typeof sendMessageSchema>;

export const editMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'A mensagem não pode ficar vazia')
    .max(MESSAGE_RULES.maxBodyLength),
  mentions: z.array(z.uuid()).max(100).default([]),
  mentionAll: z.boolean().default(false),
});

export const reactionSchema = z.object({
  emoji: z.enum(REACTION_EMOJIS as unknown as [ReactionEmoji, ...ReactionEmoji[]]),
});

export const markReadSchema = z.object({ seq: z.number().int().min(0) });

/* ------------------------------ Comunicados ----------------------------- */

export const BROADCAST_RULES = {
  /** Teto de destinatários por envio. */
  maxRecipients: 5000,
  /**
   * Sem a permissão de comunicado sobre os setores escolhidos (ou sem nenhuma), o envio
   * alcança no máximo este número de pessoas.
   */
  maxPeopleWithoutPermission: 50,
  maxUnits: 50,
  maxPeople: 500,
} as const;

export const broadcastTargetsSchema = z.object({
  /** Setores: todas as pessoas ativas lotadas (e, se marcado, nas subunidades). */
  units: z
    .array(z.object({ orgUnitId: z.uuid(), includeSubunits: z.boolean().default(true) }))
    .max(BROADCAST_RULES.maxUnits)
    .default([]),
  /** Pessoas escolhidas uma a uma. */
  userIds: z.array(z.uuid()).max(BROADCAST_RULES.maxPeople).default([]),
});
export type BroadcastTargets = z.input<typeof broadcastTargetsSchema>;

const hasTarget = (v: { units: unknown[]; userIds: unknown[] }) =>
  v.units.length > 0 || v.userIds.length > 0;

export const broadcastPreviewSchema = broadcastTargetsSchema.refine(hasTarget, {
  message: 'Escolha ao menos uma pessoa ou setor',
  path: ['userIds'],
});

/**
 * Comunicado em massa: entregue como mensagem direta a cada destinatário (pessoas
 * escolhidas e pessoas ativas dos setores escolhidos, sem repetir). Respostas chegam
 * em particular a quem enviou.
 */
export const sendBroadcastSchema = broadcastTargetsSchema
  .extend({
    clientId: z.string().min(8).max(64),
    body: z.string().max(MESSAGE_RULES.maxBodyLength, 'Mensagem muito longa').default(''),
    attachmentIds: z.array(z.uuid()).max(MESSAGE_RULES.maxAttachmentsPerMessage).default([]),
  })
  .transform((v) => ({ ...v, body: v.body.trim() }))
  .refine(hasTarget, { message: 'Escolha ao menos uma pessoa ou setor', path: ['userIds'] })
  .refine((v) => v.body.length > 0 || v.attachmentIds.length > 0, {
    message: 'Escreva o comunicado ou anexe um arquivo',
    path: ['body'],
  });
export type SendBroadcastRequest = z.input<typeof sendBroadcastSchema>;

export interface BroadcastResult {
  id: string;
  recipientCount: number;
}

/** Onde a pessoa pode enviar comunicados. */
export interface BroadcastScopes {
  /** Em qualquer unidade. */
  global: boolean;
  /** Unidades (e as abaixo delas) em que pode enviar. */
  unitIds: string[];
}

export interface BroadcastPreview {
  recipientCount: number;
  /**
   * Máximo de destinatários deste envio: sem a permissão de comunicado sobre algum
   * setor escolhido, vale o limite de mensagens individuais. null = sem esse limite.
   */
  limit: number | null;
}

/* --------------------------------- Busca -------------------------------- */

export const searchMessagesSchema = z.object({
  q: z.string().trim().min(2, 'Digite ao menos 2 letras').max(200),
  conversationId: z.uuid().optional(),
  senderId: z.uuid().optional(),
  /** Período (datas ISO, inclusive). */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** Só mensagens com anexo. */
  withFiles: z.enum(['1']).optional(),
  /** Paginação: mensagens enviadas antes deste instante. */
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchMessagesQuery = z.input<typeof searchMessagesSchema>;

/** Trecho com os termos encontrados entre os marcadores abaixo (texto puro, nunca HTML). */
export const SEARCH_MARK = { start: '\u2063[', end: ']\u2063' } as const;

export interface SearchMessageHit {
  message: Message;
  conversation: { id: string; type: ConversationType; title: string };
  senderName: string;
  snippet: string;
}

export interface SearchMessagesPage {
  items: SearchMessageHit[];
  hasMore: boolean;
}

export const searchFilesSchema = z.object({
  q: z.string().trim().min(2).max(200),
  conversationId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export interface SearchFileHit {
  file: Attachment;
  messageId: string;
  seq: number;
  conversation: { id: string; type: ConversationType; title: string };
  senderName: string;
  createdAt: string;
}

/* ------------------------------ Web Push ------------------------------- */

export interface PushConfig {
  /** Desligado na instalação (PUSH_ENABLED=false). */
  enabled: boolean;
  /** Chave pública VAPID para o navegador assinar. */
  publicKey: string | null;
}

export const pushSubscriptionSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2000),
  keys: z.object({
    p256dh: z.string().min(16).max(255),
    auth: z.string().min(8).max(255),
  }),
});
export type PushSubscriptionRequest = z.infer<typeof pushSubscriptionSchema>;

/** O que o service worker recebe para mostrar a notificação. */
export interface PushPayload {
  title: string;
  body: string;
  /** Caminho a abrir no clique (ex.: /c/<id>). */
  url: string;
  /** Agrupa: uma notificação por conversa, substituída pela mais nova. */
  tag: string;
}
