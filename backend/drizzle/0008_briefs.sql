CREATE TABLE "meeting_briefs" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer,
	"client_id" integer,
	"mail_id" integer,
	"source" varchar(20) DEFAULT 'paste' NOT NULL,
	"notes" text NOT NULL,
	"result" text DEFAULT '' NOT NULL,
	"error" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_briefs_source_check" CHECK ("meeting_briefs"."source" IN ('paste', 'gemini-mail'))
);
--> statement-breakpoint
ALTER TABLE "meeting_briefs" ADD CONSTRAINT "meeting_briefs_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_briefs" ADD CONSTRAINT "meeting_briefs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_briefs" ADD CONSTRAINT "meeting_briefs_mail_id_mail_messages_id_fk" FOREIGN KEY ("mail_id") REFERENCES "public"."mail_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_briefs_event" ON "meeting_briefs" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "meeting_briefs_mail" ON "meeting_briefs" USING btree ("mail_id");