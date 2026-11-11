// Production migrations are admitted by Mytko's additive Drizzle grammar (mytko-workflow,
// src/mytko/domain/drizzle_migrations.py), which is the authoritative check. This test is an early, simplified
// guard so a non-additive migration fails here instead of at release preparation.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { listMigrations } = require("../kit");

const ALLOWED = [
  /^CREATE TABLE "[a-z_]+" \(/,
  /^CREATE (UNIQUE )?INDEX "[a-z_]+" ON "[a-z_]+"( USING btree)? \(/,
  /^ALTER TABLE "[a-z_]+" ADD COLUMN "[a-z_]+" /,
  /^ALTER TABLE "[a-z_]+" ADD CONSTRAINT "[a-z_]+" FOREIGN KEY \("[a-z_]+"\) REFERENCES "public"\."[a-z_]+"\("id"\)/
];
const FORBIDDEN = /\b(DROP|RENAME|UPDATE|INSERT|DELETE|TRUNCATE|GRANT|REVOKE|TRIGGER|FUNCTION|DO|EXTENSION|TYPE|ENUM|CONCURRENTLY|NOT VALID|DEFERRABLE)\b/;

test("every shipped migration stays inside the additive grammar", () => {
  for (const migration of listMigrations(path.join(__dirname, "..", "drizzle"))) {
    for (const chunk of migration.sql.split("--> statement-breakpoint")) {
      const statement = chunk.replace(/\s+/g, " ").trim();
      assert.ok(ALLOWED.some(pattern => pattern.test(statement)), `${migration.version}: not additive: ${statement.slice(0, 80)}`);
      // Foreign keys carry the only DELETE/UPDATE words drizzle-kit emits: their referential actions.
      const withoutActions = statement.replace(/ ON (DELETE|UPDATE) (cascade|set null|restrict|no action)/g, "");
      assert.doesNotMatch(withoutActions, FORBIDDEN, `${migration.version}: ${statement.slice(0, 80)}`);
      assert.match(statement, /;$/);
    }
  }
});
