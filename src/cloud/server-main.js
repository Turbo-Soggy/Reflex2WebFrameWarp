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
import { CAPTURE, TAG, idToBits, cellRect } from './frame-tag.js';
import { DISPLAY_FOV_Y, UV_SCALE } from '../config.js';

// --- Fixed capture geometry (shared protocol constants, see frame-tag.js) ---
const CAPTURE_W = CAPTURE.width;
const CAPTURE_H = CAPTURE.height;
const SOURCE_FPS = CAPTURE.fps;

// Same guard-band maths as the local demo: render WIDER than the player will
// see, so the C3 warp has real pixels to pull from. The client crops back.
// DISPLAY_FOV_Y and UV_SCALE come from config.js (shared with the demo + sim).

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
let frameId = 0; // monotonic — the join key between video frames and poses
const clock = new THREE.Clock();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

// Stage C2: stamp the frame's id into its top-left corner as a 4×4 grid of
// black/white cells (see frame-tag.js for the why). Drawn with scissored
// clears — a clear bypasses tone mapping entirely, so "white" really encodes
// as 255 and "black" as 0, giving the client an easy threshold. The corner is
// inside the guard band, so the C3 crop hides it from the player.
function drawFrameTag(id) {
  const bits = idToBits(id);
  renderer.setScissorTest(true);
  for (let i = 0; i < TAG.bits; i++) {
    const r = cellRect(i); // top-left-origin rect → flip y for WebGL scissor
    renderer.setScissor(r.x, CAPTURE_H - r.y - r.h, r.w, r.h);
    renderer.setClearColor(bits[i] ? 0xffffff : 0x000000, 1);
    renderer.clear(true, false, false); // color only
  }
  renderer.setScissorTest(false);
  // No clear-color restore needed: the scene clears from scene.background.
}

// Stage C3: the camera is driven by the PLAYER's mouse, arriving as full-pose
// packets on the DataChannel. Latest-wins by sequence number: the channel is
// unreliable AND unordered, so a packet may be lost or arrive late — either
// way the newest seq seen is the freshest pose, and stale ones are dropped.
// (Until the player connects/moves, the camera just holds yaw 0.)
const remoteInput = { seq: -1, yaw: 0, pitch: 0 };

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();

  // FAST tick (display rate): push anything whose network transit has elapsed
  // out of the delay queues — frames into the captured canvas, inputs into
  // the camera (Stage C4).
  releaseDue(now);

  // SLOW tick (30 FPS): render the next frame.
  if (now < nextRenderDue) return;
  nextRenderDue = Math.max(nextRenderDue + RENDER_INTERVAL, now - RENDER_INTERVAL);

  const t = clock.getElapsedTime();
  const yaw = remoteInput.yaw;
  const pitch = remoteInput.pitch;
  euler.set(pitch, yaw, 0);
  camera.quaternion.setFromEuler(euler);

  targets.update(t);
  renderer.render(world.scene, camera);

  // Stage C2: tag the pixels with the frame id; Stage C4: into the delay
  // queue rather than straight to capture. The pose travels with the frame
  // and is sent when the frame is RELEASED — video, tag and pose stay
  // coherent, all genuinely `delayMs` old by the time the player sees them.
  frameId++;
  drawFrameTag(frameId);
  enqueueFrame(now, frameId, yaw, pitch, remoteInput.seq);

  if (frameId % SOURCE_FPS === 0) {
    setStat('stat-render', `${frameId} frames @ ${SOURCE_FPS} FPS`);
    setStat('stat-pose', `frame ${frameId} · yaw ${(yaw * 180 / Math.PI).toFixed(1)}°`, true);
    setStat('stat-delay', jitterOn
      ? `${delayMs} ms + jitter (now ${effectiveDelay(now).toFixed(0)} ms one-way)`
      : `${delayMs} ms one-way, each direction`, null);
  }
}

// --- Stage C4: the simulated network — a delay buffer in front of capture ------
// The visible canvas above is the LIVE render (what the game produces *now*).
// What the player receives comes from THIS hidden 2D canvas, which is fed each
// frame only after it has sat in a queue for the configured one-way delay.
// The pose packet for a frame is sent at the same moment the frame is released,
// so video, pixel tag and pose stay coherent — and are all genuinely old.
const captureCanvas = document.createElement('canvas');
captureCanvas.width = CAPTURE_W;
captureCanvas.height = CAPTURE_H;
const captureCtx = captureCanvas.getContext('2d');

// Network knobs (wired to the panel below). delayMs is ONE-WAY and applies to
// both directions: frames going down AND input packets coming up.
let delayMs = 40;
let jitterOn = false;

