// server/index.ts
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { WebSocketServer } from "ws";

// src/texlayers.js
var LAYERS = [
  "grass_top",
  "grass_side",
  "dirt",
  "stone",
  "sand",
  "log_side",
  "log_top",
  "leaves",
  "water",
  "basalt",
  "basalt_gold",
  "basalt_violet",
  "basalt_teal",
  "bricks",
  "ore",
  "tuft_grass",
  "tuft_tall",
  "flower_red",
  "flower_white",
  "flower_yellow",
  "flower_pink",
  "reed",
  "planks",
  "workbench_top",
  "workbench_side",
  "furnace_front",
  "furnace_top",
  "coal_ore",
  "diamond_ore",
  "bed_top",
  "bed_side"
];
var L = Object.fromEntries(LAYERS.map((n, i) => [n, i]));

// src/blocks.js
var B = { AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, LOG: 5, LEAVES: 6, WATER: 7, BASALT: 8, BASALT_GOLD: 9, BASALT_VIOLET: 10, BASALT_TEAL: 11, BRICKS: 12, ORE: 13, PLANKS: 14, WORKBENCH: 15, FURNACE: 16, COAL_ORE: 17, DIAMOND_ORE: 18, BED: 19 };
var def = (name, faces, o = {}) => ({ name, faces: Array.isArray(faces) ? faces : [faces, faces, faces, faces, faces, faces], h: 1, tool: null, tier: 0, cat: "Baustoffe", ...o });
var tsb = (top, side, bottom) => [side, side, top, bottom, side, side];
var BLOCKS = [
  null,
  def("Gras", tsb(L.grass_top, L.grass_side, L.dirt), { h: 0.6, tool: "shovel", cat: "Natur" }),
  def("Erde", L.dirt, { h: 0.5, tool: "shovel", cat: "Natur" }),
  def("Stein", L.stone, { h: 1.6, tool: "pick", tier: 1, cat: "Natur" }),
  def("Sand", L.sand, { h: 0.5, tool: "shovel", cat: "Natur" }),
  def("Baumstamm", tsb(L.log_top, L.log_side, L.log_top), { h: 1.4, tool: "axe", cat: "Natur" }),
  def("Laub", L.leaves, { h: 0.2, cat: "Natur" }),
  def("Wasser", L.water, { cat: null }),
  def("Basalt", L.basalt, { h: 2.4, tool: "pick", tier: 1, cat: "Natur" }),
  def("Goldader-Basalt", L.basalt_gold, { h: 2.6, tool: "pick", tier: 2 }),
  def("Violettader-Basalt", L.basalt_violet, { h: 2.6, tool: "pick", tier: 2 }),
  def("T\xFCrkisader-Basalt", L.basalt_teal, { h: 2.6, tool: "pick", tier: 2 }),
  def("Polierte Steinziegel", L.bricks, { h: 2, tool: "pick", tier: 1 }),
  def("Eisenerz", L.ore, { h: 2.4, tool: "pick", tier: 2, cat: "Natur" }),
  def("Bretter", L.planks, { h: 1, tool: "axe" }),
  def("Werkbank", tsb(L.workbench_top, L.workbench_side, L.planks), { h: 1.2, tool: "axe", cat: "N\xFCtzliches" }),
  def("Ofen", [L.furnace_top, L.furnace_top, L.furnace_top, L.furnace_top, L.furnace_front, L.furnace_front], { h: 2.2, tool: "pick", tier: 1, cat: "N\xFCtzliches" }),
  def("Kohleerz", L.coal_ore, { h: 2, tool: "pick", tier: 1, cat: "Natur" }),
  def("Diamanterz", L.diamond_ore, { h: 3, tool: "pick", tier: 3, cat: "Natur" }),
  def("Bett", tsb(L.bed_top, L.bed_side, L.planks), { h: 0.5, tool: "axe", cat: "N\xFCtzliches" })
];
var FACE_LAYER = new Uint8Array(BLOCKS.length * 6);
BLOCKS.forEach((b, i) => {
  if (b) FACE_LAYER.set(b.faces, i * 6);
});
var isSolid = (b) => b !== 0 && b !== B.WATER;

// src/items.js
var I = { STICK: 256, COAL: 257, IRON: 258, DIAMOND: 259, APPLE: 260, MEAT_RAW: 261, MEAT_COOKED: 262, TOOL: 300 };
var MATS = [
  { name: "Holz", color: "#b98a4e", tier: 1, speed: 2, dur: 50, src: B.PLANKS },
  { name: "Stein", color: "#8d9198", tier: 2, speed: 4, dur: 120, src: B.STONE },
  { name: "Eisen", color: "#dfe2e7", tier: 3, speed: 6, dur: 250, src: I.IRON },
  { name: "Diamant", color: "#5fe0e6", tier: 4, speed: 8, dur: 1e3, src: I.DIAMOND }
];
var TYPES = [{ key: "pick", name: "spitzhacke" }, { key: "axe", name: "axt" }, { key: "shovel", name: "schaufel" }, { key: "sword", name: "schwert" }];
var toolId = (mat, type) => I.TOOL + mat * 4 + type;
var ITEMS = {};
BLOCKS.forEach((b, id) => {
  if (b && b.cat) ITEMS[id] = { id, name: b.name, stack: 64, cat: b.cat, block: true, color: [0.5, 0.5, 0.5] };
});
var add = (id, name, cat, o = {}) => {
  ITEMS[id] = { id, name, stack: 64, cat, color: [0.6, 0.6, 0.6], ...o };
};
add(I.STICK, "Stock", "Material", { color: [0.55, 0.38, 0.2] });
add(I.COAL, "Kohle", "Material", { color: [0.1, 0.1, 0.11] });
add(I.IRON, "Eisenbarren", "Material", { color: [0.82, 0.83, 0.86] });
add(I.DIAMOND, "Diamant", "Material", { color: [0.35, 0.85, 0.9] });
add(I.APPLE, "Apfel", "Nahrung", { food: 4, color: [0.85, 0.15, 0.12] });
add(I.MEAT_RAW, "Rohes Fleisch", "Nahrung", { food: 3, color: [0.85, 0.45, 0.45] });
add(I.MEAT_COOKED, "Gebratenes Fleisch", "Nahrung", { food: 8, color: [0.55, 0.3, 0.15] });
MATS.forEach((m, mi) => TYPES.forEach((t, ti) => add(toolId(mi, ti), m.name + t.name, "Werkzeuge", {
  stack: 1,
  color: [0.6, 0.6, 0.6],
  tool: { type: t.key, tier: m.tier, speed: m.speed, dur: m.dur, dmg: t.key === "sword" ? 3 + m.tier : t.key === "axe" ? 2 + m.tier : 1 + m.tier * 0.5, mat: mi, ti }
})));
var rec = (out, n, p, k) => ({ out, n, p: p.map((row) => [...row].map((ch) => ch === " " ? 0 : k[ch])) });
var RECIPES = [
  rec(B.PLANKS, 4, ["L"], { L: B.LOG }),
  rec(I.STICK, 4, ["P", "P"], { P: B.PLANKS }),
  rec(B.WORKBENCH, 1, ["PP", "PP"], { P: B.PLANKS }),
  rec(B.FURNACE, 1, ["SSS", "S S", "SSS"], { S: B.STONE }),
  rec(B.BED, 1, ["LLL", "PPP"], { L: B.LEAVES, P: B.PLANKS }),
  rec(B.BRICKS, 4, ["SS", "SS"], { S: B.STONE })
];
MATS.forEach((m, mi) => {
  const k = { M: m.src, S: I.STICK };
  RECIPES.push(rec(toolId(mi, 0), 1, ["MMM", " S ", " S "], k), rec(toolId(mi, 1), 1, ["MM", "MS", " S"], k), rec(toolId(mi, 2), 1, ["M", "S", "S"], k), rec(toolId(mi, 3), 1, ["M", "M", "S"], k));
});
function matchRecipe(grid, size) {
  let x0 = size, x1 = -1, y0 = size, y1 = -1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (grid[y * size + x]) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  for (const r of RECIPES) {
    if (r.p.length !== h || r.p[0].length !== w) continue;
    for (const flip of [false, true]) {
      let ok = true;
      for (let y = 0; y < h && ok; y++) for (let x = 0; x < w; x++) if (r.p[y][flip ? w - 1 - x : x] !== grid[(y0 + y) * size + x0 + x]) {
        ok = false;
        break;
      }
      if (ok) return r;
    }
  }
  return null;
}
var SMELT = { [B.ORE]: I.IRON, [I.MEAT_RAW]: I.MEAT_COOKED, [B.LOG]: I.COAL };
var FUEL = { [I.COAL]: 1600, [B.LOG]: 300, [B.PLANKS]: 300, [I.STICK]: 100 };
var SMELT_TICKS = 160;
function breakTime(block2, tool) {
  const d = BLOCKS[block2], match = !!tool && tool.type === d.tool;
  const can = d.tier === 0 || match && tool.tier >= d.tier;
  return d.h * (match ? 1.5 / tool.speed : 1.5) * (can ? 1 : 3.3);
}
function dropFor(block2, tool) {
  const d = BLOCKS[block2];
  if (d.tier > 0 && !(tool && tool.type === d.tool && tool.tier >= d.tier)) return null;
  if (block2 === B.GRASS) return [B.DIRT, 1];
  if (block2 === B.COAL_ORE) return [I.COAL, 1];
  if (block2 === B.DIAMOND_ORE) return [I.DIAMOND, 1];
  if (block2 === B.LEAVES) {
    const r = Math.random();
    return r < 0.08 ? [I.APPLE, 1] : r < 0.2 ? [I.STICK, 1] : null;
  }
  return [block2, 1];
}

// src/inventory.js
var mk = (id, n = 1, d) => {
  const s = { id, n };
  const t = ITEMS[id].tool;
  if (t) s.d = d ?? t.dur;
  return s;
};
var Inventory = class {
  constructor(n = 36) {
    this.slots = new Array(n).fill(null);
  }
  // legt Items ab, liefert den Rest, der nicht mehr passt
  add(id, n = 1, d) {
    const max = ITEMS[id].stack;
    if (max > 1) for (const s of this.slots) {
      if (n <= 0) break;
      if (s && s.id === id && s.n < max) {
        const k = Math.min(n, max - s.n);
        s.n += k;
        n -= k;
      }
    }
    for (let i = 0; i < this.slots.length && n > 0; i++) if (!this.slots[i]) {
      const k = Math.min(n, max);
      this.slots[i] = mk(id, k, d);
      n -= k;
    }
    return n;
  }
  take(i, n = 1) {
    const s = this.slots[i];
    if (!s) return;
    s.n -= n;
    if (s.n <= 0) this.slots[i] = null;
  }
  toJSON() {
    return this.slots;
  }
  load(a) {
    this.slots = (a || []).map((s) => s && ITEMS[s.id] ? { ...s } : null);
    while (this.slots.length < 36) this.slots.push(null);
  }
};

// src/noise.js
function hash2(x, y, s) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177) | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function hash3(x, y, z, s) {
  return hash2(x + Math.imul(z, 7919), y + Math.imul(z, 104729), s);
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x, y, s, oct) {
  let a = 0.5, sum = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    sum += a * vnoise(x, y, s + i * 17);
    n += a;
    a *= 0.5;
    x *= 2;
    y *= 2;
  }
  return sum / n;
}
var smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function vnoise3(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = x - xi, fy = y - yi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const p = (i, j, k) => hash3(xi + i, yi + j, zi + k, s);
  return l(l(l(p(0, 0, 0), p(1, 0, 0), sx), l(p(0, 1, 0), p(1, 1, 0), sx), sy), l(l(p(0, 0, 1), p(1, 0, 1), sx), l(p(0, 1, 1), p(1, 1, 1), sx), sy), sz);
}

