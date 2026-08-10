# ars studio

Author content in **mat space** on the desktop; phones display it anchored on
the physical printed mat. See `DESIGN.md` for the architecture and staging —
"micro lite, without the network seal, with a focus on ars."

Stage 1: the editor core — layer tree, 3D viewport (z-up, the sheet in the
ground plane, true scale), the reference mat with real 36h12 marker textures,
primitives / labels / STL meshes / images, click-select and drag-on-sheet, an
LWW scene store, project save/load, local autosave.

Stage 2: the wire — press **share**, scan the QR with a phone, and
`web/viewer.html` joins the room (vendored trystero, torrent signaling),
receives the scene + blobs, localizes on the printed mat (≥2 markers), and
renders it over the camera; the phone's pose comes back as an amber frustum
in the studio viewport.

## Run

Serve the REPO ROOT (the shell references `../vendor` and `../webxr/assets`):

```sh
npx http-server .        # or any static server, from the repo root
# → http://localhost:8080/studio/
```

## Smoke

```sh
npm i                    # playwright, repo root
node studio/harness/smoke.mjs        # editor core: store, LWW rules, scene
node studio/harness/sync-smoke.mjs   # the wire: protocol over a fake room
                                     # pair + the real viewer page rendering
```

No trackers are touched by the smokes — the room is injected (fake pair). The
live two-device path (real trackers, phone camera) is a manual test.
