// xr-ground.js — WebXR mat grounding, extracted from ars-m3.html (the
// phone-verified epoch-2 machinery, SPEC §5): async camera tap (GPU blit →
// PBO → fence), ArUco detection on the readback, per-marker hit-test fusion
// (ray ∩ real plane, size-gated), classGate → solveDatum over the pooled
// observations, ONE world anchor with the hysteresis/replant discipline.
//
// This is the §9 extraction the webxr SPEC names ("the epoch-2 marker
// machinery still lives in the m3 single file; its extraction is the first
// task of the next engine version"). ars-m3.html remains the reference; its
// e2e still guards the embedded copies of the core this module imports live.
//
// PLATFORM FACTS honored (measured on S24+/Chrome — webxr/SPEC.md §5):
// bottom-up camera texture (camFlip default 1), SYNC_FLUSH_COMMANDS_BIT on
// the first fence wait + blocking safety valve, ONE hit-test in flight per
// marker, capture-frame view snapshots so latency cannot smear the pose.
//
// Contract with the caller (a three.js app or any WebGL2 app): construct with
// the session's gl context; call onFrame(frame, view, frameNo) every XR
// frame; read datumWorld(frame) for the mat → world matrix (null until
// grounded). All raw-GL work happens in our own FBO/VAO and we leave no
// bindings behind — but three still tracks state, so callers using three
// should renderer.resetState() after onFrame.

import { solveRigid, solveDatum, classGate } from '../src/main.js';

const DETECT_SCALE = 0.30;
const STRIDE = 3;
const HYST_T = 0.015, HYST_R = 8;
const REANCHOR_M = 0.08;
const OBS_TTL = 180;                            // frames an observation stays in the pool

// ── small matrix kit (column-major, ported verbatim from m3) ──────────────
const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function m4mul(a, b, out) {
  out = out || new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return out;
}
function m4rigidInverse(m, out) {
  out[0] = m[0]; out[1] = m[4]; out[2] = m[8]; out[3] = 0;
  out[4] = m[1]; out[5] = m[5]; out[6] = m[9]; out[7] = 0;
  out[8] = m[2]; out[9] = m[6]; out[10] = m[10]; out[11] = 0;
  out[12] = -(m[0] * m[12] + m[1] * m[13] + m[2] * m[14]);
  out[13] = -(m[4] * m[12] + m[5] * m[13] + m[6] * m[14]);
  out[14] = -(m[8] * m[12] + m[9] * m[13] + m[10] * m[14]);
  out[15] = 1; return out;
}
function quatFromMat(m) {
  const t = m[0] + m[5] + m[10]; let x, y, z, w, s;
  if (t > 0) { s = Math.sqrt(t + 1) * 2; w = s / 4; x = (m[6] - m[9]) / s; y = (m[8] - m[2]) / s; z = (m[1] - m[4]) / s; }
  else if (m[0] > m[5] && m[0] > m[10]) { s = Math.sqrt(1 + m[0] - m[5] - m[10]) * 2; w = (m[6] - m[9]) / s; x = s / 4; y = (m[4] + m[1]) / s; z = (m[8] + m[2]) / s; }
  else if (m[5] > m[10]) { s = Math.sqrt(1 + m[5] - m[0] - m[10]) * 2; w = (m[8] - m[2]) / s; x = (m[4] + m[1]) / s; y = s / 4; z = (m[6] + m[9]) / s; }
  else { s = Math.sqrt(1 + m[10] - m[0] - m[5]) * 2; w = (m[1] - m[4]) / s; x = (m[8] + m[2]) / s; y = (m[6] + m[9]) / s; z = s / 4; }
  const l = Math.hypot(x, y, z, w) || 1;
  return { x: x / l, y: y / l, z: z / l, w: w / l };
}
const v3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const v3norm = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const rotGapDeg = (a, b) => {
  const d = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[4] * b[4] + a[5] * b[5] + a[6] * b[6] + a[8] * b[8] + a[9] * b[9] + a[10] * b[10] - 1) / 2;
  return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
};

// ── camera tap (ported verbatim from m3) ─────────────────────────────────
const BLIT_VS = `#version 300 es
layout(location=0) in vec2 aPos; uniform float uFlip; out vec2 vUV;
void main(){ vUV = vec2(aPos.x, mix(aPos.y, 1.0 - aPos.y, uFlip));
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0); }`;
const BLIT_FS = `#version 300 es
precision mediump float;
uniform sampler2D uCam; in vec2 vUV; out vec4 o;
void main(){ o = texture(uCam, vUV); }`;

