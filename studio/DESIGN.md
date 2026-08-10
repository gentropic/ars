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

## Sync (stage 2)

`@gcu/sync` (auditable/ext/sync — vendored here with the usual MANIFEST
hashes) over `trysteroChannel(room)`. The studio generates a room id and shows
it as a QR; the phone scans with its native camera (GCU position: @gcu/qr is
encode-only, scanning is the phone's camera). Sessions re-run on change with
debounce; sync is state convergence, not messaging, so a rejoining phone just
catches up. Presence rides as ephemeral messages outside the store (pose @
~5 Hz, expiring), never merged into the document.

The phone side lands in m3: a "join room" entry that receives the scene and
hangs it under the datum root — objects are already in mat space, so placement
is the identity. m3's gizmo renderer covers axes/box/label/mesh; condenser
mounts per webxr SPEC §3.1 (stage 4).

Path B (magic-window) doubles as a no-phone preview: laptop webcam pointed at
the mat on the desk.

## Distribution

Single-file discipline (シングルファイルデプロイ): the repo carries readable
modules + a dev shell (`studio/index.html`, plain ES modules, works on GitHub
Pages and localhost); releases build ONE `studio.html` via @gcu/build (the
AST bundler — auditable/ext/build), vendored passengers embedded as script
blocks exactly like ars-m3.html embeds the core. Until the build lands, the
dev shell IS the app.

## Stages

1. **Editor core (this commit)** — layer tree, 3D viewport (vendored three),
   true-scale mat from the §8 manifest (real 36h12 marker textures via the
   vendored dictionary), primitives + labels + STL meshes, click-select +
   drag-on-mat + inspector, LWW store shaped to the sync contract,
   project save/load (JSON + blobs), localStorage autosave.
2. **The wire** — vendor @gcu/sync + trystero; QR pairing; m3 "join room"
   viewer mode; presence frustum in the studio.
3. **More layers** — PLY, GLB (vendor three loaders), image quads.
4. **Condenser** — block-model layers via the §3.1 mount, both ends
   (needs the `clear:false` upstream debt for multi-mount frames).
5. **Build** — @gcu/build single-file `studio.html`, deployed on Pages next
   to the viewer.

## Non-goals

No estimation/modelling (micro's boundary holds here); no text co-editing
(the store is LWW-per-object, deliberately); no cloud persistence — the
project file is the artifact. Undo is a keystroke away from being wanted and
is explicitly deferred, not forgotten.
