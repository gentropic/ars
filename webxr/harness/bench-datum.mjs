// bench-datum.mjs — characterize @gcu/ars's homegrown registration (Horn datum
// solve, SPEC §6) on synthetic constellations that match its real use: coplanar
// reference markers printed on one sheet, observed with noisy poses.
//
// Ground truth: a random rigid T (mat → observation). Observations are the mat
// poses pushed through T, then perturbed per-corner with Gaussian noise of a
// given σ (meters) — a stand-in for detector corner error at ~0.5 m.
// Compared: solveDatum over the constellation vs single-correspondence
// registration (the §6.3 ambiguity case).
// upstream core: the repo root two levels up (or set ARS_REPO to a checkout).
const { mat4, solveDatum, markerCorners, solveRigid } = await import((process.env.ARS_REPO || '../..') + '/src/main.js');

const rand = (() => { let s = 42; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
const gauss = () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

function rotXYZ(a, b, c) {
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  const Rx = [1, 0, 0, 0, ca, -sa, 0, sa, ca];
  const Ry = [cb, 0, sb, 0, 1, 0, -sb, 0, cb];
  const Rz = [cc, -sc, 0, sc, cc, 0, 0, 0, 1];
  const mul = (p, q) => { const o = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i*3+j] = p[i*3]*q[j] + p[i*3+1]*q[3+j] + p[i*3+2]*q[6+j]; return o; };
  return mul(Rz, mul(Ry, Rx));
}
const T_true = mat4.fromRT(rotXYZ(0.4, -0.7, 1.1), [0.35, -0.15, -0.9]);

// coplanar sheet layout: markers on z=0 in mat space, 100 mm, spread on A3-ish
const LAYOUT = [
  [0, 0], [0.28, 0], [0, 0.19], [0.28, 0.19], [0.14, 0.095], [0.14, 0.19],
].map(([x, y]) => mat4.fromRT([1,0,0, 0,1,0, 0,0,1], [x, y, 0]));

const SIZE = 0.1;

function rotErrDeg(Ta, Tb) {
  // relative rotation angle between the two transforms' rotation parts
  let tr = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tr += Ta[j*4+i] * Tb[j*4+i]; // Raᵀ·Rb trace
  return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180 / Math.PI;
}
const transErrMm = (Ta, Tb) => Math.hypot(Ta[12]-Tb[12], Ta[13]-Tb[13], Ta[14]-Tb[14]) * 1000;

// noisy observed pose for one marker: corners through T_true + noise, refit a pose
// (this mimics a detector: it reports a pose consistent with noisy corners)
function observe(matPose, sigma) {
  const mc = markerCorners(matPose, SIZE);
  const noisy = mc.map((p) => {
    const q = mat4.transformPoint(T_true, p);
    return [q[0] + gauss() * sigma, q[1] + gauss() * sigma, q[2] + gauss() * sigma];
  });
  const local = markerCorners(matPose, SIZE); // fit local→noisy? no: fit marker-local frame
  const h = SIZE / 2;
  const cornersLocal = [[-h,-h,0],[h,-h,0],[h,h,0],[-h,h,0]];
  const markerLocalToObs = solveRigid(cornersLocal, noisy);      // observed marker pose
  return markerLocalToObs;
}
// marker mat pose is identity-rotation at layout offset; observedPose must be the
// MARKER's pose in obs frame — cornersLocal→noisy fit gives exactly that when
// matPose has identity rotation (marker-local == mat-local + offset)… but our
// matPose includes the offset in translation only, so marker-local frame == matPose
// frame translated; recompute: observedPose = fit(markerCorners(matPose)→noisy)
function observePose(matPose, sigma) {
  const mc = markerCorners(matPose, SIZE);
  const noisy = mc.map((p) => {
    const q = mat4.transformPoint(T_true, p);
    return [q[0] + gauss() * sigma, q[1] + gauss() * sigma, q[2] + gauss() * sigma];
  });
  // pose P with markerCorners(P) ≈ noisy: P = fit(cornersLocal→noisy) since
  // markerCorners(P) transforms cornersLocal by P.
  const h = SIZE / 2;
  const cornersLocal = [[-h,-h,0],[h,-h,0],[h,h,0],[-h,h,0]];
  return solveRigid(cornersLocal, noisy);
}

console.log('T_true fixed; 200 trials per cell; noise σ per corner coordinate.\n');
console.log('A. DATUM SOLVE — error vs marker count and noise (median over trials)');
console.log('markers  σ=0.5mm            σ=2mm              σ=5mm');
for (const n of [1, 2, 3, 4, 6]) {
  const row = [String(n).padEnd(9)];
  for (const sigma of [0.0005, 0.002, 0.005]) {
    const re = [], te = [];
    for (let t = 0; t < 200; t++) {
      const refs = LAYOUT.slice(0, n).map((mp) => ({ matPose: mp, observedPose: observePose(mp, sigma), size: SIZE }));
      const { transform } = solveDatum(refs, { size: SIZE });
      re.push(rotErrDeg(transform, T_true)); te.push(transErrMm(transform, T_true));
    }
    const med = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];
    row.push((med(re).toFixed(2) + '° ' + med(te).toFixed(1) + 'mm').padEnd(19));
  }
  console.log(row.join(''));
}

console.log('\nB. SPEED — solveDatum wall time (median of 500)');
for (const n of [1, 2, 4, 6]) {
  const refs = LAYOUT.slice(0, n).map((mp) => ({ matPose: mp, observedPose: observePose(mp, 0.002), size: SIZE }));
  const times = [];
  for (let i = 0; i < 500; i++) {
    const t0 = process.hrtime.bigint();
    solveDatum(refs, { size: SIZE });
    times.push(Number(process.hrtime.bigint() - t0) / 1e3);
  }
  times.sort((a, b) => a - b);
  console.log(n + ' markers: ' + times[250].toFixed(1) + ' µs');
}
