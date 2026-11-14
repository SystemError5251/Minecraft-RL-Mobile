// Figuren (Gegner, Tiere) und Item-Drops. Alles hier läuft mit fester Tickrate (20 TPS), getrennt vom Rendern.
import { B, BLOCKS, isSolid } from './blocks.js';
import { ITEMS, I } from './items.js';
import { CH, CS } from './worldgen.js';

export const TICK = 1 / 20;

function collides(world, x, y, z, w, h) {
  for (let by = Math.floor(y); by <= Math.floor(y + h - 0.001); by++)
    for (let bz = Math.floor(z - w); bz <= Math.floor(z + w); bz++)
      for (let bx = Math.floor(x - w); bx <= Math.floor(x + w); bx++) if (isSolid(world.getBlock(bx, by, bz))) return true;
  return false;
}
// gemeinsame Körperphysik: Schwerkraft, Auftrieb im Wasser, achsenweise Kollision
export function stepBody(e, world) {
  const p = e.pos, v = e.vel;
  e.prev[0] = p[0]; e.prev[1] = p[1]; e.prev[2] = p[2];
  e.inWater = world.getBlock(Math.floor(p[0]), Math.floor(p[1] + 0.2), Math.floor(p[2])) === B.WATER;
  if (e.inWater) { v[1] = v[1] * 0.8 + 0.6; } else v[1] = Math.max(v[1] - 26 * TICK, -40);
  e.onGround = false; e.hitWall = false;
  for (const a of [1, 0, 2]) {
    const old = p[a]; p[a] += v[a] * TICK;
    if (!collides(world, p[0], p[1], p[2], e.w, e.h)) continue;
    p[a] = old;
    if (a === 1) { if (v[1] < 0) e.onGround = true; } else e.hitWall = true;
    v[a] = 0;
  }
}
const skyAbove = (world, x, y, z) => { for (let i = 1; i < 28 && y + i < CH; i++) if (isSolid(world.getBlock(x, y + i, z))) return false; return true; };

