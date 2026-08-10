# ars studio — design

A desktop studio for authoring content in **mat space**, synced live to phones
that display it anchored on the physical printed mat. "micro lite, without the
network seal, with a focus on ars": the micro ethos — honest lens, local-first,
single self-contained HTML file, layers panel + 3D view — but the seal is
deliberately broken in exactly one place: the peer room. No cloud, no accounts,
no server of ours; the only network is WebRTC to your own devices.

## The mental model

**Mat space is the shared document.** The studio is a mat-space scene editor:
the reference mat (the §8 manifest) drawn true-scale at the origin of a 3D
view, content placed relative to the printed sheet. The phone is a mat-space
display: it localizes against the physical mat (the m3 datum path — classGate
→ solveDatum → one anchor) and renders the same scene on the real table.

Authority is asymmetric (core SPEC §9):

- the **studio** owns the scene — every object, layer, transform;
- the **phone** owns nothing but its own pose — it reports presence
  (viewer pose in mat space), which the studio draws as a small frustum, so
  the desk knows where the room is standing.

## Coordinate conventions

Mat space per core SPEC §5.1: right-handed, meters, origin at the printed
cross, x right / y up **on the sheet**, z out of the sheet. On a table the
sheet is horizontal, so mat +z is room-up: the studio viewport uses
`camera.up = (0,0,1)` and the mat lies in the ground plane. There is ONE
frame; nothing is remapped.

## The scene document

An LWW object map with tombstones — the shape `@gcu/sync` merges natively
(set-union; stamps `[lamport, actor]`, higher clock wins, actor id breaks
ties). Everything is an object:

    { id, kind, name, layer, t: [x,y,z] (m, mat space), rz (rad, about mat z),
      s (uniform scale), props { per-kind }, stamp }

Kinds (staged, all designed now):

| kind      | props                                   | stage |
|-----------|-----------------------------------------|-------|
| `layer`   | color; membership by objects' `layer`   | 1 |
| `axes`    | size                                    | 1 |
| `box`     | w/d/h (m), wire or solid, color         | 1 |
| `label`   | text, size; billboard on the phone      | 1 |
| `mesh`    | blob (hash), fmt: stl/ply/glb, unit     | 1 (stl) / 3 (ply+glb DONE) |
| `image`   | blob (hash), w/d (m) — plans, sections  | 3 |
| `blocks`  | demo recipe OR blob+chan/ramp/cutoff (csv/dm, sub-blocked incl.) | 4 |
| `points`  | blob (las), colorBy elev/intensity/class/rgb, ramp | 4 |

Binary payloads (meshes, images, block models) are content-addressed **blobs**
(sha-256), referenced from `props.blob` — precisely `@gcu/sync`'s blob lane
(`missingBlobs`/`getBlob`/`saveBlob`), so big data transfers once and
deduplicates naturally.

