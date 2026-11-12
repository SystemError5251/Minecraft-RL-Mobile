// HUD, Hotbar, Menü und Eingabe (Touch, Maus, Tastatur).
import { BLOCKS, HOTBAR, B } from './blocks.js';
import { PRESETS, PRESET_NAMES, TOGGLES, AUTO_STEPS } from './settings.js';
import { LAYERS } from './texlayers.js';
const $ = (id) => document.getElementById(id);

export function buildHotbar(texBuf, res, onSelect) {
  const bar = $('hotbar'), px = new Uint8Array(texBuf);
  bar.innerHTML = '';
  HOTBAR.forEach((b, i) => {
    const c = document.createElement('canvas'); c.width = c.height = res; c.title = BLOCKS[b].name;
    const img = new ImageData(res, res), off = BLOCKS[b].side * res * res * 4;
    for (let k = 0; k < res * res; k++) {
      const cut = b === B.LEAVES && px[off + k * 4 + 3] < 100;
      img.data[k * 4] = cut ? 12 : px[off + k * 4]; img.data[k * 4 + 1] = cut ? 30 : px[off + k * 4 + 1]; img.data[k * 4 + 2] = cut ? 10 : px[off + k * 4 + 2]; img.data[k * 4 + 3] = 255;
    }
    c.getContext('2d').putImageData(img, 0, 0);
    c.addEventListener('pointerdown', (e) => { e.stopPropagation(); onSelect(i); });
    bar.appendChild(c);
  });
}
export function selectSlot(i) { [...$('hotbar').children].forEach((c, k) => c.classList.toggle('sel', k === i)); $('hotbar').children[i]?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
let toastT = 0;
export function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }

export function buildMenu(state, settings, apply) {
  const m = $('menu'), q = settings.effective(true), qa = settings.effective();
  const autoOff = settings.auto ? AUTO_STEPS.slice(0, settings.autoStep).map((s) => s[0]).join(', ') : '';
  m.innerHTML = `<div class="panel">
    <h1>Kantenhain</h1><p>Voxel-Welt mit prozeduralen Texturen. Links laufen, rechts Setzen, Abbauen und Springen, sonst überall wischen zum Umsehen.</p>
    <h2>Grafikqualität</h2>
    <div class="seg">${Object.keys(PRESETS).map((p) => `<button data-preset="${p}" class="${p === settings.preset ? 'on' : ''}">${PRESET_NAMES[p]}</button>`).join('')}</div>
    <label class="row"><span>Auto-Qualität<small>${autoOff ? 'Reduziert: ' + autoOff : 'Schaltet bei Rucklern die teuersten Effekte zuerst ab'}</small></span><input type="checkbox" id="mAuto" ${settings.auto ? 'checked' : ''}></label>
    <h2>Effekte</h2>
    <div class="grid2">${TOGGLES.map(([k, label]) => `<label class="row"><span>${label}</span><input type="checkbox" data-toggle="${k}" ${q[k] ? 'checked' : ''}></label>`).join('')}</div>
    <h2>Welt</h2>
    <label class="row"><span>Sichtweite<small>${qa.dist} Chunks</small></span><input type="range" id="mDist" min="4" max="14" value="${q.dist}"></label>
    <label class="row"><span>Tageszeit<small>${String(Math.floor(state.time)).padStart(2, '0')}:${String(Math.floor(state.time % 1 * 60)).padStart(2, '0')} Uhr</small></span><input type="range" id="mTime" min="0" max="24" step="0.05" value="${state.time}"></label>
    <label class="row"><span>Zeit läuft</span><input type="checkbox" id="mRun" ${state.timeRunning ? 'checked' : ''}></label>
    <button class="wide" id="mClose">Weiterspielen</button>
  </div>`;
  m.querySelectorAll('[data-preset]').forEach((b) => b.onclick = () => { settings.setPreset(b.dataset.preset); apply(true); });
  m.querySelectorAll('[data-toggle]').forEach((b) => b.onchange = () => { settings.toggle(b.dataset.toggle); apply(true); });
  $('mAuto').onchange = (e) => { settings.auto = e.target.checked; settings.autoStep = 0; settings.save(); apply(true); };
  $('mDist').onchange = (e) => { settings.dist = +e.target.value; settings.save(); apply(true); };
  $('mTime').oninput = (e) => { state.time = +e.target.value % 24; e.target.previousElementSibling.querySelector('small').textContent = `${String(Math.floor(state.time)).padStart(2, '0')}:${String(Math.floor(state.time % 1 * 60)).padStart(2, '0')} Uhr`; };
  $('mRun').onchange = (e) => { state.timeRunning = e.target.checked; };
  $('mClose').onclick = () => state.closeMenu();
}

