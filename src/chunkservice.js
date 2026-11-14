// Chunk-Dienst: erzeugt Chunks und Meshes. Läuft normalerweise im Worker, notfalls im Hauptthread.
import { configure, generateChunk, CS, CH } from './worldgen.js';
import { meshChunk } from './mesher.js';
export function createService(post) {
  const chunks = new Map(), edited = new Set();
  const key = (x, z) => x + ',' + z;
  const EMPTY = new Uint8Array(CS * CS * CH); let remote = false;
  let edits = {}; // gespeicherte Änderungen des Spielers: Chunk-Schlüssel -> [Index, Block, …]
  const get = (cx, cz) => {
    const k = key(cx, cz); let c = chunks.get(k);
    if (!c && remote) return EMPTY; // Chunks kommen vom Server; fehlende Nachbarn gelten als Luft
    if (!c) { c = generateChunk(cx, cz); const e = edits[k]; if (e) { for (let i = 0; i < e.length; i += 2) c[e[i]] = e[i + 1]; edited.add(k); } chunks.set(k, c); }
    return c;
  };
  const send = (cx, cz) => {
    const m = meshChunk(get, cx, cz), blocks = get(cx, cz).slice();
    post({ type: 'mesh', cx, cz, blocks, opaque: m.opaque, water: m.water, tufts: m.tufts }, [blocks.buffer, m.opaque.buffer, m.water.buffer, m.tufts.buffer]);
  };
  return (d) => {
    if (d.type === 'init') { configure(d.cfg); edits = d.cfg.edits || {}; remote = !!d.cfg.remote; }
    else if (d.type === 'chunk') chunks.set(key(d.cx, d.cz), d.blocks);
    else if (d.type === 'mesh') send(d.cx, d.cz);
    else if (d.type === 'set') {
      const cx = Math.floor(d.x / CS), cz = Math.floor(d.z / CS), lx = d.x - cx * CS, lz = d.z - cz * CS;
      if (d.y < 0 || d.y >= CH) return;
      const tc = get(cx, cz); if (tc === EMPTY) return;
      tc[lx + lz * CS + d.y * CS * CS] = d.b; if (!remote) edited.add(key(cx, cz));
      for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
        if ((ox < 0 && lx > 0) || (ox > 0 && lx < CS - 1) || (oz < 0 && lz > 0) || (oz > 0 && lz < CS - 1)) continue;
        if (d.loaded.includes(key(cx + ox, cz + oz))) send(cx + ox, cz + oz);
      }
    } else if (d.type === 'drop') {
      for (const k of chunks.keys()) {
        if (edited.has(k)) continue;
        const [x, z] = k.split(',').map(Number);
        if (Math.max(Math.abs(x - d.cx), Math.abs(z - d.cz)) > d.r) chunks.delete(k);
      }
    }
  };
}
