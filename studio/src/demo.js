// demo.js — one-click demo scene: everything needed to sight-check the whole
// loop (studio → wire → phone-on-mat) without authoring. Color-coded boxes at
// the four marker positions make misregistration and axis flips instantly
// visible; the procedural terrain STL exercises the blob lane over the real
// wire; the floating label checks height and billboarding.

const MARKERS = [                               // matches the mat manifest layout
  { id: 7, t: [-0.055, 0.085], color: 0x5a9a4a, name: 'id 7 · TL · green' },
  { id: 23, t: [0.055, 0.085], color: 0xd05a4a, name: 'id 23 · TR · red' },
  { id: 98, t: [-0.055, -0.085], color: 0x4a6ad0, name: 'id 98 · BL · blue' },
  { id: 133, t: [0.055, -0.085], color: 0xe8b04b, name: 'id 133 · BR · amber' },
];

// A little heightfield terrain (two gaussian bumps), 60×60 mm, as binary STL
// in mm units — small enough to ride the wire, real enough to look like data.
export function makeDemoSTL() {
  const N = 9, SIDE = 60;                       // 9×9 verts, 8×8 cells, mm
  const h = (x, y) => {
    const g = (cx, cy, s, a) => a * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * s * s));
    return g(-12, -8, 11, 16) + g(14, 12, 9, 11);
  };
  const v = (i, j) => {
    const x = (i / (N - 1) - 0.5) * SIDE, y = (j / (N - 1) - 0.5) * SIDE;
    return [x, y, h(x, y)];
  };
  const tris = [];
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
    tris.push([v(i, j), v(i + 1, j), v(i + 1, j + 1)]);
    tris.push([v(i, j), v(i + 1, j + 1), v(i, j + 1)]);
  }
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  tris.forEach(([a, b, c], k) => {
    const o = 84 + k * 50;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(...n) || 1;
    [n[0] / l, n[1] / l, n[2] / l, ...a, ...b, ...c].forEach((f, x) => dv.setFloat32(o + x * 4, f, true));
  });
  return new Uint8Array(buf);
}

// Populate (or, if present, remove) the demo layer. Returns 'added' | 'removed'.
export async function toggleDemoScene(store) {
  const existing = store.byKind('layer').find((l) => l.name === 'demo');
  if (existing) {
    for (const o of store.all()) if (o.layer === existing.id) store.remove(o.id);
    store.remove(existing.id);
    return 'removed';
  }
  const layer = store.upsert({ id: store.newId(), kind: 'layer', name: 'demo' });
  const add = (kind, name, t, props = {}, extra = {}) =>
    store.upsert({ id: store.newId(), kind, name, layer: layer.id, t, props, ...extra });

  add('axes', 'origin', [0, 0, 0], { size: 0.06 });
  for (const m of MARKERS)
    add('box', m.name, [m.t[0], m.t[1], 0],
      { w: 0.03, d: 0.03, h: 0.025, solid: true, color: m.color });
  add('label', 'ars demo', [0, 0.04, 0.08], { text: 'ars demo', size: 0.022 });

  const hash = await store.saveBlob(makeDemoSTL());
  add('mesh', 'terrain', [0, -0.045, 0], { blob: hash, fmt: 'stl', unit: 'mm' });
  // the condenser deposit (§3.1 mount) — cutoff shows the two lodes
  add('blocks', 'deposit', [0, 0.035, 0],
    { seed: 1746, cutoff: 1.0, edges: true, footprint: 0.09 });
  return 'added';
}
