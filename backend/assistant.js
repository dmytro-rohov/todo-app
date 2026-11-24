// Mytko Tasks' tools for Mytko Assistant (Mytko Kit's assistant connector): what the owner does with tasks in the app,
// said to the assistant ("kup olej jutro", "oznacz olej jako zrobione", "przenieś fakturę na piątek"). The assistant
// acts as the owner (user id NULL, access.js) and every change goes through the app's own code (routes/tasks.js,
// ordering.js, routes/archive.js, routes/task-details.js), so the rules, the history and the timer stay the app's.
//
//   tasks.add_task      { title, date?, dueDate?, priority?, description?, space?, project? } → a task in ToDo, the day
//                       said as its deadline (the app's calendar), as the app's own form makes it
//   tasks.today         {} → the owner's open tasks for today (date or due date today or earlier)
//   tasks.list          { date? | from?, to?, status?, space?, project?, query? } → tasks with their ids
//   tasks.set_status    { task, status } → the task in another board column (the end of it, as the app's status menu)
//   tasks.update_task   { task, title?, dueDate?, priority?, description?, space?, project?, assignee? }
//   tasks.restore_task  { task } → an archived (finished) task back to ToDo
//   tasks.add_note      { task, text }    tasks.add_subtask { task, title }    tasks.set_subtask { task, subtask, done? }
//
// A task is named by its id (from tasks.list) or by its title or a part of it (findTask). "Cofnij" undoes a change only
// while the task is still as the assistant left it: add_task deletes the task, set_status moves it back to where it was,
// update_task puts the previous values back, restore_task returns it to the archive, a note or a subtask is deleted, a
// subtask's tick is put back. Deleting a task is not a tool: Cofnij could not bring back its notes, subtasks, time and
// history (a handle is a sealed token of 2000 characters at most, and there is nowhere else to keep them).
const crypto = require("node:crypto");
const kit = require("./kit");
const { OWNER, visibleTask, visibleSpace, visibleProject, visibleAssignee, canSeeTask } = require("./access");
const { defaultSpaces } = require("./spaces");
const { validateTask } = require("./validation");
const { validateTaskPatch } = require("./task-domain");
const { STATUSES, statusSql, statusAssignmentsSql } = require("./task-status");
const { taskChanges, recordTaskChanges } = require("./task-history");
const { moveTask, boardRows, boardToken } = require("./ordering");
const { loadTask, createTask, patchTask, writeErrorMessage } = require("./routes/tasks");
const { restoreTask } = require("./routes/archive");
const { ensureSelf } = require("./routes/assignees");
const details = require("./routes/task-details");

const DAY = "^\\d{4}-\\d{2}-\\d{2}$";
const LIMIT = 15;
const LIST_LIMIT = 25;
const CANDIDATES = 5;
// what the owner may say for the private space, for "no one" / "no project" / "no deadline", and for themselves
const PRIVATE_WORDS = /^(prywatn|private|приват|особист)/i;
const NONE_WORDS = /^(none|nobody|no one|nikt|nikogo|brak|bez|нікого|ніхто|немає|без)(\s|$)/i;
const ME_WORDS = /^(me|myself|ja|mnie|я|мене|мені)$/i;
// the board's column names (frontend/js/app/logic.js STATUS_LABELS), for the owner's summaries
const STATUS_LABELS = { todo: "ToDo", in_progress: "W realizacji", needs_review: "Needs review", done: "Zakończone",
  planned: "Plany długoterminowe" };
// what update_task changes and Cofnij puts back (loadTask's names)
const EDITABLE = ["title", "description", "priority", "dueDate", "spaceId", "projectId", "assigneeId"];
// Cofnij's handle travels sealed in a token of at most 2000 characters (Mytko Kit): its JSON stays well under that
const HANDLE_BYTES = 1400;

const changed = () => new kit.AssistantError("This task has changed or is gone: change it in Mytko Tasks", 409);
const fits = (tool, handle) => Buffer.byteLength(JSON.stringify({ tool, handle, exp: Date.now() })) <= HANDLE_BYTES;
const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("base64url").slice(0, 22);
const fields = (task, keys) => Object.fromEntries(keys.map(key => [key, task[key] ?? null]));
const lower = text => text.trim().toLocaleLowerCase("pl");

