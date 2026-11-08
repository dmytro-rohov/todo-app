CREATE TABLE "goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"month" integer,
	"kind" varchar(10) DEFAULT 'goal' NOT NULL,
	"title" varchar(160) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"deadline" date,
	"done_at" timestamp with time zone,
	"position" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" integer,
	CONSTRAINT "goals_kind_check" CHECK ("goals"."kind" IN ('goal', 'dream')),
	CONSTRAINT "goals_year_check" CHECK ("goals"."year" >= 2000 AND "goals"."year" <= 2200),
	CONSTRAINT "goals_month_check" CHECK ("goals"."month" >= 1 AND "goals"."month" <= 12),
	CONSTRAINT "goals_position_check" CHECK ("goals"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goals_period" ON "goals" USING btree ("user_id","year","month","position");