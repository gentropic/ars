// ars-m3 END-TO-END harness: loads the REAL ars-m3.html in headless Chrome,
// stubs the WebXR API (session, frames, camera texture, hit-test, anchors),
// pumps ~60 frames, and asserts the fused marker pose against ground truth.
// Geometry: camera at origin looking down -Z; markers (ARUCO_MIP_36h12,
// per-scenario list) flat on the plane z = -0.5 facing the camera, top
// edges up. Four scenarios: the ad-hoc single-marker path (anchored /
// wrong-size witness) and the mat datum path (full constellation → one
// confident datum at the printed origin; lone reference → unconfident).
// npm i (playwright, repo root), then: node e2e-m3.js (serves ../reference in-process).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REF = path.join(__dirname, '..', 'reference');
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  fs.readFile(path.join(REF, p), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    res.end(data);
  });
});
let PORT = 0;

const STUB = `
(() => { try {
  const FY = 1786;                                    // px focal (camera space)
  const CAMW = 886, CAMH = 1920;
  const proj = new Float32Array(16);
  proj[0] = 2*FY/CAMW * (CAMW/CAMW); proj[0] = FY/(CAMW/2); proj[5] = FY/(CAMH/2);
  proj[10] = -1.001; proj[11] = -1; proj[14] = -0.02;
  const IDENT = new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);

  // camera image: window.__MARKERS = [{id, x, y, size}] rendered by pinhole
  // projection onto the plane z = -WORLDZ (quiet zone + border + payload,
  // geometry from dic.markSize), top edges up. Markers sit OFF-center in the
  // frame, so any constant ray bias (the principal-point bug class) breaks
  // the position asserts.
  function makeCameraCanvas(dic){
    const c = document.createElement('canvas'); c.width = CAMW; c.height = CAMH;
    const g = c.getContext('2d');
    g.fillStyle = '#787878'; g.fillRect(0, 0, CAMW, CAMH);
    const FYCAM = window.__FYCAM || FY;               // camera-frame focal (may ≠ view!)
    const WORLDZ = window.__WORLDZ ?? 0.5;
    const MS = dic.markSize, PAY = MS - 2;            // 36h12: 8 cells black, 6x6 payload
    for (const mk of (window.__MARKERS || [])){
      const blackPx = FYCAM * mk.size / WORLDZ;
      const cell = blackPx / MS, total = cell * (MS + 2);
      const x0 = CAMW/2 + FYCAM * mk.x / WORLDZ - total/2;
      const y0 = CAMH/2 - FYCAM * mk.y / WORLDZ - total/2;
      g.fillStyle = '#fff'; g.fillRect(x0, y0, total, total);
      g.fillStyle = '#000'; g.fillRect(x0 + cell, y0 + cell, cell*MS, cell*MS);
      const code = dic.codeList[mk.id];
      g.fillStyle = '#fff';
      for (let r = 0; r < PAY; r++) for (let q = 0; q < PAY; q++)
        if (code[r*PAY+q] === '1')
          g.fillRect(x0 + (q+2)*cell, y0 + (r+2)*cell, cell+0.5, cell+0.5);
    }
    return c;
  }

  class XRRay { constructor(o, d){ this.origin = o; this.direction = d; } }
  class XRRigidTransform {
    constructor(p = {x:0,y:0,z:0}, q = {x:0,y:0,z:0,w:1}){ this.position = p; this.orientation = q;
      const {x,y,z,w} = q, m = new Float32Array(16);
      m[0]=1-2*(y*y+z*z); m[1]=2*(x*y+z*w);   m[2]=2*(x*z-y*w);
      m[4]=2*(x*y-z*w);   m[5]=1-2*(x*x+z*z); m[6]=2*(y*z+x*w);
      m[8]=2*(x*z+y*w);   m[9]=2*(y*z-x*w);   m[10]=1-2*(x*x+y*y);
      m[12]=p.x; m[13]=p.y; m[14]=p.z; m[15]=1;
      this.matrix = m;
    }
  }
  class XRWebGLLayer {
    constructor(){ this.framebuffer = null; }
    getViewport(){ return { x: 0, y: 0, width: 800, height: 600 }; }
  }
  let camTex = null;
  class XRWebGLBinding {
    constructor(session, gl){ this._gl = gl; }
    getCameraImage(cam){
      const gl = this._gl;
      if (!camTex){
        camTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, camTex);
        // ARCore camera textures are BOTTOM-UP (GL convention): upload the
        // canvas flipped so the stub matches the device, which forces the
        // page's camFlip default to be exercised for real
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, window.__camCanvas);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
      return camTex;
    }
  }
  // headless has WebGL2 but no XR device: makeXRCompatible would throw
  if (window.WebGL2RenderingContext)
    WebGL2RenderingContext.prototype.makeXRCompatible = function(){ return Promise.resolve(); };
  window.XRRay = XRRay; window.XRRigidTransform = XRRigidTransform;
  window.XRWebGLLayer = XRWebGLLayer; window.XRWebGLBinding = XRWebGLBinding;

  const view = {
    camera: { width: CAMW, height: CAMH },
    projectionMatrix: proj,
    transform: { matrix: IDENT, inverse: { matrix: IDENT }, position: { x: 0, y: 0, z: 0 } },
  };
  // hit-test plane at z=-0.5 facing +z: pose +Y must be the surface normal
  // (0,0,1) → rotate X by -90°: quat (x=-s, w=c) about X.
  const s = Math.sin(-Math.PI/4), c = Math.cos(-Math.PI/4);
  const planePose = new XRRigidTransform({ x: 0, y: 0, z: -(window.__WORLDZ ?? 0.5) }, { x: s, y: 0, z: 0, w: c });

  const anchors = [];
  const hitSources = [];
  const rafQ = [];
  const session = {
    enabledFeatures: ['local','camera-access','hit-test','anchors','dom-overlay'],
    updateRenderState(){}, addEventListener(){}, end(){},
    requestReferenceSpace: async (t) => ({ _ref: t }),
    requestAnimationFrame: (cb) => { rafQ.push(cb); },
    requestHitTestSource: async (opts) => { const src = { _ray: opts.offsetRay, _age: 0 }; hitSources.push(src); return src; },
  };
  const frame = {
    getViewerPose: () => ({ views: [view] }),
    getHitTestResults: (src) => {
      src._age++;
      if (src._age < 2) return [];
      return [{ getPose: () => ({ transform: planePose }) }];
    },
    getPose: (space, base) => space && space._anchorPose
      ? { transform: space._anchorPose } : (space && space._ref ? { transform: new XRRigidTransform() } : null),
    createAnchor: (rt, space) => {
      const a = { anchorSpace: { _anchorPose: rt } };
      anchors.push(a);
      return Promise.resolve(a);
    },
  };
  Object.defineProperty(navigator, 'xr', {
    configurable: true,
    value: {
      isSessionSupported: async () => true,
      requestSession: async () => session,
    },
  });
  window.__pump = (n) => {
    for (let i = 0; i < n; i++){
      const q = rafQ.splice(0);
      for (const cb of q) cb(performance.now(), frame);
    }
    return { anchors: anchors.length, hitSources: hitSources.length };
  };
  window.__initCam = () => {
    const AR = window.AR;
    window.__camCanvas = makeCameraCanvas(new AR.Dictionary('ARUCO_MIP_36h12'));
  };
} catch (e) { window.__stubErr = e.message; } })();
`;

