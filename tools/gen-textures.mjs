// Prozeduraler Textur-Generator. Erzeugt für jeden Layer:
//   Albedo (sRGB) + A = Emissive-Maske (bzw. Deckkraft bei Laub/Büscheln)
//   Normal-Map (RG) + B = Roughness + A = Höhe (für Parallax)
// Ausgabe: assets/tex64.bin und assets/tex128.bin (rohes RGBA, erst alle Albedo-Layer, dann alle Normal-Layer).
// Es werden keine fremden Bilder verwendet – alles entsteht aus Rauschen, Voronoi-Zellen und Pinselstrichen.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { LAYERS } from '../src/texlayers.js';

const N = 128;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- Hilfsfunktionen ----------
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const mod = (a, p) => ((a % p) + p) % p;
function h2(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function rng(seed) { let i = 0; return () => h2(i++, 7919, seed); }
// periodisches Value-Noise
function pn(x, y, px, py, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const x0 = mod(xi, px), x1 = mod(xi + 1, px), y0 = mod(yi, py), y1 = mod(yi + 1, py);
  return mix(mix(h2(x0, y0, s), h2(x1, y0, s), sx), mix(h2(x0, y1, s), h2(x1, y1, s), sx), sy);
}
function fbm(u, v, f, oct, s, fy = f) {
  let a = 0.5, sum = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    sum += a * pn(u * f, v * fy, f, fy, s + i * 31); n += a; a *= 0.5; f *= 2; fy *= 2;
  }
  return sum / n;
}
// periodisches Voronoi: f1, f2, Zell-ID, Vektor zum Zellzentrum
function vor(u, v, cells, s, jit = 0.9) {
  const x = u * cells, y = v * cells, xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0, dx = 0, dy = 0;
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
    const cx = xi + i, cy = yi + j, mx = mod(cx, cells), my = mod(cy, cells);
    const px = cx + 0.5 + (h2(mx, my, s) - 0.5) * jit, py = cy + 0.5 + (h2(mx, my, s + 1) - 0.5) * jit;
    const ddx = x - px, ddy = y - py, d = Math.hypot(ddx, ddy);
    if (d < f1) { f2 = f1; f1 = d; id = h2(mx, my, s + 2); dx = ddx; dy = ddy; } else if (d < f2) f2 = d;
  }
  return { f1, f2, id, dx, dy };
}

