// blocks.js — condenser block-model layers (DESIGN.md stage 4), mounted per
// webxr/SPEC.md §3.1: fake-canvas context handoff, the EIGHT-FIELD camera
// duck in MODEL-LOCAL space, order-0 drawing (condenser draws FIRST, three
// renders on top with autoClear off — condenser's clear is the frame clear).
//
// Two data modes, one 'blocks' kind:
// - DEMO: the seeded synthetic deposit recipe carried in props (deterministic
//   both ends — nothing to blob).
// - FILE: real block models over the blob lane — CSV/TXT via openBlockModel,
//   Datamine .dm via openDmModel (both provided by the vendored condenser
//   bundle; micro's own loaders). Both ends re-discover from the same bytes,
//   so only the blob hash + the chosen channel ride in props. Color column
//   (header.numericColumns), ramp preset, and grade cutoff are all live.
//
// v1 limits, deliberate: ONE blocks layer per scene (condenser clear-on-draw
// — the `clear:false` upstream debt); MOVING-mode discipline everywhere via
// renderer.invalidate() before each draw (converged accumulation assumes
// pixels persist, which a composited three viewport can't grant); gridded
// models only (sub-blocked / irregular → clear error, points fallback later).

let condenser = null;                           // lazy: the 400 KB bundle loads
async function loadCondenser() {                // only when a blocks layer exists
  if (!condenser) condenser = await import('../../vendor/condenser/index.js');
  return condenser;
}

// micro's ramp presets (same author, same stops)
export const RAMPS = {
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  spectral: [[43, 131, 186], [171, 221, 164], [255, 255, 191], [253, 174, 97], [215, 25, 28]],
  magma: [[0, 0, 4], [81, 18, 124], [183, 55, 121], [252, 137, 97], [252, 253, 191]],
  turbo: [[48, 18, 59], [62, 156, 254], [34, 236, 161], [218, 226, 25], [122, 4, 3]],
  greys: [[24, 24, 24], [235, 235, 235]],
};

// ── the demo deposit (test.html's synthetic orebody, parameterized) ───────
export function buildDemoChunk(C, props) {
  const NI = props.ni ?? 48, NJ = props.nj ?? 48, NK = props.nk ?? 24;
  const S = props.pitch ?? 10;                  // model units (m at deposit scale)
  const n = NI * NJ * NK;
  const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
  const chan = new Float32Array(n), cat = new Uint8Array(n), recIdx = new Uint32Array(n);
  const rnd = C.mulberry32(props.seed ?? 1746);
  const lode = (px, py, pz, cx, cy, cz, dip) => {
    const dy = py - cy, dz = pz - cz, c = Math.cos(dip), s = Math.sin(dip);
    const u = px - cx, v = dy * c + dz * s, w = -dy * s + dz * c;
    return Math.exp(-(u * u / (160 * 160) + v * v / (45 * 45) + w * w / (18 * 18)));
  };
  let r = 0;
  for (let k = 0; k < NK; k++) for (let j = 0; j < NJ; j++) for (let i = 0; i < NI; i++, r++) {
    const px = (i - (NI - 1) / 2) * S, py = (j - (NJ - 1) / 2) * S, pz = (k - (NK - 1) / 2) * S;
    x[r] = px; y[r] = py; z[r] = pz;
    const g = 4.2 * lode(px, py, pz, -40, 30, 10, 0.6)
            + 2.8 * lode(px, py, pz, 90, -60, -30, -0.35) + 0.05 + 0.12 * rnd();
    chan[r] = g; cat[r] = g > 1 ? 1 : 0; recIdx[r] = r;
  }
  const frame = { origin: [0, 0, 0], crs: null, units: 'm' };
  const axes = [
    { origin: -(NI - 1) / 2 * S, pitch: S, count: NI },
    { origin: -(NJ - 1) / 2 * S, pitch: S, count: NJ },
    { origin: -(NK - 1) / 2 * S, pitch: S, count: NK },
  ];
  const grid = C.makeBlockGrid(axes, frame);
  const chunk = C.buildBlockChunk({ x, y, z, chan, cat, recIdx }, grid, frame, C.mulberry32(7));
  return { chunk, chan, extent: [NI * S, NJ * S, NK * S] };
}

