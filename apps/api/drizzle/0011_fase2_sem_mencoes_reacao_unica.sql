-- Menções retiradas. Quem tinha escolhido "só menções" numa conversa passa a "nenhuma"
-- (a intenção era receber poucos avisos); a permissão de @todos sai dos papéis.
UPDATE "conversation_members" SET "notification_level" = 'none' WHERE "notification_level" = 'mentions';--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_remove("permissions", 'messages.mention_all');--> statement-breakpoint
DROP TABLE "message_mentions" CASCADE;--> statement-breakpoint
-- Reação única por pessoa: de quem reagiu com mais de um emoji, fica só a mais recente.
DELETE FROM "message_reactions" r
 USING "message_reactions" n
 WHERE n.message_id = r.message_id AND n.user_id = r.user_id
   AND (n.created_at, n.emoji) > (r.created_at, r.emoji);--> statement-breakpoint
ALTER TABLE "message_reactions" DROP CONSTRAINT "message_reactions_message_id_user_id_emoji_pk";--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_user_id_pk" PRIMARY KEY("message_id","user_id");--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "mentions_all";