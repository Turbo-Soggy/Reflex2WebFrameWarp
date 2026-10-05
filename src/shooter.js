/* ---------------------------------------------------------------------------
   shooter.js — Click-to-shoot: hit detection + feedback
   ---------------------------------------------------------------------------
   Single fullscreen viewport. One click fires ONE ray, always along the CURRENT
   input aim (where the gun points now), and always tests it against the targets
   as the DISPLAYED frame shows them (their positions at the frame's world time,
   plus the motion-vector extrapolation when M is on). Both modes use the same
   rule, so the only thing that differs between warp ON and OFF is what the
   screen centre shows: with warp ON the image is reprojected to the current aim,
   so the crosshair sits on what the ray tests -> hit; with warp OFF the image is
   the raw frame drawn from the LAGGED orientation, so the crosshair sits on a
   direction the gun no longer points at -> miss while tracking.
   The result is scored into the matching mode bucket so the comparison persists.

   This module owns the shooting; main.js keeps the app state and passes it in via
   `ctx` accessors (so the logic here is unchanged from when it lived in main).
--------------------------------------------------------------------------- */

import * as THREE from 'three';
import { shoot } from './raycast.js';
import { DISPLAY_FOV_Y } from './config.js';

const SHOOT_COOLDOWN_MS = 120; // spam-click guard so the score data stays clean

// Reusable objects for the A/B aim-geometry capture (below) — a throwaway camera
// at the DISPLAY FOV so we can project a world point exactly as the user sees it.
const _aimCam = new THREE.PerspectiveCamera(DISPLAY_FOV_Y, 16 / 9, 0.1, 200);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _fwd = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * @param {object} ctx
 *   refs:     input, warpTarget (renderedYaw/renderedPitch), targets, camera,
 *             scoreboard, clock
 *   getters:  getWarpEnabled, getMotionVectorsOn, getLastRenderedElapsed,
 *             getLastRenderWallTime
 * @returns {{ fire: () => void }}
 */
export function createShooter(ctx) {
  const crosshair = document.getElementById('crosshair');
  const muzzle = document.getElementById('muzzle');
  const view = document.getElementById('view');
  let lastShot = -Infinity;

  // Restart a CSS animation by toggling its class off→on across a reflow.
  function pulse(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // force reflow so the animation re-triggers
    el.classList.add(cls);
  }
  const pulseCrosshair = () => pulse(crosshair, 'shoot');

  function fire() {
    const yaw = ctx.input.yaw;
    const pitch = ctx.input.pitch;

    // HIT-TEST RULE (identical for warp ON and OFF):
    //   ray     = current input aim (yaw, pitch): the gun points where the hand is NOW.
    //   targets = where the DISPLAYED frame shows them: rewound to that frame's
    //             world time (lastRenderedElapsed), plus velocity x dt when M is on.
    //
    // Why warp OFF still misses while tracking (geometry):
    //   The crosshair is a DOM element fixed at screen centre. With warp OFF the
    //   frame is composited with delta 0, so the screen-centre pixel shows the
    //   direction of the frame's camera, i.e. the LAGGED orientation
    //   (renderedYaw, renderedPitch). Centring the target under the crosshair
    //   therefore puts the displayed target on the lagged direction. The ray,
    //   however, leaves along the current aim, which differs from the lagged
    //   one by exactly (dYaw, dPitch) = fresh - rendered (the same delta the warp
    //   shader would apply). Rewinding the targets does NOT remove that offset:
    //   it only makes the tested target equal the displayed one, so the miss
    //   distance is purely the camera-rotation latency, roughly
    //   angular tracking speed x (injected lag + frame age).
    //   With warp ON the image is shifted by that same delta, so the screen
    //   centre shows the current aim; the displayed target under the crosshair
    //   IS on the ray -> hit. Stationary aim: delta ~ 0, both modes hit.
    //
    //   (Before this change, warp OFF tested the targets at the PRESENT time.
    //   Because main.js lags the whole frame, camera AND targets, by lagMs, a
    //   steady tracker's hand ends up roughly in phase with the present target,
    //   so that rule partly cancelled the view error it was meant to expose, and
    //   the two modes tested different target positions. Now both modes test
    //   the displayed positions and only the view direction differs.)
    const hitTime = ctx.getLastRenderedElapsed();
    ctx.targets.update(hitTime); // also stores each target's velocity at hitTime

    // Motion vectors: when M is on, the shader shifts moving targets on screen by
    // velocity x dt (dt = age of the source frame, the same value main.js passes
    // as uDeltaTime) in BOTH warp modes, so the displayed target is the rewound
    // position plus that extrapolation, and that is what gets tested. Known
    // approximation: the shader clamps the per-pixel shift at
    // MAX_VEL_CONTRIBUTION (0.015 UV). At 30 FPS source frames the shift stays
    // under it; at 10 FPS (Shift+M) late in a frame it can bind, and then the
    // tested target leads the drawn one slightly. This is not clamped here.
    if (ctx.getMotionVectorsOn()) {
      const dt = Math.max(0, (performance.now() - ctx.getLastRenderWallTime()) / 1000);
      const vels = ctx.targets.getVelocities();
      for (let i = 0; i < ctx.targets.meshes.length; i++) {
        ctx.targets.meshes[i].position.addScaledVector(vels[i], dt);
      }
    }
    ctx.targets.group.updateMatrixWorld(true);

    // Snapshot the tested (= displayed) world positions for the A/B aim capture.
    const tested = ctx.targets.meshes.map((m) => m.getWorldPosition(new THREE.Vector3()));

    const hit = shoot(ctx.camera.position, yaw, pitch, ctx.targets.meshes);

    // Restore targets to the rendered-frame positions (drops the MV offset) so
    // the loop doesn't stutter.
    ctx.targets.update(ctx.getLastRenderedElapsed());
    ctx.targets.group.updateMatrixWorld(true);

    // --- Aim geometry for the A/B replay (§3A/§3B) -------------------------
    // The SAME tested target, projected through two cameras: the one the screen
    // was DISPLAYING (where the target looked relative to the crosshair) and the
    // current aim (where it really was relative to the ray). Warp OFF: a gap
    // opens, "looked dead-on, missed". Warp ON: they coincide. Read-only.
    const aim = captureAim(ctx, yaw, pitch, hit, tested);

    ctx.scoreboard.registerShot(ctx.getWarpEnabled(), !!hit);

    // Feel feedback (Phase 1/2): muzzle flash + recoil shake on every shot; a
    // world-space spark burst + sound only when the shot actually lands.
    pulseCrosshair();
    pulse(muzzle, 'flash');
    pulse(view, 'shake');
    ctx.audio?.fire();
    if (hit) {
      ctx.effects?.burst(hit);   // sparks at the target's displayed position
      ctx.targets.hitReact(hit); // bulge + spin + flare on the struck disc
      ctx.audio?.hit();
    } else {
      ctx.audio?.miss();
    }

    // Broadcast the shot so the onboarding flow + session summary can react
    // without this module needing to know they exist (loose pub/sub).
    window.dispatchEvent(new CustomEvent('framewarp:shot', {
      detail: { hit: !!hit, warpOn: ctx.getWarpEnabled(), aim },
    }));

    // The instruction has served its purpose once you've taken a shot — fade it.
    const hint = document.getElementById('play-hint');
    if (hint) hint.classList.add('faded');
  }

  document.addEventListener('mousedown', (e) => {
    // Mechanism views (side-by-side / x-ray / freeze) lock shooting: their
    // displayed frame is not the honest single-viewport hit-test condition.
    if (!ctx.input.locked || e.button !== 0 || ctx.canShoot?.() === false) return;
    const now = performance.now();
    if (now - lastShot < SHOOT_COOLDOWN_MS) return;
    lastShot = now;
    fire();
  });

  return { fire };
}