**What a layer IS here** (settled 2026-08-10): a named GROUP of items — an
organizational unit, not a data binding. In micro a layer IS a dataset; in
ars, an ITEM is the dataset-sized thing (a `blocks` item ≈ a micro layer) and
a layer groups items, micro-group style. Both levels carry an eye; effective
visibility = the item's eye AND its layer's eye (micro's rule: "children keep
their own eyes").

**Visibility is DOCUMENT state** (revised 2026-08-10 — it was local view
state in the first cut): `hidden` on items and layers syncs like every other
property, so hiding on the desk hides on the phone — one mental model, the
phone displays the document. A desk-only staging mode (dim/isolate without
touching the document) can come later if the need shows up.

**The chrome** (micro's grammar, on the REAL toolkit — vendored `@gcu/menu`, the Switchboard-tier package; micro itself carries an older inline kit predating it):
commands live in MENUS — the menubar (file / add / view) and context menus
(right-click a tree row, an object in the viewport, or empty mat for
add-at-this-spot) — knobs live in the two permanent panes (tree left,
inspector right; unlike micro's toggling panels, ours are fixed).
dblclick / F2 rename, Delete deletes, `h` toggles the selected eye,
Escape closes menus / deselects. **Undo/redo** (Ctrl+Z / Ctrl+Y, edit menu):
gesture-grouped snapshots — a change after >400 ms of quiet opens a new
history entry, so a 60 fps drag is ONE undo step; restore re-stamps fresh so
peers converge like any edit. **Arrows nudge** the selection on the mm grid
(1 mm; Shift 10 mm; PgUp/PgDn in z), drags SNAP to the mm grid, Ctrl+D
duplicates. View presets: plan (top) / oblique / zoom-to. The **status bar**
is live: selection @ mm, item count, and the condenser mount state — a
failing block-model load shows there in red, never only in the console.

## Sync (stage 2 — REVISED 2026-08-10, shipped)

**Direct trystero, not @gcu/sync.** With the studio as sole authority the wire
degenerates to one-way replication + an ephemeral back-channel; a symmetric
merge engine would be machinery without a payload. Four actions on a vendored
trystero room (torrent signaling — no accounts, zero-cloud):

    scene  authority → room      whole document, on join + debounced change
    need   viewer → authority    blob hashes the viewer lacks
    blob   authority → viewer    bytes + {hash}, content-verified on save
    pose   viewer → room         viewer pose in mat space, throttled, ephemeral

The whole-document rebroadcast is deliberately dumb: tiny (blobs ride
separately by hash), and a phone that joins late or drops gets current truth
by construction — no deltas, no catch-up protocol. The store underneath KEEPS
its LWW+tombstone merge — that is what makes this dumb wire safe (idempotent
rebroadcast) and what `@gcu/sync` slots into at **epoch 3**, when peers become
symmetric authors (two phones annotating the shared frame) and convergence
becomes the real problem. The store contract is already its store contract.

The studio generates a room id and shows it as a QR (`@gcu/qr`, encode-only —
scanning is the phone's native camera); presence renders as an expiring amber
frustum per viewer in the studio viewport.

**The first phone display is `web/viewer.html`** (mat-window): Path B webcam
detection + `classGate` → `solveDatum` against the mat manifest (datum updates
only with ≥2 gated references — the bench-magicwindow flip rule), the studio's
own `objects.js` builders rendering the received scene in mat space over the
camera. Works on any phone with a browser, including iOS — and since 2b,
Android Chrome upgrades in place to a WORLD-ANCHORED WebXR tier
(`web/xr-ground.js`) behind the same URL.

## Distribution

Single-file discipline (シングルファイルデプロイ): the repo carries readable
modules + a dev shell (`studio/index.html`, plain ES modules, works on GitHub
Pages and localhost); releases build ONE `studio.html` via @gcu/build (the
AST bundler — auditable/ext/build), vendored passengers embedded as script
blocks exactly like ars-m3.html embeds the core. Until the build lands, the
dev shell IS the app.

## Stages

1. **Editor core (DONE 2026-08-10)** — layer tree, 3D viewport (vendored
   three), true-scale mat from the §8 manifest (real 36h12 marker textures via
   the vendored dictionary), primitives + labels + STL meshes + images,
   click-select + drag-on-mat + inspector, LWW store shaped to the sync
   contract, project save/load (JSON + blobs), localStorage autosave.
2. **The wire (DONE 2026-08-10)** — vendored trystero (torrent subgraph) +
   @gcu/qr; the four-action protocol; studio share button (QR + peers badge +
   presence frustums); `web/viewer.html` mat-window phone viewer. Smoke: the
   protocol over a fake room pair + the real viewer page rendering a received
   scene. *Field-verified live (phone on the printed mat) 2026-08-10.*
   **2b (DONE 2026-08-10, phone re-verify owed)** — the viewer is THREE-TIER,
   one URL: WebXR + camera-access (Android Chrome) runs `web/xr-ground.js` —
   the m3 epoch-2 machinery extracted as an ESM module (camera tap, hit-test
   fusion, classGate → solveDatum, ONE anchor with the hysteresis/replant
   discipline) riding three's renderer.xr — content stays world-anchored when
   markers leave view; every other platform (iOS included) keeps the strict
   marker-based magic-window unchanged. Tier 1 is an ATTEMPT (camera-access
   is only knowable at requestSession; visionOS rejects) falling back to
   tier 2. Smoke: the real viewer against a three-compatible WebXR stub +
   fake room — grounds, anchors, reports pose. m3 stays the reference app.
3. **More layers (DONE 2026-08-10)** — PLY + GLB meshes (three addon loaders vendored VERBATIM from the pinned 0.184.0 tarball; bare 'three' resolves via an import map in both pages, so the hashes hold); vertex-only PLY renders as points. KTX2/Draco GLBs unsupported (no decoder vendored). Same slice: HARDENING — sub-blocked csv/dm ride the dimPalette (they rendered at full lattice size before); gridless/irregular models fall back to graded centroids-as-points (micro's path) instead of refusing; and LAS point clouds land as the `points` kind through the same condenser mount (elevation/intensity/classification/rgb coloring).
4. **Condenser (v1 DONE 2026-08-10)** — `blocks` layers render through the
   §3.1 mount on ALL THREE surfaces (studio viewport, magic-window, XR loop):
   condenser draws at order 0 into the same GL context (its clear is the
   frame clear; three renders on top, autoClear off, sharing clip-space z
   because the duck reuses three's projection). The three side keeps a
   wire-box proxy for picking/placement. v1 limits, deliberate: ONE blocks
   layer per scene (condenser clear-on-draw — the `clear:false` upstream
   debt); permanent MOVING mode (a ±1e-7 duck nudge defeats the exact
   lastVP compare, since converged-accumulation assumes pixels persist,
   which a composited viewport can't grant — the debt's other half; now
   expressed through `renderer.invalidate()`, the intended API). Data modes:
   the seeded DEMO DEPOSIT recipe in props (deterministic both ends, nothing
   to blob), and — **since the file slice (2026-08-10)** — REAL block models
   over the blob lane: **CSV/TXT via `openBlockModel` and Datamine .dm via
   `openDmModel`** (micro's own providers, already in the vendored bundle).
   Both ends re-discover from the same bytes, so props carry only the blob
   hash + styling: **color column** (from `header.numericColumns`, a
   dropdown), **ramp preset** (micro's five: viridis/spectral/magma/turbo/
   greys via `setLayerRamp`), grade **cutoff** (isolate mask), edges,
   footprint. Gridded models only for now (sub-blocked/irregular → clear
   error; the centroids-as-points fallback is a later slice, as are LAS
   point clouds and multi-mount once condenser grows `clear:false` +
   render-target APIs).
5. **Build — DROPPED (2026-08-10, Arthur's call).** The single-file
   discipline earns its keep where the file and the SEAL are one promise
   (micro: offline, double-click, nothing leaves the machine). The studio
   broke the seal on purpose — the phone leg needs https and the share QR
   encodes the serving URL, so a file:// studio dies at the moment of use.
   Longevity is served differently here: the repo is the artifact (readable
   modules, byte-pinned vendors, Pages serving the repo raw), and the durable
   user artifact is the PROJECT file (scene.ars.json + blobs), which exists.
   Revisit only if a sealed desk-only authoring mode becomes a real need.

## Non-goals

No estimation/modelling (micro's boundary holds here); no text co-editing
(the store is LWW-per-object, deliberately); no cloud persistence — the
project file is the artifact. Undo is a keystroke away from being wanted and
is explicitly deferred, not forgotten.
