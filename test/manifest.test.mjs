import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLASS } from '../src/classes.js';
import {
  DEFAULT_DICTIONARY, parseManifest, getMarker, resolveClass, resolveOrigin,
} from '../src/manifest.js';

const surveyed = {
  version: '0.1',
  mode: 'surveyed',
  markers: {
    0: { size: 0.10, label: 'desk-A', pose: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    1: { size: 0.10, label: 'desk-B', pose: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.3, 0, 0, 1] },
    100: { size: 0.05, capsule: 'gh:user/repo@rev:model.json' },
  },
};

test('parseManifest normalizes and validates a surveyed manifest', () => {
  const m = parseManifest(surveyed);
  assert.equal(m.mode, 'surveyed');
  assert.equal(m.dictionary, DEFAULT_DICTIONARY);
  assert.equal(m.markers.size, 3);
  // keys normalized to numbers
  assert.ok(m.markers.has(0));
  assert.ok(m.markers.has(100));
  // pose normalized to a 16-length Float64Array
  assert.ok(getMarker(m, 1).pose instanceof Float64Array);
  assert.equal(getMarker(m, 1).pose[12], 0.3);
});

test('resolveClass: id-range default, then explicit marker class wins', () => {
  const m = parseManifest(surveyed);
  assert.equal(resolveClass(m, 0), CLASS.REFERENCE);
  assert.equal(resolveClass(m, 100), CLASS.CONTENT);

  const repartitioned = parseManifest({
    ...surveyed,
    markers: { ...surveyed.markers, 5: { class: CLASS.CONTENT, size: 0.05 } },
  });
  assert.equal(resolveClass(repartitioned, 5), CLASS.CONTENT); // explicit overrides range default
});

test('resolveOrigin: explicit origin honored', () => {
  const m = parseManifest({ ...surveyed, origin: 1 });
  assert.equal(resolveOrigin(m), 1);
});

test('resolveOrigin: defaults to the lowest reference id', () => {
  const m = parseManifest(surveyed);
  assert.equal(resolveOrigin(m), 0);
});

test('resolveOrigin: defaults among present ids when given', () => {
  const m = parseManifest({
    mode: 'surveyed',
    markers: { 0: { size: 0.1 }, 2: { size: 0.1 }, 3: { size: 0.1 } },
  });
  // rig only sees 2 and 3 → origin is the lowest reference among those
  assert.equal(resolveOrigin(m, [3, 2]), 2);
});

test('resolveOrigin: null when no reference marker exists', () => {
  const m = parseManifest({ mode: 'surveyed', markers: { 100: { size: 0.05, capsule: 'i:x' } } });
  assert.equal(resolveOrigin(m), null);
});

test('parseManifest: class repartition validated and applied', () => {
  const m = parseManifest({
    mode: 'discovered',
    classes: { reference: [0, 9], object: [10, 19], content: [20, 99] },
    markers: { 50: { size: 0.05 } },
  });
  assert.equal(resolveClass(m, 50), CLASS.CONTENT); // 50 is content under the repartition
  assert.equal(m.mode, 'discovered');
});

test('parseManifest rejects bad input', () => {
  assert.throws(() => parseManifest(null), /expected an object/);
  assert.throws(() => parseManifest({ mode: 'nonsense' }), /mode must be/);
  assert.throws(() => parseManifest({ markers: { 0: { size: -1 } } }), /size must be/);
  assert.throws(() => parseManifest({ markers: { 0: { pose: [1, 2, 3] } } }), /16 elements/);
  assert.throws(() => parseManifest({ markers: { abc: { size: 0.1 } } }), /non-negative integer/);
});

test('parseManifest rejects an origin that is not a reference', () => {
  assert.throws(() => parseManifest({ ...surveyed, origin: 100 }), /not a reference/);
});
