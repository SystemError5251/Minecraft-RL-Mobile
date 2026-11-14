// Einstieg: Startbildschirm, Welt laden/erstellen, Spielschleife (Rendern pro Bild, Logik mit 20 TPS), Speichern, Auto-Qualität.
import { Renderer } from './renderer.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Game } from './game.js';
import { Settings, AUTO_STEPS, PRESETS, PRESET_NAMES } from './settings.js';
import { computeEnv, sunDirAt } from './env.js';
import { configure, surfaceY, SHOWCASE, CS } from './worldgen.js';
import { mat4, perspective, ortho, lookAt, mul, invert, transform } from './math.js';
import { BLOCKS } from './blocks.js';
import { ITEMS, initIcons } from './items.js';
import { BoxBatch, TICK } from './entities.js';
import { UI, Input } from './ui.js';
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
const state = { menuOpen: false, portrait: false };
let renderer, world, game, input, texBufs = {};

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
  if (state.menuOpen) openMenu();
}
const menuCb = { rebuild: () => openMenu(), apply: () => applySettings(), close: () => toggleMenu(false), quit: async () => { await save(); location.href = location.pathname; } };
function openMenu() { ui.buildMenu(game, settings, menuCb); }
function toggleMenu(on = !state.menuOpen) {
  if (!game || shot) return;
  if (ui.invOpen) { ui.closeInventory(); return; }
  state.menuOpen = on; $('menu').hidden = !on;
  if (on) { document.exitPointerLock?.(); openMenu(); save(); }
}
function toggleInventory() {
  if (!game || game.dead || state.menuOpen || shot) return;
  if (ui.invOpen) ui.closeInventory(); else ui.openInventory('inv');
}
function setSlot(i) { if (!game) return; game.slot = ((i % 9) + 9) % 9; const h = game.held(); if (h) ui.toast(ITEMS[h.id].name); }
// Vollbild + Querformat-Sperre (klappt nur nach einer Nutzeraktion und nicht in jedem Browser)
function goFullscreen() {
  try { const p = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); p?.then(() => screen.orientation?.lock?.('landscape')?.catch(() => {})).catch(() => {}); } catch { /* nicht unterstützt */ }
  try { screen.orientation?.lock?.('landscape')?.catch(() => {}); } catch { /* nicht unterstützt */ }
}

// ---- Speichern: Spielmodus, Inventar, Leben, Hunger, Position und Blockänderungen pro Welt ----
let saving = false;
async function save() {
  if (!game || game.rec.temp || saving) return;
  saving = true;
  try { await store.saveWorld({ ...game.rec, mode: game.mode, played: Date.now(), state: game.serialize(), edits: world.editsJSON() }); } catch (e) { console.warn('Speichern fehlgeschlagen', e); }
  saving = false;
}

