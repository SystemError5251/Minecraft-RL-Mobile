// Welten in IndexedDB (ein Datensatz pro Welt). Ohne IndexedDB (z. B. privater Modus) bleibt alles nur im Speicher.
let dbp = null;
const mem = new Map();
function db() {
  if (!dbp) dbp = new Promise((res) => {
    try {
      const r = indexedDB.open('kantenhain', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('worlds', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  if (!d) return fn(null);
  return new Promise((res, rej) => { const t = d.transaction('worlds', mode), q = fn(t.objectStore('worlds')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); });
}
export const persistent = async () => !!(await db());
export const listWorlds = async () => ((await tx('readonly', (s) => (s ? s.getAll() : { result: [...mem.values()] }))) || [...mem.values()]).sort((a, b) => b.played - a.played);
export const loadWorld = (id) => tx('readonly', (s) => (s ? s.get(id) : { result: mem.get(id) })).then((r) => r || mem.get(id));
export const saveWorld = (rec) => tx('readwrite', (s) => (s ? s.put(rec) : (mem.set(rec.id, rec), null)));
export const deleteWorld = (id) => tx('readwrite', (s) => (s ? s.delete(id) : (mem.delete(id), null)));
