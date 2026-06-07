// contract.js — the coordinate contract (SPEC §5). The most important section:
// multiple rigs on a shared frame requires every implementation to agree on the
// same conventions, or content arrives mirrored, rotated, or scaled. The contract
// is fixed here as pure, deterministic, test-vectored code — no device, no camera.

import { mat4 } from './mat4.js';

// Mat space (§5.1): right-handed, +Y up, +X to the datum's right, +Z out of the
// origin marker's printed face (toward its viewer). Units: meters, recovered from
// declared marker sizes (§5.3). Matches WebXR / three.js handedness, so the mapping
// from mat space into a rig's reference space is a rigid transform with no axis
// surgery.
export const MAT_SPACE = Object.freeze({
  handedness: 'right',
  up: '+Y',
  right: '+X',
  toViewer: '+Z',
  units: 'meters',
});

// Detector convention (§5.2): OpenCV / ArUco report a marker's pose in camera space
// as +X right, +Y down, +Z forward (into the scene). The change of basis to a
// WebXR-handed space reflects the Y and Z axes:
//
//     M_mat = diag(1, -1, -1) · M_detector
//
// i.e. negate rows 1 and 2 of the 4×4. det(diag(1,-1,-1)) = +1, so the rotation
// stays a proper rotation — the pose is re-expressed, not handedness-flipped.
export const DETECTOR_TO_MAT_DIAG = Object.freeze([1, -1, -1]);

// §5.2 IMPLEMENTATION NOTE — the *exact* sign/lane convention of a given detector's
// pose output (notably js-aruco2's POS.Pose, which returns two candidate poses) must
// be verified empirically and pinned during the §7.4 camera-access spike. This
// function implements the spec's TARGET convention (mat space); choosing the correct
// pose candidate and matching the detector's axis order is an implementation constant
// applied upstream, not a per-session variable. The round-trip test vector guards the
// contract this function promises.
//
// The map is an involution (diag(1,-1,-1)² = I): mat → detector is the same op.
export function detectorToMat(m) {
  const out = Float64Array.from(m);
  out[1] = -out[1]; out[5] = -out[5]; out[9] = -out[9]; out[13] = -out[13]; // row 1 (Y)
  out[2] = -out[2]; out[6] = -out[6]; out[10] = -out[10]; out[14] = -out[14]; // row 2 (Z)
  return out;
}

export const matToDetector = detectorToMat;

// Convenience: a detector pose given as a row-major 3×3 rotation + translation →
// a mat-space 4×4. The shape js-aruco2's POS.Pose hands back (best-candidate R, t).
export function poseFromDetector(r9, t3) {
  return detectorToMat(mat4.fromRT(r9, t3));
}

// Per-rig registration (§5.4) — the rigid transform T_rig = (rig tracking space) ←
// (mat space). From ONE reference correspondence:
//   • markerInCamera (C): the marker's pose in the rig's camera, already mat-handed
//     (run the detector output through detectorToMat first).
//   • cameraInTracking (X): the camera's pose in the rig's WebXR tracking space.
//   • markerInMat (Mt): the marker's known pose in mat space (from the manifest in
//     surveyed mode, or the frozen datum in discovered mode).
// The marker, expressed in tracking space two ways, must agree:
//   T_rig · Mt = X · C   ⇒   T_rig = X · C · Mt⁻¹
//
// A single reference is ambiguous (§6.3); fusing ≥2 correspondences into a robust,
// drift-corrected T_rig is the datum solve (§6) — the next slice. This is the
// per-correspondence primitive that solve builds on.
export function registerFromCorrespondence(cameraInTracking, markerInCamera, markerInMat) {
  const MtInv = mat4.invert(markerInMat);
  if (!MtInv) throw new Error('ars: marker mat-space pose is singular (cannot invert)');
  return mat4.multiply(mat4.multiply(cameraInTracking, markerInCamera), MtInv);
}
