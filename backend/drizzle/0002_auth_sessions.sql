CREATE TABLE "auth_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"login" varchar(80) NOT NULL,
	"method" varchar(10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_sessions_method_check" CHECK ("auth_sessions"."method" IN ('password', 'mytko'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_expires" ON "auth_sessions" USING btree ("expires_at");