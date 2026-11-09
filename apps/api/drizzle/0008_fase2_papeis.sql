CREATE TABLE "roles" (
	"key" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" varchar(240) DEFAULT '' NOT NULL,
	"scoped" boolean NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Papéis de sistema (os mesmos da Fase 1). O super administrador não guarda lista:
-- o sistema sempre lhe dá todas as permissões.
INSERT INTO "roles" ("key", "name", "description", "scoped", "is_system", "permissions") VALUES
  ('super_admin', 'Super administrador', 'Acesso total ao sistema', false, true, '{}'),
  ('unit_admin', 'Administrador de unidade', 'Gerencia os usuários da unidade e das unidades abaixo dela', true, true,
   '{admin.access,users.read,users.manage,broadcast.send,conversations.create_channel}'),
  ('auditor', 'Auditor', 'Consulta usuários e o registro de auditoria, sem alterar nada', false, true,
   '{admin.access,users.read,audit.read}'),
  ('broadcaster', 'Comunicador', 'Envia comunicados e cria canais de aviso para a unidade e as unidades abaixo dela', true, true,
   '{broadcast.send,messages.mention_all,conversations.create_channel}')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- Atribuições a papéis que não existem mais (ex.: moderador) não podem ficar órfãs.
DELETE FROM "role_assignments" WHERE "role" NOT IN (SELECT "key" FROM "roles");
--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_role_roles_key_fk" FOREIGN KEY ("role") REFERENCES "public"."roles"("key") ON DELETE restrict ON UPDATE cascade;