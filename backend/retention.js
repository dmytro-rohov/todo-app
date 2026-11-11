// Archive and clean-up, run by the server every hour (single replica; an advisory lock keeps two runs apart).
//
// 1. A task "done" for RETENTION_ARCHIVE_DAYS moves to the archive (archived_at), recorded in its history.
// 2. Archived tasks are deleted for good, with their notes, subtasks, timers and history (FK cascade):
//    private ones (the owner's or a member's private space, or no space) after RETENTION_DELETE_PRIVATE_DAYS in the archive,
//    all others (Praca, clients' projects, own spaces) after RETENTION_DELETE_WORK_DAYS.
// A value of 0 switches that step off.
const { withTransaction } = require("./kit");
const { PRIVATE_SPACES } = require("./spaces");
const { recordTaskChanges } = require("./task-history");

const RETENTION_LOCK_ID = 7243917463;
const HOUR_MS = 3600000;

// Archive date + days, for showing when an archived task disappears (null = never).
function deletionDate(archivedAt, isPrivate, settings) {
  const days = isPrivate ? settings.deletePrivateDays : settings.deleteWorkDays;
  return days ? new Date(new Date(archivedAt).getTime() + days * 86400000).toISOString() : null;
}

async function runRetention(pool, settings) {
  return withTransaction(pool, async client => {
    const { rows: [lock] } = await client.query("SELECT pg_try_advisory_xact_lock($1) AS ok", [RETENTION_LOCK_ID]);
    if (!lock.ok) return { archived: 0, deleted: 0, skipped: true };
    let archived = [];
    if (settings.archiveDays) {
      ({ rows: archived } = await client.query(
        `UPDATE tasks SET archived_at = now(), updated_at = now()
         WHERE archived_at IS NULL AND status = 'done' AND completed_at <= now() - make_interval(days => $1)
         RETURNING id, archived_at`, [settings.archiveDays]));
      for (const row of archived) {
        await recordTaskChanges(client, row.id, [{ field: "archived_at", oldValue: null, newValue: row.archived_at.toISOString() }], "retention");
      }
    }
    let deleted = 0;
    if (settings.deletePrivateDays) {
      deleted += (await client.query(
        `DELETE FROM tasks WHERE archived_at <= now() - make_interval(days => $1) AND (space_id IS NULL OR space_id IN ${PRIVATE_SPACES})`,
        [settings.deletePrivateDays])).rowCount;
    }
    if (settings.deleteWorkDays) {
      deleted += (await client.query(
        `DELETE FROM tasks WHERE archived_at <= now() - make_interval(days => $1) AND space_id IS NOT NULL AND space_id NOT IN ${PRIVATE_SPACES}`,
        [settings.deleteWorkDays])).rowCount;
    }
    return { archived: archived.length, deleted, skipped: false };
  });
}

// Runs once shortly after start, then hourly. Logs counts only.
function scheduleRetention(pool, settings, { firstRunMs = 60000, log = console.log } = {}) {
  if (!settings.archiveDays && !settings.deletePrivateDays && !settings.deleteWorkDays) return { stop() {} };
  const run = () => runRetention(pool, settings).then(
    result => { if (result.archived || result.deleted) log(`retention: archived ${result.archived}, deleted ${result.deleted}`); },
    () => console.error("retention run failed"));
  const first = setTimeout(run, firstRunMs);
  const hourly = setInterval(run, HOUR_MS);
  first.unref(); hourly.unref();
  return { stop() { clearTimeout(first); clearInterval(hourly); } };
}

module.exports = { runRetention, scheduleRetention, deletionDate, RETENTION_LOCK_ID };
