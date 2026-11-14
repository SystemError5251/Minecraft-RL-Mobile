// Autoritativer Server-Kern (ohne DOM). Läuft identisch im Web Worker (Einzelspieler / Host-Handy)
// und headless in Node.js (Dedicated Server). Spricht mit Clients ausschließlich das Binärprotokoll.
import { B, BLOCKS, isSolid } from '../src/blocks.js';
import { ITEMS, I, SMELT, FUEL, SMELT_TICKS, breakTime, dropFor, matchRecipe, toolId } from '../src/items.js';
import { Inventory, mk } from '../src/inventory.js';
import { Mob, Drop, trySpawn, MOB_TYPES } from '../src/entities.js';
import { configure, generateChunk, surfaceY, CS, CH } from '../src/worldgen.js';
import { C, S, Writer, Reader, rleEncode, PROTOCOL_VERSION } from '../src/protocol.js';
import { runCommand, complete } from './commands';

export interface Host { save(rec: any): void; log?(msg: string): void; }
export interface ServerConfig { maxPlayers: number; whitelist: string[] | null; ops: string[]; viewDistance: number; }
export const MODES = ['survival', 'creative', 'spectator'];
export const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard'];
export const WEATHER = ['clear', 'rain', 'thunder'];
export const DEFAULT_RULES: Record<string, boolean> = { keepInventory: false, doDaylightCycle: true, mobGriefing: true, doMobSpawning: true, doWeatherCycle: true, fallDamage: true };
export const EFFECTS = ['speed', 'jump_boost', 'regeneration', 'strength', 'resistance', 'instant_health'];
const key = (x: number, z: number) => x + ',' + z;
const spirals = new Map<number, number[][]>();
function spiral(r: number) {
  let s = spirals.get(r);
  if (!s) { s = []; for (let z = -r; z <= r; z++) for (let x = -r; x <= r; x++) if (x * x + z * z <= (r + 0.5) ** 2) s.push([x, z, x * x + z * z]); s.sort((a, b) => a[2] - b[2]); spirals.set(r, s); }
  return s;
}

// Welt auf dem Server: erzeugt Chunks bei Bedarf, merkt sich Änderungen (nur diese werden gespeichert)
export class ServerWorld {
  chunks = new Map<string, Uint8Array>(); edits = new Map<string, Map<number, number>>(); changed: number[] = [];
  constructor(edits: any) { for (const k in edits || {}) { const m = new Map<number, number>(), e = edits[k]; for (let i = 0; i < e.length; i += 2) m.set(e[i], e[i + 1]); this.edits.set(k, m); } }
  chunk(cx: number, cz: number) {
    const k = key(cx, cz); let c = this.chunks.get(k);
    if (!c) { c = generateChunk(cx, cz) as Uint8Array; const e = this.edits.get(k); if (e) for (const [i, b] of e) c[i] = b; this.chunks.set(k, c); }
    return c;
  }
  isLoaded(x: number, z: number) { return this.chunks.has(key(Math.floor(x / CS), Math.floor(z / CS))); }
  getBlock(x: number, y: number, z: number) {
    if (y < 0) return 3; if (y >= CH) return 0;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS), c = this.chunks.get(key(cx, cz));
    return c ? c[(x - cx * CS) + (z - cz * CS) * CS + y * CS * CS] : 0;
  }
  setBlock(x: number, y: number, z: number, b: number) {
    if (y < 1 || y >= CH) return false;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS), k = key(cx, cz), i = (x - cx * CS) + (z - cz * CS) * CS + y * CS * CS;
    const c = this.chunk(cx, cz);
    if (c[i] === b) return false;
    c[i] = b;
    let m = this.edits.get(k); if (!m) this.edits.set(k, (m = new Map()));
    m.set(i, b); this.changed.push(x, y, z, b);
    return true;
  }
  editsJSON() { const o: any = {}; for (const [k, m] of this.edits) { const a: number[] = []; for (const [i, b] of m) a.push(i, b); o[k] = a; } return o; }
}

export class SPlayer {
  id = 0; name = ''; skin = 0; pos = [0, 0, 0]; yaw = 0; pitch = 0; mode = 0; inv = new Inventory(); slot = 0;
  health = 20; hunger = 20; air = 10; exhaustion = 0; xp = 0; bed: number[] | null = null; dead = false; op = false; local = false;
  hurtCd = 0; headInWater = false; flying = false; moving = 0; onGround = true; tpSeq = 0; viewDist = 6;
  effects = new Map<string, { until: number; amp: number }>();
  cursor: any = null; craft: any[] = []; window = 0; furnace: any = null; breaking: { k: string; t: number } | null = null;
  sent = new Set<string>(); known = new Map<number, string>(); invDirty = true; lastState = ''; send: (b: ArrayBuffer) => void = () => {}; joined = false; swing = 0;
  w = 0.3; h = 1.8;
}

