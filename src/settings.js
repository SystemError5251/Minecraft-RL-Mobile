// Qualitätsstufen, Einzelschalter und Auto-Qualität.
const base = { dist: 5, scale: 0.75, tex: 64, normalMap: false, shadows: 0, shadowSize: 1024, rays: false, raysScale: 0.25, bloom: false, ssr: false, parallax: false, refract: false, tufts: 0, tuftDensity: 1, clouds: 1, wind: false };
export const PRESETS = {
  // Niedrig: nur Nebel, AO und einfache Wasserwellen, direkt in den Framebuffer (kein Post-Pass)
  low: { ...base },
  medium: { ...base, dist: 7, scale: 0.85, normalMap: true, shadows: 1, rays: true, tufts: 22, tuftDensity: 0.6, wind: true },
  high: { ...base, dist: 9, scale: 1, normalMap: true, shadows: 2, shadowSize: 1536, rays: true, bloom: true, refract: true, tufts: 34, tuftDensity: 0.85, clouds: 2, wind: true },
  ultra: { ...base, dist: 12, scale: 1, tex: 128, normalMap: true, shadows: 2, shadowSize: 2048, rays: true, raysScale: 0.5, bloom: true, ssr: true, parallax: true, refract: true, tufts: 48, tuftDensity: 1, clouds: 2, wind: true },
};
export const PRESET_NAMES = { low: 'Niedrig', medium: 'Mittel', high: 'Hoch', ultra: 'Ultra' };
// Einzeln abschaltbare Effekte: [Schlüssel, Beschriftung, Wert beim Einschalten]
export const TOGGLES = [
  ['shadows', 'Schatten', (p) => p.shadows || 1], ['rays', 'Lichtstrahlen', () => true], ['bloom', 'Bloom', () => true],
  ['ssr', 'Wasser-Spiegelungen (SSR)', () => true], ['refract', 'Wasser-Refraktion', () => true], ['normalMap', 'Normal-Maps', () => true],
  ['parallax', 'Parallax-Mapping', () => true], ['tufts', 'Gras & Blumen', (p) => p.tufts || 22], ['clouds', 'Wolken', (p) => p.clouds || 1], ['wind', 'Wind', () => true],
];
// Reihenfolge, in der Auto-Qualität abschaltet: die teuersten Effekte zuerst
export const AUTO_STEPS = [
  ['SSR aus', (q) => { q.ssr = false; }], ['Lichtstrahlen aus', (q) => { q.rays = false; }], ['Schatten aus', (q) => { q.shadows = 0; }], ['Bloom aus', (q) => { q.bloom = false; }],
  ['Parallax aus', (q) => { q.parallax = false; }], ['Auflösung 85 %', (q) => { q.scale *= 0.85; }], ['weniger Gras', (q) => { q.tufts = Math.min(q.tufts, 16); q.tuftDensity *= 0.6; }],
  ['Refraktion aus', (q) => { q.refract = false; }], ['Auflösung 70 %', (q) => { q.scale *= 0.82; }], ['Sichtweite −2', (q) => { q.dist = Math.max(4, q.dist - 2); }],
];

export class Settings {
  constructor() {
    this.preset = 'medium'; this.overrides = {}; this.auto = true; this.autoStep = 0; this.dist = null;
    try { const s = JSON.parse(localStorage.getItem('gfx') || 'null'); if (s && PRESETS[s.preset]) { this.preset = s.preset; this.overrides = s.overrides || {}; this.auto = s.auto !== false; this.dist = s.dist ?? null; } else this.preset = guessPreset(); } catch { /* ohne Speicher */ }
  }
  save() { try { localStorage.setItem('gfx', JSON.stringify({ preset: this.preset, overrides: this.overrides, auto: this.auto, dist: this.dist })); } catch { /* egal */ } }
  setPreset(p) { this.preset = p; this.overrides = {}; this.autoStep = 0; this.dist = null; this.save(); }
  toggle(key) {
    const p = PRESETS[this.preset], cur = this.effective(true)[key], t = TOGGLES.find((x) => x[0] === key);
    this.overrides[key] = cur ? (typeof p[key] === 'number' ? 0 : false) : t[2](p);
    this.save();
  }
  effective(noAuto = false) {
    const q = { ...PRESETS[this.preset], ...this.overrides };
    if (this.dist) q.dist = this.dist;
    if (!q.normalMap) q.parallax = false;
    if (this.auto && !noAuto) for (let i = 0; i < this.autoStep && i < AUTO_STEPS.length; i++) AUTO_STEPS[i][1](q);
    q.simpleWater = !q.normalMap;
    q.direct = !(q.rays || q.bloom || q.ssr || q.refract); // ohne Post-Effekte direkt in den Framebuffer (z. B. Niedrig)
    return q;
  }
}
function guessPreset() {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent), mem = navigator.deviceMemory || 4;
  return mobile ? (mem >= 6 ? 'medium' : 'low') : 'high';
}
