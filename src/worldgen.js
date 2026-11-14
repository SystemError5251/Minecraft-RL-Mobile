// Weltgenerator: Wiese mit Hügeln, Wald mit Seen, Sumpf. Läuft im Worker (und für Spawn-Höhe im Hauptthread).
import { hash2, hash3, vnoise, vnoise3, fbm, smoothstep } from './noise.js';
import { B } from './blocks.js';
export const CS = 16, CH = 96, SEA = 40;
let SEED = 1337, SCENE = null;
export function configure(c) { SEED = c.seed ?? 1337; SCENE = c.scene ?? null; }
export const getScene = () => SCENE;
export const getSeed = () => SEED;

// Block-Showcase: einzelne Blöcke frei schwebend
export const SHOWCASE = [
  [B.GRASS, B.DIRT, B.STONE, B.SAND],
  [B.LOG, B.LEAVES, B.BRICKS, B.ORE],
  [B.BASALT, B.BASALT_GOLD, B.BASALT_VIOLET, B.BASALT_TEAL],
].flatMap((row, j) => row.map((b, i) => ({ b, x: 1 + i * 3, y: 50, z: 1 + j * 3 })));

const out3 = [0, 0, 0];
export function biomeAt(x, z) { // -> [Wiese, Wald, Sumpf]
  if (SCENE === 'meadow') { out3[0] = 1; out3[1] = 0; out3[2] = 0; return out3; }
  if (SCENE === 'forest') { out3[0] = 0; out3[1] = 1; out3[2] = 0; return out3; }
  if (SCENE === 'swamp') { out3[0] = 0; out3[1] = 0; out3[2] = 1; return out3; }
  const n = fbm(x / 260, z / 260, SEED + 5, 3);
  const s = 1 - smoothstep(0.38, 0.45, n), f = smoothstep(0.54, 0.61, n);
  out3[0] = 1 - s - f; out3[1] = f; out3[2] = s; return out3;
}
export const lakeDist = (x, z) => Math.hypot((x - 26) / 30, z / 24) + (fbm(x / 14, z / 14, SEED + 23, 2) - 0.5) * 0.35;
// Schneise in Sonnenrichtung (Waldsee-Szene), damit das Gegenlicht den See erreicht
export const gladeDist = (x, z) => (x > 20 ? Math.abs((x - 20) * -0.28 + z * 0.96) : 99);
export const channelDist = (x, z) => Math.abs(z + 5 * Math.sin(x / 23) + 3 * Math.sin(x / 9));

export function heightAt(x, z) {
  const w = biomeAt(x, z), m = w[0], f = w[1], s = w[2];
  let h = 0;
  if (m > 0) {
    let hm;
    if (SCENE === 'meadow') hm = smoothstep(9, 60, Math.abs(x - 7 * Math.sin(z / 37))) * (0.45 + 0.55 * fbm(x / 60, z / 60, SEED + 9, 2));
    else hm = smoothstep(0.45, 0.72, fbm(x / 150, z / 150, SEED + 9, 2));
    h += m * (43.5 + fbm(x / 38, z / 38, SEED + 2, 3) * 3.5 + hm * (4 + fbm(x / 75, z / 75, SEED + 3, 4) * 46));
  }
  if (f > 0) {
    let fh = 43.5 + fbm(x / 48, z / 48, SEED + 4, 4) * 9;
    if (SCENE === 'forest') fh = 42.2 + fbm(x / 40, z / 40, SEED + 4, 4) * 5 * smoothstep(3, 14, gladeDist(x, z)) - (1 - smoothstep(0.7, 1.08, lakeDist(x, z))) * 9;
    else fh -= smoothstep(0.60, 0.70, fbm(x / 85, z / 85, SEED + 21, 2)) * 11;
    h += f * fh;
  }
  if (s > 0) {
    let sh = 38.6 + fbm(x / 17, z / 17, SEED + 6, 3) * 3.2;
    if (SCENE === 'swamp') sh -= (1 - smoothstep(2.5, 7, channelDist(x, z))) * 2.4;
    h += s * sh;
  }
  return h;
}
export const surfaceY = (x, z) => Math.max(Math.floor(heightAt(x, z)), SEA - 1) + 1;

