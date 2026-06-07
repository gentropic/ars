import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mat4 } from '../src/mat4.js';
import { solveRigid, solveDatum, markerCorners } from '../src/solve.js';

const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };

// a non-trivial known rigid transform
const T_known = mat4.multiply(mat4.fromRT(rotZ(0.6), [1.5, -2.0, 0.7]), mat4.fromRT(rotY(-0.4), [0, 0, 0]));

test('solveRigid recovers a known transform from 3D point correspondences', () => {
  const from = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1], [-1, 2, 0.5]];
  const to = from.map((p) => mat4.transformPoint(T_known, p));
  const T = solveRigid(from, to);
  assert.ok(mat4.approxEqual(T, T_known, 1e-7));
});

test('solveRigid handles a COPLANAR constellation (markers on one flat sheet)', () => {
  // all points on z = 0 — the case Horn handles where Kabsch needs reflection fixups
  const from = [[-0.05, -0.05, 0], [0.05, -0.05, 0], [0.05, 0.05, 0], [-0.05, 0.05, 0],
    [0.25, 0, 0], [0.25, 0.1, 0], [0.35, 0.1, 0], [0.35, 0, 0]];
  const to = from.map((p) => mat4.transformPoint(T_known, p));
  const T = solveRigid(from, to);
  for (const p of from) {
    assert.ok(vecClose(mat4.transformPoint(T, p), mat4.transformPoint(T_known, p), 1e-7));
  }
});

test('solveRigid is robust to small noise (least-squares fit)', () => {
  const from = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1]];
  // deterministic tiny perturbation (no Math.random — keep tests reproducible)
  const jitter = [0.001, -0.001, 0.0008, -0.0007, 0.0009, -0.0005];
  const to = from.map((p, i) => {
    const q = mat4.transformPoint(T_known, p);
    return [q[0] + jitter[i], q[1] - jitter[i], q[2] + jitter[i] * 0.5];
  });
  const T = solveRigid(from, to);
  assert.ok(mat4.approxEqual(T, T_known, 5e-3)); // close, within the noise budget
});

test('solveRigid throws with fewer than 3 correspondences', () => {
  assert.throws(() => solveRigid([[0, 0, 0], [1, 0, 0]], [[0, 0, 0], [1, 0, 0]]), /≥3/);
});

test('markerCorners places a marker on its own plane', () => {
  const corners = markerCorners(mat4.identity(), 0.1);
  assert.deepEqual(corners, [[-0.05, -0.05, 0], [0.05, -0.05, 0], [0.05, 0.05, 0], [-0.05, 0.05, 0]]);
});

test('solveDatum recovers T_rig from a multi-reference constellation (§6)', () => {
  // three reference markers at known mat-space poses (a desk-scale layout)
  const refsMat = [
    mat4.fromRT(rotZ(0), [0, 0, 0]),       // origin marker
    mat4.fromRT(rotZ(0), [0.3, 0, 0]),     // 30 cm to the right
    mat4.fromRT(rotX(0.05), [0, 0.25, 0]), // 25 cm forward, slight tilt
  ];
  const T_rig = mat4.multiply(mat4.fromRT(rotY(0.7), [2, 1, -3]), mat4.fromRT(rotX(0.3), [0, 0, 0]));
  const references = refsMat.map((matPose) => ({
    matPose,
    observedPose: mat4.multiply(T_rig, matPose), // marker as seen in the observation frame
    size: 0.1,
  }));

  const datum = solveDatum(references);
  assert.equal(datum.count, 3);
  assert.ok(datum.confident);
  assert.ok(mat4.approxEqual(datum.transform, T_rig, 1e-6));
});

test('solveDatum: a lone reference bootstraps but is flagged low-confidence (§6.3)', () => {
  const matPose = mat4.fromRT(rotZ(0.2), [0, 0, 0]);
  const T_rig = mat4.fromRT(rotY(0.5), [1, 0, -2]);
  const datum = solveDatum([{ matPose, observedPose: mat4.multiply(T_rig, matPose), size: 0.1 }]);
  assert.equal(datum.count, 1);
  assert.ok(!datum.confident);
  assert.ok(datum.transform !== null); // still returns a usable estimate
});

test('solveDatum with no references returns null', () => {
  const datum = solveDatum([]);
  assert.equal(datum.transform, null);
  assert.equal(datum.count, 0);
  assert.ok(!datum.confident);
});

function vecClose(a, b, eps) {
  return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps && Math.abs(a[2] - b[2]) <= eps;
}
