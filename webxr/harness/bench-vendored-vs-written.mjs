// bench-vendored-vs-written.mjs — the honest head-to-head at the one layer where
// the vendored code (js-aruco2 POSIT: monocular 2D→pose) and the written code
// (@gcu/ars solveRigid: Horn 3D→3D) solve the same problem: one marker's pose.
//
// Setup mirrors ars-m3 at readback scale 0.30: focal 536 px, 140 mm marker at
// 0.5 m, tilted by θ about its horizontal axis. Corners projected, Gaussian
// pixel noise added. Three estimators on identical observations:
//   POSIT  — vendored, needs only 2D + focal (carries the planar ambiguity)
//   HORN   — written: rays ∩ known plane → 4×3D corners → solveRigid
//   M3     — today's ad-hoc basis (center mean, edge-mean x, plane normal z)
// HORN and M3 get the same true plane (what ARCore's hit-test supplies).
import fs from 'node:fs';
import vm from 'node:vm';
// upstream core: the repo root two levels up (or set ARS_REPO to a checkout).
import { fileURLToPath } from 'node:url';
const ARS_REPO = process.env.ARS_REPO || '../..';
const { mat4, solveRigid } = await import(ARS_REPO + '/src/main.js');

const ctx = { console }; ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['svd.js', 'cv.js', 'aruco.js', 'posit1.js'])
  vm.runInContext(fs.readFileSync(fileURLToPath(new URL('../../vendor/js-aruco2/' + f, import.meta.url)), 'utf8'), ctx, { filename: f });
const POS = ctx.POS;

const F = 536, DIST = 0.5, SIZE = 0.14, h = SIZE / 2;
// posit model corner order (TL,TR,BR,BL), y-up, z out of the printed face
const LOCAL = [[-h, h, 0], [h, h, 0], [h, -h, 0], [-h, -h, 0]];

let seed = 7;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const gauss = () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

const rotX = (t) => [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)];
const apply = (R, p) => [R[0]*p[0]+R[1]*p[1]+R[2]*p[2], R[3]*p[0]+R[4]*p[1]+R[5]*p[2], R[6]*p[0]+R[7]*p[1]+R[8]*p[2]];
const rotErrDeg = (A, B) => {           // both row-major 3×3
  let tr = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tr += A[i*3+j] * B[i*3+j];
  return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180 / Math.PI;
};
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const med = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const p90 = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.9)];

function trial(theta, sigmaPx) {
  const R = rotX(theta), t = [0, 0, DIST];
  const world = LOCAL.map(p => { const q = apply(R, p); return [q[0]+t[0], q[1]+t[1], q[2]+t[2]]; });
  const px = world.map(q => ({ x: F * q[0] / q[2] + gauss() * sigmaPx,
                               y: F * q[1] / q[2] + gauss() * sigmaPx }));
  const n = apply(R, [0, 0, 1]);                       // true plane normal
  const P0 = t;

  // POSIT (vendored)
  const posit = new POS.Posit(SIZE, F);
  let t0 = process.hrtime.bigint();
  const pose = posit.pose(px.map(c => ({ x: c.x, y: c.y })));
  const positUs = Number(process.hrtime.bigint() - t0) / 1e3;
  const positRot = rotErrDeg(pose.bestRotation.flat(), R);
  const positTrans = Math.hypot(pose.bestTranslation[0]-t[0], pose.bestTranslation[1]-t[1], pose.bestTranslation[2]-t[2]) * 1000;

  // rays ∩ true plane → 3D corners (shared by both written methods)
  const pts3 = px.map(c => {
    const d = norm([c.x / F, c.y / F, 1]);
    const s = dot([P0[0], P0[1], P0[2]], n) / dot(d, n);
    return [d[0]*s, d[1]*s, d[2]*s];
  });

  // HORN (written): solveRigid local→3D
  t0 = process.hrtime.bigint();
  const T = solveRigid(LOCAL, pts3);
  const hornUs = Number(process.hrtime.bigint() - t0) / 1e3;
  const hornR = [T[0], T[4], T[8], T[1], T[5], T[9], T[2], T[6], T[10]]; // col-major→row-major
  const hornRot = rotErrDeg(hornR, R);
  const hornTrans = Math.hypot(T[12]-t[0], T[13]-t[1], T[14]-t[2]) * 1000;

  // M3 ad-hoc basis (today's fusion construction), given the same true plane
  t0 = process.hrtime.bigint();
  const ctr = [0, 1, 2].map(i => (pts3[0][i]+pts3[1][i]+pts3[2][i]+pts3[3][i]) / 4);
  const eTop = [pts3[1][0]-pts3[0][0], pts3[1][1]-pts3[0][1], pts3[1][2]-pts3[0][2]];
  const eBot = [pts3[2][0]-pts3[3][0], pts3[2][1]-pts3[3][1], pts3[2][2]-pts3[3][2]];
  let x = norm([eTop[0]+eBot[0], eTop[1]+eBot[1], eTop[2]+eBot[2]]);
  x = norm([x[0]-n[0]*dot(n,x), x[1]-n[1]*dot(n,x), x[2]-n[2]*dot(n,x)]);
  const y = norm(cross(n, x));
  const m3Us = Number(process.hrtime.bigint() - t0) / 1e3;
  const m3R = [x[0], y[0], n[0], x[1], y[1], n[1], x[2], y[2], n[2]];
  const m3Rot = rotErrDeg(m3R, R);
  const m3Trans = Math.hypot(ctr[0]-t[0], ctr[1]-t[1], ctr[2]-t[2]) * 1000;

  return { positRot, positTrans, positUs, hornRot, hornTrans, hornUs, m3Rot, m3Trans, m3Us };
}

console.log('140 mm marker @ 0.5 m, focal 536 px (m3 readback geometry), 300 trials/cell.');
console.log('rot: median (p90) degrees | trans: median mm\n');
for (const sigma of [0.3, 1.0]) {
  console.log(`── pixel noise σ = ${sigma}px ──`);
  console.log('tilt   POSIT (vendored)        HORN (written)         M3 basis (written)');
  for (const deg of [2, 10, 25, 45]) {
    const rs = { p: [], pt: [], h: [], ht: [], m: [], mt: [] };
    for (let i = 0; i < 300; i++) {
      const r = trial(deg * Math.PI / 180, sigma);
      rs.p.push(r.positRot); rs.pt.push(r.positTrans);
      rs.h.push(r.hornRot); rs.ht.push(r.hornTrans);
      rs.m.push(r.m3Rot); rs.mt.push(r.m3Trans);
    }
    console.log(String(deg + '°').padEnd(7) +
      (med(rs.p).toFixed(1) + '° (' + p90(rs.p).toFixed(0) + '°) ' + med(rs.pt).toFixed(1) + 'mm').padEnd(24) +
      (med(rs.h).toFixed(2) + '° (' + p90(rs.h).toFixed(1) + '°) ' + med(rs.ht).toFixed(1) + 'mm').padEnd(23) +
      (med(rs.m).toFixed(2) + '° (' + p90(rs.m).toFixed(1) + '°) ' + med(rs.mt).toFixed(1) + 'mm'));
  }
  console.log('');
}
const r = trial(25 * Math.PI / 180, 0.5);
console.log('speed (single pose): POSIT ' + r.positUs.toFixed(0) + ' µs | HORN ' + r.hornUs.toFixed(1) + ' µs | M3 basis ' + r.m3Us.toFixed(1) + ' µs');
console.log('detect (vendored, prior bench, node): ~4.9 ms @ scale 0.30 — dwarfs all pose costs.');