export class GameServer {
  world: ServerWorld; players = new Map<number, SPlayer>(); mobs: any[] = []; drops: any[] = []; furnaces: Map<string, any>;
  time: number; weather = 0; weatherT = 12000; rules: Record<string, boolean>; difficulty = 2; spawn: number[]; tickN = 0; nextId = 1; cheats: boolean; saved: Record<string, any>;
  constructor(public rec: any, public host: Host, public cfg: ServerConfig) {
    configure({ seed: rec.seed, scene: rec.scene || null });
    const s = rec.state || {};
    this.world = new ServerWorld(rec.edits);
    this.time = s.time ?? 7.5; this.weather = s.weather ?? 0; this.weatherT = s.weatherT ?? 9000 + Math.random() * 9000;
    this.rules = { ...DEFAULT_RULES, ...(s.rules || {}) }; this.difficulty = s.difficulty ?? 2;
    if (s.timeRunning === false) this.rules.doDaylightCycle = false;
    this.spawn = s.spawn || [8, surfaceY(8, 8), 8];
    this.furnaces = new Map(s.furnaces || []); this.cheats = !!rec.cheats; this.saved = rec.players || {};
    for (const d of s.drops || []) if (ITEMS[d.item.id]) { const e: any = new Drop(d.item, d.pos[0], d.pos[1], d.pos[2], [0, 0, 0]); e.ttl = d.ttl; this.addDrop(e); }
  }
  log(m: string) { this.host.log?.(m); }
  isDay() { return this.time > 5.6 && this.time < 18.9; }
  mobDamage() { return [0, 0.5, 1, 1.5][this.difficulty]; }
  addMob(m: any) { m.id = this.nextId++; this.mobs.push(m); return m; }
  addDrop(d: any) { d.id = this.nextId++; this.drops.push(d); return d; }
  spawnDrop(id: number, n: number, d: any, x: number, y: number, z: number, vel?: number[]) { return this.addDrop(new Drop(mk(id, n, d), x, y, z, vel)); }
  nearestPlayer(p: number[]) { let best: SPlayer | null = null, bd = 1e9; for (const pl of this.players.values()) { if (!pl.joined || pl.mode === 2) continue; const d = Math.hypot(pl.pos[0] - p[0], pl.pos[2] - p[2]); if (d < bd) { bd = d; best = pl; } } return best; }
  canTarget(pl: SPlayer) { return pl.mode === 0 && !pl.dead; }
  canPickup(pl: SPlayer) { return pl.joined && !pl.dead && pl.mode !== 2; }
  findPlayer(name: string) { for (const p of this.players.values()) if (p.joined && p.name.toLowerCase() === name.toLowerCase()) return p; return null; }
  isOp(p: SPlayer | null) { return !p || p.local || p.op; }

  // ---- Verbindungen ----
  connect(send: (b: ArrayBuffer) => void, local = false) {
    const p = new SPlayer(); p.id = this.nextId++; p.send = send; p.local = local; p.viewDist = this.cfg.viewDistance;
    this.players.set(p.id, p);
    return { recv: (buf: ArrayBuffer | Uint8Array) => { try { this.handle(p, new Reader(buf)); } catch (e: any) { this.log('Fehlerhafte Nachricht von ' + (p.name || p.id) + ': ' + e.message); } }, close: () => this.disconnect(p) };
  }
  disconnect(p: SPlayer) {
    if (!this.players.delete(p.id)) return;
    if (!p.joined) return;
    this.returnWindow(p); this.storePlayer(p);
    this.broadcast(new Writer(S.PLAYER_INFO).u32(p.id).u8(0).end());
    this.chat(`${p.name} hat das Spiel verlassen`, 2);
    this.save();
  }
  kick(p: SPlayer, reason: string) { p.send(new Writer(S.KICK).str(reason).end()); this.disconnect(p); }
  broadcast(buf: ArrayBuffer, except?: SPlayer) { for (const p of this.players.values()) if (p.joined && p !== except) p.send(buf); }
  // Farben: 0 normal, 1 Fehler, 2 System, 3 Befehlsausgabe
  tell(p: SPlayer | null, text: string, color = 3) { if (p) p.send(new Writer(S.CHAT).u8(color).str(text).end()); else this.log(text); }
  chat(text: string, color = 0) { this.broadcast(new Writer(S.CHAT).u8(color).str(text).end()); this.log(text); }

