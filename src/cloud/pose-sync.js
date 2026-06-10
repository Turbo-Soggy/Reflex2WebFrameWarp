/* ---------------------------------------------------------------------------
   pose-sync.js — Client-side ring buffer matching pose packets to video frames
   ---------------------------------------------------------------------------
   The server sends one pose packet {frameId, yaw, pitch, t} per rendered frame
   over the unreliable DataChannel (t = the server's performance.now() — a
   clock this page does NOT share). This module stores the recent packets and
   answers: "the frame on screen right now — what pose was it rendered with?"

   Two resolution paths, deliberately both:

   • byFrameId(id) — EXACT. The id comes from pixels (frame-tag.js), so the
     answer is correct by construction. This is the primary mechanism.

   • byCaptureTime(t) — ESTIMATED ("Plan A"). requestVideoFrameCallback gives
     a per-displayed-frame captureTime in THIS page's clock. To compare it with
     pose timestamps we estimate the inter-page clock offset from the pose
     packets themselves: network transit is never negative, so the SMALLEST
     observed (arrivalTime − pose.t) over many packets converges on the true
     clock offset (a classic one-way-delay min-filter). Then the nearest pose
     in server-time wins. Frames are ~33 ms apart, so the estimate only needs
     to be good to ±16 ms — on localhost it is good to ~1 ms.

   RULE (load-bearing for the whole cloud pipeline): never compare raw
   timestamps from different machines. Same-clock differences (RTT, offsets)
   only. byCaptureTime honours this — the offset estimate is subtracted before
   any cross-clock comparison.

   Pure JS (no DOM) → unit-testable in Node.
--------------------------------------------------------------------------- */

export class PoseSync {
  /** @param {number} capacity  how many recent poses to keep (~2s at 30 FPS) */
  constructor(capacity = 60) {
    this.capacity = capacity;
    this.poses = [];        // oldest → newest
    this.offsetMs = null;   // estimated (client clock − server clock), min-filtered
  }

  /**
   * Store an arriving pose packet.
   * @param {{frameId:number, yaw:number, pitch:number, t:number}} pose
   * @param {number} arrivalMs  performance.now() at arrival (CLIENT clock)
   */
  record(pose, arrivalMs) {
    // Min-filter the clock offset: arrival = pose.t + offset + transit, and
    // transit ≥ 0, so min(arrival − pose.t) → offset as transit dips to ~0.
    const candidate = arrivalMs - pose.t;
    this.offsetMs = this.offsetMs === null ? candidate : Math.min(this.offsetMs, candidate);

    this.poses.push({ ...pose, arrivalMs });
    if (this.poses.length > this.capacity) this.poses.shift();
  }

  /**
   * EXACT lookup by the 16-bit id read from the frame's pixel tag.
   * Searches newest-first (a stale duplicate id from a wrapped counter would
   * have to be 65536 frames old — far outside the buffer — but newest-first
   * is the right bias regardless). Returns the pose or null.
   */
  byFrameId(id16) {
    for (let i = this.poses.length - 1; i >= 0; i--) {
      if ((this.poses[i].frameId & 0xffff) === (id16 & 0xffff)) return this.poses[i];
    }
    return null;
  }

  /**
   * ESTIMATED lookup by a client-clock capture timestamp (Plan A).
   * @param {number} captureMs  metadata.captureTime from requestVideoFrameCallback
   * @returns {{pose:object, errMs:number}|null}  nearest pose + how far off it was
   */
  byCaptureTime(captureMs) {
    if (this.offsetMs === null || this.poses.length === 0) return null;
    const tServer = captureMs - this.offsetMs; // client clock → server clock
    let pose = null, errMs = Infinity;
    for (const p of this.poses) {
      const err = Math.abs(p.t - tServer);
      if (err < errMs) { errMs = err; pose = p; }
    }
    return { pose, errMs };
  }

  /**
   * ESTIMATED lookup by the frame's network arrival time (Plan A, preferred
   * variant). metadata.receiveTime says when the displayed frame's packets
   * arrived — in THIS page's clock, same as the recorded pose arrivals, so no
   * cross-clock estimation is involved at all. A frame's pose rides the fast
   * path (DataChannel) while the frame itself takes the slow path (encode →
   * RTP), so the pose ARRIVES shortly BEFORE its frame: the right answer is
   * the newest pose that had arrived by receiveMs.
   * @returns {{pose:object, leadMs:number}|null}  leadMs = how long the pose
   *          beat its video frame (≈ encode + packetisation time)
   */
  byReceiveTime(receiveMs) {
    let pose = null;
    for (const p of this.poses) { // stored in arrival order
      if (p.arrivalMs <= receiveMs) pose = p;
      else break;
    }
    return pose ? { pose, leadMs: receiveMs - pose.arrivalMs } : null;
  }

  get size() {
    return this.poses.length;
  }
}
