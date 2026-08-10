# NOTES for merge (Claude Code)

> **MERGED 2026-08-10 into gentropic/ars as `webxr/`** (the upstream repo, per
> §"Reconciliation" below and SPEC §8b — not the auditable-monorepo target this
> file originally assumed). Deltas from the shipped zip: the duplicate
> `vendor/js-aruco2/` was dropped (byte-identical to the repo's sha256-pinned
> `/vendor/js-aruco2/`; its LICENSE-NOTE is covered by `/vendor/NOTICE.md`);
> the four harness benches had their vendor/upstream import paths repointed
> (`../../vendor/js-aruco2/`, `ARS_REPO || '../..'`) and were re-run green;
> this package's `package.json` was superseded by the repo's (version bumped
> 0.1.0 → 0.2.0 as §8b prescribes). `src/`, `demo/`, `reference/`, `assets/`
> are verbatim. The §8b wiring tasks remain open — see the repo README roadmap.

Target: `ext/ars/` in the auditable monorepo, alongside condenser.

## What's in this zip

    ars/
      SPEC.md              — the spec; §3 (contract), §5 (marker pipeline)
                             and §6 (verification law) are normative
      package.json         — @gcu/ars 1.0.0, ESM, MIT
      src/                 — epoch-1 engine modules (main/mat/scene/gizmos/
                             session); epoch-2 marker machinery still lives
                             in reference/ars-m3.html — extracting it into
                             src/ is the FIRST task of the next version
      demo/
        m1-gizmos.html     — milestone 1 on the modules (imports ../src/)
      reference/           — ALL exactly as phone-verified; ground truth
        ars.html           — m1: kernel + forest + gizmos + tap anchors
        ars-m2.html        — condenser mount + tools + handwheel panel
        ars-m3.html        — v1.0 markers: ArUco→ARCore fusion, anchored
      vendor/js-aruco2/    — svd/cv/aruco/posit1 (MIT, unmodified; also
                             embedded byte-identical in ars-m3.html);
                             register in vendor-licenses.json on merge
      assets/
        ars-marker-id0.pdf — printable 140 mm marker + verification ruler
      harness/
        e2e-m3.js          — END-TO-END: real ars-m3.html under a full WebXR
                             stub, fused pose asserted vs ground truth;
                             two scenarios (correct-setup / wrong-size)
        test.html, run.js  — condenser mount draw path (no XR)

## Merge guidance

1. `src/` files were EXTRACTED VERBATIM from reference/ars-m2.html (the
   verified artifact); session.js is the same loop with demo wiring removed.
   When in doubt, the reference files are ground truth — they ran on the
   S24+. Do not "improve" shader or matrix code without re-running both the
   harness and a phone test.
2. Wire the build like condenser: @gcu/build over src/main.js → generated
   index.js. The single-file app pattern (condenser embedded as a text/plain
   data block + Blob-URL import) is in reference/ars-m2.html; a build step
   that performs that embedding for demos would be welcome but is not
   specified here.
3. The condenser relationship is CONTRACT-ONLY (SPEC §3.1). src/ must not
   import condenser. Demos may embed the built condenser index.js.
4. Known upstream debt (do not fix silently, file it): condenser
   `clear:false` draw option for multi-mount frames; the eight-field camera
   duck and the rigid-space assumption should eventually be documented on
   condenser's side too.
5. harness: `npm i puppeteer` inside harness/, then `node run.js` (condenser
   mount; auto-copies ext/condenser/index.js) and `node e2e-m3.js` (marker
   end-to-end; serve reference/ars-m3.html on :8078 or adjust the URL). The
   e2e is the merge gate for anything touching the marker path: BOTH
   scenarios must pass. SPEC §6 is law: parse-checking is not verification.
6. GCU conventions assumed: MIT, English naming, no Portuguese source names,
   Switchboard-adjacent palette in demos (amber #e8b04b on basalt).
7. m2 demo modularization is OPTIONAL and was deliberately not done here:
   the tool belt + wheel UI is app code, not engine; keep reference/ars-m2.html
   as the canonical demo until someone wants to re-plumb it against src/.

8. Epoch-2 merge notes: keep the platform facts of SPEC §5 attached to the
   code (bottom-up camera texture, aligned intrinsics, fence flush flag,
   one-in-flight hit-tests) — they are measured device behavior, not style.
   The retired focal-calibration remains in the file as a constant-1 hook
   with its retirement documented inline; do not resurrect it silently.
9. Marker generation: AR.Dictionary('ARUCO').generateSVG(id) in-page, or
   assets/ars-marker-id0.pdf for print. For diagnostic work generate a
   high-entropy id (see SPEC §5 testing rule).

## Reconciliation with gentropic/ars (read SPEC §8b first)

github.com/gentropic/ars is the upstream, device-free core (contract, classes,
manifest, Horn datum solve; @gcu/ars 0.1.0). This package is its WebXR device
slice. When merging into the monorepo: vendor or submodule the upstream src/ as
the core, keep this package's engine + marker pipeline as the device edge,
version 0.2.0. The dictionary switch to ARUCO_MIP_36h12 and the
solveDatum-for-anchoring refactor are the first two tasks of that merge —
both are specified in SPEC §8b and §5c, and the e2e harness must stay green
throughout (it is the merge gate).
