import { L } from './texlayers.js';
// Block-IDs
export const B = { AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, LOG: 5, LEAVES: 6, WATER: 7, BASALT: 8, BASALT_GOLD: 9, BASALT_VIOLET: 10, BASALT_TEAL: 11, BRICKS: 12, ORE: 13 };
const def = (name, top, side = top, bottom = top) => ({ name, top, side, bottom });
export const BLOCKS = [
  null,
  def('Gras', L.grass_top, L.grass_side, L.dirt),
  def('Erde', L.dirt),
  def('Stein', L.stone),
  def('Sand', L.sand),
  def('Baumstamm', L.log_top, L.log_side, L.log_top),
  def('Laub', L.leaves),
  def('Wasser', L.water),
  def('Basalt', L.basalt),
  def('Goldader-Basalt', L.basalt_gold),
  def('Violettader-Basalt', L.basalt_violet),
  def('Türkisader-Basalt', L.basalt_teal),
  def('Polierte Steinziegel', L.bricks),
  def('Roterz', L.ore),
];
// Layer je Fläche: Reihenfolge +x, -x, +y, -y, +z, -z
export const FACE_LAYER = new Uint8Array(BLOCKS.length * 6);
BLOCKS.forEach((b, i) => { if (b) FACE_LAYER.set([b.side, b.side, b.top, b.bottom, b.side, b.side], i * 6); });
export const isOpaque = (b) => b !== 0 && b !== B.WATER && b !== B.LEAVES;
export const isSolid = (b) => b !== 0 && b !== B.WATER;
export const HOTBAR = [B.GRASS, B.DIRT, B.STONE, B.SAND, B.LOG, B.LEAVES, B.BRICKS, B.BASALT, B.BASALT_GOLD, B.BASALT_VIOLET, B.BASALT_TEAL, B.ORE];
