// Tároló: bővítményként chrome.storage.local (csak ezen a gépen, nincs szinkron),
// sima weboldalként (előnézet) localStorage.
const area = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

export async function get(keys) {
  if (area) return area.get(keys);
  const out = {};
  for (const k of keys) {
    try {
      const v = localStorage.getItem('gp:' + k);
      if (v !== null) out[k] = JSON.parse(v);
    } catch { /* üres tár */ }
  }
  return out;
}

export async function set(obj) {
  if (area) return area.set(obj);
  for (const [k, v] of Object.entries(obj)) {
    try { localStorage.setItem('gp:' + k, JSON.stringify(v)); } catch { /* tele vagy tiltva */ }
  }
}

export async function remove(keys) {
  if (area) return area.remove(keys);
  for (const k of keys) {
    try { localStorage.removeItem('gp:' + k); } catch { /* tiltva */ }
  }
}

export function onChange(fn) {
  if (area) chrome.storage.onChanged.addListener((changes, name) => { if (name === 'local') fn(changes); });
}
