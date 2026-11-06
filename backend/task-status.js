// The five board statuses and how they are stored. The database CHECK (migration 0000) allows only
// todo / in_progress / done and cannot be widened inside Mytko's additive grammar, so "needs_review" is stored as
// in_progress with review_requested_at set, and "planned" (long-term plans) as todo with planned_at set.
// Every read and write of a status goes through this module.
const STATUSES = ["todo", "in_progress", "needs_review", "done", "planned"];

// SQL expression for the board status of a row of `tasks` (optionally qualified by an alias).
function statusSql(alias = "") {
  const t = alias ? `${alias}.` : "";
  return `(CASE WHEN ${t}status = 'in_progress' AND ${t}review_requested_at IS NOT NULL THEN 'needs_review'
    WHEN ${t}status = 'todo' AND ${t}planned_at IS NOT NULL THEN 'planned' ELSE ${t}status END)`;
}

// SQL condition selecting rows with the given board status; `param` is the placeholder holding it.
function statusFilterSql(param) {
  return `${statusSql()} = ${param}`;
}

// Assignments that set the board status `param` (a placeholder holding one of STATUSES), keeping
// completed / completed_at / review_requested_at consistent with it.
function statusAssignmentsSql(param) {
  return [
    `status = CASE ${param}::text WHEN 'needs_review' THEN 'in_progress' WHEN 'planned' THEN 'todo' ELSE ${param}::text END`,
    `review_requested_at = CASE WHEN ${param}::text = 'needs_review' THEN COALESCE(review_requested_at, now()) ELSE NULL END`,
    `planned_at = CASE WHEN ${param}::text = 'planned' THEN COALESCE(planned_at, now()) ELSE NULL END`,
    `completed = (${param}::text = 'done')`,
    `completed_at = CASE WHEN ${param}::text = 'done' THEN COALESCE(completed_at, now()) ELSE NULL END`
  ];
}

module.exports = { STATUSES, statusSql, statusFilterSql, statusAssignmentsSql };