// src/worldgen.js
var CS = 16;
var CH = 96;
var SEA = 40;
var SEED = 1337;
var SCENE = null;
function configure(c) {
  SEED = c.seed ?? 1337;
  SCENE = c.scene ?? null;
}
var SHOWCASE = [
  [B.GRASS, B.DIRT, B.STONE, B.SAND],
  [B.LOG, B.LEAVES, B.BRICKS, B.ORE],
  [B.BASALT, B.BASALT_GOLD, B.BASALT_VIOLET, B.BASALT_TEAL]
].flatMap((row, j) => row.map((b, i) => ({ b, x: 1 + i * 3, y: 50, z: 1 + j * 3 })));
var out3 = [0, 0, 0];
function biomeAt(x, z) {
  if (SCENE === "meadow") {
    out3[0] = 1;
    out3[1] = 0;
    out3[2] = 0;
    return out3;
  }
  if (SCENE === "forest") {
    out3[0] = 0;
    out3[1] = 1;
    out3[2] = 0;
    return out3;
  }
  if (SCENE === "swamp") {
    out3[0] = 0;
    out3[1] = 0;
    out3[2] = 1;
    return out3;
  }
  const n = fbm(x / 260, z / 260, SEED + 5, 3);
  const s = 1 - smoothstep(0.38, 0.45, n), f = smoothstep(0.54, 0.61, n);
  out3[0] = 1 - s - f;
  out3[1] = f;
  out3[2] = s;
  return out3;
}
var lakeDist = (x, z) => Math.hypot((x - 26) / 30, z / 24) + (fbm(x / 14, z / 14, SEED + 23, 2) - 0.5) * 0.35;
var gladeDist = (x, z) => x > 20 ? Math.abs((x - 20) * -0.28 + z * 0.96) : 99;
var channelDist = (x, z) => Math.abs(z + 5 * Math.sin(x / 23) + 3 * Math.sin(x / 9));
function heightAt(x, z) {
  const w = biomeAt(x, z), m = w[0], f = w[1], s = w[2];
  let h = 0;
  if (m > 0) {
    let hm;
    if (SCENE === "meadow") hm = smoothstep(9, 60, Math.abs(x - 7 * Math.sin(z / 37))) * (0.45 + 0.55 * fbm(x / 60, z / 60, SEED + 9, 2));
    else hm = smoothstep(0.45, 0.72, fbm(x / 150, z / 150, SEED + 9, 2));
    h += m * (43.5 + fbm(x / 38, z / 38, SEED + 2, 3) * 3.5 + hm * (4 + fbm(x / 75, z / 75, SEED + 3, 4) * 46));
  }
  if (f > 0) {
    let fh = 43.5 + fbm(x / 48, z / 48, SEED + 4, 4) * 9;
    if (SCENE === "forest") fh = 42.2 + fbm(x / 40, z / 40, SEED + 4, 4) * 5 * smoothstep(3, 14, gladeDist(x, z)) - (1 - smoothstep(0.7, 1.08, lakeDist(x, z))) * 9;
    else fh -= smoothstep(0.6, 0.7, fbm(x / 85, z / 85, SEED + 21, 2)) * 11;
    h += f * fh;
  }
  if (s > 0) {
    let sh = 38.6 + fbm(x / 17, z / 17, SEED + 6, 3) * 3.2;
    if (SCENE === "swamp") sh -= (1 - smoothstep(2.5, 7, channelDist(x, z))) * 2.4;
    h += s * sh;
  }
  return h;
}
var surfaceY = (x, z) => Math.max(Math.floor(heightAt(x, z)), SEA - 1) + 1;
function generateChunk(cx, cz) {
  const blocks = new Uint8Array(CS * CS * CH);
  const x0 = cx * CS, z0 = cz * CS;
  const set = (wx, wy, wz, b, onlyAir) => {
    const lx = wx - x0, lz = wz - z0;
    if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || wy < 0 || wy >= CH) return;
    const i = lx + lz * CS + wy * CS * CS;
    if (onlyAir && blocks[i] !== 0) return;
    blocks[i] = b;
  };
  if (SCENE === "showcase") {
    for (const s of SHOWCASE) set(s.x, s.y, s.z, s.b);
    return blocks;
  }
  for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
    const wx = x0 + lx, wz = z0 + lz;
    const hi = Math.min(CH - 24, Math.max(2, Math.floor(heightAt(wx, wz))));
    const swampy = biomeAt(wx, wz)[2] > 0.5;
    const sandy = !swampy && hi <= SEA;
    const top = hi < SEA - 1 ? swampy ? B.DIRT : B.SAND : sandy ? B.SAND : B.GRASS;
    const deep = 9 + vnoise(wx / 20, wz / 20, SEED + 31) * 7;
    for (let y = 0; y <= hi; y++) {
      let b;
      if (y === hi) b = top;
      else if (y >= hi - 3) b = sandy ? B.SAND : B.DIRT;
      else if (y < deep) {
        b = B.BASALT;
        if (hash3(wx >> 1, y >> 1, wz >> 1, SEED + 32) > 0.9) b = B.BASALT_GOLD + Math.floor(hash3(wx >> 3, y >> 3, wz >> 3, SEED + 33) * 3);
      } else {
        b = B.STONE;
        if (hash3(wx >> 1, y >> 1, wz >> 1, SEED + 34) > 0.975) b = B.COAL_ORE;
        else if (hash3(wx >> 1, y >> 1, wz >> 1, SEED + 35) > 0.982) b = B.ORE;
        else if (y < 20 && hash3(wx >> 1, y >> 1, wz >> 1, SEED + 36) > 0.991) b = B.DIAMOND_ORE;
      }
      blocks[lx + lz * CS + y * CS * CS] = b;
    }
    if (!SCENE) {
      const capY = hi > SEA + 1 && vnoise(wx / 26, wz / 26, SEED + 61) > 0.7 ? hi : hi - 5;
      for (let y = 3; y <= capY; y++) {
        if (Math.abs(vnoise3(wx / 19, y / 12, wz / 19, SEED + 62) - 0.5) > 0.07) continue;
        if (Math.abs(vnoise3(wx / 19, y / 12, wz / 19, SEED + 63) - 0.5) > 0.07) continue;
        blocks[lx + lz * CS + y * CS * CS] = 0;
      }
    }
    for (let y = hi + 1; y < SEA; y++) blocks[lx + lz * CS + y * CS * CS] = B.WATER;
  }
  const BC = 22;
  for (let gz = Math.floor((z0 - 4) / BC); gz <= Math.floor((z0 + CS + 4) / BC); gz++)
    for (let gx = Math.floor((x0 - 4) / BC); gx <= Math.floor((x0 + CS + 4) / BC); gx++) {
      if (hash2(gx, gz, SEED + 41) > 0.3) continue;
      const bx = gx * BC + Math.floor(hash2(gx, gz, SEED + 42) * BC), bz = gz * BC + Math.floor(hash2(gx, gz, SEED + 43) * BC);
      const hy = Math.floor(heightAt(bx, bz));
      if (hy < SEA) continue;
      const r = 1.4 + hash2(gx, gz, SEED + 44) * 1.5, vt = B.BASALT_GOLD + Math.floor(hash2(gx, gz, SEED + 45) * 3);
      const R = Math.ceil(r);
      for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy * 1.6 + dz * dz + (hash3(bx + dx, hy + dy, bz + dz, SEED + 46) - 0.5) * 1.5 > r * r) continue;
        set(bx + dx, hy + 1 + dy, bz + dz, hash3(bx + dx, hy + dy, bz + dz, SEED + 47) > 0.62 ? vt : B.BASALT);
      }
    }
  const TC = 4, M = 6;
  for (let gz = Math.floor((z0 - M) / TC); gz <= Math.floor((z0 + CS + M) / TC); gz++)
    for (let gx = Math.floor((x0 - M) / TC); gx <= Math.floor((x0 + CS + M) / TC); gx++) {
      const tx = gx * TC + Math.floor(hash2(gx, gz, SEED + 51) * TC), tz = gz * TC + Math.floor(hash2(gx, gz, SEED + 52) * TC);
      const w = biomeAt(tx, tz), m = w[0], f = w[1], s = w[2];
      let p = m * 0.012 + f * 0.4 + s * 0.12;
      if (SCENE === "forest") {
        const d = lakeDist(tx, tz);
        if (d < 1.2 || gladeDist(tx, tz) < 9) continue;
        if (d < 1.5) p *= 0.5;
      }
      if (SCENE === "swamp" && channelDist(tx, tz) < 6) continue;
      if (SCENE === "meadow" && Math.abs(tx) < 16) continue;
      if (hash2(gx, gz, SEED + 53) > p) continue;
      const h = Math.floor(heightAt(tx, tz));
      if (h < SEA - (s > 0.5 ? 2 : 0) || h > CH - 30) continue;
      const r1 = hash2(gx, gz, SEED + 54), r2 = hash2(gx, gz, SEED + 55);
      const swampy = s > 0.5;
      const th = (swampy ? 5 : 4) + Math.floor(r1 * 4) + (f > 0.5 ? 1 : 0);
      const rx = swampy ? 3.1 + r2 * 1.3 : 2.3 + r2 * 1, ry = swampy ? 1.7 + r1 * 0.5 : 2 + r1 * 0.7;
      for (let y = 1; y <= th; y++) set(tx, h + y, tz, B.LOG);
      const cy = h + th + 0.5, R = Math.ceil(rx), Ry = Math.ceil(ry);
      for (let dy = -Ry; dy <= Ry + 1; dy++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        const yy = Math.floor(cy) + dy, d = (dx * dx + dz * dz) / (rx * rx) + (yy + 0.5 - cy - 0.4) ** 2 / (ry * ry);
        if (d + (hash3(tx + dx, yy, tz + dz, SEED + 56) - 0.5) * 0.45 < 1) set(tx + dx, yy, tz + dz, B.LEAVES, true);
      }
    }
  return blocks;
}

