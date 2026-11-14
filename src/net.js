// Transporte für das Binärprotokoll: postMessage (lokaler Server im Worker), WebSocket (Dedicated Server), WebRTC (Raumcode).
// Jede Verbindung: { send(ArrayBuffer), close(), onmessage, onclose }
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }]; // öffentlicher STUN-Server

export function localConn(worker, local = true) {
  const ch = new MessageChannel(), c = { send: (b) => ch.port1.postMessage(b, [b]), close: () => { ch.port1.postMessage('close'); }, onmessage: null, onclose: null };
  ch.port1.onmessage = (e) => c.onmessage?.(e.data);
  worker.postMessage({ type: 'conn', port: ch.port2, local }, [ch.port2]);
  return c;
}
export function wsConn(url) {
  return new Promise((res, rej) => {
    let ws; try { ws = new WebSocket(url); } catch (e) { return rej(new Error('Ungültige Adresse')); }
    ws.binaryType = 'arraybuffer';
    const c = { send: (b) => { if (ws.readyState === 1) ws.send(b); }, close: () => ws.close(), onmessage: null, onclose: null };
    ws.onopen = () => res(c); ws.onerror = () => rej(new Error('Server nicht erreichbar'));
    ws.onmessage = (e) => c.onmessage?.(e.data); ws.onclose = () => c.onclose?.();
  });
}
const gathered = (pc) => new Promise((res) => { // ohne Trickle-ICE: warten, bis alle Kandidaten gesammelt sind
  if (pc.iceGatheringState === 'complete') return res();
  const t = setTimeout(res, 2500); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
});
const sigUrl = (base, code, role) => `${base.replace(/\/+$/, '')}/room/${code}?role=${role}`;
export const newRoomCode = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)]; return s; };

// Host: nimmt über den Signaling-Dienst Mitspieler an und verbindet deren DataChannel mit dem Server-Worker
export function hostRoom(base, code, worker, onChange) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(sigUrl(base, code, 'host')), peers = new Map();
    const room = { code, count: 0, close: () => { ws.close(); for (const p of peers.values()) p.pc.close(); } };
    ws.onopen = () => res(room); ws.onerror = () => rej(new Error('Signaling-Dienst nicht erreichbar'));
    ws.onclose = () => onChange?.(room, 'Signaling getrennt – neue Mitspieler können nicht mehr beitreten');
    ws.onmessage = async (e) => {
      const m = JSON.parse(e.data);
      if (m.left) { const pe = peers.get(m.from); if (pe && !pe.open) { pe.pc.close(); peers.delete(m.from); } return; } // Gast hat nur das Signaling verlassen – die Spielverbindung bleibt
      if (!m.data?.sdp) return;
      const pc = new RTCPeerConnection({ iceServers: ICE }); peers.set(m.from, { pc });
      pc.ondatachannel = (ev) => {
        const dc = ev.channel; dc.binaryType = 'arraybuffer';
        const ch = new MessageChannel();
        dc.onopen = () => { peers.get(m.from).open = true; worker.postMessage({ type: 'conn', port: ch.port2, local: false }, [ch.port2]); room.count++; onChange?.(room); };
        dc.onmessage = (d) => { const b = d.data; ch.port1.postMessage(b, [b]); };
        ch.port1.onmessage = (d) => { if (dc.readyState === 'open') dc.send(d.data); };
        dc.onclose = () => { pc.close(); peers.delete(m.from); ch.port1.postMessage('close'); room.count = Math.max(0, room.count - 1); onChange?.(room); };
      };
      await pc.setRemoteDescription(m.data.sdp);
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      ws.send(JSON.stringify({ to: m.from, data: { sdp: pc.localDescription } }));
    };
  });
}
// Gast: tritt per Raumcode bei
export function joinRoom(base, code) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(sigUrl(base, code.toUpperCase(), 'guest')), pc = new RTCPeerConnection({ iceServers: ICE });
    const dc = pc.createDataChannel('game', { ordered: true }); dc.binaryType = 'arraybuffer';
    const c = { send: (b) => { if (dc.readyState === 'open') dc.send(b); }, close: () => { dc.close(); pc.close(); }, onmessage: null, onclose: null };
    const timer = setTimeout(() => { ws.close(); pc.close(); rej(new Error('Zeitüberschreitung – ist der Raumcode richtig und der Host online?')); }, 20000);
    ws.onerror = () => { clearTimeout(timer); rej(new Error('Signaling-Dienst nicht erreichbar')); };
    ws.onopen = async () => { await pc.setLocalDescription(await pc.createOffer()); await gathered(pc); ws.send(JSON.stringify({ data: { sdp: pc.localDescription } })); };
    ws.onmessage = async (e) => {
      const m = JSON.parse(e.data);
      if (m.error) { clearTimeout(timer); pc.close(); return rej(new Error(m.error === 'no-host' ? 'Raum nicht gefunden' : m.error === 'full' ? 'Der Raum ist voll' : m.error)); }
      if (m.data?.sdp) await pc.setRemoteDescription(m.data.sdp);
    };
    dc.onopen = () => { clearTimeout(timer); ws.close(); res(c); };
    dc.onmessage = (e) => c.onmessage?.(e.data); dc.onclose = () => c.onclose?.();
  });
}
