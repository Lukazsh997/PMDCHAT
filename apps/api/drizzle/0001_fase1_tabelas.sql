-- Busca aproximada por nome (pg_trgm é uma extensão confiável: o dono do banco pode criá-la).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE TYPE "public"."user_kind" AS ENUM('member', 'guest');--> statement-breakpoint
CREATE TYPE "public"."conversation_type" AS ENUM('direct', 'group');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'system');--> statement-breakpoint
CREATE TABLE "org_units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parent_id" uuid,
	"kind" varchar(32) NOT NULL,
	"name" varchar(160) NOT NULL,
	"acronym" varchar(24),
	"path" text NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(32) NOT NULL,
	"org_unit_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"uploader_id" uuid,
	"storage_key" varchar(255) NOT NULL,
	"thumbnail_key" varchar(255),
	"original_name" varchar(255) NOT NULL,
	"mime_type" varchar(127) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"is_image" boolean DEFAULT false NOT NULL,
	"width" integer,
	"height" integer,
	"scan_status" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attached_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversation_members" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"last_read_seq" bigint DEFAULT 0 NOT NULL,
	"muted_until" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"joined_seq" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "conversation_members_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" "conversation_type" NOT NULL,
	"name" varchar(120),
	"description" varchar(500),
	"direct_key" varchar(80),
	"created_by" uuid,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"message_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "message_attachments_message_id_file_id_pk" PRIMARY KEY("message_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "message_edits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"message_id" uuid NOT NULL,
	"previous_body" text NOT NULL,
	"edited_by" uuid,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"sender_id" uuid,
	"type" "message_type" DEFAULT 'text' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"system" jsonb,
	"client_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"purged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user_credentials" ADD COLUMN "mfa_secret_enc" text;--> statement-breakpoint
ALTER TABLE "user_credentials" ADD COLUMN "mfa_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "kind" "user_kind" DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "org_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "access_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_id_org_units_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_edits" ADD CONSTRAINT "message_edits_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_edits" ADD CONSTRAINT "message_edits_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_units_parent_name_uq" ON "org_units" USING btree (coalesce("parent_id", '00000000-0000-0000-0000-000000000000'),lower("name"));--> statement-breakpoint
CREATE INDEX "org_units_path_idx" ON "org_units" USING btree ("path" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "role_assignments_user_idx" ON "role_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignments_uq" ON "role_assignments" USING btree ("user_id","role",coalesce("org_unit_id", '00000000-0000-0000-0000-000000000000'));--> statement-breakpoint
CREATE INDEX "files_uploader_idx" ON "files" USING btree ("uploader_id");--> statement-breakpoint
CREATE INDEX "files_orphan_idx" ON "files" USING btree ("attached_at","created_at");--> statement-breakpoint
CREATE INDEX "conversation_members_user_idx" ON "conversation_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_direct_key_uq" ON "conversations" USING btree ("direct_key") WHERE "conversations"."direct_key" is not null;--> statement-breakpoint
CREATE INDEX "message_attachments_file_idx" ON "message_attachments" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "message_edits_message_idx" ON "message_edits" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conversation_seq_uq" ON "messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_client_id_uq" ON "messages" USING btree ("conversation_id","sender_id","client_id") WHERE "messages"."client_id" is not null;--> statement-breakpoint
CREATE INDEX "messages_pending_purge_idx" ON "messages" USING btree ("deleted_at") WHERE "messages"."deleted_at" is not null and "messages"."purged_at" is null;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_org_unit_idx" ON "users" USING btree ("org_unit_id");--> statement-breakpoint
CREATE INDEX "users_name_trgm_idx" ON "users" USING gin (lower("display_name") gin_trgm_ops);