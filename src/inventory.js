// Inventar: 9 Hotbar-Slots (0–8) + 27 Slots, Stapel bis 64.
import { ITEMS } from './items.js';
export const mk = (id, n = 1, d) => { const s = { id, n }; const t = ITEMS[id].tool; if (t) s.d = d ?? t.dur; return s; };
export class Inventory {
  constructor(n = 36) { this.slots = new Array(n).fill(null); }
  // legt Items ab, liefert den Rest, der nicht mehr passt
  add(id, n = 1, d) {
    const max = ITEMS[id].stack;
    if (max > 1) for (const s of this.slots) { if (n <= 0) break; if (s && s.id === id && s.n < max) { const k = Math.min(n, max - s.n); s.n += k; n -= k; } }
    for (let i = 0; i < this.slots.length && n > 0; i++) if (!this.slots[i]) { const k = Math.min(n, max); this.slots[i] = mk(id, k, d); n -= k; }
    return n;
  }
  take(i, n = 1) { const s = this.slots[i]; if (!s) return; s.n -= n; if (s.n <= 0) this.slots[i] = null; }
  toJSON() { return this.slots; }
  load(a) { this.slots = (a || []).map((s) => (s && ITEMS[s.id] ? { ...s } : null)); while (this.slots.length < 36) this.slots.push(null); }
}
