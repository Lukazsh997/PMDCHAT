CREATE TABLE "message_mentions" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "message_mentions_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "message_reactions" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_reactions_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "thread_root_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reply_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "last_reply_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "mentions_all" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_mentions_user_idx" ON "message_mentions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_root_id_messages_id_fk" FOREIGN KEY ("thread_root_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_root_id","seq") WHERE "messages"."thread_root_id" is not null;--> statement-breakpoint
-- Busca em português que ignora acentos: "secretaria" encontra "Secretária".
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'pt_unaccent') THEN
    CREATE TEXT SEARCH CONFIGURATION pt_unaccent (COPY = portuguese);
    ALTER TEXT SEARCH CONFIGURATION pt_unaccent
      ALTER MAPPING FOR hword, hword_part, word WITH unaccent, portuguese_stem;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "body_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('pt_unaccent'::regconfig, "body")) STORED;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_body_tsv_idx" ON "messages" USING gin ("body_tsv");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_name_trgm_idx" ON "files" USING gin (lower("original_name") gin_trgm_ops);
