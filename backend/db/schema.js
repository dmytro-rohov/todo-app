// Single source of truth for the Mytko Tasks schema. Migrations are generated from this file by drizzle-kit
// and applied by Mytko's approved migration path (production) or `npm run migrate` (dev/test).
// Domain rules (completed <-> status, position, updated_at, task history) live in the application, not in triggers.
//
// Every migration must stay inside Mytko's additive Drizzle grammar (see test/migration-grammar.test.js):
// CREATE TABLE / CREATE INDEX / ADD COLUMN / drizzle-kit FOREIGN KEY only. No DROP, no data (INSERT/UPDATE),
// no CHECK added to an existing table. Built-in rows (the Praca / Prywatne spaces) are created by the application.
const { sql } = require("drizzle-orm");
const {
  pgTable, serial, bigserial, varchar, text, boolean, integer, bigint, date, timestamp, index, uniqueIndex, check
} = require("drizzle-orm/pg-core");

const timestamptz = name => timestamp(name, { withTimezone: true });

// Labels. The table keeps its original name; the API and UI call them labels/categories.
const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 50 }).notNull(),
  color: varchar("color", { length: 7 }).notNull(),
});

// Top-level split of all tasks: the built-in "work" and "private" spaces (key set) plus the owner's own (key null).
// agent_visible decides whether integrations and agents may ever see the space; it defaults to closed.
const spaces = pgTable("spaces", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 20 }),
  name: varchar("name", { length: 50 }).notNull(),
  color: varchar("color", { length: 7 }).notNull(),
  agentVisible: boolean("agent_visible").default(false).notNull(),
  position: integer("position").default(0).notNull(),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
}, (table) => [
  check("spaces_position_check", sql`${table.position} >= 0`),
  uniqueIndex("spaces_key").on(table.key).where(sql`${table.key} IS NOT NULL`),
]);

// A project is a folder inside one space, e.g. one client. Its tasks carry its colour as a label.
const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  spaceId: integer("space_id").notNull().references(() => spaces.id, { onDelete: "restrict" }),
  name: varchar("name", { length: 80 }).notNull(),
  color: varchar("color", { length: 7 }).notNull(),
  position: integer("position").default(0).notNull(),
  archivedAt: timestamptz("archived_at"),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
}, (table) => [
  check("projects_position_check", sql`${table.position} >= 0`),
  index("projects_space").on(table.spaceId),
]);

const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  completed: boolean("completed").default(false).notNull(),
  date: date("date").notNull(),
  // The primary label. Additional labels live in task_labels.
  categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
  description: text("description").default("").notNull(),
  status: text("status").default("todo").notNull(),
  priority: text("priority").default("P2").notNull(),
  dueDate: date("due_date"),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
  updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  completedAt: timestamptz("completed_at"),
  position: bigint("position", { mode: "number" }).notNull(),
  archivedAt: timestamptz("archived_at"),
  // NULL means the built-in private space: a task is never exposed by accident.
  spaceId: integer("space_id").references(() => spaces.id, { onDelete: "set null" }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
}, (table) => [
  check("tasks_status_check", sql`${table.status} IN ('todo', 'in_progress', 'done')`),
  check("tasks_priority_check", sql`${table.priority} IN ('P0', 'P1', 'P2', 'P3')`),
  check("tasks_position_check", sql`${table.position} >= 0`),
  index("tasks_board_order").using("btree", table.status, table.position, table.id).where(sql`${table.archivedAt} IS NULL`),
  index("tasks_space").on(table.spaceId),
  index("tasks_project").on(table.projectId),
]);

const taskLabels = pgTable("task_labels", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  categoryId: integer("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
}, (table) => [
  uniqueIndex("task_labels_task_category").on(table.taskId, table.categoryId),
  index("task_labels_category").on(table.categoryId),
]);

// Dated notes: a log under the task, separate from its single editable description.
const taskNotes = pgTable("task_notes", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
  updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => [
  index("task_notes_task").on(table.taskId),
]);

const taskSubtasks = pgTable("task_subtasks", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  done: boolean("done").default(false).notNull(),
  position: integer("position").default(0).notNull(),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
  completedAt: timestamptz("completed_at"),
}, (table) => [
  check("task_subtasks_position_check", sql`${table.position} >= 0`),
  index("task_subtasks_task").on(table.taskId),
]);

// Change log written by the application in the same transaction as the change it records.
const taskHistory = pgTable("task_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  field: varchar("field", { length: 32 }).notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  actor: varchar("actor", { length: 40 }).default("owner").notNull(),
  changedAt: timestamptz("changed_at").defaultNow().notNull(),
}, (table) => [
  index("task_history_task").on(table.taskId),
]);

module.exports = { categories, spaces, projects, tasks, taskLabels, taskNotes, taskSubtasks, taskHistory };
