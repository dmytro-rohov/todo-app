const express = require("express");
const { withTransaction } = require("../db");
const { defaultSpaces } = require("../spaces");
const { validateTaskPatch } = require("../task-domain");
const { taskChanges, recordTaskChanges } = require("../task-history");
const { STATUSES, statusSql, statusFilterSql, statusAssignmentsSql } = require("../task-status");

const { parseId, isValidDate, validateTask } = require("../validation");

// labelIds: the primary label (category_id) first, then the additional labels in the order they were added.
const TASK_COLUMNS = `
  id,
  title,
  completed,
  TO_CHAR(date, 'YYYY-MM-DD') AS date,
  category_id AS "categoryId", description, ${statusSql()} AS status, priority, position,
  TO_CHAR(due_date, 'YYYY-MM-DD') AS "dueDate",
  created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt", archived_at AS "archivedAt",
  space_id AS "spaceId", project_id AS "projectId", assignee_id AS "assigneeId", review_requested_at AS "reviewRequestedAt",
  planned_at AS "plannedAt",
  ARRAY_REMOVE(ARRAY[category_id] || ARRAY(
    SELECT l.category_id FROM task_labels l
    WHERE l.task_id = tasks.id AND l.category_id IS DISTINCT FROM tasks.category_id ORDER BY l.id), NULL) AS "labelIds",
  (SELECT count(*)::int FROM task_subtasks s WHERE s.task_id = tasks.id) AS "subtaskCount",
  (SELECT count(*)::int FROM task_subtasks s WHERE s.task_id = tasks.id AND s.done) AS "subtaskDoneCount",
  (SELECT count(*)::int FROM task_notes n WHERE n.task_id = tasks.id) AS "noteCount",
  (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM COALESCE(e.ended_at, now()) - e.started_at)), 0)::int
    FROM task_time_entries e WHERE e.task_id = tasks.id) AS "trackedSeconds",
  (SELECT e.started_at FROM task_time_entries e WHERE e.task_id = tasks.id AND e.ended_at IS NULL) AS "timerStartedAt"
`;

// Work stops being timed when a task leaves "in progress".
async function stopTimerUnlessInProgress(db, taskId, status) {
  if (status !== "in_progress") {
    await db.query("UPDATE task_time_entries SET ended_at = now() WHERE task_id = $1 AND ended_at IS NULL", [taskId]);
  }
}

// PostgreSQL foreign_key_violation: category_id points to a missing category.
const FOREIGN_KEY_VIOLATION = "23503";

class TaskInputError extends Error {}

