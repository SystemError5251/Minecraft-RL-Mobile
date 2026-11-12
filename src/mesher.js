// Chunk-Mesher: Flächen-Culling, Smooth Lighting + Vertex-AO, Wasser-Mesh, Gras-/Blumen-Instanzen.
import { CS, CH, SEA, biomeAt, getScene, getSeed, lakeDist } from './worldgen.js';
import { B, FACE_LAYER } from './blocks.js';
import { hash2 } from './noise.js';
import { L } from './texlayers.js';

const PW = CS + 2, PA = PW * PW, PH = CH + 2, PN = PA * PH;
const pad = new Uint8Array(PN), light = new Uint8Array(PN), queue = new Int32Array(PN * 8);
// Richtungen: +x, -x, +y, -y, +z, -z  (n, u, v mit u × v = n)
const DIRS = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
].map((d) => { const idx = (a) => a[0] + a[2] * PW + a[1] * PA; return { ...d, dn: idx(d.n), du: idx(d.u), dv: idx(d.v) }; });
const NB = [1, -1, PA, -PA, PW, -PW];
const CORN = [[0, 0], [1, 0], [1, 1], [0, 1]];

class Buf {
  constructor() { this.a = new Uint8Array(1 << 18); this.n = 0; }
  need(k) { if (this.n + k > this.a.length) { const b = new Uint8Array(this.a.length * 2); b.set(this.a); this.a = b; } }
  take() { return this.a.slice(0, this.n); }
}
const opaqueBuf = new Buf(), waterBuf = new Buf();
const aoT = new Uint8Array(4), ltT = new Uint8Array(4);

