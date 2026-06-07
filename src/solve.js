// solve.js — the datum solve (SPEC §6). Fuse a constellation of reference markers
// into one robust rigid transform between mat space and an observation frame.
//
// Method: Horn's quaternion absolute-orientation (closed-form least-squares rigid
// registration). Chosen over Kabsch-SVD because it needs only a symmetric eigensolver
// and a unit quaternion is always a proper rotation — no reflection correction, no
// zero-singular-value handling, so it stays robust on the COPLANAR marker
// constellations ars typically sees (markers printed on one flat sheet). We register
// on marker CORNER points (4 per marker): two markers already give 8 well-spread
// correspondences, which resolves the single-marker planar ambiguity (§6.3).

import { mat4, vec3 } from './mat4.js';
import { symmetricEig, argmax } from './eigen.js';

function centroid(pts) {
  const c = [0, 0, 0];
  for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  const n = pts.length || 1;
  return [c[0] / n, c[1] / n, c[2] / n];
}

// Unit quaternion (w, x, y, z) → row-major 3×3 rotation.
function quatToRot(q) {
  let [w, x, y, z] = q;
  const n = Math.hypot(w, x, y, z) || 1;
  w /= n; x /= n; y /= n; z /= n;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

function applyRot(r9, v) {
  return [
    r9[0] * v[0] + r9[1] * v[1] + r9[2] * v[2],
    r9[3] * v[0] + r9[4] * v[1] + r9[5] * v[2],
    r9[6] * v[0] + r9[7] * v[1] + r9[8] * v[2],
  ];
}

// Least-squares rigid transform T such that  to_i ≈ T · from_i  (returns a 4×4).
// Needs ≥3 correspondences (a single marker's 4 corners qualify). Throws otherwise.
export function solveRigid(from, to) {
  const n = from.length;
  if (n !== to.length) throw new Error('ars: solveRigid needs matching point counts');
  if (n < 3) throw new Error('ars: solveRigid needs ≥3 correspondences');

  const cf = centroid(from);
  const ct = centroid(to);

  // M[a][b] = Σ (from_i − cf)[a] · (to_i − ct)[b]
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    const f = [from[i][0] - cf[0], from[i][1] - cf[1], from[i][2] - cf[2]];
    const t = [to[i][0] - ct[0], to[i][1] - ct[1], to[i][2] - ct[2]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[a][b] += f[a] * t[b];
  }

  // Horn's symmetric 4×4 from M; its top eigenvector is the optimal rotation quat.
  const Sxx = M[0][0], Sxy = M[0][1], Sxz = M[0][2];
  const Syx = M[1][0], Syy = M[1][1], Syz = M[1][2];
  const Szx = M[2][0], Szy = M[2][1], Szz = M[2][2];
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];

  const { values, vectors } = symmetricEig(N);
  const k = argmax(values);
  const q = [vectors[0][k], vectors[1][k], vectors[2][k], vectors[3][k]]; // (w, x, y, z)

  const R9 = quatToRot(q);
  const Rcf = applyRot(R9, cf);
  const t = [ct[0] - Rcf[0], ct[1] - Rcf[1], ct[2] - Rcf[2]];
  return mat4.fromRT(R9, t);
}

// The four corner points of a marker, given its pose (4×4) and printed edge length.
// Marker-local corners are (±s/2, ±s/2, 0) on the marker plane (CCW from lower-left).
export function markerCorners(pose, size) {
  const h = size / 2;
  const local = [[-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0]];
  return local.map((p) => mat4.transformPoint(pose, p));
}

// Solve the datum from a constellation of reference observations (§6).
//
// `references` — one entry per observed reference marker:
//   { matPose, observedPose, size? }
//   • matPose      (4×4): the marker's pose in MAT space (manifest, surveyed mode; or
//                          the frozen layout, discovered mode).
//   • observedPose (4×4): the marker's pose in the OBSERVATION frame. The caller puts
//                          it there: X·C for a WebXR rig (tracking space), or just C
//                          (detectorToMat output) for a marker-only magic-window.
//   • size (m): the marker's edge length (defaults to opts.size). Only needs to be
//               consistent between the two frames for the rigid fit; declared size
//               keeps it metric.
//
// Returns { transform, count, confident }:
//   • transform (4×4 | null): mat space → observation frame. For a WebXR rig this is
//     T_rig (tracking ← mat, §5.4). null when no references were given.
//   • count: how many references fused.
//   • confident: count ≥ 2 — a lone reference may bootstrap but is low-confidence
//     (§6.3), since its pose carries the two-fold planar ambiguity.
export function solveDatum(references, opts = {}) {
  const defaultSize = opts.size ?? 0.1;
  if (!references || !references.length) return { transform: null, count: 0, confident: false };

  const from = [];
  const to = [];
  for (const r of references) {
    const s = r.size ?? defaultSize;
    const mc = markerCorners(r.matPose, s);
    const oc = markerCorners(r.observedPose, s);
    for (let i = 0; i < 4; i++) { from.push(mc[i]); to.push(oc[i]); }
  }

  return {
    transform: solveRigid(from, to),
    count: references.length,
    confident: references.length >= 2,
  };
}
