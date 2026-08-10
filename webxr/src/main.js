// @gcu/ars — WebXR AR substrate. Curated public surface. MIT.
export { IDENT, m4mul, m4translation, m4rotX, m4rotY, m4scale, m3normalFrom,
         m4rotateDir, v3cross, v3norm, v3dot } from './mat.js';
export { makeNode, addChild, updateWorlds, walkVisible, walkAll } from './scene.js';
export { makeProgram, meshDrawable, lineDrawable,
         cubeGeom, wireCubeGeom, axesGeom, ringGeom } from './gizmos.js';
export { startAR } from './session.js';
