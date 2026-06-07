// eigen.js — symmetric eigendecomposition via cyclic Jacobi rotations. Zero-dep.
//
// Small dense symmetric matrices only (we use it on the 4×4 Horn matrix in the datum
// solve). Jacobi is the right tool here: robust, simple, no pivoting, and exact for
// the tiny well-conditioned systems ars produces. Matrices are array-of-arrays
// (number[][]); eigenvectors come back as the COLUMNS of `vectors`.

export function symmetricEig(Ain, opts = {}) {
  const maxSweeps = opts.maxSweeps ?? 100;
  const eps = opts.eps ?? 1e-14;
  const n = Ain.length;

  const a = Ain.map((row) => row.slice());
  const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off <= eps) break;

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p][q];
        if (Math.abs(apq) <= 1e-300) continue;

        // rotation that zeros a[p][q] (Numerical Recipes form)
        const theta = (a[q][q] - a[p][p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        // A ← Jᵀ A J  (apply to columns p,q, then rows p,q)
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        // V ← V J  (accumulate eigenvectors)
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }

  return { values: a.map((row, i) => row[i]), vectors: V };
}

// Index of the largest eigenvalue.
export function argmax(values) {
  let k = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[k]) k = i;
  return k;
}
