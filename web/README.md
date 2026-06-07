# ars — web harness (Path B, magic-window)

Browser glue for validating the pure core against a real camera. Two pages:

- **`markers.html`** — generate + print `ARUCO_MIP_36h12` markers (uses js-aruco2's
  own `AR.Dictionary.generateSVG`, so the bit order matches the detector exactly).
- **`harness.html`** — the magic-window: webcam → js-aruco2 detection → POSIT pose →
  ars mat space → a three.js cube + axes drawn on each marker.

## Run it

WebXR/`getUserMedia` and ES modules need a **secure context** and HTTP (not `file://`).
`localhost` counts as secure with no TLS, so serve the repo root and open over
`http://localhost`:

```sh
# from the ars repo root
python -m http.server 8000
# then open:
#   http://localhost:8000/web/markers.html   ← print a marker (80 mm is a good start)
#   http://localhost:8000/web/harness.html   ← point the camera at the printed marker
```

Print a marker at **100% scale** (no fit-to-page), measure the black square's edge,
and set the harness's “marker mm” to that measured size.

## What to look for (the §5.2 pinning)

A cube + RGB axes should sit **on** the marker, growing out of its face, and track as
you move the camera. The axes tell you if the convention is right:

- **+Z (blue)** should point *out of the marker face*, toward you.
- **+X (red)** to the marker's right, **+Y (green)** up.

If the cube is mirrored, sunk into the marker, or the axes are flipped, the fix is the
**one sign block** in `detect.js` (`markerPose`, the `diag(1,1,-1)` line) — see the
comment there. That block is the empirical pin the spec (§5.2) defers to this step.

Detection runs on the main thread here for simplicity; moving it to a worker (§7.1) is
a later optimization.
