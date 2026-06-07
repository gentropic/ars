import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mat4, vec3 } from '../src/mat4.js';
import {
  MAT_SPACE, DETECTOR_TO_MAT_DIAG,
  detectorToMat, matToDetector, poseFromDetector, registerFromCorrespondence,
} from '../src/contract.js';

const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };

test('mat space is the fixed contract (right-handed, +Y up, meters)', () => {
  assert.equal(MAT_SPACE.handedness, 'right');
  assert.equal(MAT_SPACE.up, '+Y');
  assert.equal(MAT_SPACE.units, 'meters');
  assert.deepEqual([...DETECTOR_TO_MAT_DIAG], [1, -1, -1]);
});

// THE round-trip test vector (§5.2 / §11). A marker 1 m in front of the camera and
// a little down-right in the detector convention (+X right, +Y down, +Z into scene)
// must land at the same place expressed in mat space (+Y up, camera looks down −Z).
test('detector→mat reflects Y and Z (the §5.2 test vector)', () => {
  const m = poseFromDetector([1, 0, 0, 0, 1, 0, 0, 0, 1], [0.2, 0.1, 1.0]);
  // x unchanged, y flips up, z flips to −Z-forward (WebXR camera looks down −Z)
  assert.ok(vec3.approxEqual(mat4.getTranslation(m), [0.2, -0.1, -1.0]));
});

test('detector→mat is an involution (diag(1,-1,-1)² = I)', () => {
  const m = poseFromDetector(rotY(0.6), [3, -2, 7]);
  assert.ok(mat4.approxEqual(detectorToMat(m), matToDetector(m)));
  assert.ok(mat4.approxEqual(detectorToMat(detectorToMat(m)), m, 1e-12));
});

test('detector→mat preserves rigidity (det = +1, no handedness flip)', () => {
  // a genuinely rotated detector pose
  const detectorPose = mat4.fromRT(rotX(0.7), [0.1, 0.2, 0.9]);
  assert.ok(mat4.isRigid(detectorPose));
  assert.ok(mat4.isRigid(detectorToMat(detectorPose)));
});

test('poseFromDetector equals detectorToMat ∘ fromRT', () => {
  const R = rotZ(0.4), t = [1, 2, 3];
  assert.ok(mat4.approxEqual(poseFromDetector(R, t), detectorToMat(mat4.fromRT(R, t))));
});

// §5.4: registration must satisfy the defining equation T_rig · Mt = X · C.
test('registerFromCorrespondence satisfies T_rig · Mt = X · C', () => {
  const X = mat4.fromRT(rotY(0.5), [0.3, 1.2, -0.4]);   // camera in tracking space
  const C = mat4.fromRT(rotX(-0.9), [0.05, -0.1, 0.8]); // marker in camera (mat-handed)
  const Mt = mat4.fromRT(rotZ(0.2), [1.0, 0.0, -0.5]);  // marker in mat space
  const T = registerFromCorrespondence(X, C, Mt);
  assert.ok(mat4.approxEqual(mat4.multiply(T, Mt), mat4.multiply(X, C), 1e-9));
});

test('registration is identity when the camera sits at mat origin and sees the marker in place', () => {
  const Mt = mat4.fromRT(rotZ(0.3), [2, 0, -1]);
  // X = I (camera == tracking origin == mat origin), C = Mt (marker seen exactly where it lives)
  const T = registerFromCorrespondence(mat4.identity(), Mt, Mt);
  assert.ok(mat4.approxEqual(T, mat4.identity(), 1e-9));
});

test('registerFromCorrespondence throws on a singular marker pose', () => {
  const X = mat4.identity(), C = mat4.identity();
  const singular = new Float64Array(16);
  assert.throws(() => registerFromCorrespondence(X, C, singular), /singular/);
});
