# ars — SPEC

@gcu/ars is the GCU WebXR AR substrate: a small engine for placing geometry
in the world through a phone, and — in a later epoch — the protocol by which
several devices agree on a shared frame and hallucinate the same geometry
together. This document specifies the substrate as built and PHONE-VERIFIED
(v1.0, Aug 2026): epochs 1 (engine) and 2 (markers) are done and working.

シングルファイルデプロイ applies: the canonical distribution of any ars app is
one HTML file. In-repo, source lives in modules and a build (same @gcu/build
convention as condenser) emits the single file; heavyweight passengers
(condenser, the vendored ArUco stack) ride along as embedded script blocks —
`text/plain` + Blob-URL import for ES modules, plain script blocks for
namespace libraries. Working patterns: reference/ars-m2.html (condenser),
reference/ars-m3.html (ArUco).

## 1. Identity and epochs

- **Epoch 1 — the substrate (DONE).** Session kernel, scene forest, gizmo
  drawables, the mount contract. reference/ars.html, reference/ars-m2.html.
- **Epoch 2 — markers (DONE).** Camera-access → ArUco → ARCore fusion → a
  world-anchored root per printed marker. reference/ars-m3.html.
- **Epoch 3 — the protocol.** Two or more devices sharing marker-anchored
  frames over Trystero. A shared frame is just another kind of root.

The name does not change between epochs.

## 2. Architecture: a forest of XRSpaces

The scene is a FOREST, not a tree. Each root binds an XRSpace:

    root 0   — the `local` reference space (world tracking); space === null
    root N   — one per XRAnchor (tap-to-place, or planted by a marker)
    (epoch 3) one per negotiated shared frame

Per frame, each root resolves its pose against the base space; a root whose
pose is unavailable is *kept, not deleted*, and — hard-won rule — renders
with its LAST KNOWN pose rather than blinking out (freshly created anchors
return null poses for several frames while ARCore localizes them).

Under each root hangs an ordinary transform tree:

    node = { local: mat4, world: mat4 (computed), children: [],
             visible, drawable?, update?(node, t) }

Behaviors are plain `update` functions. World matrices are recomputed by a
full walk per frame; dirty-flag caching is future work that must not change
the API.

## 3. THE DRAWABLE CONTRACT (the law of the land)

A drawable is an object with `draw(ctx)` and an optional numeric `order`
(default 1; lower draws earlier). ctx:

    gl        WebGL2 context. The XR framebuffer is ALREADY BOUND and the
              viewport ALREADY SET. Draw into the current framebuffer.
              Bind everything you depend on, every call; trust no GL state
              you didn't set; leave no promises about state after you.
              (The kernel re-asserts framebuffer+viewport after every
              drawable, so a messy mount cannot break its neighbors.)
    cam       cam.state carries the per-view camera in WORLD space:
                viewProj   P·V                (Float32Array 16, column-major)
                proj       the XR projection matrix
                viewWorld  the world→eye view matrix
                eyeWorld   [x, y, z] viewer position
    model     the node's world matrix (root-space pose · local chain).
    time      XRFrame time (ms).
    viewport  {x, y, width, height} — informational; already applied.

### 3.1 Mounting condenser (or any heavy renderer)

Compatibility with condenser is by CONTRACT, not shared code:

1. **The camera duck is EIGHT fields, not one** — condenser's draw reads
   `cam.state.{viewProj, view, eye, target, near, fovY, ortho, halfH}`,
   all expressed in the space of the coordinates handed over (model-local),
   so eye/target pull through M⁻¹ and view = viewWorld · M.
2. **The duck space is assumed RIGID** — condenser reads the rotation rows
   of `view` as the unit camera basis; a scaled mount must re-normalize
   those rows or every impostor collapses by the scale factor.
3. **Context by duck, clear by order** — a fake canvas
   `{width, height, getContext: () => gl}` hands condenser the ars context;
   `setBackground([0,0,0,0])` keeps passthrough alive through its MOVING
   clear; the mount runs at `order: 0`; at most ONE clearing mount per frame
   until condenser grows `clear:false` (filed upstream debt). Update the
   fake canvas w/h to the viewport each draw.

In AR condenser lives permanently in MOVING mode — the mode designed for a
moving camera. @gcu/frame rides on nodes as data, not in the contract.