  storePlayer(p: SPlayer) {
    this.saved[p.name] = { pos: p.pos.slice(), yaw: p.yaw, pitch: p.pitch, mode: p.mode, inv: p.inv.toJSON(), slot: p.slot, health: p.health, hunger: p.hunger, air: p.air, xp: p.xp, bed: p.bed, dead: p.dead, flying: p.flying, op: p.op, skin: p.skin };
  }
  join(p: SPlayer, r: Reader) {
    const ver = r.u8(); let name = r.str().replace(/[^\wäöüÄÖÜß-]/g, '').slice(0, 16) || 'Spieler'; p.skin = r.u8() % 6; p.viewDist = Math.max(2, Math.min(this.cfg.viewDistance, r.u8()));
    if (ver !== PROTOCOL_VERSION) return this.kick(p, 'Unterschiedliche Spielversion – bitte Seite neu laden');
    if (this.cfg.whitelist && !p.local && !this.cfg.whitelist.some((n) => n.toLowerCase() === name.toLowerCase())) return this.kick(p, 'Du stehst nicht auf der Whitelist');
    let n = 0; for (const o of this.players.values()) if (o.joined) n++;
    if (n >= this.cfg.maxPlayers) return this.kick(p, 'Der Server ist voll');
    const base = name; let k = 2; while (this.findPlayer(name)) name = base.slice(0, 14) + k++;
    p.name = name; p.op = p.local || this.cfg.ops.some((o) => o.toLowerCase() === name.toLowerCase());
    const s = this.saved[name];
    if (s) { Object.assign(p, { pos: s.pos.slice(), yaw: s.yaw, pitch: s.pitch, mode: s.mode, slot: s.slot, health: s.health, hunger: s.hunger, air: s.air, xp: s.xp || 0, bed: s.bed, flying: s.flying }); p.inv.load(s.inv); p.op = p.op || !!s.op; }
    else {
      p.mode = Math.max(0, MODES.indexOf(this.rec.mode)); p.pos = [this.spawn[0] + 0.5, this.spawn[1] + 0.01, this.spawn[2] + 0.5];
      if (p.mode === 1) [B.GRASS, B.STONE, B.PLANKS, B.LOG, B.BRICKS, B.BASALT_VIOLET, B.WORKBENCH, B.FURNACE, toolId(3, 3)].forEach((id, i) => { p.inv.slots[i] = mk(id, 1); });
    }
    p.joined = true;
    p.send(new Writer(S.WELCOME).u32(p.id).i32(this.rec.seed).str(this.rec.scene || '').str(p.name).str(this.rec.name || 'Welt').u8(this.cheats ? 1 : 0).end());
    for (const o of this.players.values()) if (o.joined) { const info = new Writer(S.PLAYER_INFO).u32(o.id).u8(1).str(o.name).u8(o.skin).end(); if (o === p) this.broadcast(info); else p.send(info); }
    this.teleport(p, p.pos[0], p.pos[1], p.pos[2], p.yaw, p.pitch);
    this.sendTime(p);
    if (s && s.dead) this.respawn(p);
    this.chat(`${p.name} ist beigetreten`, 2);
  }
  teleport(p: SPlayer, x: number, y: number, z: number, yaw = p.yaw, pitch = p.pitch) {
    p.pos = [x, y, z]; p.yaw = yaw; p.pitch = pitch; p.tpSeq = (p.tpSeq + 1) & 255;
    p.send(new Writer(S.TELEPORT).u8(p.tpSeq).f32(x).f32(y).f32(z).f32(yaw).f32(pitch).end());
  }
  sendTime(p?: SPlayer) { const b = new Writer(S.TIME).f32(this.time).u8(this.weather).u8(this.rules.doDaylightCycle ? 1 : 0).u8(this.difficulty).end(); if (p) p.send(b); else this.broadcast(b); }

