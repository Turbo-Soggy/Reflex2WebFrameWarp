/* ---------------------------------------------------------------------------
   frame-tag.js — Shared stream-protocol constants + the pixel frame tag codec
   ---------------------------------------------------------------------------
   THE FRAME-MATCHING PROBLEM (the heart of Stage C2): the client receives two
   independent flows — video frames (slow path: encode → network → decode) and
   pose packets (fast path: DataChannel). To warp a displayed frame it must
   know which pose that exact frame was rendered with. Nothing in WebRTC ties
   the two together for us.

   THE TAG: the server bakes the frame's id into the frame itself, as a 4×4
   grid of black/white cells (16 bits) in the top-left corner. The client reads
   the cells back from the decoded video and gets a frameId that is, by
   construction, the id of the very frame it is looking at — deterministic and
   immune to network reordering, jitter, and clock skew. The corner lives in
   the guard band, so the Stage C3 crop hides it from the player automatically.

   This is "Plan B" from the build plan, but it is built FIRST because it is
   also the test oracle for Plan A (timestamp matching, see pose-sync.js): the
   client runs both and reports how often Plan A agrees with the pixels.

   Cells are 16×16 px so the tag survives encoder downscaling (at the 320×180
   ramp-up resolution a cell is still 4×4 px) and lossy compression (we sample
   a block at each cell's CENTRE, far from edge ringing). 16 bits wrap at
   65536 frames ≈ 36 minutes of stream — far longer than the pose ring buffer
   the id is matched against, so wrapping is harmless.

   Pure data + math only (no DOM, no THREE) → unit-testable in Node.
--------------------------------------------------------------------------- */

// The fixed capture geometry both pages must agree on (see server-main.js for
// why it never changes mid-stream).
export const CAPTURE = { width: 1280, height: 720, fps: 30 };

export const TAG = {
  cells: 4,                 // 4×4 grid …
  bits: 16,                 // … = 16 bits
  cellPx: 16,               // each cell is 16×16 source pixels
  px: 4 * 16,               // whole tag region: 64×64, at the top-left corner
};

/** frameId → 16 booleans, bit i of (id mod 2^16) at index i (LSB first). */
export function idToBits(id) {
  const masked = id & 0xffff;
  const bits = [];
  for (let i = 0; i < TAG.bits; i++) bits.push(((masked >>> i) & 1) === 1);
  return bits;
}

/** 16 booleans (LSB first) → frameId in [0, 65535]. Inverse of idToBits. */
export function bitsToId(bits) {
  let id = 0;
  for (let i = 0; i < TAG.bits; i++) if (bits[i]) id |= 1 << i;
  return id;
}

/**
 * The pixel rectangle of cell `i`, in TOP-LEFT-origin coordinates (CSS/canvas
 * convention; the server flips y once for WebGL's bottom-left scissor).
 * Cells are row-major: bit 0 top-left, bit 3 top-right, bit 15 bottom-right.
 */
export function cellRect(i) {
  const col = i % TAG.cells;
  const row = Math.floor(i / TAG.cells);
  return { x: col * TAG.cellPx, y: row * TAG.cellPx, w: TAG.cellPx, h: TAG.cellPx };
}
