/* ---------------------------------------------------------------------------
   targets.js — The shootable targets (moving on a track)
   ---------------------------------------------------------------------------
   Bullseye targets that slide laterally along a track against the back wall.
   The lateral motion is the point: to hit a moving target you must TRACK it —
   your mouse is in motion when you click. That is the only situation where the
   lagged view actually matters, so it's what makes you miss without warp and
   hit with it, naturally and without the judge needing the theory.

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

// Hit reaction (Upgrade Series): a short, purely-visual punch when a shot lands.
// Physical feedback reads better than a text ✓ alone (the brief's §2A). It is
// driven by wall-clock and only touches scale / in-plane spin / emissive — never
// the disc's position — so the honest hit center is unchanged.
const REACT_MS = 420;
const BASE_EMISSIVE = 0.3;   // matches the material's resting emissiveIntensity

export class Targets {
  constructor(range) {
    this.range = range;
    this.radius = RADIUS;
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
      disc.userData = {
        phase: lanes[i].phase, baseY: lanes[i].y, pulse: i * 0.9,
        vel: new THREE.Vector3(0, 0, 0), // current world velocity (units/sec)
        reactT0: -Infinity,              // wall-clock ms of the last landed hit
      };
      this.group.add(disc);
      this.meshes.push(disc);
    }
  }

  /**
   * Advance positions. `elapsed` is absolute seconds. Called on the render tick
   * (30 FPS), so the displayed frame and the hit-test agree exactly. Also stores
   * each target's current world-space velocity for the motion-vector pass.
   */
  update(elapsed) {
    const L = this.range.trackXLimit;
    const speed = (L * 4) / this._period; // |dx/dt| of the triangle wave
    for (const m of this.meshes) {
      const u = ((elapsed / this._period) + m.userData.phase) % 1; // 0..1
      const tri = u < 0.5 ? (-1 + 4 * u) : (3 - 4 * u);            // triangle -1..1
      m.position.x = L * tri;
      m.userData.vel.set(u < 0.5 ? speed : -speed, 0, 0);          // lateral velocity
      // tiny idle pulse (kept small so it never moves the hit center)
      const s = 1 + Math.sin(elapsed * 2 + m.userData.pulse) * 0.04;

      // Hit reaction: a quick bulge + in-plane spin + emissive flare that eases
      // back to rest. Scale and rotation are about the disc's own center/axis, so
      // none of this shifts where the ray must land. Wall-clock driven so it's
      // identical no matter how many times update() runs while hit-testing.
      const rt = (performance.now() - m.userData.reactT0) / REACT_MS;
      if (rt >= 0 && rt < 1) {
        const ease = 1 - rt;                          // 1 → 0 over the reaction
        m.scale.setScalar(s + Math.sin(rt * Math.PI) * 0.18); // bulge out and back
        m.rotation.z = ease * ease * 0.9;             // fast spin that settles
        m.material.emissiveIntensity = BASE_EMISSIVE + ease * 1.3; // bright flare
      } else {
        m.scale.setScalar(s);
        m.rotation.z = 0;
        m.material.emissiveIntensity = BASE_EMISSIVE;
      }
    }
  }

  /** Flag a target for the hit reaction (called by the shooter on a landed hit). */
  hitReact(mesh) {
    if (mesh && mesh.userData) mesh.userData.reactT0 = performance.now();
  }

  /** Current world-space velocity (units/sec) of each target, aligned with .meshes. */
  getVelocities() {
    return this.meshes.map((m) => m.userData.vel);
  }
}

/* A red/white concentric-ring bullseye baked into a canvas texture.
   Phase 1 upgrade: 512px (was 128), a soft outer glow ring, a faint top-left
   highlight so the disc reads as a beveled puck rather than a flat decal, and a
   thin dark seam between rings for crispness. The hit geometry is unchanged —
   this is purely how the same disc is shaded. */
function makeBullseyeTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;
  ctx.clearRect(0, 0, size, size);

  // Outer glow ring — a halo that fades into transparency just past the rim.
  const glow = ctx.createRadialGradient(cx, cx, size * 0.42, cx, cx, size * 0.5);
  glow.addColorStop(0, 'rgba(255, 209, 102, 0.0)');
  glow.addColorStop(0.6, 'rgba(255, 209, 102, 0.35)');
  glow.addColorStop(1, 'rgba(255, 209, 102, 0.0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cx, size * 0.5, 0, Math.PI * 2);
  ctx.fill();

  const rings = [
    [0.46, '#e7ecf3'],
    [0.37, '#ef476f'],
    [0.28, '#e7ecf3'],
    [0.19, '#ef476f'],
    [0.10, '#ffd166'],
  ];
  ctx.lineWidth = size * 0.006;
  ctx.strokeStyle = 'rgba(10, 12, 16, 0.55)'; // thin dark seam between rings
  for (const [r, color] of rings) {
    ctx.beginPath();
    ctx.arc(cx, cx, r * size, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.stroke();
  }

  // Beveled-puck highlight: a soft light pool toward the top-left, plus a dark
  // rim toward the bottom-right, both clipped to the disc.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cx, size * 0.46, 0, Math.PI * 2);
  ctx.clip();
  const hi = ctx.createRadialGradient(cx * 0.7, cx * 0.7, 0, cx * 0.7, cx * 0.7, size * 0.6);
  hi.addColorStop(0, 'rgba(255, 255, 255, 0.28)');
  hi.addColorStop(0.5, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = hi;
  ctx.fillRect(0, 0, size, size);
  const sh = ctx.createRadialGradient(cx * 1.35, cx * 1.35, 0, cx * 1.35, cx * 1.35, size * 0.7);
  sh.addColorStop(0, 'rgba(0, 0, 0, 0.30)');
  sh.addColorStop(0.6, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = sh;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
