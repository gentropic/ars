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

> Status: **v0.1 — pure contract core.** This package currently ships the device-free,
> zero-dependency heart of the system. The device edges and the datum solve are the
> next slices (see *Roadmap*).

## What's here (v0.1)

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

- **Datum solve (§6)** — fuse a constellation of ≥2 reference correspondences into a
  robust, drift-corrected `T_rig`; surveyed and discovered modes; the planar-ambiguity
  rule. The next slice (algorithm choice — pose-averaging vs Kabsch/Umeyama on marker
  geometry — TBD).
- **Detector wrapper (§3)** — vendored js-aruco2 behind the pose interface; verify the
  `POS.Pose` two-candidate sign convention and pin it (§5.2 note).
- **Device edges** — the WebXR `camera-access` frame grab (§7.4, the one *contingent*
  dependency, validated on-device first) and the registration/render path (§5.4, §10).
- **Sync (§9)** — authority/viewport session over `@gcu/sync` (already built); deferred
  here on purpose — it's the low-risk, understood half.

Shipped as a standalone viewer **and** an Auditable Works surface from this one repo;
deployed over GitHub Pages (https = the secure context WebXR/`getUserMedia` require).

## Develop

```sh
npm test     # node --test — pure, no install needed
```

Specs are CC0; this reference implementation is MIT.

— Geoscientific Chaos Union · https://gentropic.org
