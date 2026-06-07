// mat4.js — minimal column-major 4×4 + 3-vector linear algebra. Zero-dep.
//
// Column-major to match WebXR (XRRigidTransform.matrix) and three.js (Matrix4):
// the element at row r, column c lives at index c*4 + r. A rigid pose is a 4×4
// homogeneous transform. Mat space (SPEC §5.1) shares WebXR handedness, so mapping
// mat space into a rig's reference space is a plain rigid transform — no axis
// surgery — and these are the only primitives the contract + datum solve need.
//
// Rotations are passed/returned as row-major 3×3 arrays (r9[i*3 + j] = R[i][j]),
// the way they're written on paper and the way js-aruco2 reports them; fromRT /
// getRotation do the column-major bridge.

export const mat4 = {
  identity() {
    const m = new Float64Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },

  clone(a) { return Float64Array.from(a); },

  // C = A · B  (B applied first, then A — the usual transform composition order).
  multiply(a, b) {
    const out = new Float64Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        out[c * 4 + r] = s;
      }
    }
    return out;
  },

  // Build a homogeneous transform from a row-major 3×3 rotation and a translation.
  fromRT(r9, t3) {
    const m = new Float64Array(16);
    m[0] = r9[0]; m[1] = r9[3]; m[2] = r9[6];
    m[4] = r9[1]; m[5] = r9[4]; m[6] = r9[7];
    m[8] = r9[2]; m[9] = r9[5]; m[10] = r9[8];
    m[12] = t3[0]; m[13] = t3[1]; m[14] = t3[2];
    m[15] = 1;
    return m;
  },

  translation(t3) {
    const m = mat4.identity();
    m[12] = t3[0]; m[13] = t3[1]; m[14] = t3[2];
    return m;
  },

  getTranslation(m) { return [m[12], m[13], m[14]]; },

  // Row-major 3×3 rotation from the upper-left block.
  getRotation(m) {
    return [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
  },

  // Apply to a point (w = 1): rotation + translation.
  transformPoint(m, p) {
    const x = p[0], y = p[1], z = p[2];
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
    ];
  },

  // Apply to a direction (w = 0): rotation only.
  transformDir(m, v) {
    const x = v[0], y = v[1], z = v[2];
    return [
      m[0] * x + m[4] * y + m[8] * z,
      m[1] * x + m[5] * y + m[9] * z,
      m[2] * x + m[6] * y + m[10] * z,
    ];
  },

  // General 4×4 inverse (gl-matrix, column-major). Returns null if singular.
  invert(m) {
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1.0 / det;
    const o = new Float64Array(16);
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  },

  // Fast inverse for a rigid transform (orthonormal R, no scale): Rᵀ and −Rᵀt.
  rigidInvert(m) {
    const o = new Float64Array(16);
    // Rᵀ
    o[0] = m[0]; o[1] = m[4]; o[2] = m[8];
    o[4] = m[1]; o[5] = m[5]; o[6] = m[9];
    o[8] = m[2]; o[9] = m[6]; o[10] = m[10];
    // −Rᵀt
    const tx = m[12], ty = m[13], tz = m[14];
    o[12] = -(m[0] * tx + m[1] * ty + m[2] * tz);
    o[13] = -(m[4] * tx + m[5] * ty + m[6] * tz);
    o[14] = -(m[8] * tx + m[9] * ty + m[10] * tz);
    o[15] = 1;
    return o;
  },

  approxEqual(a, b, eps = 1e-9) {
    for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > eps) return false;
    return true;
  },

  // Is the upper-left 3×3 a proper rotation (orthonormal rows, det +1)?
  isRigid(m, eps = 1e-6) {
    const r = mat4.getRotation(m); // row-major
    const rows = [[r[0], r[1], r[2]], [r[3], r[4], r[5]], [r[6], r[7], r[8]]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (let i = 0; i < 3; i++) {
      for (let j = i; j < 3; j++) {
        const want = i === j ? 1 : 0;
        if (Math.abs(dot(rows[i], rows[j]) - want) > eps) return false;
      }
    }
    const det =
      r[0] * (r[4] * r[8] - r[5] * r[7]) -
      r[1] * (r[3] * r[8] - r[5] * r[6]) +
      r[2] * (r[3] * r[7] - r[4] * r[6]);
    return Math.abs(det - 1) <= eps;
  },
};

export const vec3 = {
  add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; },
  sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; },
  scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; },
  dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
  cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  },
  length(a) { return Math.hypot(a[0], a[1], a[2]); },
  normalize(a) {
    const l = Math.hypot(a[0], a[1], a[2]);
    return l ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
  },
  approxEqual(a, b, eps = 1e-9) {
    return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps && Math.abs(a[2] - b[2]) <= eps;
  },
};
