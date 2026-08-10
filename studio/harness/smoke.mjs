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
    await page.locator('.gcu-menubar-trigger').filter({ hasText: /^add$/ }).click();
    await page.locator('.gcu-menu-item').filter({ hasText: re }).first().click();
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
  await page.locator('.gcu-menu-item').filter({ hasText: /^duplicate$/ }).click();
  await page.waitForTimeout(100);
  const nAfter = await page.evaluate('__studio.store.all().length');
  chk('context-menu duplicate adds an item', nAfter === nBefore + 1, nBefore + ' -> ' + nAfter);

  // undo/redo: gesture-grouped history driven through the real key handler
  const undoRes = await page.evaluate(`(async () => {
    const s = __studio.store;
    await new Promise((r) => setTimeout(r, 500));         // close the previous gesture
    const n0 = s.all().length;
    s.upsert({ id: s.newId(), kind: 'box', name: 'undo-me', layer: s.byKind('layer')[0].id,
               t: [0.09, 0, 0], props: { w: 0.02, d: 0.02, h: 0.02, solid: true } });
    const n1 = s.all().length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    await new Promise((r) => setTimeout(r, 100));
    const n2 = s.all().length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true }));
    await new Promise((r) => setTimeout(r, 100));
    const n3 = s.all().length;
    return { n0, n1, n2, n3 };
  })()`);
  chk('undo/redo round-trip (Ctrl+Z / Ctrl+Y)',
    undoRes.n1 === undoRes.n0 + 1 && undoRes.n2 === undoRes.n0 && undoRes.n3 === undoRes.n1,
    JSON.stringify(undoRes));

  // arrow nudge: 1 mm, Shift = 10 mm, on the mm grid
  const nudge = await page.evaluate(`(() => {
    const s = __studio.store;
    const box = s.all().find((o) => o.name === 'undo-me');
    __studio.view.select(box.id);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true }));
    const t = s.get(box.id).t.slice();
    return t;
  })()`);
  chk('arrow nudge (1 mm / shift 10 mm)',
    Math.abs(nudge[0] - 0.091) < 1e-9 && Math.abs(nudge[1] - 0.01) < 1e-9, JSON.stringify(nudge));

  // drag snaps to the mm grid
  const dragFrom = await page.evaluate(`(() => {
    const box = __studio.store.all().find((o) => o.name === 'undo-me');
    const p = __studio.view.worldToScreen([box.t[0], box.t[1], 0.01]);
    return { id: box.id, x: p.x, y: p.y };
  })()`);
  await page.mouse.move(dragFrom.x, dragFrom.y);
  await page.mouse.down();
  await page.mouse.move(dragFrom.x - 37, dragFrom.y + 13, { steps: 6 });
  await page.mouse.up();
  const snapped = await page.evaluate(`(() => {
    const t = __studio.store.get('${dragFrom.id}').t;
    __studio.view.select(null);
    __studio.store.remove('${dragFrom.id}');
    return t.map((v) => Math.abs(v * 1000 - Math.round(v * 1000)));
  })()`);
  chk('drag snaps to the mm grid', snapped.every((r) => r < 1e-6), JSON.stringify(snapped));

  // demo scene via the file menu: populates, second toggle removes it cleanly
  const menuFile = async (re) => {
    await page.locator('.gcu-menubar-trigger').filter({ hasText: /^file$/ }).click();
    await page.locator('.gcu-menu-item').filter({ hasText: re }).first().click();
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

  // ── hardening + the new 3D formats ──────────────────────────────────────
  const clearMount = () => page.evaluate(`(() => {
    for (const o of [...__studio.store.byKind('blocks'), ...__studio.store.byKind('points')])
      __studio.store.remove(o.id);
  })()`);
  const waitDrawn = async (expect) => {
    // ready = the new build completed; then wait for a FRAME OF THAT BUILD —
    // stats.drawn must hit the expected element count, not a stale frame's
    await page.waitForFunction(
      `__studio.view.blocksReady() && __studio.view.blocksStats() && __studio.view.blocksStats().drawn === ${expect}`,
      { timeout: 30000 });
    return page.evaluate('__studio.view.blocksStats()');
  };

  // sub-blocked CSV (xdim/ydim/zdim, two sizes): must ride the dimPalette
  await clearMount();
  const sub = await page.evaluate(`(async () => {
    const rows = ['x,y,z,xdim,ydim,zdim,au'];
    for (let k = 0; k < 2; k++) for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      if (i === 0 && j === 0 && k === 0) {                 // split this parent into 8 subs
        for (const dz of [-2.5, 2.5]) for (const dy of [-2.5, 2.5]) for (const dx of [-2.5, 2.5])
          rows.push([5 + dx, 5 + dy, 5 + dz, 5, 5, 5, 2.5].join(','));
      } else rows.push([i * 10 + 5, j * 10 + 5, k * 10 + 5, 10, 10, 10, (i + j) / 4].join(','));
    }
    const bytes = new TextEncoder().encode(rows.join('\\n'));
    const { discoverBlockModel } = await import('/studio/src/blocks.js');
    const d = await discoverBlockModel(bytes, { dm: false });
    const s = __studio.store;
    const hash = await s.saveBlob(bytes);
    s.upsert({ id: s.newId(), kind: 'blocks', name: 'sub', layer: s.byKind('layer')[0].id,
      t: [0, 0, 0], props: { blob: hash, chan: d.chan, cols: d.cols, dims: d.dims,
        count: d.count, ramp: 'viridis', cutoff: 0, edges: true, footprint: 0.1 } });
    return { gridded: d.gridded, count: d.count };
  })()`);
  const subStats = await waitDrawn(39);
  chk('sub-blocked csv renders (dimPalette)', sub.gridded && subStats.drawn > 0,
    JSON.stringify({ sub, subStats }));

  // gridless CSV: irregular centroids → the points fallback, not a refusal
  await clearMount();
  await page.evaluate(`(async () => {
    let seed = 5; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const rows = ['x,y,z,au'];
    for (let i = 0; i < 300; i++) rows.push([rnd() * 40, rnd() * 40, rnd() * 10, rnd() * 3].join(','));
    const bytes = new TextEncoder().encode(rows.join('\\n'));
    const s = __studio.store;
    const hash = await s.saveBlob(bytes);
    s.upsert({ id: s.newId(), kind: 'blocks', name: 'cloudy', layer: s.byKind('layer')[0].id,
      t: [0, 0, 0], props: { blob: hash, chan: 3, cols: [], dims: [40, 40, 10],
        count: 300, ramp: 'magma', cutoff: 0, footprint: 0.1 } });
  })()`);
  const gridless = await waitDrawn(300);
  chk('gridless model falls back to graded points', gridless.drawn > 0, JSON.stringify(gridless));

  // LAS: synthesize a v1.2 format-0 file, load through the points kind
  await clearMount();
  const las = await page.evaluate(`(async () => {
    const N = 400;
    const buf = new ArrayBuffer(227 + N * 20);
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    u8.set([0x4C, 0x41, 0x53, 0x46], 0);                  // 'LASF'
    u8[24] = 1; u8[25] = 2;                                // version 1.2
    dv.setUint16(94, 227, true);                           // header size
    dv.setUint32(96, 227, true);                           // point data offset
    dv.setUint32(100, 0, true);                            // VLRs
    u8[104] = 0; dv.setUint16(105, 20, true);              // format 0, 20 B
    dv.setUint32(107, N, true);                            // count
    for (const [o, v] of [[131, 0.01], [139, 0.01], [147, 0.01]]) dv.setFloat64(o, v, true);
    let seed = 9; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let mx = [Infinity, Infinity, Infinity], MX = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < N; i++) {
      const p = [rnd() * 30, rnd() * 30, rnd() * 8];
      for (let a = 0; a < 3; a++) { mx[a] = Math.min(mx[a], p[a]); MX[a] = Math.max(MX[a], p[a]); }
      const o = 227 + i * 20;
      dv.setInt32(o, Math.round(p[0] / 0.01), true);
      dv.setInt32(o + 4, Math.round(p[1] / 0.01), true);
      dv.setInt32(o + 8, Math.round(p[2] / 0.01), true);
      dv.setUint16(o + 12, (i * 37) % 4096, true);
      u8[o + 14] = 0x11; u8[o + 15] = 2;                   // 1 return; class ground
    }
    for (const [o, v] of [[179, MX[0]], [187, mx[0]], [195, MX[1]], [203, mx[1]], [211, MX[2]], [219, mx[2]]])
      dv.setFloat64(o, v, true);
    const bytes = new Uint8Array(buf);
    const { discoverLas } = await import('/studio/src/blocks.js');
    const d = await discoverLas(bytes);
    const s = __studio.store;
    const hash = await s.saveBlob(bytes);
    s.upsert({ id: s.newId(), kind: 'points', name: 'cloud', layer: s.byKind('layer')[0].id,
      t: [0, 0, 0], props: { blob: hash, fmt: 'las', dims: d.dims, count: d.count,
        colorBy: 'intensity', ramp: 'turbo', footprint: 0.1 } });
    return d;
  })()`);
  const lasStats = await waitDrawn(400);
  chk('las point cloud loads + draws', las.count === 400 && lasStats.drawn > 0,
    JSON.stringify({ las, lasStats }));

  // a garbage blob must FAIL VISIBLY — the status bar carries the error
  await clearMount();
  await page.evaluate(`(async () => {
    const s = __studio.store;
    const junk = crypto.getRandomValues(new Uint8Array(512));
    const hash = await s.saveBlob(junk);
    s.upsert({ id: s.newId(), kind: 'blocks', name: 'garbage', layer: s.byKind('layer')[0].id,
      t: [0, 0, 0], props: { blob: hash, chan: null, cols: [], dims: [1, 1, 1], count: 0, footprint: 0.1 } });
  })()`);
  await page.waitForFunction(
    `document.getElementById('status').textContent.includes('⚠')`, { timeout: 20000 });
  chk('block-model load error surfaces in the status bar', true);
  await clearMount();

  // PLY mesh (ascii) and a minimal GLB — three-side loaders via the import map
  const meshKinds = await page.evaluate(`(async () => {
    const s = __studio.store;
    const lid = s.byKind('layer')[0].id;
    const ply = 'ply\\nformat ascii 1.0\\nelement vertex 3\\nproperty float x\\nproperty float y\\nproperty float z\\nelement face 1\\nproperty list uchar int vertex_indices\\nend_header\\n0 0 0\\n0.05 0 0\\n0 0.05 0\\n3 0 1 2\\n';
    const plyHash = await s.saveBlob(new TextEncoder().encode(ply));
    const plyObj = s.upsert({ id: s.newId(), kind: 'mesh', name: 'plytri', layer: lid,
      t: [-0.06, 0, 0.01], props: { blob: plyHash, fmt: 'ply', unit: 'm' } });
    // minimal GLB: one triangle, positions only
    const json = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3',
        min: [0, 0, 0], max: [0.05, 0.05, 0] }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }], buffers: [{ byteLength: 36 }] });
    let jb = new TextEncoder().encode(json);
    const jpad = (4 - (jb.length % 4)) % 4;
    const bin = new Uint8Array(new Float32Array([0, 0, 0, 0.05, 0, 0, 0, 0.05, 0]).buffer);
    const total = 12 + 8 + jb.length + jpad + 8 + bin.length;
    const glb = new ArrayBuffer(total);
    const gv = new DataView(glb);
    const gu = new Uint8Array(glb);
    gv.setUint32(0, 0x46546C67, true); gv.setUint32(4, 2, true); gv.setUint32(8, total, true);
    gv.setUint32(12, jb.length + jpad, true); gv.setUint32(16, 0x4E4F534A, true);
    gu.set(jb, 20); for (let i = 0; i < jpad; i++) gu[20 + jb.length + i] = 0x20;
    const bo = 20 + jb.length + jpad;
    gv.setUint32(bo, bin.length, true); gv.setUint32(bo + 4, 0x004E4942, true);
    gu.set(bin, bo + 8);
    const glbHash = await s.saveBlob(new Uint8Array(glb));
    const glbObj = s.upsert({ id: s.newId(), kind: 'mesh', name: 'glbtri', layer: lid,
      t: [0.06, 0, 0.01], props: { blob: glbHash, fmt: 'glb', unit: 'm' } });
    // poll until both wrapper groups grew real children (async loaders)
    const grew = (id) => new Promise((res) => {
      const t0 = performance.now();
      const tick = () => {
        let found = 0;
        __studio.view.scene.traverse((n) => {
          if (n.userData.objectId === id && (n.isMesh || n.isPoints || (n.isGroup && n.children.length))) found++;
        });
        if (found > 1) return res(true);                   // wrapper + content
        if (performance.now() - t0 > 15000) return res(false);
        setTimeout(tick, 100);
      };
      tick();
    });
    return { ply: await grew(plyObj.id), glb: await grew(glbObj.id) };
  })()`);
  chk('ply mesh loads through the vendored loader', meshKinds.ply === true, JSON.stringify(meshKinds));
  chk('glb mesh loads through the vendored loader', meshKinds.glb === true, JSON.stringify(meshKinds));

  chk('no page errors (end)', errors.length === 0, errors.join('; '));

  await browser.close();
  server.close();
  console.log(fails ? `SMOKE: ${fails} FAILURES` : 'SMOKE: ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS:', e); server.close(); process.exit(1); });
