// mat.js — the reference mat, true scale, at the origin of the studio view.
// Layout truth is webxr/assets/ars-mat-manifest.json (the same file the mat
// PDF was generated from); markers are rasterized from the vendored 36h12
// dictionary (window.AR), so what you see IS what the phone detects.
// Mat space per core SPEC §5.1: x right / y up on the sheet, z out of it.

import * as THREE from '../../vendor/three/three.module.min.js';

const A4 = [0.210, 0.297];                      // portrait, origin at center

export async function loadMatManifest(url) {
  const raw = await (await fetch(url)).json();  // kind: ars-mat
  const size = raw.markerSize || 0.08;
  const ids = (raw.variants && raw.variants.ARUCO_MIP_36h12 && raw.variants.ARUCO_MIP_36h12.ids) || [];
  return {
    size,
    markers: ids.map((id) => ({ id, size, t: raw.layout[String(id)].t })),
  };
}

function markerTexture(id) {
  const dic = new window.AR.Dictionary('ARUCO_MIP_36h12');
  const MS = dic.markSize, PAY = MS - 2, code = dic.codeList[id];
  const cellPx = 16, total = (MS + 2) * cellPx;
  const c = document.createElement('canvas'); c.width = c.height = total;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, total, total);
  g.fillStyle = '#000'; g.fillRect(cellPx, cellPx, MS * cellPx, MS * cellPx);
  g.fillStyle = '#fff';
  for (let r = 0; r < PAY; r++) for (let q = 0; q < PAY; q++)
    if (code[r * PAY + q] === '1')
      g.fillRect((q + 2) * cellPx, (r + 2) * cellPx, cellPx, cellPx);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, quietRatio: (MS + 2) / MS };
}

export function buildMat(manifest) {
  const group = new THREE.Group();
  group.name = 'mat';

  // sheet
  const sheet = new THREE.Mesh(
    new THREE.PlaneGeometry(A4[0], A4[1]),
    new THREE.MeshBasicMaterial({ color: 0xf2efe8 }));
  sheet.position.z = -0.0015;                  // layered under the ink; the gaps
  group.add(sheet);                            // are below depth-buffer noise at
                                               // grazing angles (SwiftShader-safe)

  // markers (quads include the quiet zone at correct scale)
  for (const m of manifest.markers) {
    const { tex, quietRatio } = markerTexture(m.id);
    const side = m.size * quietRatio;
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(side, side),
      new THREE.MeshBasicMaterial({ map: tex }));
    quad.position.set(m.t[0], m.t[1], 0.0005);
    group.add(quad);
  }

  // origin cross
  const cl = 0.012;
  const cross = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-cl, 0, 0.0002), new THREE.Vector3(cl, 0, 0.0002),
      new THREE.Vector3(0, -cl, 0.0002), new THREE.Vector3(0, cl, 0.0002),
    ]),
    new THREE.LineBasicMaterial({ color: 0x1d2129 }));
  group.add(cross);

  // sheet outline
  const [w, h] = A4;
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-w / 2, -h / 2, 0.0002), new THREE.Vector3(w / 2, -h / 2, 0.0002),
      new THREE.Vector3(w / 2, h / 2, 0.0002), new THREE.Vector3(-w / 2, h / 2, 0.0002),
    ]),
    new THREE.LineBasicMaterial({ color: 0x8b8577 }));
  group.add(outline);

  return group;
}
