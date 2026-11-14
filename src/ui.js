// Oberfläche fürs Querformat: HUD, Hotbar, Inventar (Crafting, Ofen, Kreativ-Palette), Menüs und Eingabe.
import { ITEMS, CATEGORIES, iconURL, matchRecipe, SMELT_TICKS } from './items.js';
import { mk } from './inventory.js';
import { PRESETS, PRESET_NAMES, TOGGLES, AUTO_STEPS } from './settings.js';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MODE_NAMES = { survival: 'Survival', creative: 'Kreativ' };

function slotHTML(s, ref, cls = '') {
  let h = `<div class="slot ${cls}" data-ref="${ref}"${s ? ` title="${esc(ITEMS[s.id].name)}"` : ''}>`;
  if (s) {
    const it = ITEMS[s.id];
    h += `<img src="${iconURL(s.id)}" alt="">`;
    if (s.n > 1) h += `<b>${s.n}</b>`;
    if (it.tool && s.d < it.tool.dur) h += `<i style="--d:${Math.round(s.d / it.tool.dur * 100)}%"></i>`;
  }
  return h + '</div>';
}
// Herzen, Keulen und Luftblasen: selbst gezeichnete Symbole, je 10 Stück mit halben Schritten
function drawBar(cv, value, kind, rtl) {
  const g = cv.getContext('2d'), S = 40;
  g.clearRect(0, 0, 400, 40);
  for (let i = 0; i < 10; i++) {
    const v = Math.max(0, Math.min(2, value - i * 2)), x = (rtl ? 9 - i : i) * S;
    if (kind === 'air' && v <= 0) continue;
    const shape = () => {
      g.beginPath();
      if (kind === 'heart') { g.moveTo(x + 20, 35); g.bezierCurveTo(x - 4, 18, x + 6, 2, x + 20, 13); g.bezierCurveTo(x + 34, 2, x + 44, 18, x + 20, 35); }
      else if (kind === 'food') { g.ellipse(x + 17, 16, 13, 10.5, Math.PI / 4, 0, 7); g.moveTo(x + 26, 25); g.lineTo(x + 34, 33); g.arc(x + 34, 33, 3.6, 0, 7); }
      else g.arc(x + 20, 20, 11, 0, 7);
    };
    g.lineWidth = 3.5; g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,0,0,.75)';
    shape(); g.stroke();
    g.fillStyle = kind === 'air' ? 'rgba(140,215,255,.35)' : 'rgba(20,22,28,.85)'; g.fill();
    if (v > 0 && kind !== 'air') {
      g.save(); g.beginPath();
      if (v >= 2) g.rect(x, 0, S, S); else if (rtl) g.rect(x + 20, 0, 20, S); else g.rect(x, 0, 20, S);
      g.clip(); shape(); g.fillStyle = kind === 'heart' ? '#e5363b' : '#c9803a'; g.fill(); g.restore();
    }
    if (kind === 'air') { g.strokeStyle = 'rgba(190,235,255,.95)'; g.lineWidth = 2.5; shape(); g.stroke(); }
  }
}

