CREATE TABLE "roster_entries" (
	"username" varchar(64) PRIMARY KEY NOT NULL,
	"display_name" varchar(160),
	"org_unit_id" uuid,
	"import_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roster_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"actor_id" uuid,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ldap_settings" ADD COLUMN "org_unit_source" varchar(16) DEFAULT 'ad' NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_import_id_roster_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."roster_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_imports" ADD CONSTRAINT "roster_imports_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;