// src/entities.js
var TICK = 1 / 20;
function collides(world, x, y, z, w, h) {
  for (let by = Math.floor(y); by <= Math.floor(y + h - 1e-3); by++)
    for (let bz = Math.floor(z - w); bz <= Math.floor(z + w); bz++)
      for (let bx = Math.floor(x - w); bx <= Math.floor(x + w); bx++) if (isSolid(world.getBlock(bx, by, bz))) return true;
  return false;
}
function stepBody(e, world) {
  const p = e.pos, v = e.vel;
  e.prev[0] = p[0];
  e.prev[1] = p[1];
  e.prev[2] = p[2];
  e.inWater = world.getBlock(Math.floor(p[0]), Math.floor(p[1] + 0.2), Math.floor(p[2])) === B.WATER;
  if (e.inWater) {
    v[1] = v[1] * 0.8 + 0.6;
  } else v[1] = Math.max(v[1] - 26 * TICK, -40);
  e.onGround = false;
  e.hitWall = false;
  for (const a of [1, 0, 2]) {
    const old = p[a];
    p[a] += v[a] * TICK;
    if (!collides(world, p[0], p[1], p[2], e.w, e.h)) continue;
    p[a] = old;
    if (a === 1) {
      if (v[1] < 0) e.onGround = true;
    } else e.hitWall = true;
    v[a] = 0;
  }
}
var skyAbove = (world, x, y, z) => {
  for (let i = 1; i < 28 && y + i < CH; i++) if (isSolid(world.getBlock(x, y + i, z))) return false;
  return true;
};
var eye = (x, y, z, c) => [x, y, z, 0.09, 0.07, 0.03, c[0], c[1], c[2], null];
var MOBS = {
  wicht: {
    name: "Schattenwicht",
    hostile: true,
    hp: 16,
    dmg: 3,
    speed: 2.7,
    w: 0.3,
    h: 1.75,
    drops: [[I.COAL, 0, 2]],
    parts: [
      [-0.13, 0.35, 0, 0.2, 0.7, 0.2, 0.07, 0.06, 0.12, 0],
      [0.13, 0.35, 0, 0.2, 0.7, 0.2, 0.07, 0.06, 0.12, 3.14],
      [0, 1.05, 0, 0.5, 0.7, 0.28, 0.12, 0.1, 0.2, null],
      [-0.33, 1.02, 0, 0.14, 0.72, 0.16, 0.09, 0.08, 0.15, 3.14],
      [0.33, 1.02, 0, 0.14, 0.72, 0.16, 0.09, 0.08, 0.15, 0],
      [0, 1.6, 0, 0.42, 0.4, 0.42, 0.14, 0.12, 0.24, null],
      eye(-0.1, 1.63, -0.215, [0.5, 2.6, 2.4]),
      eye(0.1, 1.63, -0.215, [0.5, 2.6, 2.4])
    ]
  },
  krabbler: {
    name: "H\xF6hlenkrabbler",
    hostile: true,
    cave: true,
    hp: 10,
    dmg: 2,
    speed: 3.5,
    w: 0.42,
    h: 0.6,
    drops: [[I.STICK, 0, 2], [I.COAL, 0, 1]],
    parts: [
      [0, 0.32, 0, 0.8, 0.34, 0.9, 0.22, 0.09, 0.07, null],
      [0, 0.36, -0.52, 0.5, 0.26, 0.2, 0.3, 0.12, 0.08, null],
      [-0.47, 0.15, -0.26, 0.16, 0.3, 0.16, 0.12, 0.05, 0.04, 0],
      [0.47, 0.15, -0.26, 0.16, 0.3, 0.16, 0.12, 0.05, 0.04, 3.14],
      [-0.47, 0.15, 0.26, 0.16, 0.3, 0.16, 0.12, 0.05, 0.04, 3.14],
      [0.47, 0.15, 0.26, 0.16, 0.3, 0.16, 0.12, 0.05, 0.04, 0],
      eye(-0.14, 0.4, -0.63, [2.8, 0.7, 0.2]),
      eye(0.14, 0.4, -0.63, [2.8, 0.7, 0.2])
    ]
  },
  koloss: {
    name: "Steinkoloss",
    hostile: true,
    hp: 30,
    dmg: 5,
    speed: 1.7,
    w: 0.48,
    h: 2.25,
    drops: [[B.STONE, 1, 3], [I.IRON, 0, 1]],
    parts: [
      [-0.22, 0.45, 0, 0.34, 0.9, 0.36, 0.3, 0.31, 0.34, 0],
      [0.22, 0.45, 0, 0.34, 0.9, 0.36, 0.3, 0.31, 0.34, 3.14],
      [0, 1.4, 0, 0.95, 1, 0.55, 0.38, 0.39, 0.43, null],
      [-0.64, 1.3, 0, 0.3, 1.1, 0.34, 0.33, 0.34, 0.37, 3.14],
      [0.64, 1.3, 0, 0.3, 1.1, 0.34, 0.33, 0.34, 0.37, 0],
      [0, 2.07, -0.05, 0.42, 0.34, 0.4, 0.42, 0.43, 0.47, null],
      eye(-0.1, 2.08, -0.26, [2.6, 1.6, 0.3]),
      eye(0.1, 2.08, -0.26, [2.6, 1.6, 0.3])
    ]
  },
  bock: {
    name: "Wollbock",
    hp: 8,
    speed: 1.4,
    w: 0.38,
    h: 1.05,
    drops: [[I.MEAT_RAW, 1, 2]],
    parts: [
      [0, 0.72, 0, 0.56, 0.5, 0.95, 0.86, 0.83, 0.74, null],
      [0, 0.98, -0.6, 0.34, 0.34, 0.34, 0.25, 0.2, 0.17, null],
      [-0.18, 0.23, -0.3, 0.14, 0.46, 0.14, 0.25, 0.2, 0.17, 0],
      [0.18, 0.23, -0.3, 0.14, 0.46, 0.14, 0.25, 0.2, 0.17, 3.14],
      [-0.18, 0.23, 0.3, 0.14, 0.46, 0.14, 0.25, 0.2, 0.17, 3.14],
      [0.18, 0.23, 0.3, 0.14, 0.46, 0.14, 0.25, 0.2, 0.17, 0],
      [-0.16, 1.2, -0.58, 0.07, 0.14, 0.07, 0.8, 0.75, 0.6, null],
      [0.16, 1.2, -0.58, 0.07, 0.14, 0.07, 0.8, 0.75, 0.6, null]
    ]
  },
  hupfer: {
    name: "H\xFCpfer",
    hp: 4,
    speed: 1.9,
    hop: true,
    w: 0.22,
    h: 0.62,
    drops: [[I.MEAT_RAW, 0, 1]],
    parts: [
      [0, 0.32, 0, 0.36, 0.34, 0.46, 0.78, 0.5, 0.2, null],
      [0, 0.56, -0.2, 0.26, 0.24, 0.26, 0.86, 0.6, 0.26, null],
      [0, 0.53, -0.37, 0.1, 0.07, 0.1, 0.95, 0.8, 0.2, null],
      [-0.1, 0.08, 0.02, 0.08, 0.16, 0.12, 0.9, 0.7, 0.2, 0],
      [0.1, 0.08, 0.02, 0.08, 0.16, 0.12, 0.9, 0.7, 0.2, 3.14],
      [0, 0.4, 0.27, 0.2, 0.1, 0.14, 0.6, 0.36, 0.14, null]
    ]
  }
};
var Mob = class {
  constructor(type, x, y, z) {
    const d = MOBS[type];
    Object.assign(this, { type, def: d, pos: [x, y, z], prev: [x, y, z], vel: [0, 0, 0], w: d.w, h: d.h, yaw: Math.random() * 6.28, hp: d.hp, phase: 0, hurt: 0, cd: 0, wanderT: 0, moving: false, dirX: 0, dirZ: 0, avoidT: 0, avoidS: 1, stuck: 0, lit: 1, age: 0, dead: false });
  }
  tick(g) {
    const d = this.def, p = this.pos, world = g.world;
    this.age++;
    if (this.hurt > 0) this.hurt--;
    if (this.cd > 0) this.cd--;
    const near = g.nearestPlayer(p), pl = near ? near.pos : p;
    const dx = pl[0] - p[0], dz = pl[2] - p[2], dy = pl[1] - p[1], dist = near ? Math.hypot(dx, dz) : 999;
    const chase = d.hostile && near && g.canTarget(near) && dist < 26 && Math.abs(dy) < 12;
    let sp = 0;
    if (chase) {
      this.dirX = dx / (dist || 1);
      this.dirZ = dz / (dist || 1);
      sp = dist > 0.9 ? d.speed : 0;
    } else {
      if (--this.wanderT <= 0) {
        this.wanderT = 40 + Math.random() * 80;
        this.moving = Math.random() < 0.6;
        const a = Math.random() * 6.283;
        this.dirX = Math.sin(a);
        this.dirZ = Math.cos(a);
      }
      sp = this.moving ? d.speed * 0.5 : 0;
    }
    let mx = this.dirX, mz = this.dirZ;
    if (this.avoidT > 0) {
      this.avoidT--;
      const t = mx;
      mx = -mz * this.avoidS * 0.9 + mx * 0.3;
      mz = t * this.avoidS * 0.9 + mz * 0.3;
    }
    const k = this.onGround || this.inWater ? 0.35 : 0.08;
    this.vel[0] += (mx * sp - this.vel[0]) * k;
    this.vel[2] += (mz * sp - this.vel[2]) * k;
    if (sp > 0) {
      if (this.hitWall && this.onGround) {
        const fx = Math.floor(p[0] + mx * (this.w + 0.5)), fz = Math.floor(p[2] + mz * (this.w + 0.5)), fy = Math.floor(p[1] + 0.1);
        const high = isSolid(world.getBlock(fx, fy + 1, fz)) || isSolid(world.getBlock(fx, fy + Math.ceil(this.h), fz));
        if (!high) this.vel[1] = 8.2;
        else if (this.avoidT <= 0) {
          this.avoidT = 24 + Math.random() * 20;
          this.avoidS = Math.random() < 0.5 ? 1 : -1;
          if (!chase) this.wanderT = 0;
        }
      } else if (d.hop && this.onGround && this.age % 12 === 0) this.vel[1] = 5.5;
      this.yaw = Math.atan2(mx, -mz);
      this.phase += Math.hypot(this.vel[0], this.vel[2]) * 0.22;
    }
    if (this.inWater) this.vel[1] = Math.max(this.vel[1], 1.2);
    stepBody(this, world);
    if (chase && dist < this.w + 0.95 && dy > -this.h - 0.2 && dy < 1.9 && this.cd <= 0) {
      this.cd = 30;
      g.hurtPlayer(near, d.dmg * g.mobDamage(), [dx / (dist || 1), dz / (dist || 1)]);
    }
    if (this.age % 10 === 0) {
      this.lit = skyAbove(world, Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])) ? 1 : 0.22;
      if (d.hostile && this.lit === 1 && g.isDay()) {
        this.hp -= 2;
        this.hurt = 4;
        if (this.hp <= 0) this.dead = true;
      }
      if (dist > (d.hostile ? 72 : 110) || p[1] < -10) this.dead = true;
    }
  }
  damage(n, kx, kz, g) {
    this.hp -= n;
    this.hurt = 6;
    this.vel[0] = kx * 6;
    this.vel[2] = kz * 6;
    this.vel[1] = 5;
    if (this.hp > 0) return false;
    this.dead = true;
    for (const [id, a, b] of this.def.drops) {
      const c = a + Math.floor(Math.random() * (b - a + 1));
      if (c > 0) g.spawnDrop(id, c, void 0, this.pos[0], this.pos[1] + 0.4, this.pos[2]);
    }
    return true;
  }
};
var Drop = class {
  constructor(item2, x, y, z, vel) {
    Object.assign(this, { item: item2, pos: [x, y, z], prev: [x, y, z], vel: vel || [(Math.random() - 0.5) * 2.4, 3.2, (Math.random() - 0.5) * 2.4], w: 0.12, h: 0.24, age: 0, delay: 12, ttl: 6e3, dead: false, lit: 1 });
  }
  tick(g) {
    this.age++;
    stepBody(this, g.world);
    if (this.onGround) {
      this.vel[0] *= 0.6;
      this.vel[2] *= 0.6;
    }
    if (this.age % 20 === 0) this.lit = skyAbove(g.world, Math.floor(this.pos[0]), Math.floor(this.pos[1]), Math.floor(this.pos[2])) ? 1 : 0.22;
    if (this.age > this.ttl || this.pos[1] < -10) {
      this.dead = true;
      return;
    }
    if (this.age < this.delay) return;
    for (const pl of g.players.values()) {
      if (!g.canPickup(pl)) continue;
      const d = Math.hypot(pl.pos[0] - this.pos[0], pl.pos[2] - this.pos[2]), dy = this.pos[1] - pl.pos[1];
      if (d < 1.5 && dy > -1.6 && dy < 2.3) {
        const left = pl.inv.add(this.item.id, this.item.n, this.item.d);
        if (left !== this.item.n) pl.invDirty = true;
        if (left <= 0) {
          this.dead = true;
          return;
        }
        this.item.n = left;
      } else if (d < 3 && Math.abs(dy) < 3) {
        const f = 0.25 / d;
        this.vel[0] += (pl.pos[0] - this.pos[0]) * f;
        this.vel[2] += (pl.pos[2] - this.pos[2]) * f;
      }
    }
  }
};
var MAX_PER_CHUNK = 2;
var MAX_HOSTILE = 6;
var MAX_ANIMALS = 8;
function trySpawn(g, player) {
  const world = g.world, pl = player.pos, a = Math.random() * 6.283, r = 24 + Math.random() * 24;
  const x = Math.floor(pl[0] + Math.sin(a) * r), z = Math.floor(pl[2] + Math.cos(a) * r);
  if (!world.isLoaded(x, z) || !g.rules.doMobSpawning) return;
  const cap = Math.max(1, g.players.size);
  const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
  let inChunk = 0, hostile = 0, animals = 0;
  for (const m of g.mobs) {
    if (Math.floor(m.pos[0] / CS) === cx && Math.floor(m.pos[2] / CS) === cz) inChunk++;
    if (m.def.hostile) hostile++;
    else animals++;
  }
  if (inChunk >= MAX_PER_CHUNK) return;
  let top = CH - 1;
  while (top > 1 && !isSolid(world.getBlock(x, top, z))) top--;
  const free = (y) => world.getBlock(x, y, z) === 0 && world.getBlock(x, y + 1, z) === 0 && world.getBlock(x, y + 2, z) === 0;
  const day = g.isDay(), peaceful = g.difficulty === 0;
  if (!peaceful && hostile < MAX_HOSTILE * cap && Math.random() < 0.5 && top > 16) {
    let y = 6 + Math.floor(Math.random() * Math.max(1, top - 14));
    for (let i = 0; i < 14 && y > 3; i++, y--) if (isSolid(world.getBlock(x, y - 1, z)) && free(y)) {
      g.addMob(new Mob(Math.random() < 0.7 ? "krabbler" : "koloss", x + 0.5, y, z + 0.5));
      return;
    }
    return;
  }
  if (!free(top + 1)) return;
  const ground = world.getBlock(x, top, z);
  if (!day && !peaceful && hostile < MAX_HOSTILE * cap) g.addMob(new Mob(Math.random() < 0.72 ? "wicht" : "koloss", x + 0.5, top + 1, z + 0.5));
  else if (day && animals < MAX_ANIMALS * cap && ground === B.GRASS && Math.random() < 0.5) g.addMob(new Mob(Math.random() < 0.6 ? "bock" : "hupfer", x + 0.5, top + 1, z + 0.5));
}
var MOB_TYPES = Object.keys(MOBS);

