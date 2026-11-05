// Single source of truth for the Mytko Tasks schema. Migrations are generated from this file by drizzle-kit
// and applied by Mytko's approved migration path (production) or `npm run migrate` (dev/test).
// Domain rules (completed <-> status, position, updated_at) live in the application, not in triggers.
const { sql } = require("drizzle-orm");
const { pgTable, serial, varchar, text, boolean, integer, bigint, date, timestamp, index, check } = require("drizzle-orm/pg-core");

const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 50 }).notNull(),
  color: varchar("color", { length: 7 }).notNull(),
});

const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  completed: boolean("completed").default(false).notNull(),
  date: date("date").notNull(),
  categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
  description: text("description").default("").notNull(),
  status: text("status").default("todo").notNull(),
  priority: text("priority").default("P2").notNull(),
  dueDate: date("due_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  position: bigint("position", { mode: "number" }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [
  check("tasks_status_check", sql`${table.status} IN ('todo', 'in_progress', 'done')`),
  check("tasks_priority_check", sql`${table.priority} IN ('P0', 'P1', 'P2', 'P3')`),
  check("tasks_position_check", sql`${table.position} >= 0`),
  index("tasks_board_order").using("btree", table.status, table.position, table.id).where(sql`${table.archivedAt} IS NULL`),
]);

module.exports = { categories, tasks };
