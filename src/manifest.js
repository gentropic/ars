// manifest.js — the authoritative description of a mat (SPEC §8).
//
// Markers are dumb stable ids; the manifest is the program. It binds ids to class,
// printed size, label, content capsule, and — in surveyed mode — the references'
// relative poses and the designated origin. This module validates a parsed manifest
// object (JSON or YAML is parsed by the caller; core stays zero-dep) and answers the
// two questions the rest of the system asks of it: what class is this id, and which
// marker is the origin.

import { CLASS, DEFAULT_RANGES, classOf } from './classes.js';

export const DEFAULT_DICTIONARY = 'ARUCO_MIP_36h12';
const MODES = ['surveyed', 'discovered'];
const VALID_CLASSES = [CLASS.REFERENCE, CLASS.OBJECT, CLASS.CONTENT];

function fail(msg) { throw new Error('ars manifest: ' + msg); }

// Validate + normalize a parsed manifest object. Returns:
//   { version, dictionary, mode, classes|null, origin|null, markers: Map<number,entry> }
// where each entry is { id, class?, size?, label?, pose?:Float64Array(16), capsule? }.
// Throws on hard structural errors; lenient about optional fields.
export function parseManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('expected an object');

  const mode = input.mode == null ? 'surveyed' : String(input.mode);
  if (!MODES.includes(mode)) fail(`mode must be one of ${MODES.join(' / ')}, got "${input.mode}"`);

  // Optional class repartition (§4). If present, validate each range as [lo, hi].
  let classes = null;
  if (input.classes != null) {
    if (typeof input.classes !== 'object') fail('classes must be an object of {class: [lo, hi]}');
    classes = {};
    for (const cls of VALID_CLASSES) {
      const r = input.classes[cls];
      if (r == null) continue;
      if (!Array.isArray(r) || r.length !== 2 || !r.every((n) => Number.isInteger(n)) || r[0] > r[1]) {
        fail(`classes.${cls} must be an integer range [lo, hi] with lo ≤ hi`);
      }
      classes[cls] = [r[0], r[1]];
    }
  }

  const markers = new Map();
  const rawMarkers = input.markers || {};
  if (typeof rawMarkers !== 'object' || Array.isArray(rawMarkers)) fail('markers must be an object keyed by id');
  for (const key of Object.keys(rawMarkers)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id < 0) fail(`marker id "${key}" must be a non-negative integer`);
    const src = rawMarkers[key] || {};
    const entry = { id };

    if (src.class != null) {
      if (!VALID_CLASSES.includes(src.class)) fail(`marker ${id}: class must be one of ${VALID_CLASSES.join(' / ')}`);
      entry.class = src.class;
    }
    if (src.size != null) {
      if (typeof src.size !== 'number' || !(src.size > 0)) fail(`marker ${id}: size must be a positive number (meters)`);
      entry.size = src.size;
    }
    if (src.label != null) entry.label = String(src.label);
    if (src.capsule != null) entry.capsule = String(src.capsule);
    if (src.pose != null) {
      if (!Array.isArray(src.pose) && !ArrayBuffer.isView(src.pose)) fail(`marker ${id}: pose must be a 16-number array (column-major 4×4)`);
      if (src.pose.length !== 16) fail(`marker ${id}: pose must have 16 elements, got ${src.pose.length}`);
      entry.pose = Float64Array.from(src.pose);
    }
    markers.set(id, entry);
  }

  const manifest = {
    version: input.version != null ? String(input.version) : '0.1',
    dictionary: input.dictionary != null ? String(input.dictionary) : DEFAULT_DICTIONARY,
    mode,
    classes,
    origin: input.origin != null ? Number(input.origin) : null,
    markers,
  };

  // An explicit origin must name a reference-class marker.
  if (manifest.origin != null && resolveClass(manifest, manifest.origin) !== CLASS.REFERENCE) {
    fail(`origin ${manifest.origin} is not a reference-class marker`);
  }
  return manifest;
}

export function getMarker(manifest, id) {
  return manifest.markers.get(Number(id)) || null;
}

// Class of an id under a manifest: a marker's explicit class wins (§8), else the
// manifest's range partition, else the default partition.
export function resolveClass(manifest, id) {
  const m = manifest.markers && manifest.markers.get(Number(id));
  if (m && m.class) return m.class;
  return classOf(id, { ranges: manifest.classes || DEFAULT_RANGES });
}

// The origin marker (SPEC §5.1): the manifest's explicit `origin`, else the lowest
// reference id present. `presentIds` (optional) restricts the default to ids the rig
// currently sees; without it, the lowest reference id known to the manifest is used.
// Returns the origin id, or null if no reference marker is available.
export function resolveOrigin(manifest, presentIds) {
  if (manifest.origin != null) return manifest.origin;

  let candidates;
  if (presentIds && presentIds.length) {
    candidates = presentIds.filter((id) => resolveClass(manifest, id) === CLASS.REFERENCE);
  } else {
    candidates = [...manifest.markers.keys()].filter((id) => resolveClass(manifest, id) === CLASS.REFERENCE);
  }
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (b < a ? b : a));
}
