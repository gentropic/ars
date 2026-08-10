// studio smoke — boots the real dev shell in headless Chrome, exercises the
// store/scene loop: boot, mat present, add objects, LWW merge, project
// round-trip. npm i (playwright, repo root), then: node smoke.mjs
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
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/studio/index.html`);
  await page.waitForFunction('!!window.__studio', { timeout: 15000 });
  await page.evaluate('localStorage.clear()');

  chk('boot', true);
  chk('no page errors', errors.length === 0, errors.join('; '));
  chk('mat group in scene', await page.evaluate(
    '__studio.view.scene.children.some(c => c.name === "mat")'));
  const statusOk = await page.evaluate('document.getElementById("status").textContent');
  chk('status healthy', !/failed/.test(statusOk), statusOk);

  // add objects through the real UI — the menubar
  const menuAdd = async (re) => {
    await page.click('#m-add');
    await page.locator('.menu .item').filter({ hasText: re }).first().click();
  };
  await menuAdd(/^box$/);
  await menuAdd(/^label$/);
  await menuAdd(/^axes$/);
  const kinds = await page.evaluate('__studio.store.all().map(o => o.kind).sort().join(",")');
  chk('menubar adds through the store', kinds === 'axes,box,label,layer', kinds);

  // scene reconciliation: three content nodes
  const nodeCount = await page.evaluate(`(() => {
    const content = __studio.view.scene.children.find(c => c.type === "Group" && c.name !== "mat");
    return content ? content.children.length : -1;
  })()`);
  chk('scene reconciled (3 nodes)', nodeCount === 3, String(nodeCount));

  // LWW merge: a remote edit with a higher clock wins; a stale one loses
  const merged = await page.evaluate(`(() => {
    const s = __studio.store;
    const box = s.all().find(o => o.kind === "box");
    const win = { ...box, name: "REMOTE-WIN", stamp: [9999, "zzzz"] };
    const lose = { ...box, name: "STALE", stamp: [1, "aaaa"] };
    s.importBundle({ objects: [win] });
    const afterWin = s.get(box.id).name;
    s.importBundle({ objects: [lose] });
    return afterWin + "/" + s.get(box.id).name;
  })()`);
  chk('LWW merge (win then hold)', merged === 'REMOTE-WIN/REMOTE-WIN', merged);

  // tombstone beats a stale edit; project round-trips
  const round = await page.evaluate(`(() => {
    const s = __studio.store;
    const label = s.all().find(o => o.kind === "label");
    s.remove(label.id);
    s.importBundle({ objects: [{ ...label, stamp: [2, "aaaa"] }] });
    const stillDead = !s.get(label.id);
    const json = s.exportProject();
    const n1 = s.all().length;
    const r = s.importProject(json);          // self-merge must be a no-op
    return JSON.stringify({ stillDead, n1, n2: s.all().length, applied: r.applied });
  })()`);
  const ro = JSON.parse(round);
  chk('tombstone holds against stale edit', ro.stillDead);
  chk('project round-trip is stable', ro.n1 === ro.n2 && ro.applied === 0, round);

  // per-item visibility: a real eye click hides that item everywhere
  await page.waitForSelector('#tree .obj-row');
  const eyed = await page.evaluate(`(async () => {
    document.querySelector('#tree .obj-row .eye').click();
    await new Promise((r) => setTimeout(r, 100));
    const { effectiveHidden } = await import('/studio/src/store.js');
    const hit = __studio.store.all().find((o) => o.kind !== 'layer' && o.hidden === true);
    const eff = hit && effectiveHidden(__studio.store, hit);
    if (hit) __studio.store.upsert({ id: hit.id, hidden: false });
    return { hid: !!hit, eff: !!eff };
  })()`);
  chk('per-item eye toggles synced hidden flag', eyed.hid && eyed.eff, JSON.stringify(eyed));

  // context menu on a tree row: duplicate through the real menu
  const nBefore = await page.evaluate('__studio.store.all().length');
  await page.locator('#tree .obj-row').first().click({ button: 'right' });
  await page.locator('.menu .item').filter({ hasText: /^duplicate$/ }).click();
  await page.waitForTimeout(100);
  const nAfter = await page.evaluate('__studio.store.all().length');
  chk('context-menu duplicate adds an item', nAfter === nBefore + 1, nBefore + ' -> ' + nAfter);

  // demo scene via the file menu: populates, second toggle removes it cleanly
  const menuFile = async (re) => {
    await page.click('#m-file');
    await page.locator('.menu .item').filter({ hasText: re }).first().click();
  };
  await menuFile(/demo scene/);
  await page.waitForFunction('__studio.store.all().some(o => o.kind === "mesh")', { timeout: 5000 });
  const demo = await page.evaluate(`(() => {
    const s = __studio.store;
    const demoLayer = s.byKind('layer').find(l => l.name === 'demo');
    const objs = s.all().filter(o => o.layer === (demoLayer || {}).id);
    const mesh = objs.find(o => o.kind === 'mesh');
    return { layers: !!demoLayer, n: objs.length,
             kinds: objs.map(o => o.kind).sort().join(','),
             blob: mesh ? !!s.getBlob(mesh.props.blob) : false };
  })()`);
  chk('demo scene populated', demo.layers && demo.n === 8 && demo.blob &&
    demo.kinds.includes('blocks'), JSON.stringify(demo));
  // picking priority: with the axes at the origin, clicking a BOX must select
  // the box (regression: three's 1-world-unit line threshold let the axes
  // swallow every pick — and orbit with it)
  const target = await page.evaluate(`(() => {
    const box = __studio.store.all().find(o => o.kind === 'box');
    const p = __studio.view.worldToScreen([box.t[0], box.t[1], 0.0125]);
    return { id: box.id, x: p.x, y: p.y };
  })()`);
  await page.mouse.click(target.x, target.y);
  const picked = await page.evaluate('__studio.view.selectedId()');
  chk('box picks despite axes at origin', picked === target.id,
    picked + ' vs ' + target.id);

  // and empty space must orbit, not drag: drag well outside the mat and
  // check the camera moved while nothing got selected or displaced
  const orbit = await page.evaluate(`(() => {
    __studio.view.select(null);
    return { az: __studio.view.camera.position.toArray().map(v => +v.toFixed(4)) };
  })()`);
  const canvasBox = await page.evaluate(`(() => {
    const r = document.getElementById('gl').getBoundingClientRect();
    return { x: r.left + r.width * 0.9, y: r.top + r.height * 0.9 };
  })()`);
  await page.mouse.move(canvasBox.x, canvasBox.y);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x - 120, canvasBox.y - 40, { steps: 8 });
  await page.mouse.up();
  const after = await page.evaluate(`(() => ({
    az: __studio.view.camera.position.toArray().map(v => +v.toFixed(4)),
    sel: __studio.view.selectedId() }))()`);
  chk('empty-space drag orbits the camera',
    JSON.stringify(after.az) !== JSON.stringify(orbit.az) && after.sel === null,
    JSON.stringify({ before: orbit.az, after: after.az, sel: after.sel }));

  await menuFile(/demo scene/);
  await page.waitForTimeout(100);
  const gone = await page.evaluate(
    `__studio.store.byKind('layer').every(l => l.name !== 'demo') &&
     !__studio.store.all().some(o => o.kind === 'mesh')`);
  chk('demo scene toggles off cleanly', gone);

  // CSV block model over the blob lane: synthesize a small gridded model,
  // load it the way the file picker does, verify draw / column switch / cutoff
  const csv = await page.evaluate(`(async () => {
    const { discoverBlockModel } = await import('/studio/src/blocks.js');
    let rows = ['x,y,z,au,cu'];
    for (let k = 0; k < 4; k++) for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++)
      rows.push([i * 5, j * 5, k * 5, (i + j) / 10, (k + 1) / 4].join(','));
    const bytes = new TextEncoder().encode(rows.join('\\n'));
    const d = await discoverBlockModel(bytes, { dm: false });
    const s = __studio.store;
    const hash = await s.saveBlob(bytes);
    const layer = s.byKind('layer')[0] || s.upsert({ id: s.newId(), kind: 'layer', name: 'L' });
    const obj = s.upsert({ id: s.newId(), kind: 'blocks', name: 'model', layer: layer.id,
      t: [0, 0, 0], props: { blob: hash, dm: false, chan: d.chan, cols: d.cols, dims: d.dims,
        count: d.count, ramp: 'viridis', cutoff: 0, edges: true, footprint: 0.1 } });
    return { gridded: d.gridded, count: d.count, cols: d.cols.map((c) => c.name).join(','),
             dims: d.dims, id: obj.id };
  })()`);
  chk('csv model discovered (grid + columns)',
    csv.gridded && csv.count === 256 && csv.cols === 'au,cu', JSON.stringify(csv));
  await page.waitForFunction('__studio.view.blocksReady()', { timeout: 20000 });
  await page.waitForTimeout(400);
  const drew = await page.evaluate('__studio.view.blocksStats()');
  chk('csv model draws', drew && drew.drawn > 0, JSON.stringify(drew));
  const other = await page.evaluate(`(async () => {
    const s = __studio.store;
    const obj = s.all().find((o) => o.kind === 'blocks');
    const cu = obj.props.cols.find((c) => c.name === 'cu');
    s.upsert({ id: obj.id, props: { chan: cu.i, cutoff: 0.6, ramp: 'magma' } });
    await new Promise((r) => setTimeout(r, 1200));
    return __studio.view.blocksStats();
  })()`);
  chk('column switch + cutoff + ramp rebuild draws', other && other.drawn > 0,
    JSON.stringify(other));

  chk('no page errors (end)', errors.length === 0, errors.join('; '));

  await browser.close();
  server.close();
  console.log(fails ? `SMOKE: ${fails} FAILURES` : 'SMOKE: ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS:', e); server.close(); process.exit(1); });