export class UI {
  constructor() { this.game = null; this.invOpen = false; this.held = null; this.single = false; this.cat = 'Alle'; this.search = ''; this.cache = {}; this.toastT = 0; }
  toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(this.toastT); this.toastT = setTimeout(() => t.classList.remove('on'), 2400); }

  // ---- HUD ----
  updateHud(game) {
    const c = this.cache, surv = game.mode === 'survival';
    if (c.mode !== game.mode) { c.mode = game.mode; document.body.classList.toggle('survival', surv); }
    const fly = game.mode === 'creative' && game.player.flying;
    if (c.fly !== fly) { c.fly = fly; document.body.classList.toggle('fly', fly); } // Flug-Taste nur im Kreativmodus
    if (surv) {
      if (c.hp !== game.health) { c.hp = game.health; drawBar($('hearts'), game.health, 'heart', false); }
      if (c.food !== game.hunger) { c.food = game.hunger; drawBar($('food'), game.hunger, 'food', true); }
      const air = game.air >= 10 ? -1 : Math.ceil(game.air * 2);
      if (c.air !== air) { c.air = air; $('air').style.visibility = air < 0 ? 'hidden' : 'visible'; if (air >= 0) drawBar($('air'), air, 'air', true); }
    }
    if (game.invChanged || c.slot !== game.slot) {
      game.invChanged = false; c.slot = game.slot;
      $('hotbar').innerHTML = game.inv.slots.slice(0, 9).map((s, i) => slotHTML(s, i, i === game.slot ? 'sel' : '')).join('');
      if (this.invOpen) this.renderInv();
    }
    const p = game.breaking ? Math.min(100, game.breaking.p * 100) : 0, ring = $('ring');
    if (c.ring !== p) { c.ring = p; ring.classList.toggle('on', p > 0); ring.firstChild.style.transform = `scaleX(${(p / 100).toFixed(3)})`; }
    const hf = game.hurtFlash > 0 ? 1 : 0;
    if (c.hf !== hf) { c.hf = hf; $('hurt').style.opacity = hf; }
  }
  showDeath() { $('death').hidden = false; document.exitPointerLock?.(); }

  // ---- Inventar: Tippen nimmt/legt Stapel; „Einzeln“ (oder Rechtsklick) legt ein Item ab bzw. teilt den Stapel ----
  openInventory(kind = 'inv', arg = null) {
    const g = this.game;
    this.kind = g.mode === 'creative' && kind === 'inv' ? 'palette' : kind;
    this.furnace = arg; this.craft = new Array(kind === 'bench' ? 9 : 4).fill(null);
    this.invOpen = true; $('inv').hidden = false; document.exitPointerLock?.();
    this.renderInv();
    clearInterval(this.furnT);
    if (kind === 'furnace') this.furnT = setInterval(() => this.renderInv(), 250);
  }
  closeInventory() {
    if (!this.invOpen) return;
    const g = this.game, back = [...(this.craft || []), this.held];
    for (const s of back) if (s) { const left = g.inv.add(s.id, s.n, s.d); if (left > 0) g.spawnDrop(s.id, left, s.d, g.player.pos[0], g.player.pos[1] + 1, g.player.pos[2]); }
    this.craft = null; this.held = null; this.invOpen = false; $('inv').hidden = true; clearInterval(this.furnT); g.invChanged = true;
  }
  get(ref) { const [k, i] = ref.split(':'); return k === 'inv' ? this.game.inv.slots[i] : k === 'craft' ? this.craft[i] : this.furnace[k]; }
  set(ref, v) { const [k, i] = ref.split(':'); if (k === 'inv') this.game.inv.slots[i] = v; else if (k === 'craft') this.craft[i] = v; else this.furnace[k] = v; }
  recipe() { const n = this.craft.length === 9 ? 3 : 2; return matchRecipe(this.craft.map((s) => (s ? s.id : 0)), n); }
  clickSlot(ref, single) {
    const g = this.game;
    if (ref.startsWith('pal:')) { // Kreativ: Item direkt in den gewählten Hotbar-Slot
      const id = +ref.slice(4); g.inv.slots[g.slot] = mk(id, ITEMS[id].stack); g.invChanged = true; this.toast(ITEMS[id].name); return;
    }
    if (ref.startsWith('hot:')) { g.slot = +ref.slice(4); g.invChanged = true; return; }
    let h = this.held;
    if (ref === 'result') {
      const r = this.recipe(); if (!r) return;
      if (h && (h.id !== r.out || h.n + r.n > ITEMS[r.out].stack)) return;
      if (h) h.n += r.n; else h = mk(r.out, r.n);
      this.craft.forEach((s, i) => { if (s && --s.n <= 0) this.craft[i] = null; });
    } else {
      const s = this.get(ref), max = (x) => ITEMS[x.id].stack, outOnly = ref === 'out';
      if (!h) { if (s) { if (single && s.n > 1) { const k = Math.ceil(s.n / 2); h = { ...s, n: k }; s.n -= k; } else { h = s; this.set(ref, null); } } }
      else if (outOnly) { if (s && s.id === h.id && h.n + s.n <= max(h)) { h.n += s.n; this.set(ref, null); } }
      else if (!s) { if (single && h.n > 1) { this.set(ref, { ...h, n: 1 }); h.n--; } else { this.set(ref, h); h = null; } }
      else if (s.id === h.id && max(s) > 1) { const k = Math.min(single ? 1 : h.n, max(s) - s.n); s.n += k; h.n -= k; if (h.n <= 0) h = null; }
      else { this.set(ref, h); h = s; }
    }
    this.held = h; g.invChanged = true; this.renderInv();
  }
  renderInv() {
    const g = this.game, el = $('inv');
    if (this.kind === 'palette') {
      const q = this.search.trim().toLowerCase();
      const items = Object.values(ITEMS).filter((it) => (this.cat === 'Alle' || it.cat === this.cat) && (!q || it.name.toLowerCase().includes(q)));
      if (!el.querySelector('.pal')) {
        el.innerHTML = `<div class="panel pal"><div class="invhead"><h1>Kreativ-Inventar</h1><span class="hand">Tippen legt das Item in den gewählten Slot</span><button class="btn" data-act="close">Schließen</button></div>
          <div class="chips"><input type="search" placeholder="Suchen …" value="${esc(this.search)}" aria-label="Items suchen">${CATEGORIES.map((c) => `<button data-cat="${c}">${c}</button>`).join('')}</div>
          <div class="palgrid"></div><div class="palrow"><div class="grid" style="--n:9"></div><button class="btn" data-act="clear">Slot leeren</button></div></div>`;
        el.querySelector('input').oninput = (e) => { this.search = e.target.value; this.renderInv(); };
      }
      el.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('on', b.dataset.cat === this.cat));
      el.querySelector('.palgrid').innerHTML = items.map((it) => slotHTML({ id: it.id, n: 1 }, 'pal:' + it.id)).join('') || '<div class="empty">Nichts gefunden</div>';
      el.querySelector('.palrow .grid').innerHTML = g.inv.slots.slice(0, 9).map((s, i) => slotHTML(s, 'hot:' + i, i === g.slot ? 'sel' : '')).join('');
      return;
    }
    let left = '', title = 'Inventar';
    if (this.kind === 'furnace') {
      const f = this.furnace; title = 'Ofen';
      left = `<h2>Schmelzen</h2><div class="furn">${slotHTML(f.in, 'in')}<div class="bar"><div style="width:${Math.round(f.cook / SMELT_TICKS * 100)}%"></div></div>${slotHTML(f.out, 'out')}
        ${slotHTML(f.fuel, 'fuel')}<div class="bar fire"><div style="width:${f.burn > 0 ? Math.round(f.burn / f.burnMax * 100) : 0}%"></div></div><span></span></div><p style="margin-top:8px">Oben Erz oder Fleisch,<br>unten Brennstoff.</p>`;
    } else {
      const n = this.craft.length === 9 ? 3 : 2, r = this.recipe();
      if (n === 3) title = 'Werkbank';
      left = `<h2>Herstellen</h2><div class="craft"><div class="grid" style="--n:${n}">${this.craft.map((s, i) => slotHTML(s, 'craft:' + i)).join('')}</div><span class="arrow">→</span>${slotHTML(r ? { id: r.out, n: r.n } : null, 'result', r ? 'sel' : '')}</div>`;
    }
    const inv = g.inv.slots;
    el.innerHTML = `<div class="panel"><div class="invhead"><h1>${title}</h1><span class="hand">In der Hand ${slotHTML(this.held, 'none')}</span>
      <button class="btn ${this.single ? 'on' : ''}" data-act="single">Einzeln</button><button class="btn" data-act="close">Schließen</button></div>
      <div class="invcols"><div>${left}</div><div><h2>Rucksack</h2><div class="grid" style="--n:9">${inv.slice(9, 36).map((s, i) => slotHTML(s, 'inv:' + (i + 9))).join('')}</div>
      <div class="gap"></div><div class="grid" style="--n:9">${inv.slice(0, 9).map((s, i) => slotHTML(s, 'inv:' + i, i === g.slot ? 'sel' : '')).join('')}</div></div></div></div>`;
  }
  bindInventory() {
    const el = $('inv');
    const handle = (e, single) => {
      const a = e.target.closest('[data-act]'), s = e.target.closest('[data-ref]'), c = e.target.closest('[data-cat]');
      if (a) {
        if (a.dataset.act === 'close') this.closeInventory();
        else if (a.dataset.act === 'single') { this.single = !this.single; this.renderInv(); }
        else if (a.dataset.act === 'clear') { this.game.inv.slots[this.game.slot] = null; this.game.invChanged = true; }
      } else if (c) { this.cat = c.dataset.cat; this.renderInv(); }
      else if (s && s.dataset.ref !== 'none') this.clickSlot(s.dataset.ref, single || this.single);
      else if (e.target === el) this.closeInventory();
    };
    el.addEventListener('click', (e) => handle(e, false));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); handle(e, true); });
  }

  // ---- Startbildschirm: Welt wählen oder neu erstellen (mit Spielmodus) ----
  showTitle(worlds, persistent, cb) {
    const el = $('title'); let mode = 'survival';
    const fmt = (t) => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const draw = () => {
      el.innerHTML = `<div class="panel"><h1>Kantenhain</h1><p>Voxel-Welt zum Bauen und Überleben.${persistent ? '' : ' Hinweis: Speichern ist in diesem Browser-Modus nicht möglich.'}</p>
        <div class="cols"><div><h2>Deine Welten</h2><div class="worlds">${worlds.map((w) => `<div class="world"><button class="btn" data-play="${esc(w.id)}">${esc(w.name)}<small>${MODE_NAMES[w.mode]} · zuletzt ${fmt(w.played)}</small></button><button class="btn danger" data-del="${esc(w.id)}" aria-label="Welt ${esc(w.name)} löschen">Löschen</button></div>`).join('') || '<div class="empty">Noch keine Welt – erstelle rechts deine erste.</div>'}</div></div>
        <div><h2>Neue Welt</h2><div class="fields"><label class="field">Name<input id="wName" maxlength="30" value="Neue Welt"></label><label class="field">Seed (optional)<input id="wSeed" inputmode="numeric" placeholder="zufällig"></label></div>
        <div class="seg">${Object.keys(MODE_NAMES).map((m) => `<button data-mode="${m}" class="${m === mode ? 'on' : ''}">${MODE_NAMES[m]}</button>`).join('')}</div>
        <button class="wide" id="wCreate">Welt erstellen</button></div></div></div>`;
    };
    draw(); el.hidden = false;
    el.onclick = (e) => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.mode) { const n = $('wName').value, s = $('wSeed').value; mode = t.dataset.mode; draw(); $('wName').value = n; $('wSeed').value = s; }
      else if (t.dataset.play) { el.hidden = true; cb.play(t.dataset.play); }
      else if (t.dataset.del) { if (t.dataset.sure) cb.del(t.dataset.del).then((w) => { worlds = w; draw(); }); else { t.dataset.sure = 1; t.textContent = 'Wirklich?'; } }
      else if (t.id === 'wCreate') { el.hidden = true; cb.create({ name: $('wName').value.trim() || 'Neue Welt', seed: $('wSeed').value.trim(), mode }); }
    };
  }

  // ---- Pausenmenü ----
  buildMenu(game, settings, cb) {
    const m = $('menu'), q = settings.effective(true), qa = settings.effective();
    const autoOff = settings.auto ? AUTO_STEPS.slice(0, settings.autoStep).map((s) => s[0]).join(', ') : '';
    const clock = () => `${String(Math.floor(game.time)).padStart(2, '0')}:${String(Math.floor(game.time % 1 * 60)).padStart(2, '0')} Uhr`;
    m.innerHTML = `<div class="panel"><div class="invhead"><h1>Pause – ${esc(game.rec.name)}</h1><button class="btn" id="mClose">Weiterspielen</button></div>
      <div class="cols"><div>
        <h2>Spielmodus</h2><div class="seg">${Object.keys(MODE_NAMES).map((k) => `<button data-gm="${k}" class="${k === game.mode ? 'on' : ''}">${MODE_NAMES[k]}</button>`).join('')}</div>
        ${game.mode === 'creative' ? `<label class="row"><span>Tageszeit<small id="mClock">${clock()}</small></span><input type="range" id="mTime" min="0" max="24" step="0.05" value="${game.time}"></label>
        <label class="row"><span>Zeit läuft</span><input type="checkbox" id="mRun" ${game.timeRunning ? 'checked' : ''}></label>` : `<div class="row"><span>Tageszeit<small>${clock()} – im Kreativmodus frei einstellbar</small></span></div>`}
        <h2>Grafikqualität</h2><div class="seg">${Object.keys(PRESETS).map((p) => `<button data-preset="${p}" class="${p === settings.preset ? 'on' : ''}">${PRESET_NAMES[p]}</button>`).join('')}</div>
        <label class="row"><span>Auto-Qualität<small>${autoOff ? 'Reduziert: ' + autoOff : 'Schaltet bei Rucklern teure Effekte ab'}</small></span><input type="checkbox" id="mAuto" ${settings.auto ? 'checked' : ''}></label>
        <label class="row"><span>Sichtweite<small>${qa.dist} Chunks</small></span><input type="range" id="mDist" min="4" max="14" value="${q.dist}"></label>
        <button class="wide ghost" id="mQuit">Speichern und zum Hauptmenü</button>
      </div><div><h2>Effekte</h2>${TOGGLES.map(([k, label]) => `<label class="row"><span>${label}</span><input type="checkbox" data-toggle="${k}" ${q[k] ? 'checked' : ''}></label>`).join('')}</div></div></div>`;
    m.querySelectorAll('[data-gm]').forEach((b) => b.onclick = () => { game.setMode(b.dataset.gm); cb.rebuild(); });
    m.querySelectorAll('[data-preset]').forEach((b) => b.onclick = () => { settings.setPreset(b.dataset.preset); cb.apply(); });
    m.querySelectorAll('[data-toggle]').forEach((b) => b.onchange = () => { settings.toggle(b.dataset.toggle); cb.apply(); });
    $('mAuto').onchange = (e) => { settings.auto = e.target.checked; settings.autoStep = 0; settings.save(); cb.apply(); };
    $('mDist').onchange = (e) => { settings.dist = +e.target.value; settings.save(); cb.apply(); };
    if ($('mTime')) { $('mTime').oninput = (e) => { game.time = +e.target.value % 24; $('mClock').textContent = clock(); }; $('mRun').onchange = (e) => { game.timeRunning = e.target.checked; }; }
    $('mClose').onclick = cb.close; $('mQuit').onclick = cb.quit;
  }
}

