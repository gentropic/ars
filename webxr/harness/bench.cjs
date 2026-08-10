// bench.cjs — characterize the vendored js-aruco2 detector for ars.
// Synthetic camera frames (886×1920, like the S24+ XRCamera), marker(s)
// rendered at physically-derived pixel sizes, then downscaled to the
// readback resolution ars would actually detect on. Reports detect ms
// (median of N), success, and corner error vs ground truth.
const fs = require('fs'), vm = require('vm');
const ctx = { console }; vm.createContext(ctx);
for (const f of ['svd.js', 'cv.js', 'aruco.js', 'posit1.js'])
  vm.runInContext(fs.readFileSync(__dirname + '/../../vendor/js-aruco2/' + f, 'utf8'), ctx, { filename: f });
const { AR } = ctx;

const CAMW = 886, CAMH = 1920, FY = 1786;

// ── tiny raster kit (no canvas in node) ─────────────────────────────────
function makeFrame() {
  const d = new Uint8ClampedArray(CAMW * CAMH * 4);
  for (let i = 0; i < CAMW * CAMH; i++) { d[i*4] = d[i*4+1] = d[i*4+2] = 118; d[i*4+3] = 255; }
  return { width: CAMW, height: CAMH, data: d };
}
function drawMarker(frame, dic, id, cxPx, cyPx, blackPx) {
  const cell = blackPx / 7, total = cell * 9, code = dic.codeList[id];
  const x0 = cxPx - total / 2, y0 = cyPx - total / 2;
  const put = (x, y, v) => {
    if (x < 0 || y < 0 || x >= CAMW || y >= CAMH) return;
    const i = (y * CAMW + x) * 4; frame.data[i] = frame.data[i+1] = frame.data[i+2] = v;
  };
  for (let py = 0; py < total; py++) for (let px = 0; px < total; px++) {
    const cx = Math.floor(px / cell), cy = Math.floor(py / cell);
    let v = 255;
    if (cx >= 1 && cx < 8 && cy >= 1 && cy < 8) v = 0;
    const bx = cx - 2, by = cy - 2;
    if (bx >= 0 && bx < 5 && by >= 0 && by < 5) v = code[by * 5 + bx] === '1' ? 255 : 0;
    put(Math.round(x0 + px), Math.round(y0 + py), v);
  }
}
function downscale(frame, s) {                    // box-average
  const W = Math.round(CAMW * s), H = Math.round(CAMH * s);
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.floor(x / s), x1 = Math.min(CAMW, Math.ceil((x + 1) / s));
    const y0 = Math.floor(y / s), y1 = Math.min(CAMH, Math.ceil((y + 1) / s));
    let acc = 0, n = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { acc += frame.data[(yy * CAMW + xx) * 4]; n++; }
    const i = (y * W + x) * 4; out[i] = out[i+1] = out[i+2] = acc / n; out[i+3] = 255;
  }
  return { width: W, height: H, data: out };
}
function boxBlur(img, r) {                        // separable box blur radius r (px)
  if (!r) return img;
  const { width: W, height: H } = img;
  const a = new Float32Array(W * H), b = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) a[i] = img.data[i * 4];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let acc = 0, n = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < W) { acc += a[y * W + xx]; n++; } }
    b[y * W + x] = acc / n;
  }
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let acc = 0, n = 0;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < H) { acc += b[yy * W + x]; n++; } }
    const i = (y * W + x) * 4; out[i] = out[i+1] = out[i+2] = acc / n; out[i+3] = 255;
  }
  return { width: W, height: H, data: out };
}
const median = (xs) => { const s = [...xs].sort((p, q) => p - q); return s[s.length >> 1]; };

