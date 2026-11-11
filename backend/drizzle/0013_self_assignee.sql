ALTER TABLE "assignees" ADD COLUMN "account" varchar(24);--> statement-breakpoint
CREATE UNIQUE INDEX "assignees_account" ON "assignees" USING btree ("account");