// A write the app refuses (routes/tasks.js) as the assistant's refusal; anything else stays an error.
function refusal(error) {
  const message = error instanceof kit.AssistantError ? null : writeErrorMessage(error);
  return message === null ? error : new kit.AssistantError(message);
}

// A name the owner said among the rows' names: exact (any letter case), else the only one that starts with it, else
// (three letters or more) the only one that contains it; otherwise the assistant hears the names there are.
function byName(rows, said, what) {
  const wanted = lower(said);
  const name = row => row.name.toLocaleLowerCase("pl");
  const match = rows.find(row => name(row) === wanted)
    || [rows.filter(row => name(row).startsWith(wanted)), [...wanted].length >= 3 ? rows.filter(row => name(row).includes(wanted)) : []]
      .find(list => list.length === 1)?.[0];
  if (!match) throw new kit.AssistantError(`Unknown ${what} "${said}". Known: ${rows.map(row => row.name).join(", ")}`);
  return match;
}

// The rows (with a title) the owner may mean by `said`: the one with that id, else, among the preferred rows first and
// then all of them, those with that title (any letter case), else those starting with it, else (three letters or more)
// those containing it. One row is the one; more are a question back.
function matching(rows, said, prefer) {
  const text = said.trim();
  if (/^\d+$/.test(text)) {
    const row = rows.find(candidate => String(candidate.id) === text);
    if (row) return [row];
  }
  const wanted = lower(text);
  if (!wanted) return [];
  const stages = [title => title === wanted, title => title.startsWith(wanted), ...([...wanted].length >= 3 ? [title => title.includes(wanted)] : [])];
  for (const tier of [rows.filter(prefer), rows]) {
    for (const stage of stages) {
      const found = tier.filter(row => stage(row.title.toLocaleLowerCase("pl")));
      if (found.length) return found;
    }
  }
  return [];
}

function pick(rows, said, { prefer = () => true, what, label }) {
  const found = matching(rows, said, prefer);
  if (found.length === 1) return found[0];
  if (found.length) {
    const more = found.length > CANDIDATES ? ` (and ${found.length - CANDIDATES} more)` : "";
    throw new kit.AssistantError(`Which ${what}? ${found.slice(0, CANDIDATES).map(label).join("; ")}${more}. Ask the owner, then give the id.`);
  }
  throw new kit.AssistantError(`No ${what} "${said}"`, 404);
}

const day = task => (task.dueDate ? `termin ${task.dueDate}` : task.date);
const taskLabel = task => `${task.id}: ${task.title} (${STATUS_LABELS[task.status]}, ${day(task)})`;

function warsawDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// The owner's tasks on the board (archived: in the archive), with their space (a task without one is in the private
// space) and project names. The description is only for tasks.list's query; it never leaves this file.
async function taskRows(db, { archived = false } = {}) {
  const { private: privateSpace } = await defaultSpaces(db);
  return (await db.query(
    `SELECT t.id, t.title, t.description, ${statusSql("t")} AS status, t.priority, to_char(t.date, 'YYYY-MM-DD') AS date,
       to_char(t.due_date, 'YYYY-MM-DD') AS "dueDate", to_char(t.completed_at AT TIME ZONE 'Europe/Warsaw', 'YYYY-MM-DD') AS "doneDay",
       COALESCE(t.space_id, $2::integer) AS "spaceId", t.project_id AS "projectId", s.name AS space, p.name AS project
     FROM tasks t LEFT JOIN spaces s ON s.id = COALESCE(t.space_id, $2::integer) LEFT JOIN projects p ON p.id = t.project_id
     WHERE ${visibleTask("t", "$1::integer")} AND t.archived_at IS ${archived ? "NOT NULL" : "NULL"}
     ORDER BY COALESCE(t.due_date, t.date), t.priority, t.position, t.id`, [null, privateSpace ?? null])).rows;
}

