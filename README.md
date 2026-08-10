# ars — Augmented Reference System

A browser-native way to establish a **shared spatial coordinate frame** from printed
fiducial markers, so several devices — a headset in mixed reality, a phone as a
magic-window, a desktop driving the scene — overlay the *same* virtual content on the
*same* physical space, with no cloud, no SDK, and no install. **The printed sheet is
the shared origin.**

ars invents no tracking. It sits on top of WebXR (per-device pose), a fiducial
detector (marker pose), and a peer transport (state sync), and provides the one thing
none of them provides alone: a shared, **classed** coordinate frame. Lower risk,
fully auditable, nothing to deprecate out from under it.

> Status: **v0.2 — contract core + WebXR device slice.** The device-free,
> zero-dependency heart of the system (`src/`), plus the phone-verified WebXR
> device edge (`webxr/` — session kernel, marker pipeline, ArUco→ARCore fusion).
> The two halves are not yet wired to each other; that reconciliation is the
> current work (see *Roadmap* and `webxr/SPEC.md` §8b).

## What's here (core)

| module | spec | what |
|---|---|---|
| `mat4.js` | — | column-major 4×4 + vec3 linear algebra (matches WebXR / three.js) |
| `contract.js` | §5 | mat space conventions, the detector→mat change of basis, per-rig registration |
| `classes.js` | §4 | marker classes (`reference` / `object` / `content`) and **the class gate** |
| `manifest.js` | §8 | parse/validate a mat manifest; resolve class and origin |

All of it is pure, deterministic, and unit-tested — no camera, no headset, no network.
This is deliberate: the contract is the substance, and it's identical whether a rig
auto-registers from camera frames or falls back to manual alignment.

### The contract, in one breath

- **Mat space** (§5.1): right-handed, +Y up, meters, origin at a designated
  `reference` marker. Matches WebXR/three.js handedness so registering into a rig is a
  plain rigid transform.
- **Detector → mat** (§5.2): `M_mat = diag(1, -1, -1) · M_detector` — reflect Y and Z.
  An involution; det +1 (no handedness flip). Guarded by a round-trip test vector.
- **The class gate** (§4.3, load-bearing): only `reference`-class observations feed the
  datum. A waved `object` marker can never drag the world origin.
- **The manifest is the program** (§8): markers are dumb stable ids; the manifest binds
  them to class, printed size, origin, and (for `content` markers) a capsule address.

## Usage

```js
import {
  poseFromDetector, classGate, parseManifest, resolveOrigin, registerFromCorrespondence,
} from '@gcu/ars';

const manifest = parseManifest(JSON.parse(manifestText));
const origin = resolveOrigin(manifest, seenIds);

// detector reports marker poses (row-major R + translation t) in camera space:
const references = classGate(detections).map((d) => ({
  id: d.id,
  poseInCamera: poseFromDetector(d.R, d.t), // → mat-handed
}));
// fuse references into a robust T_rig: the datum solve (§6) — next slice.
```

## Roadmap

Done:

- **Datum solve (§6)** — Horn's quaternion constellation registration; **surveyed** and
  **discovered** (§6.2) modes; the planar-ambiguity rule (corner-point fit, ≥2 markers).
- **Path B — magic-window** (`web/`) — vendored js-aruco2 detection + POSIT, the §5.2
  detector→mat convention **pinned and webcam-verified** (a `diag(1,1,-1)` conjugation
  with y-up corners), three.js overlay aligned to the detection frame.
- **Path A — WebXR device slice** (`webxr/`, merged 2026-08) — session kernel, scene
  forest, gizmo drawables, heavy-renderer mount contract, and the epoch-2 marker
  pipeline (camera-access → ArUco → ARCore hit-test fusion → world-anchored roots),
  all **phone-verified** (S24+); its own spec, benches, and a WebXR-stub e2e harness
  live in `webxr/`. The `camera-access` spike (§7.4) is thereby validated on-device.
- **Dictionary switch** — m3 now runs **ARUCO_MIP_36h12** (the June design decision;
  Hamming 12, kills the id-0 mirror pathology) with `maxHammingDistance: 4` set
  explicitly here and in `web/detect.js` (ghost-detection guard, the binding mat
  finding). e2e + benches green; detector envelope unchanged, detection faster.
- **The halves are wired (§8b complete)** — m3's marker pipeline feeds observations
  through `classGate` into `solveDatum`: the reference mat's ids fuse into **one
  datum** (single root + anchor at the printed origin, content hung in mat space,
  per-marker `solveRigid` poses pooled across sightings); ad-hoc ids keep the v1.0
  per-marker path. The core (`mat4`/`eigen`/`classes`/`manifest`/`solve`) rides
  embedded verbatim in the single file, and the e2e seam guard refuses to run if
  the embed drifts from `src/`. Four e2e scenarios green.
  *Phone re-verification of the three m3 upgrades still owed (one session).*

- **Studio, stages 1–2** (`studio/` + `web/viewer.html`) — the desktop mat-space
  editor (layer tree, 3D view with the reference mat at true scale, primitives /
  labels / STL / images, LWW scene store) now **synced to phones**: press share,
  scan the QR, and the viewer joins a serverless WebRTC room (vendored trystero),
  receives the scene, localizes on the printed mat, and renders it over the
  camera — the phone's pose returns as a presence frustum on the desk.
  `studio/DESIGN.md` is the plan; next: m3 "join room" (WebXR), condenser
  layers, single-file build. Smoke-tested headless (trackerless fake rooms);
  the live two-device pass is a manual test still owed.

Next:

- **ChArUco intrinsics (§3.2)** — recover real focal/principal point for accurate metric
  depth (the current focal = frame-width is a heuristic; orientation is already correct).
- **Anchors (optional, Path A)** — WebXR *local* anchors to steady the datum between
  marker sightings (§7.3) and device-local *persistent* anchors to restore it across
  sessions (§14); config-gated + feature-detected, degrading to marker re-grounding.
  *Cloud anchors are out of scope* — no WebXR API exists, and ars is zero-cloud by
  design: the printed datum + peer sync are the cross-device shared reference.
- **Sync (§9)** — authority/viewport session over `@gcu/sync` (already built).

Deployed over GitHub Pages (https = the secure context WebXR/`getUserMedia` require):

- **studio** — https://gentropic.org/ars/studio/
- **phone viewer** (mat-window, opened by the studio's share QR) —
  https://gentropic.org/ars/web/viewer.html
- **WebXR m3** (Path A, Android/ARCore) — https://gentropic.org/ars/webxr/reference/ars-m3.html
- printable mat — https://gentropic.org/ars/webxr/assets/ars-mat-a4.pdf (page 2, print at 100%)

Still to ship from this repo: the Auditable Works surface.

## Develop

```sh
npm test     # node --test — pure, no install needed
```

Specs are CC0; this reference implementation is MIT.

— Geoscientific Chaos Union · https://gentropic.org