// ---- Figuren: Teile = [x, y, z, Breite, Höhe, Tiefe, r, g, b, Beinphase|null]; vorne ist -z ----
const eye = (x, y, z, c) => [x, y, z, 0.09, 0.07, 0.03, c[0], c[1], c[2], null];
export const MOBS = {
  wicht: {
    name: 'Schattenwicht', hostile: true, hp: 16, dmg: 3, speed: 2.7, w: 0.3, h: 1.75, drops: [[I.COAL, 0, 2]],
    parts: [[-0.13, 0.35, 0, 0.2, 0.7, 0.2, 0.07, 0.06, 0.12, 0], [0.13, 0.35, 0, 0.2, 0.7, 0.2, 0.07, 0.06, 0.12, 3.14], [0, 1.05, 0, 0.5, 0.7, 0.28, 0.12, 0.10, 0.20, null],
      [-0.33, 1.02, 0, 0.14, 0.72, 0.16, 0.09, 0.08, 0.15, 3.14], [0.33, 1.02, 0, 0.14, 0.72, 0.16, 0.09, 0.08, 0.15, 0], [0, 1.6, 0, 0.42, 0.4, 0.42, 0.14, 0.12, 0.24, null],
      eye(-0.1, 1.63, -0.215, [0.5, 2.6, 2.4]), eye(0.1, 1.63, -0.215, [0.5, 2.6, 2.4])],
  },
  krabbler: {
    name: 'Höhlenkrabbler', hostile: true, cave: true, hp: 10, dmg: 2, speed: 3.5, w: 0.42, h: 0.6, drops: [[I.STICK, 0, 2], [I.COAL, 0, 1]],
    parts: [[0, 0.32, 0, 0.8, 0.34, 0.9, 0.22, 0.09, 0.07, null], [0, 0.36, -0.52, 0.5, 0.26, 0.2, 0.3, 0.12, 0.08, null],
      [-0.47, 0.15, -0.26, 0.16, 0.3, 0.16, 0.12, 0.05, 0.04, 0], [0.47, 0.15, -0.26, 0.16, 0.3, 0.16, 0.12, 0.05, 0.04, 3.14], [-0.47, 0.15, 0.26, 0.16, 0.3, 0.16, 0.12, 0.05, 0.04, 3.14], [0.47, 0.15, 0.26, 0.16, 0.3, 0.16, 0.12, 0.05, 0.04, 0],
      eye(-0.14, 0.4, -0.63, [2.8, 0.7, 0.2]), eye(0.14, 0.4, -0.63, [2.8, 0.7, 0.2])],
  },
  koloss: {
    name: 'Steinkoloss', hostile: true, hp: 30, dmg: 5, speed: 1.7, w: 0.48, h: 2.25, drops: [[B.STONE, 1, 3], [I.IRON, 0, 1]],
    parts: [[-0.22, 0.45, 0, 0.34, 0.9, 0.36, 0.3, 0.31, 0.34, 0], [0.22, 0.45, 0, 0.34, 0.9, 0.36, 0.3, 0.31, 0.34, 3.14], [0, 1.4, 0, 0.95, 1.0, 0.55, 0.38, 0.39, 0.43, null],
      [-0.64, 1.3, 0, 0.3, 1.1, 0.34, 0.33, 0.34, 0.37, 3.14], [0.64, 1.3, 0, 0.3, 1.1, 0.34, 0.33, 0.34, 0.37, 0], [0, 2.07, -0.05, 0.42, 0.34, 0.4, 0.42, 0.43, 0.47, null],
      eye(-0.1, 2.08, -0.26, [2.6, 1.6, 0.3]), eye(0.1, 2.08, -0.26, [2.6, 1.6, 0.3])],
  },
  bock: {
    name: 'Wollbock', hp: 8, speed: 1.4, w: 0.38, h: 1.05, drops: [[I.MEAT_RAW, 1, 2]],
    parts: [[0, 0.72, 0, 0.56, 0.5, 0.95, 0.86, 0.83, 0.74, null], [0, 0.98, -0.6, 0.34, 0.34, 0.34, 0.25, 0.2, 0.17, null],
      [-0.18, 0.23, -0.3, 0.14, 0.46, 0.14, 0.25, 0.2, 0.17, 0], [0.18, 0.23, -0.3, 0.14, 0.46, 0.14, 0.25, 0.2, 0.17, 3.14], [-0.18, 0.23, 0.3, 0.14, 0.46, 0.14, 0.25, 0.2, 0.17, 3.14], [0.18, 0.23, 0.3, 0.14, 0.46, 0.14, 0.25, 0.2, 0.17, 0],
      [-0.16, 1.2, -0.58, 0.07, 0.14, 0.07, 0.8, 0.75, 0.6, null], [0.16, 1.2, -0.58, 0.07, 0.14, 0.07, 0.8, 0.75, 0.6, null]],
  },
  hupfer: {
    name: 'Hüpfer', hp: 4, speed: 1.9, hop: true, w: 0.22, h: 0.62, drops: [[I.MEAT_RAW, 0, 1]],
    parts: [[0, 0.32, 0, 0.36, 0.34, 0.46, 0.78, 0.5, 0.2, null], [0, 0.56, -0.2, 0.26, 0.24, 0.26, 0.86, 0.6, 0.26, null], [0, 0.53, -0.37, 0.1, 0.07, 0.1, 0.95, 0.8, 0.2, null],
      [-0.1, 0.08, 0.02, 0.08, 0.16, 0.12, 0.9, 0.7, 0.2, 0], [0.1, 0.08, 0.02, 0.08, 0.16, 0.12, 0.9, 0.7, 0.2, 3.14], [0, 0.4, 0.27, 0.2, 0.1, 0.14, 0.6, 0.36, 0.14, null]],
  },
};

