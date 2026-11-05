CREATE TABLE "broadcasts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sender_id" uuid,
	"org_unit_id" uuid,
	"unit_name" varchar(200) NOT NULL,
	"include_subunits" boolean NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"recipient_count" integer NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_key" varchar(255);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "broadcast_id" uuid;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "broadcasts_client_id_uq" ON "broadcasts" USING btree ("sender_id","client_id");--> statement-breakpoint
CREATE INDEX "broadcasts_unit_idx" ON "broadcasts" USING btree ("org_unit_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE set null ON UPDATE no action;