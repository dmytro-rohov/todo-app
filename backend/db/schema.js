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

// Accounts besides the owner (e.g. a partner), created by the owner in the app. The owner is not a row: the owner is
// AUTH_USERNAME / the Mytko login, and every row with user_id NULL is the owner's. A member sees their own rows and
// the spaces marked shared; clients, calendars, booking and accounts stay the owner's. Logins are stored lowercase.
const users = pgTable("users", {
  id: serial("id").primaryKey(),
  login: varchar("login", { length: 40 }).notNull(),
  name: varchar("name", { length: 80 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  role: varchar("role", { length: 20 }).default("member").notNull(),
  disabledAt: timestamptz("disabled_at"),
  lastLoginAt: timestamptz("last_login_at"),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
}, (table) => [
  check("users_role_check", sql`${table.role} IN ('member')`),
  uniqueIndex("users_login").on(table.login),
]);

const ownerColumn = () => integer("user_id").references(() => users.id, { onDelete: "cascade" });

// Labels. The table keeps its original name; the API and UI call them labels/categories.
const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 50 }).notNull(),
  color: varchar("color", { length: 7 }).notNull(),
  userId: ownerColumn(),
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
  // A member's own spaces carry user_id; a member's built-in private space has key "private:<user id>".
  userId: ownerColumn(),
  // Shared spaces (e.g. "Dom") are seen and edited by every account.
  shared: boolean("shared").default(false).notNull(),
}, (table) => [
  check("spaces_position_check", sql`${table.position} >= 0`),
  uniqueIndex("spaces_key").on(table.key).where(sql`${table.key} IS NOT NULL`),
]);

// CRM-lite: a lead (e.g. booked a first meeting) or a client. Projects, tasks and meetings point to it; meetings
// are matched to it by a guest's e-mail or domain.
const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  status: varchar("status", { length: 10 }).default("lead").notNull(),
  company: varchar("company", { length: 160 }).default("").notNull(),
  email: varchar("email", { length: 200 }),
  phone: varchar("phone", { length: 40 }).default("").notNull(),
  website: varchar("website", { length: 300 }).default("").notNull(),
  domain: varchar("domain", { length: 120 }),
  color: varchar("color", { length: 7 }).notNull(),
  notes: text("notes").default("").notNull(),
  source: varchar("source", { length: 20 }).default("manual").notNull(),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
  updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => [
  check("clients_status_check", sql`${table.status} IN ('lead', 'client', 'archived')`),
  check("clients_source_check", sql`${table.source} IN ('manual', 'booking', 'mail', 'meeting')`),
  index("clients_email").on(table.email),
  index("clients_domain").on(table.domain),
]);

// A project is a folder inside one space, e.g. one client. Its tasks carry its colour as a label.
const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  spaceId: integer("space_id").notNull().references(() => spaces.id, { onDelete: "restrict" }),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  name: varchar("name", { length: 80 }).notNull(),
  color: varchar("color", { length: 7 }).notNull(),
  position: integer("position").default(0).notNull(),
  archivedAt: timestamptz("archived_at"),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
  userId: ownerColumn(),
}, (table) => [
  check("projects_position_check", sql`${table.position} >= 0`),
  index("projects_space").on(table.spaceId),
]);