// src/protocol.js
var C = { HELLO: 1, MOVE: 2, FALL: 3, BREAK_START: 4, BREAK_STOP: 5, BREAK_DONE: 6, USE: 7, ATTACK: 8, SLOT: 9, OPEN_INV: 10, CLOSE_INV: 11, INV_CLICK: 12, PALETTE: 13, CHAT: 14, TAB: 15, RESPAWN: 16, VIEW: 17, PING: 18 };
var S = { WELCOME: 64, CHUNK: 65, BLOCKS: 66, TIME: 67, STATE: 68, INV: 69, ENTS: 70, ENT_REMOVE: 71, PLAYER_INFO: 72, CHAT: 73, TAB: 74, TELEPORT: 75, VELOCITY: 76, OPEN: 77, KICK: 78, PONG: 79, FLASH: 80 };
var PROTOCOL_VERSION = 1;
var te = new TextEncoder();
var td = new TextDecoder();
var Writer = class {
  constructor(type, cap = 64) {
    this.a = new Uint8Array(cap);
    this.dv = new DataView(this.a.buffer);
    this.n = 0;
    this.u8(type);
  }
  need(k) {
    if (this.n + k <= this.a.length) return;
    const b = new Uint8Array(Math.max(this.a.length * 2, this.n + k));
    b.set(this.a);
    this.a = b;
    this.dv = new DataView(b.buffer);
  }
  u8(v) {
    this.need(1);
    this.a[this.n++] = v;
    return this;
  }
  u16(v) {
    this.need(2);
    this.dv.setUint16(this.n, v, true);
    this.n += 2;
    return this;
  }
  i32(v) {
    this.need(4);
    this.dv.setInt32(this.n, v, true);
    this.n += 4;
    return this;
  }
  u32(v) {
    this.need(4);
    this.dv.setUint32(this.n, v, true);
    this.n += 4;
    return this;
  }
  f32(v) {
    this.need(4);
    this.dv.setFloat32(this.n, v, true);
    this.n += 4;
    return this;
  }
  str(s) {
    const b = te.encode(s);
    this.u16(b.length);
    this.need(b.length);
    this.a.set(b, this.n);
    this.n += b.length;
    return this;
  }
  bytes(b) {
    this.u32(b.length);
    this.need(b.length);
    this.a.set(b, this.n);
    this.n += b.length;
    return this;
  }
  slot(s) {
    if (!s) return this.u16(0);
    return this.u16(s.id).u8(s.n).u16(s.d || 0);
  }
  end() {
    return this.a.buffer.slice(0, this.n);
  }
};
var Reader = class {
  constructor(buf) {
    this.a = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    this.dv = new DataView(this.a.buffer, this.a.byteOffset, this.a.byteLength);
    this.n = 0;
  }
  u8() {
    return this.a[this.n++];
  }
  u16() {
    const v = this.dv.getUint16(this.n, true);
    this.n += 2;
    return v;
  }
  i32() {
    const v = this.dv.getInt32(this.n, true);
    this.n += 4;
    return v;
  }
  u32() {
    const v = this.dv.getUint32(this.n, true);
    this.n += 4;
    return v;
  }
  f32() {
    const v = this.dv.getFloat32(this.n, true);
    this.n += 4;
    return v;
  }
  str() {
    const l = this.u16(), s = td.decode(this.a.subarray(this.n, this.n + l));
    this.n += l;
    return s;
  }
  bytes() {
    const l = this.u32(), b = this.a.subarray(this.n, this.n + l);
    this.n += l;
    return b;
  }
  slot() {
    const id = this.u16();
    if (!id) return null;
    const n = this.u8(), d = this.u16();
    return d ? { id, n, d } : { id, n };
  }
  get more() {
    return this.n < this.a.length;
  }
};
function rleEncode(src) {
  const out = new Uint8Array(src.length * 2 + 8);
  let n = 0, i = 0;
  while (i < src.length) {
    const v = src[i];
    let j = i + 1;
    while (j < src.length && src[j] === v) j++;
    let len = j - i;
    out[n++] = v;
    while (len >= 128) {
      out[n++] = len & 127 | 128;
      len >>>= 7;
    }
    out[n++] = len;
    i = j;
  }
  return out.subarray(0, n);
}

