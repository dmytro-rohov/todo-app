// The API Mytko Workflow calls (Bearer token; Tasks keeps only its SHA-256 in WORKFLOW_TOKEN_SHA256). Tasks never
// calls Workflow: Workflow runs on Fujitsu and polls while it is on, so Tasks stays available on its own.
//   GET  /api/agent/workflow/tasks       tasks sent to Workflow (or withdrawn after it took them), with context
//   POST /api/agent/workflow/tasks/:id   { status, ref?, url? }: Workflow took the task / its status changed;
//        todo / in_progress / needs_attention / done are mirrored on the board, cancelled ends the link.
// Only tasks in spaces visible to agents are ever shown (never a private space or a member's).
const crypto = require("node:crypto");
const express = require("express");
const { withTransaction } = require("../db");
const { parseId } = require("../validation");
const { loadTask } = require("./tasks");
const { taskChanges, recordTaskChanges } = require("../task-history");
const { statusAssignmentsSql, statusSql } = require("../task-status");

const BOARD = { todo: "todo", in_progress: "in_progress", needs_attention: "needs_review", done: "done" };
const STATUSES = [...Object.keys(BOARD), "cancelled"];
const REF = /^[A-Za-z0-9._:-]{1,100}$/;
const ACTOR = "workflow";

const sha256 = value => crypto.createHash("sha256").update(String(value)).digest();

module.exports = function createAgentRouter(pool, { tokenSha256, publicOrigin }) {
  const router = express.Router();
  const expected = Buffer.from(tokenSha256, "hex");

  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    const match = /^Bearer ([A-Za-z0-9._~+/=-]{20,200})$/.exec(req.get("authorization") || "");
    if (!match || !crypto.timingSafeEqual(sha256(match[1]), expected)) return res.status(401).json({ message: "Invalid token" });
    next();
  });

  const SELECT = `SELECT t.id, t.title, t.description, ${statusSql("t")} AS status, t.priority, TO_CHAR(t.due_date, 'YYYY-MM-DD') AS "dueDate",
      t.workflow_requested_at AS "requestedAt", t.workflow_ref AS ref, t.workflow_status AS "workflowStatus", t.updated_at AS "updatedAt",
      s.name AS space, p.name AS project, c.name AS client, e.title AS "meetingTitle", e.start_at AS "meetingAt", m.subject AS "mailSubject",
      m.from_address AS "mailFrom",
      ARRAY(SELECT cat.name FROM categories cat WHERE cat.id = t.category_id OR cat.id IN (SELECT l.category_id FROM task_labels l WHERE l.task_id = t.id)) AS labels,
      COALESCE((SELECT json_agg(json_build_object('title', st.title, 'done', st.done) ORDER BY st.position, st.id) FROM task_subtasks st WHERE st.task_id = t.id), '[]') AS subtasks
    FROM tasks t JOIN spaces s ON s.id = t.space_id AND s.agent_visible
    LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN clients c ON c.id = COALESCE(t.client_id, p.client_id)
    LEFT JOIN calendar_events e ON e.id = t.meeting_id LEFT JOIN mail_messages m ON m.id = t.mail_id`;
  const shape = row => ({ ...row, requested: Boolean(row.requestedAt), link: `${publicOrigin}/#task-${row.id}` });

  router.get("/workflow/tasks", async (req, res) => {
    const { rows } = await pool.query(`${SELECT} WHERE (t.workflow_requested_at IS NOT NULL OR t.workflow_ref IS NOT NULL)
      AND t.archived_at IS NULL AND COALESCE(t.workflow_status, '') <> 'cancelled' ORDER BY t.workflow_requested_at NULLS LAST, t.id LIMIT 500`);
    res.json({ tasks: rows.map(shape) });
  });

  router.post("/workflow/tasks/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const body = req.body || {};
    if (id === null || !STATUSES.includes(body.status) || Object.keys(body).some(k => !["status", "ref", "url"].includes(k))) {
      return res.status(400).json({ message: "Invalid request" });
    }
    if (body.ref !== undefined && !REF.test(body.ref)) return res.status(400).json({ message: "Invalid ref" });
    if (body.url !== undefined && (typeof body.url !== "string" || body.url.length > 500 || !/^https?:\/\/[^\s"<>]+$/.test(body.url))) {
      return res.status(400).json({ message: "Invalid url" });
    }
    const task = await withTransaction(pool, async db => {
      const linked = (await db.query(
        `SELECT 1 FROM tasks t JOIN spaces s ON s.id = t.space_id AND s.agent_visible
         WHERE t.id = $1 AND (t.workflow_requested_at IS NOT NULL OR t.workflow_ref IS NOT NULL) FOR UPDATE OF t`, [id])).rowCount;
      if (!linked) return null;
      const before = await loadTask(db, id, { lock: true });
      const params = [id, body.status, body.ref ?? null, body.url ?? null];
      // Workflow taking the task (no ref yet) only links it: the card keeps its column and its running timer.
      const board = before.workflowRef ? BOARD[body.status] : undefined;
      const sets = ["workflow_status = $2", "workflow_ref = COALESCE($3, workflow_ref)", "workflow_url = COALESCE($4, workflow_url)", "workflow_updated_at = now()", "updated_at = now()"];
      if (body.status === "cancelled") sets.push("workflow_requested_at = NULL");
      if (board && board !== before.status) { params.push(board); sets.push(...statusAssignmentsSql(`$${params.length}`)); }
      await db.query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = $1`, params);
      if (board && board !== "in_progress") await db.query("UPDATE task_time_entries SET ended_at = now() WHERE task_id = $1 AND ended_at IS NULL", [id]);
      const after = await loadTask(db, id);
      await recordTaskChanges(db, id, taskChanges(before, after), ACTOR);
      return (await db.query(`${SELECT} WHERE t.id = $1`, [id])).rows[0];
    });
    if (!task) return res.status(404).json({ message: "Task not found" });
    res.json(shape(task));
  });

  return router;
};
