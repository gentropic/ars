// discovered.js — discovered-mode datum establishment (SPEC §6.2).
//
// Reference markers are placed ad hoc; their relative layout is NOT known a priori.
// A rig observes references together over a short mapping phase; we triangulate their
// relative poses and freeze the result as the datum. Once frozen, discovered
// references behave exactly as surveyed ones — the output poses plug straight into
// solveDatum as `matPose`.
//
// How it works: every frame that sees two references i and j pins their relative pose
// (Cᵢ⁻¹·Cⱼ, camera-independent since both are seen at once). Those pairwise relations
// form a graph over the reference ids; we pick an origin (Mt = identity), then walk a
// spanning tree out from it, composing relative poses to place every reachable marker
// in the origin's frame. Multiple co-observations of a pair are fused with the same
// corner-point least-squares as the surveyed solve (Horn), so noise averages out.

import { mat4 } from './mat4.js';
import { solveRigid, markerCorners } from './solve.js';
import { classGate } from './classes.js';

// Solve the reference layout from a sequence of observations.
//
// `observations` — an array of frames; each frame is an array of { id, pose } where
// `pose` is the marker's pose in the rig's camera (marker-local → camera, already
// mat-handed via detectorToMat). Object/content markers are gated out (§4.3) so a
// stray prop can't corrupt the static layout.
//
// Returns { poses, origin, connected, missing }:
//   • poses (Map<id, 4×4>): each reachable reference's pose in MAT space (the origin's
//     frame). Feed straight into solveDatum({ matPose: poses.get(id), ... }).
//   • origin: the designated origin id (opts.origin, else the lowest reference id).
//   • connected: every observed reference was placed.
//   • missing: reference ids never bridged to the origin by a co-observation chain.
export function solveLayout(observations, opts = {}) {
  const size = opts.size ?? 0.1;
  const frames = (observations || []).map((f) => classGate(f, opts));

  const idSet = new Set();
  for (const f of frames) for (const o of f) idSet.add(o.id);
  const ids = [...idSet].sort((a, b) => a - b);
  if (!ids.length) return { poses: new Map(), origin: null, connected: false, missing: [] };

  // Accumulate corner correspondences per co-observed pair (i < j): the canonical
  // local corners L mapped to marker j's corners expressed in marker i's frame.
  const L = markerCorners(mat4.identity(), size);
  const pairAcc = new Map(); // "i,j" → { from:[], to:[] }
  for (const f of frames) {
    const byId = new Map(f.map((o) => [o.id, o.pose]));
    const present = [...byId.keys()].sort((a, b) => a - b);
    for (let a = 0; a < present.length; a++) {
      for (let b = a + 1; b < present.length; b++) {
        const i = present[a], j = present[b];
        const CiInv = mat4.invert(byId.get(i));
        if (!CiInv) continue;
        const rel = mat4.multiply(CiInv, byId.get(j)); // j-local → i-local
        const jc = markerCorners(rel, size);
        const key = i + ',' + j;
        let acc = pairAcc.get(key);
        if (!acc) { acc = { from: [], to: [] }; pairAcc.set(key, acc); }
        for (let k = 0; k < 4; k++) { acc.from.push(L[k]); acc.to.push(jc[k]); }
      }
    }
  }

  // Fuse each pair into a directed relative pose; build adjacency.
  const adj = new Map(ids.map((id) => [id, []]));
  const relPose = new Map(); // "a,b" → 4×4 (b-local → a-local)
  for (const [key, acc] of pairAcc) {
    const [i, j] = key.split(',').map(Number);
    const Tij = solveRigid(acc.from, acc.to); // j-local → i-local
    relPose.set(i + ',' + j, Tij);
    relPose.set(j + ',' + i, mat4.invert(Tij));
    adj.get(i).push(j);
    adj.get(j).push(i);
  }

  const origin = opts.origin != null && ids.includes(Number(opts.origin)) ? Number(opts.origin) : ids[0];

  // BFS spanning tree from the origin; Mt_origin = I, Mt_b = Mt_a · (b-local → a-local).
  const poses = new Map([[origin, mat4.identity()]]);
  const queue = [origin];
  while (queue.length) {
    const a = queue.shift();
    for (const b of adj.get(a)) {
      if (poses.has(b)) continue;
      poses.set(b, mat4.multiply(poses.get(a), relPose.get(a + ',' + b)));
      queue.push(b);
    }
  }

  const missing = ids.filter((id) => !poses.has(id));
  return { poses, origin, connected: missing.length === 0, missing };
}