export class Mob {
  constructor(type, x, y, z) {
    const d = MOBS[type];
    Object.assign(this, { type, def: d, pos: [x, y, z], prev: [x, y, z], vel: [0, 0, 0], w: d.w, h: d.h, yaw: Math.random() * 6.28, hp: d.hp, phase: 0, hurt: 0, cd: 0, wanderT: 0, moving: false, dirX: 0, dirZ: 0, avoidT: 0, avoidS: 1, stuck: 0, lit: 1, age: 0, dead: false });
  }
  tick(g) {
    const d = this.def, p = this.pos, world = g.world;
    this.age++;
    if (this.hurt > 0) this.hurt--;
    if (this.cd > 0) this.cd--;
    const near = g.nearestPlayer(p), pl = near ? near.pos : p; // nächster Spieler (für Verfolgung und Verschwinden)
    const dx = pl[0] - p[0], dz = pl[2] - p[2], dy = pl[1] - p[1], dist = near ? Math.hypot(dx, dz) : 999;
    const chase = d.hostile && near && g.canTarget(near) && dist < 26 && Math.abs(dy) < 12;
    let sp = 0;
    if (chase) { this.dirX = dx / (dist || 1); this.dirZ = dz / (dist || 1); sp = dist > 0.9 ? d.speed : 0; }
    else {
      if (--this.wanderT <= 0) { this.wanderT = 40 + Math.random() * 80; this.moving = Math.random() < 0.6; const a = Math.random() * 6.283; this.dirX = Math.sin(a); this.dirZ = Math.cos(a); }
      sp = this.moving ? d.speed * 0.5 : 0;
    }
    // einfache Wegfindung: Stufen hochspringen, bei Blockade eine Weile seitlich ausweichen
    let mx = this.dirX, mz = this.dirZ;
    if (this.avoidT > 0) { this.avoidT--; const t = mx; mx = -mz * this.avoidS * 0.9 + mx * 0.3; mz = t * this.avoidS * 0.9 + mz * 0.3; }
    const k = this.onGround || this.inWater ? 0.35 : 0.08;
    this.vel[0] += (mx * sp - this.vel[0]) * k; this.vel[2] += (mz * sp - this.vel[2]) * k;
    if (sp > 0) {
      if (this.hitWall && this.onGround) {
        const fx = Math.floor(p[0] + mx * (this.w + 0.5)), fz = Math.floor(p[2] + mz * (this.w + 0.5)), fy = Math.floor(p[1] + 0.1);
        const high = isSolid(world.getBlock(fx, fy + 1, fz)) || isSolid(world.getBlock(fx, fy + Math.ceil(this.h), fz));
        if (!high) this.vel[1] = 8.2; else if (this.avoidT <= 0) { this.avoidT = 24 + Math.random() * 20; this.avoidS = Math.random() < 0.5 ? 1 : -1; if (!chase) this.wanderT = 0; }
      } else if (d.hop && this.onGround && this.age % 12 === 0) this.vel[1] = 5.5;
      this.yaw = Math.atan2(mx, -mz);
      this.phase += Math.hypot(this.vel[0], this.vel[2]) * 0.22;
    }
    if (this.inWater) this.vel[1] = Math.max(this.vel[1], 1.2);
    stepBody(this, world);
    if (chase && dist < this.w + 0.95 && dy > -this.h - 0.2 && dy < 1.9 && this.cd <= 0) { this.cd = 30; g.hurtPlayer(near, d.dmg * g.mobDamage(), [dx / (dist || 1), dz / (dist || 1)]); }
    if (this.age % 10 === 0) {
      this.lit = skyAbove(world, Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])) ? 1 : 0.22;
      // Gegner lösen sich im Tageslicht auf; weit entfernte Figuren verschwinden
      if (d.hostile && this.lit === 1 && g.isDay()) { this.hp -= 2; this.hurt = 4; if (this.hp <= 0) this.dead = true; }
      if (dist > (d.hostile ? 72 : 110) || p[1] < -10) this.dead = true;
    }
  }
  damage(n, kx, kz, g) {
    this.hp -= n; this.hurt = 6; this.vel[0] = kx * 6; this.vel[2] = kz * 6; this.vel[1] = 5;
    if (this.hp > 0) return false;
    this.dead = true;
    for (const [id, a, b] of this.def.drops) { const c = a + Math.floor(Math.random() * (b - a + 1)); if (c > 0) g.spawnDrop(id, c, undefined, this.pos[0], this.pos[1] + 0.4, this.pos[2]); }
    return true;
  }
}

