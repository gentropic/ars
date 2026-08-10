// blocks.js — condenser block-model layers (DESIGN.md stage 4), mounted per
// webxr/SPEC.md §3.1: fake-canvas context handoff, the EIGHT-FIELD camera
// duck in MODEL-LOCAL space, order-0 drawing (condenser draws FIRST, three
// renders on top with autoClear off — condenser's clear is the frame clear).
//
// v1 limits, deliberate:
// - ONE blocks object per scene (condenser's clear-on-draw — the `clear:false`
//   upstream debt — makes a second mount erase the first).
// - MOVING-mode discipline everywhere: clear + budget-limited draw every
//   frame, no settled accumulation (in AR the camera never settles anyway;
//   on the desktop this keeps one code path).
// - Data is the seeded DEMO DEPOSIT recipe carried in props (deterministic —
//   both ends rebuild the same chunk from the same seed; nothing to blob).
//   Real file formats ride the blob lane later.
//
// The reference mount recipe is webxr/harness/test.html (headless-verified);
// the duck math below is that code, made reusable.

let condenser = null;                           // lazy: the 400 KB bundle loads
async function loadCondenser() {                // only when a blocks layer exists
  if (!condenser) condenser = await import('../../vendor/condenser/index.js');
  return condenser;
}

// ── the demo deposit (test.html's synthetic orebody, parameterized) ───────
// Two dipping gaussian lodes on a regular grid. Deterministic per seed.
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

// world-units-per-model-unit so the deposit's LARGEST footprint side spans
// `footprint` meters of mat (props.footprint, default 12 cm)
export function demoModelScale(props) {
  const NI = props.ni ?? 48, NJ = props.nj ?? 48, S = props.pitch ?? 10;
  return (props.footprint ?? 0.12) / (Math.max(NI, NJ) * S);
}
// model-units z-lift that sets the deposit ON the mat (grid is z-centered)
export function demoLift(props) {
  return ((props.nk ?? 24) * (props.pitch ?? 10)) / 2;
}
export function demoExtent(props) {
  const NI = props.ni ?? 48, NJ = props.nj ?? 48, NK = props.nk ?? 24, S = props.pitch ?? 10;
  const k = demoModelScale(props);
  return [NI * S * k, NJ * S * k, NK * S * k];  // world-size wire-box proxy
}

// ── the mount ─────────────────────────────────────────────────────────────
// createBlocksMount(gl) → { sync(obj), draw(...), stats }. One per view.
export function createBlocksMount(gl, opts = {}) {
  let renderer = null, C = null, fake = null;
  let built = null;                             // { key, chan, count }
  let lastStats = null, loading = false, flip = false;

  const m4mul = (a, b, out) => {
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return out;
  };
  const duck = { state: { viewProj: new Float32Array(16), view: new Float32Array(16),
                          eye: [0, 0, 0], target: [0, 0, 0], near: 0.1, fovY: 1.0, ortho: false, halfH: 1 } };
  const _vp = new Float32Array(16);

  return {
    get stats() { return lastStats; },
    get ready() { return !!built; },

    // (re)build condenser state for the blocks object; no-op when unchanged.
    // Returns true once ready. obj === null tears down.
    sync(obj) {
      if (!obj) { built = null; return false; }
      const key = JSON.stringify([obj.props.seed, obj.props.ni, obj.props.nj, obj.props.nk,
                                  obj.props.pitch, obj.props.cutoff, obj.props.edges]);
      if (built && built.key === key) return true;
      if (loading) return false;
      loading = true;
      loadCondenser().then((mod) => {
        C = mod;
        if (!renderer) {
          fake = { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, getContext: () => gl };
          renderer = C.createRenderer(fake);
          // condenser's MOVING draw clears with ITS background: transparent
          // for passthrough (viewer), the panel color for the studio
          renderer.setBackground(opts.background ?? [0, 0, 0, 0]);
        }
        const { chunk, chan } = buildDemoChunk(C, obj.props);
        renderer.setDocBbox(chunk.bboxLocal);
        renderer.addChunk(chunk);
        const cutoff = obj.props.cutoff ?? 0;
        if (cutoff > 0) {
          const mask = new Uint8Array(chan.length);
          for (let i = 0; i < chan.length; i++) mask[i] = chan[i] >= cutoff ? 1 : 0;
          renderer.setFilter(mask, { isolate: true });
        } else renderer.setFilter(null);
        built = { key, count: chunk.count };
        loading = false;
      }).catch((e) => { loading = false; console.error('ars blocks:', e); });
      return !!built;
    },

    // §3.1 order-0 draw. Call BEFORE the three render, with autoClear off.
    //   projM      — camera projection (column-major 16)
    //   viewWorldM — world → eye (camera.matrixWorldInverse)
    //   eyeWorld   — camera position in world
    //   modelM     — blocks model → world (object wrapper world matrix)
    //   invModelM  — its inverse
    // All in the SAME world frame three renders in; the duck pulls everything
    // model-local per the contract (rigid-space rule: renormalize view rows).
    draw(projM, viewWorldM, eyeWorld, modelM, invModelM, opts = {}) {
      if (!built || !renderer) return null;
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
      // keep condenser in MOVING mode (full re-raster under our per-frame
      // clear): its converged state assumes accumulated pixels persist, which
      // a composited three viewport can't grant (the accumulation half of the
      // clear:false upstream debt). ±1e-7 defeats the exact lastVP compare
      // and is far below visual precision. AR is permanently MOVING anyway.
      flip = !flip;
      s.viewProj[12] += flip ? 1e-7 : -1e-7;
      lastStats = renderer.draw(duck, {
        budget: opts.budget ?? 1_500_000,
        colorMode: opts.colorMode ?? 1,
        blockEdges: opts.edges ?? true,
      });
      return lastStats;
    },
  };
}