export function meshChunk(get, cx, cz) {
  // gepolstertes Volumen aus 3x3 Chunks füllen
  pad.fill(0);
  pad.fill(B.STONE, 0, PA);
  let maxY = 0;
  for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
    const src = get(cx + ox, cz + oz);
    const xa = ox < 0 ? CS - 1 : 0, xb = ox > 0 ? 1 : CS, za = oz < 0 ? CS - 1 : 0, zb = oz > 0 ? 1 : CS;
    for (let y = 0; y < CH; y++) for (let z = za; z < zb; z++) for (let x = xa; x < xb; x++) {
      const b = src[x + z * CS + y * CS * CS];
      if (b) { pad[(x + ox * CS + 1) + (z + oz * CS + 1) * PW + (y + 1) * PA] = b; if (y > maxY) maxY = y; }
    }
  }
  // Himmelslicht: senkrecht von oben, dann Flood-Fill
  light.fill(0);
  let qn = 0;
  const top = Math.min(CH, maxY + 2);
  for (let z = 0; z < PW; z++) for (let x = 0; x < PW; x++) {
    let l = 15;
    for (let y = PH - 1; y >= 1; y--) {
      const p = x + z * PW + y * PA, b = pad[p];
      if (b !== 0) { if (b === B.WATER) l -= 2; else if (b === B.LEAVES) l -= 3; else break; if (l <= 0) break; }
      light[p] = l;
      if (y <= top + 1) queue[qn++] = p;
    }
  }
  for (let qi = 0; qi < qn; qi++) {
    const p = queue[qi], l = light[p];
    if (l <= 1) continue;
    const x = p % PW, z = ((p / PW) | 0) % PW;
    for (let k = 0; k < 6; k++) {
      if ((k === 0 && x === PW - 1) || (k === 1 && x === 0) || (k === 4 && z === PW - 1) || (k === 5 && z === 0)) continue;
      const q = p + NB[k];
      if (q < PA || q >= PN) continue;
      const b = pad[q];
      if (b !== 0 && b !== B.WATER && b !== B.LEAVES) continue;
      const nl = l - (b === 0 ? 1 : 2);
      if (nl > light[q] && qn < queue.length) { light[q] = nl; queue[qn++] = q; }
    }
  }

  opaqueBuf.n = 0; waterBuf.n = 0;
  const tufts = [];
  const scene = getScene(), seed = getSeed(), wx0 = cx * CS, wz0 = cz * CS;
  for (let y = 0; y <= Math.min(CH - 1, maxY); y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const p = (x + 1) + (z + 1) * PW + (y + 1) * PA, b = pad[p];
    if (b === 0) continue;
    const isWater = b === B.WATER, isLeaf = b === B.LEAVES;
    const surface = isWater && pad[p + PA] !== B.WATER;
    for (let d = 0; d < 6; d++) {
      const D = DIRS[d], o = p + D.dn, nb = pad[o];
      if (isWater) { if (d === 3 || nb === B.WATER || (nb !== 0 && nb !== B.LEAVES)) continue; }
      else if ((nb !== 0 && nb !== B.WATER && nb !== B.LEAVES) || (isLeaf && nb === B.LEAVES)) continue;
      const buf = isWater ? waterBuf : opaqueBuf;
      buf.need(32);
      for (let c = 0; c < 4; c++) {
        const su = CORN[c][0] ? D.du : -D.du, sv = CORN[c][1] ? D.dv : -D.dv;
        const b1 = pad[o + su], b2 = pad[o + sv], b3 = pad[o + su + sv];
        const s1 = b1 !== 0 && b1 !== B.WATER, s2 = b2 !== 0 && b2 !== B.WATER, s3 = b3 !== 0 && b3 !== B.WATER;
        aoT[c] = s1 && s2 ? 0 : 3 - (s1 + s2 + s3);
        let sum = light[o], cnt = 1;
        if (!s1) { sum += light[o + su]; cnt++; }
        if (!s2) { sum += light[o + sv]; cnt++; }
        if (!s3 && !(s1 && s2)) { sum += light[o + su + sv]; cnt++; }
        ltT[c] = Math.round(sum / cnt * 17);
      }
      const flip = aoT[0] + aoT[2] < aoT[1] + aoT[3] || (aoT[0] + aoT[2] === aoT[1] + aoT[3] && ltT[0] + ltT[2] < ltT[1] + ltT[3]);
      const layer = FACE_LAYER[b * 6 + d];
      for (let k = 0; k < 4; k++) {
        const c = flip ? (k + 1) & 3 : k, cu = CORN[c][0], cv = CORN[c][1];
        const vx = x + (D.n[0] > 0 ? 1 : 0) + D.u[0] * cu + D.v[0] * cv;
        const vy = y + (D.n[1] > 0 ? 1 : 0) + D.u[1] * cu + D.v[1] * cv;
        const vz = z + (D.n[2] > 0 ? 1 : 0) + D.u[2] * cu + D.v[2] * cv;
        const a = buf.a, n = buf.n;
        a[n] = vx; a[n + 1] = vy; a[n + 2] = vz; a[n + 3] = d | (vy === y + 1 ? 8 : 0);
        a[n + 4] = layer; a[n + 5] = aoT[c] * 85; a[n + 6] = ltT[c];
        a[n + 7] = isWater ? (surface && vy === y + 1 ? 1 : 0) : isLeaf ? 3 : 0;
        buf.n += 8;
      }
    }
    // Gras- und Blumenbüschel
    const above = pad[p + PA];
    const reedInWater = b === B.DIRT && above === B.WATER && pad[p + 2 * PA] === 0;
    if ((b === B.GRASS && above === 0 && light[p + PA] >= 8) || reedInWater) {
      const wx = wx0 + x, wz = wz0 + z, w = biomeAt(wx, wz), m = w[0], f = w[1], s = w[2];
      const r = hash2(wx, wz, seed + 71), r2 = hash2(wx, wz, seed + 72), r3 = hash2(wx, wz, seed + 73), r4 = hash2(wx, wz, seed + 74);
      let layer = -1, hgt = 1;
      if (scene === 'showcase') { layer = L.tuft_grass; hgt = 0.8; }
      else if (reedInWater) { if (s > 0.5 && r < 0.3) { layer = L.reed; hgt = 2.6 + r2 * 0.6; } }
      else {
        const reedP = s * (y <= SEA ? 0.4 : 0.06);
        let flowerP = 0.02 * m + 0.09 * f + 0.012 * s;
        if (scene === 'forest' && lakeDist(wx, wz) < 1.35) flowerP = 0.2;
        const grassP = 0.36 * m + 0.26 * f + 0.34 * s;
        if (r < reedP) { layer = L.reed; hgt = 1.7 + r2 * 0.7; }
        else if (r < reedP + flowerP) {
          const k = Math.floor(r2 * 4);
          layer = [L.flower_red, L.flower_white, L.flower_yellow, L.flower_pink][k];
          hgt = k === 3 ? 1.25 + r3 * 0.4 : 0.75 + r3 * 0.25;
        } else if (r < reedP + flowerP + grassP) {
          const tall = r2 < 0.45 * m + 0.2 * f + 0.35 * s;
          layer = tall ? L.tuft_tall : L.tuft_grass; hgt = tall ? 1.1 + r3 * 0.5 : 0.65 + r3 * 0.35;
        }
      }
      if (layer >= 0) tufts.push(wx + 0.5 + (r3 - 0.5) * 0.4, y + 1, wz + 0.5 + (r4 - 0.5) * 0.4, hgt, layer, r4, s, light[p + PA + (reedInWater ? PA : 0)] / 15);
    }
  }
  // Instanzen mischen, damit die Dichte je Qualitätsstufe einfach über die Anzahl skaliert
  const n = tufts.length / 8, tf = new Float32Array(tufts);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(hash2(i, cx * 31 + cz, seed + 75) * (i + 1));
    for (let k = 0; k < 8; k++) { const t = tf[i * 8 + k]; tf[i * 8 + k] = tf[j * 8 + k]; tf[j * 8 + k] = t; }
  }
  return { opaque: opaqueBuf.take(), water: waterBuf.take(), tufts: tf };
}