// o: { name, markers: [{id,x,y,size}], msize, target: 'mat'|id,
//      expect: 'anchored'|'size-warning', pos: [x,y,z], refs?, confident?, fycam?, worldZ? }
async function runScenario(o){
  const worldZ = o.worldZ ?? 0.5;
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
  await page.addInitScript('window.__FYCAM = ' + (o.fycam || 'undefined') +
    '; window.__WORLDZ = ' + worldZ +
    '; window.__MARKERS = ' + JSON.stringify(o.markers) + ';');
  await page.addInitScript(STUB);
  await page.goto(`http://127.0.0.1:${PORT}/ars-m3.html`);
  await page.evaluate('window.__initCam()');
  await page.evaluate(`localStorage.clear(); document.getElementById('msize').value = '` + o.msize + `'`);
  await page.click('#enter');
  await new Promise(r => setTimeout(r, 300));           // session + spaces resolve

  // pump frames in bursts with microtask gaps (hit-test/anchor promises)
  for (let burst = 0; burst < 15; burst++){
    await page.evaluate('window.__pump(6)');
    await new Promise(r => setTimeout(r, 30));
  }

  const rootExpr = o.target === 'mat' ? 'a.datum()' : 'a.markerRoots.get(' + o.target + ')';
  const out = await page.evaluate(`(() => {
    const a = window.__ars;
    if (window.__stubErr) return { fail: 'stub: ' + window.__stubErr };
    if (!a) return { fail: 'no __ars handle' };
    const r = ${rootExpr};
    if (!r) return { fail: ${JSON.stringify(o.target)} + ' never rooted', stats: a.stats(),
      hud: document.getElementById('hud-status').textContent + ' | ' +
           document.getElementById('hud-detail').textContent };
    // effective world pose: anchor pose (if any) · node.local
    let M = r.node.local;
    if (r.space && r.space._anchorPose){
      const A = r.space._anchorPose.matrix, L = r.node.local, W = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++)
        W[c*4+row] = A[row]*L[c*4] + A[4+row]*L[c*4+1] + A[8+row]*L[c*4+2] + A[12+row]*L[c*4+3];
      M = W;
    }
    return {
      stats: a.stats(), replants: a.replants(),
      seen: r.seen, fused: r.fusedCount, anchored: !!r.anchor,
      refs: r.refs, confident: r.confident,
      pos: [M[12], M[13], M[14]].map(v => +v.toFixed(4)),
      xAxis: [M[0], M[1], M[2]].map(v => +v.toFixed(3)),
      zAxis: [M[8], M[9], M[10]].map(v => +v.toFixed(3)),
      focalK: +a.focalK().toFixed(3),
      hud: document.getElementById('hud-status').textContent + ' | ' +
           document.getElementById('hud-detail').textContent + ' | ' +
           document.getElementById('hud-stats').textContent,
    };
  })()`);

  console.log('[' + o.name + ']', JSON.stringify(out));
  if (errors.length) console.log('[' + o.name + '] page errors:', errors);
  let ok;
  if (o.expect === 'anchored'){
    ok = !out.fail && errors.length === 0 &&
      out.fused >= 2 && out.anchored &&
      Math.abs(out.pos[0] - o.pos[0]) < 0.02 &&
      Math.abs(out.pos[1] - o.pos[1]) < 0.02 &&
      Math.abs(out.pos[2] - o.pos[2]) < 0.02 &&
      Math.abs(out.xAxis[0] - 1) < 0.05 && Math.abs(out.zAxis[2] - 1) < 0.05 &&
      (o.refs === undefined || out.refs === o.refs) &&
      (o.confident === undefined || out.confident === o.confident);
  } else {                                    // 'size-warning': loud failure + correct suggestion
    const m = (out.stats && out.stats.rejWhy || '').match(/set marker size ≈ (\d+) mm/);
    ok = errors.length === 0 && !out.anchored && !!m && Math.abs(+m[1] - 140) < 12;
    if (m) console.log('[' + o.name + '] suggested size:', m[1], 'mm (truth 140)');
  }
  console.log('[' + o.name + ']', ok ? 'PASS' : 'FAIL');
  await browser.close();
  return ok;
}
(async () => {
  // seam guard: the core modules embedded in ars-m3.html must be VERBATIM
  // copies of /src/ — a drifted embed means the audited core and the shipped
  // core disagree, which is exactly the failure this harness exists to catch.
  {
    const html = fs.readFileSync(path.join(REF, 'ars-m3.html'), 'utf8');
    for (const name of ['mat4.js', 'eigen.js', 'classes.js', 'manifest.js', 'solve.js']) {
      const open = '<script type="text/plain" data-ars-module="' + name + '">\n';
      const i = html.indexOf(open);
      const j = html.indexOf('</' + 'script>', i);
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', name), 'utf8');
      if (i < 0 || html.slice(i + open.length, j) !== src) {
        console.error('EMBED DRIFT: ' + name + ' in ars-m3.html is not the verbatim /src/ copy — re-embed it');
        process.exit(1);
      }
    }
  }
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  PORT = server.address().port;

  // the reference mat (assets/ars-mat-a4.pdf p.2): 80 mm markers at ±55/±85 mm
  // around the origin cross; here the mat lies on the plane z=-0.5 with its
  // origin at world (0, 0.1, -0.5), so each marker sits at origin + matPose.
  const MAT = [
    { id: 7,   x: -0.055, y: 0.185, size: 0.08 },
    { id: 23,  x:  0.055, y: 0.185, size: 0.08 },
    { id: 98,  x: -0.055, y: 0.015, size: 0.08 },
    { id: 133, x:  0.055, y: 0.015, size: 0.08 },
  ];
  const results = [];
  // ad-hoc path (id 3: reference range, NOT in the manifest → per-marker root,
  // user-entered size — the v1.0 behavior, still the merge-gate baseline)
  results.push(await runScenario({ name: 'adhoc-correct', target: 3, expect: 'anchored',
    markers: [{ id: 3, x: 0, y: 0.1, size: 0.14 }], msize: 140, pos: [0, 0.1, -0.5] }));
  results.push(await runScenario({ name: 'adhoc-wrong-size', target: 3, expect: 'size-warning',
    markers: [{ id: 3, x: 0, y: 0.1, size: 0.14 }], msize: 100 }));
  // the datum (§4.3 gate → §6 solve): manifest ids fuse into ONE root whose
  // pose is the MAT ORIGIN (the printed cross), not any single marker
  results.push(await runScenario({ name: 'mat-datum', target: 'mat', expect: 'anchored',
    markers: MAT, msize: 140, pos: [0, 0.1, -0.5], refs: 4, confident: true }));
  results.push(await runScenario({ name: 'mat-single-ref', target: 'mat', expect: 'anchored',
    markers: [MAT[0]], msize: 140, pos: [0, 0.1, -0.5], refs: 1, confident: false }));

  server.close();
  const all = results.every(Boolean);
  console.log(all ? 'E2E: ALL PASS — ad-hoc anchors; wrong size fails LOUDLY; the mat fuses to ONE datum at the printed origin'
                  : 'E2E: FAIL');
  process.exit(all ? 0 : 1);
})().catch(e => { console.error('HARNESS:', e); process.exit(1); });
