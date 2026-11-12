// Minimale 4x4-Matrix-Bibliothek (spaltenweise, wie WebGL).
export const mat4 = () => new Float32Array(16);
export function perspective(o, fovy, aspect, n, f) {
  const t = 1 / Math.tan(fovy / 2); o.fill(0);
  o[0] = t / aspect; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o;
}
export function ortho(o, l, r, b, t, n, f) {
  o.fill(0); o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
  o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1; return o;
}
export function lookAt(o, e, c, up) {
  let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2], l = 1 / Math.hypot(zx, zy, zz); zx *= l; zy *= l; zz *= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx; l = 1 / Math.hypot(xx, xy, xz); xx *= l; xy *= l; xz *= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0; o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0; o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
  o[12] = -(xx * e[0] + xy * e[1] + xz * e[2]); o[13] = -(yx * e[0] + yy * e[1] + yz * e[2]); o[14] = -(zx * e[0] + zy * e[1] + zz * e[2]); o[15] = 1; return o;
}
export function mul(o, a, b) {
  const r = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let w = 0; w < 4; w++) r[c * 4 + w] = a[w] * b[c * 4] + a[4 + w] * b[c * 4 + 1] + a[8 + w] * b[c * 4 + 2] + a[12 + w] * b[c * 4 + 3];
  o.set(r); return o;
}
export function invert(o, m) {
  const a = m, b = new Float32Array(16);
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7], a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06; det = 1 / det;
  b[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; b[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det; b[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; b[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  b[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; b[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det; b[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; b[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  b[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; b[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det; b[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; b[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  b[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; b[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det; b[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; b[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  o.set(b); return o;
}
export function transform(m, x, y, z, w = 1) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w, m[3] * x + m[7] * y + m[11] * z + m[15] * w];
}
