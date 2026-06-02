/* ---------------------------------------------------------------------------
   input.js — High-frequency mouse sampling + Pointer Lock
   ---------------------------------------------------------------------------
   WHY THIS MATTERS (this is the core idea of the whole project):

   A monitor only shows a new frame every so often. At 30 FPS that's once
   every ~33 ms. But the mouse reports movement MUCH faster than that — a
   gaming mouse fires `mousemove` events at 125–1000 Hz.

   So there are two completely separate clocks in this project:
     1. INPUT clock  — fast. Every mousemove event, we accumulate the motion.
     2. RENDER clock — slow. The 3D scene is only redrawn at 30 FPS.

   In Stage 1 we just CAPTURE the fast input and feed it to the slow renderer
   (with deliberate lag, see lag.js). In Stage 2, the warp shader will use the
   *freshest* input to nudge the *old* frame — that's the whole trick.

   This module is the "fast clock". It exposes the camera's yaw/pitch, updated
   immediately on every mouse event, plus a counter so the HUD can show the
   real input sampling rate.
--------------------------------------------------------------------------- */

// Mouse sensitivity: radians of rotation per pixel of mouse movement.
const SENSITIVITY = 0.0022;

// Clamp how far up/down you can look (just shy of straight up/down) so the
// camera never flips over.
const PITCH_LIMIT = Math.PI / 2 - 0.05;

export class Input {
  constructor(domElement) {
    this.dom = domElement;

    // Current look orientation, updated on EVERY mouse event (the fast clock).
    this.yaw = 0;    // left/right, radians
    this.pitch = 0;  // up/down, radians

    // Diagnostics: how many mouse events have we seen since the last reset?
    // The HUD samples this once a second to display the true input rate.
    this.eventCount = 0;

    this.locked = false;

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onLockChange = this._onLockChange.bind(this);

    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  /** Request pointer lock. Must be called from a user gesture (e.g. a click). */
  lock() {
    this.dom.requestPointerLock();
  }

  _onLockChange() {
    this.locked = document.pointerLockElement === this.dom;
  }

  _onMouseMove(e) {
    if (!this.locked) return;

    // movementX/Y are raw deltas in pixels since the last event. This is the
    // high-frequency signal we care about.
    this.yaw   -= e.movementX * SENSITIVITY;
    this.pitch -= e.movementY * SENSITIVITY;

    // Keep pitch within limits; yaw is free to wrap around.
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));

    this.eventCount++;
  }

  /** Read & reset the event counter. Returns events since last call. */
  drainEventCount() {
    const n = this.eventCount;
    this.eventCount = 0;
    return n;
  }

  /** A plain snapshot of the current orientation (used by the lag buffer). */
  snapshot() {
    return { yaw: this.yaw, pitch: this.pitch };
  }
}
