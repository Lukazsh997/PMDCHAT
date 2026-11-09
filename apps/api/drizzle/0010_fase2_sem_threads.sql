-- As threads foram retiradas: as respostas que existirem passam a aparecer na conversa
-- principal, na ordem em que foram enviadas (nada é apagado).
ALTER TABLE "messages" DROP CONSTRAINT "messages_thread_root_id_messages_id_fk";
--> statement-breakpoint
DROP INDEX "messages_thread_idx";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "thread_root_id";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "reply_count";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "last_reply_at";