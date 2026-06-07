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
  const r9 = [R[0][0], R[0][1], R[0][2], R[1][0], R[1][1], R[1][2], R[2][0], R[2][1], R[2][2]];
  const m = mat4.fromRT(r9, t);
  m[2] = -m[2]; m[6] = -m[6]; m[10] = -m[10]; m[14] = -m[14]; // diag(1,1,-1): Z row → mat space
  return { matrix: m, error: pose.bestError, altError: pose.alternativeError };
}
