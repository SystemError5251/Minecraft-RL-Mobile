// Winziger Signaling-Dienst für Raumcodes (Node.js-Variante, z. B. im WLAN oder auf einem VPS).
// Vermittelt nur die WebRTC-Verbindungsdaten zwischen Host und Gästen; Spieldaten laufen danach direkt Peer-to-Peer.
// Start: node signaling/server.mjs [port]     Adresse im Spiel: ws://<rechner>:8787
import { WebSocketServer } from 'ws';
const port = +(process.argv[2] || process.env.PORT || 8787), rooms = new Map(), MAX_GUESTS = 3;
const wss = new WebSocketServer({ port, maxPayload: 32 * 1024 });
wss.on('connection', (ws, req) => {
  const u = new URL(req.url, 'http://x'), m = u.pathname.match(/^\/room\/([A-Z0-9]{4,8})$/), role = u.searchParams.get('role');
  if (!m) return ws.close(1008, 'bad path');
  const code = m[1]; let room = rooms.get(code);
  if (role === 'host') {
    if (room) return ws.close(1008, 'room exists');
    room = { host: ws, guests: new Map(), next: 1 }; rooms.set(code, room);
    ws.on('message', (d) => { try { const msg = JSON.parse(d); room.guests.get(msg.to)?.send(JSON.stringify({ data: msg.data })); } catch { /* ignorieren */ } });
    ws.on('close', () => { rooms.delete(code); for (const g of room.guests.values()) g.close(); });
  } else {
    if (!room) { ws.send(JSON.stringify({ error: 'no-host' })); return ws.close(); }
    if (room.guests.size >= MAX_GUESTS) { ws.send(JSON.stringify({ error: 'full' })); return ws.close(); }
    const id = room.next++; room.guests.set(id, ws);
    ws.on('message', (d) => { try { room.host.send(JSON.stringify({ from: id, data: JSON.parse(d).data })); } catch { /* ignorieren */ } });
    ws.on('close', () => { room.guests.delete(id); if (room.host.readyState === 1) room.host.send(JSON.stringify({ from: id, left: true })); });
  }
});
console.log(`Signaling-Dienst läuft auf Port ${port}`);
