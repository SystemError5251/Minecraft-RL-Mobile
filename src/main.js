// Einstieg: Startbildschirm, Verbindung zum Server (lokaler Worker, Raumcode oder Serveradresse), Rendern, Auto-Qualität.
import { Renderer } from './renderer.js';
import { World } from './world.js';
import { Player } from './player.js';
import { ClientGame } from './client.js';
import { Settings, AUTO_STEPS, PRESETS, PRESET_NAMES } from './settings.js';
import { computeEnv, sunDirAt } from './env.js';
import { configure, surfaceY, biomeAt, SHOWCASE, CS } from './worldgen.js';
import { mat4, perspective, ortho, lookAt, mul, invert, transform } from './math.js';
import { BLOCKS, isSolid } from './blocks.js';
import { ITEMS, initIcons } from './items.js';
import { BoxBatch } from './entities.js';
import { UI, Input, loadProfile } from './ui.js';
import { localConn, wsConn, hostRoom, joinRoom, newRoomCode } from './net.js';
import * as store from './storage.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const sceneName = params.get('scene'), shot = params.has('shot');
// Feste Kameras für die Vergleichs-Screenshots
const SCENES = {
  meadow: { pos: [0, 0], eyeH: 1.25, yaw: 0, pitch: 0.07, time: 11.7, fov: 88 },
  swamp: { pos: [0, 0], eyeH: 1.35, faceSun: -0.12, pitch: 0.06, time: 6.72, fov: 72, fog: 1.5 },
  forest: { pos: [-6, 0], eyeH: 1.5, faceSun: 0.12, pitch: 0.04, time: 7.2, fov: 72, fog: 1.15 },
  showcase: { time: 10 },
};
const scene = SCENES[sceneName] || null;
const showcase = sceneName === 'showcase';

const canvas = $('gl');
const settings = new Settings();
if (params.get('q') && PRESETS[params.get('q')]) { settings.preset = params.get('q'); settings.overrides = {}; settings.dist = null; }
if (shot) settings.auto = false;
for (const k of (params.get('off') || '').split(',').filter(Boolean)) settings.overrides[k] = typeof PRESETS.ultra[k] === 'number' ? 0 : false; // Effekte per URL abschalten (Tests)
if (params.get('dist')) settings.dist = +params.get('dist');
let q = settings.effective();

const ui = new UI(), player = new Player(), batch = new BoxBatch();
const state = { menuOpen: false, portrait: false, host: false, room: null, roomError: '', sig: '' };
let renderer, world = null, game = null, input, worker = null, texBufs = {}, fov = 72, eyeOverride = null, sceneApplied = false;

