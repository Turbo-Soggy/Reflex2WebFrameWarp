/* ---------------------------------------------------------------------------
   server-main.js — The "CLOUD SERVER" page (Stage C1: WebRTC plumbing)
   ---------------------------------------------------------------------------
   This page plays the role of a cloud gaming server: it renders the existing
   3D shooting range at 30 FPS into a canvas, captures that canvas as a video
   stream, and sends it to the player window over WebRTC.

   Stage C1 only proves the PLUMBING:
     • video flows server → client,
     • a DataChannel round-trips messages both directions,
   so the camera just auto-pans for now (no remote input yet — that's C4) and
   no pose metadata is attached (that's C2).

   STATIC CAPTURE RESOLUTION — the one C1 decision with long-range consequences:
   the canvas is a fixed 1280×720 and the renderer never resizes with the
   window (the page scales it with CSS only). If the capture size followed the
   window, the encoder could adaptively rescale mid-stream and silently break
   the client's UV math in Stage C3. `contentHint = 'motion'` tells the encoder
   to favour smooth motion over per-frame sharpness, like real game streaming.
--------------------------------------------------------------------------- */

import * as THREE from 'three';
import { createScene } from '../scene.js';
import { Targets } from '../targets.js';
import { renderFovDeg } from '../projection.js';
import { postSignal, clearSignal, waitForSignal, waitForIceComplete } from './signaling.js';

// --- Fixed capture geometry (see header) ------------------------------------
const CAPTURE_W = 1280;
const CAPTURE_H = 720;
const SOURCE_FPS = 30;

// Same guard-band maths as the local demo: render WIDER than the player will
// see, so the C3 warp has real pixels to pull from. The client crops back.
const DISPLAY_FOV_Y = 75;
const GUARD = 0.12;
const UV_SCALE = 1 - 2 * GUARD;

// --- Status panel ------------------------------------------------------------
function setStat(id, text, ok = null) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = ok === null ? '' : ok ? 'ok' : 'bad';
}

