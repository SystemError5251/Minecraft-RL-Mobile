// Signaling-Dienst als Cloudflare Worker mit Durable Object (ein Objekt pro Raumcode).
// Deploy: cd signaling/cloudflare && npx wrangler deploy     Adresse im Spiel: wss://<name>.<konto>.workers.dev
const MAX_GUESTS = 3;
export default {
  async fetch(req, env) {
    const u = new URL(req.url), m = u.pathname.match(/^\/room\/([A-Z0-9]{4,8})$/);
    if (!m) return new Response('Kantenhain-Signaling', { status: 200 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket erwartet', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
};
export class Room {
  constructor(state) { this.state = state; }
  async fetch(req) {
    const role = new URL(req.url).searchParams.get('role'), pair = new WebSocketPair(), [client, ws] = Object.values(pair);
    const host = this.state.getWebSockets('host')[0], guests = this.state.getWebSockets('guest');
    if (role === 'host') {
      if (host) return new Response('Raum existiert bereits', { status: 409 });
      this.state.acceptWebSocket(ws, ['host']);
    } else {
      this.state.acceptWebSocket(ws, ['guest']);
      if (!host) { ws.send(JSON.stringify({ error: 'no-host' })); ws.close(1000, 'no-host'); }
      else if (guests.length >= MAX_GUESTS) { ws.send(JSON.stringify({ error: 'full' })); ws.close(1000, 'full'); }
      else { const id = ((await this.state.storage.get('next')) || 1); await this.state.storage.put('next', id + 1); ws.serializeAttachment({ id }); }
    }
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws, text) {
    let msg; try { msg = JSON.parse(text); } catch { return; }
    const att = ws.deserializeAttachment();
    if (att && att.id) { const host = this.state.getWebSockets('host')[0]; if (host) host.send(JSON.stringify({ from: att.id, data: msg.data })); }
    else for (const g of this.state.getWebSockets('guest')) { const a = g.deserializeAttachment(); if (a && a.id === msg.to) g.send(JSON.stringify({ data: msg.data })); }
  }
  webSocketClose(ws) {
    const att = ws.deserializeAttachment(), host = this.state.getWebSockets('host').filter((h) => h !== ws)[0];
    if (att && att.id) { if (host) host.send(JSON.stringify({ from: att.id, left: true })); }
    else { for (const g of this.state.getWebSockets('guest')) g.close(1000, 'host left'); this.state.storage.deleteAll(); }
  }
}