async function loadTex(res) {
  if (!texBufs[res]) texBufs[res] = await (await fetch(`assets/tex${res}.bin`)).arrayBuffer();
  renderer.setTextures(res, texBufs[res]);
}
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2) * q.scale;
  const w = Math.max(2, Math.round(innerWidth * dpr)), h = Math.max(2, Math.round(innerHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  // Hochkant gehaltenes Gerät: Spiel pausieren und zum Drehen auffordern
  state.portrait = matchMedia('(pointer: coarse)').matches && innerHeight > innerWidth * 1.05 && !shot;
  document.body.classList.toggle('portrait', state.portrait);
}
async function applySettings() {
  q = settings.effective();
  if (renderer.texRes !== q.tex) await loadTex(q.tex);
  renderer.configure(q);
  resize();
  game?.setView(q.dist);
  if (state.menuOpen) openMenu();
}
const menuCb = {
  rebuild: () => { if (state.menuOpen) openMenu(); }, apply: () => applySettings(), close: () => toggleMenu(false),
  quit: () => { if (!state.host) { game.close(); location.href = location.pathname; return; } worker.postMessage({ type: 'save' }); setTimeout(() => { location.href = location.pathname; }, 400); },
  setCheats: (on) => worker?.postMessage({ type: 'cheats', on }),
  roomLink: () => `${location.origin}${location.pathname}?join=${state.room.code}&sig=${encodeURIComponent(state.sig)}`,
  openRoom: async (sig) => { // „Für Mitspieler öffnen“: Raumcode + QR-Code, Beitritt per WebRTC
    state.roomError = '';
    if (!sig) state.roomError = 'Bitte die Adresse des Signaling-Dienstes eintragen (siehe README, „Server hosten“)';
    else try { state.sig = sig; state.room = await hostRoom(sig, newRoomCode(), worker, (r, msg) => { if (msg) ui.toast(msg); menuCb.rebuild(); }); } catch (e) { state.roomError = e.message; }
    menuCb.rebuild();
  },
};
function openMenu() { ui.buildMenu(game, settings, { ...menuCb, isHost: state.host, room: state.room, roomError: state.roomError }); }
function toggleMenu(on = !state.menuOpen) {
  if (!game || shot) return;
  if (ui.chatOpen) { ui.closeChat(); return; }
  if (ui.invOpen) { ui.closeInventory(); return; }
  state.menuOpen = on; $('menu').hidden = !on;
  if (on) { document.exitPointerLock?.(); openMenu(); worker?.postMessage({ type: 'save' }); }
}
function toggleInventory() {
  if (!game || game.dead || state.menuOpen || shot) return;
  if (ui.invOpen) ui.closeInventory(); else ui.requestInventory();
}
function setSlot(i) { if (!game) return; game.setSlot(((i % 9) + 9) % 9); const h = game.held(); if (h) ui.toast(ITEMS[h.id].name); }
// Vollbild + Querformat-Sperre (klappt nur nach einer Nutzeraktion und nicht in jedem Browser)
function goFullscreen() {
  try { const p = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); p?.then(() => screen.orientation?.lock?.('landscape')?.catch(() => {})).catch(() => {}); } catch { /* nicht unterstützt */ }
  try { screen.orientation?.lock?.('landscape')?.catch(() => {}); } catch { /* nicht unterstützt */ }
}

// ---- Sitzung starten: der Client spricht immer dasselbe Protokoll, nur der Transport wechselt ----
function startSession(conn, profile) {
  ui.game = game = new ClientGame(conn, player, ui, { name: profile.name, skin: profile.skin, viewDist: q.dist, onWelcome: (g) => {
    configure({ seed: g.seed, scene: g.scene });
    world = g.world = new World(renderer, { seed: g.seed, scene: g.scene });
    $('hud').style.display = shot || showcase ? 'none' : '';
  } });
  window.__game = { player, settings, state, game, ui, input, get world() { return world; } }; // für Tests/Debugging
}
// Eigene Welt: Server-Kern im Worker (Einzelspieler und Host für Mitspieler)
function startHost(rec, profile) {
  state.host = true;
  worker = new Worker(new URL('../build/server.worker.js', import.meta.url));
  worker.onmessage = (e) => { if (e.data.type === 'started') startSession(localConn(worker, true), profile); };
  worker.postMessage({ type: 'start', rec, maxPlayers: 4 });
  if (shot || rec.temp) return;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') worker.postMessage({ type: 'save' }); });
  addEventListener('pagehide', () => worker.postMessage({ type: 'save' }));
}

