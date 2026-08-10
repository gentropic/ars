// view.js — the 3D viewport. Mat space is the world frame: z is up
// (camera.up = +z), the sheet lies in the ground plane. Left-drag on empty
// space orbits; wheel dollies; shift/right-drag pans; left-drag on an object
// slides it in the mat plane; click selects.

import * as THREE from '../../vendor/three/three.module.min.js';
import { build, RENDERABLE } from './objects.js';

export function createView(canvas, store, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(devicePixelRatio);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14181e);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.005, 50);
  camera.up.set(0, 0, 1);

  scene.add(new THREE.HemisphereLight(0xdde4ee, 0x2a2620, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(0.4, -0.6, 1.0);
  scene.add(sun);

  const grid = new THREE.GridHelper(1, 20, 0x3a4250, 0x242b36);
  grid.rotation.x = Math.PI / 2;               // three grids are XZ; ours is XY
  grid.position.z = -0.004;                    // below the sheet's own layering
  scene.add(grid);

  const content = new THREE.Group();           // scene objects live here
  scene.add(content);

  // ── z-up orbit ──────────────────────────────────────────────────────────
  const orbit = { theta: -Math.PI / 3, phi: 0.9, dist: 0.55, target: new THREE.Vector3(0, 0, 0) };
  function applyOrbit() {
    const { theta, phi, dist, target } = orbit;
    camera.position.set(
      target.x + dist * Math.cos(phi) * Math.cos(theta),
      target.y + dist * Math.cos(phi) * Math.sin(theta),
      target.z + dist * Math.sin(phi));
    camera.lookAt(target);
  }

  // ── picking / dragging ──────────────────────────────────────────────────
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const matPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  let selected = null;                         // object id
  const selBox = new THREE.Box3Helper(new THREE.Box3(), 0xe8b04b);
  selBox.visible = false;
  scene.add(selBox);

  function pointerRay(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray;
  }
  function pick(e) {
    const hits = pointerRay(e).intersectObjects(content.children, true);
    for (const h of hits) { if (h.object.userData.objectId) return h.object.userData.objectId; }
    return null;
  }

  let mode = null;                             // 'orbit' | 'pan' | 'drag'
  let dragId = null, dragOff = null, moved = false, last = null;
  const planeHit = new THREE.Vector3();

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    moved = false; last = { x: e.clientX, y: e.clientY };
    const id = e.button === 0 && !e.shiftKey ? pick(e) : null;
    if (id) {
      mode = 'drag'; dragId = id;
      const obj = store.get(id);
      const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(obj ? obj.t[2] : 0));
      pointerRay(e).ray.intersectPlane(dragPlane, planeHit);
      dragOff = obj ? { x: obj.t[0] - planeHit.x, y: obj.t[1] - planeHit.y, plane: dragPlane } : null;
    } else if (e.button === 2 || e.shiftKey) mode = 'pan';
    else mode = 'orbit';
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!mode) return;
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    if (Math.abs(dx) + Math.abs(dy) > 1) moved = true;
    if (mode === 'orbit') {
      orbit.theta -= dx * 0.006;
      orbit.phi = Math.min(1.5, Math.max(0.05, orbit.phi + dy * 0.006));
      applyOrbit();
    } else if (mode === 'pan') {
      const k = orbit.dist * 0.0016;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const upv = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      orbit.target.addScaledVector(right, -dx * k).addScaledVector(upv, dy * k);
      applyOrbit();
    } else if (mode === 'drag' && dragOff) {
      if (pointerRay(e).ray.intersectPlane(dragOff.plane, planeHit)) {
        const obj = store.get(dragId);
        if (obj) store.upsert({ id: dragId, t: [planeHit.x + dragOff.x, planeHit.y + dragOff.y, obj.t[2]] });
      }
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (mode === 'drag' && !moved) select(dragId);
    else if (mode !== 'drag' && !moved && e.button === 0) select(pick(e));
    mode = null; dragId = null; dragOff = null;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    orbit.dist = Math.min(5, Math.max(0.05, orbit.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
    applyOrbit();
  }, { passive: false });

  function select(id) {
    selected = id || null;
    if (api.onSelect) api.onSelect(selected);
    else if (opts.onSelect) opts.onSelect(selected);
  }

  // ── store → scene reconciliation ────────────────────────────────────────
  const nodes = new Map();                     // id → { stamp, node }
  let localVis = () => true;                   // layer-visibility predicate

  function reconcile() {
    const live = new Set();
    for (const obj of store.all()) {
      if (!RENDERABLE.has(obj.kind)) continue;
      live.add(obj.id);
      const cur = nodes.get(obj.id);
      if (!cur || cur.stamp !== obj.stamp) {
        if (cur) { content.remove(cur.node); dispose(cur.node); }
        const node = build(obj, store);
        nodes.set(obj.id, { stamp: obj.stamp, node });
        content.add(node);
      }
      nodes.get(obj.id).node.visible = localVis(obj);
    }
    for (const [id, cur] of nodes) {
      if (!live.has(id)) { content.remove(cur.node); dispose(cur.node); nodes.delete(id); }
    }
    if (selected && !live.has(selected)) select(null);
  }

  function dispose(node) {
    node.traverse((n) => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) {
        if (n.material.map) n.material.map.dispose();
        n.material.dispose();
      }
    });
  }

  store.onChange(reconcile);

  // ── frame loop ──────────────────────────────────────────────────────────
  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas.parentElement);

  function frame() {
    requestAnimationFrame(frame);
    const cur = selected && nodes.get(selected);
    selBox.visible = !!cur;
    if (cur) selBox.box.setFromObject(cur.node);
    renderer.render(scene, camera);
  }

  const api = {
    scene,
    select,
    selectedId: () => selected,
    setVisibility(fn) { localVis = fn; reconcile(); },
    addStatic(node) { scene.add(node); },
    onSelect: null,
  };

  resize(); applyOrbit(); reconcile(); frame();
  return api;
}
