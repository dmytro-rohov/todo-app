const paths = {
  board: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  check: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  folder: '<path d="M3 7V5h6l2 2h10v13H3Z"/>',
  person: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h1m-1 6h1m-1 6h1"/>',
  play: '<path d="m6 3 15 9-15 9Z"/>',
  warning: '<path d="M12 3 2 21h20ZM12 9v5m0 3v1"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  done: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  tag: '<path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7" cy="7" r="1"/>',
  refresh: '<path d="M20 7a9 9 0 1 0 1 8M20 2v6h-6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>'
};
export function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.circle}</svg>`;
}