## 4. Session kernel

`startAR(opts)` (src/session.js) owns: session request, the xrCompatible
WebGL2 context and XRWebGLLayer, `local` + `viewer` reference spaces, an
optional hit-test source, the frame loop (`session.requestAnimationFrame` —
NEVER window rAF, which is unreliable under an immersive session; all UI
animation, e.g. wheel momentum, integrates here), per-view cam fill, and the
order-sorted draw pass. Screen taps arrive as XR `select` events whose
`inputSource.targetRaySpace` is the ray through the tapped point; DOM
overlay UI must `beforexrselect` → `preventDefault()`.

MANDATORY in every ars app: a window `error` hook that surfaces exceptions
to the splash/HUD. Two invisible ReferenceErrors cost an evening; a phone
has no console.

## 5. Epoch 2: the marker pipeline (as shipped in reference/ars-m3.html)

**Detector**: ArUco 5×5 ("ARUCO", 1024 ids) via vendored js-aruco2 + POSIT
(+ svd.js, all MIT — Falcioni 2020 / Mellado 2011-12; see vendor/).

**Camera tap** (async, off the critical path): XRWebGLBinding.getCameraImage
→ GPU blit to a DETECT_SCALE (0.30) FBO → readPixels into a PBO + fenceSync
→ poll; on signal, map and detect. Camera textures die with their rAF; the
PBO copy survives. The FIRST clientWaitSync must pass
SYNC_FLUSH_COMMANDS_BIT (some GL stacks never signal otherwise), with a
blocking getBufferSubData safety valve after ~8 polls. Every capture carries
a SNAPSHOT of that frame's view matrix + projection terms; the pose composes
against the snapshot, so latency cannot smear it.

**PLATFORM FACTS (measured, S24+/Chrome 150)**:
- The camera texture is BOTTOM-UP (GL convention). Blit with a V-flip;
  default camFlip = 1. The in-session debug view (readback + corners) is
  the ORACLE: it must look right-side up, and the UI says so. A mirrored
  readback poisons every downstream computation while detection of
  mirror-invariant markers keeps "working".
- Camera intrinsics are NOT exposed, but the camera frame IS aligned with
  the view projection (measured scale ×0.96–1.02 once orientation was
  fixed). Unproject camera pixels with the FULL inverse view projection,
  principal-point terms included: de = [(nx+p8)/p0, (ny+p9)/p5, −1].
  (An earlier 2× FOV-mismatch theory was an artifact of mirrored data —
  retracted.)

**Quality gate on sightings**: reject corner sets with any edge < 12 px or
edge ratio > 2.5 (motion blur, grazing views) before anything downstream.

