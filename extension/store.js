// Storage: chrome.storage.local as an extension (this computer only, no sync),
// localStorage as a plain web page (preview).
const area = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

export async function get(keys) {
  if (area) return area.get(keys);
  const out = {};
  for (const k of keys) {
    try {
      const v = localStorage.getItem('gp:' + k);
      if (v !== null) out[k] = JSON.parse(v);
    } catch { /* empty storage */ }
  }
  return out;
}

export async function set(obj) {
  if (area) return area.set(obj);
  for (const [k, v] of Object.entries(obj)) {
    try { localStorage.setItem('gp:' + k, JSON.stringify(v)); } catch { /* full or blocked */ }
  }
}

export async function remove(keys) {
  if (area) return area.remove(keys);
  for (const k of keys) {
    try { localStorage.removeItem('gp:' + k); } catch { /* blocked */ }
  }
}

export function onChange(fn) {
  if (area) chrome.storage.onChanged.addListener((changes, name) => { if (name === 'local') fn(changes); });
}
