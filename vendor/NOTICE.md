# Vendored third-party code

ars bundles a few external libraries here rather than depending on a package
manager, so the system is rebuildable from source forever and works offline. Each
is pinned and hashed in `MANIFEST.json` — re-fetch from the recorded `source`,
verify the sha256, and this tree is byte-reproducible.

## three.js — MIT

3D rendering (WebGLRenderer + scene graph; WebXR via `renderer.xr` for Path A later).
Pinned **0.184.0**, the official minified ESM build, used as-is.
© three.js authors. https://threejs.org · https://github.com/mrdoob/three.js

## js-aruco2 — MIT

Fiducial marker detection + monocular pose (the `ARUCO_MIP_36h12` dictionary the
spec mandates; pose via POSIT). Vendored files `aruco.js`, `cv.js`, `svd.js`,
`posit1.js`, `posit2.js`.
© Damiano Falcioni, Juan Mellado. https://github.com/damianofalcioni/js-aruco2

Each vendored file carries its own MIT header. The bundled `LICENSE.txt` also lists
upstream *attributions* — BSD (ArUco / R. Muñoz Salinas, OpenCV) for the detection
algorithms, and an LGPL reference to AForge.NET for the POSIT *algorithm* that
`posit2.js` reimplements. Algorithms aren't copyrightable; the vendored code itself
is Mellado's original MIT implementation, so the tree is permissively licensed.

The `ARUCO_MIP_36h12` codes are baked into `aruco.js` (its default dictionary), so
none of the upstream `dictionaries/*.js` files are vendored.