// People a task can be assigned to (records, not login accounts; a future agent can be one too).
const assignees = pgTable("assignees", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  color: varchar("color", { length: 7 }).notNull(),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
  userId: ownerColumn(),
});

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
  assigneeId: integer("assignee_id").references(() => assignees.id, { onDelete: "set null" }),
  // "Needs review" is status in_progress with this timestamp set: the status CHECK of 0000 cannot be widened inside
  // Mytko's additive grammar, so the application maps the four board statuses onto it (see task-status.js).
  reviewRequestedAt: timestamptz("review_requested_at"),
  // "Long-term plans" (the fifth board column) is status todo with this timestamp set, for the same reason.
  plannedAt: timestamptz("planned_at"),
  // The client directly (a task can belong to a client without a project); otherwise the project's client.
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  // The meeting the task was created for (preparation, follow-up, from a brief).
  meetingId: integer("meeting_id").references(() => calendarEvents.id, { onDelete: "set null" }),
  // Who created the task (NULL = the owner). Seen by its creator, and by everyone while it is in a shared space.
  userId: ownerColumn(),
  // The e-mail the task was created from (Poczta).
  mailId: integer("mail_id").references(() => mailMessages.id, { onDelete: "set null" }),
  // Mytko Workflow ToDo (C6): requested = sent by the owner (or a coding proposal); Workflow picks it up from
  // /api/agent/workflow while Fujitsu runs, stores its own id/link and reports its status, mirrored on the board.
  workflowRequestedAt: timestamptz("workflow_requested_at"),
  workflowRef: varchar("workflow_ref", { length: 100 }),
  workflowStatus: varchar("workflow_status", { length: 30 }),
  workflowUrl: varchar("workflow_url", { length: 500 }),
  workflowUpdatedAt: timestamptz("workflow_updated_at"),
}, (table) => [
  check("tasks_status_check", sql`${table.status} IN ('todo', 'in_progress', 'done')`),
  check("tasks_priority_check", sql`${table.priority} IN ('P0', 'P1', 'P2', 'P3')`),
  check("tasks_position_check", sql`${table.position} >= 0`),
  index("tasks_board_order").using("btree", table.status, table.position, table.id).where(sql`${table.archivedAt} IS NULL`),
  index("tasks_space").on(table.spaceId),
  index("tasks_project").on(table.projectId),
  index("tasks_assignee").on(table.assigneeId),
  index("tasks_client").on(table.clientId),
  index("tasks_meeting").on(table.meetingId),
  index("tasks_user").on(table.userId),
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

// Time tracking: one row per work interval; at most one running interval (ended_at NULL) per task.
const taskTimeEntries = pgTable("task_time_entries", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  startedAt: timestamptz("started_at").defaultNow().notNull(),
  endedAt: timestamptz("ended_at"),
}, (table) => [
  index("task_time_entries_task").on(table.taskId),
  uniqueIndex("task_time_entries_running").on(table.taskId).where(sql`${table.endedAt} IS NULL`),
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

// A Google Calendar connected to a space (one per space). The refresh token is AES-256-GCM encrypted with
// TASKS_SECRET_KEY; a database read alone never yields access to the calendar.
const calendarAccounts = pgTable("calendar_accounts", {
  id: serial("id").primaryKey(),
  spaceId: integer("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 20 }).default("google").notNull(),
  accountEmail: varchar("account_email", { length: 200 }).notNull(),
  calendarId: varchar("calendar_id", { length: 300 }).default("primary").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  lastSyncAt: timestamptz("last_sync_at"),
  lastError: varchar("last_error", { length: 300 }),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
}, (table) => [
  check("calendar_accounts_provider_check", sql`${table.provider} IN ('google')`),
  uniqueIndex("calendar_accounts_space").on(table.spaceId),
]);

// Local copy of the connected calendars' events (a window around today), refreshed by the sync job.
const calendarEvents = pgTable("calendar_events", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull().references(() => calendarAccounts.id, { onDelete: "cascade" }),
  externalId: varchar("external_id", { length: 300 }).notNull(),
  title: varchar("title", { length: 500 }).default("").notNull(),
  description: text("description").default("").notNull(),
  location: varchar("location", { length: 500 }).default("").notNull(),
  startAt: timestamptz("start_at").notNull(),
  endAt: timestamptz("end_at").notNull(),
  allDay: boolean("all_day").default(false).notNull(),
  meetUrl: varchar("meet_url", { length: 300 }),
  htmlLink: varchar("html_link", { length: 600 }),
  // JSON array of {email, name, response}; empty text = none (the migration grammar admits no "[]" default)
  attendees: text("attendees").default("").notNull(),
  status: varchar("status", { length: 20 }).default("confirmed").notNull(),
  updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
}, (table) => [
  uniqueIndex("calendar_events_account_external").on(table.accountId, table.externalId),
  index("calendar_events_start").on(table.startAt),
]);

// The owner's mailbox (hello@, IMAP on OVH Zimbra), copied by the mail sync (mail-sync.js): the newest messages of
// INBOX with their text, matched to clients by the sender's address or domain. "handled" hides a message in Tasks
// only; the mailbox itself is changed only by marking messages read. invite: the text/calendar part, if any.
// suggestion: Claude's proposed tasks (JSON), kept until the next request.
const mailMessages = pgTable("mail_messages", {
  id: serial("id").primaryKey(),
  mailbox: varchar("mailbox", { length: 200 }).default("INBOX").notNull(),
  uidValidity: bigint("uid_validity", { mode: "number" }).notNull(),
  uid: bigint("uid", { mode: "number" }).notNull(),
  messageId: varchar("message_id", { length: 300 }),
  fromAddress: varchar("from_address", { length: 254 }).default("").notNull(),
  fromName: varchar("from_name", { length: 200 }).default("").notNull(),
  toAddresses: text("to_addresses").default("").notNull(),
  subject: varchar("subject", { length: 500 }).default("").notNull(),
  sentAt: timestamptz("sent_at").notNull(),
  snippet: varchar("snippet", { length: 400 }).default("").notNull(),
  bodyText: text("body_text").default("").notNull(),
  attachments: text("attachments").default("").notNull(),
  invite: text("invite").default("").notNull(),
  seen: boolean("seen").default(false).notNull(),
  handledAt: timestamptz("handled_at"),
  suggestion: text("suggestion").default("").notNull(),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("mail_messages_mailbox_uid").on(table.mailbox, table.uidValidity, table.uid),
  index("mail_messages_sent").on(table.sentAt),
  index("mail_messages_client").on(table.clientId),
]);

// What was said at a meeting: the notes (Gemini's e-mail "Notes: …" picked up from Poczta, or pasted) and Claude's
// brief from them (JSON: summary, decisions, open questions, a site brief in Website Factory's brief.json terms,
// proposed tasks, the next meeting). A meeting may have several (the newest counts); a brief without a meeting
// waits in Poczta to be assigned.
const meetingBriefs = pgTable("meeting_briefs", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => calendarEvents.id, { onDelete: "set null" }),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  mailId: integer("mail_id").references(() => mailMessages.id, { onDelete: "set null" }),
  source: varchar("source", { length: 20 }).default("paste").notNull(),
  notes: text("notes").notNull(),
  result: text("result").default("").notNull(),
  error: varchar("error", { length: 300 }),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
  updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => [
  check("meeting_briefs_source_check", sql`${table.source} IN ('paste', 'gemini-mail')`),
  index("meeting_briefs_event").on(table.eventId),
  index("meeting_briefs_mail").on(table.mailId),
]);

// Browser sessions of the single owner (password login or "Zaloguj kontem Mytko"). Only the SHA-256 of the random
// cookie token is stored, so a database read never yields a usable session.
const authSessions = pgTable("auth_sessions", {
  id: serial("id").primaryKey(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  login: varchar("login", { length: 80 }).notNull(),
  method: varchar("method", { length: 10 }).notNull(),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
  expiresAt: timestamptz("expires_at").notNull(),
  // A member's session (method "password"); NULL for the owner's.
  userId: ownerColumn(),
}, (table) => [
  check("auth_sessions_method_check", sql`${table.method} IN ('password', 'mytko')`),
  uniqueIndex("auth_sessions_token").on(table.tokenHash),
  index("auth_sessions_expires").on(table.expiresAt),
]);

// "Cele / Marzenia": each account's own list of goals and dreams for a month or for a whole year. Done items stay
// (done_at set) so a period can be looked back on: what was planned, what worked out, what did not.
const goals = pgTable("goals", {
  id: serial("id").primaryKey(),
  year: integer("year").notNull(),
  // 1–12; NULL: the list for the whole year
  month: integer("month"),
  kind: varchar("kind", { length: 10 }).default("goal").notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  description: text("description").default("").notNull(),
  deadline: date("deadline"),
  doneAt: timestamptz("done_at"),
  position: bigint("position", { mode: "number" }).notNull(),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
  updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  userId: ownerColumn(),
}, (table) => [
  check("goals_kind_check", sql`${table.kind} IN ('goal', 'dream')`),
  check("goals_year_check", sql`${table.year} >= 2000 AND ${table.year} <= 2200`),
  // (a NULL month passes: CHECK only refuses false)
  check("goals_month_check", sql`${table.month} >= 1 AND ${table.month} <= 12`),
  check("goals_position_check", sql`${table.position} >= 0`),
  index("goals_period").on(table.userId, table.year, table.month, table.position),
]);

module.exports = {
  goals,
  meetingBriefs,
  mailMessages,
  users,
  clients,
  calendarAccounts,
  calendarEvents,
  authSessions,
  categories, spaces, projects, assignees, tasks, taskLabels, taskNotes, taskSubtasks, taskTimeEntries, taskHistory
};
