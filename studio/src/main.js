// main.js — boot: store + autosave, the mat, the view, the UI.

import { createStore } from './store.js';
import { createView } from './view.js';
import { loadMatManifest, buildMat } from './mat.js';
import { initUI } from './ui.js';

const AUTOSAVE_KEY = 'ars.studio.autosave';

async function boot() {
  const store = createStore();

  // autosave: the project IS the artifact; localStorage is just a scratch copy
  const saved = localStorage.getItem(AUTOSAVE_KEY);
  if (saved) { try { store.importProject(saved); } catch (e) { console.warn('autosave discarded:', e.message); } }
  let dirty = false;
  store.onChange(() => { dirty = true; });
  setInterval(() => {
    if (!dirty) return;
    dirty = false;
    try { localStorage.setItem(AUTOSAVE_KEY, store.exportProject()); }
    catch (e) { console.warn('autosave failed (project too big for localStorage — use save):', e.message); }
  }, 1500);

  const view = createView(document.getElementById('gl'), store);

  // the mat, true scale, from the same layout file the PDF was generated from
  try {
    const manifest = await loadMatManifest('../webxr/assets/ars-mat-manifest.json');
    view.addStatic(buildMat(manifest));
  } catch (e) {
    document.getElementById('status').textContent = 'mat manifest failed to load: ' + e.message;
  }

  initUI(store, view, {
    tree: document.getElementById('tree'),
    inspector: document.getElementById('inspector'),
    addAxes: document.getElementById('add-axes'),
    addBox: document.getElementById('add-box'),
    addLabel: document.getElementById('add-label'),
    addMesh: document.getElementById('add-mesh'),
    addImage: document.getElementById('add-image'),
    addLayer: document.getElementById('add-layer'),
    save: document.getElementById('save'),
    load: document.getElementById('load'),
    clear: document.getElementById('clear'),
  });

  document.getElementById('status').textContent =
    'mat space · mm-true · drag objects on the sheet · autosaving locally';
  window.__studio = { store, view };            // harness handle
}

boot().catch((e) => {
  document.getElementById('status').textContent = 'boot failed: ' + e.message;
  throw e;
});
