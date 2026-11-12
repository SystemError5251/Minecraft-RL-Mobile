// Deterministisches Hash-/Value-Noise (für Weltgenerator und Mesher).
export function hash2(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function hash3(x, y, z, s) { return hash2(x + Math.imul(z, 7919), y + Math.imul(z, 104729), s); }
export function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
export function fbm(x, y, s, oct) {
  let a = 0.5, sum = 0, n = 0;
  for (let i = 0; i < oct; i++) { sum += a * vnoise(x, y, s + i * 17); n += a; a *= 0.5; x *= 2; y *= 2; }
  return sum / n;
}
export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
