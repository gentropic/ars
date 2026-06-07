// @gcu/ars — pure contract core (the re-export surface).
//
// This is the device-free, zero-cloud heart of ars: the coordinate contract, the
// class gate, and the manifest — all deterministic and unit-tested. The device edges
// (camera-access frame grab §7.4, WebXR registration/render §5.4/§10) and the datum
// solve over a constellation (§6) attach to these primitives in later slices.

export { mat4, vec3 } from './mat4.js';

export {
  MAT_SPACE,
  DETECTOR_TO_MAT_DIAG,
  detectorToMat,
  matToDetector,
  poseFromDetector,
  registerFromCorrespondence,
} from './contract.js';

export {
  CLASS,
  DEFAULT_RANGES,
  classOf,
  isReference,
  isObject,
  isContent,
  classGate,
  partitionByClass,
} from './classes.js';

export {
  DEFAULT_DICTIONARY,
  parseManifest,
  getMarker,
  resolveClass,
  resolveOrigin,
} from './manifest.js';

export { symmetricEig } from './eigen.js';

export { solveRigid, solveDatum, markerCorners } from './solve.js';
