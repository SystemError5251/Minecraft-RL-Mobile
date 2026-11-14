// Server-Kern im Web Worker: Einzelspieler und Host für Mitspieler. Jede Verbindung ist ein MessagePort.
import { GameServer } from './server';
declare const self: any;
let server: GameServer | null = null, timer: any = 0, paused = false;
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((res) => { try { const r = indexedDB.open('kantenhain', 1); r.onupgradeneeded = () => r.result.createObjectStore('worlds', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch { res(null); } });
}
const dbp = openDb();
self.onmessage = (e: MessageEvent) => {
  const d = e.data;
  if (d.type === 'start') {
    server = new GameServer(d.rec, {
      save: (rec) => { dbp.then((db) => { if (db) db.transaction('worlds', 'readwrite').objectStore('worlds').put(rec); self.postMessage({ type: 'saved' }); }); },
      log: () => {},
    }, { maxPlayers: d.maxPlayers || 4, whitelist: null, ops: [], viewDistance: 14 });
    let last = performance.now(), acc = 0;
    timer = setInterval(() => { // feste 20 Ticks pro Sekunde, Rückstand begrenzt aufholen
      const now = performance.now(); acc += now - last; last = now; let n = 0;
      let joined = 0; for (const p of server!.players.values()) if (p.joined) joined++;
      if (paused && joined <= 1) { acc = 0; return; } // Pause nur, solange niemand mitspielt
      while (acc >= 50 && n++ < 4) { server!.tick(); acc -= 50; }
      if (acc >= 50) acc = 0;
    }, 25);
    self.postMessage({ type: 'started' });
  } else if (d.type === 'conn' && server) {
    const port: MessagePort = d.port, c = server.connect((buf) => port.postMessage(buf), !!d.local); // kopieren statt übertragen: Rundsendungen teilen sich einen Puffer
    port.onmessage = (m) => { if (m.data === 'close') { c.close(); port.close(); } else c.recv(m.data); };
  } else if (d.type === 'save' && server) server.save();
  else if (d.type === 'cheats' && server) server.cheats = !!d.on;
  else if (d.type === 'pause') paused = !!d.on;
};
