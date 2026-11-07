ALTER TABLE "tasks" ADD COLUMN "workflow_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "workflow_ref" varchar(100);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "workflow_status" varchar(30);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "workflow_url" varchar(500);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "workflow_updated_at" timestamp with time zone;