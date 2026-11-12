// Gemeinsame Layer-Liste für Textur-Generator (Node) und Engine (Browser).
export const LAYERS = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'sand', 'log_side', 'log_top', 'leaves', 'water',
  'basalt', 'basalt_gold', 'basalt_violet', 'basalt_teal', 'bricks', 'ore',
  'tuft_grass', 'tuft_tall', 'flower_red', 'flower_white', 'flower_yellow', 'flower_pink', 'reed',
];
export const L = Object.fromEntries(LAYERS.map((n, i) => [n, i]));
