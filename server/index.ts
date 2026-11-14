// Dedicated Server: derselbe Server-Kern wie im Browser, headless in Node.js, Clients verbinden sich per WebSocket.
// Start: node server/dist/server.mjs [config.json]
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { WebSocketServer } from 'ws';
import { GameServer } from '../core/server';
import { runCommand } from '../core/commands';

const cfgPath = process.argv[2] || process.env.KANTENHAIN_CONFIG || 'server.config.json';
const defaults = { port: 25580, maxPlayers: 8, whitelist: null as string[] | null, operators: [] as string[], worldName: 'Serverwelt', seed: Math.floor(Math.random() * 2e9), gamemode: 'survival', cheats: false, viewDistance: 8, worldFile: 'world.json' };
let cfg = { ...defaults };
if (fs.existsSync(cfgPath)) cfg = { ...defaults, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) };
else { fs.writeFileSync(cfgPath, JSON.stringify(defaults, null, 2)); console.log(`Konfiguration angelegt: ${cfgPath}`); }
if (process.env.PORT) cfg.port = +process.env.PORT;
const worldFile = path.resolve(path.dirname(cfgPath), cfg.worldFile);

let rec: any = { id: 'server', name: cfg.worldName, seed: cfg.seed, mode: cfg.gamemode, cheats: cfg.cheats };
if (fs.existsSync(worldFile)) { rec = JSON.parse(fs.readFileSync(worldFile, 'utf8')); console.log(`Welt geladen: ${worldFile}`); }
rec.cheats = cfg.cheats;
const stamp = () => new Date().toISOString().slice(11, 19);
const server = new GameServer(rec, {
  save: (r) => { fs.writeFileSync(worldFile + '.tmp', JSON.stringify(r)); fs.renameSync(worldFile + '.tmp', worldFile); }, // erst temporär schreiben, dann ersetzen
  log: (m) => console.log(`[${stamp()}] ${m}`),
}, { maxPlayers: cfg.maxPlayers, whitelist: cfg.whitelist, ops: cfg.operators, viewDistance: cfg.viewDistance });

const wss = new WebSocketServer({ port: cfg.port, maxPayload: 64 * 1024 });
wss.on('connection', (ws) => {
  ws.binaryType = 'arraybuffer';
  const c = server.connect((buf) => { if (ws.readyState === 1 && ws.bufferedAmount < 8e6) ws.send(buf); });
  ws.on('message', (d: ArrayBuffer, isBinary) => { if (isBinary) c.recv(d); });
  ws.on('close', () => c.close()); ws.on('error', () => c.close());
});
// feste 20 Ticks pro Sekunde
let last = Date.now(), acc = 0;
setInterval(() => { const now = Date.now(); acc += now - last; last = now; let n = 0; while (acc >= 50 && n++ < 5) { server.tick(); acc -= 50; } if (acc >= 50) acc = 0; }, 25);
console.log(`Kantenhain-Server läuft auf Port ${cfg.port} (max. ${cfg.maxPlayers} Spieler, Seed ${rec.seed}). Befehle hier ohne "/" eingeben, "stop" beendet.`);

// Konsole: Befehle mit Operator-Rechten
const stop = () => { server.save(); console.log('Welt gespeichert, Server beendet.'); process.exit(0); };
if (process.stdin.isTTY || process.env.KANTENHAIN_CONSOLE) readline.createInterface({ input: process.stdin }).on('line', (l) => { l = l.trim(); if (l === 'stop') stop(); else if (l) runCommand(server, null, l); });
process.on('SIGINT', stop); process.on('SIGTERM', stop);