// ---- Eingabe: Touch (Joystick links, Tasten rechts, sonst umsehen), Maus und Tastatur ----
export class Input {
  constructor(canvas, cb) {
    Object.assign(this, { mx: 0, mz: 0, jump: false, crouch: false, sprint: false, autoJump: false, lookX: 0, lookY: 0, breaking: false, useHeld: false, usePressed: false, flyToggle: false, jumpRelease: false });
    const keys = new Set(), stick = $('stick'), knob = $('knob');
    let lastJump = 0;
    const jumpDown = () => { const t = performance.now(); if (t - lastJump < 320) { this.flyToggle = true; lastJump = 0; } else lastJump = t; this.jump = true; this.jumpRelease = false; }; // Doppeltipp = Fliegen an/aus
    const upd = () => {
      this.mx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0); this.mz = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const l = Math.hypot(this.mx, this.mz); if (l > 1) { this.mx /= l; this.mz /= l; }
      this.sprint = keys.has('ControlLeft'); this.crouch = keys.has('ShiftLeft');
    };
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Escape' || e.code === 'KeyM') cb.menu();
      if (e.code === 'KeyE') cb.inventory();
      if (/^Digit[1-9]$/.test(e.code)) cb.slot(+e.code[5] - 1);
      if (e.code === 'Space' && !e.repeat) jumpDown();
      keys.add(e.code); upd();
    });
    addEventListener('keyup', (e) => { keys.delete(e.code); if (e.code === 'Space') this.jump = false; upd(); });
    addEventListener('blur', () => { keys.clear(); upd(); this.jump = this.breaking = this.useHeld = false; });
    addEventListener('wheel', (e) => { if (!e.target.closest('.overlay')) cb.slotDelta(Math.sign(e.deltaY)); }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { this.lookX += e.movementX * 0.0024; this.lookY += e.movementY * 0.0024; } });
    canvas.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; }
      if (e.button === 0) { this.breaking = true; this.breakPressed = true; } else if (e.button === 2) { this.useHeld = true; this.usePressed = true; }
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.breaking = false; else if (e.button === 2) this.useHeld = false; });

    let joy = null, look = null;
    const rest = () => { if (!joy) { stick.style.left = 'calc(env(safe-area-inset-left, 0px) + 104px)'; stick.style.top = innerHeight - 104 + 'px'; knob.style.transform = ''; } };
    const touchMode = () => { if (!document.body.classList.contains('touch')) { document.body.classList.add('touch'); this.autoJump = true; rest(); } };
    if (matchMedia('(pointer: coarse)').matches) setTimeout(touchMode, 0);
    addEventListener('resize', rest);
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      touchMode();
      canvas.setPointerCapture(e.pointerId);
      if (!joy && e.clientX < innerWidth * 0.4 && e.clientY > innerHeight * 0.3) {
        joy = { id: e.pointerId, x: e.clientX, y: e.clientY };
        stick.style.left = e.clientX + 'px'; stick.style.top = e.clientY + 'px'; stick.classList.add('on');
      } else if (!look) look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (joy && e.pointerId === joy.id) {
        let dx = (e.clientX - joy.x) / 54, dy = (e.clientY - joy.y) / 54; const l = Math.hypot(dx, dy);
        if (l > 1) { dx /= l; dy /= l; }
        this.mx = dx; this.mz = -dy; this.sprint = l > 1.6;
        knob.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
      } else if (look && e.pointerId === look.id) {
        this.lookX += (e.clientX - look.x) * 0.0052; this.lookY += (e.clientY - look.y) * 0.0052;
        look.x = e.clientX; look.y = e.clientY;
      }
    });
    const end = (e) => {
      if (joy && e.pointerId === joy.id) { joy = null; this.mx = this.mz = 0; this.sprint = false; stick.classList.remove('on'); rest(); }
      else if (look && e.pointerId === look.id) look = null;
    };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    const hold = (id, down, up) => {
      const el = $(id), stop = () => { el.classList.remove('down'); up(); };
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); touchMode(); try { el.setPointerCapture(e.pointerId); } catch { /* ohne Capture weiter */ } el.classList.add('down'); down(); });
      el.addEventListener('pointerup', stop); el.addEventListener('pointercancel', stop);
    };
    hold('jumpBtn', jumpDown, () => { this.jumpRelease = true; }); // wird erst nach dem nächsten Physikschritt gelöst – kurzes Antippen zählt auch
    hold('duckBtn', () => { this.crouch = true; }, () => { this.crouch = false; });
    hold('breakBtn', () => { this.breaking = true; this.breakPressed = true; }, () => { this.breaking = false; });
    hold('placeBtn', () => { this.useHeld = true; this.usePressed = true; }, () => { this.useHeld = false; });
    $('menuBtn').addEventListener('click', () => cb.menu());
    $('invBtn').addEventListener('click', () => cb.inventory());
    $('hotbar').addEventListener('pointerdown', (e) => { const s = e.target.closest('[data-ref]'); if (s) { e.stopPropagation(); cb.slot(+s.dataset.ref); } });
  }
}