/* Project the tested target (the one hit, else the first) into the crosshair
   frame twice:
     - displayed: through the orientation the compositor showed at screen centre.
       Warp OFF composites with delta 0, so that is the frame's own (lagged)
       orientation; warp ON shifts by fresh - rendered, so it is the current aim.
     - actual: through the current aim, the direction the ray was fired along.
   The target position is the same in both (the displayed = tested position), so
   any gap between them is pure view-direction latency. Returns NDC offsets
   [-1..1] and the angular miss (deg) between the ray and the tested target. */
function captureAim(ctx, yaw, pitch, hit, tested) {
  const idx = hit ? ctx.targets.meshes.indexOf(hit) : 0;
  const world = tested[idx];
  if (!world) return null;

  const warpOn = ctx.getWarpEnabled();
  const dispYaw = warpOn ? yaw : ctx.warpTarget.renderedYaw;
  const dispPitch = warpOn ? pitch : ctx.warpTarget.renderedPitch;

  _aimCam.position.copy(ctx.camera.position);
  _aimCam.aspect = ctx.camera.aspect;
  _aimCam.updateProjectionMatrix();

  _aimCam.quaternion.setFromEuler(_euler.set(dispPitch, dispYaw, 0));
  _aimCam.updateMatrixWorld(true);
  const d = world.clone().project(_aimCam);

  _aimCam.quaternion.setFromEuler(_euler.set(pitch, yaw, 0));
  _aimCam.updateMatrixWorld(true);
  const a = world.clone().project(_aimCam);

  _fwd.set(0, 0, -1).applyEuler(_euler);                       // current aim (the ray)
  _dir.copy(world).sub(ctx.camera.position).normalize();       // to the tested target
  const errDeg = THREE.MathUtils.radToDeg(
    Math.acos(Math.max(-1, Math.min(1, _fwd.dot(_dir)))));

  return { displayed: { x: d.x, y: d.y }, actual: { x: a.x, y: a.y }, errDeg };
}
