# ars studio

Author content in **mat space** on the desktop; phones display it anchored on
the physical printed mat. See `DESIGN.md` for the architecture and staging —
"micro lite, without the network seal, with a focus on ars."

Stage 1 (current): the editor core — layer tree, 3D viewport (z-up, the sheet
in the ground plane, true scale), the reference mat with real 36h12 marker
textures, primitives / labels / STL meshes / images, click-select and
drag-on-sheet, an LWW scene store already shaped to `@gcu/sync`'s contract,
project save/load, local autosave.

## Run

Serve the REPO ROOT (the shell references `../vendor` and `../webxr/assets`):

```sh
npx http-server .        # or any static server, from the repo root
# → http://localhost:8080/studio/
```

## Smoke

```sh
npm i                    # playwright, repo root
node studio/harness/smoke.mjs
```

Boots the real shell headless, adds objects through the toolbar, and checks
the LWW merge rules (remote-win, stale-loss, tombstone-holds) and the project
round-trip.
