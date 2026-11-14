// Chat-Befehle: eigene Implementierung mit der gewohnten Syntax (/give, /tp, ~ ~ ~, @p @a @s @e …).
import { B, BLOCKS } from '../src/blocks.js';
import { ITEMS, I, MATS, TYPES, toolId } from '../src/items.js';
import { mk } from '../src/inventory.js';
import { Mob, MOBS } from '../src/entities.js';
import { CH } from '../src/worldgen.js';
import type { GameServer, SPlayer } from './server';
import { MODES, DIFFICULTIES, WEATHER, EFFECTS, DEFAULT_RULES } from './server';

// Namen für Blöcke und Items in Befehlen
const BLOCK_KEYS = ['air', 'grass_block', 'dirt', 'stone', 'sand', 'log', 'leaves', 'water', 'basalt', 'gold_basalt', 'violet_basalt', 'teal_basalt', 'stone_bricks', 'iron_ore', 'planks', 'crafting_table', 'furnace', 'coal_ore', 'diamond_ore', 'bed'];
export const BLOCK_IDS: Record<string, number> = {}; BLOCK_KEYS.forEach((k, i) => { BLOCK_IDS[k] = i; });
export const ITEM_IDS: Record<string, number> = { stick: I.STICK, coal: I.COAL, iron_ingot: I.IRON, diamond: I.DIAMOND, apple: I.APPLE, raw_meat: I.MEAT_RAW, cooked_meat: I.MEAT_COOKED };
BLOCK_KEYS.forEach((k, i) => { if (ITEMS[i]) ITEM_IDS[k] = i; });
['wooden', 'stone', 'iron', 'diamond'].forEach((m, mi) => ['pickaxe', 'axe', 'shovel', 'sword'].forEach((t, ti) => { ITEM_IDS[`${m}_${t}`] = toolId(mi, ti); }));
const strip = (s: string) => s.replace(/^minecraft:|^kantenhain:/, '');

class CmdError extends Error {}
const fail = (m: string): never => { throw new CmdError(m); };
type Ctx = { sv: GameServer; p: SPlayer | null; pos: number[]; args: string[]; i: number; out: (m: string) => void };

const next = (c: Ctx, what: string) => (c.i < c.args.length ? c.args[c.i++] : fail(`Es fehlt: ${what}`));
const more = (c: Ctx) => c.i < c.args.length;
function num(s: string, what = 'Zahl') { const v = Number(s); if (s === '' || !Number.isFinite(v)) fail(`„${s}“ ist keine gültige ${what}`); return v; }
function int(c: Ctx, what: string, min = -Infinity, max = Infinity) { const v = Math.floor(num(next(c, what), what)); if (v < min || v > max) fail(`${what} muss zwischen ${min} und ${max} liegen`); return v; }
// absolute oder relative Koordinate (~ / ~5 / ~-2.5)
function coord(c: Ctx, axis: number, block: boolean) {
  const s = next(c, 'Koordinate (x y z)');
  let v = s[0] === '~' ? c.pos[axis] + (s.length > 1 ? num(s.slice(1), 'Koordinate') : 0) : num(s, 'Koordinate') + (!block && axis !== 1 && /^-?\d+$/.test(s) ? 0.5 : 0);
  return block ? Math.floor(v) : v;
}
const coords = (c: Ctx, block = false) => [coord(c, 0, block), coord(c, 1, block), coord(c, 2, block)];
const isCoord = (s?: string) => !!s && /^(~|-?\d|\.)/.test(s);
// Zielauswahl: @p nächster Spieler, @a alle Spieler, @s Ausführender, @e alle Figuren, sonst Spielername
function targets(c: Ctx, sel: string, entities = false): any[] {
  const pl = [...c.sv.players.values()].filter((p) => p.joined);
  let r: any[];
  if (sel === '@s') r = c.p ? [c.p] : fail('@s geht nur als Spieler');
  else if (sel === '@a') r = pl;
  else if (sel === '@p') r = pl.sort((a, b) => Math.hypot(a.pos[0] - c.pos[0], a.pos[2] - c.pos[2]) - Math.hypot(b.pos[0] - c.pos[0], b.pos[2] - c.pos[2])).slice(0, 1);
  else if (sel === '@e') r = entities ? [...pl, ...c.sv.mobs.filter((m) => !m.dead), ...c.sv.drops.filter((d) => !d.dead)] : fail('@e ist hier nicht erlaubt – nur Spieler');
  else if (sel[0] === '@') r = fail(`Unbekannte Zielauswahl „${sel}“ (erlaubt: @p @a @s @e)`);
  else { const p = c.sv.findPlayer(sel); r = p ? [p] : fail(`Spieler „${sel}“ wurde nicht gefunden`); }
  if (!r.length) fail('Kein Ziel gefunden');
  return r;
}
const players = (c: Ctx, sel?: string) => (sel === undefined ? (c.p ? [c.p] : fail('Spieler angeben')) : targets(c, sel)) as SPlayer[];
const names = (l: any[]) => (l.length === 1 ? l[0].name || 'Figur' : `${l.length} Ziele`);
const item = (s: string) => ITEM_IDS[strip(s)] ?? fail(`Unbekanntes Item „${s}“`);
const block = (s: string) => BLOCK_IDS[strip(s)] ?? fail(`Unbekannter Block „${s}“`);
const pick = (s: string, list: string[], what: string) => { const i = list.indexOf(s); return i >= 0 ? i : fail(`„${s}“ ist kein gültiger Wert für ${what} (${list.join(', ')})`); };