function startGame(rec) {
  configure({ seed: rec.seed, scene: sceneName });
  world = new World(renderer, { seed: rec.seed, scene: sceneName, edits: rec.edits });
  ui.game = game = new Game(rec, world, player, ui);
  window.__game = { player, world, settings, state, game, ui, input, save }; // für Tests/Debugging
  $('hud').style.display = shot || showcase ? 'none' : '';
  if (shot || showcase) return;
  setInterval(save, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
  addEventListener('pagehide', save);
}

async function start() {
  renderer = new Renderer(canvas);
  await loadTex(q.tex);
  renderer.configure(q);
  resize();
  addEventListener('resize', resize);
  if (!texBufs[64]) texBufs[64] = await (await fetch('assets/tex64.bin')).arrayBuffer();
  initIcons(texBufs[64], 64);
  input = new Input(canvas, { menu: () => toggleMenu(), inventory: toggleInventory, slot: setSlot, slotDelta: (d) => game && setSlot(game.slot + d) });
  ui.bindInventory();
  $('respawnBtn').onclick = () => { game.respawn(); $('death').hidden = true; };
  document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && game && !state.menuOpen && !ui.invOpen && !game.dead && !shot && !document.body.classList.contains('touch')) toggleMenu(true); });
  $('hud').style.display = 'none';

  let fov = 72, eyeOverride = null;
  if (scene || shot) { // Szenen/Screenshots: flüchtige Kreativ-Welt ohne Speichern
    startGame({ id: 'szene', name: 'Szene', seed: +(params.get('seed') || 1337), mode: 'creative', temp: true, state: { time: +(params.get('time') || scene?.time || 9.5), timeRunning: !scene } });
    if (scene && !showcase) {
      const [x, z] = scene.pos, sd = sunDirAt(game.time);
      player.pos = [x + 0.5, surfaceY(x, z), z + 0.5];
      player.yaw = scene.faceSun !== undefined ? Math.atan2(sd[0], -sd[2]) + scene.faceSun : scene.yaw;
      player.pitch = scene.pitch; fov = scene.fov;
      if (shot) eyeOverride = [x + 0.5, surfaceY(x, z) + scene.eyeH, z + 0.5];
    }
    if (showcase) for (const s of SHOWCASE) { const el = document.createElement('span'); el.textContent = BLOCKS[s.b].name; s.el = el; $('labels').appendChild(el); }
  } else {
    const cb = {
      play: async (id) => { goFullscreen(); startGame(await store.loadWorld(id)); },
      create: (o) => { goFullscreen(); const seed = /^-?\d+$/.test(o.seed) ? +o.seed % 2147483647 : Math.floor(Math.random() * 2e9); startGame({ id: 'w' + Date.now().toString(36), name: o.name, seed, mode: o.mode, created: Date.now(), played: Date.now() }); save(); },
      del: async (id) => { await store.deleteWorld(id); return store.listWorlds(); },
    };
    const worlds = await store.listWorlds();
    if (params.get('new')) cb.create({ name: 'Test', seed: params.get('seed') || '1337', mode: params.get('new') }); // Schnellstart für Tests
    else ui.showTitle(worlds, await store.persistent(), cb);
  }
  if (params.get('cam')) { const c = params.get('cam').split(',').map(Number); eyeOverride = [c[0], c[1], c[2]]; player.yaw = c[3] || 0; player.pitch = c[4] || 0; }
  if (params.get('fov')) fov = +params.get('fov');

  const cam = { pos: [0, 0, 0], fwd: [0, 0, -1], view: mat4(), proj: mat4(), viewProj: mat4(), invViewProj: mat4(), near: 0.1, far: 1500 };
  let last = performance.now(), clock = shot ? 20 : 0, acc = 0, fpsAcc = 0, fpsN = 0, fps = 60, slowT = 0, cooldown = 4, stable = 0, shotDone = 0;
  window.__status = { ready: false };

  function frame(now) {
    // Screenshot-Modus: nach dem Laden nur noch selten neu zeichnen, damit die Aufnahme nicht blockiert
    if (shot && window.__status.ready && ++shotDone > 3) setTimeout(() => requestAnimationFrame(frame), 4000); else requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now; // bei sehr niedriger Bildrate läuft das Spiel langsamer statt instabil
    if (!game) return;
    const paused = state.menuOpen || state.portrait || shot || showcase;
    if (!shot) clock += dt;
    player.yaw += input.lookX; player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - input.lookY)); input.lookX = input.lookY = 0;
    if (!paused) {
      if (!ui.invOpen && !game.dead) game.frame(dt, input); else { input.usePressed = input.breakPressed = input.flyToggle = false; game.breaking = null; }
      if (input.jumpRelease) { input.jump = false; input.jumpRelease = false; }
      // Spiel-Logik mit fester Tickrate, unabhängig von der Bildrate
      acc += dt; let n = 0;
      while (acc >= TICK && n++ < 5) { game.tick(); acc -= TICK; }
      if (acc >= TICK) acc = 0;
    }
    const W = canvas.width, H = canvas.height, aspect = W / H;
    let envOpts = { fog: scene?.fog };
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
    const al = acc / TICK;
    for (const m of game.mobs) if (!m.dead) batch.addMob(m, al);
    for (const d of game.drops) if (!d.dead) batch.addDrop(d, al, clock);
    renderer.render({ cam, env, chunks: world.list, time: clock, showcase, still: shot, boxes: batch });
    if (!shot && !showcase) { ui.updateHud(game); $('underwater').style.display = player.headInWater ? 'block' : 'none'; }
    if (showcase) for (const s of SHOWCASE) {
      const p = transform(cam.viewProj, s.x + 0.5, s.y - 0.55, s.z + 0.5);
      s.el.style.left = (p[0] * 0.5 + 0.5) * innerWidth + 'px'; s.el.style.top = (0.5 - p[1] * 0.5) * innerHeight + 'px';
    }
    // Ladeanzeige + Bereitschaft für Screenshots
    const loading = world.missing > 0;
    $('loading').style.display = loading && world.missing > 8 && !shot ? 'block' : 'none';
    stable = loading ? 0 : stable + 1;
    window.__status.ready = stable > 12;
    // FPS + Auto-Qualität
    fpsAcc += dt; fpsN++;
    if (fpsAcc >= 0.5) {
      fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0;
      $('info').textContent = `${fps.toFixed(0)} FPS · ${PRESET_NAMES[settings.preset]}${settings.auto && settings.autoStep ? ' (Auto −' + settings.autoStep + ')' : ''}`;
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
