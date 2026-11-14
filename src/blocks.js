import { L } from './texlayers.js';
// Block-IDs
export const B = { AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, LOG: 5, LEAVES: 6, WATER: 7, BASALT: 8, BASALT_GOLD: 9, BASALT_VIOLET: 10, BASALT_TEAL: 11, BRICKS: 12, ORE: 13, PLANKS: 14, WORKBENCH: 15, FURNACE: 16, COAL_ORE: 17, DIAMOND_ORE: 18, BED: 19 };
// h = Härte (Sekunden-Basis), tool = passendes Werkzeug, tier = Mindeststufe für Drops (1 Holz … 4 Diamant), cat = Kategorie im Kreativ-Inventar
const def = (name, faces, o = {}) => ({ name, faces: Array.isArray(faces) ? faces : [faces, faces, faces, faces, faces, faces], h: 1, tool: null, tier: 0, cat: 'Baustoffe', ...o });
const tsb = (top, side, bottom) => [side, side, top, bottom, side, side];
export const BLOCKS = [
  null,
  def('Gras', tsb(L.grass_top, L.grass_side, L.dirt), { h: 0.6, tool: 'shovel', cat: 'Natur' }),
  def('Erde', L.dirt, { h: 0.5, tool: 'shovel', cat: 'Natur' }),
  def('Stein', L.stone, { h: 1.6, tool: 'pick', tier: 1, cat: 'Natur' }),
  def('Sand', L.sand, { h: 0.5, tool: 'shovel', cat: 'Natur' }),
  def('Baumstamm', tsb(L.log_top, L.log_side, L.log_top), { h: 1.4, tool: 'axe', cat: 'Natur' }),
  def('Laub', L.leaves, { h: 0.2, cat: 'Natur' }),
  def('Wasser', L.water, { cat: null }),
  def('Basalt', L.basalt, { h: 2.4, tool: 'pick', tier: 1, cat: 'Natur' }),
  def('Goldader-Basalt', L.basalt_gold, { h: 2.6, tool: 'pick', tier: 2 }),
  def('Violettader-Basalt', L.basalt_violet, { h: 2.6, tool: 'pick', tier: 2 }),
  def('Türkisader-Basalt', L.basalt_teal, { h: 2.6, tool: 'pick', tier: 2 }),
  def('Polierte Steinziegel', L.bricks, { h: 2.0, tool: 'pick', tier: 1 }),
  def('Eisenerz', L.ore, { h: 2.4, tool: 'pick', tier: 2, cat: 'Natur' }),
  def('Bretter', L.planks, { h: 1.0, tool: 'axe' }),
  def('Werkbank', tsb(L.workbench_top, L.workbench_side, L.planks), { h: 1.2, tool: 'axe', cat: 'Nützliches' }),
  def('Ofen', [L.furnace_top, L.furnace_top, L.furnace_top, L.furnace_top, L.furnace_front, L.furnace_front], { h: 2.2, tool: 'pick', tier: 1, cat: 'Nützliches' }),
  def('Kohleerz', L.coal_ore, { h: 2.0, tool: 'pick', tier: 1, cat: 'Natur' }),
  def('Diamanterz', L.diamond_ore, { h: 3.0, tool: 'pick', tier: 3, cat: 'Natur' }),
  def('Bett', tsb(L.bed_top, L.bed_side, L.planks), { h: 0.5, tool: 'axe', cat: 'Nützliches' }),
];
// Layer je Fläche: Reihenfolge +x, -x, +y, -y, +z, -z
export const FACE_LAYER = new Uint8Array(BLOCKS.length * 6);
BLOCKS.forEach((b, i) => { if (b) FACE_LAYER.set(b.faces, i * 6); });
export const isOpaque = (b) => b !== 0 && b !== B.WATER && b !== B.LEAVES;
export const isSolid = (b) => b !== 0 && b !== B.WATER;
