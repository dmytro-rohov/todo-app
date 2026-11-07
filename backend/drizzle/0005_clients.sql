CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"status" varchar(10) DEFAULT 'lead' NOT NULL,
	"company" varchar(160) DEFAULT '' NOT NULL,
	"email" varchar(200),
	"phone" varchar(40) DEFAULT '' NOT NULL,
	"website" varchar(300) DEFAULT '' NOT NULL,
	"domain" varchar(120),
	"color" varchar(7) NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source" varchar(20) DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_status_check" CHECK ("clients"."status" IN ('lead', 'client', 'archived')),
	CONSTRAINT "clients_source_check" CHECK ("clients"."source" IN ('manual', 'booking', 'mail', 'meeting'))
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "client_id" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "client_id" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "client_id" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "meeting_id" integer;--> statement-breakpoint
CREATE INDEX "clients_email" ON "clients" USING btree ("email");--> statement-breakpoint
CREATE INDEX "clients_domain" ON "clients" USING btree ("domain");--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_meeting_id_calendar_events_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."calendar_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_client" ON "tasks" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "tasks_meeting" ON "tasks" USING btree ("meeting_id");