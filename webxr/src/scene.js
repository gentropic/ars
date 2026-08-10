// @gcu/ars — WebXR AR substrate for the GCU stack. Extracted verbatim from the
// phone-verified single-file milestones (see ../reference/). MIT.

// The scene is a FOREST, not a tree: each root binds an XRSpace (world
// tracking, one per anchor, later one per marker, eventually one per
// negotiated shared frame). Nodes: local transform, children, optional
// drawable (leaf) and update behavior (plain function).

import { IDENT, m4mul } from './mat.js';

export function makeNode({ local = null, drawable = null, update = null, visible = true } = {}){
  return { local: local ? new Float32Array(local) : new Float32Array(IDENT),
           drawable, update, visible, children: [], world: new Float32Array(16) };
}
export function addChild(parent, child){ parent.children.push(child); return child; }
export function updateWorlds(node, parentWorld){
  m4mul(parentWorld, node.local, node.world);
  for (const c of node.children) updateWorlds(c, node.world);
}
export function walkVisible(node, fn){
  if (!node.visible) return;
  if (node.drawable) fn(node);
  for (const c of node.children) walkVisible(c, fn);
}
export const walkAll = (node, fn) => { fn(node); for (const c of node.children) walkAll(c, fn); };
