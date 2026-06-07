// classes.js — marker classes and the class gate (SPEC §4).
//
// A marker's class is its role, encoded in its id range so class is known from
// detection alone, without a manifest lookup. The separation of `reference` (fused,
// world-defining) from `object` (live, never world-defining) is load-bearing, not
// organizational (§4.3): it is the rule that keeps the static and dynamic solves
// from contaminating each other. Apply the gate.

export const CLASS = Object.freeze({
  REFERENCE: 'reference',
  OBJECT: 'object',
  CONTENT: 'content',
});

// Default id-range partition (§4). A manifest MAY repartition but MUST declare it;
// pass its ranges as opts.ranges (same shape) to honor that.
export const DEFAULT_RANGES = Object.freeze({
  reference: [0, 49],
  object: [50, 99],
  content: [100, 249],
});

// Class of a marker id. Resolution order (§8: manifest wins over id-range defaults):
//   1. opts.overrides[id]   — explicit per-id class (e.g. from a manifest marker)
//   2. opts.ranges (or the default partition)
// Returns a CLASS string, or null if the id falls outside every range.
export function classOf(id, opts = {}) {
  const n = Number(id);
  if (opts.overrides && opts.overrides[n] != null) return opts.overrides[n];
  const ranges = opts.ranges || DEFAULT_RANGES;
  for (const cls of [CLASS.REFERENCE, CLASS.OBJECT, CLASS.CONTENT]) {
    const r = ranges[cls];
    if (r && n >= r[0] && n <= r[1]) return cls;
  }
  return null;
}

export function isReference(id, opts) { return classOf(id, opts) === CLASS.REFERENCE; }
export function isObject(id, opts) { return classOf(id, opts) === CLASS.OBJECT; }
export function isContent(id, opts) { return classOf(id, opts) === CLASS.CONTENT; }

// THE GATE (§4.3, normative): only `reference`-class observations may feed the datum.
// `observations` is any array of objects carrying an `id`. Returns the reference-class
// subset — the only input the datum solve (§6) is permitted to see. Object markers,
// however waved about, can never drag the world origin.
export function classGate(observations, opts) {
  return observations.filter((o) => classOf(o.id, opts) === CLASS.REFERENCE);
}

// Split observations into the three classes — references (→ datum), objects (→ live
// input), content (→ capsule resolution). Ids outside every range are dropped.
export function partitionByClass(observations, opts) {
  const out = { reference: [], object: [], content: [] };
  for (const o of observations) {
    const cls = classOf(o.id, opts);
    if (cls) out[cls].push(o);
  }
  return out;
}
