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
| `mesh`    | blob (hash), fmt: stl/ply/glb, unit     | 1 (stl) / 3 (ply, glb) |
| `image`   | blob (hash), w/d (m) — plans, sections  | 3 |
| `blocks`  | blob (hash) — condenser model, §3.1 mount both ends | 4 |

Binary payloads (meshes, images, block models) are content-addressed **blobs**
(sha-256), referenced from `props.blob` — precisely `@gcu/sync`'s blob lane
(`missingBlobs`/`getBlob`/`saveBlob`), so big data transfers once and
deduplicates naturally.

Layer *visibility* is local view state, not document state — hiding a layer on
the desk must not hide it on the phone. (A future `stage` flag per layer can
make visibility authorial and synced; not v1.)

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
camera. Works on any phone with a browser, including iOS. The WebXR m3
"join room" mode (world-anchored via the datum anchor) is **stage 2b**,
following the owed phone session.

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
   scene. *Live-tracker + two-device test is manual, still owed.*
   **2b** — m3 "join room" (world-anchored WebXR display), after the phone
   session.
3. **More layers** — PLY, GLB (vendor three loaders).
4. **Condenser** — block-model layers via the §3.1 mount, both ends
   (needs the `clear:false` upstream debt for multi-mount frames).
5. **Build** — @gcu/build single-file `studio.html`, deployed on Pages next
   to the viewer.

## Non-goals

No estimation/modelling (micro's boundary holds here); no text co-editing
(the store is LWW-per-object, deliberately); no cloud persistence — the
project file is the artifact. Undo is a keystroke away from being wanted and
is explicitly deferred, not forgotten.
