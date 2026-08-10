// store.js — the scene document: an LWW object map with tombstones, plus a
// content-addressed blob lane. Shaped EXACTLY to @gcu/sync's store contract
// (exportBundle / importBundle / missingBlobs / getBlob / saveBlob) so stage 2
// is a drop-in: the bundle is opaque to sync, the merge lives here.
//
// Merge rule: stamps are [lamport, actor]; higher clock wins, actor string
// breaks ties. Deletes are tombstones under the same rule, so a delete and a
// concurrent edit converge identically on every peer.

const ACTOR_KEY = 'ars.studio.actor';

function newActor() {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function later(a, b) {          // stamp a strictly newer than stamp b?
  if (!b) return true;
  if (a[0] !== b[0]) return a[0] > b[0];
  return a[1] > b[1];
}

export async function sha256(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Effective visibility (micro's rule: "children keep their own eyes"):
// an item is hidden if ITS eye is off OR its layer's eye is off. `hidden`
// is DOCUMENT state — synced like everything, the phone shows the document.
export function effectiveHidden(store, obj) {
  if (obj.hidden) return true;
  const l = obj.layer && store.get(obj.layer);
  return !!(l && l.hidden);
}

export function createStore() {
  const actor = localStorage.getItem(ACTOR_KEY) ||
    (localStorage.setItem(ACTOR_KEY, newActor()), localStorage.getItem(ACTOR_KEY));
  let clock = 0;
  const objects = new Map();    // id → { id, kind, name, layer, t, rz, s, props, stamp }
  const tombs = new Map();      // id → stamp
  const blobs = new Map();      // sha256 hex → Uint8Array
  const listeners = new Set();

  const emit = () => { for (const fn of listeners) fn(); };
  const tick = () => { clock += 1; return [clock, actor]; };
  const bump = (stamp) => { if (stamp && stamp[0] > clock) clock = stamp[0]; };

  return {
    actor,

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    get(id) { return objects.get(id) || null; },
    all() { return [...objects.values()]; },
    byKind(kind) { return [...objects.values()].filter((o) => o.kind === kind); },

    newId() { return newActor(); },

    // Author an object (create or update). Fields not given are kept.
    upsert(patch) {
      const prev = objects.get(patch.id) || {};
      const obj = {
        t: [0, 0, 0], rz: 0, s: 1, props: {},
        ...prev, ...patch,
        props: { ...(prev.props || {}), ...(patch.props || {}) },
        stamp: tick(),
      };
      objects.set(obj.id, obj);
      tombs.delete(obj.id);
      emit();
      return obj;
    },

    remove(id) {
      if (!objects.has(id) && tombs.has(id)) return;
      objects.delete(id);
      tombs.set(id, tick());
      emit();
    },

    // Restore an earlier snapshot EXACTLY (undo/redo). Every restored object
    // gets a FRESH stamp — locally this replaces without LWW interference,
    // and on the wire peers converge to the restored state like any edit.
    // Blobs are never dropped, so restored references always resolve.
    restoreBundle(bundle) {
      const target = new Map((bundle.objects || []).map((o) => [o.id, o]));
      for (const id of [...objects.keys()]) {
        if (!target.has(id)) { objects.delete(id); tombs.set(id, tick()); }
      }
      for (const o of target.values()) {
        objects.set(o.id, { ...o, stamp: tick() });
        tombs.delete(o.id);
      }
      emit();
    },

    // ── @gcu/sync store contract ─────────────────────────────────────────
    exportBundle() {
      return {
        v: 1,
        objects: [...objects.values()],
        tombs: [...tombs.entries()].map(([id, stamp]) => ({ id, stamp })),
      };
    },

    importBundle(bundle) {
      let applied = 0;
      for (const o of bundle.objects || []) {
        bump(o.stamp);
        const dead = tombs.get(o.id);
        if (dead && !later(o.stamp, dead)) continue;
        const cur = objects.get(o.id);
        if (cur && !later(o.stamp, cur.stamp)) continue;
        objects.set(o.id, o);
        tombs.delete(o.id);
        applied++;
      }
      for (const t of bundle.tombs || []) {
        bump(t.stamp);
        const cur = objects.get(t.id);
        if (cur && later(cur.stamp, t.stamp)) continue;
        const dead = tombs.get(t.id);
        if (dead && !later(t.stamp, dead)) continue;
        objects.delete(t.id);
        tombs.set(t.id, t.stamp);
        applied++;
      }
      if (applied) emit();
      return { applied };
    },

    missingBlobs() {
      const need = new Set();
      for (const o of objects.values()) {
        const h = o.props && o.props.blob;
        if (h && !blobs.has(h)) need.add(h);
      }
      return [...need];
    },
    getBlob(hash) { return blobs.get(hash) || null; },
    async saveBlob(bytes) {
      const hash = await sha256(bytes);
      if (!blobs.has(hash)) { blobs.set(hash, bytes); emit(); }
      return hash;
    },

    // ── project file (the artifact): bundle + blobs, one JSON ────────────
    exportProject() {
      const b = this.exportBundle();
      const blobEntries = {};
      for (const [hash, bytes] of blobs) {
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000)
          s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        blobEntries[hash] = btoa(s);
      }
      return JSON.stringify({ kind: 'ars-studio-project', v: 1, bundle: b, blobs: blobEntries });
    },

    importProject(json) {
      const p = typeof json === 'string' ? JSON.parse(json) : json;
      if (!p || p.kind !== 'ars-studio-project') throw new Error('not an ars-studio project');
      for (const [hash, b64] of Object.entries(p.blobs || {})) {
        if (blobs.has(hash)) continue;
        const s = atob(b64);
        const bytes = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
        blobs.set(hash, bytes);
      }
      return this.importBundle(p.bundle || {});
    },
  };
}