// The task the owner names (see matching); unfinished ones first unless `prefer` says otherwise. A finished task the
// app has moved to the archive is pointed to tasks.restore_task.
async function findTask(db, said, { prefer = row => row.status !== "done", archived = false } = {}) {
  try {
    return pick(await taskRows(db, { archived }), said, { prefer, what: "task", label: taskLabel });
  } catch (error) {
    if (archived || error.status !== 404 || !matching(await taskRows(db, { archived: true }), said, () => true).length) throw error;
    throw new kit.AssistantError(`"${said}" is in the archive (finished long ago): tasks.restore_task brings it back to ToDo`, 404);
  }
}

async function findProject(db, said) {
  const projects = (await db.query(
    `SELECT p.id, p.name, p.space_id AS "spaceId", s.name AS "spaceName" FROM projects p JOIN spaces s ON s.id = p.space_id
      WHERE p.archived_at IS NULL AND ${visibleProject("p", "$1::integer")} ORDER BY p.position, p.id`, [null])).rows;
  return byName(projects, said, "project");
}

// A space by name; the private words name the owner's private space.
async function findSpace(db, said) {
  const spaces = (await db.query(`SELECT s.id, s.name FROM spaces s WHERE ${visibleSpace("s", "$1::integer")} ORDER BY s.position, s.id`, [null])).rows;
  if (PRIVATE_WORDS.test(said.trim())) {
    const { private: id } = await defaultSpaces(db);
    return spaces.find(space => space.id === id) || { id, name: "Prywatne" };
  }
  return byName(spaces, said, "space");
}

const projectInSpace = (project, said) => project.spaceName.toLocaleLowerCase("pl").startsWith(lower(said));

// An assignee by name; "me" is the owner's own entry (made as the app makes it the first time assignees are read).
async function findAssignee(db, said) {
  if (ME_WORDS.test(said.trim())) await ensureSelf(db, OWNER);
  const rows = (await db.query(`SELECT a.id, a.name, a.account FROM assignees a WHERE ${visibleAssignee("a", "$1::integer")} ORDER BY a.name, a.id`, [null])).rows;
  if (ME_WORDS.test(said.trim())) {
    const me = rows.find(row => row.account === "owner");
    if (me) return me;
  }
  return byName(rows, said, "assignee");
}

// Where the owner's task goes: { spaceId, projectId, space, project, label }: the owner's private space unless a space
// or a project is named (a project brings its own space; a space named with it must be that one).
async function destination(db, input) {
  const named = value => typeof value === "string" && value.trim() && !PRIVATE_WORDS.test(value.trim());
  if (named(input.project)) {
    const project = await findProject(db, input.project);
    if (named(input.space) && !projectInSpace(project, input.space)) {
      throw new kit.AssistantError(`Project "${project.name}" belongs to the space "${project.spaceName}"`);
    }
    return { spaceId: project.spaceId, projectId: project.id, space: project.spaceName, project: project.name, label: `${project.spaceName} › ${project.name}` };
  }
  if (named(input.space)) {
    const space = await findSpace(db, input.space);
    return { spaceId: space.id, projectId: null, space: space.name, project: null, label: space.name };
  }
  const { private: privateSpace } = await defaultSpaces(db);
  return { spaceId: privateSpace ?? null, projectId: null, space: null, project: null, label: "" };
}

// The next task below this one in its column (where Cofnij puts it back), as the board's own Cofnij does.
function nextInColumn(rows, task) {
  const column = rows.filter(row => row.status === task.status);
  return column[column.findIndex(row => row.id === task.id) + 1]?.id ?? null;
}

// Moves a task on the board through the app's own move (ordering.js: positions, history, the timer), to the end of the
// column or before `beforeId` while that one is still there. The board is read just before; when it changes in between
// (409) it is read again. `expectStatus`: only while the task is still there. → { from, back } | { same } | { gone }
async function moveOnBoard(pool, taskId, status, { expectStatus = null, beforeId = null } = {}) {
  for (let attempt = 1; ; attempt++) {
    const rows = await boardRows(pool, OWNER);
    const task = rows.find(row => row.id === taskId);
    if (!task || (expectStatus && task.status !== expectStatus)) return { gone: true };
    if (task.status === status) return { same: true };
    const before = beforeId !== null && rows.some(row => row.id === beforeId && row.status === status) ? beforeId : null;
    const back = nextInColumn(rows, task);
    const result = await moveTask(pool, { id: taskId, status, beforeId: before, expected: boardToken(rows) }, OWNER);
    if (result.status === 200) return { from: task.status, back };
    if (result.status !== 409 || attempt >= 3) throw new kit.AssistantError(result.message, result.status === 409 ? 409 : 400);
  }
}

