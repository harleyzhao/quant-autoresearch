// Headless smoke test: serves dist/ with `vite preview`, renders three trees in Chromium
// (SwiftShader WebGL2) and writes screenshots to smoke-out/. Exits non-zero on console
// errors or timeouts. Assumes `vite build` has already produced dist/.
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4173;
const PAGE_TIMEOUT_MS = 180_000;
const outDir = join(root, 'smoke-out');
mkdirSync(outDir, { recursive: true });

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('smoke: dist/index.html not found. Run `pnpm --filter @arbor/web build` first.');
  process.exit(1);
}

const cases = [
  { hash: '#species=quercus-robur&seed=7&age=25&day=190', file: 'oak.png' },
  { hash: '#species=pinus-sylvestris&seed=3&age=20&day=190', file: 'pine.png' },
  { hash: '#species=betula-pendula&seed=5&age=20&day=272', file: 'birch-autumn.png' },
  { hash: '#species=acer-platanoides&seed=11&age=18&day=284', file: 'maple-autumn.png' },
  { hash: '#species=quercus-robur&seed=7&age=25&day=190&wall=1.5&wallH=9', file: 'oak-wall.png' },
];

function waitForPort(port, timeoutMs = 20_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = createConnection({ port, host: '127.0.0.1' });
      sock.once('connect', () => { sock.end(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error(`port ${port} not open after ${timeoutMs} ms`));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  for (const d of readdirSync(base)) {
    if (!d.startsWith('chromium')) continue;
    for (const candidate of [join(base, d, 'chrome-linux', 'chrome'), join(base, d, 'chrome-linux64', 'chrome')]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers';

const server = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.stdout.write(`[preview] ${d}`));
server.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`));

let browser;
let failed = false;
try {
  await waitForPort(PORT);
  const launchOpts = {
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  };
  try {
    browser = await chromium.launch(launchOpts);
  } catch (e) {
    const executablePath = findChromium();
    if (!executablePath) throw e;
    console.warn(`smoke: default launch failed (${e.message.split('\n')[0]}); retrying with ${executablePath}`);
    browser = await chromium.launch({ ...launchOpts, executablePath });
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  // software GL renders a textured 90k-leaf canopy at a few seconds per frame; navigation and screenshots wait on frames
  page.setDefaultTimeout(PAGE_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
  const errors = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' || /Error/.test(text)) { errors.push(text); console.error(`[console.${msg.type()}] ${text}`); }
    else console.log(`[console.${msg.type()}] ${text}`);
  });
  page.on('pageerror', (err) => { errors.push(String(err)); console.error(`[pageerror] ${err}`); });

  const results = {};
  for (const c of cases) {
    const url = `http://localhost:${PORT}/${c.hash}`;
    console.log(`smoke: loading ${url}`);
    // Full reload per case so each run starts from a clean page.
    await page.goto('about:blank');
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__arborReady === true, null, { timeout: PAGE_TIMEOUT_MS });
    // one extra frame so the canvas holds the latest render before capture
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: join(outDir, c.file), timeout: PAGE_TIMEOUT_MS }); // software GL renders a textured canopy slowly
    const stats = await page.evaluate(() => window.__arborStats);
    results[c.file] = stats;
    // baked textures of the current species (not part of the timed wait)
    const tex = await page.evaluate(() => window.__arborDebugTextures?.() ?? null);
    const base = c.file.replace(/\.png$/, '');
    for (const [key, suffix] of [['leafAlbedo', 'leaf'], ['leafNormal', 'leaf-normal'], ['barkAlbedo', 'bark'], ['barkNormal', 'bark-normal']]) {
      const url = tex?.[key];
      if (!url) continue;
      writeFileSync(join(outDir, `tex-${base}-${suffix}.png`), Buffer.from(url.split(',')[1], 'base64'));
    }
    console.log(`smoke: ${c.file} ->`, JSON.stringify(stats));
  }
  console.log('smoke: stats', JSON.stringify(results, null, 2));
  if (errors.length) { console.error(`smoke: ${errors.length} console error(s)`); failed = true; }
} catch (e) {
  console.error('smoke: FAILED', e);
  failed = true;
} finally {
  await browser?.close().catch(() => {});
  server.kill('SIGTERM');
}
process.exit(failed ? 1 : 0);
