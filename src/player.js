// Spielerphysik (AABB-Kollision, Fliegen im Kreativmodus), Blick-Strahl für Abbauen/Setzen.
import { B, isSolid } from './blocks.js';
const W = 0.3, HGT = 1.8, EYE = 1.62;
export class Player {
  constructor() { this.pos = [0, 60, 0]; this.vel = [0, 0, 0]; this.yaw = 0; this.pitch = 0; this.onGround = false; this.inWater = false; this.headInWater = false; this.flying = false; this.peakY = 0; this.landed = 0; }
  eye() { return [this.pos[0], this.pos[1] + EYE, this.pos[2]]; }
  forward() { const cp = Math.cos(this.pitch); return [Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp]; }
  collides(world, x, y, z) {
    for (let by = Math.floor(y); by <= Math.floor(y + HGT - 0.001); by++)
      for (let bz = Math.floor(z - W); bz <= Math.floor(z + W); bz++)
        for (let bx = Math.floor(x - W); bx <= Math.floor(x + W); bx++) if (isSolid(world.getBlock(bx, by, bz))) return true;
    return false;
  }
  // liefert in this.landed die Fallhöhe, sobald der Spieler aufkommt (für Fallschaden)
  update(dt, inp, world) {
    this.landed = 0;
    if (!world.isLoaded(Math.floor(this.pos[0]), Math.floor(this.pos[2]))) return;
    const p = this.pos, v = this.vel;
    this.inWater = world.getBlock(Math.floor(p[0]), Math.floor(p[1] + 0.4), Math.floor(p[2])) === B.WATER;
    this.headInWater = world.getBlock(Math.floor(p[0]), Math.floor(p[1] + EYE + 0.1), Math.floor(p[2])) === B.WATER;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const sp = this.flying ? 10 : (this.inWater ? 2.6 : 4.6) * (inp.sprint ? 1.5 : 1);
    const tx = (inp.mx * c + inp.mz * s) * sp, tz = (inp.mx * s - inp.mz * c) * sp;
    const acc = this.flying || this.onGround || this.inWater ? 14 : 4, k = Math.min(1, acc * dt);
    v[0] += (tx - v[0]) * k; v[2] += (tz - v[2]) * k;
    const wasGround = this.onGround;
    if (this.flying) v[1] += (((inp.jump ? 1 : 0) - (inp.crouch ? 1 : 0)) * 8 - v[1]) * Math.min(1, 12 * dt);
    else if (this.inWater) { v[1] += -6 * dt; v[1] *= Math.max(0, 1 - 3 * dt); if (inp.jump) v[1] = Math.min(v[1] + 22 * dt, 3.2); }
    else { v[1] -= 26 * dt; if (inp.jump && this.onGround) v[1] = 8.4; }
    v[1] = Math.max(v[1], -50);
    this.onGround = false;
    const steps = Math.ceil(Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])) * dt / 0.4) || 1, h = dt / steps;
    let wantJump = false;
    for (let i = 0; i < steps; i++) {
      for (const a of [1, 0, 2]) {
        const old = p[a]; p[a] += v[a] * h;
        if (!this.collides(world, p[0], p[1], p[2])) continue;
        const dir = Math.sign(v[a]);
        p[a] = old;
        if (a === 1) { if (v[1] < 0) this.onGround = true; v[1] = 0; continue; }
        // eine Blockstufe automatisch hochspringen (angenehmer auf dem Handy)
        if (inp.autoJump && !this.collides(world, p[0] + (a === 0 ? dir * 0.4 : 0), p[1] + 1.05, p[2] + (a === 2 ? dir * 0.4 : 0))) wantJump = true;
        v[a] = 0;
      }
    }
    if (wantJump && this.onGround && !this.inWater && !this.flying) v[1] = 8.4;
    if (this.flying && this.onGround && inp.crouch) this.flying = false; // landen beendet den Flug
    // Fallhöhe mitführen
    if (this.flying || this.inWater || wasGround) this.peakY = p[1];
    this.peakY = Math.max(this.peakY, p[1]);
    if (this.onGround && !wasGround) { this.landed = this.peakY - p[1]; this.peakY = p[1]; }
    if (p[1] < -20) { p[1] = 90; v[1] = 0; this.peakY = 0; }
  }
  // DDA-Strahl: liefert getroffenen Block, den freien Block davor und die Entfernung
  raycast(world, max = 6) {
    const o = this.eye(), d = this.forward();
    let x = Math.floor(o[0]), y = Math.floor(o[1]), z = Math.floor(o[2]);
    const st = [Math.sign(d[0]), Math.sign(d[1]), Math.sign(d[2])];
    const td = [Math.abs(1 / d[0]), Math.abs(1 / d[1]), Math.abs(1 / d[2])];
    const tm = [0, 1, 2].map((a) => { const f = o[a] - Math.floor(o[a]); return (st[a] > 0 ? 1 - f : f) * td[a]; });
    let prev = null, t = 0;
    for (let i = 0; i < 64; i++) {
      const b = world.getBlock(x, y, z);
      if (isSolid(b)) return { hit: [x, y, z], prev, block: b, dist: t };
      prev = [x, y, z];
      const a = tm[0] < tm[1] ? (tm[0] < tm[2] ? 0 : 2) : (tm[1] < tm[2] ? 1 : 2);
      if (tm[a] > max) return null;
      t = tm[a]; tm[a] += td[a];
      if (a === 0) x += st[0]; else if (a === 1) y += st[1]; else z += st[2];
    }
    return null;
  }
  intersectsBlock(x, y, z) { const p = this.pos; return x + 1 > p[0] - W && x < p[0] + W && y + 1 > p[1] && y < p[1] + HGT && z + 1 > p[2] - W && z < p[2] + W; }
}