export class Input {
  constructor(canvas, cb) {
    this.mx = 0; this.mz = 0; this.jump = false; this.sprint = false; this.autoJump = false; this.lookX = 0; this.lookY = 0;
    const keys = new Set(), stick = $('stick'), knob = $('knob');
    const upd = () => {
      this.mx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0); this.mz = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const l = Math.hypot(this.mx, this.mz); if (l > 1) { this.mx /= l; this.mz /= l; }
      this.jump = keys.has('Space'); this.sprint = keys.has('ShiftLeft');
    };
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyM') cb.menu();
      if (/^Digit[1-9]$/.test(e.code)) cb.slot(+e.code[5] - 1);
      keys.add(e.code); upd();
    });
    addEventListener('keyup', (e) => { keys.delete(e.code); upd(); });
    addEventListener('blur', () => { keys.clear(); upd(); });
    addEventListener('wheel', (e) => cb.slotDelta(Math.sign(e.deltaY)), { passive: true });
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { this.lookX += e.movementX * 0.0024; this.lookY += e.movementY * 0.0024; } });
    canvas.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; }
      if (e.button === 0) cb.breakBlock(); else if (e.button === 2) cb.placeBlock();
    });
    // Touch (Hochformat, daumenfreundlich): Joystick links unten, Tasten rechts unten, überall sonst umsehen
    let joy = null, look = null;
    const rest = () => { // Ruheposition des Joysticks über der Blockleiste
      if (joy) return;
      const hb = $('hotbar').getBoundingClientRect();
      stick.style.left = '96px'; stick.style.top = (hb.top || innerHeight - 80) - 96 + 'px'; knob.style.transform = '';
    };
    const touchMode = () => { if (!document.body.classList.contains('touch')) { document.body.classList.add('touch'); this.autoJump = true; rest(); } };
    if (matchMedia('(pointer: coarse)').matches) setTimeout(touchMode, 0);
    addEventListener('resize', rest);
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      touchMode();
      canvas.setPointerCapture(e.pointerId);
      if (!joy && e.clientX < innerWidth * 0.5 && e.clientY > innerHeight * 0.55) {
        joy = { id: e.pointerId, x: e.clientX, y: e.clientY };
        stick.style.left = e.clientX + 'px'; stick.style.top = e.clientY + 'px'; stick.classList.add('on');
      } else if (!look) look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (joy && e.pointerId === joy.id) {
        let dx = (e.clientX - joy.x) / 56, dy = (e.clientY - joy.y) / 56; const l = Math.hypot(dx, dy);
        if (l > 1) { dx /= l; dy /= l; }
        this.mx = dx; this.mz = -dy; this.sprint = l > 1.6;
        knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
      } else if (look && e.pointerId === look.id) {
        this.lookX += (e.clientX - look.x) * 0.0058; this.lookY += (e.clientY - look.y) * 0.0058;
        look.x = e.clientX; look.y = e.clientY;
      }
    });
    const end = (e) => {
      if (joy && e.pointerId === joy.id) { joy = null; this.mx = this.mz = 0; this.sprint = false; stick.classList.remove('on'); rest(); }
      else if (look && e.pointerId === look.id) look = null;
    };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    // Aktionstasten: gedrückt halten wiederholt (Abbauen/Setzen)
    const hold = (id, down, up, repeat) => {
      const el = $(id); let t = 0;
      const stop = () => { clearInterval(t); t = 0; el.classList.remove('down'); up?.(); };
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); touchMode(); el.setPointerCapture(e.pointerId); el.classList.add('down'); down(); if (repeat) t = setInterval(down, repeat); });
      el.addEventListener('pointerup', stop); el.addEventListener('pointercancel', stop);
    };
    hold('jumpBtn', () => { this.jump = true; }, () => { this.jumpRelease = true; }); // wird erst nach dem nächsten Physikschritt gelöst – kurzes Antippen zählt auch
    hold('breakBtn', () => cb.breakBlock(), null, 260);
    hold('placeBtn', () => cb.placeBlock(), null, 260);
    $('menuBtn').addEventListener('click', () => cb.menu());
  }
}
export { LAYERS };
