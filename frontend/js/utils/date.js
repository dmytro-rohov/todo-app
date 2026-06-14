// update date
export function formatDateLabel(dateStr) {

  const todayKey = getTodayKey();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const yesterdayKey =
    `${yesterday.getFullYear()}-${
      String(yesterday.getMonth() + 1).padStart(2, "0")
    }-${
      String(yesterday.getDate()).padStart(2, "0")
    }`;

  if (dateStr === todayKey) return "Dzisiaj";
  if (dateStr === yesterdayKey) return "Wczoraj";

  return new Date(dateStr).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "numeric",
    year: "2-digit"
  });
}

export function getTodayKey() {
  const today = new Date();

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

// group by date
export function groupTasksByDate(tasks) {
  return tasks.reduce((acc, task) => {
    
    if (!task) return;
    if (!acc[task.date]) {
      acc[task.date] = [];
    }
    acc[task.date].push(task);
    return acc;
  }, {});
}