// Jitter: the one-way delay wanders 40–140 ms (sin, 0.25 Hz). A fixed delay is
// something a player adapts to; a WANDERING one is what makes real cloud
// gaming unplayable — and the warp is mathematically immune to it, because the
// delta is computed per-displayed-frame and is exact whatever the frame's age.
function effectiveDelay(nowMs) {
  return delayMs + (jitterOn ? 50 + 50 * Math.sin((nowMs / 1000) * 2 * Math.PI * 0.25) : 0);
}

// Frame queue: pooled 2D canvases so we allocate ~a dozen, not one per frame.
const framePool = [];
const pendingFrames = []; // { cnv, frameId, yaw, pitch, due } — due ascending
let lastFrameDue = 0;

function enqueueFrame(now, id, yaw, pitch, inputSeq) {
  const cnv = framePool.pop() || (() => {
    const c = document.createElement('canvas');
    c.width = CAPTURE_W; c.height = CAPTURE_H;
    return c;
  })();
  // Copy the live WebGL canvas (same-tick, so the drawing buffer is intact).
  cnv.getContext('2d').drawImage(canvas, 0, 0);
  // Jitter must never REORDER frames (a real jittery network still delivers an
  // RTP stream in order) — clamp each due time to after the previous one.
  const due = Math.max(now + effectiveDelay(now), lastFrameDue + 1);
  lastFrameDue = due;
  pendingFrames.push({ cnv, frameId: id, yaw, pitch, inputSeq, due });
}

// Input queue: the player's packets also cross the simulated network.
const pendingInputs = []; // { msg, due }

// Release loop: runs at display rate (much finer than the 30 FPS source), so
// release timing is accurate to a display tick.
function releaseDue(now) {
  while (pendingFrames.length > 0 && pendingFrames[0].due <= now) {
    const f = pendingFrames.shift();
    captureCtx.drawImage(f.cnv, 0, 0);
    framePool.push(f.cnv);
    if (dc.readyState === 'open') {
      // inputSeq: which input packet this frame's camera reflected — the join
      // key for the client's end-to-end latency measurement (Stage C5). The
      // current network knobs ride along so the client can label its CSV.
      dc.send(JSON.stringify({
        type: 'pose', frameId: f.frameId, yaw: f.yaw, pitch: f.pitch, t: now,
        inputSeq: f.inputSeq, delayMs, jitter: jitterOn ? 1 : 0,
      }));
    }
  }
  while (pendingInputs.length > 0 && pendingInputs[0].due <= now) {
    const { msg } = pendingInputs.shift();
    if (msg.seq > remoteInput.seq) { // latest-wins, as before
      remoteInput.seq = msg.seq;
      remoteInput.yaw = msg.yaw;
      remoteInput.pitch = msg.pitch;
    }
  }
}

// --- Capture the DELAYED canvas as a media stream -------------------------------
const stream = captureCanvas.captureStream(SOURCE_FPS);
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

// Start the render loop only now that `dc` exists (the loop posts poses on it).
frame();

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

let inputsQueued = 0;
dc.addEventListener('message', (e) => {
  let msg;
  try { msg = JSON.parse(e.data); } catch { return; } // ignore malformed packets
  if (msg.type === 'input') {
    // The player's pose (Stage C3), crossing the simulated network (C4): it
    // is applied only after the one-way delay, in releaseDue(). The seq
    // filter there still keeps latest-wins semantics after the wait.
    pendingInputs.push({ msg, due: performance.now() + delayMs });
    inputsQueued++;
    if (inputsQueued % 120 === 0) {
      setStat('stat-input', `seq ${msg.seq} · yaw ${(msg.yaw * 180 / Math.PI).toFixed(1)}° (+${delayMs} ms)`, true);
    }
  } else if (msg.type === 'ping') {
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

// --- Network-condition controls (Stage C4) ----------------------------------
const slDelay = document.getElementById('sl-delay');
const valDelay = document.getElementById('val-delay');
slDelay.addEventListener('input', () => {
  delayMs = parseFloat(slDelay.value);
  valDelay.textContent = delayMs;
});
valDelay.textContent = slDelay.value;
delayMs = parseFloat(slDelay.value);

document.getElementById('cb-jitter').addEventListener('change', (e) => {
  jitterOn = e.target.checked;
});

// Convenience: open the player window from here (user gesture → no popup block).
document.getElementById('open-client').addEventListener('click', () => {
  window.open('client.html', 'framewarp-client');
});

console.log('[CloudServer] ready — open client.html in a second window (or use the button).');
