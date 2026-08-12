// main.js — boot: store + autosave, the mat, the view, the UI.

import { createStore } from './store.js';
import { createView } from './view.js';
import { loadMatManifest, buildMat } from './mat.js';
import { initUI } from './ui.js';
import { createSync, roomCode, APP_ID } from './sync.js';

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
    menubar: document.getElementById('menubar'),
    status: document.getElementById('status'),
  });

  // ── share: create a room, show the QR, stream the scene (stage 2) ──────
  // trystero + qr load lazily so opening the studio never touches the network.
  let sync = null;
  document.getElementById('share').onclick = async () => {
    const overlay = document.getElementById('share-overlay');
    if (!sync) {
      const [{ joinRoom }, qr] = await Promise.all([
        import('../../vendor/trystero/torrent.js'),
        import('../../vendor/gcu-qr/index.js'),
      ]);
      const code = roomCode();
      const url = new URL('../web/viewer.html#r=' + code, location.href).href;
      const room = joinRoom({ appId: APP_ID }, code);
      sync = createSync(store, room, {
        role: 'authority',
        onPose: (peerId, pose) => view.setPresence(peerId, pose),
        onLeave: (peerId) => view.dropPresence(peerId),
        onPeers: (n) => { document.getElementById('peers').textContent = n ? '◈ ' + n : ''; },
      });
      document.getElementById('share-qr').src = qr.toDataURL(url, { scale: 8 });
      document.getElementById('share-code').textContent = code;
      window.__studioSync = { sync, code, url };
    }
    overlay.classList.add('open');
  };
  document.getElementById('share-close').onclick = () =>
    document.getElementById('share-overlay').classList.remove('open');
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.getElementById('share-overlay').classList.remove('open');
      document.getElementById('help-overlay').classList.remove('open');
    }
  });

  window.__studio = { store, view, createSync };  // harness handle
}

boot().catch((e) => {
  document.getElementById('status').textContent = 'boot failed: ' + e.message;
  throw e;
});
