import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLASS, DEFAULT_RANGES, classOf, isReference, isObject, isContent,
  classGate, partitionByClass,
} from '../src/classes.js';

test('classOf: default id-range partition (§4)', () => {
  assert.equal(classOf(0), CLASS.REFERENCE);
  assert.equal(classOf(49), CLASS.REFERENCE);
  assert.equal(classOf(50), CLASS.OBJECT);
  assert.equal(classOf(99), CLASS.OBJECT);
  assert.equal(classOf(100), CLASS.CONTENT);
  assert.equal(classOf(249), CLASS.CONTENT);
  assert.equal(classOf(250), null);
  assert.equal(classOf(-1), null);
});

test('classOf: per-id override wins over ranges', () => {
  assert.equal(classOf(5, { overrides: { 5: CLASS.OBJECT } }), CLASS.OBJECT);
  assert.equal(classOf(5), CLASS.REFERENCE); // unaffected without override
});

test('classOf: manifest may repartition via opts.ranges', () => {
  const ranges = { reference: [0, 9], object: [10, 19], content: [20, 99] };
  assert.equal(classOf(9, { ranges }), CLASS.REFERENCE);
  assert.equal(classOf(10, { ranges }), CLASS.OBJECT);
  assert.equal(classOf(50, { ranges }), CLASS.CONTENT); // would be OBJECT under defaults
});

test('isReference / isObject / isContent helpers', () => {
  assert.ok(isReference(3));
  assert.ok(isObject(60));
  assert.ok(isContent(150));
  assert.ok(!isReference(60));
});

test('classGate: only reference-class observations pass (§4.3)', () => {
  const obs = [{ id: 0 }, { id: 50 }, { id: 7 }, { id: 100 }, { id: 999 }];
  const gated = classGate(obs);
  assert.deepEqual(gated.map((o) => o.id), [0, 7]);
});

test('classGate: an object marker can never reach the datum, however many there are', () => {
  const obs = [{ id: 51 }, { id: 52 }, { id: 53 }];
  assert.deepEqual(classGate(obs), []);
});

test('partitionByClass splits and drops out-of-range ids', () => {
  const obs = [{ id: 0 }, { id: 1 }, { id: 50 }, { id: 120 }, { id: 5000 }];
  const p = partitionByClass(obs);
  assert.deepEqual(p.reference.map((o) => o.id), [0, 1]);
  assert.deepEqual(p.object.map((o) => o.id), [50]);
  assert.deepEqual(p.content.map((o) => o.id), [120]);
});

test('DEFAULT_RANGES is the documented partition', () => {
  assert.deepEqual(DEFAULT_RANGES.reference, [0, 49]);
  assert.deepEqual(DEFAULT_RANGES.object, [50, 99]);
  assert.deepEqual(DEFAULT_RANGES.content, [100, 249]);
});