async function start() {
  renderer = new Renderer(canvas);
  await loadTex(q.tex);
  renderer.configure(q);
  resize();
  addEventListener('resize', resize);
  if (!texBufs[64]) texBufs[64] = await (await fetch('assets/tex64.bin')).arrayBuffer();
  initIcons(texBufs[64], 64);
  input = new Input(canvas, { menu: () => toggleMenu(), inventory: toggleInventory, slot: setSlot, slotDelta: (d) => game && setSlot(game.slot + d), chat: (p) => ui.openChat(p), debug: () => ui.setDebug(!ui.debug) });
  ui.bindInventory(); ui.bindChat();
  $('respawnBtn').onclick = () => { game.respawn(); $('death').hidden = true; };
  $('discBtn').onclick = () => { location.href = location.pathname; };
  document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && game && !state.menuOpen && !ui.invOpen && !ui.chatOpen && !game.dead && !shot && !document.body.classList.contains('touch')) toggleMenu(true); });
  $('hud').style.display = 'none';

  const profile = loadProfile();
  if (scene || shot) { // Szenen/Screenshots: flüchtige Kreativ-Welt ohne Speichern
    if (scene) fov = scene.fov || 72;
    startHost({ id: 'szene', name: 'Szene', seed: +(params.get('seed') || 1337), scene: sceneName, mode: 'creative', cheats: true, temp: true, state: { time: +(params.get('time') || scene?.time || 9.5), timeRunning: !scene, rules: { doWeatherCycle: false, doMobSpawning: !shot } } }, profile);
    if (showcase) for (const s of SHOWCASE) { const el = document.createElement('span'); el.textContent = BLOCKS[s.b].name; s.el = el; $('labels').appendChild(el); }
  } else {
    const cb = {
      play: async (id, p) => { goFullscreen(); startHost(await store.loadWorld(id), p); },
      create: (o, p) => { goFullscreen(); const seed = /^-?\d+$/.test(o.seed) ? +o.seed % 2147483647 : Math.floor(Math.random() * 2e9); startHost({ id: 'w' + Date.now().toString(36), name: o.name, seed, mode: o.mode, cheats: !!o.cheats, created: Date.now(), played: Date.now() }, p); },
      del: async (id) => { await store.deleteWorld(id); return store.listWorlds(); },
      join: async (o, p) => { // Mitspielen: Dedicated Server per WebSocket oder Raum per WebRTC
        goFullscreen(); $('loading').style.display = 'block'; $('loading').textContent = 'Verbinde …';
        try { startSession(o.server ? await wsConn(/^wss?:\/\//.test(o.server) ? o.server : 'ws://' + o.server) : await joinRoom(o.sig, o.code), p); $('loading').textContent = 'Welt wird geladen …'; }
        catch (e) { $('loading').style.display = 'none'; ui.titleError(e.message); }
      },
    };
    if (params.get('new')) cb.create({ name: 'Test', seed: params.get('seed') || '1337', mode: params.get('new'), cheats: params.has('cheats') }, profile); // Schnellstart für Tests
    else ui.showTitle(await store.listWorlds(), await store.persistent(), cb, { join: params.get('join') || '', sig: params.get('sig') || '', server: params.get('server') || '' });
  }
  if (params.get('cam')) { const c = params.get('cam').split(',').map(Number); eyeOverride = [c[0], c[1], c[2]]; player.yaw = c[3] || 0; player.pitch = c[4] || 0; sceneApplied = true; }
  if (params.get('fov')) fov = +params.get('fov');

  const cam = { pos: [0, 0, 0], fwd: [0, 0, -1], view: mat4(), proj: mat4(), viewProj: mat4(), invViewProj: mat4(), near: 0.1, far: 1500 };
  let last = performance.now(), clock = shot ? 20 : 0, fpsAcc = 0, fpsN = 0, fps = 60, slowT = 0, cooldown = 4, stable = 0, shotDone = 0, rain = 0, wasPaused = false, dbgT = 0, kb = 0;
  const nameEls = [];
  window.__status = { ready: false };

  function frame(now) {
    // Screenshot-Modus: nach dem Laden nur noch selten neu zeichnen, damit die Aufnahme nicht blockiert
    if (shot && window.__status.ready && ++shotDone > 3) setTimeout(() => requestAnimationFrame(frame), 4000); else requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now; // bei sehr niedriger Bildrate läuft das Spiel langsamer statt instabil
    if (!game || !world) return;
    if (scene && !showcase && !sceneApplied && game.tpSeq > 0) { // Szenenkamera setzen, sobald der Server die Startposition geschickt hat
      const [x, z] = scene.pos, sd = sunDirAt(game.time); sceneApplied = true;
      player.pos = [x + 0.5, surfaceY(x, z), z + 0.5]; player.yaw = scene.faceSun !== undefined ? Math.atan2(sd[0], -sd[2]) + scene.faceSun : scene.yaw; player.pitch = scene.pitch;
      if (shot) eyeOverride = [x + 0.5, surfaceY(x, z) + scene.eyeH, z + 0.5];
    }
    const frozen = state.menuOpen || state.portrait || ui.invOpen || ui.chatOpen;
    const paused = state.menuOpen || state.portrait; // Einzelspieler pausiert im Menü und hochkant
    if (paused !== wasPaused) { wasPaused = paused; worker?.postMessage({ type: 'pause', on: paused }); }
    if (!shot) clock += dt;
    if (!frozen) { player.yaw += input.lookX; player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - input.lookY)); }
    input.lookX = input.lookY = 0;
    if (!shot && !showcase) game.frame(dt, input, frozen);
    if (input.jumpRelease) { input.jump = false; input.jumpRelease = false; }

    const W = canvas.width, H = canvas.height, aspect = W / H;
    // Regen nur unter freiem Himmel einblenden
    let open = true; for (let i = 1; i < 30; i++) if (isSolid(world.getBlock(Math.floor(cam.pos[0]), Math.floor(cam.pos[1]) + i, Math.floor(cam.pos[2])))) { open = false; break; }
    rain += ((game.weather > 0 ? 1 : 0) - rain) * Math.min(1, dt * 0.8);
    let envOpts = { fog: scene?.fog, rain, flash: game.flash };
    if (showcase) {
      const ctr = [5.5, 50.3, 4.0], d = [0.62, 0.52, 0.62], hh = aspect > 1.3 ? 4.05 : 7.4 / Math.min(aspect * 1.25, 1.3);
      cam.pos = [ctr[0] + d[0] * 14, ctr[1] + d[1] * 14, ctr[2] + d[2] * 14]; cam.fwd = [-d[0], -d[1], -d[2]];
      lookAt(cam.view, cam.pos, ctr, [0, 1, 0]);
      ortho(cam.proj, -hh * aspect, hh * aspect, -hh, hh, -40, 60);
      envOpts = { showcase: true, sunDir: [0.24, 0.80, 0.55] };
      world.update(8, 8, 1);
    } else {
      cam.pos = eyeOverride || player.eye(); cam.fwd = player.forward();
      lookAt(cam.view, cam.pos, [cam.pos[0] + cam.fwd[0], cam.pos[1] + cam.fwd[1], cam.pos[2] + cam.fwd[2]], [0, 1, 0]);
      perspective(cam.proj, fov * Math.PI / 180 * (aspect < 1 ? 1.3 : 1), aspect, cam.near, cam.far);
      world.update(cam.pos[0], cam.pos[2], q.dist);
    }
    mul(cam.viewProj, cam.proj, cam.view); invert(cam.invViewProj, cam.viewProj);
    const env = computeEnv(game.time, q.dist * CS - 10, envOpts);
    batch.reset();
    const labels = game.draw(batch, clock);
    renderer.render({ cam, env, chunks: world.list, time: clock, showcase, still: shot, boxes: batch, rain: open && !showcase ? rain : 0 });
    if (!shot && !showcase) { ui.updateHud(game); $('underwater').style.display = player.headInWater ? 'block' : 'none'; }
    if (showcase) for (const s of SHOWCASE) {
      const p = transform(cam.viewProj, s.x + 0.5, s.y - 0.55, s.z + 0.5);
      s.el.style.left = (p[0] * 0.5 + 0.5) * innerWidth + 'px'; s.el.style.top = (0.5 - p[1] * 0.5) * innerHeight + 'px';
    } else { // Spielernamen über den Köpfen
      for (let i = 0; i < Math.max(labels.length, nameEls.length); i++) {
        let el = nameEls[i]; if (!el) { el = nameEls[i] = document.createElement('span'); el.className = 'name'; $('labels').appendChild(el); }
        const l = labels[i], p = l && transform(cam.viewProj, l[1], l[2], l[3]);
        if (!l || p[3] <= 0.1 || p[3] > 48) { el.style.display = 'none'; continue; }
        el.style.display = ''; if (el.textContent !== l[0]) el.textContent = l[0];
        el.style.left = (p[0] / p[3] * 0.5 + 0.5) * innerWidth + 'px'; el.style.top = (0.5 - p[1] / p[3] * 0.5) * innerHeight + 'px';
      }
    }
    // Ladeanzeige + Bereitschaft für Screenshots
    const loading = world.missing > 0;
    $('loading').style.display = loading && world.missing > 8 && !shot ? 'block' : 'none';
    if (loading) $('loading').textContent = 'Welt wird geladen …';
    stable = loading ? 0 : stable + 1;
    window.__status.ready = stable > 12;
    // FPS, Koordinaten, Debug-Anzeige, Auto-Qualität
    fpsAcc += dt; fpsN++;
    if ((dbgT -= dt) <= 0) {
      dbgT = 0.25;
      const p = player.pos, fx = Math.floor(p[0]), fy = Math.floor(p[1]), fz = Math.floor(p[2]);
      $('info').textContent = `${fps.toFixed(0)} FPS · ${PRESET_NAMES[settings.preset]}${settings.auto && settings.autoStep ? ' (Auto −' + settings.autoStep + ')' : ''} · XYZ ${fx} ${fy} ${fz}`;
      if (ui.debug) {
        const b = biomeAt(fx, fz), biome = b[2] > 0.5 ? 'Sumpf' : b[1] > 0.5 ? 'Wald' : 'Wiese', yawDeg = (((player.yaw * 180 / Math.PI) % 360) + 360) % 360;
        const facing = ['Norden (−Z)', 'Osten (+X)', 'Süden (+Z)', 'Westen (−X)'][Math.round(yawDeg / 90) % 4], ray = player.raycast(world, 6);
        let mobs = 0, drops = 0, others = 0; for (const e of game.ents.values()) { if (e.kind === 1) mobs++; else if (e.kind === 2) drops++; else others++; }
        $('debug').textContent = [
          `Kantenhain · ${fps.toFixed(0)} FPS · ${canvas.width}×${canvas.height} · ${PRESET_NAMES[settings.preset]}`,
          `XYZ: ${p[0].toFixed(2)} / ${p[1].toFixed(2)} / ${p[2].toFixed(2)}`,
          `Block: ${fx} ${fy} ${fz} · Chunk: ${Math.floor(fx / CS)} ${Math.floor(fz / CS)} (${((fx % CS) + CS) % CS} ${((fz % CS) + CS) % CS})`,
          `Blick: ${facing} · ${yawDeg.toFixed(0)}° / ${(player.pitch * 180 / Math.PI).toFixed(0)}°`,
          `Biom: ${biome} · Seed: ${game.seed}`,
          `Ziel: ${ray ? ray.hit.join(' ') + ' (' + BLOCKS[ray.block].name + ')' : '–'}`,
          `Chunks: ${renderer.stats.chunks} sichtbar / ${world.list.length} geladen · ${(renderer.stats.tris / 1000).toFixed(0)}k Dreiecke`,
          `Figuren: ${mobs} · Items: ${drops} · Mitspieler: ${others}`,
          `Zeit: ${Math.floor(game.time)}:${String(Math.floor(game.time % 1 * 60)).padStart(2, '0')} · Wetter: ${['klar', 'Regen', 'Gewitter'][game.weather]} · ${['Friedlich', 'Leicht', 'Normal', 'Schwer'][game.difficulty]}`,
          `Netz: ${state.host ? 'Host (lokaler Server)' : 'Client'} · Ping ${game.ping} ms · ${kb.toFixed(1)} kB/s`,
        ].join('\n');
      }
    }
    if (fpsAcc >= 0.5) {
      fps = fpsN / fpsAcc; kb = game.bytesIn / fpsAcc / 1024; game.bytesIn = 0; fpsAcc = 0; fpsN = 0;
      cooldown -= 0.5;
      if (settings.auto && !loading && !paused && cooldown <= 0 && document.visibilityState === 'visible') {
        slowT = fps < 40 ? slowT + 0.5 : 0;
        if (slowT >= 2 && settings.autoStep < AUTO_STEPS.length) {
          // nächsten wirksamen Schritt suchen (z. B. SSR überspringen, wenn ohnehin aus)
          const before = JSON.stringify(settings.effective());
          do { settings.autoStep++; } while (settings.autoStep < AUTO_STEPS.length && JSON.stringify(settings.effective()) === before);
          ui.toast('Auto-Qualität: ' + AUTO_STEPS[settings.autoStep - 1][0]);
          slowT = 0; cooldown = 3; applySettings();
        }
      }
    }
  }
  requestAnimationFrame(frame);
}
start().catch((e) => { console.error(e); $('loading').style.display = 'block'; $('loading').textContent = 'Fehler: ' + e.message; });