function makeProgram(gl, vsSrc, fsSrc) {
  const mk = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(sh));
    return sh;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  return p;
}

function makeCameraTap(gl) {
  const prog = makeProgram(gl, BLIT_VS, BLIT_FS);
  const uCam = gl.getUniformLocation(prog, 'uCam');
  const uFlip = gl.getUniformLocation(prog, 'uFlip');
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  let fbo = null, tex = null, W = 0, H = 0, pixels = null, pbo = null;
  let job = null;                               // one capture in flight
  return {
    W: 0, H: 0,
    get busy() { return !!job; },
    ensure(w, h) {
      if (w === W && h === H) return;
      W = w; H = h; this.W = w; this.H = h;
      if (tex) gl.deleteTexture(tex);
      if (fbo) gl.deleteFramebuffer(fbo);
      if (pbo) gl.deleteBuffer(pbo);
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      pbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, W * H * 4, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      pixels = new Uint8ClampedArray(W * H * 4);
      job = null;
    },
    // async capture: blit + readPixels-into-PBO + fence. The camera texture
    // dies with its rAF; the PBO copy survives. meta rides along so the pose
    // composes against the VIEW OF THE CAPTURE FRAME, not today's.
    capture(camTex, flip, meta) {
      if (job) return false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, W, H);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, camTex);
      gl.uniform1i(uCam, 0);
      gl.uniform1f(uFlip, flip ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      job = { fence: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), meta, W, H };
      gl.flush();
      return true;
    },
    poll() {
      if (!job) return null;
      // spec: the FIRST wait on a fence should flush; some implementations
      // never signal otherwise. Blocking safety valve after ~8 polls.
      const flags = job.waited ? 0 : gl.SYNC_FLUSH_COMMANDS_BIT;
      job.waited = (job.waited || 0) + 1;
      const st = gl.clientWaitSync(job.fence, flags, 0);
      if (st === gl.TIMEOUT_EXPIRED && job.waited < 8) return null;
      gl.deleteSync(job.fence);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const out = { img: { width: job.W, height: job.H, data: pixels }, meta: job.meta };
      job = null;
      return out;
    },
  };
}

