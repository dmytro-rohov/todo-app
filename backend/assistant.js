// Mytko Tasks' tools for Mytko Assistant (Mytko Kit's assistant connector): "kup olej jutro" said to the assistant
// becomes a task here. The assistant acts as the owner (user id NULL, access.js) and makes private tasks only — a shared
// space, a project or an assignee is the owner's choice in the app.
//
//   tasks.add_task     { title, date?, dueDate?, priority?, description? } → a private task in "Do zrobienia"
//   tasks.today        {} → the owner's open tasks for today (date or due date today or earlier)
// "Cofnij" deletes the task the assistant made while it is still as made (not done, not moved, not archived).
const kit = require("./kit");
const { OWNER, visibleTask } = require("./access");
const { validateTask } = require("./validation");

const DAY = "^\\d{4}-\\d{2}-\\d{2}$";
const LIMIT = 15;

function warsawDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function createTasksAssistant({ pool, config, now = () => new Date() }) {
  const addTask = {
    name: "tasks.add_task",
    description: "Adds a private task of the owner to do, e.g. \"kup olej jutro\" or \"zadzwoń do Ani w piątek, pilne\".",
    schema: {
      type: "object", additionalProperties: false, required: ["title"],
      properties: {
        title: { type: "string", minLength: 3, maxLength: 100, description: "What to do, short (3–100 characters), in the owner's words" },
        date: { type: "string", pattern: DAY, description: "YYYY-MM-DD: the day to do it; today when left out" },
        dueDate: { type: "string", pattern: DAY, description: "YYYY-MM-DD: a deadline, only when the owner names one" },
        priority: { type: "string", enum: ["P0", "P1", "P2", "P3"], description: "P0 urgent … P3 someday; P2 when not said" },
        description: { type: "string", maxLength: 2000, description: "More detail, only when given" }
      }
    },
    run: async input => {
      const { error, value } = validateTask({ title: input.title, date: input.date || warsawDay(now()) });
      if (error) throw new kit.AssistantError(error);
      const row = (await pool.query(
        `WITH next AS (SELECT nextval(pg_get_serial_sequence('tasks', 'id')) AS id)
         INSERT INTO tasks (id, title, completed, date, description, status, priority, due_date, position, user_id)
         SELECT next.id, $1::varchar, false, $2::date, $3::text, 'todo', $4::text, $5::date, next.id, NULL FROM next
         RETURNING id, to_char(date, 'YYYY-MM-DD') AS date`,
        [value.title, value.date, input.description || "", input.priority || "P2", input.dueDate || null])).rows[0];
      const summary = `Zadanie: ${value.title} · ${row.date}${input.dueDate ? ` · termin ${input.dueDate}` : ""}${input.priority && input.priority !== "P2" ? ` · ${input.priority}` : ""}`;
      return { summary, undo: { taskId: row.id, title: value.title }, data: { id: row.id, date: row.date } };
    },
    undo: async ({ taskId, title }) => {
      const deleted = await pool.query(
        `DELETE FROM tasks WHERE id = $1 AND user_id IS NULL AND space_id IS NULL AND project_id IS NULL AND NOT completed AND archived_at IS NULL
           AND title = $2 RETURNING id`, [taskId, title]);
      if (!deleted.rowCount) throw new kit.AssistantError("This task has changed or is gone: change it in Mytko Tasks", 409);
      return `Cofnięto zadanie: ${title}`;
    }
  };

  const today = {
    name: "tasks.today",
    description: "The owner's open tasks for today (planned for today or earlier, or due by today).",
    schema: { type: "object", additionalProperties: false, properties: {} },
    run: async () => {
      const day = warsawDay(now());
      const rows = (await pool.query(
        `SELECT t.title, t.priority FROM tasks t
          WHERE ${visibleTask("t", "$1::integer")} AND NOT t.completed AND t.archived_at IS NULL
            AND (t.date <= $2::date OR t.due_date <= $2::date)
          ORDER BY t.priority, t.due_date NULLS LAST, t.id LIMIT ${LIMIT + 1}`, [null, day])).rows;
      const shown = rows.slice(0, LIMIT).map(row => `${row.priority === "P0" || row.priority === "P1" ? "❗ " : ""}${row.title}`);
      const summary = rows.length ? `Na dziś (${rows.length > LIMIT ? `${LIMIT}+` : rows.length}): ${shown.join("; ")}` : "Na dziś nic otwartego.";
      return { summary, data: { day, tasks: rows.slice(0, LIMIT) } };
    }
  };

  return kit.createAssistantConnector({ config: config.assistant, owner: async () => OWNER, tools: [addTask, today] });
}

module.exports = { createTasksAssistant, warsawDay };
