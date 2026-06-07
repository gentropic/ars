import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symmetricEig, argmax } from '../src/eigen.js';

function matVec(A, v) {
  return A.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
}

test('diagonal matrix: eigenvalues are the diagonal', () => {
  const { values } = symmetricEig([[3, 0, 0], [0, 1, 0], [0, 0, 2]]);
  assert.deepEqual([...values].sort((a, b) => a - b), [1, 2, 3]);
});

test('eigenpairs satisfy A·v = λ·v and vectors are orthonormal', () => {
  const A = [[2, -1, 0], [-1, 2, -1], [0, -1, 2]]; // classic tridiagonal
  const { values, vectors } = symmetricEig(A);
  const n = 3;
  for (let k = 0; k < n; k++) {
    const v = [vectors[0][k], vectors[1][k], vectors[2][k]];
    const Av = matVec(A, v);
    for (let i = 0; i < n; i++) assert.ok(Math.abs(Av[i] - values[k] * v[i]) < 1e-9);
    assert.ok(Math.abs(Math.hypot(v[0], v[1], v[2]) - 1) < 1e-9); // unit
  }
  // columns mutually orthogonal
  const col = (k) => [vectors[0][k], vectors[1][k], vectors[2][k]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  assert.ok(Math.abs(dot(col(0), col(1))) < 1e-9);
  assert.ok(Math.abs(dot(col(0), col(2))) < 1e-9);
});

test('argmax finds the largest eigenvalue index', () => {
  const { values } = symmetricEig([[5, 0], [0, -3]]);
  assert.equal(values[argmax(values)], 5);
});

test('handles a 4×4 symmetric matrix (the Horn matrix shape)', () => {
  const A = [
    [4, 1, 0, 0],
    [1, 3, 1, 0],
    [0, 1, 2, 1],
    [0, 0, 1, 1],
  ];
  const { values, vectors } = symmetricEig(A);
  const k = argmax(values);
  const v = [vectors[0][k], vectors[1][k], vectors[2][k], vectors[3][k]];
  const Av = matVec(A, v);
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(Av[i] - values[k] * v[i]) < 1e-7);
});
