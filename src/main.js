// Einstieg: lädt Texturen, startet Welt + Renderer, Spielschleife, Auto-Qualität, Screenshot-Szenen.
import { Renderer } from './renderer.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Settings, AUTO_STEPS, PRESETS, PRESET_NAMES } from './settings.js';
import { computeEnv, sunDirAt } from './env.js';
import { configure, surfaceY, SHOWCASE, CS } from './worldgen.js';
import { mat4, perspective, ortho, lookAt, mul, invert, transform } from './math.js';
import { B, BLOCKS, HOTBAR } from './blocks.js';
import { buildHotbar, selectSlot, buildMenu, toast, Input } from './ui.js';

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
let q = settings.effective();

const state = { time: scene?.time ?? 9.5, timeRunning: !scene, menuOpen: false, closeMenu: () => toggleMenu(false) };
if (params.get('time')) state.time = +params.get('time');
const seed = +(params.get('seed') || 1337);
configure({ seed, scene: sceneName });

let renderer, world, texBufs = {};
const player = new Player();
let slot = 0;

async function loadTex(res) {
  if (!texBufs[res]) texBufs[res] = await (await fetch(`assets/tex${res}.bin`)).arrayBuffer();
  renderer.setTextures(res, texBufs[res]);
}
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2) * q.scale;
  const w = Math.max(2, Math.round(innerWidth * dpr)), h = Math.max(2, Math.round(innerHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
async function applySettings(rebuildMenu) {
  q = settings.effective();
  if (renderer.texRes !== q.tex) await loadTex(q.tex);
  renderer.configure(q);
  resize();
  if (rebuildMenu && state.menuOpen) buildMenu(state, settings, applySettings);
}
function toggleMenu(on = !state.menuOpen) {
  state.menuOpen = on; $('menu').hidden = !on;
  if (on) { document.exitPointerLock?.(); buildMenu(state, settings, applySettings); }
}

function act(place) {
  if (state.menuOpen || shot) return;
  const r = player.raycast(world);
  if (!r) return;
  if (place) { if (r.prev && !player.intersectsBlock(...r.prev)) world.setBlock(...r.prev, HOTBAR[slot]); }
  else world.setBlock(...r.hit, 0);
}
const setSlot = (i) => { slot = (i + HOTBAR.length) % HOTBAR.length; selectSlot(slot); toast(BLOCKS[HOTBAR[slot]].name); };

async function start() {
  renderer = new Renderer(canvas);
  await loadTex(q.tex);
  renderer.configure(q);
  resize();
  addEventListener('resize', resize);
  world = new World(renderer, { seed, scene: sceneName });
  if (!texBufs[64]) texBufs[64] = await (await fetch('assets/tex64.bin')).arrayBuffer();
  buildHotbar(texBufs[64], 64, setSlot); selectSlot(0);
  const input = new Input(canvas, { menu: () => toggleMenu(), slot: setSlot, slotDelta: (d) => setSlot(slot + d), breakBlock: () => act(false), placeBlock: () => act(true) });
  document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && !state.menuOpen && !shot && !document.body.classList.contains('touch')) toggleMenu(true); });

  // Startposition / Szenenkamera
  let fov = 72, eyeOverride = null;
  if (scene && !showcase) {
    const [x, z] = scene.pos;
    player.pos = [x + 0.5, surfaceY(x, z), z + 0.5];
    const sd = sunDirAt(state.time);
    player.yaw = scene.faceSun !== undefined ? Math.atan2(sd[0], -sd[2]) + scene.faceSun : scene.yaw;
    player.pitch = scene.pitch; fov = scene.fov;
    if (shot) eyeOverride = [x + 0.5, surfaceY(x, z) + scene.eyeH, z + 0.5];
  } else if (!showcase) player.pos = [8.5, surfaceY(8, 8) + 0.01, 8.5];
  if (params.get('cam')) { const c = params.get('cam').split(',').map(Number); eyeOverride = [c[0], c[1], c[2]]; player.yaw = c[3] || 0; player.pitch = c[4] || 0; }
  if (params.get('fov')) fov = +params.get('fov');
  if (params.get('dist')) { settings.dist = +params.get('dist'); q = settings.effective(); }
  if (shot || showcase) { $('hud').style.display = 'none'; }
  if (showcase) {
    for (const s of SHOWCASE) { const el = document.createElement('span'); el.textContent = BLOCKS[s.b].name; s.el = el; $('labels').appendChild(el); }
  }

  const cam = { pos: [0, 0, 0], fwd: [0, 0, -1], view: mat4(), proj: mat4(), viewProj: mat4(), invViewProj: mat4(), near: 0.1, far: 1500 };
  let last = performance.now(), clock = shot ? 20 : 0, fpsAcc = 0, fpsN = 0, fps = 60, slowT = 0, cooldown = 4, stable = 0;
  window.__status = { ready: false };
  window.__game = { player, world, settings, act, state }; // für Tests/Debugging

  let shotDone = 0;
  function frame(now) {
    // Screenshot-Modus: nach dem Laden nur noch selten neu zeichnen, damit die Aufnahme nicht blockiert
    if (shot && window.__status.ready && ++shotDone > 3) setTimeout(() => requestAnimationFrame(frame), 4000); else requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!shot) clock += dt;
    if (state.timeRunning && !state.menuOpen) state.time = (state.time + dt * 24 / 1200) % 24;
    player.yaw += input.lookX; player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - input.lookY)); input.lookX = input.lookY = 0;
    if (!shot && !showcase && !state.menuOpen) player.update(dt, input, world);
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
      const vfov = fov * Math.PI / 180 * (aspect < 1 ? 1.15 : 1);
      perspective(cam.proj, vfov, aspect, cam.near, cam.far);
      world.update(cam.pos[0], cam.pos[2], q.dist);
    }
    mul(cam.viewProj, cam.proj, cam.view); invert(cam.invViewProj, cam.viewProj);
    const env = computeEnv(state.time, q.dist * CS - 10, envOpts);
    renderer.render({ cam, env, chunks: world.list, time: clock, showcase, still: shot });
    $('underwater').style.display = player.headInWater && !shot ? 'block' : 'none';
    if (showcase) for (const s of SHOWCASE) {
      const p = transform(cam.viewProj, s.x + 0.5, s.y - 0.55, s.z + 0.5);
      s.el.style.left = (p[0] * 0.5 + 0.5) * innerWidth + 'px'; s.el.style.top = (0.5 - p[1] * 0.5) * innerHeight + 'px';
    }
    // Ladeanzeige + Bereitschaft für Screenshots
    const loading = world.missing > 0;
    $('loading').style.display = loading && (world.missing > 8 || shot) && !shot ? 'block' : 'none';
    stable = loading ? 0 : stable + 1;
    window.__status.ready = stable > 12;
    // FPS + Auto-Qualität
    fpsAcc += dt; fpsN++;
    if (fpsAcc >= 0.5) {
      fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0;
      $('info').textContent = `${fps.toFixed(0)} FPS · ${PRESET_NAMES[settings.preset]}${settings.auto && settings.autoStep ? ' (Auto −' + settings.autoStep + ')' : ''} · ${canvas.width}×${canvas.height}`;
      cooldown -= 0.5;
      if (settings.auto && !loading && !state.menuOpen && cooldown <= 0 && document.visibilityState === 'visible') {
        slowT = fps < 40 ? slowT + 0.5 : 0;
        if (slowT >= 2 && settings.autoStep < AUTO_STEPS.length) {
          // nächsten wirksamen Schritt suchen (z. B. SSR überspringen, wenn ohnehin aus)
          let before = JSON.stringify(settings.effective());
          do { settings.autoStep++; } while (settings.autoStep < AUTO_STEPS.length && JSON.stringify(settings.effective()) === before);
          toast('Auto-Qualität: ' + AUTO_STEPS[settings.autoStep - 1][0]);
          slowT = 0; cooldown = 3; applySettings(false);
        }
      }
    }
  }
  requestAnimationFrame(frame);
  if (!scene && !shot) toggleMenu(true);
}
start().catch((e) => { console.error(e); $('loading').style.display = 'block'; $('loading').textContent = 'Fehler: ' + e.message; });
