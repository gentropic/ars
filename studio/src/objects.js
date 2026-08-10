// objects.js — three.js builders for each scene-object kind (DESIGN.md table).
// build(obj, store) → THREE.Object3D. Content that needs blob decoding fills
// in asynchronously; the node exists (and transforms) immediately.

import * as THREE from '../../vendor/three/three.module.min.js';

export const AMBER = 0xe8b04b;

// ── STL (binary or ascii) → BufferGeometry ────────────────────────────────
export function parseSTL(buf) {
  const bytes = new Uint8Array(buf);
  // binary iff the 50-byte-triangle record count matches the file length
  if (bytes.length >= 84) {
    const n = new DataView(buf).getUint32(80, true);
    if (84 + n * 50 === bytes.length) return parseBinarySTL(buf, n);
  }
  return parseAsciiSTL(new TextDecoder().decode(bytes));
}

function parseBinarySTL(buf, n) {
  const dv = new DataView(buf);
  const pos = new Float32Array(n * 9), nrm = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50;
    const nx = dv.getFloat32(o, true), ny = dv.getFloat32(o + 4, true), nz = dv.getFloat32(o + 8, true);
    for (let v = 0; v < 3; v++) {
      const p = o + 12 + v * 12, k = i * 9 + v * 3;
      pos[k] = dv.getFloat32(p, true);
      pos[k + 1] = dv.getFloat32(p + 4, true);
      pos[k + 2] = dv.getFloat32(p + 8, true);
      nrm[k] = nx; nrm[k + 1] = ny; nrm[k + 2] = nz;
    }
  }
  return geom(pos, nrm);
}

function parseAsciiSTL(text) {
  const pos = [];
  const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  let m;
  while ((m = re.exec(text))) pos.push(+m[1], +m[2], +m[3]);
  const g = geom(new Float32Array(pos), null);
  g.computeVertexNormals();
  return g;
}

function geom(pos, nrm) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (nrm) g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}

// ── kind builders ─────────────────────────────────────────────────────────
const builders = {
  axes(obj) {
    const s = obj.props.size ?? 0.05;
    const g = new THREE.Group();
    const mk = (to, color) => new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), to]),
      new THREE.LineBasicMaterial({ color }));
    g.add(mk(new THREE.Vector3(s, 0, 0), 0xd05a4a));
    g.add(mk(new THREE.Vector3(0, s, 0), 0x5a9a4a));
    g.add(mk(new THREE.Vector3(0, 0, s), 0x4a6ad0));
    return g;
  },

  box(obj) {
    const { w = 0.04, d = 0.04, h = 0.04, solid = true, color = AMBER } = obj.props;
    const geo = new THREE.BoxGeometry(w, d, h);
    geo.translate(0, 0, h / 2);                // sits ON the mat
    if (solid) return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color }));
    return new THREE.LineSegments(new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color }));
  },

  label(obj) {
    const { text = 'label', size = 0.02 } = obj.props;
    const pad = 8, fpx = 48;
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    g.font = `${fpx}px system-ui, sans-serif`;
    c.width = Math.ceil(g.measureText(text).width) + pad * 2;
    c.height = fpx + pad * 2;
    const g2 = c.getContext('2d');
    g2.font = `${fpx}px system-ui, sans-serif`;
    g2.fillStyle = 'rgba(20,24,30,.82)';
    g2.fillRect(0, 0, c.width, c.height);
    g2.fillStyle = '#e8b04b';
    g2.textBaseline = 'middle';
    g2.fillText(text, pad, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
    sp.scale.set(size * c.width / c.height, size, 1);
    sp.center.set(0.5, 0);                     // anchored at its base point
    return sp;
  },

  mesh(obj, store) {
    const g = new THREE.Group();
    const bytes = obj.props.blob && store.getBlob(obj.props.blob);
    if (bytes) {
      const unit = obj.props.unit === 'm' ? 1 : 0.001;   // STL is usually mm
      const geo = parseSTL(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      geo.scale(unit, unit, unit);
      g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: obj.props.color ?? 0x9aa4b2, flatShading: true })));
    }
    return g;
  },

  image(obj, store) {
    const g = new THREE.Group();
    const bytes = obj.props.blob && store.getBlob(obj.props.blob);
    if (bytes) {
      const w = obj.props.w ?? 0.1, d = obj.props.d ?? 0.1;
      const quad = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
      quad.position.z = 0.0006;
      g.add(quad);
      const blobUrl = URL.createObjectURL(new Blob([bytes]));
      new THREE.TextureLoader().load(blobUrl, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        quad.material.map = tex;
        quad.material.needsUpdate = true;
        URL.revokeObjectURL(blobUrl);
      });
    }
    return g;
  },
};

export const RENDERABLE = new Set(Object.keys(builders));

export function build(obj, store) {
  // The object transform lives on a WRAPPER group — builders own their inner
  // node's transform (a sprite's scale IS its size; stomping it once turned
  // every label into a 1×1 m billboard shading half the scene).
  const node = new THREE.Group();
  node.add(builders[obj.kind](obj, store));
  node.position.set(obj.t[0], obj.t[1], obj.t[2]);
  node.rotation.z = obj.rz || 0;
  node.scale.setScalar(obj.s || 1);
  node.traverse((n) => { n.userData.objectId = obj.id; });
  return node;
}
