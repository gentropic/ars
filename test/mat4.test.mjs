import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mat4, vec3 } from '../src/mat4.js';

// row-major rotation builders for test fixtures
const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };

test('identity is the multiplicative identity', () => {
  const I = mat4.identity();
  const m = mat4.fromRT(rotZ(0.7), [1, 2, 3]);
  assert.ok(mat4.approxEqual(mat4.multiply(I, m), m));
  assert.ok(mat4.approxEqual(mat4.multiply(m, I), m));
});

test('fromRT round-trips through getRotation / getTranslation', () => {
  const R = rotY(0.3), t = [4, -5, 6];
  const m = mat4.fromRT(R, t);
  assert.deepEqual(mat4.getTranslation(m), t);
  const back = mat4.getRotation(m);
  for (let i = 0; i < 9; i++) assert.ok(Math.abs(back[i] - R[i]) < 1e-12);
});

test('multiply composes transforms in apply-B-first order', () => {
  const T = mat4.translation([1, 0, 0]);
  const R = mat4.fromRT(rotZ(Math.PI / 2), [0, 0, 0]);
  // (T·R) applied to origin: R first (rotates origin → origin), then T → (1,0,0)
  const TR = mat4.multiply(T, R);
  assert.ok(vec3.approxEqual(mat4.transformPoint(TR, [0, 0, 0]), [1, 0, 0]));
  // rotate +X by 90° about Z → +Y, then translate +X → (1,1,0)
  assert.ok(vec3.approxEqual(mat4.transformPoint(TR, [1, 0, 0]), [1, 1, 0]));
});

test('transformPoint vs transformDir: translation affects points, not directions', () => {
  const m = mat4.fromRT(rotX(0.4), [10, 20, 30]);
  const p = mat4.transformPoint(m, [0, 0, 0]);
  assert.ok(vec3.approxEqual(p, [10, 20, 30]));
  const d = mat4.transformDir(m, [0, 0, 0]);
  assert.ok(vec3.approxEqual(d, [0, 0, 0]));
});

test('invert: M · M⁻¹ = I for a rigid transform', () => {
  const m = mat4.multiply(mat4.fromRT(rotZ(0.5), [1, 2, 3]), mat4.fromRT(rotY(-0.9), [-4, 5, -6]));
  const inv = mat4.invert(m);
  assert.ok(mat4.approxEqual(mat4.multiply(m, inv), mat4.identity(), 1e-9));
});

test('invert: handles a non-rigid (scaled) matrix', () => {
  const m = mat4.identity();
  m[0] = 2; m[5] = 3; m[10] = 4; m[12] = 1; m[13] = 2; m[14] = 3; // scale + translate
  const inv = mat4.invert(m);
  assert.ok(mat4.approxEqual(mat4.multiply(m, inv), mat4.identity(), 1e-12));
});

test('invert returns null on a singular matrix', () => {
  const m = new Float64Array(16); // all zeros
  assert.equal(mat4.invert(m), null);
});

test('rigidInvert equals invert for rigid transforms', () => {
  const m = mat4.fromRT(rotX(0.8), [7, -3, 2]);
  assert.ok(mat4.approxEqual(mat4.rigidInvert(m), mat4.invert(m), 1e-12));
  assert.ok(mat4.approxEqual(mat4.multiply(m, mat4.rigidInvert(m)), mat4.identity(), 1e-12));
});

test('isRigid: true for rotations, false for scale/skew', () => {
  assert.ok(mat4.isRigid(mat4.fromRT(rotZ(1.1), [5, 5, 5])));
  const scaled = mat4.identity(); scaled[0] = 2;
  assert.ok(!mat4.isRigid(scaled));
});

test('vec3 basics', () => {
  assert.deepEqual(vec3.add([1, 2, 3], [4, 5, 6]), [5, 7, 9]);
  assert.deepEqual(vec3.sub([4, 5, 6], [1, 2, 3]), [3, 3, 3]);
  assert.deepEqual(vec3.cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  assert.equal(vec3.dot([1, 2, 3], [4, 5, 6]), 32);
  assert.equal(vec3.length([3, 4, 0]), 5);
  assert.ok(vec3.approxEqual(vec3.normalize([0, 0, 5]), [0, 0, 1]));
});