async function loadTask(db, id, { lock = false } = {}) {
  const result = await db.query(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
  return result.rows[0] || null;
}

// Decides space_id / project_id for a write. A project fixes the space; moving a task to another space
// drops a project that does not belong there. `current` is the task before the change (null when creating).
async function resolvePlacement(db, current, value, spaces) {
  const result = {};
  if ("projectId" in value && value.projectId !== null) {
    const project = await db.query("SELECT space_id FROM projects WHERE id = $1 AND archived_at IS NULL", [value.projectId]);
    if (!project.rowCount) throw new TaskInputError("Project does not exist");
    const projectSpace = project.rows[0].space_id;
    if ("spaceId" in value && (value.spaceId ?? spaces.private) !== projectSpace) {
      throw new TaskInputError("Project belongs to another space");
    }
    return { spaceId: projectSpace, projectId: value.projectId };
  }
  if ("projectId" in value) result.projectId = null;
  if ("spaceId" in value) {
    const spaceId = value.spaceId ?? spaces.private ?? null;
    if (spaceId !== null && !(await db.query("SELECT 1 FROM spaces WHERE id = $1", [spaceId])).rowCount) {
      throw new TaskInputError("Space does not exist");
    }
    result.spaceId = spaceId;
    if (!("projectId" in value) && current && current.projectId !== null) {
      const project = await db.query("SELECT 1 FROM projects WHERE id = $1 AND space_id = $2", [current.projectId, spaceId]);
      if (!project.rowCount) result.projectId = null;
    }
  }
  return result;
}

// Replaces the task's labels: the first becomes category_id, the rest go to task_labels.
async function setLabels(db, taskId, labelIds) {
  await db.query("UPDATE tasks SET category_id = $1 WHERE id = $2", [labelIds[0] ?? null, taskId]);
  await db.query("DELETE FROM task_labels WHERE task_id = $1", [taskId]);
  if (labelIds.length > 1) {
    await db.query("INSERT INTO task_labels (task_id, category_id) SELECT $1, unnest($2::int[])", [taskId, labelIds.slice(1)]);
  }
}

function sendWriteError(res, error) {
  if (error instanceof TaskInputError) return res.status(400).json({ message: error.message });
  if (error.code === FOREIGN_KEY_VIOLATION) {
    const message = /assignee/.test(error.constraint || "") ? "Assignee does not exist"
      : /project/.test(error.constraint || "") ? "Project does not exist"
      : /space/.test(error.constraint || "") ? "Space does not exist" : "Category does not exist";
    return res.status(400).json({ message });
  }
  throw error;
}

module.exports = function createTasksRouter(pool) {
  const router = express.Router();

  router.post("/move", async (req, res) => {
    const result = await require("../ordering").moveTask(pool, req.body);
    res.status(result.status).json({ message: result.message });
  });

  // get
  router.get("/", async (req, res) => {
    const conditions = ["archived_at IS NULL"];
    const params = [];
    for (const [key, column, choices] of [["priority", "priority", ["P0", "P1", "P2", "P3"]], ["projectId", "project_id", null], ["assigneeId", "assignee_id", null]]) {
      if (req.query[key] === undefined) continue;
      if (choices ? !choices.includes(req.query[key]) : parseId(req.query[key]) === null) return res.status(400).json({ message: "Invalid filter" });
      params.push(req.query[key]); conditions.push(`${column} = $${params.length}`);
    }
    if (req.query.status !== undefined) {
      if (!STATUSES.includes(req.query.status)) return res.status(400).json({ message: "Invalid filter" });
      params.push(req.query.status); conditions.push(statusFilterSql(`$${params.length}`));
    }
    if (req.query.categoryId !== undefined) {
      const id = parseId(req.query.categoryId);
      if (id === null) return res.status(400).json({ message: "Invalid filter" });
      params.push(id);
      conditions.push(`(category_id = $${params.length} OR EXISTS (SELECT 1 FROM task_labels l WHERE l.task_id = tasks.id AND l.category_id = $${params.length}))`);
    }
    if (req.query.spaceId !== undefined) {
      const id = parseId(req.query.spaceId);
      if (id === null) return res.status(400).json({ message: "Invalid filter" });
      // A task without a space belongs to the private space.
      const spaces = await defaultSpaces(pool);
      params.push(id);
      conditions.push(id === spaces.private ? `(space_id = $${params.length} OR space_id IS NULL)` : `space_id = $${params.length}`);
    }
    const result = await pool.query(`SELECT ${TASK_COLUMNS} FROM tasks WHERE ${conditions.join(" AND ")} ORDER BY position ASC, id ASC`, params);
    res.json(result.rows);
  });

  // post
  router.post("/", async (req, res) => {
    const { error, value } = validateTask(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const extras = Object.fromEntries(Object.entries(req.body).filter(([key]) => ["description","status","priority","dueDate","position","spaceId","projectId","labelIds","assigneeId"].includes(key)));
    const extraValidation = Object.keys(extras).length ? validateTaskPatch(extras) : { value: {} };
    if (extraValidation.error) return res.status(400).json({ message: extraValidation.error });
    const domain = extraValidation.value;
    const labelIds = domain.labelIds ? [...new Set([value.categoryId, ...domain.labelIds].filter(id => id !== null))] : null;
    try {
      const task = await withTransaction(pool, async client => {
        const spaces = await defaultSpaces(client);
        // Without a space or a project a new task is private.
        const placementInput = "spaceId" in domain || domain.projectId != null ? domain : { ...domain, spaceId: null };
        const placement = await resolvePlacement(client, null, placementInput, spaces);
        // Domain rules formerly enforced by a database trigger: status wins over completed, completed mirrors
        // status, completed_at follows it, and a task without an explicit position gets its own id.
        const status = value.completed ? "done" : (domain.status || "todo");
        const inserted = await client.query(
          `WITH next AS (SELECT nextval(pg_get_serial_sequence('tasks', 'id')) AS id)
          INSERT INTO tasks
          (id, title, completed, date, category_id, description, status, priority, due_date, position, completed_at, space_id, project_id,
           assignee_id, review_requested_at, planned_at)
          SELECT next.id, $1::varchar, $2::boolean, $3::date, $4::integer, $5::text, $6::text, $7::text, $8::date,
            COALESCE($9::bigint, next.id), CASE WHEN $2::boolean THEN now() ELSE NULL END, $10::integer, $11::integer,
            $12::integer, CASE WHEN $13::boolean THEN now() ELSE NULL END, CASE WHEN $14::boolean THEN now() ELSE NULL END
          FROM next
          RETURNING id`,
          [value.title, status === "done", value.date, labelIds ? labelIds[0] ?? null : value.categoryId, domain.description || "",
            status === "needs_review" ? "in_progress" : status === "planned" ? "todo" : status, domain.priority || "P2", domain.dueDate ?? null, domain.position ?? null,
            placement.spaceId ?? null, placement.projectId ?? null, domain.assigneeId ?? null, status === "needs_review", status === "planned"]
        );
        const id = inserted.rows[0].id;
        if (labelIds && labelIds.length > 1) await setLabels(client, id, labelIds);
        const created = await loadTask(client, id);
        await recordTaskChanges(client, id, taskChanges(null, created));
        return created;
      });
      res.status(201).json(task);
    } catch (dbError) {
      return sendWriteError(res, dbError);
    }
  });

  // delete
  router.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ message: "Invalid task id" });
    }

    const result = await pool.query(
      `
      DELETE FROM tasks
      WHERE id = $1
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Task not found" });
    }
    res.json({ message: "Task deleted" });
  });

  // delete by date
  router.delete("/date/:date", async (req, res) => {
    const date = req.params.date;
    if (!isValidDate(date)) {
      return res.status(400).json({ message: "Date must be YYYY-MM-DD" });
    }

    await pool.query(
      `
      DELETE FROM tasks
      WHERE date = $1
      `,
      [date]
    );

    res.json({ message: "All tasks deleted" });
  });

  // Partial updates do not revalidate unchanged historical titles.
  router.patch("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid task id" });
    const { error, value } = validateTaskPatch(req.body);
    if (error) return res.status(400).json({ message: error });
    try {
      const task = await withTransaction(pool, async client => {
        const before = await loadTask(client, id, { lock: true });
        if (!before) return null;
        const { spaceId, projectId, labelIds, ...fields } = value;
        if ("spaceId" in value || "projectId" in value) {
          Object.assign(fields, await resolvePlacement(client, before, value, await defaultSpaces(client)));
        }
        const { status, ...plain } = fields;
        const columns = { title: "title", description: "description", priority: "priority", categoryId: "category_id", dueDate: "due_date", position: "position", spaceId: "space_id", projectId: "project_id", assigneeId: "assignee_id" };
        const params = [];
        const assignments = Object.entries(plain).map(([key, val]) => {
          params.push(val); return `${columns[key]} = $${params.length}`;
        });
        if (status !== undefined) {
          params.push(status);
          assignments.push(...statusAssignmentsSql(`$${params.length}`));
        }
        params.push(id);
        await client.query(`UPDATE tasks SET ${[...assignments, "updated_at = now()"].join(", ")} WHERE id = $${params.length}`, params);
        if (labelIds) {
          await setLabels(client, id, labelIds);
        } else if ("categoryId" in value && value.categoryId !== null) {
          // The new primary label is no longer an additional one.
          await client.query("DELETE FROM task_labels WHERE task_id = $1 AND category_id = $2", [id, value.categoryId]);
        }
        if (status !== undefined) await stopTimerUnlessInProgress(client, id, status);
        const after = await loadTask(client, id);
        await recordTaskChanges(client, id, taskChanges(before, after));
        return after;
      });
      if (!task) return res.status(404).json({ message: "Task not found" });
      return res.json(task);
    } catch (error) {
      return sendWriteError(res, error);
    }
  });

  // put
  router.put("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ message: "Invalid task id" });
    }

    const { error, value } = validateTask(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }

    try {
      const task = await withTransaction(pool, async client => {
        const before = await loadTask(client, id, { lock: true });
        if (!before) return null;
        await client.query(
          `
          UPDATE tasks
          SET
            title = $1,
            date = $3,
            category_id = $4,
            status = s.next_status,
            completed = (s.next_status = 'done'),
            completed_at = CASE WHEN s.next_status = 'done' THEN COALESCE(tasks.completed_at, now()) ELSE NULL END,
            review_requested_at = CASE WHEN s.next_status = tasks.status THEN tasks.review_requested_at ELSE NULL END,
            planned_at = CASE WHEN s.next_status = tasks.status THEN tasks.planned_at ELSE NULL END,
            updated_at = now()
          FROM (
            SELECT CASE WHEN $2::boolean IS DISTINCT FROM completed
                        THEN CASE WHEN $2::boolean THEN 'done' ELSE 'todo' END
                        ELSE status END AS next_status
            FROM tasks WHERE id = $5
          ) s
          WHERE tasks.id = $5
          `,
          [value.title, value.completed, value.date, value.categoryId, id]
        );
        if (value.categoryId !== null) {
          await client.query("DELETE FROM task_labels WHERE task_id = $1 AND category_id = $2", [id, value.categoryId]);
        }
        const after = await loadTask(client, id);
        await stopTimerUnlessInProgress(client, id, after.status);
        await recordTaskChanges(client, id, taskChanges(before, after));
        return after;
      });
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      res.json(task);
    } catch (dbError) {
      return sendWriteError(res, dbError);
    }
  });

  return router;
};

module.exports.TASK_COLUMNS = TASK_COLUMNS;
module.exports.loadTask = loadTask;
module.exports.stopTimerUnlessInProgress = stopTimerUnlessInProgress;
