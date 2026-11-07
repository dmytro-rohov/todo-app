CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"login" varchar(40) NOT NULL,
	"name" varchar(80) NOT NULL,
	"password_hash" text NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"disabled_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_check" CHECK ("users"."role" IN ('member'))
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "shared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "assignees" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "user_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "users_login" ON "users" USING btree ("login");--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignees" ADD CONSTRAINT "assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_user" ON "tasks" USING btree ("user_id");