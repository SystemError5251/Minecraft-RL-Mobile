// Oberfläche fürs Querformat: HUD, Hotbar, Inventar (Crafting, Ofen, Kreativ-Palette), Menüs und Eingabe.
import { ITEMS, CATEGORIES, iconURL, matchRecipe, SMELT_TICKS } from './items.js';
import { mk } from './inventory.js';
import { PRESETS, PRESET_NAMES, TOGGLES, AUTO_STEPS } from './settings.js';
import { SKINS } from './entities.js';
import { C, Writer } from './protocol.js';
import { drawQR } from './qr.js';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MODE_NAMES = { survival: 'Survival', creative: 'Kreativ', spectator: 'Zuschauer' };
const xpLevel = (xp) => Math.floor((Math.sqrt(1 + 0.8 * xp) - 1) / 2), xpForLevel = (l) => 5 * l * (l + 1);
export function loadProfile() { try { return { name: 'Spieler', skin: 0, sig: '', ...JSON.parse(localStorage.getItem('profile') || '{}') }; } catch { return { name: 'Spieler', skin: 0, sig: '' }; } }
const saveProfile = (p) => { try { localStorage.setItem('profile', JSON.stringify(p)); } catch { /* egal */ } };

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
  constructor() { Object.assign(this, { game: null, invOpen: false, chatOpen: false, debug: false, single: false, cat: 'Alle', search: '', cache: {}, toastT: 0, hist: [], histI: 0, tabs: null, tabI: 0, kind: 0 }); }
  toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(this.toastT); this.toastT = setTimeout(() => t.classList.remove('on'), 2400); }

  // ---- HUD ----
  updateHud(game) {
    const c = this.cache, surv = game.modeN === 0;
    if (c.mode !== game.modeN) { c.mode = game.modeN; document.body.classList.toggle('survival', surv); document.body.classList.toggle('spectator', game.modeN === 2); }
    const fly = game.modeN !== 0 && game.player.flying;
    if (c.fly !== fly) { c.fly = fly; document.body.classList.toggle('fly', fly); } // Flug-Taste nur in Kreativ/Zuschauer
    if (surv) {
      if (c.hp !== game.health) { c.hp = game.health; drawBar($('hearts'), game.health, 'heart', false); }
      if (c.food !== game.hunger) { c.food = game.hunger; drawBar($('food'), game.hunger, 'food', true); }
      const air = game.air >= 10 ? -1 : Math.ceil(game.air * 2);
      if (c.air !== air) { c.air = air; $('air').style.visibility = air < 0 ? 'hidden' : 'visible'; if (air >= 0) drawBar($('air'), air, 'air', true); }
      if (c.xp !== game.xp) { c.xp = game.xp; const l = xpLevel(game.xp); $('xpfill').style.width = Math.round((game.xp - xpForLevel(l)) / (xpForLevel(l + 1) - xpForLevel(l)) * 100) + '%'; $('xplevel').textContent = l || ''; }
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
    const fl = game.flash > 0 ? 1 : 0;
    if (c.fl !== fl) { c.fl = fl; $('flash').style.opacity = fl * 0.55; }
  }
  showDeath() { this.hideInventory(); $('death').hidden = false; document.exitPointerLock?.(); }
  disconnected(msg) { $('discMsg').textContent = msg; $('disc').hidden = false; document.exitPointerLock?.(); }

  // ---- Chat: Verlauf (Pfeiltasten / ↑), Tab-Vervollständigung, Befehle mit "/" ----
  chatLine(text, color = 0) {
    const log = $('chatlog'), el = document.createElement('div');
    el.className = 'c' + color; el.textContent = text; log.appendChild(el);
    while (log.children.length > 60) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    setTimeout(() => el.classList.add('old'), 9000);
  }
  openChat(prefix = '') {
    if (!this.game || this.invOpen) return;
    this.chatOpen = true; document.body.classList.add('chat'); document.exitPointerLock?.();
    const i = $('chatin'); i.value = prefix; this.histI = this.hist.length; this.tabs = null;
    setTimeout(() => { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 0);
  }
  closeChat() { this.chatOpen = false; document.body.classList.remove('chat'); $('chatin').blur(); }
  tabResult(list) { this.tabs = list; this.tabI = 0; if (list.length) { $('chatin').value = list[0]; if (list.length > 1) this.chatLine(list.map((l) => l.split(' ').pop()).join('  '), 3); } }
  bindChat() {
    const i = $('chatin');
    const sendLine = () => { const t = i.value.trim(); if (t) { this.game.chat(t); if (this.hist[this.hist.length - 1] !== t) this.hist.push(t); } this.closeChat(); };
    const tab = () => { if (this.tabs && this.tabs.length > 1 && this.tabs.includes(i.value)) { this.tabI = (this.tabI + 1) % this.tabs.length; i.value = this.tabs[this.tabI]; } else this.game.send(new Writer(C.TAB).str(i.value)); };
    const prev = (d) => { if (!this.hist.length) return; this.histI = Math.max(0, Math.min(this.hist.length, this.histI + d)); i.value = this.hist[this.histI] || ''; };
    i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendLine(); } else if (e.key === 'Escape') { e.preventDefault(); this.closeChat(); }
      else if (e.key === 'Tab') { e.preventDefault(); tab(); } else if (e.key === 'ArrowUp') { e.preventDefault(); prev(-1); } else if (e.key === 'ArrowDown') { e.preventDefault(); prev(1); }
      e.stopPropagation();
    });
    i.addEventListener('input', () => { this.tabs = null; });
    $('chatSend').onclick = sendLine; $('chatTab').onclick = () => { tab(); i.focus(); }; $('chatUp').onclick = () => { prev(-1); i.focus(); }; $('chatClose').onclick = () => this.closeChat();
    $('chatBtn').onclick = () => (this.chatOpen ? this.closeChat() : this.openChat());
  }

  // ---- Inventar (der Server verwaltet Hand-Stapel und Crafting-Raster; hier wird nur angezeigt und geklickt) ----
  // kind: 1 Inventar (2x2), 2 Werkbank (3x3), 3 Ofen, 'palette' Kreativ-Auswahl
  requestInventory() { const g = this.game; if (g.modeN === 2) return; if (g.modeN === 1) this.openInventory('palette'); else g.send(new Writer(C.OPEN_INV)); }
  openInventory(kind) { this.kind = kind; this.invOpen = true; $('inv').hidden = false; document.exitPointerLock?.(); this.closeChat(); this.renderInv(); }
  hideInventory() { this.invOpen = false; $('inv').hidden = true; }
  closeInventory() { if (!this.invOpen) return; if (this.kind !== 'palette') this.game.send(new Writer(C.CLOSE_INV)); this.hideInventory(); }
  clickSlot(ref, single) {
    const g = this.game;
    if (ref.startsWith('pal:')) { const id = +ref.slice(4); g.send(new Writer(C.PALETTE).u16(id)); this.toast(ITEMS[id].name); return; } // Kreativ: Item direkt in den gewählten Hotbar-Slot
    if (ref.startsWith('hot:')) { g.setSlot(+ref.slice(4)); return; }
    g.send(new Writer(C.INV_CLICK).str(ref).u8(single ? 1 : 0));
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
    if (this.kind === 3 && g.furnace) {
      const f = g.furnace; title = 'Ofen';
      left = `<h2>Schmelzen</h2><div class="furn">${slotHTML(f.in, 'in')}<div class="bar"><div style="width:${Math.round(f.cook / SMELT_TICKS * 100)}%"></div></div>${slotHTML(f.out, 'out')}
        ${slotHTML(f.fuel, 'fuel')}<div class="bar fire"><div style="width:${f.burn > 0 ? Math.round(f.burn / f.burnMax * 100) : 0}%"></div></div><span></span></div><p style="margin-top:8px">Oben Erz oder Fleisch,<br>unten Brennstoff.</p>`;
    } else {
      const n = g.craft.length === 9 ? 3 : 2, r = g.result;
      if (n === 3) title = 'Werkbank';
      left = `<h2>Herstellen</h2><div class="craft"><div class="grid" style="--n:${n}">${g.craft.map((s, i) => slotHTML(s, 'craft:' + i)).join('')}</div><span class="arrow">→</span>${slotHTML(r, 'result', r ? 'sel' : '')}</div>`;
    }
    const inv = g.inv.slots;
    el.innerHTML = `<div class="panel"><div class="invhead"><h1>${title}</h1><span class="hand">In der Hand ${slotHTML(g.cursor, 'none')}</span>
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
        else if (a.dataset.act === 'clear') this.game.send(new Writer(C.PALETTE).u16(0));
      } else if (c) { this.cat = c.dataset.cat; this.renderInv(); }
      else if (s && s.dataset.ref !== 'none') this.clickSlot(s.dataset.ref, single || this.single);
      else if (e.target === el) this.closeInventory();
    };
    el.addEventListener('click', (e) => handle(e, false));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); handle(e, true); });
  }

  // ---- Startbildschirm: eigene Welten, neue Welt (Modus, Cheats), Mitspielen per Raumcode oder Serveradresse ----
  showTitle(worlds, persistent, cb, prefill = {}) {
    const el = $('title'), prof = loadProfile(); let mode = 'survival', err = '';
    if (prefill.sig) prof.sig = prefill.sig;
    const fmt = (t) => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const keep = () => { const o = {}; el.querySelectorAll('input').forEach((i) => { o[i.id] = i.type === 'checkbox' ? i.checked : i.value; }); return o; };
    const draw = (vals) => {
      el.innerHTML = `<div class="panel"><h1>Kantenhain</h1><p>Voxel-Welt zum Bauen und Überleben – allein oder zu viert.${persistent ? '' : ' Hinweis: Speichern ist in diesem Browser-Modus nicht möglich.'}</p>
        <div class="cols"><div><h2>Deine Welten</h2><div class="worlds">${worlds.map((w) => `<div class="world"><button class="btn" data-play="${esc(w.id)}">${esc(w.name)}<small>${MODE_NAMES[w.mode] || w.mode}${w.cheats ? ' · Cheats' : ''} · zuletzt ${fmt(w.played)}</small></button><button class="btn danger" data-del="${esc(w.id)}" aria-label="Welt ${esc(w.name)} löschen">Löschen</button></div>`).join('') || '<div class="empty">Noch keine Welt – erstelle rechts deine erste.</div>'}</div>
        <h2>Spieler</h2><div class="fields"><label class="field">Name<input id="pName" maxlength="16" value="${esc(prof.name)}"></label><label class="field">Aussehen<span class="seg skins">${SKINS.map((k, i) => `<button data-skin="${i}" class="${i === prof.skin ? 'on' : ''}" title="${k.name}" style="--c:rgb(${k.c[0].map((v) => Math.round(v * 255)).join(',')})"></button>`).join('')}</span></label></div></div>
        <div><h2>Neue Welt</h2><div class="fields"><label class="field">Name<input id="wName" maxlength="30" value="Neue Welt"></label><label class="field">Seed (optional)<input id="wSeed" inputmode="numeric" placeholder="zufällig"></label></div>
        <div class="seg">${['survival', 'creative'].map((m) => `<button data-mode="${m}" class="${m === mode ? 'on' : ''}">${MODE_NAMES[m]}</button>`).join('')}</div>
        <label class="row"><span>Cheats erlauben<small>Befehle wie /give oder /tp</small></span><input type="checkbox" id="wCheats"></label>
        <button class="wide" id="wCreate">Welt erstellen</button>
        <h2>Mitspielen</h2><div class="fields"><label class="field">Raumcode<input id="jCode" maxlength="6" autocapitalize="characters" placeholder="ABC234" value="${esc(prefill.join || '')}"></label><label class="field">oder Serveradresse<input id="jAddr" placeholder="wss://mein-server:25580" value="${esc(prefill.server || '')}"></label></div>
        <label class="field">Signaling-Dienst (für Raumcodes)<input id="jSig" placeholder="wss://…workers.dev" value="${esc(prof.sig)}"></label>
        ${err ? `<p class="err">${esc(err)}</p>` : ''}<button class="wide ghost" id="jJoin">Beitreten</button></div></div></div>`;
      if (vals) for (const k in vals) { const i = $(k); if (i) { if (i.type === 'checkbox') i.checked = vals[k]; else i.value = vals[k]; } }
    };
    const profile = () => { prof.name = $('pName').value.trim() || 'Spieler'; prof.sig = $('jSig').value.trim(); saveProfile(prof); return prof; };
    draw(); el.hidden = false;
    this.titleError = (m) => { err = m; el.hidden = false; draw(keep()); };
    el.onclick = (e) => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.mode) { const v = keep(); mode = t.dataset.mode; draw(v); }
      else if (t.dataset.skin) { const v = keep(); prof.skin = +t.dataset.skin; saveProfile(prof); draw(v); }
      else if (t.dataset.play) { el.hidden = true; cb.play(t.dataset.play, profile()); }
      else if (t.dataset.del) { if (t.dataset.sure) cb.del(t.dataset.del).then((w) => { worlds = w; draw(keep()); }); else { t.dataset.sure = 1; t.textContent = 'Wirklich?'; } }
      else if (t.id === 'wCreate') { const o = { name: $('wName').value.trim() || 'Neue Welt', seed: $('wSeed').value.trim(), mode, cheats: $('wCheats').checked }; el.hidden = true; cb.create(o, profile()); }
      else if (t.id === 'jJoin') {
        const code = $('jCode').value.trim().toUpperCase(), addr = $('jAddr').value.trim(), p = profile();
        if (!code && !addr) return this.titleError('Bitte Raumcode oder Serveradresse eingeben');
        if (code && !addr && !p.sig) return this.titleError('Für Raumcodes wird die Adresse des Signaling-Dienstes gebraucht');
        err = ''; el.hidden = true; cb.join(addr ? { server: addr } : { code, sig: p.sig }, p);
      }
    };
  }

  // ---- Pausenmenü ----
  buildMenu(game, settings, cb) {
    const m = $('menu'), q = settings.effective(true), qa = settings.effective(), host = cb.isHost, cheat = game.cheats && game.op;
    const autoOff = settings.auto ? AUTO_STEPS.slice(0, settings.autoStep).map((s) => s[0]).join(', ') : '';
    const clock = () => `${String(Math.floor(game.time)).padStart(2, '0')}:${String(Math.floor(game.time % 1 * 60)).padStart(2, '0')} Uhr`;
    const room = cb.room, link = room ? cb.roomLink() : '';
    const pl = [game.name, ...[...game.names].filter(([id]) => id !== game.id).map(([, v]) => v.name)];
    m.innerHTML = `<div class="panel"><div class="invhead"><h1>Pause – ${esc(game.worldName)}</h1><button class="btn" id="mClose">Weiterspielen</button></div>
      <div class="cols"><div>
        <h2>Spielmodus</h2><div class="seg">${['survival', 'creative', 'spectator'].map((k) => `<button data-gm="${k}" class="${k === game.mode ? 'on' : ''}" ${cheat ? '' : 'disabled'}>${MODE_NAMES[k]}</button>`).join('')}</div>
        ${host ? `<label class="row"><span>Cheats erlauben<small>Nötig für Moduswechsel und Befehle wie /give</small></span><input type="checkbox" id="mCheats" ${game.cheats ? 'checked' : ''}></label>` : cheat ? '' : '<p style="margin-top:6px">Moduswechsel und Befehle sind nur für Operatoren mit erlaubten Cheats möglich.</p>'}
        ${cheat ? `<label class="row"><span>Tageszeit<small id="mClock">${clock()}</small></span><input type="range" id="mTime" min="0" max="24" step="0.25" value="${game.time}"></label>
        <label class="row"><span>Zeit läuft</span><input type="checkbox" id="mRun" ${game.timeRunning ? 'checked' : ''}></label>
        <h2>Schwierigkeit</h2><div class="seg">${['Friedlich', 'Leicht', 'Normal', 'Schwer'].map((n, i) => `<button data-diff="${i}" class="${i === game.difficulty ? 'on' : ''}">${n}</button>`).join('')}</div>` : `<div class="row"><span>Tageszeit<small>${clock()}</small></span></div>`}
        <h2>Mehrspieler</h2><div class="row"><span>Spieler (${pl.length})<small>${pl.map(esc).join(', ')}</small></span></div>
        ${host ? (room ? `<div class="roombox"><canvas id="mQR"></canvas><div><b class="code">${room.code}</b><small>Raumcode – Mitspieler geben ihn auf dem Startbildschirm ein oder scannen den QR-Code.</small><small class="link">${esc(link)}</small></div></div>`
          : `<label class="field" style="margin-top:8px">Signaling-Dienst<input id="mSig" placeholder="wss://…workers.dev" value="${esc(loadProfile().sig)}"></label><button class="wide ghost" id="mOpen">Für Mitspieler öffnen</button>${cb.roomError ? `<p class="err">${esc(cb.roomError)}</p>` : ''}`) : ''}
        <button class="wide ghost" id="mQuit">${host ? 'Speichern und zum Hauptmenü' : 'Verbindung trennen'}</button>
      </div><div>
        <h2>Grafikqualität</h2><div class="seg">${Object.keys(PRESETS).map((p) => `<button data-preset="${p}" class="${p === settings.preset ? 'on' : ''}">${PRESET_NAMES[p]}</button>`).join('')}</div>
        <label class="row"><span>Auto-Qualität<small>${autoOff ? 'Reduziert: ' + autoOff : 'Schaltet bei Rucklern teure Effekte ab'}</small></span><input type="checkbox" id="mAuto" ${settings.auto ? 'checked' : ''}></label>
        <label class="row"><span>Sichtweite<small>${qa.dist} Chunks</small></span><input type="range" id="mDist" min="4" max="14" value="${q.dist}"></label>
        <label class="row"><span>Debug-Anzeige<small>Koordinaten, Chunk, Biom, Netzwerk (Taste F3)</small></span><input type="checkbox" id="mDebug" ${this.debug ? 'checked' : ''}></label>
        <h2>Effekte</h2>${TOGGLES.map(([k, label]) => `<label class="row"><span>${label}</span><input type="checkbox" data-toggle="${k}" ${q[k] ? 'checked' : ''}></label>`).join('')}</div></div></div>`;
    m.querySelectorAll('[data-gm]').forEach((b) => b.onclick = () => { game.chat('/gamemode ' + b.dataset.gm); setTimeout(cb.rebuild, 200); });
    m.querySelectorAll('[data-diff]').forEach((b) => b.onclick = () => { game.chat('/difficulty ' + ['peaceful', 'easy', 'normal', 'hard'][b.dataset.diff]); setTimeout(cb.rebuild, 200); });
    m.querySelectorAll('[data-preset]').forEach((b) => b.onclick = () => { settings.setPreset(b.dataset.preset); cb.apply(); });
    m.querySelectorAll('[data-toggle]').forEach((b) => b.onchange = () => { settings.toggle(b.dataset.toggle); cb.apply(); });
    $('mAuto').onchange = (e) => { settings.auto = e.target.checked; settings.autoStep = 0; settings.save(); cb.apply(); };
    $('mDist').onchange = (e) => { settings.dist = +e.target.value; settings.save(); cb.apply(); };
    $('mDebug').onchange = (e) => { this.setDebug(e.target.checked); };
    if ($('mCheats')) $('mCheats').onchange = (e) => { cb.setCheats(e.target.checked); setTimeout(cb.rebuild, 250); };
    if ($('mTime')) {
      $('mTime').onchange = (e) => { game.chat('/time set ' + Math.round((((+e.target.value - 6) % 24) + 24) % 24 * 1000)); };
      $('mTime').oninput = (e) => { $('mClock').textContent = `${String(Math.floor(e.target.value)).padStart(2, '0')}:${String(Math.floor(e.target.value % 1 * 60)).padStart(2, '0')} Uhr`; };
      $('mRun').onchange = (e) => { game.chat('/gamerule doDaylightCycle ' + e.target.checked); };
    }
    if ($('mOpen')) $('mOpen').onclick = () => { const p = loadProfile(); p.sig = $('mSig').value.trim(); saveProfile(p); cb.openRoom(p.sig); };
    if ($('mQR')) drawQR($('mQR'), link, 4);
    $('mClose').onclick = cb.close; $('mQuit').onclick = cb.quit;
  }
  setDebug(on) { this.debug = on; $('debug').hidden = !on; }
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
      if (e.code === 'KeyT' || e.code === 'Enter') { e.preventDefault(); cb.chat(''); }
      if (e.key === '/') { e.preventDefault(); cb.chat('/'); }
      if (e.code === 'F3') { e.preventDefault(); cb.debug(); }
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
