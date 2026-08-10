// @gcu/ars — WebXR AR substrate for the GCU stack. Session kernel. MIT.
//
// startAR(opts) requests an immersive-ar session, owns the GL context, the
// XRWebGLLayer, reference spaces, the frame loop, and the order-sorted draw
// pass over the forest. Apps add roots/nodes and an onFrame hook; everything
// else is the kernel's problem. Logic is the phone-verified milestone loop
// (see ../reference/ars-m2.html), extracted with the demo wiring removed.

import { IDENT, m4mul } from './mat.js';
import { updateWorlds, walkVisible, walkAll } from './scene.js';
import { makeNode } from './scene.js';

export async function startAR({
  domOverlayRoot = null,          // element for dom-overlay, or null
  requiredFeatures = ['hit-test', 'local'],
  optionalFeatures = ['dom-overlay', 'anchors'],
  hitTest = true,                 // maintain a viewer-space hit-test source
  onEnd = null,
} = {}) {
  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures,
    optionalFeatures,
    ...(domOverlayRoot ? { domOverlay: { root: domOverlayRoot } } : {}),
  });

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { xrCompatible: true, antialias: true });
  await gl.makeXRCompatible();
  const glLayer = new XRWebGLLayer(session, gl);
  session.updateRenderState({ baseLayer: glLayer });

  const baseSpace = await session.requestReferenceSpace('local');
  const viewerSpace = await session.requestReferenceSpace('viewer');
  const hitSource = hitTest ? await session.requestHitTestSource({ space: viewerSpace }) : null;

  // root 0: world tracking space (space: null ⇒ identity against baseSpace)
  const worldRoot = { space: null, node: makeNode() };
  const forest = [worldRoot];
  const addRoot = (space) => { const r = { space, node: makeNode() }; forest.push(r); return r; };
  const removeRoot = (r) => { const i = forest.indexOf(r); if (i > 0) forest.splice(i, 1); };

  // the per-view camera handed to drawables — see SPEC.md §3 for the contract
  const cam = { state: { viewProj: new Float32Array(16), proj: null,
                         viewWorld: null, eyeWorld: [0, 0, 0] } };

  const ars = {
    session, gl, glLayer, baseSpace, viewerSpace, hitSource,
    forest, worldRoot, addRoot, removeRoot, cam,
    onFrame: null,                // (t, frame, hits) — app logic before draw
    running: false,
  };

  if (onEnd) session.addEventListener('end', onEnd);

  const drawList = [];
  const onFrame = (t, frame) => {
    if (!ars.running) return;
    session.requestAnimationFrame(onFrame);
    const pose = frame.getViewerPose(baseSpace);
    const hits = hitSource ? frame.getHitTestResults(hitSource) : [];

    if (ars.onFrame) ars.onFrame(t, frame, hits);

    // behaviors, then world matrices per root (lost roots kept but skipped)
    walkAll(worldRoot.node, (n) => n.update && n.update(n, t));
    for (const root of forest) {
      let M = IDENT;
      if (root.space) {
        const rp = frame.getPose(root.space, baseSpace);
        if (!rp) { root._lost = true; continue; }
        root._lost = false;
        M = rp.transform.matrix;
      }
      updateWorlds(root.node, M);
    }

    if (!pose) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
    gl.clearColor(0, 0, 0, 0);                          // transparent over passthrough
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    for (const view of pose.views) {
      const vp = glLayer.getViewport(view);
      gl.viewport(vp.x, vp.y, vp.width, vp.height);
      m4mul(view.projectionMatrix, view.transform.inverse.matrix, cam.state.viewProj);
      cam.state.proj = view.projectionMatrix;
      cam.state.viewWorld = view.transform.inverse.matrix;
      const ep = view.transform.position;
      cam.state.eyeWorld[0] = ep.x; cam.state.eyeWorld[1] = ep.y; cam.state.eyeWorld[2] = ep.z;

      drawList.length = 0;
      for (const root of forest) {
        if (root._lost) continue;
        walkVisible(root.node, (node) => drawList.push(node));
      }
      drawList.sort((a, b) => (a.drawable.order || 1) - (b.drawable.order || 1));
      const ctx = { gl, cam, model: null, time: t, viewport: vp };
      for (const node of drawList) {
        ctx.model = node.world;
        node.drawable.draw(ctx);
        // a heavy mount may leave arbitrary GL state — re-assert the target
        gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
        gl.viewport(vp.x, vp.y, vp.width, vp.height);
      }
    }
  };

  ars.start = () => { ars.running = true; session.requestAnimationFrame(onFrame); };
  ars.stop = () => { ars.running = false; };
  ars.end = () => session.end();
  return ars;
}