export class Drop {
  constructor(item, x, y, z, vel) {
    Object.assign(this, { item, pos: [x, y, z], prev: [x, y, z], vel: vel || [(Math.random() - 0.5) * 2.4, 3.2, (Math.random() - 0.5) * 2.4], w: 0.12, h: 0.24, age: 0, delay: 12, ttl: 6000, dead: false, lit: 1 });
  }
  tick(g) {
    this.age++;
    stepBody(this, g.world);
    if (this.onGround) { this.vel[0] *= 0.6; this.vel[2] *= 0.6; }
    if (this.age % 20 === 0) this.lit = skyAbove(g.world, Math.floor(this.pos[0]), Math.floor(this.pos[1]), Math.floor(this.pos[2])) ? 1 : 0.22;
    if (this.age > this.ttl || this.pos[1] < -10) { this.dead = true; return; }
    if (this.age < this.delay) return;
    for (const pl of g.players.values()) {
      if (!g.canPickup(pl)) continue;
      const d = Math.hypot(pl.pos[0] - this.pos[0], pl.pos[2] - this.pos[2]), dy = this.pos[1] - pl.pos[1];
      if (d < 1.5 && dy > -1.6 && dy < 2.3) {
        const left = pl.inv.add(this.item.id, this.item.n, this.item.d);
        if (left !== this.item.n) pl.invDirty = true;
        if (left <= 0) { this.dead = true; return; }
        this.item.n = left;
      } else if (d < 3 && Math.abs(dy) < 3) { const f = 0.25 / d; this.vel[0] += (pl.pos[0] - this.pos[0]) * f; this.vel[2] += (pl.pos[2] - this.pos[2]) * f; } // leichter Sog zum Spieler
    }
  }
}

// ---- Spawnen: nachts an der Oberfläche und jederzeit in Höhlen Gegner, tagsüber Tiere; Limit pro Chunk ----
const MAX_PER_CHUNK = 2, MAX_HOSTILE = 6, MAX_ANIMALS = 8;
export function trySpawn(g, player) {
  const world = g.world, pl = player.pos, a = Math.random() * 6.283, r = 24 + Math.random() * 24;
  const x = Math.floor(pl[0] + Math.sin(a) * r), z = Math.floor(pl[2] + Math.cos(a) * r);
  if (!world.isLoaded(x, z) || !g.rules.doMobSpawning) return;
  const cap = Math.max(1, g.players.size);
  const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
  let inChunk = 0, hostile = 0, animals = 0;
  for (const m of g.mobs) { if (Math.floor(m.pos[0] / CS) === cx && Math.floor(m.pos[2] / CS) === cz) inChunk++; if (m.def.hostile) hostile++; else animals++; }
  if (inChunk >= MAX_PER_CHUNK) return;
  let top = CH - 1;
  while (top > 1 && !isSolid(world.getBlock(x, top, z))) top--;
  const free = (y) => world.getBlock(x, y, z) === 0 && world.getBlock(x, y + 1, z) === 0 && world.getBlock(x, y + 2, z) === 0;
  const day = g.isDay(), peaceful = g.difficulty === 0;
  if (!peaceful && hostile < MAX_HOSTILE * cap && Math.random() < 0.5 && top > 16) { // Höhle: von zufälliger Tiefe nach unten einen Boden suchen
    let y = 6 + Math.floor(Math.random() * Math.max(1, top - 14));
    for (let i = 0; i < 14 && y > 3; i++, y--) if (isSolid(world.getBlock(x, y - 1, z)) && free(y)) { g.addMob(new Mob(Math.random() < 0.7 ? 'krabbler' : 'koloss', x + 0.5, y, z + 0.5)); return; }
    return;
  }
  if (!free(top + 1)) return;
  const ground = world.getBlock(x, top, z);
  if (!day && !peaceful && hostile < MAX_HOSTILE * cap) g.addMob(new Mob(Math.random() < 0.72 ? 'wicht' : 'koloss', x + 0.5, top + 1, z + 0.5));
  else if (day && animals < MAX_ANIMALS * cap && ground === B.GRASS && Math.random() < 0.5) g.addMob(new Mob(Math.random() < 0.6 ? 'bock' : 'hupfer', x + 0.5, top + 1, z + 0.5));
}

