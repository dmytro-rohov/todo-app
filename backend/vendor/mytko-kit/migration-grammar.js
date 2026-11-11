// Production migrations are admitted by Mytko's additive Drizzle grammar (mytko-workflow,
// src/mytko/domain/drizzle_migrations.py), which is the authoritative check. This is an early, simplified guard so a
// non-additive migration fails in the app's tests instead of at release preparation: every statement must be a CREATE
// TABLE, CREATE INDEX, ADD COLUMN or a drizzle-kit foreign key, without DROP, RENAME, UPDATE/INSERT/DELETE, TRUNCATE,
// GRANT/REVOKE, triggers, functions, DO blocks, extensions, types/enums, CONCURRENTLY, NOT VALID or DEFERRABLE.
const ALLOWED = [
  /^CREATE TABLE "[a-z_]+" \(/,
  /^CREATE (UNIQUE )?INDEX "[a-z_]+" ON "[a-z_]+"( USING btree)? \(/,
  /^ALTER TABLE "[a-z_]+" ADD COLUMN "[a-z_]+" /,
  /^ALTER TABLE "[a-z_]+" ADD CONSTRAINT "[a-z_]+" FOREIGN KEY \("[a-z_]+"\) REFERENCES "public"\."[a-z_]+"\("id"\)/
];
const FORBIDDEN = /\b(DROP|RENAME|UPDATE|INSERT|DELETE|TRUNCATE|GRANT|REVOKE|TRIGGER|FUNCTION|DO|EXTENSION|TYPE|ENUM|CONCURRENTLY|NOT VALID|DEFERRABLE)\b/;

// migrations: listMigrations(dir). Returns a list of problems (empty: every statement is additive).
function additiveProblems(migrations) {
  const problems = [];
  for (const migration of migrations) {
    for (const chunk of migration.sql.split("--> statement-breakpoint")) {
      const statement = chunk.replace(/\s+/g, " ").trim();
      if (!ALLOWED.some(pattern => pattern.test(statement))) problems.push(`${migration.version}: not additive: ${statement.slice(0, 80)}`);
      // Foreign keys carry the only DELETE/UPDATE words drizzle-kit emits: their referential actions.
      const withoutActions = statement.replace(/ ON (DELETE|UPDATE) (cascade|set null|restrict|no action)/g, "");
      if (FORBIDDEN.test(withoutActions)) problems.push(`${migration.version}: forbidden: ${statement.slice(0, 80)}`);
      if (!/;$/.test(statement)) problems.push(`${migration.version}: no closing semicolon: ${statement.slice(0, 80)}`);
    }
  }
  return problems;
}

module.exports = { additiveProblems, ALLOWED, FORBIDDEN };
