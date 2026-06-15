/* ---------------------------------------------------------------------------
   effects.js — World-space hit feedback (a short-lived spark burst)
   ---------------------------------------------------------------------------
   Phase 1 of the Upgrade Series ("Aesthetic Foundations"): physical feedback
   reads better than a text ✓. When a shot lands we throw a small burst of
   glowing sparks out of the target. They live in the 3D world, so they're part
   of the same off-screen frame the warp reprojects — no separate overlay to
   keep in sync.

   Design notes (kept deliberately small + studyable):
     • One fixed pool of points, allocated once. burst() lights up a slice of the
       pool; update() ages every particle and fades it to black.
     • AdditiveBlending means a black particle is invisible, so "fade to black"
       IS "fade out" — no per-vertex alpha plumbing needed.
     • Particles never cast shadows and are never ray-tested (only targets are),
       so this can't affect the honest hit detection.
--------------------------------------------------------------------------- */

import * as THREE from 'three';

const POOL = 160;          // total particles available across all live bursts
const PER_BURST = 26;      // particles lit per hit
const LIFE = 0.5;          // seconds a particle stays alive
const GRAVITY = 6.0;       // world units/s² pulling sparks down
const SPEED = 3.2;         // initial spark speed (units/s)
const BASE_COLOR = new THREE.Color(0xffd166); // warm gold, matches the bullseye

export class HitEffects {
  constructor(scene) {
    const positions = new Float32Array(POOL * 3);
    const colors = new Float32Array(POOL * 3); // black = invisible under additive
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const points = new THREE.Points(geom, new THREE.PointsMaterial({
      size: 0.09,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }));
    points.frustumCulled = false; // bursts can sit near the frame edge
    scene.add(points);

    this.points = points;
    this.positions = positions;
    this.colors = colors;
    this.vel = Array.from({ length: POOL }, () => new THREE.Vector3());
    this.age = new Float32Array(POOL).fill(LIFE); // start "dead"
    this.cursor = 0;
    this._tmp = new THREE.Vector3();
    this._last = performance.now();
  }

  /** Spawn a burst at a target mesh's displayed world position. */
  burst(mesh) {
    mesh.getWorldPosition(this._tmp);
    for (let i = 0; i < PER_BURST; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % POOL;

      this.positions[k * 3 + 0] = this._tmp.x;
      this.positions[k * 3 + 1] = this._tmp.y;
      this.positions[k * 3 + 2] = this._tmp.z;

      // Outward in a roughly hemispherical spray, biased toward the shooter (+z).
      this.vel[k].set(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2 + 0.4,
        Math.random() * 0.8 + 0.2
      ).normalize().multiplyScalar(SPEED * (0.5 + Math.random() * 0.6));

      this.colors[k * 3 + 0] = BASE_COLOR.r;
      this.colors[k * 3 + 1] = BASE_COLOR.g;
      this.colors[k * 3 + 2] = BASE_COLOR.b;
      this.age[k] = 0;
    }
  }

  /** Age + move every live particle. Call once per rendered scene frame. */
  update(now = performance.now()) {
    const dt = Math.min(0.05, (now - this._last) / 1000); // clamp tab-switch jumps
    this._last = now;
    if (dt <= 0) return;

    for (let k = 0; k < POOL; k++) {
      if (this.age[k] >= LIFE) continue;
      this.age[k] += dt;

      const v = this.vel[k];
      v.y -= GRAVITY * dt;
      this.positions[k * 3 + 0] += v.x * dt;
      this.positions[k * 3 + 1] += v.y * dt;
      this.positions[k * 3 + 2] += v.z * dt;

      // Fade brightness to zero over the lifetime; additive blend hides it.
      const b = Math.max(0, 1 - this.age[k] / LIFE);
      this.colors[k * 3 + 0] = BASE_COLOR.r * b;
      this.colors[k * 3 + 1] = BASE_COLOR.g * b;
      this.colors[k * 3 + 2] = BASE_COLOR.b * b;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