// ── the runs ────────────────────────────────────────────────────────────
const dic = new AR.Dictionary('ARUCO');
const REPS = 15;
function bench(img, expectIds, expectCenters, scale) {
  const det = new AR.Detector({ dictionaryName: 'ARUCO' });
  const times = [];
  let markers = [];
  for (let i = 0; i < REPS; i++) {
    const t0 = process.hrtime.bigint();
    markers = det.detect(img);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const ids = markers.map(m => m.id).sort((a, b) => a - b);
  const found = expectIds.every(id => ids.includes(id)) && ids.length === expectIds.length;
  let cornerErr = null;
  if (found && expectCenters) {
    cornerErr = 0;
    for (const m of markers) {
      const gc = expectCenters[m.id];
      const cx = m.corners.reduce((s, c) => s + c.x, 0) / 4, cy = m.corners.reduce((s, c) => s + c.y, 0) / 4;
      cornerErr = Math.max(cornerErr, Math.hypot(cx - gc[0] * scale, cy - gc[1] * scale));
    }
  }
  return { ms: median(times), found, ids: ids.join(','), errPx: cornerErr };
}

console.log('marker: 140 mm @ 0.45 m (ars typical) → ' + Math.round(FY * 0.14 / 0.45) + ' px in the camera frame\n');

// A. resolution sweep — the DETECT_SCALE knob
console.log('A. RESOLUTION SWEEP (single marker id 7, centered, sharp)');
console.log('scale   readback     marker px   detect ms   found   center err');
{
  const f = makeFrame();
  const blackPx = FY * 0.14 / 0.45;
  drawMarker(f, dic, 7, CAMW / 2, CAMH / 2, blackPx);
  for (const s of [0.15, 0.20, 0.25, 0.30, 0.40, 0.50]) {
    const img = downscale(f, s);
    const r = bench(img, [7], { 7: [CAMW / 2, CAMH / 2] }, s);
    console.log(
      s.toFixed(2).padEnd(8) + (img.width + '×' + img.height).padEnd(13) +
      Math.round(blackPx * s).toString().padEnd(12) + r.ms.toFixed(1).padEnd(12) +
      (r.found ? 'yes' : 'NO ').padEnd(8) + (r.errPx == null ? '—' : r.errPx.toFixed(1) + ' px'));
  }
}

// B. distance sweep at the shipped scale 0.30
console.log('\nB. DISTANCE SWEEP (scale 0.30, id 7)');
console.log('dist    marker px(rb)   detect ms   found');
for (const dist of [0.3, 0.45, 0.7, 1.0, 1.5, 2.0]) {
  const f = makeFrame();
  const blackPx = FY * 0.14 / dist;
  drawMarker(f, dic, 7, CAMW / 2, CAMH / 2, blackPx);
  const img = downscale(f, 0.30);
  const r = bench(img, [7], null, 0.30);
  console.log(dist.toFixed(2).padEnd(8) + Math.round(blackPx * 0.30).toString().padEnd(16) +
              r.ms.toFixed(1).padEnd(12) + (r.found ? 'yes' : 'NO'));
}

// C. blur sensitivity (motion blur stand-in) at 0.45 m, scale 0.30
console.log('\nC. BLUR SWEEP (scale 0.30, id 7 vs id 0, 0.45 m; radius in readback px)');
console.log('blur r   id 7 found   id 0 found   detect ms');
for (const r of [0, 1, 2, 3, 4]) {
  const mk = (id) => {
    const f = makeFrame();
    drawMarker(f, dic, id, CAMW / 2, CAMH / 2, FY * 0.14 / 0.45);
    return boxBlur(downscale(f, 0.30), r);
  };
  const r7 = bench(mk(7), [7], null, 0.30);
  const r0 = bench(mk(0), [0], null, 0.30);
  console.log(String(r).padEnd(9) + (r7.found ? 'yes' : 'NO ').padEnd(13) +
              (r0.found ? 'yes' : 'NO ').padEnd(13) + r7.ms.toFixed(1));
}

// D. multi-marker cost (the four-quadrant sheet plan), scale 0.30
console.log('\nD. MULTI-MARKER (scale 0.30, 1.2 m, ids 1/2/3/4 in quadrants)');
// NB: first draft placed this at 0.6 m — the frame is only ~0.30 m wide
// there, so four 140 mm markers physically overlapped. Detector exonerated.
{
  const f = makeFrame();
  const blackPx = FY * 0.14 / 1.2;
  const centers = { 1: [CAMW * 0.30, CAMH * 0.32], 2: [CAMW * 0.70, CAMH * 0.32],
                    3: [CAMW * 0.30, CAMH * 0.68], 4: [CAMW * 0.70, CAMH * 0.68] };
  for (const [id, [cx, cy]] of Object.entries(centers)) drawMarker(f, dic, +id, cx, cy, blackPx);
  const img = downscale(f, 0.30);
  const r = bench(img, [1, 2, 3, 4], centers, 0.30);
  console.log('found ids: ' + r.ids + '  | detect ' + r.ms.toFixed(1) + ' ms | max center err ' +
              (r.errPx == null ? '—' : r.errPx.toFixed(1) + ' px'));
}
