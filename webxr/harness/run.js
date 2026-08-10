// ars harness — renders the condenser mount path in headless Chrome
// (SwiftShader WebGL2), no XR. npm i (playwright, repo root), then: node run.js
// Serves this folder in-process; needs condenser.js beside test.html
// (auto-copied from a condenser build if one is found nearby).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!fs.existsSync(path.join(__dirname, 'condenser.js'))) {
  const candidates = [
    path.join(__dirname, '..', '..', 'condenser', 'index.js'),              // monorepo: ext/condenser
    path.join(__dirname, '..', '..', '..', 'auditable', 'ext', 'condenser', 'index.js'), // sibling checkout
  ];
  const up = candidates.find((p) => fs.existsSync(p));
  if (up) fs.copyFileSync(up, path.join(__dirname, 'condenser.js'));
  else { console.error('condenser.js missing — copy a built condenser index.js here'); process.exit(1); }
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  fs.readFile(path.join(__dirname, p), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.on('console', m => console.log('[page]', m.text()));
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/test.html`);
  await page.waitForFunction('window.__done !== undefined', { timeout: 30000 });
  console.log('RESULT:', JSON.stringify(await page.evaluate('window.__done')));
  await page.screenshot({ path: path.join(__dirname, 'out.png') });
  await browser.close();
  server.close();
})().catch(e => { console.error('HARNESS:', e.message); server.close(); process.exit(1); });
