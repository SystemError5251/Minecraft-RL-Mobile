// Client-Seite des Spiels: spiegelt den Serverzustand, sagt Bewegung voraus und sendet Aktionen über das Protokoll.
import { isSolid } from './blocks.js';
import { ITEMS, breakTime } from './items.js';
import { MOBS, MOB_TYPES, PLAYER_MODEL, SKINS } from './entities.js';
import { C, S, Writer, Reader, rleDecode, PROTOCOL_VERSION } from './protocol.js';
import { CS, CH } from './worldgen.js';

export const MODE_KEYS = ['survival', 'creative', 'spectator'];
export class ClientGame {
  constructor(conn, player, ui, opts) {
    Object.assign(this, { conn, player, ui, opts, world: null, id: 0, name: opts.name, worldName: '', seed: 0, modeN: 0, health: 20, hunger: 20, air: 10, xp: 0, dead: false, op: false, cheats: false,
      time: 8, weather: 0, timeRunning: true, difficulty: 2, inv: { slots: new Array(36).fill(null) }, slot: 0, cursor: null, craft: [], result: null, furnace: null, window: 0,
      ents: new Map(), names: new Map(), breaking: null, hurtFlash: 0, flash: 0, invChanged: true, tpSeq: 0, moveT: 0, repT: 0, useT: 0, swingCd: 0, wasBreaking: false, ping: 0, pingT: 0, kicked: null, bytesIn: 0, closed: false });
    conn.onmessage = (buf) => { this.bytesIn += buf.byteLength; this.recv(new Reader(buf)); };
    conn.onclose = () => { if (!this.closed) { this.closed = true; ui.disconnected(this.kicked || 'Verbindung zum Host getrennt'); } };
    this.send(new Writer(C.HELLO).u8(PROTOCOL_VERSION).str(opts.name).u8(opts.skin).u8(opts.viewDist));
  }
  send(w) { if (!this.closed) this.conn.send(w.end()); }
  get mode() { return MODE_KEYS[this.modeN]; }
  held() { return this.inv.slots[this.slot]; }
  heldTool() { const h = this.held(); return h ? ITEMS[h.id].tool || null : null; }
  isDay() { return this.time > 5.6 && this.time < 18.9; }
  chat(text) { this.send(new Writer(C.CHAT).str(text)); }
  setSlot(i) { this.slot = i; this.invChanged = true; this.breaking = null; this.send(new Writer(C.SLOT).u8(i)); }
  setView(d) { this.send(new Writer(C.VIEW).u8(d)); }
  respawn() { this.send(new Writer(C.RESPAWN)); }