// core/commands.ts
var BLOCK_KEYS = ["air", "grass_block", "dirt", "stone", "sand", "log", "leaves", "water", "basalt", "gold_basalt", "violet_basalt", "teal_basalt", "stone_bricks", "iron_ore", "planks", "crafting_table", "furnace", "coal_ore", "diamond_ore", "bed"];
var BLOCK_IDS = {};
BLOCK_KEYS.forEach((k, i) => {
  BLOCK_IDS[k] = i;
});
var ITEM_IDS = { stick: I.STICK, coal: I.COAL, iron_ingot: I.IRON, diamond: I.DIAMOND, apple: I.APPLE, raw_meat: I.MEAT_RAW, cooked_meat: I.MEAT_COOKED };
BLOCK_KEYS.forEach((k, i) => {
  if (ITEMS[i]) ITEM_IDS[k] = i;
});
["wooden", "stone", "iron", "diamond"].forEach((m, mi) => ["pickaxe", "axe", "shovel", "sword"].forEach((t, ti) => {
  ITEM_IDS[`${m}_${t}`] = toolId(mi, ti);
}));
var strip = (s) => s.replace(/^minecraft:|^kantenhain:/, "");
var CmdError = class extends Error {
};
var fail = (m) => {
  throw new CmdError(m);
};
var next = (c, what) => c.i < c.args.length ? c.args[c.i++] : fail(`Es fehlt: ${what}`);
var more = (c) => c.i < c.args.length;
function num(s, what = "Zahl") {
  const v = Number(s);
  if (s === "" || !Number.isFinite(v)) fail(`\u201E${s}\u201C ist keine g\xFCltige ${what}`);
  return v;
}
function int(c, what, min = -Infinity, max = Infinity) {
  const v = Math.floor(num(next(c, what), what));
  if (v < min || v > max) fail(`${what} muss zwischen ${min} und ${max} liegen`);
  return v;
}
function coord(c, axis, block2) {
  const s = next(c, "Koordinate (x y z)");
  let v = s[0] === "~" ? c.pos[axis] + (s.length > 1 ? num(s.slice(1), "Koordinate") : 0) : num(s, "Koordinate") + (!block2 && axis !== 1 && /^-?\d+$/.test(s) ? 0.5 : 0);
  return block2 ? Math.floor(v) : v;
}
var coords = (c, block2 = false) => [coord(c, 0, block2), coord(c, 1, block2), coord(c, 2, block2)];
var isCoord = (s) => !!s && /^(~|-?\d|\.)/.test(s);
function targets(c, sel, entities = false) {
  const pl = [...c.sv.players.values()].filter((p) => p.joined);
  let r;
  if (sel === "@s") r = c.p ? [c.p] : fail("@s geht nur als Spieler");
  else if (sel === "@a") r = pl;
  else if (sel === "@p") r = pl.sort((a, b) => Math.hypot(a.pos[0] - c.pos[0], a.pos[2] - c.pos[2]) - Math.hypot(b.pos[0] - c.pos[0], b.pos[2] - c.pos[2])).slice(0, 1);
  else if (sel === "@e") r = entities ? [...pl, ...c.sv.mobs.filter((m) => !m.dead), ...c.sv.drops.filter((d) => !d.dead)] : fail("@e ist hier nicht erlaubt \u2013 nur Spieler");
  else if (sel[0] === "@") r = fail(`Unbekannte Zielauswahl \u201E${sel}\u201C (erlaubt: @p @a @s @e)`);
  else {
    const p = c.sv.findPlayer(sel);
    r = p ? [p] : fail(`Spieler \u201E${sel}\u201C wurde nicht gefunden`);
  }
  if (!r.length) fail("Kein Ziel gefunden");
  return r;
}
var players = (c, sel) => sel === void 0 ? c.p ? [c.p] : fail("Spieler angeben") : targets(c, sel);
var names = (l) => l.length === 1 ? l[0].name || "Figur" : `${l.length} Ziele`;
var item = (s) => ITEM_IDS[strip(s)] ?? fail(`Unbekanntes Item \u201E${s}\u201C`);
var block = (s) => BLOCK_IDS[strip(s)] ?? fail(`Unbekannter Block \u201E${s}\u201C`);
var pick = (s, list, what) => {
  const i = list.indexOf(s);
  return i >= 0 ? i : fail(`\u201E${s}\u201C ist kein g\xFCltiger Wert f\xFCr ${what} (${list.join(", ")})`);
};
var COMMANDS = {
  help: { usage: "/help [befehl]", desc: "Zeigt alle Befehle", perm: 0, args: ["command"], run(c) {
    if (more(c)) {
      const n = next(c, "").replace(/^\//, ""), d = COMMANDS[n] || fail(`Unbekannter Befehl \u201E${n}\u201C`);
      return c.out(`${d.usage} \u2013 ${d.desc}`);
    }
    c.out("Befehle: " + Object.keys(COMMANDS).map((k) => "/" + k).join(" "));
    c.out("Details mit /help <befehl>. Koordinaten: absolut oder relativ (~ ~ ~). Ziele: @p @a @s @e oder Spielername.");
  } },
  gamemode: { usage: "/gamemode <survival|creative|spectator> [spieler]", desc: "\xC4ndert den Spielmodus", perm: 2, args: ["mode", "player"], run(c) {
    const m = pick(next(c, "Spielmodus"), MODES, "den Spielmodus"), l = players(c, more(c) ? next(c, "") : void 0);
    for (const p of l) c.sv.setMode(p, m);
    c.out(`Spielmodus von ${names(l)} ist jetzt ${MODES[m]}`);
  } },
  tp: { usage: "/tp [ziel] <x y z | spieler>", desc: "Teleportiert Spieler oder Figuren", perm: 2, args: ["target", "target", "coord", "coord"], run(c) {
    let who = c.p ? [c.p] : [];
    if (!isCoord(c.args[c.i]) && (c.args.length === 2 || c.args.length === 4)) who = targets(c, next(c, ""), true);
    let pos;
    if (isCoord(c.args[c.i])) pos = coords(c);
    else {
      const d = targets(c, next(c, "Ziel"), true);
      if (d.length !== 1) fail("Das Ziel muss eindeutig sein");
      pos = d[0].pos.slice();
    }
    if (!who.length) fail("Wer soll teleportiert werden?");
    if (pos[1] < -64 || pos[1] > 512) fail("Die H\xF6he liegt au\xDFerhalb der Welt");
    for (const e of who) {
      if (e.send) c.sv.teleport(e, pos[0], pos[1], pos[2]);
      else {
        e.pos = pos.slice();
        e.prev = pos.slice();
        e.vel = [0, 0, 0];
      }
    }
    c.out(`${names(who)} nach ${pos.map((v) => v.toFixed(1)).join(" ")} teleportiert`);
  } },
  give: { usage: "/give <spieler> <item> [anzahl]", desc: "Gibt Items", perm: 2, args: ["player", "item"], run(c) {
    const l = players(c, next(c, "Spieler")), id = item(next(c, "Item")), n = more(c) ? int(c, "Anzahl", 1, 2304) : 1;
    for (const p of l) {
      const left = p.inv.add(id, n);
      if (left > 0) c.sv.spawnDrop(id, Math.min(left, 64), void 0, p.pos[0], p.pos[1] + 1, p.pos[2]);
      p.invDirty = true;
    }
    c.out(`${n} \xD7 ${ITEMS[id].name} an ${names(l)} gegeben`);
  } },
  clear: { usage: "/clear [spieler] [item]", desc: "Leert das Inventar", perm: 2, args: ["player", "item"], run(c) {
    const l = players(c, more(c) ? next(c, "") : void 0), id = more(c) ? item(next(c, "")) : 0;
    let n = 0;
    for (const p of l) {
      p.inv.slots.forEach((s, i) => {
        if (s && (!id || s.id === id)) {
          n += s.n;
          p.inv.slots[i] = null;
        }
      });
      p.invDirty = true;
    }
    c.out(n ? `${n} Items aus dem Inventar von ${names(l)} entfernt` : "Es wurden keine Items gefunden");
  } },
  time: { usage: "/time <set|add|query> [day|night|noon|midnight|zahl]", desc: "Stellt die Tageszeit (Ticks, 0 = 6 Uhr)", perm: 2, args: ["timeop", "timeval"], run(c) {
    const op = next(c, "set, add oder query"), ticks = () => Math.round(((c.sv.time - 6) % 24 + 24) % 24 * 1e3);
    if (op === "query") return c.out(`Es ist ${ticks()} Ticks (${Math.floor(c.sv.time)}:${String(Math.floor(c.sv.time % 1 * 60)).padStart(2, "0")} Uhr)`);
    if (op !== "set" && op !== "add") fail("Verwendung: " + this.usage);
    const s = next(c, "Zeit"), named = { day: 1e3, noon: 6e3, night: 13e3, midnight: 18e3 };
    const v = op === "set" && s in named ? named[s] : num(s, "Zeit");
    const t = op === "set" ? v : ticks() + v;
    c.sv.time = ((t / 1e3 + 6) % 24 + 24) % 24;
    c.sv.sendTime();
    c.out(`Zeit auf ${ticks()} gesetzt`);
  } },
  weather: { usage: "/weather <clear|rain|thunder> [sekunden]", desc: "\xC4ndert das Wetter", perm: 2, args: ["weather"], run(c) {
    const w = pick(next(c, "Wetter"), WEATHER, "das Wetter"), sec = more(c) ? int(c, "Dauer", 1, 1e6) : void 0;
    c.sv.setWeather(w, sec === void 0 ? void 0 : sec * 20);
    c.out(`Wetter ist jetzt ${["klar", "Regen", "Gewitter"][w]}`);
  } },
  difficulty: { usage: "/difficulty [peaceful|easy|normal|hard]", desc: "Zeigt oder \xE4ndert die Schwierigkeit", perm: 2, args: ["difficulty"], run(c) {
    if (!more(c)) return c.out(`Schwierigkeit: ${DIFFICULTIES[c.sv.difficulty]}`);
    c.sv.difficulty = pick(next(c, ""), DIFFICULTIES, "die Schwierigkeit");
    c.sv.sendTime();
    c.out(`Schwierigkeit ist jetzt ${DIFFICULTIES[c.sv.difficulty]}`);
  } },
  gamerule: { usage: "/gamerule <regel> [true|false]", desc: "Zeigt oder \xE4ndert eine Spielregel", perm: 2, args: ["rule", "bool"], run(c) {
    const r = next(c, "Regel (" + Object.keys(DEFAULT_RULES).join(", ") + ")");
    if (!(r in DEFAULT_RULES)) fail(`Unbekannte Regel \u201E${r}\u201C (${Object.keys(DEFAULT_RULES).join(", ")})`);
    if (!more(c)) return c.out(`${r} = ${c.sv.rules[r]}`);
    const v = next(c, "");
    if (v !== "true" && v !== "false") fail("Der Wert muss true oder false sein");
    c.sv.rules[r] = v === "true";
    c.sv.sendTime();
    c.out(`${r} ist jetzt ${v}`);
  } },
  kill: { usage: "/kill [ziel]", desc: "T\xF6tet Spieler oder Figuren", perm: 2, args: ["target"], run(c) {
    const l = more(c) ? targets(c, next(c, ""), true) : players(c);
    for (const e of l) {
      if (e.send) {
        if (!e.dead) {
          const m = e.mode;
          e.mode = 0;
          c.sv.die(e);
          e.mode = m;
        }
      } else e.dead = true;
    }
    c.out(`${names(l)} get\xF6tet`);
  } },
  summon: { usage: "/summon <figur> [x y z]", desc: "Erschafft eine Figur", perm: 2, args: ["entity", "coord", "coord", "coord"], run(c) {
    const t = strip(next(c, "Figur"));
    if (!MOBS[t]) fail(`Unbekannte Figur \u201E${t}\u201C (${Object.keys(MOBS).join(", ")})`);
    const pos = more(c) ? coords(c) : c.pos.slice();
    c.sv.world.chunk(Math.floor(pos[0] / 16), Math.floor(pos[2] / 16));
    c.sv.addMob(new Mob(t, pos[0], pos[1], pos[2]));
    c.out(`${MOBS[t].name} erschaffen`);
  } },
  setblock: { usage: "/setblock <x y z> <block>", desc: "Setzt einen Block", perm: 2, args: ["coord", "coord", "coord", "block"], run(c) {
    const [x, y, z] = coords(c, true), b = block(next(c, "Block"));
    if (y < 1 || y >= CH) fail(`Die H\xF6he muss zwischen 1 und ${CH - 1} liegen`);
    c.out(c.sv.world.setBlock(x, y, z, b) ? `Block bei ${x} ${y} ${z} gesetzt` : "Der Block war bereits so gesetzt");
  } },
  fill: { usage: "/fill <x1 y1 z1> <x2 y2 z2> <block>", desc: "F\xFCllt einen Bereich (max. 32768 Bl\xF6cke)", perm: 2, args: ["coord", "coord", "coord", "coord", "coord", "coord", "block"], run(c) {
    const a = coords(c, true), b = coords(c, true), id = block(next(c, "Block"));
    const lo = a.map((v, i) => Math.min(v, b[i])), hi = a.map((v, i) => Math.max(v, b[i])), vol = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
    if (vol > 32768) fail(`Der Bereich ist zu gro\xDF (${vol} > 32768 Bl\xF6cke)`);
    if (lo[1] < 1 || hi[1] >= CH) fail(`Die H\xF6he muss zwischen 1 und ${CH - 1} liegen`);
    let n = 0;
    for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) for (let x = lo[0]; x <= hi[0]; x++) if (c.sv.world.setBlock(x, y, z, id)) n++;
    c.out(`${n} Bl\xF6cke gef\xFCllt`);
  } },
  seed: { usage: "/seed", desc: "Zeigt den Seed der Welt", perm: 0, args: [], run(c) {
    c.out(`Seed: ${c.sv.rec.seed}`);
  } },
  spawnpoint: { usage: "/spawnpoint [spieler] [x y z]", desc: "Setzt den pers\xF6nlichen Spawnpunkt", perm: 2, args: ["player", "coord", "coord", "coord"], run(c) {
    const l = players(c, more(c) && !isCoord(c.args[c.i]) ? next(c, "") : void 0), pos = more(c) ? coords(c, true) : c.pos.map(Math.floor);
    for (const p of l) p.bed = [pos[0], pos[1] - 1, pos[2]];
    c.out(`Spawnpunkt von ${names(l)} auf ${pos.join(" ")} gesetzt (gilt, solange dort ein Bett steht \u2013 sonst Weltspawn)`);
  } },
  setworldspawn: { usage: "/setworldspawn [x y z]", desc: "Setzt den Weltspawn", perm: 2, args: ["coord", "coord", "coord"], run(c) {
    c.sv.spawn = more(c) ? coords(c, true) : c.pos.map(Math.floor);
    c.out(`Weltspawn auf ${c.sv.spawn.join(" ")} gesetzt`);
  } },
  effect: { usage: "/effect <give|clear> <spieler> [effekt] [sekunden] [stufe]", desc: "Gibt oder entfernt Effekte", perm: 2, args: ["effectop", "player", "effect"], run(c) {
    const op = next(c, "give oder clear");
    if (op !== "give" && op !== "clear") fail("Verwendung: " + this.usage);
    const l = players(c, next(c, "Spieler"));
    if (op === "clear") {
      for (const p of l) p.effects.clear();
      return c.out(`Effekte von ${names(l)} entfernt`);
    }
    const e = strip(next(c, "Effekt"));
    if (!EFFECTS.includes(e)) fail(`Unbekannter Effekt \u201E${e}\u201C (${EFFECTS.join(", ")})`);
    const sec = more(c) ? int(c, "Dauer", 1, 1e6) : 30, amp = more(c) ? int(c, "Stufe", 0, 255) : 0;
    for (const p of l) {
      if (e === "instant_health") p.health = Math.min(20, p.health + 4 * 2 ** Math.min(amp, 3));
      else p.effects.set(e, { until: c.sv.tickN + sec * 20, amp: Math.min(amp, 9) });
    }
    c.out(`${e} (Stufe ${amp + 1}) f\xFCr ${sec} s an ${names(l)} gegeben`);
  } },
  xp: { usage: "/xp <add|set|query> <spieler> [menge] [points|levels]", desc: "\xC4ndert die Erfahrung", perm: 2, args: ["xpop", "player", "", "xpunit"], run(c) {
    const op = next(c, "add, set oder query");
    if (!["add", "set", "query"].includes(op)) fail("Verwendung: " + this.usage);
    const l = players(c, next(c, "Spieler"));
    if (op === "query") return c.out(l.map((p) => `${p.name}: ${p.xp} Punkte (Level ${xpLevel(p.xp)})`).join(", "));
    const n = int(c, "Menge", -1e6, 1e6), lv = more(c) ? next(c, "") === "levels" : false;
    for (const p of l) {
      const cur = lv ? xpLevel(p.xp) : p.xp, v = Math.max(0, op === "add" ? cur + n : n);
      p.xp = lv ? xpForLevel(v) : v;
    }
    c.out(`Erfahrung von ${names(l)} ge\xE4ndert`);
  } },
  say: { usage: "/say <nachricht>", desc: "Sendet eine Nachricht an alle", perm: 1, args: [], run(c) {
    if (!more(c)) fail("Es fehlt: Nachricht");
    c.sv.chat(`[${c.p ? c.p.name : "Server"}] ${c.args.slice(c.i).join(" ")}`, 2);
  } },
  kick: { usage: "/kick <spieler> [grund]", desc: "Wirft einen Spieler hinaus", perm: 1, args: ["player"], run(c) {
    const l = players(c, next(c, "Spieler")), why = c.args.slice(c.i).join(" ") || "Vom Host entfernt";
    for (const p of l) {
      if (p.local) fail("Der Host kann nicht entfernt werden");
      c.sv.chat(`${p.name} wurde entfernt`, 2);
      c.sv.kick(p, why);
    }
  } },
  op: { usage: "/op <spieler>", desc: "Macht einen Spieler zum Operator", perm: 1, args: ["player"], run(c) {
    const l = players(c, next(c, "Spieler"));
    for (const p of l) p.op = true;
    c.out(`${names(l)} ist jetzt Operator`);
  } },
  deop: { usage: "/deop <spieler>", desc: "Entzieht Operator-Rechte", perm: 1, args: ["player"], run(c) {
    const l = players(c, next(c, "Spieler"));
    for (const p of l) {
      if (p.local) fail("Dem Host k\xF6nnen die Rechte nicht entzogen werden");
      p.op = false;
    }
    c.out(`${names(l)} ist kein Operator mehr`);
  } }
};
var xpLevel = (xp) => Math.floor((Math.sqrt(1 + 0.8 * xp) - 1) / 2);
var xpForLevel = (l) => 5 * l * (l + 1);
function runCommand(sv, p, line) {
  const args = line.trim().replace(/^\//, "").split(/\s+/), name = args.shift().toLowerCase(), cmd = COMMANDS[name];
  const err = (m) => sv.tell(p, m, 1);
  if (!cmd) return err(`Unbekannter Befehl \u201E/${name}\u201C \u2013 /help zeigt alle Befehle`);
  if (cmd.perm >= 1 && !sv.isOp(p)) return err("Daf\xFCr brauchst du Operator-Rechte");
  if (cmd.perm === 2 && p && !sv.cheats) return err("Cheats sind in dieser Welt nicht erlaubt");
  try {
    cmd.run({ sv, p, pos: p ? p.pos : sv.spawn, args, i: 0, out: (m) => sv.tell(p, m, 3) });
  } catch (e) {
    if (e instanceof CmdError) {
      err(e.message);
      err("Verwendung: " + cmd.usage);
    } else {
      err("Interner Fehler: " + e.message);
    }
  }
}
function complete(sv, p, line) {
  if (line[0] !== "/") return [];
  const parts = line.slice(1).split(/\s+/), last2 = parts[parts.length - 1], head = line.slice(0, line.length - last2.length);
  let opts = [];
  if (parts.length === 1) opts = Object.keys(COMMANDS);
  else {
    const cmd = COMMANDS[parts[0].toLowerCase()];
    if (!cmd) return [];
    const kind = cmd.args[parts.length - 2] || "", pl = [...sv.players.values()].filter((x) => x.joined).map((x) => x.name);
    opts = {
      command: Object.keys(COMMANDS),
      mode: MODES,
      player: [...pl, "@p", "@a", "@s"],
      target: [...pl, "@p", "@a", "@s", "@e", "~"],
      item: Object.keys(ITEM_IDS),
      block: Object.keys(BLOCK_IDS),
      entity: Object.keys(MOBS),
      weather: WEATHER,
      difficulty: DIFFICULTIES,
      rule: Object.keys(DEFAULT_RULES),
      bool: ["true", "false"],
      coord: ["~"],
      timeop: ["set", "add", "query"],
      timeval: ["day", "noon", "night", "midnight"],
      effectop: ["give", "clear"],
      effect: EFFECTS,
      xpop: ["add", "set", "query"],
      xpunit: ["points", "levels"]
    }[kind] || [];
  }
  return opts.filter((o) => o.toLowerCase().startsWith(last2.toLowerCase())).slice(0, 40).map((o) => head + o);
}

// core/server.ts
var MODES = ["survival", "creative", "spectator"];
var DIFFICULTIES = ["peaceful", "easy", "normal", "hard"];
var WEATHER = ["clear", "rain", "thunder"];
var DEFAULT_RULES = { keepInventory: false, doDaylightCycle: true, mobGriefing: true, doMobSpawning: true, doWeatherCycle: true, fallDamage: true };
var EFFECTS = ["speed", "jump_boost", "regeneration", "strength", "resistance", "instant_health"];
var key = (x, z) => x + "," + z;
var spirals = /* @__PURE__ */ new Map();
function spiral(r) {
  let s = spirals.get(r);
  if (!s) {
    s = [];
    for (let z = -r; z <= r; z++) for (let x = -r; x <= r; x++) if (x * x + z * z <= (r + 0.5) ** 2) s.push([x, z, x * x + z * z]);
    s.sort((a, b) => a[2] - b[2]);
    spirals.set(r, s);
  }
  return s;
}
var ServerWorld = class {
  chunks = /* @__PURE__ */ new Map();
  edits = /* @__PURE__ */ new Map();
  changed = [];
  constructor(edits) {
    for (const k in edits || {}) {
      const m = /* @__PURE__ */ new Map(), e = edits[k];
      for (let i = 0; i < e.length; i += 2) m.set(e[i], e[i + 1]);
      this.edits.set(k, m);
    }
  }
  chunk(cx, cz) {
    const k = key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = generateChunk(cx, cz);
      const e = this.edits.get(k);
      if (e) for (const [i, b] of e) c[i] = b;
      this.chunks.set(k, c);
    }
    return c;
  }
  isLoaded(x, z) {
    return this.chunks.has(key(Math.floor(x / CS), Math.floor(z / CS)));
  }
  getBlock(x, y, z) {
    if (y < 0) return 3;
    if (y >= CH) return 0;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS), c = this.chunks.get(key(cx, cz));
    return c ? c[x - cx * CS + (z - cz * CS) * CS + y * CS * CS] : 0;
  }
  setBlock(x, y, z, b) {
    if (y < 1 || y >= CH) return false;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS), k = key(cx, cz), i = x - cx * CS + (z - cz * CS) * CS + y * CS * CS;
    const c = this.chunk(cx, cz);
    if (c[i] === b) return false;
    c[i] = b;
    let m = this.edits.get(k);
    if (!m) this.edits.set(k, m = /* @__PURE__ */ new Map());
    m.set(i, b);
    this.changed.push(x, y, z, b);
    return true;
  }
  editsJSON() {
    const o = {};
    for (const [k, m] of this.edits) {
      const a = [];
      for (const [i, b] of m) a.push(i, b);
      o[k] = a;
    }
    return o;
  }
};
var SPlayer = class {
  id = 0;
  name = "";
  skin = 0;
  pos = [0, 0, 0];
  yaw = 0;
  pitch = 0;
  mode = 0;
  inv = new Inventory();
  slot = 0;
  health = 20;
  hunger = 20;
  air = 10;
  exhaustion = 0;
  xp = 0;
  bed = null;
  dead = false;
  op = false;
  local = false;
  hurtCd = 0;
  headInWater = false;
  flying = false;
  moving = 0;
  onGround = true;
  tpSeq = 0;
  viewDist = 6;
  effects = /* @__PURE__ */ new Map();
  cursor = null;
  craft = [];
  window = 0;
  furnace = null;
  breaking = null;
  sent = /* @__PURE__ */ new Set();
  known = /* @__PURE__ */ new Map();
  invDirty = true;
  lastState = "";
  send = () => {
  };
  joined = false;
  swing = 0;
  w = 0.3;
  h = 1.8;
};
var GameServer = class {
  constructor(rec3, host, cfg2) {
    this.rec = rec3;
    this.host = host;
    this.cfg = cfg2;
    configure({ seed: rec3.seed, scene: rec3.scene || null });
    const s = rec3.state || {};
    this.world = new ServerWorld(rec3.edits);
    this.time = s.time ?? 7.5;
    this.weather = s.weather ?? 0;
    this.weatherT = s.weatherT ?? 9e3 + Math.random() * 9e3;
    this.rules = { ...DEFAULT_RULES, ...s.rules || {} };
    this.difficulty = s.difficulty ?? 2;
    if (s.timeRunning === false) this.rules.doDaylightCycle = false;
    this.spawn = s.spawn || [8, surfaceY(8, 8), 8];
    this.furnaces = new Map(s.furnaces || []);
    this.cheats = !!rec3.cheats;
    this.saved = rec3.players || {};
    for (const d of s.drops || []) if (ITEMS[d.item.id]) {
      const e = new Drop(d.item, d.pos[0], d.pos[1], d.pos[2], [0, 0, 0]);
      e.ttl = d.ttl;
      this.addDrop(e);
    }
  }
  rec;
  host;
  cfg;
  world;
  players = /* @__PURE__ */ new Map();
  mobs = [];
  drops = [];
  furnaces;
  time;
  weather = 0;
  weatherT = 12e3;
  rules;
  difficulty = 2;
  spawn;
  tickN = 0;
  nextId = 1;
  cheats;
  saved;
  log(m) {
    this.host.log?.(m);
  }
  isDay() {
    return this.time > 5.6 && this.time < 18.9;
  }
  mobDamage() {
    return [0, 0.5, 1, 1.5][this.difficulty];
  }
  addMob(m) {
    m.id = this.nextId++;
    this.mobs.push(m);
    return m;
  }
  addDrop(d) {
    d.id = this.nextId++;
    this.drops.push(d);
    return d;
  }
  spawnDrop(id, n, d, x, y, z, vel) {
    return this.addDrop(new Drop(mk(id, n, d), x, y, z, vel));
  }
  nearestPlayer(p) {
    let best = null, bd = 1e9;
    for (const pl of this.players.values()) {
      if (!pl.joined || pl.mode === 2) continue;
      const d = Math.hypot(pl.pos[0] - p[0], pl.pos[2] - p[2]);
      if (d < bd) {
        bd = d;
        best = pl;
      }
    }
    return best;
  }
  canTarget(pl) {
    return pl.mode === 0 && !pl.dead;
  }
  canPickup(pl) {
    return pl.joined && !pl.dead && pl.mode !== 2;
  }
  findPlayer(name) {
    for (const p of this.players.values()) if (p.joined && p.name.toLowerCase() === name.toLowerCase()) return p;
    return null;
  }
  isOp(p) {
    return !p || p.local || p.op;
  }
  // ---- Verbindungen ----
  connect(send, local = false) {
    const p = new SPlayer();
    p.id = this.nextId++;
    p.send = send;
    p.local = local;
    p.viewDist = this.cfg.viewDistance;
    this.players.set(p.id, p);
    return { recv: (buf) => {
      try {
        this.handle(p, new Reader(buf));
      } catch (e) {
        this.log("Fehlerhafte Nachricht von " + (p.name || p.id) + ": " + e.message);
      }
    }, close: () => this.disconnect(p) };
  }
  disconnect(p) {
    if (!this.players.delete(p.id)) return;
    if (!p.joined) return;
    this.returnWindow(p);
    this.storePlayer(p);
    this.broadcast(new Writer(S.PLAYER_INFO).u32(p.id).u8(0).end());
    this.chat(`${p.name} hat das Spiel verlassen`, 2);
    this.save();
  }
  kick(p, reason) {
    p.send(new Writer(S.KICK).str(reason).end());
    this.disconnect(p);
  }
  broadcast(buf, except) {
    for (const p of this.players.values()) if (p.joined && p !== except) p.send(buf);
  }
  // Farben: 0 normal, 1 Fehler, 2 System, 3 Befehlsausgabe
  tell(p, text, color = 3) {
    if (p) p.send(new Writer(S.CHAT).u8(color).str(text).end());
    else this.log(text);
  }
  chat(text, color = 0) {
    this.broadcast(new Writer(S.CHAT).u8(color).str(text).end());
    this.log(text);
  }
  storePlayer(p) {
    this.saved[p.name] = { pos: p.pos.slice(), yaw: p.yaw, pitch: p.pitch, mode: p.mode, inv: p.inv.toJSON(), slot: p.slot, health: p.health, hunger: p.hunger, air: p.air, xp: p.xp, bed: p.bed, dead: p.dead, flying: p.flying, op: p.op, skin: p.skin };
  }
  join(p, r) {
    const ver = r.u8();
    let name = r.str().replace(/[^\wäöüÄÖÜß-]/g, "").slice(0, 16) || "Spieler";
    p.skin = r.u8() % 6;
    p.viewDist = Math.max(2, Math.min(this.cfg.viewDistance, r.u8()));
    if (ver !== PROTOCOL_VERSION) return this.kick(p, "Unterschiedliche Spielversion \u2013 bitte Seite neu laden");
    if (this.cfg.whitelist && !p.local && !this.cfg.whitelist.some((n2) => n2.toLowerCase() === name.toLowerCase())) return this.kick(p, "Du stehst nicht auf der Whitelist");
    let n = 0;
    for (const o of this.players.values()) if (o.joined) n++;
    if (n >= this.cfg.maxPlayers) return this.kick(p, "Der Server ist voll");
    const base = name;
    let k = 2;
    while (this.findPlayer(name)) name = base.slice(0, 14) + k++;
    p.name = name;
    p.op = p.local || this.cfg.ops.some((o) => o.toLowerCase() === name.toLowerCase());
    const s = this.saved[name];
    if (s) {
      Object.assign(p, { pos: s.pos.slice(), yaw: s.yaw, pitch: s.pitch, mode: s.mode, slot: s.slot, health: s.health, hunger: s.hunger, air: s.air, xp: s.xp || 0, bed: s.bed, flying: s.flying });
      p.inv.load(s.inv);
      p.op = p.op || !!s.op;
    } else {
      p.mode = Math.max(0, MODES.indexOf(this.rec.mode));
      p.pos = [this.spawn[0] + 0.5, this.spawn[1] + 0.01, this.spawn[2] + 0.5];
      if (p.mode === 1) [B.GRASS, B.STONE, B.PLANKS, B.LOG, B.BRICKS, B.BASALT_VIOLET, B.WORKBENCH, B.FURNACE, toolId(3, 3)].forEach((id, i) => {
        p.inv.slots[i] = mk(id, 1);
      });
    }
    p.joined = true;
    p.send(new Writer(S.WELCOME).u32(p.id).i32(this.rec.seed).str(this.rec.scene || "").str(p.name).str(this.rec.name || "Welt").u8(this.cheats ? 1 : 0).end());
    for (const o of this.players.values()) if (o.joined) {
      const info = new Writer(S.PLAYER_INFO).u32(o.id).u8(1).str(o.name).u8(o.skin).end();
      if (o === p) this.broadcast(info);
      else p.send(info);
    }
    this.teleport(p, p.pos[0], p.pos[1], p.pos[2], p.yaw, p.pitch);
    this.sendTime(p);
    if (s && s.dead) this.respawn(p);
    this.chat(`${p.name} ist beigetreten`, 2);
  }
  teleport(p, x, y, z, yaw = p.yaw, pitch = p.pitch) {
    p.pos = [x, y, z];
    p.yaw = yaw;
    p.pitch = pitch;
    p.tpSeq = p.tpSeq + 1 & 255;
    p.send(new Writer(S.TELEPORT).u8(p.tpSeq).f32(x).f32(y).f32(z).f32(yaw).f32(pitch).end());
  }
  sendTime(p) {
    const b = new Writer(S.TIME).f32(this.time).u8(this.weather).u8(this.rules.doDaylightCycle ? 1 : 0).u8(this.difficulty).end();
    if (p) p.send(b);
    else this.broadcast(b);
  }
  handle(p, r) {
    const t = r.u8();
    if (t === C.HELLO) {
      if (!p.joined) this.join(p, r);
      return;
    }
    if (!p.joined) return;
    switch (t) {
      case C.MOVE: {
        const seq = r.u8(), x = r.f32(), y = r.f32(), z = r.f32(), yaw = r.f32(), pitch = r.f32(), f = r.u8();
        if (seq !== p.tpSeq || p.dead || ![x, y, z, yaw, pitch].every(Number.isFinite)) return;
        p.moving = Math.hypot(x - p.pos[0], z - p.pos[2]);
        p.pos[0] = x;
        p.pos[1] = y;
        p.pos[2] = z;
        p.yaw = yaw;
        p.pitch = pitch;
        p.onGround = !!(f & 1);
        p.headInWater = !!(f & 2);
        p.flying = !!(f & 4) && p.mode !== 0;
        break;
      }
      case C.FALL: {
        const d = r.f32();
        if (p.mode === 0 && this.rules.fallDamage && d > 3.5 && d < 400) this.hurtPlayer(p, Math.floor(d - 3), null, true);
        break;
      }
      case C.BREAK_START:
        p.breaking = { k: r.i32() + "," + r.i32() + "," + r.i32(), t: this.tickN };
        break;
      case C.BREAK_STOP:
        p.breaking = null;
        break;
      case C.BREAK_DONE:
        this.breakBlock(p, r.i32(), r.i32(), r.i32());
        break;
      case C.USE: {
        const has = r.u8();
        this.use(p, !!has, [r.i32(), r.i32(), r.i32()], [r.i32(), r.i32(), r.i32()], !!r.u8());
        break;
      }
      case C.ATTACK:
        this.attack(p, r.u32());
        break;
      case C.SLOT:
        p.slot = r.u8() % 9;
        p.breaking = null;
        break;
      case C.OPEN_INV:
        this.openWindow(p, 1, null);
        break;
      case C.CLOSE_INV:
        this.returnWindow(p);
        break;
      case C.INV_CLICK:
        this.invClick(p, r.str(), !!r.u8());
        break;
      case C.PALETTE: {
        const id = r.u16();
        if (p.mode !== 1) return;
        p.inv.slots[p.slot] = id && ITEMS[id] ? mk(id, ITEMS[id].stack) : null;
        p.invDirty = true;
        break;
      }
      case C.CHAT: {
        const text = r.str().slice(0, 256).trim();
        if (!text) return;
        if (text[0] === "/") runCommand(this, p, text);
        else this.chat(`<${p.name}> ${text}`);
        break;
      }
      case C.TAB:
        p.send(new Writer(S.TAB).str(JSON.stringify(complete(this, p, r.str()))).end());
        break;
      case C.RESPAWN:
        if (p.dead) this.respawn(p);
        break;
      case C.VIEW:
        p.viewDist = Math.max(2, Math.min(this.cfg.viewDistance, r.u8()));
        break;
      case C.PING:
        p.send(new Writer(S.PONG).u32(r.u32()).end());
        break;
    }
  }
  // ---- Aktionen ----
  held(p) {
    return p.inv.slots[p.slot];
  }
  heldTool(p) {
    const h = this.held(p);
    return h ? ITEMS[h.id].tool || null : null;
  }
  reach(p, x, y, z) {
    return Math.hypot(x + 0.5 - p.pos[0], y + 0.5 - p.pos[1] - 1.6, z + 0.5 - p.pos[2]) < 8;
  }
  useTool(p) {
    const h = this.held(p);
    if (!h || !ITEMS[h.id].tool || p.mode !== 0) return;
    if (--h.d <= 0) {
      p.inv.slots[p.slot] = null;
      this.tell(p, ITEMS[h.id].name + " ist zerbrochen", 2);
    }
    p.invDirty = true;
  }
  breakBlock(p, x, y, z) {
    if (p.dead || p.mode === 2 || !this.reach(p, x, y, z)) return;
    const block2 = this.world.getBlock(x, y, z);
    if (!isSolid(block2)) return;
    if (p.mode === 0) {
      const k = x + "," + y + "," + z, need = breakTime(block2, this.heldTool(p)) * 20 * 0.7 - 2;
      if (!p.breaking || p.breaking.k !== k || this.tickN - p.breaking.t < need) return this.resend(p, x, y, z);
    }
    p.breaking = null;
    const tool = this.heldTool(p);
    if (!this.world.setBlock(x, y, z, 0)) return;
    const fk = x + "," + y + "," + z, f = this.furnaces.get(fk);
    if (f) {
      for (const s of [f.in, f.fuel, f.out]) if (s) this.spawnDrop(s.id, s.n, s.d, x + 0.5, y + 0.5, z + 0.5);
      this.furnaces.delete(fk);
      for (const o of this.players.values()) if (o.furnace === f) this.returnWindow(o);
    }
    for (const o of this.players.values()) if (o.bed && o.bed[0] === x && o.bed[1] === y && o.bed[2] === z) o.bed = null;
    if (p.mode !== 0) return;
    const d = dropFor(block2, tool);
    if (d) this.spawnDrop(d[0], d[1], void 0, x + 0.5, y + 0.4, z + 0.5);
    if (block2 === B.COAL_ORE) p.xp += 1;
    else if (block2 === B.DIAMOND_ORE) p.xp += 5;
    this.useTool(p);
    p.exhaustion += 0.03;
  }
  resend(p, x, y, z) {
    p.send(new Writer(S.BLOCKS).u16(1).i32(x).u8(y).i32(z).u8(this.world.getBlock(x, y, z)).end());
  }
  use(p, has, hit, prev, first) {
    if (p.dead || p.mode === 2) return;
    if (has && first && this.reach(p, hit[0], hit[1], hit[2])) {
      const b = this.world.getBlock(hit[0], hit[1], hit[2]), k = hit.join(",");
      if (b === B.WORKBENCH) return this.openWindow(p, 2, null);
      if (b === B.FURNACE) {
        if (!this.furnaces.has(k)) this.furnaces.set(k, { in: null, fuel: null, out: null, burn: 0, burnMax: 1, cook: 0 });
        return this.openWindow(p, 3, this.furnaces.get(k));
      }
      if (b === B.BED) return this.sleep(p, hit);
    }
    const h = this.held(p);
    if (!h) return;
    const it = ITEMS[h.id];
    if (it.food) {
      if (!first || p.mode !== 0) return;
      if (p.hunger >= 20) return this.tell(p, "Du bist satt", 2);
      p.hunger = Math.min(20, p.hunger + it.food);
      p.inv.take(p.slot, 1);
      p.invDirty = true;
      return;
    }
    if (!it.block || !has) return;
    const [x, y, z] = prev;
    if (!this.reach(p, x, y, z) || isSolid(this.world.getBlock(x, y, z))) return;
    const hits = (e) => x + 1 > e.pos[0] - e.w && x < e.pos[0] + e.w && y + 1 > e.pos[1] && y < e.pos[1] + e.h && z + 1 > e.pos[2] - e.w && z < e.pos[2] + e.w;
    for (const o of this.players.values()) if (o.joined && o.mode !== 2 && hits(o)) return this.resend(p, x, y, z);
    for (const m of this.mobs) if (!m.dead && hits(m)) return this.resend(p, x, y, z);
    if (!this.world.setBlock(x, y, z, h.id)) return;
    if (p.mode === 0) {
      p.inv.take(p.slot, 1);
      p.invDirty = true;
    }
  }
  sleep(p, at) {
    p.bed = at.slice();
    if (this.isDay() && this.weather !== 2) return this.tell(p, "Spawnpunkt gesetzt \u2013 schlafen geht nur nachts", 2);
    this.time = 6;
    this.weather = 0;
    this.mobs.forEach((m) => {
      if (m.def.hostile) m.dead = true;
    });
    this.sendTime();
    this.chat(`${p.name} hat die Nacht \xFCbersprungen`, 2);
  }
  attack(p, id) {
    if (p.dead || p.mode === 2 || this.tickN - p.swing < 6) return;
    const m = this.mobs.find((e) => e.id === id && !e.dead);
    if (!m || Math.hypot(m.pos[0] - p.pos[0], m.pos[1] - p.pos[1], m.pos[2] - p.pos[2]) > 6) return;
    p.swing = this.tickN;
    const t = this.heldTool(p), st = this.effect(p, "strength"), dx = m.pos[0] - p.pos[0], dz = m.pos[2] - p.pos[2], l = Math.hypot(dx, dz) || 1;
    const killed = m.damage(p.mode === 1 ? 999 : (t ? t.dmg : 1) + (st ? 3 * (st.amp + 1) : 0), dx / l, dz / l, this);
    if (killed && p.mode === 0) p.xp += m.def.hostile ? 5 : 2;
    this.useTool(p);
    p.exhaustion += 0.05;
  }
  effect(p, name) {
    const e = p.effects.get(name);
    return e && e.until > this.tickN ? e : null;
  }
  // ---- Inventarfenster (Server hält Hand-Stapel und Crafting-Raster) ----
  openWindow(p, kind, furnace) {
    this.returnWindow(p);
    p.window = kind;
    p.furnace = furnace;
    p.craft = new Array(kind === 2 ? 9 : 4).fill(null);
    p.invDirty = true;
    p.send(new Writer(S.OPEN).u8(kind).end());
  }
  returnWindow(p) {
    for (const s of [...p.craft, p.cursor]) if (s) {
      const left = p.inv.add(s.id, s.n, s.d);
      if (left > 0) this.spawnDrop(s.id, left, s.d, p.pos[0], p.pos[1] + 1, p.pos[2]);
    }
    if (p.window) p.send(new Writer(S.OPEN).u8(0).end());
    p.craft = [];
    p.cursor = null;
    p.window = 0;
    p.furnace = null;
    p.invDirty = true;
  }
  recipe(p) {
    return p.craft.length ? matchRecipe(p.craft.map((s) => s ? s.id : 0), p.craft.length === 9 ? 3 : 2) : null;
  }
  invClick(p, ref, single) {
    if (!p.window || p.dead) return;
    const [k, is] = ref.split(":"), i = +is;
    const get = () => k === "inv" ? p.inv.slots[i] : k === "craft" ? p.craft[i] : p.furnace?.[k];
    const set = (v) => {
      if (k === "inv") p.inv.slots[i] = v;
      else if (k === "craft") p.craft[i] = v;
      else if (p.furnace) p.furnace[k] = v;
    };
    if (k === "inv" ? !(i >= 0 && i < 36) : k === "craft" ? !(i >= 0 && i < p.craft.length) : k === "result" ? false : !(p.furnace && ["in", "fuel", "out"].includes(k))) return;
    let h = p.cursor;
    if (k === "result") {
      const r = this.recipe(p);
      if (!r) return;
      if (h && (h.id !== r.out || h.n + r.n > ITEMS[r.out].stack)) return;
      if (h) h.n += r.n;
      else h = mk(r.out, r.n);
      p.craft.forEach((s, j) => {
        if (s && --s.n <= 0) p.craft[j] = null;
      });
    } else {
      const s = get(), max = (x) => ITEMS[x.id].stack;
      if (!h) {
        if (s) {
          if (single && s.n > 1) {
            const n = Math.ceil(s.n / 2);
            h = { ...s, n };
            s.n -= n;
          } else {
            h = s;
            set(null);
          }
        }
      } else if (k === "out") {
        if (s && s.id === h.id && h.n + s.n <= max(h)) {
          h.n += s.n;
          set(null);
        }
      } else if (!s) {
        if (single && h.n > 1) {
          set({ ...h, n: 1 });
          h.n--;
        } else {
          set(h);
          h = null;
        }
      } else if (s.id === h.id && max(s) > 1) {
        const n = Math.min(single ? 1 : h.n, max(s) - s.n);
        s.n += n;
        h.n -= n;
        if (h.n <= 0) h = null;
      } else {
        set(h);
        h = s;
      }
    }
    p.cursor = h;
    p.invDirty = true;
    if (p.furnace) {
      for (const o of this.players.values()) if (o.furnace === p.furnace) o.invDirty = true;
    }
  }
  sendInv(p) {
    const w = new Writer(S.INV, 256);
    for (let i = 0; i < 36; i++) w.slot(p.inv.slots[i]);
    w.u8(p.slot).u8(p.window).slot(p.cursor).u8(p.craft.length);
    for (const s of p.craft) w.slot(s);
    const r = this.recipe(p);
    w.slot(r ? { id: r.out, n: r.n } : null);
    const f = p.furnace;
    if (f) w.u8(1).slot(f.in).slot(f.fuel).slot(f.out).u16(f.cook).u16(Math.max(0, f.burn)).u16(f.burnMax);
    else w.u8(0);
    p.send(w.end());
  }
  // ---- Leben ----
  hurtPlayer(p, n, knock, force = false) {
    if (p.mode !== 0 || p.dead || p.hurtCd > 0 && !force || n <= 0) return;
    const res = this.effect(p, "resistance");
    if (res) n *= Math.max(0, 1 - 0.2 * (res.amp + 1));
    p.health -= n;
    p.hurtCd = 10;
    if (knock) p.send(new Writer(S.VELOCITY).f32(knock[0] * 7).f32(5).f32(knock[1] * 7).end());
    if (p.health <= 0) this.die(p);
  }
  die(p, msg) {
    if (p.dead) return;
    p.health = 0;
    p.dead = true;
    p.breaking = null;
    this.returnWindow(p);
    if (!this.rules.keepInventory) {
      p.inv.slots.forEach((s, i) => {
        if (!s) return;
        const d = this.spawnDrop(s.id, s.n, s.d, p.pos[0], p.pos[1] + 0.8, p.pos[2]);
        d.ttl = 18e3;
        d.delay = 40;
        p.inv.slots[i] = null;
      });
      p.xp = 0;
      p.invDirty = true;
    }
    this.chat(msg || `${p.name} ist gestorben`, 2);
  }
  respawn(p) {
    let pos = [this.spawn[0] + 0.5, this.spawn[1] + 0.01, this.spawn[2] + 0.5];
    if (p.bed) {
      this.world.chunk(Math.floor(p.bed[0] / CS), Math.floor(p.bed[2] / CS));
      if (this.world.getBlock(p.bed[0], p.bed[1], p.bed[2]) === B.BED) pos = [p.bed[0] + 0.5, p.bed[1] + 1.01, p.bed[2] + 0.5];
      else p.bed = null;
    }
    p.health = 20;
    p.hunger = 20;
    p.air = 10;
    p.exhaustion = 0;
    p.dead = false;
    p.hurtCd = 40;
    this.teleport(p, pos[0], pos[1], pos[2]);
  }
  setMode(p, mode) {
    p.mode = mode;
    p.breaking = null;
    if (mode === 2) this.returnWindow(p);
    p.invDirty = true;
  }
  // ---- Tick (20 TPS) ----
  tick() {
    const n = ++this.tickN;
    if (this.rules.doDaylightCycle) this.time = (this.time + 24 / 24e3) % 24;
    if (this.rules.doWeatherCycle && --this.weatherT <= 0) {
      const r = Math.random();
      this.setWeather(this.weather ? 0 : r < 0.75 ? 1 : 2);
    }
    if (this.weather === 2 && Math.random() < 4e-3) this.broadcast(new Writer(S.FLASH).end());
    for (const m of this.mobs) if (!m.dead) m.tick(this);
    for (const d of this.drops) if (!d.dead) d.tick(this);
    for (const f of this.furnaces.values()) this.tickFurnace(f);
    if (n % 20 === 0) {
      if (this.difficulty === 0) {
        for (const m of this.mobs) if (m.def.hostile) m.dead = true;
      }
      this.mobs = this.mobs.filter((m) => !m.dead);
      this.drops = this.drops.filter((d) => !d.dead);
      this.sendTime();
    }
    for (const p of this.players.values()) if (p.joined) this.tickPlayer(p, n);
    this.flushBlocks();
    if (n % 2 === 0) {
      for (const p of this.players.values()) if (p.joined) this.sendEntities(p);
    }
    if (n % 300 === 0) {
      this.save();
      this.evict();
    }
  }
  setWeather(w, ticks) {
    this.weather = w;
    this.weatherT = ticks ?? (w ? 3e3 + Math.random() * 6e3 : 9e3 + Math.random() * 15e3);
    this.sendTime();
  }
  tickFurnace(f) {
    const res = f.in && SMELT[f.in.id], can = res && (!f.out || f.out.id === res && f.out.n < 64);
    if (f.burn <= 0 && can && f.fuel && FUEL[f.fuel.id]) {
      f.burn = f.burnMax = FUEL[f.fuel.id];
      if (--f.fuel.n <= 0) f.fuel = null;
    }
    if (f.burn > 0) {
      f.burn--;
      if (!can) f.cook = 0;
      else if (++f.cook >= SMELT_TICKS) {
        f.cook = 0;
        if (--f.in.n <= 0) f.in = null;
        if (f.out) f.out.n++;
        else f.out = mk(res, 1);
      }
    } else f.cook = 0;
  }
  tickPlayer(p, n) {
    if (p.hurtCd > 0) p.hurtCd--;
    const ccx = Math.floor(p.pos[0] / CS), ccz = Math.floor(p.pos[2] / CS);
    let budget = 2;
    for (const o of spiral(p.viewDist + 2)) {
      const k = key(ccx + o[0], ccz + o[1]);
      if (p.sent.has(k)) continue;
      p.sent.add(k);
      p.send(new Writer(S.CHUNK, 4096).i32(ccx + o[0]).i32(ccz + o[1]).bytes(rleEncode(this.world.chunk(ccx + o[0], ccz + o[1]))).end());
      if (--budget <= 0) break;
    }
    if (n % 100 === 0) for (const k of p.sent) {
      const [x, z] = k.split(",").map(Number);
      if (Math.max(Math.abs(x - ccx), Math.abs(z - ccz)) > p.viewDist + 4) p.sent.delete(k);
    }
    if (n % 40 === 0 && !p.dead && p.mode !== 2) trySpawn(this, p);
    if (p.mode === 0 && !p.dead) {
      if (this.difficulty > 0) p.exhaustion += p.moving > 0.3 ? 4e-3 : p.moving > 0.03 ? 15e-4 : 5e-4;
      if (p.exhaustion >= 1) {
        p.exhaustion -= 1;
        p.hunger = Math.max(0, p.hunger - 1);
      }
      if (n % 80 === 0) {
        if ((p.hunger >= 18 || this.difficulty === 0) && p.health < 20) {
          p.health = Math.min(20, p.health + 1);
          p.exhaustion += 0.4;
        } else if (p.hunger <= 0 && p.health > [20, 10, 1, 0][this.difficulty]) this.hurtPlayer(p, 1, null, true);
      }
      const reg = this.effect(p, "regeneration");
      if (reg && n % Math.max(5, Math.round(50 / (reg.amp + 1))) === 0 && p.health < 20) p.health = Math.min(20, p.health + 1);
      if (p.headInWater) {
        p.air = Math.max(0, p.air - 10 / 300);
        if (p.air <= 0 && n % 20 === 0) this.hurtPlayer(p, 2, null, true);
      } else p.air = Math.min(10, p.air + 0.25);
      if (p.pos[1] < -15) this.die(p, `${p.name} fiel aus der Welt`);
    }
    if (p.invDirty || p.furnace && n % 5 === 0) {
      p.invDirty = false;
      this.sendInv(p);
    }
    const sp = this.effect(p, "speed"), jp = this.effect(p, "jump_boost");
    const st = [p.mode, Math.ceil(p.health), p.hunger, Math.ceil(p.air * 2), p.dead ? 1 : 0, p.xp, (this.isOp(p) ? 1 : 0) | (this.cheats ? 2 : 0), sp ? sp.amp + 1 : 0, jp ? jp.amp + 1 : 0];
    const sig = st.join(",");
    if (sig !== p.lastState) {
      p.lastState = sig;
      p.send(new Writer(S.STATE).u8(st[0]).u8(Math.max(0, st[1])).u8(st[2]).u8(st[3]).u8(st[4]).u32(st[5]).u8(st[6]).u8(st[7]).u8(st[8]).end());
    }
  }
  flushBlocks() {
    const c = this.world.changed;
    if (!c.length) return;
    for (const p of this.players.values()) {
      if (!p.joined) continue;
      const w = new Writer(S.BLOCKS, 16 + c.length * 3);
      let cnt = 0;
      const at = w.n;
      w.u16(0);
      for (let i = 0; i < c.length; i += 4) if (p.sent.has(key(Math.floor(c[i] / CS), Math.floor(c[i + 2] / CS)))) {
        w.i32(c[i]).u8(c[i + 1]).i32(c[i + 2]).u8(c[i + 3]);
        if (++cnt === 65535) break;
      }
      if (cnt) {
        w.dv.setUint16(at, cnt, true);
        p.send(w.end());
      }
    }
    c.length = 0;
  }
  // nur geänderte Figuren im Umkreis senden; verschwundene abmelden
  sendEntities(p) {
    const w = new Writer(S.ENTS, 512), at = w.n;
    let cnt = 0;
    w.u16(0);
    const seen = /* @__PURE__ */ new Set();
    const put = (id, kind, data, pos, yaw, flags) => {
      if (Math.abs(pos[0] - p.pos[0]) > 72 || Math.abs(pos[2] - p.pos[2]) > 72) return;
      seen.add(id);
      const yb = Math.round((yaw % 6.2832 + 6.2832) % 6.2832 / 6.2832 * 255) & 255;
      const sig = `${Math.round(pos[0] * 16)},${Math.round(pos[1] * 16)},${Math.round(pos[2] * 16)},${yb},${flags},${data}`;
      if (p.known.get(id) === sig) return;
      p.known.set(id, sig);
      cnt++;
      w.u32(id).u8(kind).u16(data).f32(pos[0]).f32(pos[1]).f32(pos[2]).u8(yb).u8(flags);
    };
    for (const o of this.players.values()) if (o !== p && o.joined && o.mode !== 2 && !o.dead) put(o.id, 0, this.held(o)?.id || 0, o.pos, o.yaw, o.hurtCd > 6 ? 1 : 0);
    for (const m of this.mobs) if (!m.dead) put(m.id, 1, MOB_TYPES.indexOf(m.type), m.pos, m.yaw, m.hurt > 0 ? 1 : 0);
    for (const d of this.drops) if (!d.dead) put(d.id, 2, d.item.id, d.pos, 0, 0);
    if (cnt) {
      w.dv.setUint16(at, cnt, true);
      p.send(w.end());
    }
    let gone = null;
    for (const id of p.known.keys()) if (!seen.has(id)) {
      p.known.delete(id);
      (gone ||= new Writer(S.ENT_REMOVE)).u32(id);
    }
    if (gone) p.send(gone.end());
  }
  evict() {
    const keep = /* @__PURE__ */ new Set();
    for (const p of this.players.values()) for (const k of p.sent) keep.add(k);
    for (const k of this.world.chunks.keys()) if (!keep.has(k)) this.world.chunks.delete(k);
    this.mobs.forEach((m) => {
      if (!this.world.isLoaded(m.pos[0], m.pos[2])) m.dead = true;
    });
  }
  save() {
    for (const p of this.players.values()) if (p.joined) this.storePlayer(p);
    this.rec.players = this.saved;
    this.rec.edits = this.world.editsJSON();
    this.rec.played = Date.now();
    this.rec.cheats = this.cheats;
    this.rec.state = {
      time: this.time,
      weather: this.weather,
      weatherT: this.weatherT,
      rules: this.rules,
      difficulty: this.difficulty,
      spawn: this.spawn,
      furnaces: [...this.furnaces],
      drops: this.drops.filter((d) => !d.dead).map((d) => ({ item: d.item, pos: d.pos.slice(), ttl: d.ttl - d.age }))
    };
    if (!this.rec.temp) this.host.save(this.rec);
  }
};