type Cmd = { usage: string; desc: string; perm: 0 | 1 | 2; args: string[]; run: (c: Ctx) => void };
// perm: 0 = jeder, 1 = Operator, 2 = Operator und Cheats erlaubt. args = Vervollständigungsarten je Position
export const COMMANDS: Record<string, Cmd> = {
  help: { usage: '/help [befehl]', desc: 'Zeigt alle Befehle', perm: 0, args: ['command'], run(c) {
    if (more(c)) { const n = next(c, '').replace(/^\//, ''), d = COMMANDS[n] || fail(`Unbekannter Befehl „${n}“`); return c.out(`${d.usage} – ${d.desc}`); }
    c.out('Befehle: ' + Object.keys(COMMANDS).map((k) => '/' + k).join(' '));
    c.out('Details mit /help <befehl>. Koordinaten: absolut oder relativ (~ ~ ~). Ziele: @p @a @s @e oder Spielername.');
  } },
  gamemode: { usage: '/gamemode <survival|creative|spectator> [spieler]', desc: 'Ändert den Spielmodus', perm: 2, args: ['mode', 'player'], run(c) {
    const m = pick(next(c, 'Spielmodus'), MODES, 'den Spielmodus'), l = players(c, more(c) ? next(c, '') : undefined);
    for (const p of l) c.sv.setMode(p, m);
    c.out(`Spielmodus von ${names(l)} ist jetzt ${MODES[m]}`);
  } },
  tp: { usage: '/tp [ziel] <x y z | spieler>', desc: 'Teleportiert Spieler oder Figuren', perm: 2, args: ['target', 'target', 'coord', 'coord'], run(c) {
    let who: any[] = c.p ? [c.p] : [];
    if (!isCoord(c.args[c.i]) && (c.args.length === 2 || c.args.length === 4)) who = targets(c, next(c, ''), true);
    let pos: number[];
    if (isCoord(c.args[c.i])) pos = coords(c); else { const d = targets(c, next(c, 'Ziel'), true); if (d.length !== 1) fail('Das Ziel muss eindeutig sein'); pos = d[0].pos.slice(); }
    if (!who.length) fail('Wer soll teleportiert werden?');
    if (pos[1] < -64 || pos[1] > 512) fail('Die Höhe liegt außerhalb der Welt');
    for (const e of who) { if (e.send) c.sv.teleport(e, pos[0], pos[1], pos[2]); else { e.pos = pos.slice(); e.prev = pos.slice(); e.vel = [0, 0, 0]; } }
    c.out(`${names(who)} nach ${pos.map((v) => v.toFixed(1)).join(' ')} teleportiert`);
  } },
  give: { usage: '/give <spieler> <item> [anzahl]', desc: 'Gibt Items', perm: 2, args: ['player', 'item'], run(c) {
    const l = players(c, next(c, 'Spieler')), id = item(next(c, 'Item')), n = more(c) ? int(c, 'Anzahl', 1, 2304) : 1;
    for (const p of l) { const left = p.inv.add(id, n); if (left > 0) c.sv.spawnDrop(id, Math.min(left, 64), undefined, p.pos[0], p.pos[1] + 1, p.pos[2]); p.invDirty = true; }
    c.out(`${n} × ${ITEMS[id].name} an ${names(l)} gegeben`);
  } },
  clear: { usage: '/clear [spieler] [item]', desc: 'Leert das Inventar', perm: 2, args: ['player', 'item'], run(c) {
    const l = players(c, more(c) ? next(c, '') : undefined), id = more(c) ? item(next(c, '')) : 0; let n = 0;
    for (const p of l) { p.inv.slots.forEach((s: any, i: number) => { if (s && (!id || s.id === id)) { n += s.n; p.inv.slots[i] = null; } }); p.invDirty = true; }
    c.out(n ? `${n} Items aus dem Inventar von ${names(l)} entfernt` : 'Es wurden keine Items gefunden');
  } },
  time: { usage: '/time <set|add|query> [day|night|noon|midnight|zahl]', desc: 'Stellt die Tageszeit (Ticks, 0 = 6 Uhr)', perm: 2, args: ['timeop', 'timeval'], run(c) {
    const op = next(c, 'set, add oder query'), ticks = () => Math.round((((c.sv.time - 6) % 24) + 24) % 24 * 1000);
    if (op === 'query') return c.out(`Es ist ${ticks()} Ticks (${Math.floor(c.sv.time)}:${String(Math.floor(c.sv.time % 1 * 60)).padStart(2, '0')} Uhr)`);
    if (op !== 'set' && op !== 'add') fail('Verwendung: ' + this.usage);
    const s = next(c, 'Zeit'), named: any = { day: 1000, noon: 6000, night: 13000, midnight: 18000 };
    const v = op === 'set' && s in named ? named[s] : num(s, 'Zeit');
    const t = op === 'set' ? v : ticks() + v;
    c.sv.time = (((t / 1000 + 6) % 24) + 24) % 24; c.sv.sendTime();
    c.out(`Zeit auf ${ticks()} gesetzt`);
  } },
  weather: { usage: '/weather <clear|rain|thunder> [sekunden]', desc: 'Ändert das Wetter', perm: 2, args: ['weather'], run(c) {
    const w = pick(next(c, 'Wetter'), WEATHER, 'das Wetter'), sec = more(c) ? int(c, 'Dauer', 1, 1000000) : undefined;
    c.sv.setWeather(w, sec === undefined ? undefined : sec * 20); c.out(`Wetter ist jetzt ${['klar', 'Regen', 'Gewitter'][w]}`);
  } },
  difficulty: { usage: '/difficulty [peaceful|easy|normal|hard]', desc: 'Zeigt oder ändert die Schwierigkeit', perm: 2, args: ['difficulty'], run(c) {
    if (!more(c)) return c.out(`Schwierigkeit: ${DIFFICULTIES[c.sv.difficulty]}`);
    c.sv.difficulty = pick(next(c, ''), DIFFICULTIES, 'die Schwierigkeit'); c.sv.sendTime(); c.out(`Schwierigkeit ist jetzt ${DIFFICULTIES[c.sv.difficulty]}`);
  } },
  gamerule: { usage: '/gamerule <regel> [true|false]', desc: 'Zeigt oder ändert eine Spielregel', perm: 2, args: ['rule', 'bool'], run(c) {
    const r = next(c, 'Regel (' + Object.keys(DEFAULT_RULES).join(', ') + ')');
    if (!(r in DEFAULT_RULES)) fail(`Unbekannte Regel „${r}“ (${Object.keys(DEFAULT_RULES).join(', ')})`);
    if (!more(c)) return c.out(`${r} = ${c.sv.rules[r]}`);
    const v = next(c, ''); if (v !== 'true' && v !== 'false') fail('Der Wert muss true oder false sein');
    c.sv.rules[r] = v === 'true'; c.sv.sendTime(); c.out(`${r} ist jetzt ${v}`);
  } },
  kill: { usage: '/kill [ziel]', desc: 'Tötet Spieler oder Figuren', perm: 2, args: ['target'], run(c) {
    const l = more(c) ? targets(c, next(c, ''), true) : players(c);
    for (const e of l) { if (e.send) { if (!e.dead) { const m = e.mode; e.mode = 0; c.sv.die(e); e.mode = m; } } else e.dead = true; }
    c.out(`${names(l)} getötet`);
  } },
  summon: { usage: '/summon <figur> [x y z]', desc: 'Erschafft eine Figur', perm: 2, args: ['entity', 'coord', 'coord', 'coord'], run(c) {
    const t = strip(next(c, 'Figur')); if (!MOBS[t]) fail(`Unbekannte Figur „${t}“ (${Object.keys(MOBS).join(', ')})`);
    const pos = more(c) ? coords(c) : c.pos.slice();
    c.sv.world.chunk(Math.floor(pos[0] / 16), Math.floor(pos[2] / 16)); c.sv.addMob(new Mob(t, pos[0], pos[1], pos[2])); c.out(`${MOBS[t].name} erschaffen`);
  } },
  setblock: { usage: '/setblock <x y z> <block>', desc: 'Setzt einen Block', perm: 2, args: ['coord', 'coord', 'coord', 'block'], run(c) {
    const [x, y, z] = coords(c, true), b = block(next(c, 'Block'));
    if (y < 1 || y >= CH) fail(`Die Höhe muss zwischen 1 und ${CH - 1} liegen`);
    c.out(c.sv.world.setBlock(x, y, z, b) ? `Block bei ${x} ${y} ${z} gesetzt` : 'Der Block war bereits so gesetzt');
  } },
  fill: { usage: '/fill <x1 y1 z1> <x2 y2 z2> <block>', desc: 'Füllt einen Bereich (max. 32768 Blöcke)', perm: 2, args: ['coord', 'coord', 'coord', 'coord', 'coord', 'coord', 'block'], run(c) {
    const a = coords(c, true), b = coords(c, true), id = block(next(c, 'Block'));
    const lo = a.map((v, i) => Math.min(v, b[i])), hi = a.map((v, i) => Math.max(v, b[i])), vol = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
    if (vol > 32768) fail(`Der Bereich ist zu groß (${vol} > 32768 Blöcke)`);
    if (lo[1] < 1 || hi[1] >= CH) fail(`Die Höhe muss zwischen 1 und ${CH - 1} liegen`);
    let n = 0;
    for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) for (let x = lo[0]; x <= hi[0]; x++) if (c.sv.world.setBlock(x, y, z, id)) n++;
    c.out(`${n} Blöcke gefüllt`);
  } },
  seed: { usage: '/seed', desc: 'Zeigt den Seed der Welt', perm: 0, args: [], run(c) { c.out(`Seed: ${c.sv.rec.seed}`); } },
  spawnpoint: { usage: '/spawnpoint [spieler] [x y z]', desc: 'Setzt den persönlichen Spawnpunkt', perm: 2, args: ['player', 'coord', 'coord', 'coord'], run(c) {
    const l = players(c, more(c) && !isCoord(c.args[c.i]) ? next(c, '') : undefined), pos = more(c) ? coords(c, true) : c.pos.map(Math.floor);
    for (const p of l) p.bed = [pos[0], pos[1] - 1, pos[2]];
    c.out(`Spawnpunkt von ${names(l)} auf ${pos.join(' ')} gesetzt (gilt, solange dort ein Bett steht – sonst Weltspawn)`);
  } },
  setworldspawn: { usage: '/setworldspawn [x y z]', desc: 'Setzt den Weltspawn', perm: 2, args: ['coord', 'coord', 'coord'], run(c) {
    c.sv.spawn = more(c) ? coords(c, true) : c.pos.map(Math.floor); c.out(`Weltspawn auf ${c.sv.spawn.join(' ')} gesetzt`);
  } },
  effect: { usage: '/effect <give|clear> <spieler> [effekt] [sekunden] [stufe]', desc: 'Gibt oder entfernt Effekte', perm: 2, args: ['effectop', 'player', 'effect'], run(c) {
    const op = next(c, 'give oder clear'); if (op !== 'give' && op !== 'clear') fail('Verwendung: ' + this.usage);
    const l = players(c, next(c, 'Spieler'));
    if (op === 'clear') { for (const p of l) p.effects.clear(); return c.out(`Effekte von ${names(l)} entfernt`); }
    const e = strip(next(c, 'Effekt')); if (!EFFECTS.includes(e)) fail(`Unbekannter Effekt „${e}“ (${EFFECTS.join(', ')})`);
    const sec = more(c) ? int(c, 'Dauer', 1, 1000000) : 30, amp = more(c) ? int(c, 'Stufe', 0, 255) : 0;
    for (const p of l) { if (e === 'instant_health') p.health = Math.min(20, p.health + 4 * 2 ** Math.min(amp, 3)); else p.effects.set(e, { until: c.sv.tickN + sec * 20, amp: Math.min(amp, 9) }); }
    c.out(`${e} (Stufe ${amp + 1}) für ${sec} s an ${names(l)} gegeben`);
  } },
  xp: { usage: '/xp <add|set|query> <spieler> [menge] [points|levels]', desc: 'Ändert die Erfahrung', perm: 2, args: ['xpop', 'player', '', 'xpunit'], run(c) {
    const op = next(c, 'add, set oder query'); if (!['add', 'set', 'query'].includes(op)) fail('Verwendung: ' + this.usage);
    const l = players(c, next(c, 'Spieler'));
    if (op === 'query') return c.out(l.map((p) => `${p.name}: ${p.xp} Punkte (Level ${xpLevel(p.xp)})`).join(', '));
    const n = int(c, 'Menge', -1000000, 1000000), lv = more(c) ? next(c, '') === 'levels' : false;
    for (const p of l) { const cur = lv ? xpLevel(p.xp) : p.xp, v = Math.max(0, op === 'add' ? cur + n : n); p.xp = lv ? xpForLevel(v) : v; }
    c.out(`Erfahrung von ${names(l)} geändert`);
  } },
  say: { usage: '/say <nachricht>', desc: 'Sendet eine Nachricht an alle', perm: 1, args: [], run(c) { if (!more(c)) fail('Es fehlt: Nachricht'); c.sv.chat(`[${c.p ? c.p.name : 'Server'}] ${c.args.slice(c.i).join(' ')}`, 2); } },
  kick: { usage: '/kick <spieler> [grund]', desc: 'Wirft einen Spieler hinaus', perm: 1, args: ['player'], run(c) {
    const l = players(c, next(c, 'Spieler')), why = c.args.slice(c.i).join(' ') || 'Vom Host entfernt';
    for (const p of l) { if (p.local) fail('Der Host kann nicht entfernt werden'); c.sv.chat(`${p.name} wurde entfernt`, 2); c.sv.kick(p, why); }
  } },
  op: { usage: '/op <spieler>', desc: 'Macht einen Spieler zum Operator', perm: 1, args: ['player'], run(c) { const l = players(c, next(c, 'Spieler')); for (const p of l) p.op = true; c.out(`${names(l)} ist jetzt Operator`); } },
  deop: { usage: '/deop <spieler>', desc: 'Entzieht Operator-Rechte', perm: 1, args: ['player'], run(c) { const l = players(c, next(c, 'Spieler')); for (const p of l) { if (p.local) fail('Dem Host können die Rechte nicht entzogen werden'); p.op = false; } c.out(`${names(l)} ist kein Operator mehr`); } },
};
export const xpLevel = (xp: number) => Math.floor((Math.sqrt(1 + 0.8 * xp) - 1) / 2); // Level L braucht 5·L·(L+1) Punkte
export const xpForLevel = (l: number) => 5 * l * (l + 1);

export function runCommand(sv: GameServer, p: SPlayer | null, line: string) {
  const args = line.trim().replace(/^\//, '').split(/\s+/), name = args.shift()!.toLowerCase(), cmd = COMMANDS[name];
  const err = (m: string) => sv.tell(p, m, 1);
  if (!cmd) return err(`Unbekannter Befehl „/${name}“ – /help zeigt alle Befehle`);
  if (cmd.perm >= 1 && !sv.isOp(p)) return err('Dafür brauchst du Operator-Rechte');
  if (cmd.perm === 2 && p && !sv.cheats) return err('Cheats sind in dieser Welt nicht erlaubt');
  try { cmd.run({ sv, p, pos: p ? p.pos : sv.spawn, args, i: 0, out: (m) => sv.tell(p, m, 3) }); }
  catch (e: any) { if (e instanceof CmdError) { err(e.message); err('Verwendung: ' + cmd.usage); } else { err('Interner Fehler: ' + e.message); } }
}

// Tab-Vervollständigung: Befehlsname, danach je nach Argumentart
export function complete(sv: GameServer, p: SPlayer | null, line: string): string[] {
  if (line[0] !== '/') return [];
  const parts = line.slice(1).split(/\s+/), last = parts[parts.length - 1], head = line.slice(0, line.length - last.length);
  let opts: string[] = [];
  if (parts.length === 1) opts = Object.keys(COMMANDS);
  else {
    const cmd = COMMANDS[parts[0].toLowerCase()]; if (!cmd) return [];
    const kind = cmd.args[parts.length - 2] || '', pl = [...sv.players.values()].filter((x) => x.joined).map((x) => x.name);
    opts = ({ command: Object.keys(COMMANDS), mode: MODES, player: [...pl, '@p', '@a', '@s'], target: [...pl, '@p', '@a', '@s', '@e', '~'], item: Object.keys(ITEM_IDS), block: Object.keys(BLOCK_IDS), entity: Object.keys(MOBS), weather: WEATHER,
      difficulty: DIFFICULTIES, rule: Object.keys(DEFAULT_RULES), bool: ['true', 'false'], coord: ['~'], timeop: ['set', 'add', 'query'], timeval: ['day', 'noon', 'night', 'midnight'], effectop: ['give', 'clear'], effect: EFFECTS, xpop: ['add', 'set', 'query'], xpunit: ['points', 'levels'] } as any)[kind] || [];
  }
  return opts.filter((o) => o.toLowerCase().startsWith(last.toLowerCase())).slice(0, 40).map((o) => head + o);
}
