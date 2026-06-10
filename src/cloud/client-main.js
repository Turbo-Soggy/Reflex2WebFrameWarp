/* ---------------------------------------------------------------------------
   client-main.js — The "PLAYER" page (Stages C1–C3)
   ---------------------------------------------------------------------------
   The thin client of the cloud-streaming demo. Three layers, built in order:

   C1  PLUMBING   — receive the WebRTC video stream + DataChannel echo test.
   C2  POSE SYNC  — for every displayed frame, recover the camera pose it was
                    rendered with (pixel tag = exact; timestamps = scored).
   C3  THE WARP   — this is the thesis. The <video> feeds the SAME warp shader
                    as the local demo (quad-render.js / warp-shader.js), and
                    every display refresh we reproject the latest decoded frame
                    by (freshest LOCAL mouse pose − that frame's pose). The
                    stream is genuinely old; the view direction is not.

   The local demo's two clocks survive intact — the network now sits between
   them: SLOW clock = the server's 30 FPS render arriving by video, FAST clock
   = this page's pointer-lock input at display rate.

   Local input is also forwarded to the server (latest-wins, unreliable
   channel), which is what keeps the warp delta small: the server camera
   follows the mouse with some delay, and the warp bridges exactly that delay.
--------------------------------------------------------------------------- */

import * as THREE from 'three';
import { QuadRenderer } from '../quad-render.js';
import { Input } from '../input.js';
import { renderFovDeg } from '../projection.js';
import { Latency } from '../latency.js';
import { LatencyChart } from '../chart.js';
import { postSignal, waitForSignal, waitForIceComplete } from './signaling.js';
import { CAPTURE, TAG, bitsToId, cellRect } from './frame-tag.js';
import { PoseSync } from './pose-sync.js';
import { CloudRecorder } from './cloud-recorder.js';

// Must match the server's guard-band geometry (it renders the wider FOV;
// we crop back to the display FOV — the split-across-the-network guard band).
const DISPLAY_FOV_Y = 75;
const GUARD = 0.12;

function setStat(id, text, ok = null) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = ok === null ? '' : ok ? 'ok' : 'bad';
}

const video = document.getElementById('stream');

// Debug mode (?debug): exposes a console namespace and keeps the drawing
// buffer readable — same convention as the local demo's main.js.
const DEBUG = new URLSearchParams(location.search).has('debug');

// --- Stage C3: the warped view ------------------------------------------------
const canvas = document.getElementById('player-view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: DEBUG });
renderer.setPixelRatio(1);
renderer.setSize(CAPTURE.width, CAPTURE.height, false); // fixed, CSS-scaled

// The decoded stream as a texture. No colorSpace conversion: the video holds
// display-ready sRGB pixels and the warp shader passes colors through
// untouched, so decode-to-linear here would double-convert and darken.
const videoTexture = new THREE.VideoTexture(video);
videoTexture.minFilter = THREE.LinearFilter;
videoTexture.magFilter = THREE.LinearFilter;

// The exact same warp compositor as the local demo.
const quad = new QuadRenderer();
quad.setGuard(GUARD);
quad.setTexelSize(CAPTURE.width, CAPTURE.height);

// No motion vectors over the network (the stream is YUV 4:2:0 video — there is
// nowhere to carry per-pixel velocity). A 1×1 zero texture keeps the sampler
// bound; uMotionVectors stays 0 so the term contributes nothing.
const zeroVelocity = new THREE.DataTexture(
  new Float32Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
zeroVelocity.needsUpdate = true;
const noMv = { texture: zeroVelocity, dtSeconds: 0, enabled: false };

// Local pointer-lock input — the FAST clock, identical to the local demo.
const input = new Input(canvas);
canvas.addEventListener('click', () => input.lock());

// --- Stage C5: measurement -----------------------------------------------------
// The local demo's instruments, unchanged — only the meaning of "the input
// this frame reflects" is new. Each forwarded input's SEND time is remembered
// here; the server echoes back which seq each frame's camera used (in the
// pose packet); so the displayed frame's e2e latency = now − sentAt(seq) —
// the full uplink + render-wait + downlink + codec loop, measured entirely in
// this page's clock.
const latency = new Latency();
let latencyPrimed = false; // don't chart until the first real round trip
const inputSentAt = new Map(); // seq → performance.now() at send
function rememberInputSent(seq, now) {
  inputSentAt.set(seq, now);
  if (inputSentAt.size > 2400) { // ~20s at 120 Hz; Map iterates in insert order
    inputSentAt.delete(inputSentAt.keys().next().value);
  }
}

// e2e reaches 2×delay + codec — scale the chart for the 200 ms slider limit.
const chart = new LatencyChart(document.getElementById('latency-chart'), { maxMs: 500 });
const recorder = new CloudRecorder();

// Network conditions as stamped on the most recent pose packet (for the CSV).
const netNow = { delayMs: 0, jitterOn: false };

let warpEnabled = false;
let forwardInput = true; // debug hook: freeze the server camera to isolate the warp
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyW') {
    warpEnabled = !warpEnabled;
    setStat('stat-warp', warpEnabled ? 'ON — view follows the mouse instantly' : 'OFF — raw delayed stream',
      warpEnabled);
  } else if (e.code === 'KeyR') {
    const on = recorder.toggle(performance.now());
    setStat('stat-rec', on ? 'recording… (R stops)' : `stopped — ${recorder.sampleCount} samples (E exports)`, on);
  } else if (e.code === 'KeyE') {
    recorder.download();
  }
});