**The fusion (single source of truth)**: ArUco supplies IDENTITY and
in-image geometry; ARCore supplies WORLD geometry. Per accepted sighting: a
world-fixed ray through the detected center (capture-frame eye + snapshot
unprojection) goes to requestHitTestSource — ONE in flight per marker
(cancelling ripening requests starved the pipeline), throttled to ~every 15
frames once locked. On hit: plane = hit position + hit +Y (flipped toward
the eye); all FOUR corner rays intersect that plane; center = mean of the
four points; x-axis = mean of top and bottom edges projected into the
plane; y = n × x. Both edges must match the entered marker size within 20%
and each other within 25% or the fusion is rejected — and a *stable*
off-scale reading prints the size the user should have typed ("set marker
size ≈ 139 mm?"). The scale measurement is a WITNESS, never an actor: no
feedback into the rays (a calibration loop only masks config errors).

**POSIT is bootstrap-only**: it previews a pose until the first fusion and
then permanently loses write access. It never plants anchors. (Its planar
ambiguity and depth noise are why; and note its compose convention leaves
marker z pointing away — irrelevant for a preview that dies in ~2 frames.)

**Anchoring ("the merge")**: fused pose → XRAnchor (planted from the 2nd
fused pose); the root binds anchorSpace so ARCore world tracking carries
the content between sightings and through occlusion. New fusions apply
anchor-local corrections through a HYSTERESIS gate: < 1.5 cm / 8° is
ignored (identical poses in, zero motion out — the flicker killer); larger
moves need two consecutive fusions agreeing within 3 cm / 10°; and an
ESCAPE HATCH force-snaps after four consecutive > 4 cm disagreements — the
anchor can be wrong, never stubbornly wrong. Drift beyond 8 cm re-plants
the anchor GAP-SAFELY: the smoothed pose converts back to world coordinates
BEFORE the space is dropped (an anchor-local matrix on a world root renders
at the session origin). Rotation gaps > 30° snap instead of blending —
element-wise interpolation between distant rotations is not a rotation.

**Marker sheets**: assets/ars-marker-id0.pdf — 140 mm black square (the
size entered = the BLACK square), 100 mm verification ruler, print at 100%.
The size field default matches the PDF and persists in localStorage; the
session status announces the active size. TESTING RULE: id 0 is
mirror-invariant and masked three orientation bugs — prefer a high-entropy
id for diagnosis; id 0 remains fine for production use.

## 5b. Detector characterization (benchmarked, node, vendored js-aruco2)

Synthetic 886×1920 frames (S24+ XRCamera geometry, fy≈1786 px), box-downscaled
to the readback resolution, median of 15 runs. Node times; the phone runs the
same code ~2.5× slower (measured 12.8 ms on-device vs 4.9 ms here at 0.30).
There is NO homegrown GCU marker detector — @gcu/qr is encode-only by design
("scanning is the phone's native camera") — so js-aruco2 is the only detection
in the GCU orbit and these are its numbers.

- **Scale sweep** (140 mm @ 0.45 m, sharp): detects cleanly from scale 0.15
  (83 px marker, 3.0 ms) to 0.50 (12.4 ms); cost ≈ linear in pixels; corner
  center error ≤ 0.7 px at every scale. The shipped 0.30 (4.9 ms node /
  ~13 ms phone) is conservative; **0.20–0.25 is a valid cost cut** when
  working ≤ 1 m.
- **Range envelope** (scale 0.30, 140 mm): detects to **1.5 m** (50 px
  marker); fails at 2.0 m (38 px). Range scales with marker size and
  DETECT_SCALE — bigger print or higher scale for room-sized frames.
- **Blur**: tolerant to box-blur radius 4 in readback px at 0.45 m (synthetic
  high-contrast; real motion blur is harsher — the edge-ratio sighting gate
  remains the real defense).
- **Multi-marker**: four markers in-frame at 1.2 m: all found, 7.4 ms, max
  center error 0.8 px — multi-root and the shared-frame epoch pay ~1.5× a
  single detection, not 4×.
- Bench script: `harness/bench.cjs` (rerunnable; extend for new devices).
- Field caveat: keep testing with high-entropy ids (id 7+); id 0 is
  mirror-invariant and masked three orientation bugs.

## 5c. Single-marker pose: vendored vs written (benchmarked)

The vendored code (js-aruco2 POSIT, monocular 2D→pose) and the written code
(@gcu/ars `solveRigid`, Horn 3D→3D on plane-lifted corners) solve the same
problem once a surface plane is known. Head-to-head on identical synthetic
observations (140 mm @ 0.5 m, focal 536 px = the m3 readback geometry;
`harness/bench-vendored-vs-written.mjs`):

- **POSIT is angle-dependent and ambiguity-cursed near-frontal**: 8–9° median
  rotation error (p90 14°) at 2° tilt — the two-fold planar ambiguity measured
  — improving to 0.3–0.9° only past ~25° tilt. 162 µs (iterative).
- **The written path is angle-INDEPENDENT**: Horn holds 0.06–0.22° and
  0.2–0.7 mm at every tilt and noise level (10–40× better rotation), because a
  known plane deletes the ambiguity from the problem. 15 µs (closed-form).
  The m3 ad-hoc basis (shipped in ars-m3.html) lands within ~1.5× of Horn
  at 4 µs.
- **Honest caveat**: POSIT needs nothing but pixels + focal; the written path
  needs a plane. This RATIFIES the shipped architecture — POSIT as the
  zero-knowledge bootstrap preview, plane-fused solve as the steady state —
  and queues one upgrade at merge time: `solveRigid` replaces the m3 basis,
  and multi-marker `solveDatum` replaces single-marker anchoring outright
  (datum bench: 1→4 markers cuts rotation error ~5×, 1.61°→0.30° at
  σ=2 mm; 3–4.5 µs; `harness/bench-datum.mjs`).

### 5c-addendum: the magic-window regime (no plane source)

With no WebXR plane (plain webcam), POSIT is load-bearing, not bootstrap — and
the constellation is the disambiguator, not a residual gate:
`harness/bench-magicwindow.mjs` (per-marker POSIT → solveDatum, 100 mm @ 0.6 m,
σ=0.5 px): at the near-frontal danger angle (8° tilt) a single marker is
unusable (24° median — ambiguity flips dominate) but a SECOND marker collapses
it to 3.3° — the sheet baseline makes the flip solutions mutually inconsistent
and the joint rigid fit rejects them structurally. At 20–40° tilt: 0.5–0.8°.
Two honest findings: (1) a residual gate adds NOTHING (flips are not outliers —
every marker flips alike near-frontal; measured identical) — do not build it;
(2) the ~3° near-frontal floor is per-marker POSIT bias, and the upgrade that
removes it is a JOINT constellation solve over all corners at once
(homography/IPPE or reprojection refinement) — i.e. the @gcu/pose slice from
the May 2026 stack plan, the point where written code would genuinely
supersede the vendored pose estimator.

### Field note: id 0 is hand-drawable

The id-0 duality, resolved: worst TEST marker (mirror-invariant — masked three
orientation bugs; test with busy ids), best FIELD marker (one bar; cannot be
drawn mirrored because its mirror is itself; rotation resolved by the
dictionary; only geometry can fail). Recipe on page 2 of
`assets/ars-marker-id0.pdf`: square side S, bar S/7 wide at S/7 from the left,
S/7 clear top and bottom, quiet margin ≥ S/7; measure the real square and
enter that. The recipe page's own diagram detects as id 0 (verified from
raster). Page 3 extends this to the FIELD ALPHABET: the dictionary contains
exactly three pure-stripe markers — id 0 (thin bar at 1S/7), id 682 (thin
bars at 2S/7 + 5S/7), id 341 (thin at 1S/7 + fat 3S/7-wide at 3S/7) — all
drawn with one technique, all mirror-proof (a mirrored drawing reads as a
180° rotation of the same id), all three page-3 diagrams detector-verified
(hd 0). Three markers on one sheet = a hand-drawn reference mat: a full
constellation datum (0.40° class, per §5c) with no printer involved.
Improvised datums: Sharpie on cardboard, whiteboard in a meeting. And the
apex of the ladder: id 341 is the unique STRIP-CONSTRUCTIBLE marker (every
black element exactly one cell wide, frame + crossbar, one connected piece) —
buildable from five strips of matte tape (glare-sim: full detection to ~15%
specular coverage on the black areas, degrading near 30%), or printed as
`assets/ars-marker-341.stl`: a one-piece 140×140×2 mm flat extrusion (~29 g
PLA, no supports; print matte black, lay on any white surface) — a rigid,
reusable, pocketable datum. The STL's silhouette is detector-verified (id 341,
hd 0).

