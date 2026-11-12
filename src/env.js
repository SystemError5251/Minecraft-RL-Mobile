// Tageszeit -> Sonnenstand, Lichtfarben, Himmel, Nebel.
import { SEA } from './worldgen.js';
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export function sunDirAt(time) {
  const a = (time - 6) / 24 * Math.PI * 2, v = [Math.cos(a), Math.sin(a), 0.28], l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
export function computeEnv(time, viewDist, o = {}) {
  const sun = o.sunDir || sunDirAt(time), e = sun[1];
  const day = ss(-0.1, 0.1, e), high = ss(0.02, 0.55, e), up = ss(-0.04, 0.07, e);
  const sunCol = scale(mix3([1.0, 0.40, 0.13], [1.0, 0.95, 0.86], high), 1.2 * up);
  const moon = scale([0.3, 0.42, 0.7], 0.09 * (1 - up));
  const useSun = up > 0.02;
  const zenith = mix3([0.004, 0.008, 0.022], mix3([0.05, 0.09, 0.24], [0.018, 0.085, 0.42], high), day);
  const horizon = mix3([0.012, 0.02, 0.045], mix3([0.62, 0.34, 0.17], [0.30, 0.48, 0.80], high), day);
  const fogMul = o.fog ?? 1;
  const ar = [zenith[0] * 0.5 + horizon[0] * 0.5, zenith[1] * 0.5 + horizon[1] * 0.5, zenith[2] * 0.5 + horizon[2] * 0.5], al = (ar[0] + ar[1] + ar[2]) / 3;
  const amb = scale(mix3(ar, [al, al, al], 0.4), 0.95);
  const density = mix(0.006, mix(0.011, 0.0032, high), day) * fogMul;
  const env = {
    sunDir: sun,
    lightDir: useSun ? sun : [-sun[0], -sun[1], -sun[2]],
    lightColor: useSun ? sunCol : moon,
    zenith, horizon,
    glow: scale(mix3([1.0, 0.5, 0.2], [1.0, 0.9, 0.75], high), mix(1.1, 0.4, high) * up),
    ambSky: amb,
    ambGround: [horizon[0] * 0.25 + 0.06 * day, horizon[1] * 0.25 + 0.055 * day, horizon[2] * 0.25 + 0.04 * day],
    fog: [density, 0.055, SEA, viewDist],
    skyOverride: [0, 0, 0, 0],
    exposure: mix(3.0, mix(1.25, 1.0, high), day),
    sunDisc: scale(sunCol, 30),
    night: 1 - day,
    rayStrength: up * mix(1.0, 0.6, high),
    rayColor: scale(sunCol, mix(0.9, 0.35, high)),
    water: [0.035, 0.13, 0.13],
  };
  if (o.showcase) {
    env.skyOverride = [0.011, 0.012, 0.015, 1];
    env.fog = [0, 0.05, SEA, 1e6];
    env.ambSky = [0.20, 0.23, 0.29]; env.ambGround = [0.08, 0.07, 0.06];
    env.lightColor = [1.25, 1.2, 1.1]; env.rayStrength = 0; env.exposure = 1.0;
  }
  return env;
}