// --- Renderer: fixed-size, never resized --------------------------------------
const canvas = document.getElementById('server-view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1); // capture resolution = canvas resolution, exactly
renderer.setSize(CAPTURE_W, CAPTURE_H, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const world = createScene();
const targets = new Targets(world.range);
world.scene.add(targets.group);

const camera = new THREE.PerspectiveCamera(
  renderFovDeg(DISPLAY_FOV_Y, UV_SCALE), CAPTURE_W / CAPTURE_H, 0.1, 200);
camera.position.set(0, 1.7, 0);

// --- 30 FPS render loop --------------------------------------------------------
// Same deadline-advance trick as lag.js: rAF ticks at the display rate, but we
// only redraw when the 33.3ms deadline passes, so the long-run average is 30.
const RENDER_INTERVAL = 1000 / SOURCE_FPS;
let nextRenderDue = 0;
let framesRendered = 0;
const clock = new THREE.Clock();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  if (now < nextRenderDue) return;
  nextRenderDue = Math.max(nextRenderDue + RENDER_INTERVAL, now - RENDER_INTERVAL);

  // No remote input yet (Stage C4) — auto-pan so the stream visibly moves and
  // the video encoder has real motion to chew on.
  const t = clock.getElapsedTime();
  const yaw = 0.35 * Math.sin(t * 0.5);
  const pitch = 0.06 * Math.sin(t * 0.23);
  euler.set(pitch, yaw, 0);
  camera.quaternion.setFromEuler(euler);

  targets.update(t);
  renderer.render(world.scene, camera);

  framesRendered++;
  if (framesRendered % SOURCE_FPS === 0) {
    setStat('stat-render', `${framesRendered} frames @ ${SOURCE_FPS} FPS`);
  }
}
frame();

// --- Capture the canvas as a media stream --------------------------------------
const stream = canvas.captureStream(SOURCE_FPS);
const [videoTrack] = stream.getVideoTracks();
videoTrack.contentHint = 'motion';
setStat('stat-capture', `${CAPTURE_W}×${CAPTURE_H} @ ${SOURCE_FPS} FPS, hint=motion`, true);

// --- WebRTC peer connection -----------------------------------------------------
// No iceServers: both peers are on this machine, so the host candidates that
// the browser finds for free are all we need. (A STUN server would only matter
// across a NAT — deliberately out of scope, and worth a sentence in the report.)
const pc = new RTCPeerConnection({ iceServers: [] });
const sender = pc.addTrack(videoTrack, stream);

// Pin the scaling policy: under congestion, drop FRAMERATE — never resolution.
// Measured on loopback: without this the encoder still starts at 320×180 and
// ramps to full 1280×720 over ~10s (bandwidth estimation warming up — that
// ramp is unavoidable). This setting stops the other direction: a mid-demo
// downscale that would soften the image and shrink C2's corner-pixel frameId
// grid. Wrapped in try/catch — it's an optimisation hint, not a dependency.
(async () => {
  try {
    const params = sender.getParameters();
    params.degradationPreference = 'maintain-resolution';
    await sender.setParameters(params);
  } catch (err) {
    console.warn('[CloudServer] degradationPreference unsupported here:', err.message);
  }
})();

// The metadata channel. UNRELIABLE + UNORDERED, like a real game-streaming
// control channel: a lost packet must be skipped, not retransmitted late —
// by the time it arrived, a newer one would already supersede it.
const dc = pc.createDataChannel('meta', { ordered: false, maxRetransmits: 0 });

pc.addEventListener('iceconnectionstatechange', () => {
  setStat('stat-ice', pc.iceConnectionState,
    ['connected', 'completed'].includes(pc.iceConnectionState));
});

// --- DataChannel echo test (both directions) ------------------------------------
// Server pings client once a second; client echoes the ping back unchanged.
// RTT is computed against our own clock, so the two pages' clocks never need
// to agree — a rule that becomes load-bearing in C2 (never compare raw
// timestamps across machines).
let pingId = 0;
let echoesHeard = 0;

dc.addEventListener('open', () => {
  setStat('stat-dc', 'open (unreliable, unordered)', true);
  setInterval(() => {
    if (dc.readyState !== 'open') return;
    dc.send(JSON.stringify({ type: 'ping', from: 'server', id: ++pingId, sent: performance.now() }));
  }, 1000);
});

dc.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'ping') {
    // The client's ping: echo it straight back so IT can measure RTT.
    dc.send(JSON.stringify({ ...msg, type: 'pong' }));
  } else if (msg.type === 'pong' && msg.from === 'server') {
    // Our own ping, returned.
    const rtt = performance.now() - msg.sent;
    echoesHeard++;
    setStat('stat-echo', `${echoesHeard} echoes, RTT ${rtt.toFixed(1)} ms`, true);
  }
});

// --- Signaling handshake ----------------------------------------------------------
// Post offer → wait for the matching answer (see signaling.js for the why).
const session = Math.random().toString(36).slice(2, 10);

(async () => {
  clearSignal('answer'); // a leftover answer from a previous run is useless
  setStat('stat-signal', 'creating offer…');

  await pc.setLocalDescription(await pc.createOffer());
  await waitForIceComplete(pc);
  postSignal('offer', { session, type: pc.localDescription.type, sdp: pc.localDescription.sdp });
  setStat('stat-signal', `offer posted (session ${session}) — waiting for player window…`);

  const answer = await waitForSignal('answer', (a) => a.session === session);
  await pc.setRemoteDescription({ type: answer.type, sdp: answer.sdp });
  setStat('stat-signal', `connected (session ${session})`, true);
})().catch((err) => {
  setStat('stat-signal', `handshake failed: ${err.message}`, false);
  console.error('[CloudServer] handshake failed', err);
});

// Convenience: open the player window from here (user gesture → no popup block).
document.getElementById('open-client').addEventListener('click', () => {
  window.open('client.html', 'framewarp-client');
});

console.log('[CloudServer] ready — open client.html in a second window (or use the button).');
