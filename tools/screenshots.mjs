// Vergleichs-Screenshots (Niedrig vs. Ultra) der vier Referenzszenen: node tools/screenshots.mjs [szene] [qualität]
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.OUT || path.join(root, 'screenshots');
const NAMES = { meadow: 'wiese-mittag', swamp: 'sumpf-sonnenaufgang', forest: 'waldsee-gegenlicht', showcase: 'block-showcase' };
const scenes = process.argv[2] ? [process.argv[2]] : Object.keys(NAMES), quals = process.argv[3] ? [process.argv[3]] : ['low', 'ultra'];
const extra = process.env.EXTRA || '';
const port = +(process.env.PORT || 8791);
const server = await serve(port);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const sc of scenes) for (const ql of quals) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${sc}/${ql}]`, m.text().slice(0, 1500)); });
  page.on('pageerror', (e) => console.log(`[${sc}/${ql}] FEHLER`, e.message));
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/index.html?scene=${sc}&q=${ql}&shot=1${extra}`);
  await page.waitForFunction(() => window.__status && window.__status.ready, null, { timeout: 240000 });
  await page.waitForTimeout(2500);
  const file = path.join(outDir, `${NAMES[sc]}_${ql === 'low' ? 'niedrig' : ql}.${process.env.FMT || 'jpg'}`);
  await page.screenshot({ path: file, timeout: 120000, ...(file.endsWith('.jpg') ? { type: 'jpeg', quality: 90 } : {}) });
  console.log(`${file}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  await page.close();
}
await browser.close(); server.close();
