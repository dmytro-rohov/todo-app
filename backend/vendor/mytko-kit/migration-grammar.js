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

// The statement forms of Workflow's grammar itself (drizzle_migrations.py: _TABLE, _INDEX, _COLUMN_ADD, _FK_ADD), so a
// column type or DEFAULT it refuses (jsonb, numeric, a cast like '{}'::jsonb, an expression) fails here too (0.13.1).
const IDENT = String.raw`"[A-Za-z_][A-Za-z0-9_]{0,62}"`;
const NAME = String.raw`(?:(?-i:"public")\.)?${IDENT}`;
const COLREF = String.raw`${IDENT}(?:\.${IDENT})?`;
const TYPE = String.raw`(?:integer|bigint|smallint|serial|bigserial|text|boolean|uuid|date|timestamp(?: with(?:out)? time zone)?|varchar\([1-9][0-9]{0,3}\))`;
const STRING = String.raw`'[A-Za-z0-9 _.,:/@+-]{0,100}'`;
const DEFAULT = String.raw`(?: DEFAULT (?:true|false|-?[0-9]{1,18}|${STRING}|now\(\)|CURRENT_TIMESTAMP|gen_random_uuid\(\)))`;
const ACTION = "(?:cascade|set null|restrict|no action)";
const COLUMN = String.raw`${IDENT} ${TYPE}(?: PRIMARY KEY)?${DEFAULT}?(?: NOT NULL)?`;
const PREDICATE = String.raw`(?:${COLREF} (?:>=|<=|>|<|=) -?[0-9]{1,18}|${COLREF} IN \(${STRING}(?:, ?${STRING}){0,19}\))`;
const CHECK = String.raw`CONSTRAINT ${IDENT} CHECK \( ?${PREDICATE}(?: AND ${PREDICATE}){0,7} ?\)`;
const PARTIAL = String.raw`(?: WHERE ${COLREF} IS (?:NOT )?NULL)?`;
const whole = source => new RegExp(`^(?:${source})$`, "i");
const STATEMENTS = [
  whole(String.raw`CREATE TABLE ${NAME} ?\( ?${COLUMN}(?: ?, ?${COLUMN})*(?: ?, ?${CHECK})* ?\) ?;`),
  whole(String.raw`CREATE (?:UNIQUE )?INDEX ${IDENT} ON ${NAME}(?: USING btree)? ?\( ?${IDENT}(?: ?, ?${IDENT})* ?\)${PARTIAL} ?;`),
  whole(String.raw`ALTER TABLE ${NAME} ADD COLUMN ${COLUMN} ?;`),
  whole(String.raw`ALTER TABLE ${NAME} ADD CONSTRAINT ${IDENT} FOREIGN KEY \(${IDENT}\) REFERENCES ${NAME} ?\(${IDENT}\)(?: ON DELETE ${ACTION})?(?: ON UPDATE no action)? ?;`)
];

// migrations: listMigrations(dir). Returns a list of problems (empty: every statement is additive).
function additiveProblems(migrations) {
  const problems = [];
  for (const migration of migrations) {
    if ([...migration.sql].some(c => (c < " " && !"\n\r\t".includes(c)) || c > "~")) problems.push(`${migration.version}: not plain ASCII`);
    for (const chunk of migration.sql.split("--> statement-breakpoint")) {
      const statement = chunk.replace(/\s+/g, " ").trim();
      if (!ALLOWED.some(pattern => pattern.test(statement))) problems.push(`${migration.version}: not additive: ${statement.slice(0, 80)}`);
      // Foreign keys carry the only DELETE/UPDATE words drizzle-kit emits: their referential actions.
      const withoutActions = statement.replace(/ ON (DELETE|UPDATE) (cascade|set null|restrict|no action)/g, "");
      if (FORBIDDEN.test(withoutActions)) problems.push(`${migration.version}: forbidden: ${statement.slice(0, 80)}`);
      if (!/;$/.test(statement)) problems.push(`${migration.version}: no closing semicolon: ${statement.slice(0, 80)}`);
      if (!STATEMENTS.some(pattern => pattern.test(statement))) {
        problems.push(`${migration.version}: outside the Mytko migration grammar (types, DEFAULT, CHECK): ${statement.slice(0, 80)}`);
      }
    }
  }
  return problems;
}

module.exports = { additiveProblems, ALLOWED, FORBIDDEN, STATEMENTS };