// Pose of the frame currently on screen (updated per presented frame, C2).
const displayedPose = { yaw: 0, pitch: 0, frameId: null };

// Display-rate compositor: reproject the newest decoded frame to the newest
// local pose. This loop is the whole point of the project.
const fovY = THREE.MathUtils.degToRad(DISPLAY_FOV_Y);
const fovX = 2 * Math.atan(Math.tan(fovY / 2) * (CAPTURE.width / CAPTURE.height));

function composite() {
  requestAnimationFrame(composite);
  const now = performance.now();
  const dYaw = input.yaw - displayedPose.yaw;
  const dPitch = input.pitch - displayedPose.pitch;
  // Same sign/normalisation as main.js: angular motion → display-UV shift.
  const du = -dYaw / fovX;
  const dv = dPitch / fovY;
  const delta = warpEnabled ? [du, dv] : [0, 0];
  quad.render(renderer, videoTexture, delta, CAPTURE.width, CAPTURE.height, noMv);

  // Stage C5: sample, record, chart — once real round trips are flowing.
  if (latencyPrimed) {
    const lat = latency.sample(now, warpEnabled);
    recorder.capture(now, {
      warpEnabled,
      netDelayMs: netNow.delayMs,
      jitterOn: netNow.jitterOn,
      noWarpMs: lat.noWarp,
      warpMs: lat.warp,
    });
    chart.draw(now, latency.noWarp, latency.warp);
    if (recorder.recording) {
      setStat('stat-rec', `recording… ${recorder.sampleCount} samples (R stops)`, true);
    }
    setStat('stat-latency',
      `no-warp ${latency.smoothNoWarp.toFixed(0)} ms · warp ${latency.smoothWarp.toFixed(0)} ms`,
      true);
  }
}
composite();

// --- Stage C2: which pose does the frame on screen belong to? ------------------
const poseSync = new PoseSync(60);

// Read the frame tag (frame-tag.js) back out of the decoded video. The tag
// region is copied into a small 2D canvas at its NOMINAL 64×64 size — the
// drawImage source rect is scaled by the video's actual resolution, so the
// readback also works mid-ramp while the encoder is still below 1280×720.
const tagCanvas = document.createElement('canvas');
tagCanvas.width = TAG.px;
tagCanvas.height = TAG.px;
const tagCtx = tagCanvas.getContext('2d', { willReadFrequently: true });

