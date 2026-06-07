import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mat4 } from '../src/mat4.js';
import { solveLayout } from '../src/discovered.js';
import { solveDatum } from '../src/solve.js';

const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };

// ground-truth reference layout in some world frame (markers on/around a desk)
const GT = {
  0: mat4.fromRT(rotZ(0.0), [0.0, 0.0, 0.0]),
  1: mat4.fromRT(rotZ(0.1), [0.3, 0.0, 0.0]),
  2: mat4.fromRT(rotX(0.05), [0.0, 0.25, 0.0]),
  3: mat4.fromRT(rotY(-0.1), [0.3, 0.25, 0.0]),
};

// a camera at world pose P sees marker `id`: Cᵢ = P⁻¹ · GT[id]  (marker-local → camera)
function see(P, id) { return { id, pose: mat4.multiply(mat4.invert(P), GT[id]) }; }

// the layout is recovered up to the origin gauge: poses are in marker-0's frame
function expectedInOriginFrame(originId, id) {
  return mat4.multiply(mat4.invert(GT[originId]), GT[id]);
}

test('solveLayout recovers the relative layout from multi-reference frames', () => {
  const camA = mat4.fromRT(rotY(0.5), [1, 1, -3]);
  const camB = mat4.fromRT(rotY(-0.3), [-1, 0.5, -2.5]);
  const observations = [
    [see(camA, 0), see(camA, 1), see(camA, 2), see(camA, 3)],
    [see(camB, 0), see(camB, 1), see(camB, 2), see(camB, 3)],
  ];
  const { poses, origin, connected, missing } = solveLayout(observations);
  assert.equal(origin, 0);
  assert.ok(connected);
  assert.deepEqual(missing, []);
  assert.ok(mat4.approxEqual(poses.get(0), mat4.identity(), 1e-9)); // origin == identity
  for (const id of [1, 2, 3]) {
    assert.ok(mat4.approxEqual(poses.get(id), expectedInOriginFrame(0, id), 1e-6));
  }
});

test('solveLayout chains through a bridge marker (0–1, 1–2 never co-see 0 & 2)', () => {
  const camA = mat4.fromRT(rotY(0.2), [0.5, 0, -2]);
  const camB = mat4.fromRT(rotY(0.6), [-0.5, 0.2, -2]);
  const observations = [
    [see(camA, 0), see(camA, 1)], // 0–1
    [see(camB, 1), see(camB, 2)], // 1–2  (0 and 2 never together)
  ];
  const { poses, connected } = solveLayout(observations);
  assert.ok(connected);
  // marker 2, reached via 1, still lands at its true place in marker-0's frame
  assert.ok(mat4.approxEqual(poses.get(2), expectedInOriginFrame(0, 2), 1e-6));
});

test('solveLayout reports a disconnected component as missing', () => {
  const camA = mat4.fromRT(rotY(0.2), [0.5, 0, -2]);
  const camB = mat4.fromRT(rotY(0.6), [-0.5, 0.2, -2]);
  const observations = [
    [see(camA, 0), see(camA, 1)], // component {0,1}
    [see(camB, 2), see(camB, 3)], // component {2,3} — no bridge to origin
  ];
  const { poses, connected, missing } = solveLayout(observations);
  assert.ok(!connected);
  assert.deepEqual(missing, [2, 3]);
  assert.ok(poses.has(0) && poses.has(1));
});

test('solveLayout applies the class gate — an object marker never enters the layout (§4.3)', () => {
  const camA = mat4.fromRT(rotY(0.2), [0.5, 0, -2]);
  // include a moving object marker (id 60) — must be ignored for the static layout
  const obj = { id: 60, pose: mat4.fromRT(rotZ(1.2), [0.1, 0.1, -0.5]) };
  const observations = [[see(camA, 0), see(camA, 1), obj]];
  const { poses, missing } = solveLayout(observations);
  assert.ok(!poses.has(60));
  assert.ok(!missing.includes(60));
  assert.ok(poses.has(0) && poses.has(1));
});

test('solveLayout honors a designated origin', () => {
  const camA = mat4.fromRT(rotY(0.5), [1, 1, -3]);
  const observations = [[see(camA, 0), see(camA, 1), see(camA, 2)]];
  const { poses, origin } = solveLayout(observations, { origin: 1 });
  assert.equal(origin, 1);
  assert.ok(mat4.approxEqual(poses.get(1), mat4.identity(), 1e-9));
  assert.ok(mat4.approxEqual(poses.get(0), expectedInOriginFrame(1, 0), 1e-6));
});

test('discovered → surveyed pipeline: a frozen layout drives solveDatum', () => {
  // map the layout...
  const camA = mat4.fromRT(rotY(0.5), [1, 1, -3]);
  const camB = mat4.fromRT(rotY(-0.3), [-1, 0.5, -2.5]);
  const { poses } = solveLayout([
    [see(camA, 0), see(camA, 1), see(camA, 2), see(camA, 3)],
    [see(camB, 0), see(camB, 1), see(camB, 2), see(camB, 3)],
  ]);

  // ...then a fresh observation registers against the frozen datum (magic-window: X = I)
  const camNew = mat4.fromRT(rotX(0.2), [0.2, -0.4, -1.8]);
  const references = [0, 1, 2].map((id) => ({
    matPose: poses.get(id),
    observedPose: see(camNew, id).pose, // marker in camera
    size: 0.1,
  }));
  const datum = solveDatum(references);
  assert.ok(datum.confident);
  // defining property: transform · matPose ≈ observedPose for every reference
  for (const r of references) {
    assert.ok(mat4.approxEqual(mat4.multiply(datum.transform, r.matPose), r.observedPose, 1e-6));
  }
});

test('solveLayout with no references returns an empty result', () => {
  const r = solveLayout([]);
  assert.equal(r.poses.size, 0);
  assert.equal(r.origin, null);
  assert.ok(!r.connected);
});
