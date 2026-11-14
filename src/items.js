// Items, Werkzeuge, Rezepte, Schmelzen, Drops und Icons.
import { B, BLOCKS } from './blocks.js';
export const I = { STICK: 256, COAL: 257, IRON: 258, DIAMOND: 259, APPLE: 260, MEAT_RAW: 261, MEAT_COOKED: 262, TOOL: 300 };
export const MATS = [
  { name: 'Holz', color: '#b98a4e', tier: 1, speed: 2, dur: 50, src: B.PLANKS },
  { name: 'Stein', color: '#8d9198', tier: 2, speed: 4, dur: 120, src: B.STONE },
  { name: 'Eisen', color: '#dfe2e7', tier: 3, speed: 6, dur: 250, src: I.IRON },
  { name: 'Diamant', color: '#5fe0e6', tier: 4, speed: 8, dur: 1000, src: I.DIAMOND },
];
export const TYPES = [{ key: 'pick', name: 'spitzhacke' }, { key: 'axe', name: 'axt' }, { key: 'shovel', name: 'schaufel' }, { key: 'sword', name: 'schwert' }];
export const toolId = (mat, type) => I.TOOL + mat * 4 + type;

export const ITEMS = {};
BLOCKS.forEach((b, id) => { if (b && b.cat) ITEMS[id] = { id, name: b.name, stack: 64, cat: b.cat, block: true, color: [0.5, 0.5, 0.5] }; });
const add = (id, name, cat, o = {}) => { ITEMS[id] = { id, name, stack: 64, cat, color: [0.6, 0.6, 0.6], ...o }; };
add(I.STICK, 'Stock', 'Material', { color: [0.55, 0.38, 0.2] });
add(I.COAL, 'Kohle', 'Material', { color: [0.1, 0.1, 0.11] });
add(I.IRON, 'Eisenbarren', 'Material', { color: [0.82, 0.83, 0.86] });
add(I.DIAMOND, 'Diamant', 'Material', { color: [0.35, 0.85, 0.9] });
add(I.APPLE, 'Apfel', 'Nahrung', { food: 4, color: [0.85, 0.15, 0.12] });
add(I.MEAT_RAW, 'Rohes Fleisch', 'Nahrung', { food: 3, color: [0.85, 0.45, 0.45] });
add(I.MEAT_COOKED, 'Gebratenes Fleisch', 'Nahrung', { food: 8, color: [0.55, 0.3, 0.15] });
MATS.forEach((m, mi) => TYPES.forEach((t, ti) => add(toolId(mi, ti), m.name + t.name, 'Werkzeuge', {
  stack: 1, color: [0.6, 0.6, 0.6],
  tool: { type: t.key, tier: m.tier, speed: m.speed, dur: m.dur, dmg: t.key === 'sword' ? 3 + m.tier : t.key === 'axe' ? 2 + m.tier : 1 + m.tier * 0.5, mat: mi, ti },
})));
export const CATEGORIES = ['Alle', 'Natur', 'Baustoffe', 'Nützliches', 'Werkzeuge', 'Nahrung', 'Material'];