  recv(r) {
    const t = r.u8(), pl = this.player;
    switch (t) {
      case S.WELCOME: this.id = r.u32(); this.seed = r.i32(); this.scene = r.str() || null; this.name = r.str(); this.worldName = r.str(); this.cheats = !!r.u8(); this.opts.onWelcome(this); break;
      case S.CHUNK: { const cx = r.i32(), cz = r.i32(); this.world?.addChunk(cx, cz, rleDecode(r.bytes(), CS * CS * CH)); break; }
      case S.BLOCKS: for (let n = r.u16(); n > 0; n--) { const x = r.i32(), y = r.u8(), z = r.i32(); this.world?.setBlock(x, y, z, r.u8()); } break;
      case S.TIME: this.time = r.f32(); this.weather = r.u8(); this.timeRunning = !!r.u8(); this.difficulty = r.u8(); break;
      case S.STATE: {
        const mode = r.u8(), hp = r.u8(), food = r.u8(), air = r.u8(), dead = !!r.u8(), xp = r.u32(), fl = r.u8(), sp = r.u8(), jp = r.u8();
        if (hp < this.health && !dead) this.hurtFlash = 0.35;
        if (dead && !this.dead) this.ui.showDeath();
        Object.assign(this, { modeN: mode, health: hp, hunger: food, air: air / 2, dead, xp, op: !!(fl & 1), cheats: !!(fl & 2) });
        pl.speedMul = 1 + 0.2 * sp; pl.jumpMul = 1 + 0.25 * jp; pl.noclip = mode === 2;
        if (mode === 0) pl.flying = false; else if (mode === 2) pl.flying = true;
        this.invChanged = true; break;
      }
      case S.INV: {
        for (let i = 0; i < 36; i++) this.inv.slots[i] = r.slot();
        this.slot = r.u8(); this.window = r.u8(); this.cursor = r.slot(); this.craft = []; for (let n = r.u8(); n > 0; n--) this.craft.push(r.slot());
        this.result = r.slot(); this.furnace = r.u8() ? { in: r.slot(), fuel: r.slot(), out: r.slot(), cook: r.u16(), burn: r.u16(), burnMax: r.u16() } : null;
        this.invChanged = true; break;
      }
      case S.ENTS: for (let n = r.u16(); n > 0; n--) {
        const id = r.u32(), kind = r.u8(), data = r.u16(), x = r.f32(), y = r.f32(), z = r.f32(), yaw = r.u8() / 255 * 6.2832, flags = r.u8();
        let e = this.ents.get(id);
        if (!e) { e = { id, kind, rx: x, ry: y, rz: z, ryaw: yaw, phase: 0, lit: 1, litT: 0 }; this.ents.set(id, e); }
        Object.assign(e, { data, x, y, z, yaw, flags });
      } break;
      case S.ENT_REMOVE: while (r.more) this.ents.delete(r.u32()); break;
      case S.PLAYER_INFO: { const id = r.u32(); if (r.u8()) this.names.set(id, { name: r.str(), skin: r.u8() }); else { this.names.delete(id); this.ents.delete(id); } this.ui.playersChanged?.(this); break; }
      case S.CHAT: { const col = r.u8(); this.ui.chatLine(r.str(), col); break; }
      case S.TAB: this.ui.tabResult(JSON.parse(r.str())); break;
      case S.TELEPORT: this.tpSeq = r.u8(); pl.pos = [r.f32(), r.f32(), r.f32()]; pl.yaw = r.f32(); pl.pitch = r.f32(); pl.vel = [0, 0, 0]; pl.peakY = pl.pos[1]; this.breaking = null; break;
      case S.VELOCITY: pl.vel = [r.f32(), r.f32(), r.f32()]; break;
      case S.OPEN: { const k = r.u8(); if (k) this.ui.openInventory(k); else this.ui.hideInventory(); break; }
      case S.KICK: this.kicked = r.str(); this.closed = true; this.ui.disconnected(this.kicked); try { this.conn.close(); } catch { /* schon zu */ } break;
      case S.PONG: this.ping = Math.round(performance.now() - r.u32()); break;
      case S.FLASH: this.flash = 0.25; break;
    }
  }