// ── the grounder ──────────────────────────────────────────────────────────
// mat: { size, matPose: {id → 4×4}, overrides: {id → class} } — the §8
// manifest reduced to what grounding needs.
export function createXRGround({ gl, session, baseSpace, binding, detector, mat, camFlip = 1 }) {
  const tap = makeCameraTap(gl);
  const pendingHits = new Map();                // id → {src, corners, meta, born}
  const requesting = new Set();
  const g = {                                   // the ONE datum group (m3 discipline)
    anchor: null, anchoring: false, space: null, local: new Float32Array(IDENT),
    fusedCount: 0, seenFusedPose: false, cand: null, candN: 0, bigN: 0,
    obs: new Map(), lastFus: new Map(), refs: 0, confident: false,
  };
  const stats = { det: 0, fusReq: 0, fusOk: 0, fusRej: 0, rejWhy: '', kEma: 0, seen: 0, markersInView: 0 };
  const _inv = new Float32Array(16), _delta = new Float32Array(16), _world = new Float32Array(16);
  let frameNo = 0, lastWorld = null;

  const rayThroughPx = (px, meta) => {
    const nx = (px.x / tap.W) * 2 - 1, ny = 1 - (px.y / tap.H) * 2;
    const de = [(nx + meta.proj8) / meta.proj0, (ny + meta.proj9) / meta.proj5, -1];
    const V = meta.viewMat;
    return v3norm([V[0] * de[0] + V[4] * de[1] + V[8] * de[2],
                   V[1] * de[0] + V[5] * de[1] + V[9] * de[2],
                   V[2] * de[0] + V[6] * de[1] + V[10] * de[2]]);
  };
  const rayPlane = (E, d, P0, n) => {
    const dn = v3dot(d, n);
    if (Math.abs(dn) < 0.08) return null;       // grazing — useless
    const t = ((P0[0] - E[0]) * n[0] + (P0[1] - E[1]) * n[1] + (P0[2] - E[2]) * n[2]) / dn;
    return t > 0.05 ? [E[0] + d[0] * t, E[1] + d[1] * t, E[2] + d[2] * t] : null;
  };

  function requestFusion(id, corners, meta) {
    // ONE request in flight per marker (cancelling ripening hit-tests
    // starved the pipeline — measured)
    if (pendingHits.has(id) || requesting.has(id)) return;
    if (!session.requestHitTestSource) return;
    requesting.add(id);
    const center = { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 };
    const V = meta.viewMat;
    const dw = rayThroughPx(center, meta);
    stats.fusReq++;
    session.requestHitTestSource({
      space: baseSpace,
      offsetRay: new XRRay({ x: V[12], y: V[13], z: V[14], w: 1 },
                           { x: dw[0], y: dw[1], z: dw[2], w: 0 }),
    }).then((src) => {
      requesting.delete(id);
      pendingHits.set(id, { src, corners: corners.map((c) => ({ x: c.x, y: c.y })), meta, born: frameNo });
    }).catch(() => requesting.delete(id));
  }

  function fuseReadyHits(frame) {
    for (const [id, pnd] of pendingHits) {
      const results = frame.getHitTestResults(pnd.src);
      if (!results.length) {
        if (frameNo - pnd.born > 30) { try { pnd.src.cancel(); } catch (_) {} pendingHits.delete(id); }
        continue;
      }
      try { pnd.src.cancel(); } catch (_) {}
      pendingHits.delete(id);
      const hp = results[0].getPose(baseSpace);
      if (!hp) continue;
      const m = hp.transform.matrix;
      const P0 = [m[12], m[13], m[14]];
      let n = v3norm([m[4], m[5], m[6]]);       // hit +Y = surface normal
      const V = pnd.meta.viewMat, E = [V[12], V[13], V[14]];
      if (v3dot(n, [E[0] - P0[0], E[1] - P0[1], E[2] - P0[2]]) < 0) n = [-n[0], -n[1], -n[2]];
      const pc = [0, 1, 2, 3].map((k) => rayPlane(E, rayThroughPx(pnd.corners[k], pnd.meta), P0, n));
      if (pc.some((q) => !q)) { stats.fusRej++; stats.rejWhy = 'grazing'; continue; }
      const eTop = [pc[1][0] - pc[0][0], pc[1][1] - pc[0][1], pc[1][2] - pc[0][2]];
      const eBot = [pc[2][0] - pc[3][0], pc[2][1] - pc[3][1], pc[2][2] - pc[3][2]];
      const lTop = Math.hypot(...eTop), lBot = Math.hypot(...eBot);
      const kMeas = ((lTop + lBot) / 2) / mat.size;
      const skew = Math.abs(lTop - lBot) / Math.max((lTop + lBot) / 2, 1e-6);
      // the scale is a WITNESS, never an actor: manifest size is authoritative,
      // so a stable off-scale reading accuses the print
      if (skew < 0.35) stats.kEma = stats.kEma ? stats.kEma * 0.8 + kMeas * 0.2 : kMeas;
      if (Math.abs(kMeas - 1) > 0.2 || skew > 0.25) {
        stats.fusRej++;
        stats.rejWhy = 'edges ' + (lTop * 1000).toFixed(0) + '/' + (lBot * 1000).toFixed(0) +
          'mm vs ' + (mat.size * 1000).toFixed(0) +
          (stats.kEma && Math.abs(stats.kEma - 1) > 0.18
            ? ' → mat print scaled ×' + stats.kEma.toFixed(2) + '? reprint at 100%' : '');
        continue;
      }
      const h = mat.size / 2;
      const obsPose = solveRigid([[-h, h, 0], [h, h, 0], [h, -h, 0], [-h, -h, 0]], pc);
      stats.fusOk++;
      g.obs.set(id, { pose: obsPose, at: frameNo });
      for (const [oid, o] of g.obs) if (frameNo - o.at > OBS_TTL) g.obs.delete(oid);
      const gated = classGate([...g.obs.keys()].map((k) => ({ id: k })), { overrides: mat.overrides });
      const refs = gated.map(({ id: k }) => ({
        matPose: mat.matPose[k], observedPose: g.obs.get(k).pose, size: mat.size }));
      const datum = solveDatum(refs);
      g.refs = datum.count; g.confident = datum.confident;
      if (datum.transform) applyFused(frame, new Float32Array(datum.transform));
    }
  }

  function applyFused(frame, fused) {           // m3's hysteresis, verbatim discipline
    g.fusedCount++;
    if (g.anchor && g.space) {
      const ap = frame.getPose(g.space, baseSpace);
      if (ap) {
        m4rigidInverse(ap.transform.matrix, _inv);
        m4mul(_inv, fused, _delta);
        const dt = Math.hypot(_delta[12] - g.local[12], _delta[13] - g.local[13], _delta[14] - g.local[14]);
        const dr = rotGapDeg(g.local, _delta);
        if (dt < HYST_T && dr < HYST_R) { g.candN = 0; return; }
        if (g.cand && Math.hypot(_delta[12] - g.cand[12], _delta[13] - g.cand[13], _delta[14] - g.cand[14]) < 0.03
                   && rotGapDeg(g.cand, _delta) < 10) g.candN++;
        else { g.cand = new Float32Array(_delta); g.candN = 1; }
        g.bigN = (dt > 0.04) ? g.bigN + 1 : 0;
        if (g.bigN >= 4) { g.local.set(_delta); g.bigN = 0; g.candN = 0; return; }
        if (g.candN < 2) return;
        for (let k = 0; k < 16; k++) g.local[k] += (_delta[k] - g.local[k]) * 0.35;
        const drift = Math.hypot(g.local[12], g.local[13], g.local[14]);
        if (drift > REANCHOR_M) {               // gap-safe replant: back to world FIRST
          m4mul(ap.transform.matrix, g.local, _delta);
          g.local.set(_delta);
          g.anchor = null; g.space = null;
        }
        return;
      }
    }
    if (!g.seenFusedPose || rotGapDeg(g.local, fused) > 30) g.local.set(fused);
    else for (let k = 0; k < 16; k++) g.local[k] += (fused[k] - g.local[k]) * 0.5;
    g.seenFusedPose = true;
    if (!g.anchor && !g.anchoring && frame.createAnchor && g.fusedCount >= 2) {
      g.anchoring = true;
      const q = quatFromMat(g.local);
      const rt = new XRRigidTransform(
        { x: g.local[12], y: g.local[13], z: g.local[14] },
        { x: q.x, y: q.y, z: q.z, w: q.w });
      frame.createAnchor(rt, baseSpace).then((anchor) => {
        g.anchor = anchor; g.space = anchor.anchorSpace;
        g.local.set(IDENT);
        g.anchoring = false;
      }).catch(() => { g.anchoring = false; });
    }
  }

  return {
    stats, group: g,
    onFrame(frame, view) {
      frameNo++;
      if (view.camera) {
        if (!tap.busy && frameNo % STRIDE === 0) {
          const camTex = binding.getCameraImage(view.camera);
          if (camTex) {
            tap.ensure(Math.round(view.camera.width * DETECT_SCALE),
                       Math.round(view.camera.height * DETECT_SCALE));
            tap.capture(camTex, camFlip, {
              viewMat: new Float32Array(view.transform.matrix),
              proj0: view.projectionMatrix[0],
              proj5: view.projectionMatrix[5],
              proj8: view.projectionMatrix[8],
              proj9: view.projectionMatrix[9],
            });
          }
        }
      }
      fuseReadyHits(frame);
      const done = tap.poll();
      if (done) {
        const t1 = performance.now();
        const markers = detector.detect(done.img);
        stats.det = stats.det ? stats.det * 0.9 + (performance.now() - t1) * 0.1 : performance.now() - t1;
        stats.markersInView = markers.length;
        for (const m of markers) {
          if (!(m.id in mat.matPose)) continue;
          const el = [0, 1, 2, 3].map((k) => {
            const a = m.corners[k], b = m.corners[(k + 1) & 3];
            return Math.hypot(b.x - a.x, b.y - a.y);
          });
          const eMin = Math.min(...el), eMax = Math.max(...el);
          if (eMin < 12 || eMax / eMin > 2.5) continue;   // blur/grazing gate
          stats.seen++;
          const lf = g.lastFus.get(m.id) || 0;
          if (!g.fusedCount || frameNo - lf > 15) {
            requestFusion(m.id, m.corners, done.meta);
            g.lastFus.set(m.id, frameNo);
          }
        }
      }
    },
    // mat → world, or null before grounding. Holds the last known pose while
    // a young anchor localizes (anchors return null poses for several frames).
    datumWorld(frame) {
      if (g.space) {
        const ap = frame.getPose(g.space, baseSpace);
        if (ap) { m4mul(ap.transform.matrix, g.local, _world); lastWorld = _world; return _world; }
        return lastWorld;
      }
      if (g.seenFusedPose) return g.local;
      return null;
    },
  };
}
