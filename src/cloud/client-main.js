/* ---------------------------------------------------------------------------
   client-main.js — The "PLAYER" page (Stage C1: WebRTC plumbing)
   ---------------------------------------------------------------------------
   This page plays the role of the player's thin client: it receives the video
   stream the server window captures and plays it in a <video> element.

   In Stage C3 that <video> becomes a THREE.VideoTexture feeding the existing
   warp shader — which is why C1 already counts DECODED frames with
   requestVideoFrameCallback(): that callback's per-frame metadata is Plan A
   for matching frames to pose packets in C2, so we exercise it now and find
   out early if it's flaky (Plan B: frameId baked into corner pixels).
--------------------------------------------------------------------------- */

import { postSignal, waitForSignal, waitForIceComplete } from './signaling.js';
import { CAPTURE, TAG, bitsToId, cellRect } from './frame-tag.js';
import { PoseSync } from './pose-sync.js';

function setStat(id, text, ok = null) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = ok === null ? '' : ok ? 'ok' : 'bad';
}

const video = document.getElementById('stream');

// --- Stage C2: which pose does the frame on screen belong to? ---------------
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

  // --- DataChannel echo test (both directions) ------------------------------
  // The server opens the channel; we receive it here. We echo the server's
  // pings back, and send pings of our own to measure RTT from this side.
  pc.addEventListener('datachannel', (e) => {
    const dc = e.channel;
    let pingId = 0;
    let echoesHeard = 0;

    dc.addEventListener('open', () => {
      setStat('stat-dc', 'open (unreliable, unordered)', true);
      setInterval(() => {
        if (dc.readyState !== 'open') return;
        dc.send(JSON.stringify({ type: 'ping', from: 'client', id: ++pingId, sent: performance.now() }));
      }, 1000);
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

console.log('[CloudClient] ready — waiting for the server window.');