  handle(p: SPlayer, r: Reader) {
    const t = r.u8();
    if (t === C.HELLO) { if (!p.joined) this.join(p, r); return; }
    if (!p.joined) return;
    switch (t) {
      case C.MOVE: {
        const seq = r.u8(), x = r.f32(), y = r.f32(), z = r.f32(), yaw = r.f32(), pitch = r.f32(), f = r.u8();
        if (seq !== p.tpSeq || p.dead || ![x, y, z, yaw, pitch].every(Number.isFinite)) return;
        p.moving = Math.hypot(x - p.pos[0], z - p.pos[2]); p.pos[0] = x; p.pos[1] = y; p.pos[2] = z; p.yaw = yaw; p.pitch = pitch;
        p.onGround = !!(f & 1); p.headInWater = !!(f & 2); p.flying = !!(f & 4) && p.mode !== 0;
        break;
      }
      case C.FALL: { const d = r.f32(); if (p.mode === 0 && this.rules.fallDamage && d > 3.5 && d < 400) this.hurtPlayer(p, Math.floor(d - 3), null, true); break; }
      case C.BREAK_START: p.breaking = { k: r.i32() + ',' + r.i32() + ',' + r.i32(), t: this.tickN }; break;
      case C.BREAK_STOP: p.breaking = null; break;
      case C.BREAK_DONE: this.breakBlock(p, r.i32(), r.i32(), r.i32()); break;
      case C.USE: { const has = r.u8(); this.use(p, !!has, [r.i32(), r.i32(), r.i32()], [r.i32(), r.i32(), r.i32()], !!r.u8()); break; }
      case C.ATTACK: this.attack(p, r.u32()); break;
      case C.SLOT: p.slot = r.u8() % 9; p.breaking = null; break;
      case C.OPEN_INV: this.openWindow(p, 1, null); break;
      case C.CLOSE_INV: this.returnWindow(p); break;
      case C.INV_CLICK: this.invClick(p, r.str(), !!r.u8()); break;
      case C.PALETTE: { const id = r.u16(); if (p.mode !== 1) return; p.inv.slots[p.slot] = id && ITEMS[id] ? mk(id, ITEMS[id].stack) : null; p.invDirty = true; break; }
      case C.CHAT: { const text = r.str().slice(0, 256).trim(); if (!text) return; if (text[0] === '/') runCommand(this, p, text); else this.chat(`<${p.name}> ${text}`); break; }
      case C.TAB: p.send(new Writer(S.TAB).str(JSON.stringify(complete(this, p, r.str()))).end()); break;
      case C.RESPAWN: if (p.dead) this.respawn(p); break;
      case C.VIEW: p.viewDist = Math.max(2, Math.min(this.cfg.viewDistance, r.u8())); break;
      case C.PING: p.send(new Writer(S.PONG).u32(r.u32()).end()); break;
    }
  }

