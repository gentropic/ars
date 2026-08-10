// xr smoke — the stage-2b anchored tier: the REAL viewer page runs its WebXR
// path against a stubbed WebXR API (adapted from webxr/harness/e2e-m3.js —
// same bottom-up camera texture, ripening hit-tests, anchors), receives a
// scene over a fake room, grounds on the stubbed mat, plants ONE anchor, and
// reports its pose back. npm i (playwright, repo root), then: node xr-smoke.mjs
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

// WebXR stub: session + frames + bottom-up camera texture + hit-test +
// anchors, with the surface three r184's WebXRManager touches (XRWebGLLayer
// framebuffer metrics, removeEventListener, enabledFeatures sans 'layers').
// Geometry: camera at origin looking down -Z; the mat lies on z=-0.5 with its
// origin at world (0, 0.1, -0.5); markers per __MARKERS.
const STUB = `
(() => { try {
  const FY = 1786, CAMW = 886, CAMH = 1920;
  const proj = new Float32Array(16);
  proj[0] = FY/(CAMW/2); proj[5] = FY/(CAMH/2);
  proj[10] = -1.001; proj[11] = -1; proj[14] = -0.02;
  const IDENT = new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);

  function makeCameraCanvas(dic){
    const c = document.createElement('canvas'); c.width = CAMW; c.height = CAMH;
    const g = c.getContext('2d');
    g.fillStyle = '#787878'; g.fillRect(0, 0, CAMW, CAMH);
    const WORLDZ = 0.5;
    const MS = dic.markSize, PAY = MS - 2;
    for (const mk of (window.__MARKERS || [])){
      const blackPx = FY * mk.size / WORLDZ;
      const cell = blackPx / MS, total = cell * (MS + 2);
      const x0 = CAMW/2 + FY * mk.x / WORLDZ - total/2;
      const y0 = CAMH/2 - FY * mk.y / WORLDZ - total/2;
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
    constructor(){ this.framebuffer = null;
      this.framebufferWidth = 800; this.framebufferHeight = 600; }
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
        // ARCore camera textures are BOTTOM-UP: upload flipped so the
        // page's camFlip default is exercised for real
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, window.__camCanvas);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
      return camTex;
    }
  }
  if (window.WebGL2RenderingContext)
    WebGL2RenderingContext.prototype.makeXRCompatible = function(){ return Promise.resolve(); };
  window.XRRay = XRRay; window.XRRigidTransform = XRRigidTransform;
  window.XRWebGLLayer = XRWebGLLayer; window.XRWebGLBinding = XRWebGLBinding;

  const view = {
    camera: { width: CAMW, height: CAMH },
    projectionMatrix: proj,
    transform: { matrix: IDENT, inverse: { matrix: IDENT }, position: { x: 0, y: 0, z: 0 } },
  };
  const s = Math.sin(-Math.PI/4), c = Math.cos(-Math.PI/4);
  const planePose = new XRRigidTransform({ x: 0, y: 0, z: -0.5 }, { x: s, y: 0, z: 0, w: c });

  const anchors = [];
  const rafQ = [];
  const session = {
    enabledFeatures: ['local','camera-access','hit-test','anchors','dom-overlay'],
    renderState: {},
    updateRenderState(st){ Object.assign(this.renderState, st); },
    addEventListener(){}, removeEventListener(){}, end(){},
    requestReferenceSpace: async (t) => ({ _ref: t }),
    requestAnimationFrame: (cb) => { rafQ.push(cb); },
    requestHitTestSource: async (opts) => ({ _ray: opts.offsetRay, _age: 0, cancel(){} }),
  };
  const frame = {
    session,
    getViewerPose: () => ({ views: [view], transform: new XRRigidTransform() }),
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
    return { anchors: anchors.length };
  };
  window.__initCam = () => {
    window.__camCanvas = makeCameraCanvas(new window.AR.Dictionary('ARUCO_MIP_36h12'));
  };
} catch (e) { window.__stubErr = e.message; } })();
`;

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
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // mat markers in world coords: origin at (0, 0.1, -0.5) + matPose offsets
  const MARKERS = [
    { id: 7,   x: -0.055, y: 0.185, size: 0.08 },
    { id: 23,  x:  0.055, y: 0.185, size: 0.08 },
    { id: 98,  x: -0.055, y: 0.015, size: 0.08 },
    { id: 133, x:  0.055, y: 0.015, size: 0.08 },
  ];
  await page.addInitScript('window.__MARKERS = ' + JSON.stringify(MARKERS) + ';');
  await page.addInitScript(STUB);
  await page.goto(`http://127.0.0.1:${port}/web/viewer.html`);
  await page.waitForFunction('!!window.__viewerXR');
  await page.waitForFunction('!document.getElementById("start-ar").hidden', { timeout: 5000 });
  chk('AR tier offered when immersive-ar is supported', true);

  // scene over the fake wire, then enter AR
  await page.evaluate(`(async () => {
    const { makeFakeRoomPair } = await import('/studio/harness/fake-room.js');
    const { createSync } = await import('/studio/src/sync.js');
    const { createStore } = await import('/studio/src/store.js');
    const pair = makeFakeRoomPair();
    const astore = createStore();
    const lid = astore.newId();
    astore.upsert({ id: lid, kind: 'layer', name: 'L' });
    astore.upsert({ id: astore.newId(), kind: 'box', name: 'b', layer: lid,
                    t: [0, 0, 0], props: { w: 0.05, d: 0.05, h: 0.05, solid: true } });
    astore.upsert({ id: astore.newId(), kind: 'axes', name: 'a', layer: lid,
                    t: [0.06, 0, 0], props: { size: 0.05 } });
    // a small condenser deposit (SwiftShader-friendly grid) — exercises the
    // §3.1 mount inside the XR loop
    astore.upsert({ id: astore.newId(), kind: 'blocks', name: 'dep', layer: lid,
                    t: [-0.06, 0, 0], props: { seed: 7, ni: 12, nj: 12, nk: 6, cutoff: 0, footprint: 0.06 } });
    window.__gotPose = null;
    createSync(astore, pair.a, { role: 'authority',
      onPose: (id, p) => { window.__gotPose = p; } });
    window.__viewerXR.joinWith(pair.b);
    pair.connect();
    window.__initCam();
  })()`);
  await page.click('#start-ar');
  await page.waitForTimeout(400);               // setSession + reference spaces

  for (let burst = 0; burst < 15; burst++) {
    await page.evaluate('window.__pump(6)');
    await new Promise((r) => setTimeout(r, 30));
  }

  const out = await page.evaluate(`(() => {
    if (window.__stubErr) return { fail: 'stub: ' + window.__stubErr };
    const v = window.__viewerXR;
    const g = v.ground();
    if (!g) return { fail: 'no ground' };
    const M = v.content.matrix.elements;
    return {
      mode: v.mode(),
      objects: v.store.all().length,
      nodes: v.content.children.length,
      visible: v.content.visible,
      anchored: !!g.group.anchor, refs: g.group.refs, confident: g.group.confident,
      fusOk: g.stats.fusOk, rej: g.stats.rejWhy,
      pos: [M[12], M[13], M[14]].map((x) => +x.toFixed(4)),
      xAxis: [M[0], M[1], M[2]].map((x) => +x.toFixed(3)),
      zAxis: [M[8], M[9], M[10]].map((x) => +x.toFixed(3)),
      gotPose: window.__gotPose ? window.__gotPose.map((x) => +x.toFixed(3)) : null,
      blocks: v.blocksStats(),
    };
  })()`);
  console.log('  ', JSON.stringify(out));
  chk('entered XR mode', out.mode === 'xr');
  chk('scene received over the wire', out.objects === 4 && out.nodes === 3);
  chk('condenser mount drew in the XR loop', !!out.blocks && out.blocks.drawn > 0,
    JSON.stringify(out.blocks));
  chk('grounded: fused + world-anchored', out.fusOk >= 2 && out.anchored, out.rej || '');
  chk('datum is confident (4 refs)', out.refs === 4 && out.confident);
  chk('datum at the printed origin',
    out.visible &&
    Math.abs(out.pos[0]) < 0.02 && Math.abs(out.pos[1] - 0.1) < 0.02 && Math.abs(out.pos[2] + 0.5) < 0.02 &&
    Math.abs(out.xAxis[0] - 1) < 0.05 && Math.abs(out.zAxis[2] - 1) < 0.05,
    JSON.stringify(out.pos));
  chk('viewer pose reached the authority',
    !!out.gotPose && Math.abs(out.gotPose[13] + 0.1) < 0.03 && Math.abs(out.gotPose[14] - 0.5) < 0.03,
    JSON.stringify(out.gotPose));
  chk('no page errors', errors.length === 0, errors.join('; '));

  const shot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'xr-out.png');
  await page.screenshot({ path: shot });
  console.log('     screenshot →', shot);

  await browser.close();
  server.close();
  console.log(fails ? `XR SMOKE: ${fails} FAILURES` : 'XR SMOKE: ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS:', e); server.close(); process.exit(1); });
