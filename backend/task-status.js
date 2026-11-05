// The four board statuses and how they are stored. The database CHECK (migration 0000) allows only
// todo / in_progress / done and cannot be widened inside Mytko's additive grammar, so "needs_review" is stored as
// in_progress with review_requested_at set. Every read and write of a status goes through this module.
const STATUSES = ["todo", "in_progress", "needs_review", "done"];

// SQL expression for the board status of a row of `tasks` (optionally qualified by an alias).
function statusSql(alias = "") {
  const t = alias ? `${alias}.` : "";
  return `(CASE WHEN ${t}status = 'in_progress' AND ${t}review_requested_at IS NOT NULL THEN 'needs_review' ELSE ${t}status END)`;
}

// SQL condition selecting rows with the given board status; `param` is the placeholder holding it.
function statusFilterSql(param) {
  return `${statusSql()} = ${param}`;
}

// Assignments that set the board status `param` (a placeholder holding one of STATUSES), keeping
// completed / completed_at / review_requested_at consistent with it.
function statusAssignmentsSql(param) {
  return [
    `status = CASE WHEN ${param}::text = 'needs_review' THEN 'in_progress' ELSE ${param}::text END`,
    `review_requested_at = CASE WHEN ${param}::text = 'needs_review' THEN COALESCE(review_requested_at, now()) ELSE NULL END`,
    `completed = (${param}::text = 'done')`,
    `completed_at = CASE WHEN ${param}::text = 'done' THEN COALESCE(completed_at, now()) ELSE NULL END`
  ];
}

module.exports = { STATUSES, statusSql, statusFilterSql, statusAssignmentsSql };