  // ---- Aktionen ----
  held(p: SPlayer) { return p.inv.slots[p.slot]; }
  heldTool(p: SPlayer) { const h = this.held(p); return h ? ITEMS[h.id].tool || null : null; }
  reach(p: SPlayer, x: number, y: number, z: number) { return Math.hypot(x + 0.5 - p.pos[0], y + 0.5 - p.pos[1] - 1.6, z + 0.5 - p.pos[2]) < 8; }
  useTool(p: SPlayer) {
    const h = this.held(p);
    if (!h || !ITEMS[h.id].tool || p.mode !== 0) return;
    if (--h.d <= 0) { p.inv.slots[p.slot] = null; this.tell(p, ITEMS[h.id].name + ' ist zerbrochen', 2); }
    p.invDirty = true;
  }
  breakBlock(p: SPlayer, x: number, y: number, z: number) {
    if (p.dead || p.mode === 2 || !this.reach(p, x, y, z)) return;
    const block = this.world.getBlock(x, y, z);
    if (!isSolid(block)) return;
    if (p.mode === 0) { // Abbauzeit prüfen (mit Toleranz für Netzwerk und niedrige Bildraten)
      const k = x + ',' + y + ',' + z, need = breakTime(block, this.heldTool(p)) * 20 * 0.7 - 2;
      if (!p.breaking || p.breaking.k !== k || this.tickN - p.breaking.t < need) return this.resend(p, x, y, z);
    }
    p.breaking = null;
    const tool = this.heldTool(p);
    if (!this.world.setBlock(x, y, z, 0)) return;
    const fk = x + ',' + y + ',' + z, f = this.furnaces.get(fk);
    if (f) { for (const s of [f.in, f.fuel, f.out]) if (s) this.spawnDrop(s.id, s.n, s.d, x + 0.5, y + 0.5, z + 0.5); this.furnaces.delete(fk); for (const o of this.players.values()) if (o.furnace === f) this.returnWindow(o); }
    for (const o of this.players.values()) if (o.bed && o.bed[0] === x && o.bed[1] === y && o.bed[2] === z) o.bed = null;
    if (p.mode !== 0) return;
    const d = dropFor(block, tool);
    if (d) this.spawnDrop(d[0], d[1], undefined, x + 0.5, y + 0.4, z + 0.5);
    if (block === B.COAL_ORE) p.xp += 1; else if (block === B.DIAMOND_ORE) p.xp += 5;
    this.useTool(p); p.exhaustion += 0.03;
  }
  resend(p: SPlayer, x: number, y: number, z: number) { p.send(new Writer(S.BLOCKS).u16(1).i32(x).u8(y).i32(z).u8(this.world.getBlock(x, y, z)).end()); }
  use(p: SPlayer, has: boolean, hit: number[], prev: number[], first: boolean) {
    if (p.dead || p.mode === 2) return;
    if (has && first && this.reach(p, hit[0], hit[1], hit[2])) {
      const b = this.world.getBlock(hit[0], hit[1], hit[2]), k = hit.join(',');
      if (b === B.WORKBENCH) return this.openWindow(p, 2, null);
      if (b === B.FURNACE) { if (!this.furnaces.has(k)) this.furnaces.set(k, { in: null, fuel: null, out: null, burn: 0, burnMax: 1, cook: 0 }); return this.openWindow(p, 3, this.furnaces.get(k)); }
      if (b === B.BED) return this.sleep(p, hit);
    }
    const h = this.held(p);
    if (!h) return;
    const it = ITEMS[h.id];
    if (it.food) {
      if (!first || p.mode !== 0) return;
      if (p.hunger >= 20) return this.tell(p, 'Du bist satt', 2);
      p.hunger = Math.min(20, p.hunger + it.food); p.inv.take(p.slot, 1); p.invDirty = true; return;
    }
    if (!it.block || !has) return;
    const [x, y, z] = prev;
    if (!this.reach(p, x, y, z) || isSolid(this.world.getBlock(x, y, z))) return;
    const hits = (e: any) => x + 1 > e.pos[0] - e.w && x < e.pos[0] + e.w && y + 1 > e.pos[1] && y < e.pos[1] + e.h && z + 1 > e.pos[2] - e.w && z < e.pos[2] + e.w;
    for (const o of this.players.values()) if (o.joined && o.mode !== 2 && hits(o)) return this.resend(p, x, y, z);
    for (const m of this.mobs) if (!m.dead && hits(m)) return this.resend(p, x, y, z);
    if (!this.world.setBlock(x, y, z, h.id)) return;
    if (p.mode === 0) { p.inv.take(p.slot, 1); p.invDirty = true; }
  }
  sleep(p: SPlayer, at: number[]) {
    p.bed = at.slice();
    if (this.isDay() && this.weather !== 2) return this.tell(p, 'Spawnpunkt gesetzt – schlafen geht nur nachts', 2);
    this.time = 6; this.weather = 0; this.mobs.forEach((m) => { if (m.def.hostile) m.dead = true; });
    this.sendTime(); this.chat(`${p.name} hat die Nacht übersprungen`, 2);
  }
  attack(p: SPlayer, id: number) {
    if (p.dead || p.mode === 2 || this.tickN - p.swing < 6) return;
    const m = this.mobs.find((e) => e.id === id && !e.dead);
    if (!m || Math.hypot(m.pos[0] - p.pos[0], m.pos[1] - p.pos[1], m.pos[2] - p.pos[2]) > 6) return;
    p.swing = this.tickN;
    const t = this.heldTool(p), st = this.effect(p, 'strength'), dx = m.pos[0] - p.pos[0], dz = m.pos[2] - p.pos[2], l = Math.hypot(dx, dz) || 1;
    const killed = m.damage(p.mode === 1 ? 999 : (t ? t.dmg : 1) + (st ? 3 * (st.amp + 1) : 0), dx / l, dz / l, this);
    if (killed && p.mode === 0) p.xp += m.def.hostile ? 5 : 2;
    this.useTool(p); p.exhaustion += 0.05;
  }
  effect(p: SPlayer, name: string) { const e = p.effects.get(name); return e && e.until > this.tickN ? e : null; }

