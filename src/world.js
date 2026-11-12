// Chunk-Verwaltung im Hauptthread: fordert Meshes beim Worker an, hält Blockdaten für Kollision.
import { CS, CH } from './worldgen.js';
import { createService } from './chunkservice.js';
const key = (x, z) => x + ',' + z;
export class World {
  constructor(renderer, cfg) {
    this.r = renderer; this.chunks = new Map(); this.list = []; this.pending = 0; this.offsets = []; this.radius = -1; this.tick = 0;
    this.cfg = cfg; this.sent = [];
    try {
      this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => { if (e.data.type === 'ready') { this.workerOk = true; clearTimeout(this.wt); } else this.onMesh(e.data); };
      this.worker.onerror = () => this.useLocal();
      this.wt = setTimeout(() => { if (!this.workerOk) this.useLocal(); }, 4000);
    } catch { this.useLocal(); }
    this.post({ type: 'init', cfg });
  }
  post(m) { if (!this.workerOk && !this.local) this.sent.push(m); if (this.local) setTimeout(() => this.local(m), 0); else this.worker.postMessage(m); }
  // Ersatz, falls Module-Worker nicht verfügbar sind (z. B. ältere WebViews): Chunks im Hauptthread erzeugen
  useLocal() {
    if (this.local || this.workerOk) return;
    clearTimeout(this.wt);
    try { this.worker?.terminate(); } catch { /* egal */ }
    this.local = createService((m) => this.onMesh(m));
    const q = this.sent; this.sent = [];
    q.forEach((m, i) => setTimeout(() => this.local(m), i * 4));
  }
  onMesh(d) {
    const c = this.chunks.get(key(d.cx, d.cz));
    if (!c) return;
    if (!c.ready) this.pending--;
    c.blocks = d.blocks; c.ready = true;
    this.r.uploadChunk(c, d);
  }
  update(px, pz, radius) {
    if (radius !== this.radius) {
      this.radius = radius; this.offsets = [];
      for (let z = -radius; z <= radius; z++) for (let x = -radius; x <= radius; x++) if (x * x + z * z <= (radius + 0.5) ** 2) this.offsets.push([x, z, x * x + z * z]);
      this.offsets.sort((a, b) => a[2] - b[2]);
    }
    const ccx = Math.floor(px / CS), ccz = Math.floor(pz / CS);
    let missing = 0;
    for (const o of this.offsets) {
      const cx = ccx + o[0], cz = ccz + o[1], k = key(cx, cz);
      const c = this.chunks.get(k);
      if (c) { if (!c.ready) missing++; continue; }
      missing++;
      if (this.pending >= 6) continue;
      const nc = { cx, cz, ready: false, blocks: null, opaque: null, water: null, tufts: null, dist: 0 };
      this.chunks.set(k, nc); this.list.push(nc); this.pending++;
      this.post({ type: 'mesh', cx, cz });
    }
    this.missing = missing;
    if (++this.tick % 120 === 0) {
      let changed = false;
      for (const [k, c] of this.chunks) {
        if (c.ready && Math.max(Math.abs(c.cx - ccx), Math.abs(c.cz - ccz)) > radius + 2) { this.r.freeChunk(c); this.chunks.delete(k); changed = true; }
      }
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
  isLoaded(x, z) { const c = this.chunks.get(key(Math.floor(x / CS), Math.floor(z / CS))); return !!(c && c.ready); }
  setBlock(x, y, z, b) {
    if (y < 1 || y >= CH) return;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS), c = this.chunks.get(key(cx, cz));
    if (!c || !c.blocks) return;
    c.blocks[(x - cx * CS) + (z - cz * CS) * CS + y * CS * CS] = b;
    const loaded = []; for (const [k, ch] of this.chunks) if (ch.ready) loaded.push(k);
    this.post({ type: 'set', x, y, z, b, loaded });
  }
}
