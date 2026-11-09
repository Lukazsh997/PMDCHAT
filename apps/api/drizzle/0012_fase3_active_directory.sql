CREATE TABLE "ldap_group_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dn" text NOT NULL,
	"role" varchar(32) NOT NULL,
	"org_unit_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ldap_ou_mappings" (
	"dn" text PRIMARY KEY NOT NULL,
	"org_unit_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ldap_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"start_tls" boolean DEFAULT false NOT NULL,
	"tls_verify" boolean DEFAULT true NOT NULL,
	"ca_cert" text,
	"bind_dn" text DEFAULT '' NOT NULL,
	"bind_password_enc" text,
	"base_dn" text DEFAULT '' NOT NULL,
	"user_filter" text NOT NULL,
	"username_attribute" varchar(64) NOT NULL,
	"display_name_attribute" varchar(64) NOT NULL,
	"email_attribute" varchar(64) NOT NULL,
	"job_title_attribute" varchar(64) NOT NULL,
	"default_org_unit_id" uuid,
	"auto_provision" boolean DEFAULT true NOT NULL,
	"sync_interval_minutes" integer DEFAULT 60 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ldap_sync_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trigger" varchar(16) NOT NULL,
	"status" varchar(16) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"summary" jsonb,
	"error" text,
	"actor_id" uuid
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ldap_dn" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ldap_disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD COLUMN "source" varchar(16) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "ldap_group_mappings" ADD CONSTRAINT "ldap_group_mappings_role_roles_key_fk" FOREIGN KEY ("role") REFERENCES "public"."roles"("key") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ldap_group_mappings" ADD CONSTRAINT "ldap_group_mappings_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ldap_ou_mappings" ADD CONSTRAINT "ldap_ou_mappings_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ldap_settings" ADD CONSTRAINT "ldap_settings_default_org_unit_id_org_units_id_fk" FOREIGN KEY ("default_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ldap_settings" ADD CONSTRAINT "ldap_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ldap_sync_runs" ADD CONSTRAINT "ldap_sync_runs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ldap_group_mappings_uq" ON "ldap_group_mappings" USING btree ("dn","role","org_unit_id");