export function demoModelScale(props) {
  const NI = props.ni ?? 48, NJ = props.nj ?? 48, S = props.pitch ?? 10;
  return (props.footprint ?? 0.12) / (Math.max(NI, NJ) * S);
}
export function demoLift(props) {
  return ((props.nk ?? 24) * (props.pitch ?? 10)) / 2;
}
export function demoExtent(props) {
  const NI = props.ni ?? 48, NJ = props.nj ?? 48, NK = props.nk ?? 24, S = props.pitch ?? 10;
  const k = demoModelScale(props);
  return [NI * S * k, NJ * S * k, NK * S * k];
}

// world extent of a FILE blocks/points object (props.dims = model-unit bbox)
export function fileExtent(props) {
  const [dx, dy, dz] = props.dims || [1, 1, 1];
  const k = (props.footprint ?? 0.12) / Math.max(dx, dy);
  return [dx * k, dy * k, dz * k];
}

// the condenser mount serves ONE object per scene (clear-on-draw debt):
// the first visible blocks or points item wins; others warn.
export function pickMountObject(store, hiddenFn) {
  return [...store.byKind('blocks'), ...store.byKind('points')]
    .filter((o) => !hiddenFn(o))[0] || null;
}

// LAS discovery for the file picker / harness.
export async function discoverLas(bytes) {
  const C = await loadCondenser();
  const { header } = await C.openLas(new Blob([bytes]));
  const b = header.bbox;
  return {
    count: header.count, format: header.format,
    hasRgb: [2, 3, 7, 8].includes(header.format),
    dims: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]],
  };
}

// ── discovery (used by the studio's file picker and the harness) ──────────
// bytes → { gridded, count, cols: [{i,name}], chan, dims } or throws.
export async function discoverBlockModel(bytes, { dm } = {}) {
  const C = await loadCondenser();
  const blob = new Blob([bytes]);
  const open = dm ? C.openDmModel : C.openBlockModel;
  const { header } = await open(blob, {});
  const b = header.bbox;
  return {
    gridded: !!header.grid,
    count: header.count,
    cols: (header.numericColumns || []).map((c) => ({ i: c.i, name: String(c.name).trim() })),
    chan: header.mapping ? header.mapping.chan : null,
    dims: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]],
  };
}

