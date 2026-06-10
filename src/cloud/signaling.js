/* ---------------------------------------------------------------------------
   signaling.js — A "signaling server" made out of localStorage
   ---------------------------------------------------------------------------
   WebRTC peers can't find each other by magic: before any video flows, the two
   sides must exchange a small blob of text each way —

       offer  (server → client): "here is the video/data I propose to send,
                                  and the network addresses you can reach me on"
       answer (client → server): "accepted; here are MY addresses"

   These blobs are SDP (Session Description Protocol) text. WebRTC deliberately
   does not specify HOW they travel; a real deployment uses a WebSocket server.

   For this project both pages run on the SAME machine and the SAME origin
   (http://localhost:8000), so we can cheat elegantly: localStorage is shared
   between same-origin windows, and writing a key in one window fires a
   `storage` event in every OTHER window. That gives us a zero-dependency,
   inspectable message bus — open DevTools → Application → Local Storage and
   you can literally read the handshake.

   Each posted payload carries a random `session` id so a freshly-loaded page
   never acts on a stale blob left over from a previous run.
--------------------------------------------------------------------------- */

const PREFIX = 'framewarp-signal:';

/** Publish a signaling payload (object) under `key` for the other window. */
export function postSignal(key, payload) {
  localStorage.setItem(PREFIX + key, JSON.stringify({ payload, postedAt: Date.now() }));
}

/** Remove stale payloads (called before starting a fresh handshake). */
export function clearSignal(...keys) {
  for (const key of keys) localStorage.removeItem(PREFIX + key);
}

/**
 * Resolve with the payload stored under `key` — immediately if an acceptable
 * one is already there, otherwise as soon as the other window posts one.
 * @param {string}   key     signal name ('offer' or 'answer')
 * @param {function} accept  optional filter, e.g. payload => payload.session === id
 */
export function waitForSignal(key, accept = () => true) {
  const fullKey = PREFIX + key;

  const parse = (raw) => {
    if (!raw) return null;
    try {
      const { payload } = JSON.parse(raw);
      return accept(payload) ? payload : null;
    } catch {
      return null; // ignore malformed leftovers
    }
  };

  return new Promise((resolve) => {
    // Already there? (e.g. the server posted its offer before we loaded.)
    const existing = parse(localStorage.getItem(fullKey));
    if (existing) return resolve(existing);

    // Otherwise wait for the other window to write it. `storage` fires only in
    // windows that did NOT do the write — exactly the cross-window bus we want.
    const onStorage = (e) => {
      if (e.key !== fullKey) return;
      const payload = parse(e.newValue);
      if (payload) {
        window.removeEventListener('storage', onStorage);
        resolve(payload);
      }
    };
    window.addEventListener('storage', onStorage);
  });
}

/* ---------------------------------------------------------------------------
   ICE gathering — why we wait before posting the SDP
   ---------------------------------------------------------------------------
   The SDP is only useful once it lists the network addresses ("ICE candidates")
   the peer can be reached on. Browsers discover candidates asynchronously and
   support sending them one-by-one ("trickle ICE") to shave milliseconds off
   call setup. We don't care about setup speed, we care about simplicity: wait
   until gathering is COMPLETE, then ship one final SDP containing everything.
   On localhost (no STUN/TURN servers configured) this takes a few ms — the
   only candidates are the machine's own interfaces.
--------------------------------------------------------------------------- */

/** Resolve once `pc` has finished gathering ICE candidates. */
export function waitForIceComplete(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', check);
  });
}
