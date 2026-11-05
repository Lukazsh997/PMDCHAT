import { z } from 'zod';
import type { DirectoryUser } from './users.js';

/** Regras de negócio decididas para o produto. */
export const MESSAGE_RULES = {
  maxBodyLength: 8000,
  editWindowMinutes: 15,
  /** Mensagens excluídas são removidas definitivamente após este prazo. */
  deletedRetentionHours: 48,
  maxAttachmentsPerMessage: 10,
  maxGroupMembers: 1000,
} as const;

export type ConversationType = 'direct' | 'group';
export type MemberRole = 'owner' | 'admin' | 'member';

export interface ConversationMember extends DirectoryUser {
  role: MemberRole;
  lastReadSeq: number;
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
  memberCount: number;
  myRole: MemberRole;
  lastSeq: number;
  lastReadSeq: number;
  unreadCount: number;
  mutedUntil: string | null;
  lastMessage: MessagePreview | null;
  lastMessageAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  members: ConversationMember[];
}

export type MessageType = 'text' | 'system';

export type SystemEvent =
  | { event: 'group_created'; actorId: string }
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
  /** Unidade de destino, ex.: "Secretaria de Administração (SEAD)". */
  unitName: string;
  includeSubunits: boolean;
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
}

export interface MessagePage {
  items: Message[];
  hasMore: boolean;
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

export const updateConversationSchema = createGroupSchema
  .pick({ name: true, description: true })
  .partial();

export const addMembersSchema = z.object({ userIds: z.array(z.uuid()).min(1).max(200) });

export const setMemberRoleSchema = z.object({ role: z.enum(['admin', 'member']) });

export const updateMySettingsSchema = z.object({
  mutedUntil: z.iso.datetime({ offset: true }).nullable(),
});

export const sendMessageSchema = z
  .object({
    clientId: z.string().min(8).max(64),
    body: z.string().max(MESSAGE_RULES.maxBodyLength, 'Mensagem muito longa').default(''),
    attachmentIds: z.array(z.uuid()).max(MESSAGE_RULES.maxAttachmentsPerMessage).default([]),
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
});

export const markReadSchema = z.object({ seq: z.number().int().min(0) });

/* ------------------------------ Comunicados ----------------------------- */

export const BROADCAST_RULES = {
  /** Teto de destinatários por envio. */
  maxRecipients: 5000,
} as const;

/**
 * Comunicado em massa: entregue como mensagem direta a cada pessoa ativa lotada na
 * unidade (e, se marcado, nas subunidades). Respostas chegam em particular a quem enviou.
 */
export const sendBroadcastSchema = z
  .object({
    orgUnitId: z.uuid(),
    includeSubunits: z.boolean().default(true),
    clientId: z.string().min(8).max(64),
    body: z.string().max(MESSAGE_RULES.maxBodyLength, 'Mensagem muito longa').default(''),
    attachmentIds: z.array(z.uuid()).max(MESSAGE_RULES.maxAttachmentsPerMessage).default([]),
  })
  .transform((v) => ({ ...v, body: v.body.trim() }))
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
}