// ---- Rezepte (Muster wird auf seine Bounding-Box zugeschnitten verglichen, auch gespiegelt) ----
const rec = (out, n, p, k) => ({ out, n, p: p.map((row) => [...row].map((ch) => (ch === ' ' ? 0 : k[ch]))) });
export const RECIPES = [
  rec(B.PLANKS, 4, ['L'], { L: B.LOG }),
  rec(I.STICK, 4, ['P', 'P'], { P: B.PLANKS }),
  rec(B.WORKBENCH, 1, ['PP', 'PP'], { P: B.PLANKS }),
  rec(B.FURNACE, 1, ['SSS', 'S S', 'SSS'], { S: B.STONE }),
  rec(B.BED, 1, ['LLL', 'PPP'], { L: B.LEAVES, P: B.PLANKS }),
  rec(B.BRICKS, 4, ['SS', 'SS'], { S: B.STONE }),
];
MATS.forEach((m, mi) => {
  const k = { M: m.src, S: I.STICK };
  RECIPES.push(rec(toolId(mi, 0), 1, ['MMM', ' S ', ' S '], k), rec(toolId(mi, 1), 1, ['MM', 'MS', ' S'], k), rec(toolId(mi, 2), 1, ['M', 'S', 'S'], k), rec(toolId(mi, 3), 1, ['M', 'M', 'S'], k));
});
export function matchRecipe(grid, size) { // grid: Array von Item-IDs (0 = leer)
  let x0 = size, x1 = -1, y0 = size, y1 = -1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (grid[y * size + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  for (const r of RECIPES) {
    if (r.p.length !== h || r.p[0].length !== w) continue;
    for (const flip of [false, true]) {
      let ok = true;
      for (let y = 0; y < h && ok; y++) for (let x = 0; x < w; x++) if (r.p[y][flip ? w - 1 - x : x] !== grid[(y0 + y) * size + x0 + x]) { ok = false; break; }
      if (ok) return r;
    }
  }
  return null;
}
export const SMELT = { [B.ORE]: I.IRON, [I.MEAT_RAW]: I.MEAT_COOKED, [B.LOG]: I.COAL };
export const FUEL = { [I.COAL]: 1600, [B.LOG]: 300, [B.PLANKS]: 300, [I.STICK]: 100 }; // Brenndauer in Ticks
export const SMELT_TICKS = 160;

export function breakTime(block, tool) {
  const d = BLOCKS[block], match = !!tool && tool.type === d.tool;
  const can = d.tier === 0 || (match && tool.tier >= d.tier);
  return d.h * (match ? 1.5 / tool.speed : 1.5) * (can ? 1 : 3.3);
}
export function dropFor(block, tool) {
  const d = BLOCKS[block];
  if (d.tier > 0 && !(tool && tool.type === d.tool && tool.tier >= d.tier)) return null;
  if (block === B.GRASS) return [B.DIRT, 1];
  if (block === B.COAL_ORE) return [I.COAL, 1];
  if (block === B.DIAMOND_ORE) return [I.DIAMOND, 1];
  if (block === B.LEAVES) { const r = Math.random(); return r < 0.08 ? [I.APPLE, 1] : r < 0.2 ? [I.STICK, 1] : null; }
  return [block, 1];
}

// ---- Icons (alles selbst gezeichnet) ----
const cache = {};
let tex = null, texRes = 64;
export function initIcons(buf, res) { tex = new Uint8Array(buf); texRes = res; }
function face(layer) {
  const c = document.createElement('canvas'); c.width = c.height = texRes;
  const img = new ImageData(texRes, texRes), off = layer * texRes * texRes * 4, cut = layer === BLOCKS[B.LEAVES].faces[0];
  for (let k = 0; k < texRes * texRes; k++) {
    const hole = cut && tex[off + k * 4 + 3] < 100;
    img.data[k * 4] = hole ? 14 : tex[off + k * 4]; img.data[k * 4 + 1] = hole ? 34 : tex[off + k * 4 + 1]; img.data[k * 4 + 2] = hole ? 12 : tex[off + k * 4 + 2]; img.data[k * 4 + 3] = 255;
  }
  c.getContext('2d').putImageData(img, 0, 0); return c;
}
function toolIcon(g, t) {
  const col = MATS[t.mat].color;
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = '#3d2712'; g.lineWidth = 7; g.beginPath(); g.moveTo(11, 53); g.lineTo(t.type === 'sword' ? 22 : 44, t.type === 'sword' ? 42 : 20); g.stroke();
  g.strokeStyle = '#8a5a2b'; g.lineWidth = 4; g.stroke();
  g.fillStyle = col; g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 2; g.beginPath();
  if (t.type === 'pick') { g.moveTo(22, 10); g.quadraticCurveTo(48, 10, 56, 38); g.lineTo(50, 36); g.quadraticCurveTo(42, 20, 24, 17); g.closePath(); }
  else if (t.type === 'axe') { g.moveTo(34, 12); g.lineTo(52, 8); g.quadraticCurveTo(60, 20, 54, 32); g.lineTo(42, 26); g.closePath(); }
  else if (t.type === 'shovel') { g.moveTo(40, 12); g.quadraticCurveTo(54, 6, 58, 10); g.quadraticCurveTo(60, 20, 52, 26); g.lineTo(38, 24); g.closePath(); }
  else { g.moveTo(24, 36); g.lineTo(50, 8); g.lineTo(58, 6); g.lineTo(56, 14); g.lineTo(28, 40); g.closePath(); }
  g.fill(); g.stroke();
  if (t.type === 'sword') { g.strokeStyle = '#3d2712'; g.lineWidth = 5; g.beginPath(); g.moveTo(17, 33); g.lineTo(31, 47); g.stroke(); }
}
export function iconURL(id) {
  if (cache[id]) return cache[id];
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), it = ITEMS[id];
  if (it.block && tex) {
    const f = BLOCKS[id].faces, S = texRes, a = 29 / S, b = 14.5 / S, hgt = 30 / S;
    g.imageSmoothingEnabled = true;
    g.setTransform(a, b, -a, b, 32, 2); g.drawImage(face(f[2]), 0, 0);
    g.setTransform(a, b, 0, hgt, 3, 16.5); g.drawImage(face(f[5]), 0, 0); g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, 0, S, S);
    g.setTransform(a, -b, 0, hgt, 32, 31); g.drawImage(face(f[0]), 0, 0); g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, S, S);
    g.setTransform(1, 0, 0, 1, 0, 0);
  } else if (it.tool) toolIcon(g, it.tool);
  else {
    g.lineJoin = 'round'; g.lineWidth = 2.5; g.strokeStyle = 'rgba(0,0,0,.6)';
    const poly = (pts, fill) => { g.fillStyle = fill; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill(); g.stroke(); };
    if (id === I.STICK) { g.lineCap = 'round'; g.strokeStyle = '#3d2712'; g.lineWidth = 9; g.beginPath(); g.moveTo(14, 50); g.lineTo(50, 14); g.stroke(); g.strokeStyle = '#96642f'; g.lineWidth = 5; g.stroke(); }
    else if (id === I.COAL) { poly([[14, 30], [26, 14], [44, 16], [54, 32], [46, 50], [24, 52]], '#17171a'); poly([[26, 22], [38, 20], [34, 30]], '#3a3a40'); }
    else if (id === I.IRON) { poly([[8, 40], [20, 22], [56, 22], [50, 40]], '#e3e6ea'); poly([[8, 40], [50, 40], [50, 48], [8, 48]], '#a3a8b0'); }
    else if (id === I.DIAMOND) { poly([[32, 56], [8, 26], [20, 10], [44, 10], [56, 26]], '#58dbe3'); poly([[20, 10], [44, 10], [38, 26], [26, 26]], '#b9f6f8'); poly([[26, 26], [38, 26], [32, 56]], '#8feef2'); }
    else if (id === I.APPLE) { g.fillStyle = '#d82a22'; g.beginPath(); g.arc(32, 37, 19, 0, 7); g.fill(); g.stroke(); g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(25, 30, 5, 0, 7); g.fill(); g.strokeStyle = '#4a2b12'; g.lineWidth = 4; g.beginPath(); g.moveTo(32, 20); g.lineTo(35, 9); g.stroke(); poly([[36, 14], [48, 8], [46, 18]], '#4fa52a'); }
    else { // Fleisch: Keule mit Knochen
      const cooked = id === I.MEAT_COOKED;
      g.lineCap = 'round'; g.strokeStyle = '#f1ead8'; g.lineWidth = 7; g.beginPath(); g.moveTo(40, 40); g.lineTo(54, 54); g.stroke();
      g.fillStyle = '#f1ead8'; g.beginPath(); g.arc(52, 57, 4.5, 0, 7); g.arc(57, 52, 4.5, 0, 7); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 2.5; g.fillStyle = cooked ? '#8a4a1c' : '#e0706c'; g.beginPath(); g.ellipse(27, 27, 20, 16, Math.PI / 4, 0, 7); g.fill(); g.stroke();
      g.fillStyle = cooked ? '#b56a2c' : '#f3a09a'; g.beginPath(); g.ellipse(23, 23, 9, 6, Math.PI / 4, 0, 7); g.fill();
    }
  }
  return (cache[id] = c.toDataURL());
}