  // ---- Inventarfenster (Server hält Hand-Stapel und Crafting-Raster) ----
  openWindow(p: SPlayer, kind: number, furnace: any) {
    this.returnWindow(p);
    p.window = kind; p.furnace = furnace; p.craft = new Array(kind === 2 ? 9 : 4).fill(null); p.invDirty = true;
    p.send(new Writer(S.OPEN).u8(kind).end());
  }
  returnWindow(p: SPlayer) {
    for (const s of [...p.craft, p.cursor]) if (s) { const left = p.inv.add(s.id, s.n, s.d); if (left > 0) this.spawnDrop(s.id, left, s.d, p.pos[0], p.pos[1] + 1, p.pos[2]); }
    if (p.window) p.send(new Writer(S.OPEN).u8(0).end());
    p.craft = []; p.cursor = null; p.window = 0; p.furnace = null; p.invDirty = true;
  }
  recipe(p: SPlayer) { return p.craft.length ? matchRecipe(p.craft.map((s) => (s ? s.id : 0)), p.craft.length === 9 ? 3 : 2) : null; }
  invClick(p: SPlayer, ref: string, single: boolean) {
    if (!p.window || p.dead) return;
    const [k, is] = ref.split(':'), i = +is;
    const get = () => (k === 'inv' ? p.inv.slots[i] : k === 'craft' ? p.craft[i] : p.furnace?.[k]);
    const set = (v: any) => { if (k === 'inv') p.inv.slots[i] = v; else if (k === 'craft') p.craft[i] = v; else if (p.furnace) p.furnace[k] = v; };
    if (k === 'inv' ? !(i >= 0 && i < 36) : k === 'craft' ? !(i >= 0 && i < p.craft.length) : k === 'result' ? false : !(p.furnace && ['in', 'fuel', 'out'].includes(k))) return;
    let h = p.cursor;
    if (k === 'result') {
      const r = this.recipe(p); if (!r) return;
      if (h && (h.id !== r.out || h.n + r.n > ITEMS[r.out].stack)) return;
      if (h) h.n += r.n; else h = mk(r.out, r.n);
      p.craft.forEach((s, j) => { if (s && --s.n <= 0) p.craft[j] = null; });
    } else {
      const s = get(), max = (x: any) => ITEMS[x.id].stack;
      if (!h) { if (s) { if (single && s.n > 1) { const n = Math.ceil(s.n / 2); h = { ...s, n }; s.n -= n; } else { h = s; set(null); } } }
      else if (k === 'out') { if (s && s.id === h.id && h.n + s.n <= max(h)) { h.n += s.n; set(null); } }
      else if (!s) { if (single && h.n > 1) { set({ ...h, n: 1 }); h.n--; } else { set(h); h = null; } }
      else if (s.id === h.id && max(s) > 1) { const n = Math.min(single ? 1 : h.n, max(s) - s.n); s.n += n; h.n -= n; if (h.n <= 0) h = null; }
      else { set(h); h = s; }
    }
    p.cursor = h; p.invDirty = true;
    if (p.furnace) for (const o of this.players.values()) if (o.furnace === p.furnace) o.invDirty = true;
  }
  sendInv(p: SPlayer) {
    const w = new Writer(S.INV, 256);
    for (let i = 0; i < 36; i++) w.slot(p.inv.slots[i]);
    w.u8(p.slot).u8(p.window).slot(p.cursor).u8(p.craft.length);
    for (const s of p.craft) w.slot(s);
    const r = this.recipe(p); w.slot(r ? { id: r.out, n: r.n } : null);
    const f = p.furnace;
    if (f) w.u8(1).slot(f.in).slot(f.fuel).slot(f.out).u16(f.cook).u16(Math.max(0, f.burn)).u16(f.burnMax); else w.u8(0);
    p.send(w.end());
  }

  // ---- Leben ----
  hurtPlayer(p: SPlayer, n: number, knock: number[] | null, force = false) {
    if (p.mode !== 0 || p.dead || (p.hurtCd > 0 && !force) || n <= 0) return;
    const res = this.effect(p, 'resistance'); if (res) n *= Math.max(0, 1 - 0.2 * (res.amp + 1));
    p.health -= n; p.hurtCd = 10;
    if (knock) p.send(new Writer(S.VELOCITY).f32(knock[0] * 7).f32(5).f32(knock[1] * 7).end());
    if (p.health <= 0) this.die(p);
  }
  die(p: SPlayer, msg?: string) {
    if (p.dead) return;
    p.health = 0; p.dead = true; p.breaking = null; this.returnWindow(p);
    if (!this.rules.keepInventory) {
      p.inv.slots.forEach((s: any, i: number) => { if (!s) return; const d: any = this.spawnDrop(s.id, s.n, s.d, p.pos[0], p.pos[1] + 0.8, p.pos[2]); d.ttl = 18000; d.delay = 40; p.inv.slots[i] = null; });
      p.xp = 0; p.invDirty = true;
    }
    this.chat(msg || `${p.name} ist gestorben`, 2);
  }
  respawn(p: SPlayer) {
    let pos = [this.spawn[0] + 0.5, this.spawn[1] + 0.01, this.spawn[2] + 0.5];
    if (p.bed) { this.world.chunk(Math.floor(p.bed[0] / CS), Math.floor(p.bed[2] / CS)); if (this.world.getBlock(p.bed[0], p.bed[1], p.bed[2]) === B.BED) pos = [p.bed[0] + 0.5, p.bed[1] + 1.01, p.bed[2] + 0.5]; else p.bed = null; }
    p.health = 20; p.hunger = 20; p.air = 10; p.exhaustion = 0; p.dead = false; p.hurtCd = 40;
    this.teleport(p, pos[0], pos[1], pos[2]);
  }
  setMode(p: SPlayer, mode: number) { p.mode = mode; p.breaking = null; if (mode === 2) this.returnWindow(p); p.invDirty = true; }

