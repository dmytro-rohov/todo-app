// Mytko Tasks' tools for Mytko Assistant (Mytko Kit's assistant connector): "kup olej jutro" said to the assistant
// becomes a task here. The assistant acts as the owner (user id NULL, access.js): a task in the owner's private space,
// or in a space / project the owner names (one of those in the context); an assignee stays the owner's choice in the app.
//
//   tasks.add_task     { title, date?, dueDate?, priority?, description?, space?, project? } → a task in "Do zrobienia"
//   tasks.today        {} → the owner's open tasks for today (date or due date today or earlier)
// "Cofnij" deletes the task the assistant made while it is still as made (not done, not moved, not archived).
const kit = require("./kit");
const { OWNER, visibleTask, visibleSpace, visibleProject } = require("./access");
const { defaultSpaces } = require("./spaces");
const { validateTask } = require("./validation");
const { validateTaskPatch } = require("./task-domain");

const DAY = "^\\d{4}-\\d{2}-\\d{2}$";
const LIMIT = 15;
// what the owner may say for the private space
const PRIVATE_WORDS = /^(prywatn|private|приват|особист)/i;

// A name the owner said among the rows' names: exact (any letter case), else the only one that starts with it, else
// (three letters or more) the only one that contains it; otherwise the assistant hears the names there are.
function byName(rows, said, what) {
  const wanted = said.trim().toLocaleLowerCase("pl");
  const lower = row => row.name.toLocaleLowerCase("pl");
  const match = rows.find(row => lower(row) === wanted)
    || [rows.filter(row => lower(row).startsWith(wanted)), [...wanted].length >= 3 ? rows.filter(row => lower(row).includes(wanted)) : []]
      .find(list => list.length === 1)?.[0];
  if (!match) throw new kit.AssistantError(`Unknown ${what} "${said}". Known: ${rows.map(row => row.name).join(", ")}`);
  return match;
}

function warsawDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// Where the owner's task goes: { spaceId, projectId, space, project, label } — the owner's private space unless a space
// or a project is named (a project brings its own space; a space named with it must be that one).
async function destination(db, input) {
  const named = value => typeof value === "string" && value.trim() && !PRIVATE_WORDS.test(value.trim());
  if (named(input.project)) {
    const projects = (await db.query(
      `SELECT p.id, p.name, p.space_id AS "spaceId", s.name AS "spaceName" FROM projects p JOIN spaces s ON s.id = p.space_id
        WHERE p.archived_at IS NULL AND ${visibleProject("p", "$1::integer")} ORDER BY p.position, p.id`, [null])).rows;
    const project = byName(projects, input.project, "project");
    if (named(input.space) && !project.spaceName.toLocaleLowerCase("pl").startsWith(input.space.trim().toLocaleLowerCase("pl"))) {
      throw new kit.AssistantError(`Project "${project.name}" belongs to the space "${project.spaceName}"`);
    }
    return { spaceId: project.spaceId, projectId: project.id, space: project.spaceName, project: project.name, label: `${project.spaceName} › ${project.name}` };
  }
  if (named(input.space)) {
    const spaces = (await db.query(`SELECT s.id, s.name FROM spaces s WHERE ${visibleSpace("s", "$1::integer")} ORDER BY s.position, s.id`, [null])).rows;
    const space = byName(spaces, input.space, "space");
    return { spaceId: space.id, projectId: null, space: space.name, project: null, label: space.name };
  }
  const { private: privateSpace } = await defaultSpaces(db);
  return { spaceId: privateSpace ?? null, projectId: null, space: null, project: null, label: "" };
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
        description: { type: "string", maxLength: 2000, description: "More detail, only when given" },
        space: { type: "string", maxLength: 50, description: "A space's name from the context, only when the owner names one; left out: private" },
        project: { type: "string", maxLength: 80, description: "A project's name from the context, only when the owner names one (its space comes with it)" }
      }
    },
    run: async input => {
      const { error, value } = validateTask({ title: input.title, date: input.date || warsawDay(now()) });
      if (error) throw new kit.AssistantError(error);
      // the deadline, priority and description pass the same checks as the app's own form (routes/tasks.js): a real
      // day, not a 500 from Postgres for 2026-02-30
      const extras = Object.fromEntries(["dueDate", "priority", "description"].filter(key => input[key] !== undefined).map(key => [key, input[key]]));
      const checked = Object.keys(extras).length ? validateTaskPatch(extras) : { value: {} };
      if (checked.error) throw new kit.AssistantError(checked.error);
      const extra = { dueDate: checked.value.dueDate ?? null, priority: checked.value.priority ?? "P2", description: checked.value.description ?? "" };
      const { row, place } = await kit.withTransaction(pool, async db => {
        const place = await destination(db, input);
        // the space (and so its members) held before the task, as the app's own writes do (routes/tasks.js)
        if (place.spaceId !== null) await db.query("SELECT 1 FROM spaces WHERE id = $1 FOR SHARE", [place.spaceId]);
        const row = (await db.query(
          `WITH next AS (SELECT nextval(pg_get_serial_sequence('tasks', 'id')) AS id)
           INSERT INTO tasks (id, title, completed, date, description, status, priority, due_date, position, user_id, space_id, project_id)
           SELECT next.id, $1::varchar, false, $2::date, $3::text, 'todo', $4::text, $5::date, next.id, NULL, $6::integer, $7::integer FROM next
           RETURNING id, to_char(date, 'YYYY-MM-DD') AS date`,
          [value.title, value.date, extra.description, extra.priority, extra.dueDate, place.spaceId, place.projectId])).rows[0];
        return { row, place };
      });
      const where = place.label ? ` · ${place.label}` : "";
      const summary = `Zadanie: ${value.title} · ${row.date}${where}${extra.dueDate ? ` · termin ${extra.dueDate}` : ""}${extra.priority !== "P2" ? ` · ${extra.priority}` : ""}`;
      return { summary, undo: { taskId: row.id, title: value.title, spaceId: place.spaceId, projectId: place.projectId },
        data: { id: row.id, date: row.date, space: place.space, project: place.project } };
    },
    undo: async ({ taskId, title, spaceId = null, projectId = null }) => {
      const deleted = await pool.query(
        `DELETE FROM tasks WHERE id = $1 AND user_id IS NULL AND space_id IS NOT DISTINCT FROM $3::integer AND project_id IS NOT DISTINCT FROM $4::integer
           AND NOT completed AND archived_at IS NULL AND title = $2 RETURNING id`, [taskId, title, spaceId, projectId]);
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

  // the names Home's AI may use for a space or a project (the owner's view)
  const context = async () => {
    const [spaces, projects] = await Promise.all([
      pool.query(`SELECT s.name FROM spaces s WHERE ${visibleSpace("s", "$1::integer")} ORDER BY s.position, s.id`, [null]),
      pool.query(`SELECT p.name, s.name AS space FROM projects p JOIN spaces s ON s.id = p.space_id
        WHERE p.archived_at IS NULL AND ${visibleProject("p", "$1::integer")} ORDER BY p.position, p.id`, [null])
    ]);
    return { spaces: spaces.rows.map(row => row.name), projects: projects.rows.map(row => ({ name: row.name, space: row.space })) };
  };

  return kit.createAssistantConnector({ config: config.assistant, owner: async () => OWNER, tools: [addTask, today], context });
}

module.exports = { createTasksAssistant, warsawDay };
