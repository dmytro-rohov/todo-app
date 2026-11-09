CREATE TABLE "app_settings" (
	"key" varchar(60) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "workflow_requested_by" varchar(10);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "ai_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "ai_coding" boolean;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "ai_reason" varchar(300);