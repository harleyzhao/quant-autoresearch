// Contact sheet: renders every species in two seasons at a small viewport and composes one
// PNG grid (contact-sheet.png) in smoke-out/. Review material for species tuning and blind
// evaluation (docs/plant-gen/04 §5). Assumes `vite build` has produced dist/.
//   pnpm --filter @arbor/web contact-sheet [age=18] [days=190,275]
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4174;
const PAGE_TIMEOUT_MS = 180_000;
const outDir = join(root, 'smoke-out', 'sheet');
mkdirSync(outDir, { recursive: true });
const arg = (k, d) => (process.argv.find((a) => a.startsWith(k + '=')) ?? `${k}=${d}`).split('=')[1];
const age = Number(arg('age', '18'));
const days = arg('days', '190,275').split(',').map(Number);
const W = 640, H = 480;

if (!existsSync(join(root, 'dist', 'index.html'))) { console.error('contact-sheet: build first'); process.exit(1); }
const speciesIds = readdirSync(join(root, '..', '..', 'species')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();

function waitForPort(port, timeoutMs = 20_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = createConnection({ port }, () => { s.end(); resolve(); });
      s.on('error', () => { if (Date.now() - start > timeoutMs) reject(new Error(`port ${port} not open`)); else setTimeout(tryOnce, 250); });
    };
    tryOnce();
  });
}
function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    for (const d of readdirSync(base)) {
      if (!d.startsWith('chromium-')) continue;
      const p = join(base, d, 'chrome-linux', 'chrome');
      if (existsSync(p)) return p;
    }
  } catch { /* ignore */ }
  return null;
}

const server = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let browser; let failed = false;
try {
  await waitForPort(PORT);
  const launchOpts = { headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] };
  try { browser = await chromium.launch(launchOpts); } catch (e) { const executablePath = findChromium(); if (!executablePath) throw e; browser = await chromium.launch({ ...launchOpts, executablePath }); }
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.setDefaultTimeout(PAGE_TIMEOUT_MS); page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
  page.on('pageerror', (err) => { console.error(`[pageerror] ${err}`); failed = true; });
  const tiles = [];
  for (const id of speciesIds) for (const day of days) {
    const url = `http://localhost:${PORT}/#species=${id}&seed=7&age=${age}&day=${day}`;
    await page.goto('about:blank');
    await page.goto(url, { waitUntil: 'load' });
    await page.addStyleTag({ content: '#pane, #status { display: none !important; }' });
    await page.waitForFunction(() => window.__arborReady === true, null, { timeout: PAGE_TIMEOUT_MS });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const file = join(outDir, `${id}-d${day}.png`);
    await page.screenshot({ path: file, timeout: PAGE_TIMEOUT_MS });
    const stats = await page.evaluate(() => window.__arborStats);
    tiles.push({ id, day, file, label: `${id}  day ${day}  h ${stats.height.toFixed(1)} m  tips ${stats.tips}` });
    console.log(`contact-sheet: ${id} day ${day} ok`);
  }
  // compose the grid in the browser (no image library needed)
  const cols = days.length, rows = speciesIds.length;
  const dataUrls = tiles.map((t) => ({ ...t, data: 'data:image/png;base64,' + readFileSync(t.file).toString('base64') }));
  await page.setViewportSize({ width: cols * W, height: rows * (H + 24) });
  await page.goto('about:blank');
  await page.setContent(`<canvas id="c" width="${cols * W}" height="${rows * (H + 24)}"></canvas>`);
  await page.evaluate(async ({ tiles, cols, W, H }) => {
    const c = document.getElementById('c'); const ctx = c.getContext('2d');
    ctx.fillStyle = '#222'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.font = '16px monospace'; ctx.fillStyle = '#eee';
    await Promise.all(tiles.map((t, i) => new Promise((res) => {
      const img = new Image();
      img.onload = () => { const x = (i % cols) * W, y = Math.floor(i / cols) * (H + 24); ctx.drawImage(img, x, y + 24, W, H); ctx.fillStyle = '#eee'; ctx.fillText(t.label, x + 8, y + 17); res(); };
      img.src = t.data;
    })));
  }, { tiles: dataUrls, cols, W, H });
  const png = await page.evaluate(() => document.getElementById('c').toDataURL('image/png'));
  writeFileSync(join(root, 'smoke-out', 'contact-sheet.png'), Buffer.from(png.split(',')[1], 'base64'));
  console.log(`contact-sheet: wrote smoke-out/contact-sheet.png (${rows}×${cols})`);
} catch (e) { console.error('contact-sheet: FAILED', e); failed = true; }
finally { await browser?.close().catch(() => {}); server.kill('SIGTERM'); }
process.exit(failed ? 1 : 0);
