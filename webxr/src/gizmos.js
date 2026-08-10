// @gcu/ars — WebXR AR substrate for the GCU stack. Extracted verbatim from the
// phone-verified single-file milestones (see ../reference/). MIT.

// One retro shader family: flat-shaded meshes (hemisphere light) + line
// batches. Every drawable obeys THE CONTRACT (see SPEC.md §3): draw into the
// bound framebuffer, bind everything you need, trust no inherited GL state.

import { m4mul, m3normalFrom } from './mat.js';

export function makeProgram(gl, vsSrc, fsSrc){
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("ars shader: " + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("ars link: " + gl.getProgramInfoLog(p));
  return p;
}
const MESH_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm;
uniform mat4 uMVP; uniform mat3 uNrm; out vec3 vN;
void main(){ vN = uNrm * aNrm; gl_Position = uMVP * vec4(aPos, 1.0); }`;
const MESH_FS = `#version 300 es
precision mediump float;
uniform vec4 uColor; in vec3 vN; out vec4 o;
void main(){
  float up = clamp(dot(normalize(vN), vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5, 0.0, 1.0);
  o = vec4(uColor.rgb * mix(vec3(0.45), vec3(1.0), up), uColor.a);
}`;
export function meshDrawable(gl, positions, normals, color){
  const prog = makeProgram(gl, MESH_VS, MESH_FS);
  const uMVP = gl.getUniformLocation(prog, "uMVP");
  const uNrm = gl.getUniformLocation(prog, "uNrm");
  const uColor = gl.getUniformLocation(prog, "uColor");
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbuf = (data, loc, size) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };
  vbuf(positions, 0, 3); vbuf(normals, 1, 3);
  gl.bindVertexArray(null);
  const n = positions.length / 3, mvp = new Float32Array(16);
  return { order: 1, draw({ gl, cam, model }){
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniformMatrix4fv(uMVP, false, m4mul(cam.state.viewProj, model, mvp));
    gl.uniformMatrix3fv(uNrm, false, m3normalFrom(model));
    gl.uniform4fv(uColor, color);
    gl.enable(gl.DEPTH_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, n);
    gl.bindVertexArray(null);
  }};
}
const LINE_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aCol;
uniform mat4 uMVP; out vec3 vC;
void main(){ vC = aCol; gl_Position = uMVP * vec4(aPos, 1.0); }`;
const LINE_FS = `#version 300 es
precision mediump float; in vec3 vC; out vec4 o;
void main(){ o = vec4(vC, 1.0); }`;
export function lineDrawable(gl, positions, colors, mode){
  const prog = makeProgram(gl, LINE_VS, LINE_FS);
  const uMVP = gl.getUniformLocation(prog, "uMVP");
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbuf = (data, loc) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
  };
  vbuf(positions, 0); vbuf(colors, 1);
  gl.bindVertexArray(null);
  const n = positions.length / 3, mvp = new Float32Array(16);
  return { order: 1, draw({ gl, cam, model }){
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniformMatrix4fv(uMVP, false, m4mul(cam.state.viewProj, model, mvp));
    gl.enable(gl.DEPTH_TEST);
    gl.drawArrays(mode, 0, n);
    gl.bindVertexArray(null);
  }};
}
export function cubeGeom(s){
  const h = s/2, P = [], N = [];
  const face = (n, a, b, c, d) => { for (const v of [a,b,c,a,c,d]){ P.push(...v); N.push(...n); } };
  face([0,0, 1], [-h,-h, h],[ h,-h, h],[ h, h, h],[-h, h, h]);
  face([0,0,-1], [ h,-h,-h],[-h,-h,-h],[-h, h,-h],[ h, h,-h]);
  face([ 1,0,0], [ h,-h, h],[ h,-h,-h],[ h, h,-h],[ h, h, h]);
  face([-1,0,0], [-h,-h,-h],[-h,-h, h],[-h, h, h],[-h, h,-h]);
  face([0, 1,0], [-h, h, h],[ h, h, h],[ h, h,-h],[-h, h,-h]);
  face([0,-1,0], [-h,-h,-h],[ h,-h,-h],[ h,-h, h],[-h,-h, h]);
  return { positions: new Float32Array(P), normals: new Float32Array(N) };
}
export function ringGeom(r, n){
  const P = [], C = [];
  for (let i = 0; i < n; i++){
    const t0 = (i/n)*Math.PI*2, t1 = ((i+1)/n)*Math.PI*2;
    P.push(Math.cos(t0)*r, 0, Math.sin(t0)*r, Math.cos(t1)*r, 0, Math.sin(t1)*r);
    C.push(.91,.69,.29, .91,.69,.29);
  }
  return { positions: new Float32Array(P), colors: new Float32Array(C) };
}

export function wireCubeGeom(s){
  const h = s/2, E = [], C = [];
  const v = [[-h,-h,-h],[h,-h,-h],[h,h,-h],[-h,h,-h],[-h,-h,h],[h,-h,h],[h,h,h],[-h,h,h]];
  const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  for (const [a,b] of edges){ E.push(...v[a], ...v[b]); C.push(.91,.69,.29, .91,.69,.29); }
  return { positions: new Float32Array(E), colors: new Float32Array(C) };
}

// from milestone 1 (reference/ars.html) — not present in the m2 source
export function axesGeom(s){
  return { positions: new Float32Array([0,0,0, s,0,0,  0,0,0, 0,s,0,  0,0,0, 0,0,s]),
           colors:    new Float32Array([.88,.42,.35, .88,.42,.35, .55,.75,.45, .55,.75,.45, .42,.66,.78, .42,.66,.78]) };
}