export function generateChunk(cx, cz) {
  const blocks = new Uint8Array(CS * CS * CH);
  const x0 = cx * CS, z0 = cz * CS;
  const set = (wx, wy, wz, b, onlyAir) => {
    const lx = wx - x0, lz = wz - z0;
    if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || wy < 0 || wy >= CH) return;
    const i = lx + lz * CS + wy * CS * CS;
    if (onlyAir && blocks[i] !== 0) return;
    blocks[i] = b;
  };
  if (SCENE === 'showcase') {
    for (const s of SHOWCASE) set(s.x, s.y, s.z, s.b);
    return blocks;
  }
  for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
    const wx = x0 + lx, wz = z0 + lz;
    const hi = Math.min(CH - 24, Math.max(2, Math.floor(heightAt(wx, wz))));
    const swampy = biomeAt(wx, wz)[2] > 0.5;
    const sandy = !swampy && hi <= SEA;
    const top = hi < SEA - 1 ? (swampy ? B.DIRT : B.SAND) : sandy ? B.SAND : B.GRASS;
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
    // Höhlen: Schnitt zweier Rauschbänder ergibt Gänge; vereinzelt Eingänge bis zur Oberfläche
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
  // Basalt-Findlinge mit Adern
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
  // Bäume
  const TC = 4, M = 6;
  for (let gz = Math.floor((z0 - M) / TC); gz <= Math.floor((z0 + CS + M) / TC); gz++)
    for (let gx = Math.floor((x0 - M) / TC); gx <= Math.floor((x0 + CS + M) / TC); gx++) {
      const tx = gx * TC + Math.floor(hash2(gx, gz, SEED + 51) * TC), tz = gz * TC + Math.floor(hash2(gx, gz, SEED + 52) * TC);
      const w = biomeAt(tx, tz), m = w[0], f = w[1], s = w[2];
      let p = m * 0.012 + f * 0.40 + s * 0.12;
      if (SCENE === 'forest') { const d = lakeDist(tx, tz); if (d < 1.2 || gladeDist(tx, tz) < 9) continue; if (d < 1.5) p *= 0.5; }
      if (SCENE === 'swamp' && channelDist(tx, tz) < 6) continue;
      if (SCENE === 'meadow' && Math.abs(tx) < 16) continue;
      if (hash2(gx, gz, SEED + 53) > p) continue;
      const h = Math.floor(heightAt(tx, tz));
      if (h < SEA - (s > 0.5 ? 2 : 0) || h > CH - 30) continue;
      const r1 = hash2(gx, gz, SEED + 54), r2 = hash2(gx, gz, SEED + 55);
      const swampy = s > 0.5;
      const th = (swampy ? 5 : 4) + Math.floor(r1 * 4) + (f > 0.5 ? 1 : 0);
      const rx = swampy ? 3.1 + r2 * 1.3 : 2.3 + r2 * 1.0, ry = swampy ? 1.7 + r1 * 0.5 : 2.0 + r1 * 0.7;
      for (let y = 1; y <= th; y++) set(tx, h + y, tz, B.LOG);
      const cy = h + th + 0.5, R = Math.ceil(rx), Ry = Math.ceil(ry);
      for (let dy = -Ry; dy <= Ry + 1; dy++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        const yy = Math.floor(cy) + dy, d = (dx * dx + dz * dz) / (rx * rx) + ((yy + 0.5 - cy - 0.4) ** 2) / (ry * ry);
        if (d + (hash3(tx + dx, yy, tz + dz, SEED + 56) - 0.5) * 0.45 < 1) set(tx + dx, yy, tz + dz, B.LEAVES, true);
      }
    }
  return blocks;
}
