// Client-Welt: bekommt Chunks vom Server, lässt sie im Worker vermeshen und hält Blockdaten für Kollision.
import { CS, CH } from './worldgen.js';
import { createService } from './chunkservice.js';
const key = (x, z) => x + ',' + z;
export class World {
  constructor(renderer, cfg) { // cfg: { seed, scene }
    this.r = renderer; this.chunks = new Map(); this.list = []; this.tick = 0; this.missing = 1; this.sent = [];
    try {
      this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => { if (e.data.type === 'ready') { this.workerOk = true; clearTimeout(this.wt); } else this.onMesh(e.data); };
      this.worker.onerror = () => this.useLocal();
      this.wt = setTimeout(() => { if (!this.workerOk) this.useLocal(); }, 4000);
    } catch { this.useLocal(); }
    this.post({ type: 'init', cfg: { ...cfg, remote: true } });
  }
  post(m) { if (!this.workerOk && !this.local) this.sent.push(m); if (this.local) setTimeout(() => this.local(m), 0); else this.worker.postMessage(m); }
  // Ersatz, falls Module-Worker nicht verfügbar sind (z. B. ältere WebViews): Meshes im Hauptthread erzeugen
  useLocal() {
    if (this.local || this.workerOk) return;
    clearTimeout(this.wt);
    try { this.worker?.terminate(); } catch { /* egal */ }
    this.local = createService((m) => this.onMesh(m));
    const q = this.sent; this.sent = [];
    q.forEach((m, i) => setTimeout(() => this.local(m), i * 4));
  }
  destroy() { try { this.worker?.terminate(); } catch { /* egal */ } for (const c of this.chunks.values()) this.r.freeChunk(c); }
  // Chunk vom Server; vermesht wird erst, wenn alle acht Nachbarn da sind (sonst fehlen Schatten/AO an den Rändern)
  addChunk(cx, cz, blocks) {
    const k = key(cx, cz); let c = this.chunks.get(k);
    if (!c) { c = { cx, cz, ready: false, requested: false, blocks: null, opaque: null, water: null, tufts: null, dist: 0 }; this.chunks.set(k, c); this.list.push(c); }
    c.blocks = blocks; c.requested = false;
    this.post({ type: 'chunk', cx, cz, blocks: blocks.slice() });
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.tryMesh(this.chunks.get(key(cx + dx, cz + dz)));
  }
  tryMesh(c) {
    if (!c || c.requested) return;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.chunks.has(key(c.cx + dx, c.cz + dz))) return;
    c.requested = true; this.post({ type: 'mesh', cx: c.cx, cz: c.cz });
  }
  onMesh(d) {
    const c = this.chunks.get(key(d.cx, d.cz));
    if (!c) return;
    c.ready = true; this.r.uploadChunk(c, d);
  }
  update(px, pz, radius) {
    const ccx = Math.floor(px / CS), ccz = Math.floor(pz / CS);
    let missing = 0;
    for (let z = -radius; z <= radius; z++) for (let x = -radius; x <= radius; x++) {
      if (x * x + z * z > (radius + 0.5) ** 2) continue;
      const c = this.chunks.get(key(ccx + x, ccz + z));
      if (!c || !c.ready) missing++;
    }
    this.missing = missing;
    if (++this.tick % 120 === 0) {
      let changed = false;
      for (const [k, c] of this.chunks) if (Math.max(Math.abs(c.cx - ccx), Math.abs(c.cz - ccz)) > radius + 4) { this.r.freeChunk(c); this.chunks.delete(k); changed = true; }
      if (changed) this.list = [...this.chunks.values()];
      this.post({ type: 'drop', cx: ccx, cz: ccz, r: radius + 4 });
    }
  }
  getBlock(x, y, z) {
    if (y < 0) return 3; if (y >= CH) return 0;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS), c = this.chunks.get(key(cx, cz));
    if (!c || !c.blocks) return 0;
    return c.blocks[(x - cx * CS) + (z - cz * CS) * CS + y * CS * CS];
  }
  isLoaded(x, z) { const c = this.chunks.get(key(Math.floor(x / CS), Math.floor(z / CS))); return !!(c && c.blocks); }
  setBlock(x, y, z, b) { // Blockänderung (vom Server bestätigt oder lokal vorweggenommen)
    if (y < 0 || y >= CH) return;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS), c = this.chunks.get(key(cx, cz));
    if (!c || !c.blocks) return;
    const i = (x - cx * CS) + (z - cz * CS) * CS + y * CS * CS;
    if (c.blocks[i] === b) return;
    c.blocks[i] = b;
    const loaded = []; for (const [ck, ch] of this.chunks) if (ch.ready && Math.abs(ch.cx - cx) <= 1 && Math.abs(ch.cz - cz) <= 1) loaded.push(ck);
    this.post({ type: 'set', x, y, z, b, loaded });
  }
}
