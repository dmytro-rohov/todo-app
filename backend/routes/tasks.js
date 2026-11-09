const express = require("express");
const { withTransaction } = require("../db");
const { defaultSpaces } = require("../spaces");
const { validateTaskPatch } = require("../task-domain");
const { taskChanges, recordTaskChanges } = require("../task-history");
const { STATUSES, statusSql, statusFilterSql, statusAssignmentsSql } = require("../task-status");
const { isOwner, userId, canSeeTask, visibleTask, visibleProject, visibleSpace, visibleLabel, visibleAssignee } = require("../access");

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
  planned_at AS "plannedAt", client_id AS "clientId", meeting_id AS "meetingId", mail_id AS "mailId",
  workflow_requested_at AS "workflowRequestedAt", workflow_ref AS "workflowRef", workflow_status AS "workflowStatus",
  workflow_url AS "workflowUrl", workflow_updated_at AS "workflowUpdatedAt", workflow_requested_by AS "workflowRequestedBy",
  ai_coding AS "aiCoding", ai_reason AS "aiReason",
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
// Only projects and spaces the account can see are accepted; no space means the account's private space.
// A task goes only to a shared space or to a space of its creator: nobody can move someone else's task out of sight
// of the person who created it (e.g. a member moving the owner's task from "Dom" into their own Prywatne).
async function checkDestination(db, spaceId, creatorId) {
  if (spaceId === null) return;
  const space = (await db.query("SELECT shared, user_id FROM spaces WHERE id = $1", [spaceId])).rows[0];
  if (space && !space.shared && (space.user_id ?? null) !== (creatorId ?? null)) {
    throw new TaskInputError("A task can only move to a shared space or a space of its creator");
  }
}

async function resolvePlacement(db, current, value, spaces, user, creatorId = userId(user)) {
  const result = {};
  const uid = userId(user);
  if ("projectId" in value && value.projectId !== null) {
    const project = await db.query(`SELECT p.space_id FROM projects p WHERE p.id = $1 AND p.archived_at IS NULL AND ${visibleProject("p", "$2::integer")}`, [value.projectId, uid]);
    if (!project.rowCount) throw new TaskInputError("Project does not exist");
    const projectSpace = project.rows[0].space_id;
    if ("spaceId" in value && (value.spaceId ?? spaces.private) !== projectSpace) {
      throw new TaskInputError("Project belongs to another space");
    }
    await checkDestination(db, projectSpace, creatorId);
    return { spaceId: projectSpace, projectId: value.projectId };
  }
  if ("projectId" in value) result.projectId = null;
  if ("spaceId" in value) {
    const spaceId = value.spaceId ?? spaces.private ?? null;
    if (spaceId !== null && !(await db.query(`SELECT 1 FROM spaces s WHERE s.id = $1 AND ${visibleSpace("s", "$2::integer")}`, [spaceId, uid])).rowCount) {
      throw new TaskInputError("Space does not exist");
    }
    await checkDestination(db, spaceId, creatorId);
    result.spaceId = spaceId;
    if (!("projectId" in value) && current && current.projectId !== null) {
      const project = await db.query("SELECT 1 FROM projects WHERE id = $1 AND space_id = $2", [current.projectId, spaceId]);
      if (!project.rowCount) result.projectId = null;
    }
  }
  return result;
}