// Strahl gegen die Figuren-Boxen (für Angriffe)
export function rayMobs(mobs, o, d, max) {
  let best = null, bt = max;
  for (const m of mobs) {
    const lo = [m.pos[0] - m.w - 0.1, m.pos[1], m.pos[2] - m.w - 0.1], hi = [m.pos[0] + m.w + 0.1, m.pos[1] + m.h + 0.1, m.pos[2] + m.w + 0.1];
    let t0 = 0, t1 = bt, ok = true;
    for (let a = 0; a < 3 && ok; a++) {
      if (Math.abs(d[a]) < 1e-6) { if (o[a] < lo[a] || o[a] > hi[a]) ok = false; continue; }
      let ta = (lo[a] - o[a]) / d[a], tb = (hi[a] - o[a]) / d[a]; if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) ok = false;
    }
    if (ok && t0 < bt) { bt = t0; best = m; }
  }
  return best ? { mob: best, dist: bt } : null;
}

// ---- Box-Batch für den Renderer: 13 Floats je Vertex (Position, Normale, UV+Layer, Farbe+Licht) ----
const FD = [[1, 0, 0, 0, 1, 0, 0, 0, 1], [-1, 0, 0, 0, 0, 1, 0, 1, 0], [0, 1, 0, 0, 0, 1, 1, 0, 0], [0, -1, 0, 1, 0, 0, 0, 0, 1], [0, 0, 1, 1, 0, 0, 0, 1, 0], [0, 0, -1, 0, 1, 0, 1, 0, 0]];
const CR = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
export class BoxBatch {
  constructor() { this.data = new Float32Array(13 * 24 * 256); this.n = 0; }
  reset() { this.n = 0; }
  // Box um (cx,cy,cz) mit Größe s*, um die Hochachse gedreht; layers = Texturlayer je Fläche oder null (dann Farbe)
  box(cx, cy, cz, sx, sy, sz, yaw, layers, r, g, b, lit) {
    if ((this.n + 24) * 13 > this.data.length) { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; }
    const c = Math.cos(yaw), s = Math.sin(yaw), D = this.data, h = [sx / 2, sy / 2, sz / 2];
    for (let f = 0; f < 6; f++) {
      const F = FD[f], nx = F[0] * c - F[2] * s, nz = F[0] * s + F[2] * c;
      for (let k = 0; k < 4; k++) {
        const a = CR[k][0], bb = CR[k][1];
        const lx = (F[0] + F[3] * a + F[6] * bb) * h[0], ly = (F[1] + F[4] * a + F[7] * bb) * h[1], lz = (F[2] + F[5] * a + F[8] * bb) * h[2];
        const o = this.n * 13;
        D[o] = cx + lx * c - lz * s; D[o + 1] = cy + ly; D[o + 2] = cz + lx * s + lz * c;
        D[o + 3] = nx; D[o + 4] = F[1]; D[o + 5] = nz;
        D[o + 6] = a * 0.5 + 0.5; D[o + 7] = 0.5 - bb * 0.5; D[o + 8] = layers ? layers[f] : -1;
        D[o + 9] = r; D[o + 10] = g; D[o + 11] = b; D[o + 12] = lit;
        this.n++;
      }
    }
  }
  // Figur zeichnen: def = MOBS[typ] oder Spieler-Modell; phase = Laufanimation; red = Trefferblitz
  addModel(def, x, y, z, yaw, phase, red, lit, tint) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const p of def.parts) {
      const oz = p[2] + (p[9] !== null ? Math.sin(phase + p[9]) * 0.14 : 0);
      const col = tint && p[10] ? tint[p[10] - 1] : p;
      const r = tint && p[10] ? col[0] : p[6], g = tint && p[10] ? col[1] : p[7], b = tint && p[10] ? col[2] : p[8];
      this.box(x + p[0] * c - oz * s, y + p[1], z + p[0] * s + oz * c, p[3], p[4], p[5], yaw, null, r + red * 0.8, g * (1 - red * 0.5), b * (1 - red * 0.5), lit);
    }
  }
  addItem(id, x, y, z, time, lit) {
    const it = ITEMS[id];
    if (!it) return;
    y += 0.2 + Math.sin(time * 2.4 + x) * 0.06;
    if (it.block) this.box(x, y, z, 0.3, 0.3, 0.3, time * 1.3, BLOCKS[id].faces, 1, 1, 1, lit);
    else this.box(x, y, z, 0.26, 0.26, 0.07, time * 1.3, null, it.color[0], it.color[1], it.color[2], lit);
  }
}
// Spieler-Modell: Teile mit Farbslot (11. Wert: 1 = Hemd, 2 = Hose, 3 = Haut, 4 = Haar) für einfache Skins
export const PLAYER_MODEL = { parts: [
  [-0.13, 0.36, 0, 0.22, 0.72, 0.22, 0, 0, 0, 0, 2], [0.13, 0.36, 0, 0.22, 0.72, 0.22, 0, 0, 0, 3.14, 2], [0, 1.08, 0, 0.5, 0.72, 0.26, 0, 0, 0, null, 1],
  [-0.35, 1.08, 0, 0.18, 0.72, 0.2, 0, 0, 0, 3.14, 3], [0.35, 1.08, 0, 0.18, 0.72, 0.2, 0, 0, 0, 0, 3], [0, 1.64, 0, 0.42, 0.4, 0.42, 0, 0, 0, null, 3], [0, 1.82, 0.02, 0.44, 0.1, 0.44, 0, 0, 0, null, 4],
  [-0.1, 1.66, -0.215, 0.07, 0.06, 0.02, 0.05, 0.05, 0.08, null], [0.1, 1.66, -0.215, 0.07, 0.06, 0.02, 0.05, 0.05, 0.08, null]] };
export const SKINS = [ // Hemd, Hose, Haut, Haar
  { name: 'Wald', c: [[0.2, 0.55, 0.25], [0.25, 0.2, 0.15], [0.85, 0.65, 0.5], [0.3, 0.18, 0.08]] }, { name: 'Ozean', c: [[0.15, 0.4, 0.75], [0.15, 0.17, 0.3], [0.6, 0.42, 0.3], [0.08, 0.06, 0.05]] },
  { name: 'Glut', c: [[0.8, 0.25, 0.15], [0.2, 0.2, 0.22], [0.93, 0.76, 0.62], [0.75, 0.55, 0.2]] }, { name: 'Sand', c: [[0.85, 0.72, 0.4], [0.4, 0.3, 0.2], [0.45, 0.3, 0.22], [0.1, 0.08, 0.07]] },
  { name: 'Violett', c: [[0.5, 0.25, 0.75], [0.18, 0.15, 0.25], [0.8, 0.6, 0.48], [0.9, 0.9, 0.85]] }, { name: 'Schiefer', c: [[0.35, 0.38, 0.42], [0.12, 0.13, 0.15], [0.7, 0.52, 0.4], [0.5, 0.2, 0.1]] }];
export const MOB_TYPES = Object.keys(MOBS);
