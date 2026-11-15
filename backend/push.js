// Mytko Tasks' push notifications: what is sent and when. Sending, devices and each device's choice are Mytko Kit's
// (kit.createPush, the kit's docs/push.md); the owner is user id NULL (access.js), the kit's store takes that.
//
// - today (on by default): once a day from 8:00 Warsaw time, each account with a device hears how many open tasks it
//   has for today (planned for today or earlier, or due by today) and the first few titles. Sent once (push_log).
const { visibleTask } = require("./access");

const CATEGORIES = [{ id: "today", default: true }];
const FROM_HOUR = 8;
const JOB_INTERVAL_MS = 15 * 60 * 1000;
const SHOWN = 3;

function warsawNow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// The accounts with a device: the owner (null) and the members who switched notifications on.
async function accountsWithDevices(pool) {
  return (await pool.query("SELECT DISTINCT user_id AS \"userId\" FROM push_subscriptions")).rows.map(row => row.userId ?? null);
}

async function todayFor(pool, userId, day) {
  return (await pool.query(
    `SELECT t.title FROM tasks t
      WHERE ${visibleTask("t", "$1::integer")} AND NOT t.completed AND t.archived_at IS NULL
        AND (t.date <= $2::date OR t.due_date <= $2::date)
      ORDER BY t.priority, t.due_date NULLS LAST, t.id`, [userId, day])).rows.map(row => row.title);
}

// Once per account and day: a restart or a second instance never sends it again (the key holds who and when).
async function claim(pool, userId, day) {
  const key = `today:${userId ?? "owner"}:${day}`;
  return (await pool.query("INSERT INTO push_log (user_id, key) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING RETURNING id", [userId, key])).rowCount === 1;
}

function todayMessage(titles, day) {
  const shown = titles.slice(0, SHOWN).join(" · ") + (titles.length > SHOWN ? ` · i jeszcze ${titles.length - SHOWN}` : "");
  return { category: "today", title: `Na dziś: ${titles.length} ${titles.length === 1 ? "zadanie" : titles.length < 5 ? "zadania" : "zadań"}`, body: shown, url: "/", tag: `today-${day}` };
}

async function remindToday(pool, push, now = new Date()) {
  if (!push.available) return 0;
  const time = warsawNow(now);
  if (time.hour < FROM_HOUR) return 0;
  let told = 0;
  for (const userId of await accountsWithDevices(pool)) {
    const titles = await todayFor(pool, userId, time.day);
    if (!titles.length || !(await claim(pool, userId, time.day))) continue;
    await push.send(userId, todayMessage(titles, time.day));
    told += 1;
  }
  return told;
}

function pushJob(pool, push, { intervalMs = JOB_INTERVAL_MS } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await remindToday(pool, push); } catch (error) { console.error(`push job failed: ${error.message}`); } finally { running = false; }
  };
  const first = setTimeout(run, 90 * 1000);
  const timer = setInterval(run, intervalMs);
  first.unref?.();
  timer.unref?.();
  return { run, stop: () => { clearTimeout(first); clearInterval(timer); } };
}

module.exports = { CATEGORIES, warsawNow, remindToday, todayMessage, pushJob };
