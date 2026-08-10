// fake-room.js — harness-only: two in-memory ends of a "room" implementing the
// trystero surface createSync touches (makeAction / onPeerJoin / onPeerLeave /
// getPeers / leave). Messages deliver on a microtask, like the real thing —
// never synchronously.

export function makeFakeRoomPair() {
  const mk = (self, other) => ({
    _actions: new Map(), _joins: [], _leaves: [], _id: self,
    makeAction(name) {
      const here = this;
      const send = (data, _target, meta) => {
        const peer = here._peer;
        queueMicrotask(() => {
          const rx = peer._actions.get(name);
          if (rx && rx.handler) rx.handler(data, here._id, meta);
        });
      };
      const entry = { handler: null };
      this._actions.set(name, entry);
      return [send, (fn) => { entry.handler = fn; }];
    },
    onPeerJoin(fn) { this._joins.push(fn); },
    onPeerLeave(fn) { this._leaves.push(fn); },
    getPeers() { return this._connected ? { [this._peer._id]: {} } : {}; },
    leave() { this._disconnect(); },
    _connect() {
      this._connected = true;
      queueMicrotask(() => this._joins.forEach((fn) => fn(this._peer._id)));
    },
    _disconnect() {
      if (!this._connected) return;
      this._connected = false;
      const peer = this._peer;
      peer._connected = false;
      queueMicrotask(() => peer._leaves.forEach((fn) => fn(this._id)));
    },
  });
  const a = mk('peer-A', null), b = mk('peer-B', null);
  a._peer = b; b._peer = a;
  return {
    a, b,
    connect() { a._connect(); b._connect(); },
  };
}
