// @gcu/ars — WebXR AR substrate for the GCU stack. Extracted verbatim from the
// phone-verified single-file milestones (see ../reference/). MIT.

// Column-major Float32Array(16), GL convention — the ops raw WebXR needs.

export const IDENT = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
export function m4mul(a, b, out){
  out = out || new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++){
    out[c*4+r] = a[r]*b[c*4] + a[4+r]*b[c*4+1] + a[8+r]*b[c*4+2] + a[12+r]*b[c*4+3];
  }
  return out;
}
export function m4translation(x, y, z){ const m = new Float32Array(IDENT); m[12]=x; m[13]=y; m[14]=z; return m; }
export function m4rotY(rad){ const m = new Float32Array(IDENT), c=Math.cos(rad), s=Math.sin(rad); m[0]=c; m[2]=-s; m[8]=s; m[10]=c; return m; }
export function m4rotX(rad){ const m = new Float32Array(IDENT), c=Math.cos(rad), s=Math.sin(rad); m[5]=c; m[6]=s; m[9]=-s; m[10]=c; return m; }
export function m4scale(s){ const m = new Float32Array(IDENT); m[0]=s; m[5]=s; m[10]=s; return m; }
export function m3normalFrom(model){
  return new Float32Array([model[0],model[1],model[2], model[4],model[5],model[6], model[8],model[9],model[10]]);
}

export const v3cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export const v3norm = (a) => { const l = Math.hypot(a[0],a[1],a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
export const v3dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
// rotate a DIRECTION through a mat4 (w=0), normalized
export const m4rotateDir = (m, d) => v3norm([m[0]*d[0]+m[4]*d[1]+m[8]*d[2],
                                      m[1]*d[0]+m[5]*d[1]+m[9]*d[2],
                                      m[2]*d[0]+m[6]*d[1]+m[10]*d[2]]);