// server/index.ts
var cfgPath = process.argv[2] || process.env.KANTENHAIN_CONFIG || "server.config.json";
var defaults = { port: 25580, maxPlayers: 8, whitelist: null, operators: [], worldName: "Serverwelt", seed: Math.floor(Math.random() * 2e9), gamemode: "survival", cheats: false, viewDistance: 8, worldFile: "world.json" };
var cfg = { ...defaults };
if (fs.existsSync(cfgPath)) cfg = { ...defaults, ...JSON.parse(fs.readFileSync(cfgPath, "utf8")) };
else {
  fs.writeFileSync(cfgPath, JSON.stringify(defaults, null, 2));
  console.log(`Konfiguration angelegt: ${cfgPath}`);
}
if (process.env.PORT) cfg.port = +process.env.PORT;
var worldFile = path.resolve(path.dirname(cfgPath), cfg.worldFile);
var rec2 = { id: "server", name: cfg.worldName, seed: cfg.seed, mode: cfg.gamemode, cheats: cfg.cheats };
if (fs.existsSync(worldFile)) {
  rec2 = JSON.parse(fs.readFileSync(worldFile, "utf8"));
  console.log(`Welt geladen: ${worldFile}`);
}
rec2.cheats = cfg.cheats;
var stamp = () => (/* @__PURE__ */ new Date()).toISOString().slice(11, 19);
var server = new GameServer(rec2, {
  save: (r) => {
    fs.writeFileSync(worldFile + ".tmp", JSON.stringify(r));
    fs.renameSync(worldFile + ".tmp", worldFile);
  },
  // erst temporär schreiben, dann ersetzen
  log: (m) => console.log(`[${stamp()}] ${m}`)
}, { maxPlayers: cfg.maxPlayers, whitelist: cfg.whitelist, ops: cfg.operators, viewDistance: cfg.viewDistance });
var wss = new WebSocketServer({ port: cfg.port, maxPayload: 64 * 1024 });
wss.on("connection", (ws) => {
  ws.binaryType = "arraybuffer";
  const c = server.connect((buf) => {
    if (ws.readyState === 1 && ws.bufferedAmount < 8e6) ws.send(buf);
  });
  ws.on("message", (d, isBinary) => {
    if (isBinary) c.recv(d);
  });
  ws.on("close", () => c.close());
  ws.on("error", () => c.close());
});
var last = Date.now();
var acc = 0;
setInterval(() => {
  const now = Date.now();
  acc += now - last;
  last = now;
  let n = 0;
  while (acc >= 50 && n++ < 5) {
    server.tick();
    acc -= 50;
  }
  if (acc >= 50) acc = 0;
}, 25);
console.log(`Kantenhain-Server l\xE4uft auf Port ${cfg.port} (max. ${cfg.maxPlayers} Spieler, Seed ${rec2.seed}). Befehle hier ohne "/" eingeben, "stop" beendet.`);
var stop = () => {
  server.save();
  console.log("Welt gespeichert, Server beendet.");
  process.exit(0);
};
if (process.stdin.isTTY || process.env.KANTENHAIN_CONSOLE) readline.createInterface({ input: process.stdin }).on("line", (l) => {
  l = l.trim();
  if (l === "stop") stop();
  else if (l) runCommand(server, null, l);
});
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