function readFrameTag() {
  if (video.videoWidth === 0) return null;
  const sx = video.videoWidth / CAPTURE.width;
  const sy = video.videoHeight / CAPTURE.height;
  tagCtx.drawImage(video, 0, 0, TAG.px * sx, TAG.px * sy, 0, 0, TAG.px, TAG.px);
  const img = tagCtx.getImageData(0, 0, TAG.px, TAG.px).data;

  // Sample a 4×4 block at each cell's centre (away from compression ringing
  // at cell edges) and threshold the average at mid-grey.
  const bits = [];
  for (let i = 0; i < TAG.bits; i++) {
    const r = cellRect(i);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    let sum = 0;
    for (let dy = -2; dy < 2; dy++) {
      for (let dx = -2; dx < 2; dx++) {
        sum += img[((cy + dy) * TAG.px + (cx + dx)) * 4]; // red of a grey pixel
      }
    }
    bits.push(sum / 16 > 127);
  }
  return bitsToId(bits);
}

// Plan A (timestamps) is scored against the tag (pixels, exact) live.
let planAChecks = 0;
let planAHits = 0;

(async () => {
  setStat('stat-signal', 'waiting for a server offer…');
  const offer = await waitForSignal('offer');
  setStat('stat-signal', `offer received (session ${offer.session}) — answering…`);

  const pc = new RTCPeerConnection({ iceServers: [] }); // localhost: host candidates suffice

  pc.addEventListener('iceconnectionstatechange', () => {
    setStat('stat-ice', pc.iceConnectionState,
      ['connected', 'completed'].includes(pc.iceConnectionState));
  });

  // --- Incoming video -------------------------------------------------------
  pc.addEventListener('track', (e) => {
    video.srcObject = e.streams[0];
    // `muted` + `autoplay` should make this unnecessary, but be explicit:
    video.play().catch(() => { /* will start on first user click instead */ });
  });

  video.addEventListener('loadedmetadata', () => {
    setStat('stat-video', `${video.videoWidth}×${video.videoHeight} attached`, true);
  });

  // Per-presented-frame work. requestVideoFrameCallback fires once per frame
  // the browser actually displays, with that frame's timing metadata.
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const onFrame = (_now, meta) => {
      setStat('stat-frames',
        `${meta.presentedFrames} presented · mediaTime ${meta.mediaTime.toFixed(3)}s`, true);

      // --- Stage C2: resolve the displayed frame's pose -------------------
      // Primary (exact): read the frameId out of the frame's own pixels, look
      // up the pose that travelled on the DataChannel.
      const tagId = readFrameTag();
      const tagPose = tagId === null ? null : poseSync.byFrameId(tagId);
      if (tagPose) {
        // Stage C3: this is the pose the compositor warps against.
        displayedPose.yaw = tagPose.yaw;
        displayedPose.pitch = tagPose.pitch;
        displayedPose.frameId = tagPose.frameId;

        // Stage C5: the frame on screen reflects input packet `inputSeq` —
        // its send time is the timestamp the e2e measurement runs from.
        const sentAt = inputSentAt.get(tagPose.inputSeq);
        if (sentAt !== undefined) {
          latency.markRender(sentAt);
          latencyPrimed = true;
        }
        if (tagPose.delayMs !== undefined) {
          netNow.delayMs = tagPose.delayMs;
          netNow.jitterOn = tagPose.jitter === 1;
        }

        const yawDeg = (tagPose.yaw * 180 / Math.PI).toFixed(1);
        const pitchDeg = (tagPose.pitch * 180 / Math.PI).toFixed(1);
        setStat('stat-pose', `frame ${tagId} · yaw ${yawDeg}° · pitch ${pitchDeg}°`, true);
      } else {
        setStat('stat-pose', tagId === null ? 'no frame yet' : `tag ${tagId}: no pose in buffer`, false);
      }

      // Plan A (estimated, timestamps only): scored live against the pixel
      // tag — the tag is ground truth. Preferred variant: receiveTime, a
      // same-clock comparison (see pose-sync.js). captureTime, if a browser
      // ever provides it, is the cross-clock fallback.
      if (tagPose) {
        let est = null, how = '';
        if (meta.receiveTime !== undefined) {
          const r = poseSync.byReceiveTime(meta.receiveTime);
          if (r) { est = r.pose; how = `lead ${r.leadMs.toFixed(1)} ms`; }
        } else if (meta.captureTime !== undefined) {
          const r = poseSync.byCaptureTime(meta.captureTime);
          if (r) { est = r.pose; how = `err ${r.errMs.toFixed(1)} ms`; }
        } else {
          setStat('stat-plana', 'no receiveTime/captureTime → tag is primary', false);
        }
        if (est) {
          planAChecks++;
          if ((est.frameId & 0xffff) === tagId) planAHits++;
          const pct = (100 * planAHits / planAChecks).toFixed(1);
          setStat('stat-plana',
            `${pct}% agree with tag (n=${planAChecks}) · ${how}`,
            planAHits / planAChecks > 0.9);
        }
      }

      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  } else {
    setStat('stat-frames', 'requestVideoFrameCallback unsupported → falling back to rAF polling', false);
  }

  // --- DataChannel: poses in, input + echo out --------------------------------
  pc.addEventListener('datachannel', (e) => {
    const dc = e.channel;
    let pingId = 0;
    let echoesHeard = 0;
    let inputSeq = 0;

    dc.addEventListener('open', () => {
      setStat('stat-dc', 'open (unreliable, unordered)', true);
      setInterval(() => {
        if (dc.readyState !== 'open') return;
        dc.send(JSON.stringify({ type: 'ping', from: 'client', id: ++pingId, sent: performance.now() }));
      }, 1000);

      // Stage C3/C4: forward local input to drive the server camera. ~120 Hz,
      // latest-wins: each packet carries the FULL pose (not a delta) plus a
      // sequence number, so on the unreliable/unordered channel a lost or
      // late packet costs nothing — the next one supersedes it entirely.
      setInterval(() => {
        if (dc.readyState !== 'open' || !forwardInput) return;
        const now = performance.now();
        dc.send(JSON.stringify({ type: 'input', seq: ++inputSeq, yaw: input.yaw, pitch: input.pitch }));
        rememberInputSent(inputSeq, now); // Stage C5: e2e clock starts here
      }, 1000 / 120);
    });

    dc.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'pose') {
        // One per server-rendered frame: into the ring buffer (Stage C2).
        poseSync.record(msg, performance.now());
      } else if (msg.type === 'ping') {
        dc.send(JSON.stringify({ ...msg, type: 'pong' })); // server's ping → echo back
      } else if (msg.type === 'pong' && msg.from === 'client') {
        const rtt = performance.now() - msg.sent; // our clock both ends — safe
        echoesHeard++;
        setStat('stat-echo', `${echoesHeard} echoes, RTT ${rtt.toFixed(1)} ms`, true);
      }
    });
  });

  // --- Answer the offer ------------------------------------------------------
  await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await waitForIceComplete(pc);
  postSignal('answer', { session: offer.session, type: pc.localDescription.type, sdp: pc.localDescription.sdp });
  setStat('stat-signal', `answer posted (session ${offer.session})`, true);

  // Auto-heal: if the server window reloads it posts a NEW offer with a new
  // session id — reload so this page redoes the handshake against it. This is
  // what makes the two-window demo survive an F5 on either side.
  waitForSignal('offer', (o) => o.session !== offer.session).then(() => location.reload());
})().catch((err) => {
  setStat('stat-signal', `handshake failed: ${err.message}`, false);
  console.error('[CloudClient] handshake failed', err);
});

if (DEBUG) {
  window.CloudClient = {
    input, poseSync, displayedPose, canvas, videoTexture, latency, recorder,
    get warpEnabled() { return warpEnabled; }, set warpEnabled(v) { warpEnabled = v; },
    get forwardInput() { return forwardInput; }, set forwardInput(v) { forwardInput = v; },
  };
  console.log('[CloudClient] debug namespace exposed as window.CloudClient');
}

console.log('[CloudClient] ready — waiting for the server window.');