// Labels and the assignee must be ones the account can see; clients and meetings are the owner's only.
async function checkReferences(db, user, value) {
  const uid = userId(user);
  if (!isOwner(user) && ((value.clientId ?? null) !== null || (value.meetingId ?? null) !== null || (value.mailId ?? null) !== null || value.workflow === true)) {
    throw new TaskInputError("Clients and meetings are not available for this account");
  }
  const labels = [...new Set([...(value.labelIds || []), ...(value.categoryId != null ? [value.categoryId] : [])])];
  if (labels.length) {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM categories c WHERE c.id = ANY($1::int[]) AND ${visibleLabel("c", "$2::integer")}`, [labels, uid]);
    if (rows[0]?.n !== labels.length) throw new TaskInputError("Category does not exist");
  }
  if (value.assigneeId != null) {
    const { rowCount } = await db.query(`SELECT 1 FROM assignees a WHERE a.id = $1 AND ${visibleAssignee("a", "$2::integer")}`, [value.assigneeId, uid]);
    if (!rowCount) throw new TaskInputError("Assignee does not exist");
  }
}

// Sends a task to (true) or withdraws it from (false) the Mytko Workflow ToDo. Only tasks in spaces visible to agents
// go (never a private space); Workflow picks them up from /api/agent/workflow (routes/agent.js).
// `by`: "owner" (a click) or "ai" (Claude's routing, workflow-ai.js). Refused while the Workflow connection is off.
async function setWorkflow(db, taskId, requested, actor, { by = "owner", enabled = true } = {}) {
  const task = (await db.query(
    `SELECT t.workflow_requested_at, t.workflow_ref, s.agent_visible FROM tasks t LEFT JOIN spaces s ON s.id = t.space_id WHERE t.id = $1`, [taskId])).rows[0];
  if (requested && !task.agent_visible) throw new TaskInputError("This space is not visible to agents");
  if (requested && !enabled) throw new TaskInputError("The Mytko Workflow connection is turned off");
  if (requested === Boolean(task.workflow_requested_at)) return;
  await db.query(
    `UPDATE tasks SET workflow_requested_at = ${requested ? "now()" : "NULL"}, workflow_requested_by = ${requested ? "$3" : "workflow_requested_by"},
       workflow_status = CASE WHEN $2::boolean THEN COALESCE(workflow_status, 'requested') WHEN workflow_ref IS NULL THEN NULL ELSE 'withdrawn' END,
       workflow_updated_at = now(), updated_at = now() WHERE id = $1`, requested ? [taskId, requested, by] : [taskId, requested]);
  await recordTaskChanges(db, taskId, [{ field: "workflow", oldValue: task.workflow_requested_at ? "requested" : null, newValue: requested ? "requested" : "withdrawn" }], actor);
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
      : /client/.test(error.constraint || "") ? "Client does not exist"
      : /meeting/.test(error.constraint || "") ? "Meeting does not exist"
      : /mail/.test(error.constraint || "") ? "E-mail does not exist"
      : /project/.test(error.constraint || "") ? "Project does not exist"
      : /space/.test(error.constraint || "") ? "Space does not exist" : "Category does not exist";
    return res.status(400).json({ message });
  }
  throw error;
}

module.exports = function createTasksRouter(pool, { settings = null } = {}) {
  const workflowOn = async () => (settings ? settings.workflowEnabled() : true);
  const router = express.Router();

  router.post("/move", async (req, res) => {
    const result = await require("../ordering").moveTask(pool, req.body, req.user);
    res.status(result.status).json({ message: result.message });
  });

  // get
  router.get("/", async (req, res) => {
    const params = [userId(req.user)];
    const conditions = ["archived_at IS NULL", visibleTask("tasks", "$1::integer")];
    for (const [key, column, choices] of [["priority", "priority", ["P0", "P1", "P2", "P3"]], ["projectId", "project_id", null], ["assigneeId", "assignee_id", null], ["meetingId", "meeting_id", null], ["mailId", "mail_id", null]]) {
      if (req.query[key] === undefined) continue;
      if (choices ? !choices.includes(req.query[key]) : parseId(req.query[key]) === null) return res.status(400).json({ message: "Invalid filter" });
      params.push(req.query[key]); conditions.push(`${column} = $${params.length}`);
    }
    if (req.query.clientId !== undefined) {
      const id = parseId(req.query.clientId);
      if (id === null) return res.status(400).json({ message: "Invalid filter" });
      params.push(id);
      // the task's own client, or its project's when it has none
      conditions.push(`(client_id = $${params.length} OR (client_id IS NULL AND project_id IN (SELECT id FROM projects WHERE client_id = $${params.length})))`);
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
      const spaces = await defaultSpaces(pool, req.user);
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

    const extras = Object.fromEntries(Object.entries(req.body).filter(([key]) => ["description","status","priority","dueDate","position","spaceId","projectId","labelIds","assigneeId","clientId","meetingId","mailId","workflow"].includes(key)));
    const extraValidation = Object.keys(extras).length ? validateTaskPatch(extras) : { value: {} };
    if (extraValidation.error) return res.status(400).json({ message: extraValidation.error });
    const domain = extraValidation.value;
    const labelIds = domain.labelIds ? [...new Set([value.categoryId, ...domain.labelIds].filter(id => id !== null))] : null;
    try {
      const task = await withTransaction(pool, async client => {
        const spaces = await defaultSpaces(client, req.user);
        await checkReferences(client, req.user, { ...domain, categoryId: value.categoryId });
        // Without a space or a project a new task is private.
        const placementInput = "spaceId" in domain || domain.projectId != null ? domain : { ...domain, spaceId: null };
        const placement = await resolvePlacement(client, null, placementInput, spaces, req.user);
        // Domain rules formerly enforced by a database trigger: status wins over completed, completed mirrors
        // status, completed_at follows it, and a task without an explicit position gets its own id.
        const status = value.completed ? "done" : (domain.status || "todo");
        const inserted = await client.query(
          `WITH next AS (SELECT nextval(pg_get_serial_sequence('tasks', 'id')) AS id)
          INSERT INTO tasks
          (id, title, completed, date, category_id, description, status, priority, due_date, position, completed_at, space_id, project_id,
           assignee_id, review_requested_at, planned_at, client_id, meeting_id, user_id, mail_id)
          SELECT next.id, $1::varchar, $2::boolean, $3::date, $4::integer, $5::text, $6::text, $7::text, $8::date,
            COALESCE($9::bigint, next.id), CASE WHEN $2::boolean THEN now() ELSE NULL END, $10::integer, $11::integer,
            $12::integer, CASE WHEN $13::boolean THEN now() ELSE NULL END, CASE WHEN $14::boolean THEN now() ELSE NULL END,
            $15::integer, $16::integer, $17::integer, $18::integer
          FROM next
          RETURNING id`,
          [value.title, status === "done", value.date, labelIds ? labelIds[0] ?? null : value.categoryId, domain.description || "",
            status === "needs_review" ? "in_progress" : status === "planned" ? "todo" : status, domain.priority || "P2", domain.dueDate ?? null, domain.position ?? null,
            placement.spaceId ?? null, placement.projectId ?? null, domain.assigneeId ?? null, status === "needs_review", status === "planned",
            domain.clientId ?? null, domain.meetingId ?? null, userId(req.user), domain.mailId ?? null]
        );
        const id = inserted.rows[0].id;
        if (labelIds && labelIds.length > 1) await setLabels(client, id, labelIds);
        if (domain.workflow === true) await setWorkflow(client, id, true, req.user.actor, { enabled: await workflowOn() });
        const created = await loadTask(client, id);
        await recordTaskChanges(client, id, taskChanges(null, created), req.user.actor);
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

    const result = await pool.query(`DELETE FROM tasks WHERE id = $1 AND ${visibleTask("tasks", "$2::integer")}`, [id, userId(req.user)]);

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

    await pool.query(`DELETE FROM tasks WHERE date = $1 AND ${visibleTask("tasks", "$2::integer")}`, [date, userId(req.user)]);

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
        if (!(await canSeeTask(client, req.user, id))) return null;
        const before = await loadTask(client, id, { lock: true });
        if (!before) return null;
        await checkReferences(client, req.user, value);
        const { spaceId, projectId, labelIds, workflow, ...fields } = value;
        if ("spaceId" in value || "projectId" in value) {
          const creator = (await client.query("SELECT user_id FROM tasks WHERE id = $1", [id])).rows[0].user_id;
          Object.assign(fields, await resolvePlacement(client, before, value, await defaultSpaces(client, req.user), req.user, creator));
        }
        const { status, ...plain } = fields;
        const columns = { title: "title", description: "description", priority: "priority", categoryId: "category_id", dueDate: "due_date", position: "position", spaceId: "space_id", projectId: "project_id", assigneeId: "assignee_id", clientId: "client_id", meetingId: "meeting_id", mailId: "mail_id" };
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
        if (workflow !== undefined) await setWorkflow(client, id, workflow, req.user.actor, { enabled: await workflowOn() });
        // a new title or description is looked at by Claude's routing again
        if ("title" in plain || "description" in plain) await client.query("UPDATE tasks SET ai_checked_at = NULL, ai_coding = NULL, ai_reason = NULL WHERE id = $1", [id]);
        const after = await loadTask(client, id);
        await recordTaskChanges(client, id, taskChanges(before, after), req.user.actor);
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
        if (!(await canSeeTask(client, req.user, id))) return null;
        const before = await loadTask(client, id, { lock: true });
        if (!before) return null;
        await checkReferences(client, req.user, { categoryId: value.categoryId });
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
        await recordTaskChanges(client, id, taskChanges(before, after), req.user.actor);
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
module.exports.setWorkflow = setWorkflow;
module.exports.loadTask = loadTask;
module.exports.stopTimerUnlessInProgress = stopTimerUnlessInProgress;
