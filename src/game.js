// Spielzustand und Regeln: Spielmodi, Leben/Hunger/Luft, Abbauen, Setzen, Kampf, Ofen, Tod und Speichern.
import { B, BLOCKS } from './blocks.js';
import { ITEMS, I, SMELT, FUEL, SMELT_TICKS, breakTime, dropFor, toolId } from './items.js';
import { Inventory, mk } from './inventory.js';
import { Mob, Drop, trySpawn, rayMobs } from './entities.js';
import { surfaceY } from './worldgen.js';

export class Game {
  constructor(rec, world, player, ui) {
    this.rec = rec; this.world = world; this.player = player; this.ui = ui;
    const s = rec.state || {};
    this.mode = rec.mode; this.time = s.time ?? 7.5; this.timeRunning = s.timeRunning ?? true;
    this.inv = new Inventory(); this.slot = s.slot ?? 0;
    this.health = s.health ?? 20; this.hunger = s.hunger ?? 20; this.air = s.air ?? 10; this.exhaustion = 0;
    this.bed = s.bed || null; this.dead = false;
    this.mobs = []; this.drops = []; this.furnaces = new Map(s.furnaces || []);
    this.breaking = null; this.hurtCd = 0; this.hurtFlash = 0; this.tickN = 0; this.useT = 0; this.repT = 0; this.swingCd = 0; this.wasBreaking = false; this.invChanged = true;
    if (s.inv) this.inv.load(s.inv);
    else if (this.mode === 'creative') [B.GRASS, B.STONE, B.PLANKS, B.LOG, B.BRICKS, B.BASALT_VIOLET, B.WORKBENCH, B.FURNACE, toolId(3, 3)].forEach((id, i) => { this.inv.slots[i] = mk(id, 1); });
    if (s.player) { player.pos = s.player.pos.slice(); player.yaw = s.player.yaw; player.pitch = s.player.pitch; player.flying = !!s.player.flying && this.mode === 'creative'; }
    else { const w = this.worldSpawn(); player.pos = w; }
    player.peakY = player.pos[1];
    for (const d of s.drops || []) if (ITEMS[d.item.id]) { const e = new Drop(d.item, d.pos[0], d.pos[1], d.pos[2], [0, 0, 0]); e.ttl = d.ttl; this.drops.push(e); }
    if (s.dead) this.respawn();
  }
  worldSpawn() { return [8.5, surfaceY(8, 8) + 0.01, 8.5]; }
  isDay() { return this.time > 5.6 && this.time < 18.9; }
  held() { return this.inv.slots[this.slot]; }
  heldTool() { const h = this.held(); return h ? ITEMS[h.id].tool || null : null; }
  survival() { return this.mode === 'survival'; }
  setMode(m) { this.mode = this.rec.mode = m; if (m !== 'creative') this.player.flying = false; this.breaking = null; this.invChanged = true; }
  spawnDrop(id, n, d, x, y, z, vel) { const e = new Drop(mk(id, n, d), x, y, z, vel); this.drops.push(e); return e; }
  useTool() { // Haltbarkeit des Werkzeugs in der Hand verbrauchen
    const h = this.held();
    if (!h || !ITEMS[h.id].tool || !this.survival()) return;
    if (--h.d <= 0) { this.inv.slots[this.slot] = null; this.ui.toast(ITEMS[h.id].name + ' ist zerbrochen'); }
    this.invChanged = true;
  }

