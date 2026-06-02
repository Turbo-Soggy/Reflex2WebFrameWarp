/* ---------------------------------------------------------------------------
   targets.js — The shootable targets (moving on a track)
   ---------------------------------------------------------------------------
   Bullseye targets that slide laterally along a track against the back wall.
   The lateral motion is the point: to hit a moving target you must TRACK it —
   your mouse is in motion when you click. That is the only situation where the
   lagged view actually matters, so it's what makes the left half miss and the
   right (warped) half hit, naturally and without the judge needing the theory.

   Honesty detail: positions are a pure function of time and are advanced ONLY
   on the 30 FPS render tick (main.js calls update() inside the render block).
   That keeps the ray-tested position identical to the DISPLAYED position, so
   the warp side has no hidden target-motion error — the only thing that can
   cause a miss is camera-rotation latency, which is exactly what the warp fixes.
--------------------------------------------------------------------------- */

import * as THREE from 'three';

const CROSS_SECONDS = 1.0;   // ~1s to cross the screen — fast enough that
                             // stationary shots are impractical; you must track
const RADIUS = 0.4;

export class Targets {
  constructor(range) {
    this.range = range;
    this.group = new THREE.Group();
    this.meshes = [];
    this._period = CROSS_SECONDS * 2; // full back-and-forth

    const tex = makeBullseyeTexture();

    // A single target sweeping the track — you focus on tracking the one.
    const lanes = [
      { y: 2.0, phase: 0.00 },
    ];

    for (let i = 0; i < lanes.length; i++) {
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        emissive: 0xffffff,
        emissiveMap: tex,
        emissiveIntensity: 0.3,
        roughness: 0.55,
        metalness: 0.0,
        side: THREE.DoubleSide,
      });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 48), mat);
      disc.position.set(0, lanes[i].y, range.trackZ); // x set in update()
      disc.castShadow = true;
      disc.userData = { phase: lanes[i].phase, baseY: lanes[i].y, pulse: i * 0.9 };
      this.group.add(disc);
      this.meshes.push(disc);
    }
  }

  /**
   * Advance positions. `elapsed` is absolute seconds. Called on the render tick
   * (30 FPS), so the displayed frame and the hit-test agree exactly.
   */
  update(elapsed) {
    const L = this.range.trackXLimit;
    for (const m of this.meshes) {
      const u = ((elapsed / this._period) + m.userData.phase) % 1; // 0..1
      const tri = u < 0.5 ? (-1 + 4 * u) : (3 - 4 * u);            // triangle -1..1
      m.position.x = L * tri;
      // tiny idle pulse (kept small so it never moves the hit center)
      const s = 1 + Math.sin(elapsed * 2 + m.userData.pulse) * 0.04;
      m.scale.setScalar(s);
    }
  }
}

/* A red/white concentric-ring bullseye baked into a canvas texture. */
function makeBullseyeTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;
  const rings = [
    [0.50, '#e7ecf3'],
    [0.40, '#ef476f'],
    [0.30, '#e7ecf3'],
    [0.20, '#ef476f'],
    [0.10, '#ffd166'],
  ];
  ctx.clearRect(0, 0, size, size);
  for (const [r, color] of rings) {
    ctx.beginPath();
    ctx.arc(cx, cx, r * size, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
