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

function setStat(id, text, ok = null) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = ok === null ? '' : ok ? 'ok' : 'bad';
}

const video = document.getElementById('stream');

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

  // Count frames as the browser DECODES and PRESENTS them — this is the C2
  // Plan A machinery (per-frame presentation metadata), exercised early.
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const onFrame = (_now, meta) => {
      setStat('stat-frames',
        `${meta.presentedFrames} presented · mediaTime ${meta.mediaTime.toFixed(3)}s`, true);
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  } else {
    setStat('stat-frames', 'requestVideoFrameCallback unsupported → C2 must use Plan B', false);
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
      if (msg.type === 'ping') {
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
