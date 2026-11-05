CREATE TABLE "spaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(20),
	"name" varchar(50) NOT NULL,
	"color" varchar(7) NOT NULL,
	"agent_visible" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spaces_position_check" CHECK ("spaces"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"space_id" integer NOT NULL,
	"name" varchar(80) NOT NULL,
	"color" varchar(7) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_position_check" CHECK ("projects"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "assignees" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"color" varchar(7) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_labels" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"category_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_subtasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "task_subtasks_position_check" CHECK ("task_subtasks"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "task_time_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"field" varchar(32) NOT NULL,
	"old_value" text,
	"new_value" text,
	"actor" varchar(40) DEFAULT 'owner' NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "space_id" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "project_id" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "assignee_id" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "review_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_labels" ADD CONSTRAINT "task_labels_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_labels" ADD CONSTRAINT "task_labels_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_notes" ADD CONSTRAINT "task_notes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_subtasks" ADD CONSTRAINT "task_subtasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_history" ADD CONSTRAINT "task_history_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spaces_key" ON "spaces" USING btree ("key") WHERE "spaces"."key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "projects_space" ON "projects" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_labels_task_category" ON "task_labels" USING btree ("task_id","category_id");--> statement-breakpoint
CREATE INDEX "task_labels_category" ON "task_labels" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "task_notes_task" ON "task_notes" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_subtasks_task" ON "task_subtasks" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_time_entries_task" ON "task_time_entries" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_time_entries_running" ON "task_time_entries" USING btree ("task_id") WHERE "task_time_entries"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "task_history_task" ON "task_history" USING btree ("task_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_assignees_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."assignees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_space" ON "tasks" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "tasks_project" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee" ON "tasks" USING btree ("assignee_id");