### Reference mat (assets/ars-mat-a4.pdf + ars-mat-manifest.json)

Two-page A4 constellation mat: four 80 mm markers (ids 7/23/98/133) at
(±55, ±85) mm from a printed origin cross — page 1 in classic ARUCO (works
with today's ars-m3), page 2 in ARUCO_MIP_36h12 (the post-merge dictionary),
same ids and layout. The manifest carries matPose translations in metres for
solveDatum. Both pages detector-verified: exactly 4 detections, correct ids,
centers within 0.25 mm of survey. Two findings from its own verification,
binding on the merge: (1) **set `maxHammingDistance: 4`** — the js-aruco2
default (dictionary tau, 12 for 36h12) admits ghost detections at hd 10, and
the repo's `createDetector` currently inherits that default; (2) keep text
and any ink out of quiet zones — a label 0.6 mm from the quiet-zone edge
contaminated the contour and split one marker into two warped candidates.

## 6. Verification law

Parse-checking is not verification. harness/e2e-m3.js loads the REAL
single-file app in headless Chrome (SwiftShader WebGL2) under a full WebXR
stub — session, frames, bottom-up camera texture (matching the device),
hit-test, anchors — pumps ~90 frames, and asserts the fused pose against
analytic ground truth. Two scenarios, both must pass before anything
reaches a phone:
- correct-setup: anchors at ground truth (±2 cm asserted; achieves ±1 mm),
  scale ×≈1;
- wrong-size-entered: must NOT anchor and must suggest the correct size.
harness/test.html + run.js cover the condenser mount path (points, blocks,
sections, isolate filter). The harness has caught: a deleted function,
missing helpers, fence never signaling, fusion self-starvation, and the
stub's own wrong texture orientation. Keep it merciless.

## 7. Scope refusals

No asset importers, no PBR, no physics, no controller abstraction, no
editor. Native drawables stay gizmo-grade; heavy data mounts via §3.1.
Instrument, not atelier.

## 8. Roadmap

1. **Condenser on the marker** — the block model as a marker-root child;
   epoch 1's mount meets epoch 2's root. Mostly composition, not new code.
2. **Walk-through mode** (m2) — section plane locked to the viewer.
3. **Real-world depth occlusion** — order:-1 depth prepass from
   XRDepthInformation.
4. **Epoch 3** — Trystero rooms; QR-capsule SDP for the offline story;
   shared-frame roots. Two phones + one printed square = the collective
   consensual hallucination.

Also owed: condenser `clear:false`; dip wheel; pick column probe;
dirty-flag worlds; detection in a Worker if detect ms ever matters.

## 8b. Lineage and reconciliation with gentropic/ars (UPSTREAM)

ars was designed 2026-06-07 (SPEC-ars.md v0.1: the name, "Augmented Reference
System", the ARUCO_MIP_36h12 decision, the reference/object/content taxonomy,
the ~10× side-length sizing rule) and implemented as **github.com/gentropic/ars**
(@gcu/ars 0.1.0, MIT) — pushed 2026-08-02 after sitting local. That repo is the
device-free half: the §5 coordinate contract as test-vectored code (detector→mat
`diag(1,−1,−1)` involution), the §4 class gate (only reference-class
observations may move the datum), the §8 manifest, Horn's-method `solveRigid`/
`solveDatum` (§6) with discovered-mode `solveLayout` (§6.2), a webcam-verified
magic-window, and a 36h12 marker printer. 54/54 tests pass.

THIS package is the other half — the WebXR device edge the repo's roadmap names
("camera-access §7.4, WebXR registration §5.4/§10") — built independently on
2026-08-02 and phone-verified. The two agree at the seam. Merge shape:

- **The repo is upstream truth.** This package becomes its device slice
  (version → 0.2.0, not this package's presumptuous 1.0.0).
- m3's marker pipeline feeds corner observations through `classGate` into
  `solveDatum`; the fused T_rig replaces per-marker anchoring (one anchor for
  the datum, content hung in mat space).
- `solveRigid` replaces the m3 ad-hoc basis (§5c numbers).
- **OPEN (Arthur's call): switch m3 to ARUCO_MIP_36h12** — the June decision;
  Hamming 12 vs the base dictionary's 3; retroactively kills the id-0
  mirror-invariance pathology that masked three orientation bugs. Needs a
  regenerated marker PDF + harness geometry parameterized from `dic.markSize`
  (8×8 bits → black square = 8 cells, not 7).
- The two bench scripts in harness/ document the seam; bench-datum and
  bench-vendored-vs-written import @gcu/ars — run them with the repo checked
  out (see harness header comments).

## 9. Package map

- reference/ — ars.html (m1), ars-m2.html (condenser + tools + wheels),
  ars-m3.html (markers, v1.0): all EXACTLY as phone-verified; ground truth
  over any "improvement".
- src/ — the epoch-1 engine modules (mat, scene, gizmos, session, main).
  The epoch-2 marker machinery still lives in the m3 single file; its
  extraction into src/ is the first task of the next engine version.
- vendor/js-aruco2/ — svd.js, cv.js, aruco.js, posit1.js (MIT, unmodified).
- assets/ — the printable marker PDF.
- harness/ — e2e-m3.js (WebXR-stub end-to-end), test.html + run.js
  (condenser mount), all runnable via `npm i` (playwright, repo root) then
  `node <file>` from harness/ — each serves its own files in-process.
