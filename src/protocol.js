// Binärprotokoll zwischen Client und Server. Identisch für postMessage, WebSocket und WebRTC-DataChannel.
// Jede Nachricht: 1 Byte Typ, danach typabhängige Felder (Little Endian).
export const C = { HELLO: 1, MOVE: 2, FALL: 3, BREAK_START: 4, BREAK_STOP: 5, BREAK_DONE: 6, USE: 7, ATTACK: 8, SLOT: 9, OPEN_INV: 10, CLOSE_INV: 11, INV_CLICK: 12, PALETTE: 13, CHAT: 14, TAB: 15, RESPAWN: 16, VIEW: 17, PING: 18 };
export const S = { WELCOME: 64, CHUNK: 65, BLOCKS: 66, TIME: 67, STATE: 68, INV: 69, ENTS: 70, ENT_REMOVE: 71, PLAYER_INFO: 72, CHAT: 73, TAB: 74, TELEPORT: 75, VELOCITY: 76, OPEN: 77, KICK: 78, PONG: 79, FLASH: 80 };
export const PROTOCOL_VERSION = 1;
const te = new TextEncoder(), td = new TextDecoder();

export class Writer {
  constructor(type, cap = 64) { this.a = new Uint8Array(cap); this.dv = new DataView(this.a.buffer); this.n = 0; this.u8(type); }
  need(k) { if (this.n + k <= this.a.length) return; const b = new Uint8Array(Math.max(this.a.length * 2, this.n + k)); b.set(this.a); this.a = b; this.dv = new DataView(b.buffer); }
  u8(v) { this.need(1); this.a[this.n++] = v; return this; }
  u16(v) { this.need(2); this.dv.setUint16(this.n, v, true); this.n += 2; return this; }
  i32(v) { this.need(4); this.dv.setInt32(this.n, v, true); this.n += 4; return this; }
  u32(v) { this.need(4); this.dv.setUint32(this.n, v, true); this.n += 4; return this; }
  f32(v) { this.need(4); this.dv.setFloat32(this.n, v, true); this.n += 4; return this; }
  str(s) { const b = te.encode(s); this.u16(b.length); this.need(b.length); this.a.set(b, this.n); this.n += b.length; return this; }
  bytes(b) { this.u32(b.length); this.need(b.length); this.a.set(b, this.n); this.n += b.length; return this; }
  slot(s) { if (!s) return this.u16(0); return this.u16(s.id).u8(s.n).u16(s.d || 0); }
  end() { return this.a.buffer.slice(0, this.n); }
}
export class Reader {
  constructor(buf) { this.a = buf instanceof Uint8Array ? buf : new Uint8Array(buf); this.dv = new DataView(this.a.buffer, this.a.byteOffset, this.a.byteLength); this.n = 0; }
  u8() { return this.a[this.n++]; }
  u16() { const v = this.dv.getUint16(this.n, true); this.n += 2; return v; }
  i32() { const v = this.dv.getInt32(this.n, true); this.n += 4; return v; }
  u32() { const v = this.dv.getUint32(this.n, true); this.n += 4; return v; }
  f32() { const v = this.dv.getFloat32(this.n, true); this.n += 4; return v; }
  str() { const l = this.u16(), s = td.decode(this.a.subarray(this.n, this.n + l)); this.n += l; return s; }
  bytes() { const l = this.u32(), b = this.a.subarray(this.n, this.n + l); this.n += l; return b; }
  slot() { const id = this.u16(); if (!id) return null; const n = this.u8(), d = this.u16(); return d ? { id, n, d } : { id, n }; }
  get more() { return this.n < this.a.length; }
}
// Lauflängen-Kompression für Chunk-Blockdaten: [Wert, Länge als Varint] …
export function rleEncode(src) {
  const out = new Uint8Array(src.length * 2 + 8); let n = 0, i = 0;
  while (i < src.length) {
    const v = src[i]; let j = i + 1;
    while (j < src.length && src[j] === v) j++;
    let len = j - i; out[n++] = v;
    while (len >= 128) { out[n++] = (len & 127) | 128; len >>>= 7; }
    out[n++] = len; i = j;
  }
  return out.subarray(0, n);
}
export function rleDecode(src, size) {
  const out = new Uint8Array(size); let i = 0, o = 0;
  while (i < src.length && o < size) {
    const v = src[i++]; let len = 0, sh = 0, b;
    do { b = src[i++]; len |= (b & 127) << sh; sh += 7; } while (b & 128);
    if (v) out.fill(v, o, o + len);
    o += len;
  }
  return out;
}