  // ---- Tick (20 TPS) ----
  tick() {
    const n = ++this.tickN;
    if (this.rules.doDaylightCycle) this.time = (this.time + 24 / 24000) % 24;
    if (this.rules.doWeatherCycle && --this.weatherT <= 0) { const r = Math.random(); this.setWeather(this.weather ? 0 : r < 0.75 ? 1 : 2); }
    if (this.weather === 2 && Math.random() < 0.004) this.broadcast(new Writer(S.FLASH).end());
    for (const m of this.mobs) if (!m.dead) m.tick(this);
    for (const d of this.drops) if (!d.dead) d.tick(this);
    for (const f of this.furnaces.values()) this.tickFurnace(f);
    if (n % 20 === 0) {
      if (this.difficulty === 0) for (const m of this.mobs) if (m.def.hostile) m.dead = true;
      this.mobs = this.mobs.filter((m) => !m.dead); this.drops = this.drops.filter((d) => !d.dead);
      this.sendTime();
    }
    for (const p of this.players.values()) if (p.joined) this.tickPlayer(p, n);
    this.flushBlocks();
    if (n % 2 === 0) for (const p of this.players.values()) if (p.joined) this.sendEntities(p);
    if (n % 300 === 0) { this.save(); this.evict(); }
  }
  setWeather(w: number, ticks?: number) { this.weather = w; this.weatherT = ticks ?? (w ? 3000 + Math.random() * 6000 : 9000 + Math.random() * 15000); this.sendTime(); }
  tickFurnace(f: any) {
    const res = f.in && SMELT[f.in.id], can = res && (!f.out || (f.out.id === res && f.out.n < 64));
    if (f.burn <= 0 && can && f.fuel && FUEL[f.fuel.id]) { f.burn = f.burnMax = FUEL[f.fuel.id]; if (--f.fuel.n <= 0) f.fuel = null; }
    if (f.burn > 0) {
      f.burn--;
      if (!can) f.cook = 0;
      else if (++f.cook >= SMELT_TICKS) { f.cook = 0; if (--f.in.n <= 0) f.in = null; if (f.out) f.out.n++; else f.out = mk(res, 1); }
    } else f.cook = 0;
  }
  tickPlayer(p: SPlayer, n: number) {
    if (p.hurtCd > 0) p.hurtCd--;
    // Chunks nach Sichtweite nachladen (nächste zuerst), höchstens zwei pro Tick
    const ccx = Math.floor(p.pos[0] / CS), ccz = Math.floor(p.pos[2] / CS);
    let budget = 2;
    for (const o of spiral(p.viewDist + 2)) { // zwei Ringe mehr: der Client vermesht erst mit allen Nachbarn
      const k = key(ccx + o[0], ccz + o[1]);
      if (p.sent.has(k)) continue;
      p.sent.add(k);
      p.send(new Writer(S.CHUNK, 4096).i32(ccx + o[0]).i32(ccz + o[1]).bytes(rleEncode(this.world.chunk(ccx + o[0], ccz + o[1]))).end());
      if (--budget <= 0) break;
    }
    if (n % 100 === 0) for (const k of p.sent) { const [x, z] = k.split(',').map(Number); if (Math.max(Math.abs(x - ccx), Math.abs(z - ccz)) > p.viewDist + 4) p.sent.delete(k); }
    if (n % 40 === 0 && !p.dead && p.mode !== 2) trySpawn(this, p);
    if (p.mode === 0 && !p.dead) {
      if (this.difficulty > 0) p.exhaustion += p.moving > 0.3 ? 0.004 : p.moving > 0.03 ? 0.0015 : 0.0005;
      if (p.exhaustion >= 1) { p.exhaustion -= 1; p.hunger = Math.max(0, p.hunger - 1); }
      if (n % 80 === 0) {
        if ((p.hunger >= 18 || this.difficulty === 0) && p.health < 20) { p.health = Math.min(20, p.health + 1); p.exhaustion += 0.4; } // voller Hunger heilt
        else if (p.hunger <= 0 && p.health > [20, 10, 1, 0][this.difficulty]) this.hurtPlayer(p, 1, null, true);
      }
      const reg = this.effect(p, 'regeneration');
      if (reg && n % Math.max(5, Math.round(50 / (reg.amp + 1))) === 0 && p.health < 20) p.health = Math.min(20, p.health + 1);
      if (p.headInWater) { p.air = Math.max(0, p.air - 10 / 300); if (p.air <= 0 && n % 20 === 0) this.hurtPlayer(p, 2, null, true); }
      else p.air = Math.min(10, p.air + 0.25);
      if (p.pos[1] < -15) this.die(p, `${p.name} fiel aus der Welt`);
    }
    if (p.invDirty || (p.furnace && n % 5 === 0)) { p.invDirty = false; this.sendInv(p); }
    const sp = this.effect(p, 'speed'), jp = this.effect(p, 'jump_boost');
    const st = [p.mode, Math.ceil(p.health), p.hunger, Math.ceil(p.air * 2), p.dead ? 1 : 0, p.xp, (this.isOp(p) ? 1 : 0) | (this.cheats ? 2 : 0), sp ? sp.amp + 1 : 0, jp ? jp.amp + 1 : 0];
    const sig = st.join(',');
    if (sig !== p.lastState) { p.lastState = sig; p.send(new Writer(S.STATE).u8(st[0]).u8(Math.max(0, st[1])).u8(st[2]).u8(st[3]).u8(st[4]).u32(st[5]).u8(st[6]).u8(st[7]).u8(st[8]).end()); }
  }
  flushBlocks() {
    const c = this.world.changed;
    if (!c.length) return;
    for (const p of this.players.values()) {
      if (!p.joined) continue;
      const w = new Writer(S.BLOCKS, 16 + c.length * 3); let cnt = 0; const at = w.n; w.u16(0);
      for (let i = 0; i < c.length; i += 4) if (p.sent.has(key(Math.floor(c[i] / CS), Math.floor(c[i + 2] / CS)))) { w.i32(c[i]).u8(c[i + 1]).i32(c[i + 2]).u8(c[i + 3]); if (++cnt === 65535) break; }
      if (cnt) { w.dv.setUint16(at, cnt, true); p.send(w.end()); }
    }
    c.length = 0;
  }
  // nur geänderte Figuren im Umkreis senden; verschwundene abmelden
  sendEntities(p: SPlayer) {
    const w = new Writer(S.ENTS, 512), at = w.n; let cnt = 0; w.u16(0);
    const seen = new Set<number>();
    const put = (id: number, kind: number, data: number, pos: number[], yaw: number, flags: number) => {
      if (Math.abs(pos[0] - p.pos[0]) > 72 || Math.abs(pos[2] - p.pos[2]) > 72) return;
      seen.add(id);
      const yb = Math.round(((yaw % 6.2832) + 6.2832) % 6.2832 / 6.2832 * 255) & 255;
      const sig = `${Math.round(pos[0] * 16)},${Math.round(pos[1] * 16)},${Math.round(pos[2] * 16)},${yb},${flags},${data}`;
      if (p.known.get(id) === sig) return;
      p.known.set(id, sig); cnt++;
      w.u32(id).u8(kind).u16(data).f32(pos[0]).f32(pos[1]).f32(pos[2]).u8(yb).u8(flags);
    };
    for (const o of this.players.values()) if (o !== p && o.joined && o.mode !== 2 && !o.dead) put(o.id, 0, this.held(o)?.id || 0, o.pos, o.yaw, o.hurtCd > 6 ? 1 : 0);
    for (const m of this.mobs) if (!m.dead) put(m.id, 1, MOB_TYPES.indexOf(m.type), m.pos, m.yaw, m.hurt > 0 ? 1 : 0);
    for (const d of this.drops) if (!d.dead) put(d.id, 2, d.item.id, d.pos, 0, 0);
    if (cnt) { w.dv.setUint16(at, cnt, true); p.send(w.end()); }
    let gone: Writer | null = null;
    for (const id of p.known.keys()) if (!seen.has(id)) { p.known.delete(id); (gone ||= new Writer(S.ENT_REMOVE)).u32(id); }
    if (gone) p.send(gone.end());
  }
  evict() { // Chunks fern aller Spieler freigeben (Änderungen bleiben in edits erhalten)
    const keep = new Set<string>();
    for (const p of this.players.values()) for (const k of p.sent) keep.add(k);
    for (const k of this.world.chunks.keys()) if (!keep.has(k)) this.world.chunks.delete(k);
    this.mobs.forEach((m) => { if (!this.world.isLoaded(m.pos[0], m.pos[2])) m.dead = true; });
  }
  save() {
    for (const p of this.players.values()) if (p.joined) this.storePlayer(p);
    this.rec.players = this.saved; this.rec.edits = this.world.editsJSON(); this.rec.played = Date.now(); this.rec.cheats = this.cheats;
    this.rec.state = { time: this.time, weather: this.weather, weatherT: this.weatherT, rules: this.rules, difficulty: this.difficulty, spawn: this.spawn, furnaces: [...this.furnaces],
      drops: this.drops.filter((d) => !d.dead).map((d) => ({ item: d.item, pos: d.pos.slice(), ttl: d.ttl - d.age })) };
    if (!this.rec.temp) this.host.save(this.rec);
  }
}
