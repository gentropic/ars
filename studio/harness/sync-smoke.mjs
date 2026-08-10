// sync smoke — the stage-2 wire, no trackers: a fake room pair carries the
// real protocol between the real studio store and a viewer store (part A),
// then the real viewer page receives a scene in test mode and renders it
// (part B). npm i (playwright, repo root), then: node sync-smoke.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
});

let fails = 0;
const chk = (name, cond, extra) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  — ' + extra : ''}`);
  if (!cond) fails++;
};

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

  // ── A: protocol over the fake pair, real studio store as authority ──────
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/studio/index.html`);
  await page.waitForFunction('!!window.__studio');
  await page.evaluate('localStorage.removeItem("ars.studio.autosave")');

  const a = await page.evaluate(`(async () => {
    const { makeFakeRoomPair } = await import('/studio/harness/fake-room.js');
    const { createSync } = await import('/studio/src/sync.js');
    const { createStore } = await import('/studio/src/store.js');
    const pair = makeFakeRoomPair();
    window.__gotPose = null;
    window.__auth = createSync(__studio.store, pair.a,
      { role: 'authority', onPose: (id, p) => { window.__gotPose = { id, n: p.length }; } });
    window.__vstore = createStore();
    window.__vsync = createSync(window.__vstore, pair.b, { role: 'viewer' });
    pair.connect();
    await new Promise((r) => setTimeout(r, 50));
    return { peers: window.__auth.peers() };
  })()`);
  chk('peer joined', a.peers === 1, JSON.stringify(a));

  const menuAdd = async (re) => {
    await page.locator('.gcu-menubar-trigger').filter({ hasText: /^add$/ }).click();
    await page.locator('.gcu-menu-item').filter({ hasText: re }).first().click();
  };
  await menuAdd(/^box$/);
  await menuAdd(/^label$/);
  await page.waitForTimeout(450);              // debounce 250ms + delivery
  const b = await page.evaluate(`(() => {
    const kinds = window.__vstore.all().map((o) => o.kind).sort().join(',');
    return { kinds };
  })()`);
  chk('scene replicated on change', b.kinds === 'box,label,layer', b.kinds);

  // hidden is document state: hiding on the desk hides on the phone
  const hid = await page.evaluate(`(async () => {
    const box = __studio.store.all().find((o) => o.kind === 'box');
    __studio.store.upsert({ id: box.id, hidden: true });
    await new Promise((r) => setTimeout(r, 450));
    return { remote: window.__vstore.get(box.id).hidden === true };
  })()`);
  chk('hidden flag replicates to the viewer', hid.remote, JSON.stringify(hid));

  const c = await page.evaluate(`(async () => {
    const s = __studio.store;
    const bytes = new Uint8Array(84 + 50);     // one-triangle binary STL
    new DataView(bytes.buffer).setUint32(80, 1, true);
    const hash = await s.saveBlob(bytes);
    s.upsert({ id: s.newId(), kind: 'mesh', name: 'tri', layer: s.byKind('layer')[0].id,
               t: [0, 0, 0], props: { blob: hash, fmt: 'stl', unit: 'mm' } });
    await new Promise((r) => setTimeout(r, 500));
    return { missing: window.__vstore.missingBlobs().length,
             got: !!window.__vstore.getBlob(hash) };
  })()`);
  chk('blob replicated + content-verified', c.missing === 0 && c.got, JSON.stringify(c));

  const d = await page.evaluate(`(async () => {
    window.__vsync.sendPose(new Array(16).fill(0).map((_, i) => i % 5 ? 0 : 1));
    await new Promise((r) => setTimeout(r, 50));
    return window.__gotPose;
  })()`);
  chk('pose reaches authority', d && d.n === 16, JSON.stringify(d));

  const e = await page.evaluate(`(async () => {
    // idempotence: rebroadcast of the same document applies nothing
    const before = JSON.stringify(window.__vstore.exportBundle());
    const r = window.__vstore.importBundle(__studio.store.exportBundle());
    return { applied: r.applied, same: before === JSON.stringify(window.__vstore.exportBundle()) };
  })()`);
  chk('rebroadcast is idempotent', e.applied === 0 && e.same, JSON.stringify(e));
  chk('no page errors (studio)', errors.length === 0, errors.join('; '));
  await page.close();

  // ── B: the real viewer page renders a received scene in test mode ───────
  const vp = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const verrors = [];
  vp.on('pageerror', (e) => verrors.push(e.message));
  await vp.goto(`http://127.0.0.1:${port}/web/viewer.html#test=1`);
  await vp.waitForFunction('!!window.__viewer');

  const v = await vp.evaluate(`(async () => {
    const { makeFakeRoomPair } = await import('/studio/harness/fake-room.js');
    const { createSync } = await import('/studio/src/sync.js');
    const { createStore } = await import('/studio/src/store.js');
    const pair = makeFakeRoomPair();
    const astore = createStore();
    const lid = astore.newId();
    astore.upsert({ id: lid, kind: 'layer', name: 'L' });
    astore.upsert({ id: astore.newId(), kind: 'box', name: 'b', layer: lid,
                    t: [0.04, 0, 0], props: { w: 0.05, d: 0.05, h: 0.06, solid: true } });
    astore.upsert({ id: astore.newId(), kind: 'axes', name: 'a', layer: lid,
                    t: [-0.06, 0, 0], props: { size: 0.05 } });
    createSync(astore, pair.a, { role: 'authority' });
    __viewer.joinWith(pair.b);
    pair.connect();
    await new Promise((r) => setTimeout(r, 150));
    __viewer.setDatum([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,-0.05,-0.45,1]);   // mat ahead of camera
    __viewer.render();
    return { objects: __viewer.store.all().length, nodes: __viewer.content.children.length,
             visible: __viewer.content.visible };
  })()`);
  chk('viewer received scene', v.objects === 3, JSON.stringify(v));
  chk('viewer built content nodes', v.nodes === 2 && v.visible, JSON.stringify(v));
  chk('no page errors (viewer)', verrors.length === 0, verrors.join('; '));

  const shot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'viewer-out.png');
  await vp.screenshot({ path: shot });
  console.log('     viewer screenshot →', shot);

  await browser.close();
  server.close();
  console.log(fails ? `SYNC SMOKE: ${fails} FAILURES` : 'SYNC SMOKE: ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS:', e); server.close(); process.exit(1); });
