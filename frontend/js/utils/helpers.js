// get random color for category
export function getRandomColor() {
  const colors = [
    "#4e45e4",
    "#22c55e",
    "#f59e0b",
    "#ef4444",
    "#3b82f6",
    "#a855f7"
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}