// ---------- Layer-Puffer ----------
function newLayer() {
  return { c: new Float32Array(N * N * 3), h: new Float32Array(N * N).fill(0.5), r: new Float32Array(N * N).fill(0.9), a: new Float32Array(N * N) };
}
function fill(Lr, fn) {
  const o = { c: [0, 0, 0], h: 0.5, r: 0.9, a: 0 };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    o.a = 0; o.r = 0.9; o.h = 0.5;
    fn((x + 0.5) / N, (y + 0.5) / N, o);
    const i = y * N + x;
    Lr.c[i * 3] = o.c[0]; Lr.c[i * 3 + 1] = o.c[1]; Lr.c[i * 3 + 2] = o.c[2];
    Lr.h[i] = o.h; Lr.r[i] = o.r; Lr.a[i] = o.a;
  }
}
// weicher Pinsel-Stempel
function stamp(Lr, x, y, rad, col, hv, o) {
  const x0 = Math.floor(x - rad - 1), x1 = Math.ceil(x + rad + 1), y0 = Math.floor(y - rad - 1), y1 = Math.ceil(y + rad + 1);
  for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
    let qx = px, qy = py;
    if (o.wrapU) qx = mod(px, N); else if (px < 0 || px >= N) continue;
    if (o.wrapV) qy = mod(py, N); else if (py < 0 || py >= N) continue;
    const d = Math.hypot(px + 0.5 - x, py + 0.5 - y);
    const cov = clamp(rad - d + 0.5) * (o.op ?? 1);
    if (cov <= 0) continue;
    const i = qy * N + qx;
    Lr.c[i * 3] = mix(Lr.c[i * 3], col[0], cov); Lr.c[i * 3 + 1] = mix(Lr.c[i * 3 + 1], col[1], cov); Lr.c[i * 3 + 2] = mix(Lr.c[i * 3 + 2], col[2], cov);
    Lr.h[i] = mix(Lr.h[i], hv, cov);
    if (o.alpha) Lr.a[i] = Math.max(Lr.a[i], cov);
    if (o.rough !== undefined) Lr.r[i] = mix(Lr.r[i], o.rough, cov);
  }
}
// Pinselstrich (quadratische Kurve), Koordinaten in Pixeln
function stroke(Lr, x0, y0, x1, y1, bx, by, w0, w1, c0, c1, h0, h1, o) {
  const len = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(bx, by);
  const steps = Math.max(2, Math.ceil(len * 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, k = 4 * t * (1 - t);
    stamp(Lr, mix(x0, x1, t) + bx * k, mix(y0, y1, t) + by * k, mix(w0, w1, t), mix3(c0, c1, t), mix(h0, h1, t), o);
  }
}

// ---------- Material-Generatoren ----------
function dirtAt(u, v, o) {
  const n = fbm(u, v, 5, 5, 11), n2 = fbm(u, v, 12, 3, 12);
  const cl = vor(u, v, 10, 13);
  const clump = ss(0.0, 0.5, cl.f2 - cl.f1);
  let h = 0.25 + 0.3 * n + 0.2 * clump * n2;
  let c = mix3([0.17, 0.10, 0.06], [0.40, 0.26, 0.15], clamp(n * 0.9 + clump * 0.35 - 0.1));
  c = mix3(c, [0.30, 0.17, 0.11], ss(0.55, 0.8, fbm(u, v, 3, 2, 14)) * 0.6);
  // Steinchen
  const pb = vor(u, v, 7, 15, 1.0);
  const rad = 0.12 + 0.22 * h2(Math.floor(pb.id * 1e6), 3, 16);
  if (pb.id > 0.62 && pb.f1 < rad) {
    const t = 1 - pb.f1 / rad, dome = Math.sqrt(t);
    const lit = clamp(0.55 + (-pb.dx * 0.7 - pb.dy * 0.9) / rad * 0.45);
    const pc = mix3([0.33, 0.30, 0.26], [0.66, 0.62, 0.54], lit * (0.6 + 0.4 * pb.id));
    const e = ss(0, 0.25, t);
    c = mix3(mix3(c, [0.08, 0.05, 0.03], 0.6), pc, e);
    h = mix(h - 0.1, 0.55 + 0.4 * dome, e);
    o.r = mix(0.95, 0.7, e);
  } else o.r = 0.95;
  const g = (h2(Math.floor(u * N), Math.floor(v * N), 17) - 0.5) * 0.06;
  o.c = [c[0] + g, c[1] + g, c[2] + g]; o.h = h;
}

function basaltAt(u, v, o, vein) {
  const wu = u + 0.035 * (fbm(u, v, 4, 2, 21) - 0.5), wv = v + 0.035 * (fbm(u, v, 4, 2, 22) - 0.5);
  const vo = vor(wu, wv, 5, 23, 0.95);
  const edge = vo.f2 - vo.f1;
  const stone = ss(0.03, 0.26, edge), dome = Math.pow(stone, 0.6);
  const n = fbm(u, v, 14, 3, 24), brush = fbm(u, v, 3, 3, 25, 9);
  const tones = [[0.085, 0.095, 0.15], [0.12, 0.125, 0.185], [0.07, 0.072, 0.105], [0.135, 0.115, 0.13], [0.10, 0.12, 0.17]];
  const tone = tones[Math.floor(vo.id * tones.length)];
  let c = [tone[0] * (0.45 + 0.9 * dome), tone[1] * (0.45 + 0.9 * dome), tone[2] * (0.45 + 0.9 * dome)];
  const hl = clamp((-vo.dx * 0.6 - vo.dy * 0.8) * 2.2) * stone;
  c = [c[0] + 0.07 * hl * hl, c[1] + 0.09 * hl * hl, c[2] + 0.15 * hl * hl];
  c = mix3(c, [0.20, 0.11, 0.07], ss(0.6, 0.85, fbm(u, v, 6, 3, 26)) * 0.45 * stone);
  const b = 0.8 + 0.4 * brush;
  c = [c[0] * b, c[1] * b, c[2] * b];
  c = mix3([0.02, 0.02, 0.03], c, ss(0.0, 0.07, edge));
  let h = 0.12 + 0.68 * dome + 0.12 * n;
  o.r = 0.62 + 0.25 * n;
  if (vein) {
    const sel = ss(vein.sel, vein.sel + 0.14, fbm(u, v, 3, 2, vein.seed));
    const mask = (1 - ss(0.0, vein.w, edge)) * sel;
    const core = (1 - ss(0.0, vein.w * 0.4, edge)) * sel;
    c = mix3(c, vein.col, mask);
    c = mix3(c, vein.hot, core);
    o.a = clamp(mask * 0.6 + core * 0.5) * vein.em;
    o.r = mix(o.r, vein.rough, mask);
    h = mix(h, 0.42, mask);
  }
  o.c = c; o.h = h;
}

function stoneAt(u, v, o) {
  const fac = vor(u + 0.05 * fbm(u, v, 3, 2, 31), v + 0.05 * fbm(u, v, 3, 2, 32), 3, 33, 1.0);
  const n = fbm(u, v, 5, 5, 34), fine = fbm(u, v, 20, 3, 35);
  const cr = Math.abs(fbm(u, v, 4, 4, 36) - 0.5), crack = 1 - ss(0.0, 0.035, cr);
  const facEdge = 1 - ss(0.0, 0.06, fac.f2 - fac.f1);
  let t = 0.34 + 0.2 * n + 0.1 * fac.id + 0.08 * fine;
  let c = [t * 1.0, t * 1.02, t * 1.07];
  c = mix3(c, [t * 1.1, t * 0.98, t * 0.85], ss(0.5, 0.8, fbm(u, v, 2, 3, 37)) * 0.5);
  const dark = Math.max(crack * 0.75, facEdge * 0.5);
  c = mix3(c, [0.09, 0.09, 0.1], dark);
  o.c = c; o.h = 0.35 + 0.3 * n + 0.15 * fac.id + 0.1 * fine - 0.35 * dark; o.r = 0.88;
}

function sandAt(u, v, o) {
  const rp = Math.sin((v + 0.09 * fbm(u, v, 3, 3, 41)) * Math.PI * 2 * 5 + 4 * fbm(u, v, 2, 2, 42)) * 0.5 + 0.5;
  const g = h2(Math.floor(u * N), Math.floor(v * N), 43), n = fbm(u, v, 6, 4, 44);
  const t = 0.82 + 0.16 * rp * 0.6 + 0.12 * (n - 0.5) + (g - 0.5) * 0.14;
  let c = [0.90 * t, 0.80 * t, 0.56 * t];
  if (g > 0.965) c = mix3(c, [0.45, 0.36, 0.25], 0.7);
  if (g < 0.02) c = mix3(c, [1, 0.97, 0.85], 0.6);
  o.c = c; o.h = 0.3 + 0.35 * rp + 0.2 * n + 0.1 * g; o.r = 0.92;
}

function barkAt(u, v, o) {
  const warp = fbm(u, v, 3, 3, 51, 2) * 1.6;
  const ph = u * 8 + warp;
  const ridge = Math.abs(Math.sin(Math.PI * ph));
  const seg = fbm(u, v, 8, 2, 52, 5);
  const plate = Math.pow(ridge, 0.6) * (0.75 + 0.25 * ss(0.3, 0.5, seg));
  const fine = fbm(u, v, 24, 3, 53, 6);
  const crack = 1 - ss(0.0, 0.3, ridge);
  let c = mix3([0.10, 0.06, 0.045], [0.36, 0.24, 0.16], plate * (0.6 + 0.6 * fine));
  c = mix3(c, [0.48, 0.40, 0.33], ss(0.72, 1.0, plate * fine * 1.5) * 0.55);
  c = mix3(c, [0.20, 0.22, 0.12], ss(0.62, 0.8, fbm(u, v, 4, 3, 54)) * 0.25);
  c = mix3(c, [0.04, 0.025, 0.02], crack * 0.8);
  o.c = c; o.h = 0.1 + 0.7 * plate + 0.2 * fine; o.r = 0.95;
}

function logTopAt(u, v, o) {
  const x = u - 0.5, y = v - 0.5;
  const w = fbm(u, v, 3, 3, 61) - 0.5;
  const dR = Math.hypot(x, y), dS = Math.max(Math.abs(x), Math.abs(y));
  const d = mix(dR, dS, 0.55) * 2 + w * 0.07;
  const ang = Math.atan2(y, x);
  const rim = 0.86 + 0.04 * Math.sin(ang * 9 + w * 20) + 0.03 * fbm(u, v, 9, 2, 62);
  if (d > rim) {
    barkAt(u, v, o); o.h = 0.75 + 0.25 * o.h;
    const t = ss(rim, rim + 0.05, d); o.c = mix3([0.06, 0.035, 0.025], o.c, t);
    return;
  }
  const rings = Math.sin(d * Math.PI * 2 * 7.5 + w * 6) * 0.5 + 0.5;
  const fine = fbm(u, v, 22, 2, 63);
  let c = mix3([0.80, 0.62, 0.36], [0.60, 0.42, 0.22], rings * 0.8 + 0.2 * fine);
  c = mix3(c, [0.50, 0.32, 0.17], ss(0.0, 0.25, 0.25 - d) * 0.6);
  // radiale Risse
  let ck = 0;
  for (let k = 0; k < 5; k++) {
    const a0 = h2(k, 1, 64) * Math.PI * 2 - Math.PI, len = 0.25 + 0.5 * h2(k, 2, 64);
    let da = Math.abs(ang - a0); if (da > Math.PI) da = Math.PI * 2 - da;
    if (d < len) ck = Math.max(ck, 1 - ss(0, 0.012 + 0.03 * (len - d), da * d));
  }
  c = mix3(c, [0.16, 0.09, 0.05], ck * 0.85);
  c = mix3(c, [0.3, 0.19, 0.1], ss(rim - 0.08, rim, d) * 0.6);
  o.c = c; o.h = 0.5 + 0.08 * rings - 0.3 * ck; o.r = 0.8;
}

function bricksAt(u, v, o) {
  const row = v < 0.5 ? 0 : 1;
  const uu = row === 0 ? u : mod(u + 0.25, 1);
  const bi = Math.floor(uu * 2), lu = uu * 2 - bi, lv = (v - row * 0.5) * 2;
  const ed = Math.min(Math.min(lu, 1 - lu) * 0.5, Math.min(lv, 1 - lv) * 0.5);
  const tone = 0.8 + 0.4 * h2(bi, row, 71);
  const bev = ss(0.012, 0.05, ed);
  const marb = fbm(u, v, 4, 4, 72), fine = fbm(u, v, 18, 3, 73);
  const veinl = 1 - ss(0, 0.03, Math.abs(fbm(u, v, 3, 4, 74) - 0.5));
  let c = [0.125 * tone, 0.135 * tone, 0.20 * tone];
  c = mix3(c, [0.21, 0.23, 0.33], marb * 0.55);
  c = mix3(c, [0.40, 0.31, 0.17], veinl * 0.3);
  c = [c[0] * (0.85 + 0.3 * fine), c[1] * (0.85 + 0.3 * fine), c[2] * (0.85 + 0.3 * fine)];
  const rimHl = ss(0.012, 0.03, ed) * (1 - ss(0.03, 0.07, ed));
  c = [c[0] + 0.08 * rimHl, c[1] + 0.09 * rimHl, c[2] + 0.13 * rimHl];
  c = mix3([0.015, 0.015, 0.022], c, ss(0.004, 0.016, ed));
  o.c = c; o.h = 0.1 + 0.8 * bev + 0.04 * fine; o.r = mix(0.9, 0.28 + 0.2 * fine, bev);
}

function oreAt(u, v, o) {
  const w1 = fbm(u, v, 3, 3, 81), w2 = fbm(u, v, 3, 3, 82);
  const t = (w1 * 5 + 0.6 * Math.sin((u + w2 * 0.4) * Math.PI * 2 * 2));
  const band = Math.abs(Math.sin(t * Math.PI * 2.2));
  const line = 1 - ss(0.0, 0.16, band);
  const fine = fbm(u, v, 16, 3, 83), big = fbm(u, v, 2, 2, 84);
  let c = mix3([0.30, 0.13, 0.09], [0.52, 0.27, 0.17], band * 0.7 + 0.3 * big);
  c = [c[0] * (0.75 + 0.5 * fine), c[1] * (0.75 + 0.5 * fine), c[2] * (0.75 + 0.5 * fine)];
  c = mix3(c, [0.80, 0.63, 0.52], line * 0.75);
  const pit = vor(u, v, 9, 85);
  const pitm = pit.id > 0.7 ? 1 - ss(0.05, 0.22, pit.f1) : 0;
  c = mix3(c, [0.10, 0.04, 0.03], pitm * 0.8);
  const fl = h2(Math.floor(u * N / 2), Math.floor(v * N / 2), 86) > 0.975 ? 1 : 0;
  c = mix3(c, [1.0, 0.78, 0.5], fl * 0.8);
  o.c = c; o.h = 0.35 + 0.3 * band + 0.25 * line + 0.1 * fine - 0.4 * pitm; o.r = mix(0.8, 0.3, Math.max(line * 0.7, fl));
}

function waterAt(u, v, o) {
  const a = fbm(u, v, 4, 4, 91), b = Math.abs(fbm(u, v, 6, 3, 92) - 0.5) * 2;
  o.h = 0.55 * a + 0.45 * (1 - b); o.c = [0.04, 0.22, 0.27]; o.r = 0.05;
}

const GREENS = [[0.06, 0.20, 0.04], [0.11, 0.31, 0.06], [0.17, 0.43, 0.08], [0.26, 0.54, 0.11], [0.39, 0.66, 0.17]];
const greenAt = (t) => { const x = clamp(t) * (GREENS.length - 1), i = Math.min(GREENS.length - 2, Math.floor(x)); return mix3(GREENS[i], GREENS[i + 1], x - i); };

function genGrassTop() {
  const Lr = newLayer(), r = rng(101);
  fill(Lr, (u, v, o) => { const n = fbm(u, v, 6, 4, 102); o.c = mix3([0.05, 0.14, 0.03], [0.10, 0.25, 0.05], n); o.h = 0.1 + 0.15 * n; o.r = 0.9; });
  const cnt = 2600;
  for (let i = 0; i < cnt; i++) {
    const t = i / cnt, x = r() * N, y = r() * N;
    const ang = -Math.PI / 2 + (r() - 0.5) * 2.6, len = (0.05 + 0.09 * r()) * N;
    const patch = fbm(x / N, y / N, 3, 2, 103);
    const tone = clamp(0.15 + 0.6 * t + 0.5 * (patch - 0.5) + 0.25 * (r() - 0.5));
    let c0 = greenAt(tone * 0.6), c1 = greenAt(tone + 0.25);
    if (r() < 0.05) c1 = mix3(c1, [0.75, 0.78, 0.30], 0.6);
    const bend = (r() - 0.5) * len * 0.5;
    stroke(Lr, x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len, -Math.sin(ang) * bend, Math.cos(ang) * bend,
      1.5, 0.45, c0, c1, 0.2 + 0.5 * t, 0.4 + 0.6 * t, { wrapU: true, wrapV: true, op: 0.95, rough: 0.75 });
  }
  return Lr;
}

function genGrassSide() {
  const Lr = newLayer(), r = rng(111);
  fill(Lr, (u, v, o) => { dirtAt(u, v, o); const sh = ss(0.0, 0.5, v); o.c = [o.c[0] * (0.6 + 0.4 * sh), o.c[1] * (0.6 + 0.4 * sh), o.c[2] * (0.6 + 0.4 * sh)]; });
  // dichte Grasnarbe oben
  for (let x = 0; x < N; x++) {
    const d = (0.07 + 0.08 * pn(x / N * 8, 0, 8, 1, 112)) * N;
    for (let y = 0; y < d; y++) {
      const i = y * N + x, t = y / d, g = greenAt(0.5 - 0.35 * t + 0.2 * (h2(x, y, 113) - 0.5));
      Lr.c[i * 3] = g[0]; Lr.c[i * 3 + 1] = g[1]; Lr.c[i * 3 + 2] = g[2]; Lr.h[i] = 0.8; Lr.r[i] = 0.8;
    }
  }
  const cnt = 420;
  for (let i = 0; i < cnt; i++) {
    const t = i / cnt, x = r() * N, y0 = r() * 0.08 * N;
    const len = (0.10 + 0.24 * r() * r()) * N, slant = (r() - 0.5) * len * 0.5;
    const tone = clamp(0.2 + 0.6 * t + 0.3 * (r() - 0.5));
    stroke(Lr, x, y0, x + slant, y0 + len, (r() - 0.5) * 4, 0, 1.6, 0.4, greenAt(tone + 0.15), greenAt(tone * 0.45),
      0.85 + 0.15 * t, 0.6, { wrapU: true, wrapV: false, op: 0.95, rough: 0.78 });
  }
  return Lr;
}

function genLeaves() {
  const Lr = newLayer(), r = rng(121);
  fill(Lr, (u, v, o) => { o.c = [0.04, 0.12, 0.03]; o.h = 0.0; o.r = 0.7; });
  const cnt = 470;
  for (let i = 0; i < cnt; i++) {
    const t = i / cnt, x = r() * N, y = r() * N, ang = r() * Math.PI * 2, len = (0.045 + 0.05 * r()) * N;
    const tone = clamp(0.05 + 0.75 * t * t + 0.3 * (r() - 0.5));
    const c0 = greenAt(tone * 0.45), c1 = greenAt(tone * 0.8 + 0.08);
    const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
    // Blattform: dick in der Mitte, spitz an den Enden
    const steps = Math.ceil(len * 2);
    for (let k = 0; k <= steps; k++) {
      const s = k / steps, wdt = 0.5 + 3.4 * Math.sin(Math.PI * s) * (0.8 + 0.2 * t);
      stamp(Lr, x + dx * s, y + dy * s, wdt, mix3(c0, c1, s), 0.25 + 0.75 * t - 0.15 * Math.abs(s - 0.5), { wrapU: true, wrapV: true, alpha: true, rough: 0.55 });
    }
    // Mittelrippe
    stroke(Lr, x + dx * 0.1, y + dy * 0.1, x + dx * 0.9, y + dy * 0.9, 0, 0, 0.5, 0.3, greenAt(tone + 0.2), greenAt(tone + 0.2), 0.3 + 0.7 * t, 0.3 + 0.7 * t, { wrapU: true, wrapV: true, op: 0.5 });
  }
  return Lr;
}

function tuftBase() { const Lr = newLayer(); fill(Lr, (u, v, o) => { o.c = [0.12, 0.30, 0.06]; o.h = 0.5; o.r = 0.8; }); return Lr; }
function blade(Lr, r, x0, len, lean, w, tone, o = {}) {
  const c0 = o.c0 ?? greenAt(tone * 0.5), c1 = o.c1 ?? greenAt(tone + 0.3);
  stroke(Lr, x0 * N, N + 1, (x0 + lean) * N, (1 - len) * N, lean * N * 0.35 * (r() - 0.2), -len * N * 0.12, w, 0.5, c0, c1, 0.5, 0.5, { alpha: true });
}
function genTuft(seed, tall) {
  const Lr = tuftBase(), r = rng(seed), cnt = tall ? 46 : 60;
  for (let i = 0; i < cnt; i++) {
    const x0 = 0.5 + (r() - 0.5) * (tall ? 0.62 : 0.8), edge = 1 - Math.abs(x0 - 0.5) * 1.2;
    const len = tall ? (0.45 + 0.52 * r()) * (0.7 + 0.3 * edge) : (0.25 + 0.7 * r()) * edge;
    const tone = clamp(0.12 + 0.5 * (i / cnt) + 0.3 * (r() - 0.5));
    let c1 = greenAt(tone + 0.22);
    if (r() < 0.12) c1 = mix3(c1, [0.62, 0.66, 0.24], 0.5);
    blade(Lr, r, x0, len, (x0 - 0.5) * 0.5 + (r() - 0.5) * 0.34, tall ? 1.7 : 1.9, tone, { c0: greenAt(tone * 0.35), c1 });
  }
  if (tall) for (let i = 0; i < 6; i++) { // Ähren
    const x = 0.22 + 0.56 * r(), y = 0.05 + 0.2 * r();
    stroke(Lr, x * N, (y + 0.3) * N, x * N + (r() - 0.5) * 6, y * N, 0, 0, 0.8, 0.6, greenAt(0.5), [0.58, 0.62, 0.26], 0.5, 0.5, { alpha: true });
    stroke(Lr, x * N, (y + 0.09) * N, x * N, y * N, 0, 0, 1.7, 0.8, [0.56, 0.58, 0.24], [0.74, 0.72, 0.38], 0.5, 0.5, { alpha: true });
  }
  return Lr;
}
function flowerHead(Lr, r, x, y, rad, pet, mid, petals = 5) {
  for (let k = 0; k < petals; k++) {
    const a = k / petals * Math.PI * 2 + r(), px = x + Math.cos(a) * rad * 0.75, py = y + Math.sin(a) * rad * 0.75;
    stamp(Lr, px, py, rad * 0.62, mix3(pet, [1, 1, 1], 0.25 * r()), 0.5, { alpha: true });
  }
  for (let k = 0; k < petals; k++) {
    const a = k / petals * Math.PI * 2, px = x + Math.cos(a) * rad * 0.4, py = y + Math.sin(a) * rad * 0.4;
    stamp(Lr, px, py, rad * 0.3, [pet[0] * 0.75, pet[1] * 0.7, pet[2] * 0.75], 0.5, { alpha: true, op: 0.7 });
  }
  stamp(Lr, x, y, rad * 0.36, mid, 0.5, { alpha: true });
}
function genFlower(seed, pet, mid, heads = 3) {
  const Lr = tuftBase(), r = rng(seed);
  for (let i = 0; i < 9; i++) blade(Lr, r, 0.5 + (r() - 0.5) * 0.5, 0.2 + 0.3 * r(), (r() - 0.5) * 0.3, 3.0, 0.3 + 0.4 * r());
  for (let i = 0; i < heads; i++) {
    const x0 = 0.5 + (i - (heads - 1) / 2) * 0.16 + (r() - 0.5) * 0.06, top = 0.14 + 0.3 * r() * (i === 1 ? 0.3 : 1), lean = (i - (heads - 1) / 2) * 0.12 + (r() - 0.5) * 0.08;
    stroke(Lr, x0 * N, N + 1, (x0 + lean) * N, top * N, lean * 6, 0, 1.5, 1.1, greenAt(0.25), greenAt(0.6), 0.5, 0.5, { alpha: true });
    // Blätter am Stiel
    const ly = mix(1, top, 0.45) * N, lx = (x0 + lean * 0.5) * N;
    stroke(Lr, lx, ly, lx + (r() < 0.5 ? -1 : 1) * 0.1 * N, ly - 0.06 * N, 0, 2, 2.2, 0.5, greenAt(0.35), greenAt(0.7), 0.5, 0.5, { alpha: true });
    flowerHead(Lr, r, (x0 + lean) * N, top * N, 0.085 * N, pet, mid);
  }
  return Lr;
}
function genSpike(seed) { // hohe, rosa Rispenblume
  const Lr = tuftBase(), r = rng(seed);
  for (let i = 0; i < 10; i++) blade(Lr, r, 0.5 + (r() - 0.5) * 0.5, 0.15 + 0.25 * r(), (r() - 0.5) * 0.4, 3.2, 0.3 + 0.4 * r());
  for (let s = 0; s < 3; s++) {
    const x0 = 0.3 + s * 0.2 + (r() - 0.5) * 0.05, top = 0.05 + 0.12 * r() + (s === 1 ? 0 : 0.12), lean = (s - 1) * 0.06;
    stroke(Lr, x0 * N, N + 1, (x0 + lean) * N, top * N, 0, 0, 1.4, 0.9, greenAt(0.25), greenAt(0.55), 0.5, 0.5, { alpha: true });
    const n = 26;
    for (let k = 0; k < n; k++) {
      const t = k / n, y = mix(top, top + 0.42, t) * N, wdt = (0.012 + 0.045 * Math.sin(Math.PI * Math.min(1, t * 0.85 + 0.15))) * N;
      const x = (x0 + lean * (1 - t * 0.42)) * N + (r() - 0.5) * 2 * wdt;
      const cc = mix3([0.98, 0.62, 0.86], [0.72, 0.30, 0.74], t + 0.3 * (r() - 0.5));
      stamp(Lr, x, y, 2.0 + 1.2 * r(), cc, 0.5, { alpha: true });
    }
  }
  return Lr;
}
function genReed(seed) {
  const Lr = tuftBase(), r = rng(seed);
  for (let i = 0; i < 9; i++) {
    const x0 = 0.5 + (r() - 0.5) * 0.5, lean = (r() - 0.5) * 0.22, len = 0.6 + 0.38 * r();
    blade(Lr, r, x0, len, lean, 2.6, 0, { c0: [0.16, 0.26, 0.07], c1: [0.42, 0.52, 0.16] });
  }
  for (let i = 0; i < 3; i++) {
    const x0 = 0.3 + 0.2 * i + (r() - 0.5) * 0.06, top = 0.06 + 0.14 * r();
    stroke(Lr, x0 * N, N + 1, x0 * N, top * N, 0, 0, 1.3, 0.8, [0.2, 0.3, 0.08], [0.45, 0.5, 0.2], 0.5, 0.5, { alpha: true });
    stroke(Lr, x0 * N, (top + 0.2) * N, x0 * N, (top + 0.05) * N, 0, 0, 3.4, 3.0, [0.25, 0.13, 0.06], [0.40, 0.23, 0.11], 0.5, 0.5, { alpha: true });
  }
  return Lr;
}

function planksAt(u, v, o, tint = 1) {
  const row = Math.floor(v * 4), lv = v * 4 - row;
  const off = h2(row, 5, 401) * 0.7, uu = mod(u + off, 1);
  const grain = fbm(uu, v, 3, 4, 402 + row, 40), fine = fbm(u, v, 30, 2, 403, 60);
  const gap = Math.min(lv, 1 - lv), seam = Math.abs(uu - 0.5) < 0.006 ? 1 : 0;
  const t = 0.75 + 0.35 * grain + 0.12 * fine + 0.1 * (h2(row, 9, 404) - 0.5);
  let c = [0.66 * t * tint, 0.47 * t * tint, 0.26 * t * tint];
  const dark = Math.max(1 - ss(0.0, 0.07, gap), seam);
  c = mix3(c, [0.16, 0.10, 0.05], dark * 0.85);
  const nx = Math.abs(uu - 0.5) - 0.44, nd = Math.hypot(nx * 4, lv - 0.5);
  if (nd < 0.09) c = mix3(c, [0.2, 0.2, 0.22], 0.8);
  o.c = c; o.h = 0.55 + 0.15 * grain - 0.4 * dark; o.r = 0.8;
}
function benchTopAt(u, v, o) {
  planksAt(u, v, o, 0.92);
  const e = Math.min(u, 1 - u, v, 1 - v), frame = 1 - ss(0.08, 0.1, e);
  const grid = Math.min(Math.abs(u - 0.5), Math.abs(v - 0.5)) < 0.012 ? 1 : 0;
  o.c = mix3(o.c, [0.30, 0.19, 0.10], frame * 0.75); o.c = mix3(o.c, [0.14, 0.09, 0.05], grid * 0.8 * (1 - frame));
  o.h = o.h + 0.2 * frame - 0.15 * grid;
}
function benchSideAt(u, v, o) {
  planksAt(u, v, o, 0.85);
  const e = Math.min(u, 1 - u, v, 1 - v), frame = 1 - ss(0.09, 0.11, e);
  o.c = mix3(o.c, [0.32, 0.20, 0.10], frame * 0.8); o.h += 0.22 * frame;
  // Werkzeug-Silhouetten
  const saw = Math.abs(v - 0.42) < 0.035 && u > 0.2 && u < 0.62, han = Math.abs(u - 0.74) < 0.03 && v > 0.25 && v < 0.75, head = Math.abs(v - 0.3) < 0.06 && Math.abs(u - 0.74) < 0.1;
  if (saw || head) { o.c = [0.55, 0.57, 0.62]; o.r = 0.35; o.h += 0.1; } else if (han) { o.c = [0.3, 0.19, 0.1]; o.h += 0.1; }
}
function furnaceFrontAt(u, v, o) {
  stoneAt(u, v, o); o.c = [o.c[0] * 0.72, o.c[1] * 0.72, o.c[2] * 0.75];
  const e = Math.min(u, 1 - u, v, 1 - v);
  o.c = mix3(o.c, [0.12, 0.12, 0.13], (1 - ss(0.03, 0.06, e)) * 0.7);
  const ax = Math.abs(u - 0.5), arch = v > 0.5 ? ax < 0.27 && v < 0.86 : Math.hypot(ax, v - 0.5) < 0.27;
  if (arch) {
    const glow = ss(0.55, 0.86, v);
    o.c = mix3([0.03, 0.025, 0.025], [0.9, 0.38, 0.08], glow * (0.6 + 0.4 * fbm(u, v, 8, 2, 411)));
    o.a = glow * 0.5; o.h = 0.05; o.r = 0.9;
    if (Math.abs(mod(u * 9, 1) - 0.5) < 0.16 && v > 0.56) { o.c = [0.08, 0.08, 0.09]; o.a = 0; o.h = 0.3; }
  }
  const slot = Math.abs(v - 0.18) < 0.035 && ax < 0.24;
  if (slot) { o.c = [0.04, 0.04, 0.05]; o.h = 0.1; }
}
function furnaceTopAt(u, v, o) {
  stoneAt(u, v, o); o.c = [o.c[0] * 0.7, o.c[1] * 0.7, o.c[2] * 0.73];
  const e = Math.min(u, 1 - u, v, 1 - v), rim = 1 - ss(0.1, 0.13, e);
  o.c = mix3(o.c, [0.14, 0.14, 0.15], rim * 0.6); o.h += 0.2 * rim;
}
function speckAt(u, v, o, c0, c1, seed, rough) {
  stoneAt(u, v, o);
  const p = vor(u, v, 6, seed, 1.0), rad = 0.2 + 0.16 * h2(Math.floor(p.id * 1e6), 3, seed + 1);
  if (p.id > 0.45 && p.f1 < rad) {
    const t = 1 - p.f1 / rad, lit = clamp(0.5 + (-p.dx * 0.7 - p.dy * 0.9) / rad * 0.5), e = ss(0, 0.3, t);
    const facet = Math.floor(lit * 3.99) / 3;
    o.c = mix3(mix3(o.c, [0.06, 0.06, 0.07], 0.5), mix3(c0, c1, facet), e);
    o.h = mix(o.h, 0.5 + 0.35 * t, e); o.r = mix(o.r, rough, e);
  }
}
function bedTopAt(u, v, o) {
  const cloth = fbm(u, v, 40, 2, 421) * 0.5 + fbm(u, v, 4, 3, 422) * 0.5;
  const pillow = v < 0.3, e = Math.min(u, 1 - u, v, 1 - v);
  let c = pillow ? [0.86, 0.86, 0.80] : [0.62, 0.13, 0.12];
  const fold = pillow ? ss(0.0, 0.08, Math.min(u - 0.08, 0.92 - u, v - 0.05, 0.27 - v)) : 1;
  const stripe = !pillow && Math.abs(v - 0.4) < 0.025 ? 1 : 0;
  c = mix3(c, [0.9, 0.82, 0.6], stripe * 0.8);
  const t = 0.8 + 0.4 * cloth;
  o.c = [c[0] * t * (0.75 + 0.25 * fold), c[1] * t * (0.75 + 0.25 * fold), c[2] * t * (0.75 + 0.25 * fold)];
  o.c = mix3(o.c, [0.25, 0.15, 0.08], (1 - ss(0.02, 0.04, e)) * 0.9);
  o.h = 0.4 + 0.3 * cloth + (pillow ? 0.25 * fold : 0); o.r = 0.95;
}
function bedSideAt(u, v, o) {
  if (v > 0.6) { planksAt(u, v, o, 0.8); return; }
  const cloth = fbm(u, v, 40, 2, 423) * 0.5 + fbm(u, v, 4, 3, 424) * 0.5, t = 0.8 + 0.4 * cloth;
  const c = u < 0.3 ? [0.86, 0.86, 0.80] : [0.62, 0.13, 0.12];
  const sh = 0.7 + 0.3 * ss(0.6, 0.3, v);
  o.c = [c[0] * t * sh, c[1] * t * sh, c[2] * t * sh]; o.h = 0.5 + 0.3 * cloth; o.r = 0.95;
}

const VEINS = {
  gold: { col: [0.92, 0.58, 0.10], hot: [1.0, 0.86, 0.42], em: 0.3, rough: 0.2, w: 0.1, sel: 0.26, seed: 201 },
  violet: { col: [0.50, 0.12, 0.92], hot: [0.86, 0.55, 1.0], em: 1.0, rough: 0.35, w: 0.085, sel: 0.30, seed: 202 },
  teal: { col: [0.06, 0.80, 0.74], hot: [0.62, 1.0, 0.95], em: 1.0, rough: 0.35, w: 0.075, sel: 0.36, seed: 203 },
};
const fromFn = (fn) => { const Lr = newLayer(); fill(Lr, fn); return Lr; };
const GEN = {
  grass_top: () => [genGrassTop(), { ns: 2.2, bake: 0.5 }],
  grass_side: () => [genGrassSide(), { ns: 2.2, bake: 0.5, wrapV: false }],
  dirt: () => [fromFn(dirtAt), { ns: 2.6, bake: 0.6 }],
  stone: () => [fromFn(stoneAt), { ns: 2.6, bake: 0.6 }],
  sand: () => [fromFn(sandAt), { ns: 1.2, bake: 0.35 }],
  log_side: () => [fromFn(barkAt), { ns: 3.4, bake: 0.7 }],
  log_top: () => [fromFn(logTopAt), { ns: 2.4, bake: 0.5 }],
  leaves: () => [genLeaves(), { ns: 2.0, bake: 0.5, cutout: true }],
  water: () => [fromFn(waterAt), { ns: 2.2, bake: 0 }],
  basalt: () => [fromFn((u, v, o) => basaltAt(u, v, o, null)), { ns: 3.2, bake: 0.7 }],
  basalt_gold: () => [fromFn((u, v, o) => basaltAt(u, v, o, VEINS.gold)), { ns: 3.2, bake: 0.7 }],
  basalt_violet: () => [fromFn((u, v, o) => basaltAt(u, v, o, VEINS.violet)), { ns: 3.2, bake: 0.7 }],
  basalt_teal: () => [fromFn((u, v, o) => basaltAt(u, v, o, VEINS.teal)), { ns: 3.2, bake: 0.7 }],
  bricks: () => [fromFn(bricksAt), { ns: 3.0, bake: 0.5 }],
  ore: () => [fromFn(oreAt), { ns: 2.6, bake: 0.6 }],
  tuft_grass: () => [genTuft(301, false), { flat: true, cutout: true }],
  tuft_tall: () => [genTuft(302, true), { flat: true, cutout: true }],
  flower_red: () => [genFlower(303, [0.92, 0.12, 0.08], [0.15, 0.08, 0.02]), { flat: true, cutout: true }],
  flower_white: () => [genFlower(304, [0.97, 0.97, 0.92], [0.98, 0.78, 0.12]), { flat: true, cutout: true }],
  flower_yellow: () => [genFlower(305, [1.0, 0.72, 0.08], [0.85, 0.35, 0.05]), { flat: true, cutout: true }],
  flower_pink: () => [genSpike(306), { flat: true, cutout: true }],
  reed: () => [genReed(307), { flat: true, cutout: true }],
  planks: () => [fromFn((u, v, o) => planksAt(u, v, o)), { ns: 2.2, bake: 0.5 }],
  workbench_top: () => [fromFn(benchTopAt), { ns: 2.2, bake: 0.5 }],
  workbench_side: () => [fromFn(benchSideAt), { ns: 2.2, bake: 0.5 }],
  furnace_front: () => [fromFn(furnaceFrontAt), { ns: 2.6, bake: 0.6 }],
  furnace_top: () => [fromFn(furnaceTopAt), { ns: 2.6, bake: 0.6 }],
  coal_ore: () => [fromFn((u, v, o) => speckAt(u, v, o, [0.05, 0.05, 0.06], [0.22, 0.22, 0.25], 431, 0.55)), { ns: 2.6, bake: 0.6 }],
  diamond_ore: () => [fromFn((u, v, o) => speckAt(u, v, o, [0.15, 0.62, 0.72], [0.75, 0.98, 1.0], 441, 0.12)), { ns: 2.6, bake: 0.6 }],
  bed_top: () => [fromFn(bedTopAt), { ns: 1.6, bake: 0.4 }],
  bed_side: () => [fromFn(bedSideAt), { ns: 1.6, bake: 0.4 }],
};

// ---------- Nachbearbeitung: Normal-Map, gebackenes Streiflicht, Downsampling ----------
function downsample(Lr, n) { // n -> n/2
  const m = n / 2, o = { c: new Float32Array(m * m * 3), h: new Float32Array(m * m), r: new Float32Array(m * m), a: new Float32Array(m * m) };
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
    const i = y * m + x, js = [2 * y * n + 2 * x, 2 * y * n + 2 * x + 1, (2 * y + 1) * n + 2 * x, (2 * y + 1) * n + 2 * x + 1];
    for (const j of js) { o.c[i * 3] += Lr.c[j * 3] / 4; o.c[i * 3 + 1] += Lr.c[j * 3 + 1] / 4; o.c[i * 3 + 2] += Lr.c[j * 3 + 2] / 4; o.h[i] += Lr.h[j] / 4; o.r[i] += Lr.r[j] / 4; o.a[i] += Lr.a[j] / 4; }
  }
  return o;
}
function encode(Lr, n, opt, alb, nrm, off) {
  const wrapV = opt.wrapV !== false;
  const H = (x, y) => Lr.h[(wrapV ? mod(y, n) : clamp(y, 0, n - 1)) * n + mod(x, n)];
  const ns = (opt.ns ?? 0) * (n / 64);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, o = off + i * 4;
    let nx = 0, ny = 0;
    if (!opt.flat) {
      nx = -(H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x - 1, y) - H(x - 1, y + 1)) * ns * 0.25;
      ny = -(H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x, y - 1) - H(x + 1, y - 1)) * ns * 0.25;
    }
    const il = 1 / Math.hypot(nx, ny, 1);
    nx *= il; ny *= il;
    // leichtes gebackenes Licht von oben links + Vertiefungen abdunkeln -> gemalter Look
    const bake = opt.bake ?? 0;
    const lit = 1 + bake * (0.35 * (-nx * 0.6 - ny * 0.8) + 0.25 * (Lr.h[i] - 0.5));
    for (let k = 0; k < 3; k++) alb[o + k] = Math.round(255 * clamp(Lr.c[i * 3 + k] * lit));
    alb[o + 3] = Math.round(255 * clamp(Lr.a[i]));
    nrm[o] = Math.round(255 * clamp(nx * 0.5 + 0.5)); nrm[o + 1] = Math.round(255 * clamp(ny * 0.5 + 0.5));
    nrm[o + 2] = Math.round(255 * clamp(Lr.r[i])); nrm[o + 3] = Math.round(255 * clamp(Lr.h[i]));
  }
}

