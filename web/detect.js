// web/detect.js — js-aruco2 detection + POSIT pose, adapted to ars mat space.
//
// Browser-only. Expects the vendored js-aruco2 classic scripts to have run first
// (cv.js, aruco.js, svd.js, posit1.js), which expose the AR / CV / POS / SVD globals.
// This module is the bridge from "pixels" to a mat-space 4×4 that drives three.js or
// feeds solveDatum.
//
// ── THE §5.2 PINNING SEAM ─────────────────────────────────────────────────────
// js-aruco2's POSIT, fed corners centered with y-up (the convention its own three.js
// sample uses and is known-good), reports a marker pose in a camera frame of
// +X right / +Y up / +Z INTO the scene. Mat space wants +Z toward the viewer, so the
// change of basis is diag(1, 1, -1) — negate the Z row. This differs from
// contract.detectorToMat's nominal diag(1,-1,-1): the Y reflection is already paid by
// the y-up corner pre-flip below. If the webcam overlay comes out mirrored or flipped,
// THIS sign block is the one knob to turn — verify empirically, then it's a constant.

import { mat4 } from '../src/main.js';

const AR = () => globalThis.AR;
const POS = () => globalThis.POS;

export function createDetector(opts = {}) {
  if (!AR()) throw new Error('ars/detect: js-aruco2 not loaded — include vendor/js-aruco2/{cv,aruco}.js first');
  return new (AR().Detector)({ dictionaryName: opts.dictionaryName || 'ARUCO_MIP_36h12' });
}

// Detect markers in an ImageData → [{ id, corners:[{x,y}×4] }].
export function detect(detector, imageData) {
  return detector.detect(imageData).map((m) => ({ id: m.id, corners: m.corners }));
}

// Marker pose in mat space (marker-local → camera, mat-handed) as a column-major 4×4,
// ready for three.js (Matrix4.fromArray) or solveDatum's observedPose.
//   corners      — [{x,y}×4] image-pixel corners from detect()
//   sizeMeters   — the marker's printed edge (POSIT modelSize → translation in meters)
//   focalPx      — focal length in pixels (heuristic: the frame width; ChArUco later)
//   width,height — detection-frame dimensions (for centering)
// Returns { matrix, error, altError } or null if POSIT found no pose.
export function markerPose(corners, { sizeMeters, focalPx, width, height }) {
  if (!POS()) throw new Error('ars/detect: js-aruco2 POSIT not loaded — include vendor/js-aruco2/{svd,posit1}.js first');
  const posit = new (POS().Posit)(sizeMeters, focalPx);
  const centered = corners.map((c) => ({ x: c.x - width / 2, y: height / 2 - c.y })); // center + y-up
  const pose = posit.pose(centered);
  if (!pose) return null;

  const R = pose.bestRotation, t = pose.bestTranslation;

  // CV → three.js / mat space. With corners pre-flipped to y-up (above), POSIT's frame
  // is left-handed (+X right, +Y up, +Z INTO the scene); three.js is right-handed
  // (+Z toward the viewer). The handedness flip on the Z axis must be a CONJUGATION
  // S·R·S (S = diag(1,1,-1)) so the rotation stays PROPER (det +1) — a one-sided S·R
  // is a reflection (det −1) and mirrors the result. Translation just takes S·t.
  // (This is the §5.2 empirical pin; if it's still wrong, the knob is S: try
  // diag(1,-1,-1) here, or drop the y-up pre-flip above.)
  const S = [1, 1, -1];
  const Rc = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) Rc[i * 3 + j] = R[i][j] * S[i] * S[j];
  const m = mat4.fromRT(Rc, [t[0] * S[0], t[1] * S[1], t[2] * S[2]]);
  return { matrix: m, error: pose.bestError, altError: pose.alternativeError };
}