  // ---- pro Bild: Bewegung vorhersagen, Eingaben in Aktionen übersetzen ----
  frame(dt, inp, frozen) {
    const pl = this.player, w = this.world;
    if (!w) return;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.swingCd > 0) this.swingCd -= dt;
    if (!frozen && !this.dead) {
      if (this.modeN === 1 && inp.flyToggle) pl.flying = !pl.flying;
      pl.update(dt, inp, w);
      if (pl.landed > 3.5 && this.modeN === 0) this.send(new Writer(C.FALL).f32(pl.landed));
      if (this.modeN !== 2) {
        this.handleBreak(dt, inp.breaking || inp.breakPressed);
        if (inp.useHeld || inp.usePressed) { this.useT -= dt; if (inp.usePressed || this.useT <= 0) { this.use(inp.usePressed); this.useT = 0.26; } }
      }
    } else this.breaking = null;
    inp.flyToggle = inp.breakPressed = inp.usePressed = false;
    // Position 15x pro Sekunde melden
    if ((this.moveT -= dt) <= 0) {
      this.moveT = 1 / 15;
      this.send(new Writer(C.MOVE).u8(this.tpSeq).f32(pl.pos[0]).f32(pl.pos[1]).f32(pl.pos[2]).f32(pl.yaw).f32(pl.pitch).u8((pl.onGround ? 1 : 0) | (pl.headInWater ? 2 : 0) | (pl.flying ? 4 : 0)));
    }
    if ((this.pingT -= dt) <= 0) { this.pingT = 2; this.send(new Writer(C.PING).u32(performance.now() >>> 0)); }
    // Figuren zwischen den Server-Schnappschüssen glätten
    const k = Math.min(1, dt * 14);
    for (const e of this.ents.values()) {
      const dx = e.x - e.rx, dz = e.z - e.rz;
      if (Math.abs(dx) + Math.abs(e.y - e.ry) + Math.abs(dz) > 12) { e.rx = e.x; e.ry = e.y; e.rz = e.z; } // Teleport nicht glätten
      else { e.rx += dx * k; e.ry += (e.y - e.ry) * k; e.rz += dz * k; e.phase += Math.hypot(dx, dz) * k * 4.5; }
      let dy = e.yaw - e.ryaw; if (dy > Math.PI) dy -= 6.2832; else if (dy < -Math.PI) dy += 6.2832; e.ryaw += dy * k;
      if ((e.litT -= dt) <= 0) { e.litT = 0.5; e.lit = 1; const bx = Math.floor(e.rx), by = Math.floor(e.ry), bz = Math.floor(e.rz); for (let i = 1; i < 28 && by + i < CH; i++) if (isSolid(w.getBlock(bx, by + i, bz))) { e.lit = 0.22; break; } }
    }
  }
  rayEnts(max) { // nächste Figur im Blickstrahl
    const o = this.player.eye(), d = this.player.forward(); let best = null, bt = max;
    for (const e of this.ents.values()) {
      if (e.kind !== 1) continue;
      const def = MOBS[MOB_TYPES[e.data]]; if (!def) continue;
      const lo = [e.rx - def.w - 0.1, e.ry, e.rz - def.w - 0.1], hi = [e.rx + def.w + 0.1, e.ry + def.h + 0.1, e.rz + def.w + 0.1];
      let t0 = 0, t1 = bt, ok = true;
      for (let a = 0; a < 3 && ok; a++) {
        if (Math.abs(d[a]) < 1e-6) { if (o[a] < lo[a] || o[a] > hi[a]) ok = false; continue; }
        let ta = (lo[a] - o[a]) / d[a], tb = (hi[a] - o[a]) / d[a]; if (ta > tb) { const t = ta; ta = tb; tb = t; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) ok = false;
      }
      if (ok && t0 < bt) { bt = t0; best = e; }
    }
    return best;
  }
  handleBreak(dt, held) {
    const edge = held && !this.wasBreaking; this.wasBreaking = held;
    if (!held) { if (this.breaking) { this.breaking = null; this.send(new Writer(C.BREAK_STOP)); } return; }
    const pl = this.player, creative = this.modeN === 1, ray = pl.raycast(this.world, creative ? 6 : 4.5);
    if (edge || (this.swingCd <= 0 && !this.breaking)) { // zuerst prüfen, ob eine Figur im Weg steht
      const m = this.swingCd <= 0 && this.rayEnts(Math.min(3.6, ray ? ray.dist : 99));
      if (m) { this.send(new Writer(C.ATTACK).u32(m.id)); this.swingCd = 0.4; this.breaking = null; return; }
    }
    if (!ray) { this.breaking = null; return; }
    const [x, y, z] = ray.hit, done = () => { this.send(new Writer(C.BREAK_DONE).i32(x).i32(y).i32(z)); this.world.setBlock(x, y, z, 0); }; // lokal vorwegnehmen, Server bestätigt oder korrigiert
    if (creative) { this.repT -= dt; if (edge || this.repT <= 0) { done(); this.repT = 0.22; } return; }
    const k = x + ',' + y + ',' + z;
    if (!this.breaking || this.breaking.k !== k) { this.breaking = { k, p: 0 }; this.send(new Writer(C.BREAK_START).i32(x).i32(y).i32(z)); }
    this.breaking.p += dt / breakTime(ray.block, this.heldTool());
    if (this.breaking.p >= 1) { done(); this.breaking = null; }
  }
  use(first) {
    const ray = this.player.raycast(this.world, this.modeN === 1 ? 6 : 4.5), h = ray ? ray.hit : [0, 0, 0], p = ray && ray.prev ? ray.prev : [0, 0, 0];
    if (ray && ray.prev && this.player.intersectsBlock(...ray.prev) && !first) return;
    this.send(new Writer(C.USE).u8(ray && ray.prev ? 1 : 0).i32(h[0]).i32(h[1]).i32(h[2]).i32(p[0]).i32(p[1]).i32(p[2]).u8(first ? 1 : 0));
  }
  // Figuren und Mitspieler in den Box-Batch schreiben; liefert die Namensschilder
  draw(batch, time) {
    const labels = [];
    for (const e of this.ents.values()) {
      const red = e.flags & 1;
      if (e.kind === 0) { const info = this.names.get(e.id); batch.addModel(PLAYER_MODEL, e.rx, e.ry, e.rz, e.ryaw, e.phase, red, e.lit, SKINS[info ? info.skin : 0].c); if (info) labels.push([info.name, e.rx, e.ry + 2.15, e.rz]); }
      else if (e.kind === 1) { const def = MOBS[MOB_TYPES[e.data]]; if (def) batch.addModel(def, e.rx, e.ry, e.rz, e.ryaw, e.phase, red, e.lit, null); }
      else batch.addItem(e.data, e.rx, e.ry, e.rz, time, e.lit);
    }
    return labels;
  }
  close() { this.closed = true; this.conn.close(); }
}
