// bench-magicwindow.mjs — the regime the other benches skip: NO plane source
// (plain webcam). Per-marker POSIT (with its real ambiguity flips) feeds
// solveDatum. Question: does the constellation dilute the flips, and does a
// residual gate (drop the worst-fitting marker, re-solve) rescue it?
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
// upstream core: the repo root two levels up (or set ARS_REPO to a checkout)
const { mat4, solveDatum, markerCorners } = await import((process.env.ARS_REPO || '../..') + '/src/main.js');

const ctx = { console }; ctx.window = ctx; vm.createContext(ctx);
for (const f of ['svd.js', 'cv.js', 'aruco.js', 'posit1.js'])
  vm.runInContext(fs.readFileSync(fileURLToPath(new URL('../../vendor/js-aruco2/' + f, import.meta.url)), 'utf8'), ctx, { filename: f });
const POS = ctx.POS;

const F = 700, SIZE = 0.1, h = SIZE / 2, DIST = 0.6;
const LOCAL = [[-h, h, 0], [h, h, 0], [h, -h, 0], [-h, -h, 0]];   // TL,TR,BR,BL
const LAYOUT = [[0,0],[0.28,0],[0,0.19],[0.28,0.19],[0.14,0.095],[0.14,0.19]]
  .map(([x, y]) => [x - 0.14, y - 0.095]);                        // centered sheet

let seed = 99;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const gauss = () => { let u=0,v=0; while(!u)u=rand(); while(!v)v=rand(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };
const rotX = (t) => [1,0,0, 0,Math.cos(t),-Math.sin(t), 0,Math.sin(t),Math.cos(t)];
const apply = (R,p) => [R[0]*p[0]+R[1]*p[1]+R[2]*p[2], R[3]*p[0]+R[4]*p[1]+R[5]*p[2], R[6]*p[0]+R[7]*p[1]+R[8]*p[2]];
const rotErrDeg = (Ta, Tb) => {
  let tr = 0; for (let i=0;i<3;i++) for (let j=0;j<3;j++) tr += Ta[j*4+i]*Tb[j*4+i];
  return Math.acos(Math.max(-1, Math.min(1, (tr-1)/2))) * 180/Math.PI;
};
const med = (xs) => [...xs].sort((a,b)=>a-b)[xs.length>>1];
const p90 = (xs) => [...xs].sort((a,b)=>a-b)[Math.floor(xs.length*0.9)];

function residualGate(refs, opts) {                    // drop worst marker, re-solve
  let { transform } = solveDatum(refs, opts);
  if (refs.length < 3) return transform;
  const rms = refs.map(r => {
    const mc = markerCorners(r.matPose, SIZE).map(p => mat4.transformPoint(transform, p));
    const oc = markerCorners(r.observedPose, SIZE);
    let s = 0; for (let i=0;i<4;i++) s += (mc[i][0]-oc[i][0])**2 + (mc[i][1]-oc[i][1])**2 + (mc[i][2]-oc[i][2])**2;
    return Math.sqrt(s/4);
  });
  const m = med(rms);
  const keep = refs.filter((_, i) => rms[i] < Math.max(3*m, 0.004));
  if (keep.length >= 2 && keep.length < refs.length) transform = solveDatum(keep, opts).transform;
  return transform;
}

console.log('MAGIC-WINDOW regime: per-marker POSIT → solveDatum. 100mm markers @ 0.6m,');
console.log('sheet tilt θ vs camera, σ=0.5px corner noise, 300 trials. rot err median (p90).\n');
console.log('tilt   markers   plain datum        + residual gate');
for (const tiltDeg of [8, 20, 40]) {
  for (const n of [1, 2, 4, 6]) {
    const errP = [], errG = [];
    for (let t = 0; t < 300; t++) {
      const R = rotX(tiltDeg * Math.PI/180), T3 = [0, 0, DIST];
      const T_true = mat4.fromRT(R, T3);
      const refs = LAYOUT.slice(0, n).map(([ox, oy]) => {
        const matPose = mat4.fromRT([1,0,0,0,1,0,0,0,1], [ox, oy, 0]);
        const px = LOCAL.map(p => {
          const q = apply(R, [p[0]+ox, p[1]+oy, p[2]]);
          const w = [q[0]+T3[0], q[1]+T3[1], q[2]+T3[2]];
          return { x: F*w[0]/w[2] + gauss()*0.5, y: F*w[1]/w[2] + gauss()*0.5 };
        });
        const pose = new POS.Posit(SIZE, F).pose(px);
        // POSIT gives the MARKER's pose; its model is the marker's own square, so
        // the recovered pose is marker-local→camera. Express in mat terms:
        // observedPose = that pose (the datum solve only needs both frames'
        // corners; matPose carries the sheet offset).
        return { matPose, observedPose: mat4.fromRT(pose.bestRotation.flat(), pose.bestTranslation), size: SIZE };
      });
      errP.push(rotErrDeg(solveDatum(refs, { size: SIZE }).transform, T_true));
      errG.push(rotErrDeg(residualGate(refs, { size: SIZE }), T_true));
    }
    console.log(String(tiltDeg + '°').padEnd(7) + String(n).padEnd(10) +
      (med(errP).toFixed(2) + '° (' + p90(errP).toFixed(1) + '°)').padEnd(19) +
      med(errG).toFixed(2) + '° (' + p90(errG).toFixed(1) + '°)');
  }
  console.log('');
}