  // ---- pro Bild: Spielerbewegung und Eingaben ----
  frame(dt, inp) {
    const pl = this.player;
    if (this.mode !== 'creative') pl.flying = false;
    else if (inp.flyToggle) pl.flying = !pl.flying;
    inp.flyToggle = false;
    pl.update(dt, inp, this.world);
    if (this.survival() && pl.landed > 3.5) this.hurtPlayer(Math.floor(pl.landed - 3), null, true);
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.swingCd > 0) this.swingCd -= dt;
    this.handleBreak(dt, inp.breaking || inp.breakPressed); // kurzes Antippen zählt als ein Schlag
    inp.breakPressed = false;
    if (inp.useHeld || inp.usePressed) { this.useT -= dt; if (inp.usePressed || this.useT <= 0) { this.use(inp.usePressed); this.useT = 0.26; } }
    inp.usePressed = false;
  }
  handleBreak(dt, held) {
    const edge = held && !this.wasBreaking; this.wasBreaking = held;
    if (!held) { this.breaking = null; return; }
    const pl = this.player, creative = this.mode === 'creative', ray = pl.raycast(this.world, creative ? 6 : 4.5);
    if (edge || (this.swingCd <= 0 && !this.breaking)) { // zuerst prüfen, ob eine Figur im Weg steht
      const m = rayMobs(this.mobs, pl.eye(), pl.forward(), Math.min(3.6, ray ? ray.dist : 99));
      if (m && this.swingCd <= 0) {
        const t = this.heldTool(), f = pl.forward(), l = Math.hypot(f[0], f[2]) || 1;
        m.mob.damage(creative ? 999 : t ? t.dmg : 1, f[0] / l, f[2] / l, this);
        this.swingCd = 0.4; this.useTool(); this.exhaustion += 0.05; this.breaking = null; return;
      }
    }
    if (!ray) { this.breaking = null; return; }
    const [x, y, z] = ray.hit;
    if (creative) {
      this.repT -= dt;
      if (edge || this.repT <= 0) { this.removeBlock(x, y, z, ray.block, false); this.repT = 0.22; }
      return;
    }
    const k = x + ',' + y + ',' + z;
    if (!this.breaking || this.breaking.k !== k) this.breaking = { k, p: 0 };
    this.breaking.p += dt / breakTime(ray.block, this.heldTool());
    if (this.breaking.p >= 1) { this.removeBlock(x, y, z, ray.block, true); this.breaking = null; this.useTool(); this.exhaustion += 0.03; }
  }
  removeBlock(x, y, z, block, drops) {
    if (!this.world.setBlock(x, y, z, 0)) return;
    const fk = x + ',' + y + ',' + z, f = this.furnaces.get(fk);
    if (f) { for (const s of [f.in, f.fuel, f.out]) if (s) this.spawnDrop(s.id, s.n, s.d, x + 0.5, y + 0.5, z + 0.5); this.furnaces.delete(fk); }
    if (this.bed && this.bed[0] === x && this.bed[1] === y && this.bed[2] === z) this.bed = null;
    if (!drops) return;
    const d = dropFor(block, this.heldTool());
    if (d) this.spawnDrop(d[0], d[1], undefined, x + 0.5, y + 0.4, z + 0.5);
  }
  use(first) {
    const pl = this.player, ray = pl.raycast(this.world, this.mode === 'creative' ? 6 : 4.5);
    if (ray && first) {
      const [x, y, z] = ray.hit;
      if (ray.block === B.WORKBENCH) return this.ui.openInventory('bench');
      if (ray.block === B.FURNACE) {
        const k = x + ',' + y + ',' + z;
        if (!this.furnaces.has(k)) this.furnaces.set(k, { in: null, fuel: null, out: null, burn: 0, burnMax: 1, cook: 0 });
        return this.ui.openInventory('furnace', this.furnaces.get(k));
      }
      if (ray.block === B.BED) return this.sleep(x, y, z);
    }
    const h = this.held();
    if (!h) return;
    const it = ITEMS[h.id];
    if (it.food) {
      if (!first || !this.survival()) return;
      if (this.hunger >= 20) return this.ui.toast('Du bist satt');
      this.hunger = Math.min(20, this.hunger + it.food); this.inv.take(this.slot, 1); this.invChanged = true;
      return;
    }
    if (!it.block || !ray || !ray.prev) return;
    const [x, y, z] = ray.prev;
    if (pl.intersectsBlock(x, y, z)) return;
    for (const m of this.mobs) if (x + 1 > m.pos[0] - m.w && x < m.pos[0] + m.w && y + 1 > m.pos[1] && y < m.pos[1] + m.h && z + 1 > m.pos[2] - m.w && z < m.pos[2] + m.w) return;
    if (!this.world.setBlock(x, y, z, h.id)) return;
    if (this.survival()) { this.inv.take(this.slot, 1); this.invChanged = true; }
  }
  sleep(x, y, z) {
    this.bed = [x, y, z];
    if (this.isDay()) return this.ui.toast('Spawnpunkt gesetzt – schlafen geht nur nachts');
    this.time = 6; this.mobs = this.mobs.filter((m) => !m.def.hostile);
    this.ui.toast('Guten Morgen! Spawnpunkt gesetzt');
  }

  // ---- fester Tick (20 TPS): Zeit, Figuren, Drops, Öfen, Überlebenswerte ----
  tick() {
    this.tickN++;
    if (this.timeRunning) this.time = (this.time + 24 / 24000) % 24;
    for (const m of this.mobs) if (!m.dead) m.tick(this);
    for (const d of this.drops) if (!d.dead) d.tick(this);
    if (this.tickN % 20 === 0) { this.mobs = this.mobs.filter((m) => !m.dead); this.drops = this.drops.filter((d) => !d.dead); if (this.tickN % 40 === 0) trySpawn(this); }
    for (const f of this.furnaces.values()) this.tickFurnace(f);
    if (this.hurtCd > 0) this.hurtCd--;
    if (!this.survival() || this.dead) return;
    const pl = this.player, moving = Math.hypot(pl.vel[0], pl.vel[2]);
    this.exhaustion += moving > 5 ? 0.004 : moving > 0.5 ? 0.0015 : 0.0005;
    if (this.exhaustion >= 1) { this.exhaustion -= 1; this.hunger = Math.max(0, this.hunger - 1); }
    if (this.tickN % 80 === 0) {
      if (this.hunger >= 18 && this.health < 20) { this.health++; this.exhaustion += 0.4; } // voller Hunger heilt
      else if (this.hunger <= 0 && this.health > 1) this.hurtPlayer(1, null, true);
    }
    if (pl.headInWater) { this.air = Math.max(0, this.air - 10 / 300); if (this.air <= 0 && this.tickN % 20 === 0) this.hurtPlayer(2, null, true); }
    else this.air = Math.min(10, this.air + 0.25);
  }
  tickFurnace(f) {
    const res = f.in && SMELT[f.in.id], can = res && (!f.out || (f.out.id === res && f.out.n < 64));
    if (f.burn <= 0 && can && f.fuel && FUEL[f.fuel.id]) { f.burn = f.burnMax = FUEL[f.fuel.id]; if (--f.fuel.n <= 0) f.fuel = null; }
    if (f.burn > 0) {
      f.burn--;
      if (!can) f.cook = 0;
      else if (++f.cook >= SMELT_TICKS) { f.cook = 0; if (--f.in.n <= 0) f.in = null; if (f.out) f.out.n++; else f.out = mk(res, 1); }
    } else f.cook = 0;
  }
  hurtPlayer(n, knock, force) {
    if (!this.survival() || this.dead || (this.hurtCd > 0 && !force)) return;
    this.health -= n; this.hurtCd = 10; this.hurtFlash = 0.35;
    if (knock) { this.player.vel[0] = knock[0] * 7; this.player.vel[2] = knock[1] * 7; this.player.vel[1] = 5; }
    if (this.health <= 0) this.die();
  }
  die() {
    this.health = 0; this.dead = true; this.breaking = null;
    const p = this.player.pos;
    this.inv.slots.forEach((s, i) => { // Items bleiben am Todesort liegen
      if (!s) return;
      const d = this.spawnDrop(s.id, s.n, s.d, p[0], p[1] + 0.8, p[2]); d.ttl = 18000; d.delay = 40;
      this.inv.slots[i] = null;
    });
    this.invChanged = true;
    this.ui.showDeath();
  }
  respawn() {
    const pl = this.player;
    let pos = this.worldSpawn();
    if (this.bed) { if (this.world.getBlock(...this.bed) === B.BED || !this.world.isLoaded(this.bed[0], this.bed[2])) pos = [this.bed[0] + 0.5, this.bed[1] + 1.01, this.bed[2] + 0.5]; else this.bed = null; }
    pl.pos = pos; pl.vel = [0, 0, 0]; pl.peakY = pos[1];
    this.health = 20; this.hunger = 20; this.air = 10; this.exhaustion = 0; this.dead = false; this.hurtCd = 40;
  }
  serialize() {
    const pl = this.player;
    return {
      time: this.time, timeRunning: this.timeRunning, slot: this.slot, health: this.health, hunger: this.hunger, air: this.air, bed: this.bed, dead: this.dead,
      inv: this.inv.toJSON(), player: { pos: pl.pos.slice(), yaw: pl.yaw, pitch: pl.pitch, flying: pl.flying },
      furnaces: [...this.furnaces], drops: this.drops.filter((d) => !d.dead).map((d) => ({ item: d.item, pos: d.pos.slice(), ttl: d.ttl - d.age })),
    };
  }
}
