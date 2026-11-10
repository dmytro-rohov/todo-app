CREATE TABLE "avatars" (
	"account" varchar(24) PRIMARY KEY NOT NULL,
	"user_id" integer,
	"mime" varchar(20) NOT NULL,
	"data" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "avatars_mime_check" CHECK ("avatars"."mime" IN ('image/webp', 'image/jpeg'))
);
--> statement-breakpoint
CREATE TABLE "space_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"space_id" integer NOT NULL,
	"user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"space_id" integer NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_invites" ADD CONSTRAINT "space_invites_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_invites" ADD CONSTRAINT "space_invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "avatars_user" ON "avatars" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "space_members_member" ON "space_members" USING btree ("space_id","user_id") WHERE "space_members"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "space_members_owner" ON "space_members" USING btree ("space_id") WHERE "space_members"."user_id" IS NULL;--> statement-breakpoint
CREATE INDEX "space_members_user" ON "space_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "space_invites_code" ON "space_invites" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "space_invites_space" ON "space_invites" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "space_invites_used_by" ON "space_invites" USING btree ("used_by");