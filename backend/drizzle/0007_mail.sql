CREATE TABLE "mail_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"mailbox" varchar(200) DEFAULT 'INBOX' NOT NULL,
	"uid_validity" bigint NOT NULL,
	"uid" bigint NOT NULL,
	"message_id" varchar(300),
	"from_address" varchar(254) DEFAULT '' NOT NULL,
	"from_name" varchar(200) DEFAULT '' NOT NULL,
	"to_addresses" text DEFAULT '' NOT NULL,
	"subject" varchar(500) DEFAULT '' NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"snippet" varchar(400) DEFAULT '' NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"attachments" text DEFAULT '' NOT NULL,
	"invite" text DEFAULT '' NOT NULL,
	"seen" boolean DEFAULT false NOT NULL,
	"handled_at" timestamp with time zone,
	"suggestion" text DEFAULT '' NOT NULL,
	"client_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "mail_id" integer;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_messages_mailbox_uid" ON "mail_messages" USING btree ("mailbox","uid_validity","uid");--> statement-breakpoint
CREATE INDEX "mail_messages_sent" ON "mail_messages" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "mail_messages_client" ON "mail_messages" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_mail_id_mail_messages_id_fk" FOREIGN KEY ("mail_id") REFERENCES "public"."mail_messages"("id") ON DELETE set null ON UPDATE no action;