// ── the mount ─────────────────────────────────────────────────────────────
export function createBlocksMount(gl, opts = {}) {
  let renderer = null, C = null, fake = null;
  let built = null;                             // { key, count, k, off, error? }
  let lastStats = null, loading = false;
  const LAYER = 0;

  const m4mul = (a, b, out) => {
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return out;
  };
  const duck = { state: { viewProj: new Float32Array(16), view: new Float32Array(16),
                          eye: [0, 0, 0], target: [0, 0, 0], near: 0.1, fovY: 1.0, ortho: false, halfH: 1 } };
  const _vp = new Float32Array(16);

  async function ensureRenderer() {
    C = await loadCondenser();
    if (!renderer) {
      fake = { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, getContext: () => gl };
      renderer = C.createRenderer(fake);
      // condenser's MOVING draw clears with ITS background: transparent
      // for passthrough (viewer), the panel color for the studio
      renderer.setBackground(opts.background ?? [0, 0, 0, 0]);
    }
  }

  function applyStyle(props, chanAll) {
    renderer.setLayerRamp(LAYER, C.rampPixels(256, RAMPS[props.ramp] || RAMPS.viridis));
    const cutoff = props.cutoff ?? 0;
    if (cutoff > 0 && chanAll) {
      const mask = new Uint8Array(chanAll.length);
      for (let i = 0; i < chanAll.length; i++) mask[i] = chanAll[i] >= cutoff ? 1 : 0;
      renderer.setFilter(mask, { isolate: true }, LAYER);
    } else renderer.setFilter(null, {}, LAYER);
  }

  async function buildDemo(obj) {
    const { chunk, chan, extent } = buildDemoChunk(C, obj.props);
    renderer.removeLayer(LAYER);
    renderer.setDocBbox(chunk.bboxLocal);
    renderer.addChunk(chunk, 'base', LAYER);
    applyStyle(obj.props, chan);
    return { count: chunk.count, chanAll: chan,
             k: demoModelScale(obj.props), off: [0, 0, demoLift(obj.props)], extent };
  }

  // frame origin at xy-center / z-min: frame-local coords are centered on
  // the sheet and start at z = 0 — the model sits ON the mat
  const frameFor = (b) => ({ origin: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]],
                             crs: null, units: 'm' });
  const kFor = (dims, props) => (props.footprint ?? 0.12) / Math.max(dims[0], dims[1]);
  const dimsOf = (b) => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];

  async function buildFile(obj) {
    const bytes = opts.getBlob && opts.getBlob(obj.props.blob);
    if (!bytes) return null;                    // blob still in transit — retry
    const blob = new Blob([bytes]);
    const open = obj.props.dm ? C.openDmModel : C.openBlockModel;
    let { header, streamChunks } = await open(blob, {});
    if (obj.props.chan != null && header.mapping && header.mapping.chan !== obj.props.chan)
      ({ header, streamChunks } = await open(blob, { mapping: { ...header.mapping, chan: obj.props.chan } }));
    const frame = frameFor(header.bbox);
    const dims = dimsOf(header.bbox);
    renderer.removeLayer(LAYER);
    const chanAll = new Float32Array(header.count);
    const keepChan = (rc) => {
      if (rc.recStart != null && rc.recStart + rc.count <= chanAll.length)
        for (let i = 0; i < rc.count; i++) chanAll[rc.recStart + i] = rc.chan[i];
    };

    if (header.grid) {
      const grid = C.makeBlockGrid([header.grid.x, header.grid.y, header.grid.z], frame);
      // sub-blocked models carry per-block half-dimensions on the fine
      // lattice — the palette MUST reach the builder or every sub-block
      // renders at full lattice size (micro's exact wiring)
      const dimPalette = header.subBlocked ? header.dimPalette : null;
      const cb = C.createBlockChunkBuilder({ frame, grid, dimPalette, chunkSize: 1 << 17,
        batchSize: 1 << 21, seed: 1, onChunk: (c) => renderer.addChunk(c, 'base', LAYER) });
      for await (const rc of streamChunks({ chunkPoints: 1 << 17 })) { keepChan(rc); cb.push(rc); }
      const doc = cb.flush();
      renderer.setDocBbox(doc.bboxLocal);
      applyStyle(obj.props, chanAll);
      return { count: doc.count, chanAll, k: kFor(dims, obj.props), off: [0, 0, 0],
               extent: dims, colorMode: 1 };
    }

    // no regular grid (irregular / forced points): centroids as points,
    // grade → the intensity slot — micro's fallback, not a refusal
    const cb = C.createChunkBuilder({ frame, chunkSize: 1 << 18, batchSize: 1 << 22,
      seed: 1, onChunk: (c) => renderer.addChunk(c, 'base', LAYER) });
    for await (const rc of streamChunks({ chunkPoints: 1 << 18 })) {
      keepChan(rc);
      let cMin = Infinity, cMax = -Infinity;
      for (let i = 0; i < rc.count; i++) { const v = rc.chan[i]; if (Number.isFinite(v)) { if (v < cMin) cMin = v; if (v > cMax) cMax = v; } }
      const s = cMax > cMin ? 65535 / (cMax - cMin) : 0;
      const intensity = new Uint16Array(rc.count);
      for (let i = 0; i < rc.count; i++) intensity[i] = Number.isFinite(rc.chan[i]) ? ((rc.chan[i] - cMin) * s) | 0 : 0;
      cb.push({ count: rc.count, x: rc.x, y: rc.y, z: rc.z, intensity,
                classification: rc.cat || new Uint8Array(rc.count), rgb: null, recStart: rc.recStart });
    }
    const doc = cb.flush();
    renderer.setDocBbox(doc.bboxLocal);
    applyStyle(obj.props, chanAll);
    return { count: doc.count, chanAll, k: kFor(dims, obj.props), off: [0, 0, 0],
             extent: dims, colorMode: 1, points: true };
  }

  // LAS point cloud ('points' kind): the provider streams RawChunks that ARE
  // the points-chunk shape — straight into the builder. colorBy → the point
  // shader's enum: 0 elevation, 1 intensity, 2 classification, 3 rgb.
  async function buildLas(obj) {
    const bytes = opts.getBlob && opts.getBlob(obj.props.blob);
    if (!bytes) return null;
    const { header, streamChunks } = await C.openLas(new Blob([bytes]));
    const frame = frameFor(header.bbox);
    const dims = dimsOf(header.bbox);
    renderer.removeLayer(LAYER);
    const cb = C.createChunkBuilder({ frame, chunkSize: 1 << 18, batchSize: 1 << 22,
      seed: 1, onChunk: (c) => renderer.addChunk(c, 'base', LAYER) });
    for await (const rc of streamChunks({ chunkPoints: 1 << 18 })) cb.push(rc);
    const doc = cb.flush();
    renderer.setDocBbox(doc.bboxLocal);
    renderer.setLayerRamp(LAYER, C.rampPixels(256, RAMPS[obj.props.ramp] || RAMPS.viridis));
    renderer.setFilter(null, {}, LAYER);
    const mode = { elev: 0, intensity: 1, classification: 2, rgb: 3 }[obj.props.colorBy] ?? 0;
    return { count: doc.count, k: kFor(dims, obj.props), off: [0, 0, 0],
             extent: dims, colorMode: mode, points: true };
  }

  return {
    get stats() { return lastStats; },
    get ready() { return !!built && !built.error; },
    get error() { return built && built.error; },
    // model-local → object-local placement: scale + z-lift for the duck
    modelParams() { return built && !built.error ? { k: built.k, off: built.off } : null; },

    // (re)build for the blocks object; no-op when unchanged. obj null → off.
    sync(obj) {
      if (!obj) { built = null; return false; }
      const p = obj.props;
      const key = JSON.stringify([obj.kind, p.blob, p.dm, p.chan, p.seed, p.ni, p.nj, p.nk,
                                  p.pitch, p.cutoff, p.ramp, p.edges, p.footprint, p.colorBy]);
      if (built && built.key === key) return !built.error;
      if (loading) return false;
      loading = true;
      (async () => {
        await ensureRenderer();
        const r = obj.kind === 'points' ? await buildLas(obj)
                : p.blob ? await buildFile(obj) : await buildDemo(obj);
        if (r) built = { key, ...r };           // null = blob pending, retry next frame
        loading = false;
      })().catch((e) => { built = { key, error: e.message }; loading = false; console.error('ars blocks:', e); });
      return false;
    },

    // §3.1 order-0 draw. Call BEFORE the three render, with autoClear off.
    // All matrices in the SAME world frame three renders in; the duck pulls
    // everything model-local (rigid-space rule: renormalize view rows).
    draw(projM, viewWorldM, eyeWorld, modelM, invModelM, drawOpts = {}) {
      if (!built || built.error || !renderer) return null;
      // §3.1: update the fake canvas w/h to the viewport each draw
      fake.width = gl.drawingBufferWidth; fake.height = gl.drawingBufferHeight;
      const s = duck.state;
      m4mul(projM, viewWorldM, _vp);
      m4mul(_vp, modelM, s.viewProj);
      m4mul(viewWorldM, modelM, s.view);
      for (const r of [0, 1, 2]) {              // unit camera basis under scale
        const l = Math.hypot(s.view[r], s.view[4 + r], s.view[8 + r]) || 1;
        s.view[r] /= l; s.view[4 + r] /= l; s.view[8 + r] /= l;
      }
      const tp = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
                            m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
                            m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
      const V = viewWorldM;
      s.eye = tp(invModelM, eyeWorld);
      s.target = tp(invModelM, [eyeWorld[0] - V[2], eyeWorld[1] - V[6], eyeWorld[2] - V[10]]);
      const scl = Math.hypot(modelM[0], modelM[1], modelM[2]) || 1;
      s.near = 0.02 / scl;
      s.fovY = 2 * Math.atan(1 / projM[5]);
      // MOVING-mode discipline: our composited viewport can't preserve the
      // accumulated pixels converged mode assumes, so dirty every frame
      renderer.invalidate();
      lastStats = renderer.draw(duck, {
        budget: drawOpts.budget ?? 1_500_000,
        colorMode: drawOpts.colorMode ?? built.colorMode ?? 1,
        blockEdges: drawOpts.edges ?? true,
        pointPx: drawOpts.pointPx ?? 3,
      });
      return lastStats;
    },
  };
}
