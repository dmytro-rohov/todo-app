import { request } from './api/http.js';
import { escapeHtml } from './utils/helpers.js';
export function categoryRows(categories) {
  return categories.map(c=>`<p>${escapeHtml(c.name)} <button data-category-edit="${Number(c.id)}">Edytuj</button> <button data-category-delete="${Number(c.id)}">Usuń</button></p>`).join('');
}
export function categoryWriter(refresh, send = request) {
  let pending = false;
  return async (id, method, body) => {
    if (pending) return false;
    pending = true;
    try {
      await send(id === null ? '/api/categories' : `/api/categories/${id}`, { method, body });
      await refresh();
      return true;
    } finally { pending = false; }
  };
}