function createTasksAssistant({ pool, config, now = () => new Date() }) {
  const addTask = {
    name: "tasks.add_task",
    description: "Adds a private task of the owner to do, e.g. \"kup olej jutro\" or \"zadzwoń do Ani w piątek, pilne\". "
      + "A day the owner names becomes the task's deadline (Termin), as in the app's own form, so it shows in the app's calendar on that day.",
    schema: {
      type: "object", additionalProperties: false, required: ["title"],
      properties: {
        title: { type: "string", minLength: 3, maxLength: 100, description: "What to do, short (3–100 characters), in the owner's words" },
        date: { type: "string", pattern: DAY, description: "YYYY-MM-DD: the day the owner names (\"jutro\", \"na środę\", \"20 listopada\"); left out when no day is said" },
        dueDate: { type: "string", pattern: DAY, description: "YYYY-MM-DD: a deadline the owner names as one (\"do piątku\"); wins over date when both are said" },
        priority: { type: "string", enum: ["P0", "P1", "P2", "P3"], description: "P0 urgent … P3 someday; P2 when not said" },
        description: { type: "string", maxLength: 2000, description: "More detail, only when given" },
        space: { type: "string", maxLength: 50, description: "A space's name from the context, only when the owner names one; left out: private" },
        project: { type: "string", maxLength: 80, description: "A project's name from the context, only when the owner names one (its space comes with it)" }
      }
    },
    // the app's own create (routes/tasks.js createTask) as its form sends it: written today, the day said as the deadline
    // (the calendar shows tasks on their deadline), the "created" history entry
    run: async input => {
      const { error, value } = validateTask({ title: input.title, date: warsawDay(now()) });
      if (error) throw new kit.AssistantError(error);
      // the day, priority and description pass the same checks as the app's own form: a real day, not a 500 from
      // Postgres for 2026-02-30
      const extras = { dueDate: input.dueDate ?? input.date, priority: input.priority, description: input.description };
      for (const key of Object.keys(extras)) if (extras[key] === undefined) delete extras[key];
      const checked = Object.keys(extras).length ? validateTaskPatch(extras) : { value: {} };
      if (checked.error) throw new kit.AssistantError(checked.error);
      const place = await destination(pool, input);
      const domain = { ...checked.value, spaceId: place.spaceId, ...(place.projectId !== null ? { projectId: place.projectId } : {}) };
      let task;
      try {
        task = await createTask(pool, OWNER, value, domain);
      } catch (failure) {
        throw refusal(failure);
      }
      const where = place.label ? ` · ${place.label}` : "";
      const summary = `Zadanie: ${task.title}${task.dueDate ? ` · ${task.dueDate}` : ""}${where}${task.priority !== "P2" ? ` · ${task.priority}` : ""}`;
      return { summary, undo: { taskId: task.id, title: task.title, spaceId: task.spaceId, projectId: task.projectId },
        data: { id: task.id, date: task.date, dueDate: task.dueDate, space: place.space, project: place.project } };
    },
    undo: async ({ taskId, title, spaceId = null, projectId = null }) => {
      const deleted = await pool.query(
        `DELETE FROM tasks WHERE id = $1 AND user_id IS NULL AND space_id IS NOT DISTINCT FROM $3::integer AND project_id IS NOT DISTINCT FROM $4::integer
           AND NOT completed AND archived_at IS NULL AND title = $2 RETURNING id`, [taskId, title, spaceId, projectId]);
      if (!deleted.rowCount) throw changed();
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

  const taskField = { type: "string", minLength: 1, maxLength: 100,
    description: "The task: its id from tasks.list, or its title or a part of it as the owner says it" };

  const list = {
    name: "tasks.list",
    description: "Lists the owner's tasks on the board, with their ids: e.g. \"co mam na jutro\", \"co jest w toku\", "
      + "\"zadania w projekcie Remont\", \"co zrobiłem wczoraj\". Read only. A day or a range matches a task's deadline "
      + `(or, without one, its day) and, for finished tasks, the day they were finished. At most ${LIST_LIMIT} tasks.`,
    schema: {
      type: "object", additionalProperties: false,
      properties: {
        date: { type: "string", pattern: DAY, description: "YYYY-MM-DD: one day (\"today\", \"tomorrow\" as dates); not with from/to" },
        from: { type: "string", pattern: DAY, description: "YYYY-MM-DD: the first day of a range (\"this week\": its Monday)" },
        to: { type: "string", pattern: DAY, description: "YYYY-MM-DD: the last day of a range" },
        status: { type: "string", enum: ["open", "all", ...STATUSES],
          description: "open (default: not finished and not a long-term plan), all, or one board column: todo, in_progress, needs_review, done (finished), planned (long-term plans)" },
        space: { type: "string", maxLength: 50, description: "A space's name from the context" },
        project: { type: "string", maxLength: 80, description: "A project's name from the context" },
        query: { type: "string", minLength: 1, maxLength: 100, description: "Words to find in the title or the description" }
      }
    },
    run: async input => {
      if (input.date && (input.from || input.to)) throw new kit.AssistantError("Give either date or from/to");
      const from = input.date || input.from || null;
      const to = input.date || input.to || null;
      if (from && to && from > to) throw new kit.AssistantError("from is after to");
      const status = input.status || "open";
      const space = input.space ? await findSpace(pool, input.space) : null;
      const project = input.project ? await findProject(pool, input.project) : null;
      const inRange = when => Boolean(when) && (!from || when >= from) && (!to || when <= to);
      const words = input.query ? lower(input.query).split(/\s+/).filter(Boolean) : [];
      const rows = (await taskRows(pool)).filter(row =>
        (status === "all" || (status === "open" ? row.status !== "done" && row.status !== "planned" : row.status === status))
        && ((!from && !to) || inRange(row.dueDate ?? row.date) || (row.status === "done" && inRange(row.doneDay)))
        && (!space || row.spaceId === space.id) && (!project || row.projectId === project.id)
        && words.every(word => `${row.title} ${row.description}`.toLocaleLowerCase("pl").includes(word)));
      const shown = rows.slice(0, LIST_LIMIT);
      const place = row => (space || project ? "" : `, ${row.project ? `${row.space} › ${row.project}` : row.space}`);
      const line = row => `${row.priority === "P0" || row.priority === "P1" ? "❗ " : ""}${row.title} (${STATUS_LABELS[row.status]}, ${day(row)}${place(row)})`;
      const summary = rows.length
        ? `Zadania (${rows.length}): ${shown.map(line).join("; ")}${rows.length > shown.length ? `; i jeszcze ${rows.length - shown.length}` : ""}`
        : "Brak takich zadań.";
      return { summary, data: { total: rows.length, tasks: shown.map(row => ({ id: row.id, title: row.title, status: row.status, date: row.date,
        dueDate: row.dueDate, priority: row.priority, space: row.space, project: row.project })) } };
    }
  };

  const setStatus = {
    name: "tasks.set_status",
    description: "Moves one of the owner's tasks to another board column: done = finished (\"oznacz jako zrobione\"), "
      + "in_progress (\"przenieś do w toku\"), todo (back to to-do, also a finished task: \"przywróć z zrobionych\"), "
      + "needs_review, planned (long-term plans). The task goes to the end of that column.",
    schema: {
      type: "object", additionalProperties: false, required: ["task", "status"],
      properties: {
        task: taskField,
        status: { type: "string", enum: STATUSES, description: "The column: todo, in_progress, needs_review, done, planned" }
      }
    },
    run: async input => {
      const task = await findTask(pool, input.task, { prefer: row => row.status !== input.status });
      const moved = await moveOnBoard(pool, task.id, input.status);
      if (moved.gone) throw changed();
      const data = { id: task.id, title: task.title, status: input.status };
      if (moved.same) return { summary: `„${task.title}” jest już w kolumnie ${STATUS_LABELS[input.status]}`, data };
      return { summary: `„${task.title}” → ${STATUS_LABELS[input.status]}`, data: { ...data, previous: moved.from },
        undo: { taskId: task.id, title: task.title, from: moved.from, to: input.status, beforeId: moved.back } };
    },
    undo: async ({ taskId, title, from, to, beforeId = null }) => {
      const moved = await moveOnBoard(pool, taskId, from, { expectStatus: to, beforeId });
      if (moved.gone) throw changed();
      return `Cofnięto: „${title}” → ${STATUS_LABELS[from]}`;
    }
  };

  const updateTask = {
    name: "tasks.update_task",
    description: "Changes one of the owner's tasks, only what the owner says: a new title, deadline, priority, description "
      + "(replaces it), space, project or assignee; e.g. \"przesuń fakturę na piątek\", \"olej jest pilny\". "
      + "To finish a task or move it between columns use tasks.set_status.",
    schema: {
      type: "object", additionalProperties: false, required: ["task"],
      properties: {
        task: taskField,
        title: { type: "string", minLength: 3, maxLength: 100, description: "The new title (3–100 characters)" },
        dueDate: { type: "string", pattern: "^(\\d{4}-\\d{2}-\\d{2}|none)$", description: "YYYY-MM-DD: the new deadline; none: no deadline" },
        priority: { type: "string", enum: ["P0", "P1", "P2", "P3"], description: "P0 urgent, P1 high, P2 normal, P3 low" },
        description: { type: "string", maxLength: 2000, description: "The new description; replaces the old one" },
        space: { type: "string", maxLength: 50, description: "Move to this space (a name from the context; private: the owner's private space)" },
        project: { type: "string", maxLength: 80, description: "Move to this project (a name from the context; its space comes with it); none: out of its project" },
        assignee: { type: "string", maxLength: 80, description: "Who does it: a name from the context's assignees; me: the owner; none: no one" }
      }
    },
    run: async input => {
      const task = await findTask(pool, input.task);
      const body = {};
      const said = {};
      for (const key of ["title", "description", "priority"]) if (input[key] !== undefined) body[key] = input[key];
      if (input.dueDate !== undefined) body.dueDate = input.dueDate === "none" ? null : input.dueDate;
      if (input.project !== undefined && NONE_WORDS.test(input.project.trim())) {
        body.projectId = null;
      } else if (input.project !== undefined) {
        const project = await findProject(pool, input.project);
        if (input.space !== undefined && !projectInSpace(project, input.space)) {
          throw new kit.AssistantError(`Project "${project.name}" belongs to the space "${project.spaceName}"`);
        }
        body.projectId = project.id;
        said.place = `${project.spaceName} › ${project.name}`;
      }
      if (input.space !== undefined && body.projectId == null) {
        const space = await findSpace(pool, input.space);
        body.spaceId = space.id;
        said.place = space.name;
      }
      if (input.assignee !== undefined) {
        const assignee = NONE_WORDS.test(input.assignee.trim()) ? null : await findAssignee(pool, input.assignee);
        body.assigneeId = assignee ? assignee.id : null;
        said.assignee = assignee ? assignee.name : "nikt";
      }
      if (!Object.keys(body).length) throw new kit.AssistantError("Nothing to change: say a new title, deadline, priority, description, space, project or assignee");
      const { error, value } = validateTaskPatch(body);
      if (error) throw new kit.AssistantError(error);
      let before = null;
      let after;
      try {
        after = await patchTask(pool, OWNER, task.id, value, { check: current => { before = current; } });
      } catch (failure) {
        throw refusal(failure);
      }
      if (!after) throw changed();
      const keys = EDITABLE.filter(key => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null));
      const parts = [];
      if (keys.includes("title")) parts.push(`tytuł: ${after.title}`);
      if (keys.includes("dueDate")) parts.push(after.dueDate ? `termin ${after.dueDate}` : "bez terminu");
      if (keys.includes("priority")) parts.push(after.priority);
      if (keys.includes("description")) parts.push("nowy opis");
      if (keys.includes("spaceId") || keys.includes("projectId")) parts.push(said.place || "bez projektu");
      if (keys.includes("assigneeId")) parts.push(`wykonawca: ${said.assignee}`);
      const data = { id: after.id, title: after.title, dueDate: after.dueDate, priority: after.priority, changed: keys };
      if (!keys.length) return { summary: `„${before.title}”: bez zmian`, data };
      const handle = { taskId: after.id, title: after.title, before: fields(before, keys), after: digest(fields(after, keys)) };
      // a long old description does not fit Cofnij's token: the change stands without Cofnij
      return { summary: `Zmieniono „${before.title}”: ${parts.join(" · ")}`, data, undo: fits("tasks.update_task", handle) ? handle : null };
    },
    undo: async ({ taskId, title, before, after }) => {
      const keys = Object.keys(before);
      try {
        const task = await patchTask(pool, OWNER, taskId, before, { check: current => {
          if (current.archivedAt || digest(fields(current, keys)) !== after) throw changed();
        } });
        if (!task) throw changed();
      } catch (failure) {
        throw refusal(failure);
      }
      return `Cofnięto zmiany: ${title}`;
    }
  };

  const restore = {
    name: "tasks.restore_task",
    description: "Brings one of the owner's archived tasks (finished tasks the app moved off the board after some days) "
      + "back to the board, to ToDo: \"przywróć z archiwum\". A finished task still on the board: tasks.set_status.",
    schema: { type: "object", additionalProperties: false, required: ["task"], properties: { task: taskField } },
    run: async input => {
      const task = await findTask(pool, input.task, { archived: true, prefer: () => true });
      let before = null;
      const after = await restoreTask(pool, OWNER, task.id, { check: current => { before = current; } });
      if (!after) throw changed();
      return { summary: `Przywrócono z archiwum: „${after.title}” → ${STATUS_LABELS.todo}`, data: { id: after.id, title: after.title, status: after.status },
        undo: { taskId: after.id, title: after.title, status: before.status, completedAt: before.completedAt, archivedAt: before.archivedAt, position: before.position } };
    },
    // back to the archive as it was there, while the task is still the open ToDo task restore made it
    undo: async ({ taskId, title, status, completedAt, archivedAt, position }) => {
      const done = await kit.withTransaction(pool, async db => {
        if (!(await canSeeTask(db, OWNER, taskId))) return false;
        const current = await loadTask(db, taskId, { lock: true });
        if (!current || current.archivedAt || current.status !== "todo") return false;
        await db.query(`UPDATE tasks SET ${statusAssignmentsSql("$1").join(", ")}, updated_at = now() WHERE id = $2`, [status, taskId]);
        await db.query("UPDATE tasks SET completed_at = $1, archived_at = $2, position = $3 WHERE id = $4", [completedAt, archivedAt, position, taskId]);
        await recordTaskChanges(db, taskId, taskChanges(current, await loadTask(db, taskId)), OWNER.actor);
        return true;
      });
      if (!done) throw changed();
      return `Cofnięto: „${title}” wraca do archiwum`;
    }
  };

  const addNote = {
    name: "tasks.add_note",
    description: "Adds a dated note to one of the owner's tasks (the task's notes log): \"dopisz do faktury, że czekam na NIP\".",
    schema: {
      type: "object", additionalProperties: false, required: ["task", "text"],
      properties: { task: taskField, text: { type: "string", minLength: 1, maxLength: 2000, description: "The note, in the owner's words" } }
    },
    run: async input => {
      if (!details.isNote(input.text)) throw new kit.AssistantError("Invalid note");
      const task = await findTask(pool, input.task);
      const note = await details.addNote(pool, task.id, input.text).catch(error => { throw refusal(error); });
      return { summary: `Notatka do „${task.title}”`, data: { id: note.id, taskId: task.id },
        undo: { taskId: task.id, noteId: note.id, title: task.title, body: crypto.createHash("md5").update(note.body).digest("hex") } };
    },
    undo: async ({ taskId, noteId, title, body }) => {
      const deleted = await pool.query("DELETE FROM task_notes WHERE id = $1 AND task_id = $2 AND md5(body) = $3", [noteId, taskId, body]);
      if (!deleted.rowCount) throw changed();
      return `Cofnięto notatkę do: ${title}`;
    }
  };

  const addSubtask = {
    name: "tasks.add_subtask",
    description: "Adds a subtask (a checklist item) to one of the owner's tasks: \"do remontu dodaj podzadanie kupić farbę\".",
    schema: {
      type: "object", additionalProperties: false, required: ["task", "title"],
      properties: { task: taskField, title: { type: "string", minLength: 1, maxLength: 200, description: "The subtask, short" } }
    },
    run: async input => {
      if (!details.isSubtaskTitle(input.title)) throw new kit.AssistantError("Invalid subtask");
      const task = await findTask(pool, input.task);
      const subtask = await details.addSubtask(pool, task.id, input.title).catch(error => { throw refusal(error); });
      if (!subtask) throw new kit.AssistantError("Too many subtasks", 409);
      return { summary: `Podzadanie: ${subtask.title} · do „${task.title}”`, data: { id: subtask.id, taskId: task.id },
        undo: { taskId: task.id, subtaskId: subtask.id, title: subtask.title } };
    },
    undo: async ({ taskId, subtaskId, title }) => {
      const deleted = await pool.query("DELETE FROM task_subtasks WHERE id = $1 AND task_id = $2 AND title = $3 AND NOT done", [subtaskId, taskId, title]);
      if (!deleted.rowCount) throw changed();
      return `Cofnięto podzadanie: ${title}`;
    }
  };

  const setSubtask = {
    name: "tasks.set_subtask",
    description: "Ticks a subtask of one of the owner's tasks as done, or unticks it (done: false): \"w remoncie odhacz farbę\".",
    schema: {
      type: "object", additionalProperties: false, required: ["task", "subtask"],
      properties: {
        task: taskField,
        subtask: { type: "string", minLength: 1, maxLength: 200, description: "The subtask's title or a part of it" },
        done: { type: "boolean", description: "true (default): done; false: not done again" }
      }
    },
    run: async input => {
      const done = input.done !== false;
      const task = await findTask(pool, input.task);
      const subtasks = (await pool.query(`SELECT ${details.SUBTASK_COLUMNS} FROM task_subtasks WHERE task_id = $1 ORDER BY position ASC, id ASC`, [task.id])).rows;
      if (!subtasks.length) throw new kit.AssistantError(`„${task.title}” has no subtasks`, 404);
      const subtask = pick(subtasks, input.subtask, { prefer: row => row.done !== done, what: "subtask", label: row => `${row.id}: ${row.title}${row.done ? " (done)" : ""}` });
      const data = { id: subtask.id, taskId: task.id, done };
      if (subtask.done === done) return { summary: `${subtask.title}: już ${done ? "zrobione" : "niezrobione"}`, data };
      if (!(await details.updateSubtask(pool, task.id, subtask.id, { done }))) throw changed();
      return { summary: `${done ? "✓" : "↺"} ${subtask.title} · „${task.title}”`, data,
        undo: { taskId: task.id, subtaskId: subtask.id, title: subtask.title, done } };
    },
    undo: async ({ taskId, subtaskId, title, done }) => {
      if (!(await details.updateSubtask(pool, taskId, subtaskId, { done: !done }, { ifDone: done }))) throw changed();
      return `Cofnięto: ${title}`;
    }
  };

  // what Home's AI needs to fill the tools in: today's date (Warsaw) and the names it may use for a space, a project or
  // an assignee (the owner's view)
  const context = async () => {
    const [spaces, projects, assignees] = await Promise.all([
      pool.query(`SELECT s.name FROM spaces s WHERE ${visibleSpace("s", "$1::integer")} ORDER BY s.position, s.id`, [null]),
      pool.query(`SELECT p.name, s.name AS space FROM projects p JOIN spaces s ON s.id = p.space_id
        WHERE p.archived_at IS NULL AND ${visibleProject("p", "$1::integer")} ORDER BY p.position, p.id`, [null]),
      pool.query(`SELECT a.name FROM assignees a WHERE ${visibleAssignee("a", "$1::integer")} ORDER BY a.name, a.id`, [null])
    ]);
    return { today: warsawDay(now()), spaces: spaces.rows.map(row => row.name),
      projects: projects.rows.map(row => ({ name: row.name, space: row.space })), assignees: assignees.rows.map(row => row.name) };
  };

  return kit.createAssistantConnector({ config: config.assistant, owner: async () => OWNER,
    tools: [addTask, today, list, setStatus, updateTask, restore, addNote, addSubtask, setSubtask], context });
}

module.exports = { createTasksAssistant, warsawDay, matching };
