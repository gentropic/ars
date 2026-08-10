// ars harness — renders the condenser mount path in headless Chrome
// (SwiftShader WebGL2), no XR. npm i puppeteer, then: node run.js
// Serves this folder on :8077; needs condenser.js beside test.html
// (copied from ext/condenser/index.js if found).
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

if (!fs.existsSync(path.join(__dirname, 'condenser.js'))) {
  const up = path.join(__dirname, '..', '..', 'condenser', 'index.js');
  if (fs.existsSync(up)) fs.copyFileSync(up, path.join(__dirname, 'condenser.js'));
  else { console.error('condenser.js missing — copy ext/condenser/index.js here'); process.exit(1); }
}
const server = spawn('python3', ['-m', 'http.server', '8077'], { cwd: __dirname, stdio: 'ignore' });
const puppeteer = require('puppeteer');
(async () => {
  await new Promise(r => setTimeout(r, 800));
  const browser = await puppeteer.launch({ headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.on('console', m => console.log('[page]', m.text()));
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('http://localhost:8077/test.html');
  await page.waitForFunction('window.__done !== undefined', { timeout: 30000 });
  console.log('RESULT:', JSON.stringify(await page.evaluate('window.__done')));
  await page.screenshot({ path: path.join(__dirname, 'out.png') });
  await browser.close();
  server.kill();
})().catch(e => { console.error('HARNESS:', e.message); server.kill(); process.exit(1); });