function crc32(buf) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const t0 = Date.now();
const count = LAYERS.length;
const out = { 128: { alb: new Uint8Array(count * 128 * 128 * 4), nrm: new Uint8Array(count * 128 * 128 * 4) }, 64: { alb: new Uint8Array(count * 64 * 64 * 4), nrm: new Uint8Array(count * 64 * 64 * 4) } };
const cutouts = [];
LAYERS.forEach((name, li) => {
  const [Lr, opt] = GEN[name]();
  cutouts[li] = !!opt.cutout;
  encode(Lr, 128, opt, out[128].alb, out[128].nrm, li * 128 * 128 * 4);
  encode(downsample(Lr, 128), 64, opt, out[64].alb, out[64].nrm, li * 64 * 64 * 4);
});
fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
for (const n of [64, 128]) fs.writeFileSync(path.join(root, 'assets', `tex${n}.bin`), Buffer.concat([out[n].alb, out[n].nrm]));
console.log(`Texturen erzeugt: ${count} Layer, 64px + 128px in ${Date.now() - t0} ms`);

// App-Icons (PWA): isometrischer Grasblock, direkt gerastert
for (const size of [192, 512]) {
  const img = new Uint8Array(size * size * 4), k = (p) => [((p[0] - 54) * 1.55 + 54) / 108 * size, ((p[1] - 55) * 1.55 + 54) / 108 * size];
  const polys = [
    [[0x6f, 0xcb, 0x3a], [[54, 28], [78, 41], [54, 54], [30, 41]]], [[0x7a, 0x4a, 0x26], [[30, 41], [54, 54], [54, 82], [30, 69]]], [[0x5a, 0x34, 0x18], [[78, 41], [54, 54], [54, 82], [78, 69]]],
    [[0x4f, 0xa5, 0x2a], [[30, 41], [54, 54], [54, 61], [48, 56], [42, 57], [36, 51], [30, 50]]], [[0x3c, 0x8a, 0x20], [[78, 41], [54, 54], [54, 61], [60, 57], [66, 56], [72, 51], [78, 49]]],
  ].map(([c, pts]) => [c, pts.map(k)]);
  const inside = (pts, x, y) => { let r = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if ((pts[i][1] > y) !== (pts[j][1] > y) && x < (pts[j][0] - pts[i][0]) * (y - pts[i][1]) / (pts[j][1] - pts[i][1]) + pts[i][0]) r = !r; return r; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let c = [0x0d, 0x11, 0x17];
    for (const [pc, pts] of polys) if (inside(pts, x + 0.5, y + 0.5)) c = pc;
    img.set([c[0], c[1], c[2], 255], (y * size + x) * 4);
  }
  fs.writeFileSync(path.join(root, 'assets', `icon-${size}.png`), png(size, size, img));
}

const pv = process.argv.indexOf('--preview');
if (pv > 0) { // Kontaktbogen zur Kontrolle: oben Albedo, unten Normal
  const cols = 8, rows = Math.ceil(count / cols), W = cols * 128, Hh = rows * 128 * 2, img = new Uint8Array(W * Hh * 4);
  for (let li = 0; li < count; li++) for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const s = (li * 128 * 128 + y * 128 + x) * 4, cx = (li % cols) * 128 + x, cy = Math.floor(li / cols) * 128 + y;
    const d = (cy * W + cx) * 4, d2 = ((cy + rows * 128) * W + cx) * 4, a = out[128].alb;
    const cut = cutouts[li] && a[s + 3] < 100;
    img[d] = cut ? 40 : a[s]; img[d + 1] = cut ? 40 : a[s + 1]; img[d + 2] = cut ? 40 : a[s + 2]; img[d + 3] = 255;
    img[d2] = out[128].nrm[s]; img[d2 + 1] = out[128].nrm[s + 1]; img[d2 + 2] = 255; img[d2 + 3] = 255;
  }
  fs.writeFileSync(process.argv[pv + 1], png(W, Hh, img));
}
