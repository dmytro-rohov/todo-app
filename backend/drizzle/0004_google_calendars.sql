CREATE TABLE "calendar_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"space_id" integer NOT NULL,
	"provider" varchar(20) DEFAULT 'google' NOT NULL,
	"account_email" varchar(200) NOT NULL,
	"calendar_id" varchar(300) DEFAULT 'primary' NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_accounts_provider_check" CHECK ("calendar_accounts"."provider" IN ('google'))
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"external_id" varchar(300) NOT NULL,
	"title" varchar(500) DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"location" varchar(500) DEFAULT '' NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"meet_url" varchar(300),
	"html_link" varchar(600),
	"attendees" text DEFAULT '' NOT NULL,
	"status" varchar(20) DEFAULT 'confirmed' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_accounts" ADD CONSTRAINT "calendar_accounts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_account_id_calendar_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."calendar_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_accounts_space" ON "calendar_accounts" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_account_external" ON "calendar_events" USING btree ("account_id","external_id");--> statement-breakpoint
CREATE INDEX "calendar_events_start" ON "calendar_events" USING btree ("start_at");