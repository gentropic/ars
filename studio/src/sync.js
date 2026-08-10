// sync.js — the stage-2 wire: a four-action protocol DIRECTLY on a trystero
// room (DESIGN.md revision: @gcu/sync deferred to epoch 3 — with the studio as
// sole authority the wire is one-way replication + an ephemeral back-channel,
// and a symmetric merge engine would be machinery without a payload).
//
//   scene  authority → room   whole document (bundle), on join + debounced change
//   need   viewer → authority  blob hashes the viewer lacks
//   blob   authority → viewer  bytes + {hash} metadata (content-verified on save)
//   pose   viewer → room       viewer pose in mat space, ~5 Hz, ephemeral
//
// The room is INJECTED (trystero's shape: makeAction/onPeerJoin/onPeerLeave/
// getPeers) so the harness can wire two ends through a fake pair with no
// trackers. The store keeps its LWW merge — a rebroadcast whole document is
// idempotent by construction on the viewer.

export const APP_ID = 'gcu-ars';

export function roomCode() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => abc[b % abc.length]).join('');
}

export function createSync(store, room, opts = {}) {
  const role = opts.role || 'authority';
  const [sendScene, onScene] = room.makeAction('scene');
  const [sendNeed, onNeed] = room.makeAction('need');
  const [sendBlob, onBlob] = room.makeAction('blob');
  const [sendPose, onPose] = room.makeAction('pose');
  let closed = false, debounce = 0;

  if (role === 'authority') {
    room.onPeerJoin((peerId) => {
      sendScene(store.exportBundle(), peerId);
      if (opts.onPeers) opts.onPeers(Object.keys(room.getPeers()).length);
    });
    const offChange = store.onChange(() => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { if (!closed) sendScene(store.exportBundle()); }, 250);
    });
    onNeed((hashes, peerId) => {
      for (const hash of hashes || []) {
        const bytes = store.getBlob(hash);
        if (bytes) sendBlob(bytes, peerId, { hash });
      }
    });
    onPose((pose, peerId) => { if (opts.onPose) opts.onPose(peerId, pose); });
    room.onPeerLeave((peerId) => {
      if (opts.onLeave) opts.onLeave(peerId);
      if (opts.onPeers) opts.onPeers(Object.keys(room.getPeers()).length);
    });
    return {
      peers: () => Object.keys(room.getPeers()).length,
      close() { closed = true; clearTimeout(debounce); offChange(); if (room.leave) room.leave(); },
    };
  }

  // viewer
  onScene(async (bundle) => {
    store.importBundle(bundle);
    const missing = store.missingBlobs();
    if (missing.length) sendNeed(missing);
    if (opts.onScene) opts.onScene(bundle);
  });
  onBlob(async (bytes, peerId, meta) => {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const hash = await store.saveBlob(data);
    if (meta && meta.hash && meta.hash !== hash)
      console.warn('ars sync: blob hash mismatch — dropped', meta.hash, hash);
  });
  room.onPeerJoin(() => { if (opts.onPeers) opts.onPeers(Object.keys(room.getPeers()).length); });
  room.onPeerLeave(() => { if (opts.onPeers) opts.onPeers(Object.keys(room.getPeers()).length); });

  let lastPose = 0;
  return {
    peers: () => Object.keys(room.getPeers()).length,
    sendPose(pose) {                            // throttled here so callers can spam
      const now = performance.now();
      if (now - lastPose < 200) return;
      lastPose = now;
      sendPose(pose);
    },
    close() { closed = true; if (room.leave) room.leave(); },
  };
}
