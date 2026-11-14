// Minimaler QR-Code-Erzeuger (Byte-Modus, Fehlerkorrektur L, Versionen 1–6, Maske 0) für den Raumcode-Link.
const SPEC = [null, [19, 7, 1], [34, 10, 1], [55, 15, 1], [80, 20, 1], [108, 26, 1], [68, 18, 2]]; // Datenwörter je Block, EC-Wörter, Blöcke
const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; };
function rsDivisor(deg) { const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1; for (let i = 0; i < deg; i++) { for (let j = 0; j < deg; j++) { r[j] = mul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; } root = mul(root, 2); } return r; }
function rsRemainder(data, div) { const r = div.map(() => 0); for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mul(c, f); }); } return r; }
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let v = 1; while (v <= 6 && bytes.length > SPEC[v][0] * SPEC[v][2] - 2) v++;
  if (v > 6) return null; // zu lang
  const [dpb, ec, nb] = SPEC[v], total = dpb * nb, bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, 8); bytes.forEach((b) => put(b, 8)); put(0, Math.min(4, total * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let p = 0xec; data.length < total; p ^= 0xec ^ 0x11) data.push(p);
  const div = rsDivisor(ec), blocks = [], ecs = [];
  for (let b = 0; b < nb; b++) { const d = data.slice(b * dpb, (b + 1) * dpb); blocks.push(d); ecs.push(rsRemainder(d, div)); }
  const cw = []; for (let i = 0; i < dpb; i++) for (const b of blocks) cw.push(b[i]); for (let i = 0; i < ec; i++) for (const e of ecs) cw.push(e[i]);
  const n = 17 + 4 * v, m = Array.from({ length: n }, () => new Array(n).fill(false)), fn = Array.from({ length: n }, () => new Array(n).fill(false));
  const set = (x, y, on) => { if (x >= 0 && x < n && y >= 0 && y < n) { m[y][x] = on; fn[y][x] = true; } };
  for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(cx + dx, cy + dy, d !== 2 && d !== 4); }
  if (v >= 2) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(n - 7 + dx, n - 7 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  // Formatbits: Fehlerkorrektur L (01), Maske 0
  const fd = 1 << 3; let rem = fd; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const fb = ((fd << 10) | rem) ^ 0x5412, bit = (i) => ((fb >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(i));
  set(8, n - 8, true);
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? n - 1 - vert : vert;
      if (fn[y][x]) continue;
      const on = i < cw.length * 8 && ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++;
      m[y][x] = on !== ((x + y) % 2 === 0);
    }
  }
  return m;
}
export function drawQR(canvas, text, scale = 5) {
  const m = qrMatrix(text); if (!m) return false;
  const n = m.length, q = 4; canvas.width = canvas.height = (n + q * 2) * scale;
  const g = canvas.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height); g.fillStyle = '#000';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) g.fillRect((x + q) * scale, (y + q) * scale, scale, scale);
  return true;
}
