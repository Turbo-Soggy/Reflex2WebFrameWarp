/* ---------------------------------------------------------------------------
   shooter.js — Click-to-shoot: hit detection + feedback
   ---------------------------------------------------------------------------
   Single fullscreen viewport: one click fires ONE shot, from the orientation the
   screen is currently DISPLAYING. With warp ON the screen is reprojected to the
   current orientation, so the crosshair points where you're aiming NOW → hit.
   With warp OFF the screen shows the lagged orientation, so the crosshair points
   where you WERE aiming ~95 ms ago → miss while you're tracking a moving target.
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
 *   refs:     input, warpTarget, targets, camera, scoreboard, clock
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

    // renderedYaw is from ~lagMs ago, so |current − rendered| is large while
    // tracking and ~0 when stationary. Apply lag compensation (hit-test against
    // the displayed lagged frame) only when warp is on AND you're tracking;
    // otherwise test against the true current world (an ambush shot misses).
    const isTracking = Math.abs(yaw - ctx.warpTarget.renderedYaw) > 0.01;
    const hitTime = (ctx.getWarpEnabled() && isTracking)
      ? ctx.getLastRenderedElapsed()
      : ctx.clock.getElapsedTime();

    ctx.targets.update(hitTime);

    // Motion-vector-aware hit test: when M is on, shift each tested target by the
    // SAME velocity × dt the warp shader applies to the DISPLAY (dt = age of the
    // source frame, identical to the shader's uDeltaTime). Keeps "what you see =
    // what you hit", so W's accuracy holds when M is also on.
    if (ctx.getMotionVectorsOn()) {
      const dt = Math.max(0, (performance.now() - ctx.getLastRenderWallTime()) / 1000);
      const vels = ctx.targets.getVelocities();
      for (let i = 0; i < ctx.targets.meshes.length; i++) {
        ctx.targets.meshes[i].position.addScaledVector(vels[i], dt);
      }
    }
    ctx.targets.group.updateMatrixWorld(true);

    const hit = shoot(ctx.camera.position, yaw, pitch, ctx.targets.meshes);

    // Restore targets to the displayed (lagged) positions so the loop doesn't stutter.
    ctx.targets.update(ctx.getLastRenderedElapsed());

    // --- Aim geometry for the A/B replay (§3A/§3B) -------------------------
    // Project, into the crosshair's own frame, WHERE THE TARGET LOOKED (the
    // displayed/lagged position you tracked) vs WHERE IT REALLY WAS (the true
    // current position the ray was tested against). Warp OFF: a gap opens
    // between them — "looked dead-on, missed". Warp ON: they coincide — "hit".
    // Derived from the same positions the hit test used; purely read-only.
    const aim = captureAim(ctx, yaw, pitch, hit, hitTime);

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
    if (!ctx.input.locked || e.button !== 0) return;
    const now = performance.now();
    if (now - lastShot < SHOOT_COOLDOWN_MS) return;
    lastShot = now;
    fire();
  });

  return { fire };
}

/* Project, into the crosshair frame, the target as you SAW it (the displayed /
   lagged position you tracked) vs the target the ray was actually TESTED against
   (its position at `hitTime`). Those two times are what decide hit vs miss:
     • warp ON + tracking → hitTime is the displayed time, so the two coincide
       and the shot lands ("hit as expected").
     • warp OFF → hitTime is the true current time, so the tested target has
       drifted off your aim — the gap is the miss ("looked dead-on, missed").
   Returns NDC offsets [-1..1] and the angular miss (deg). Samples by re-running
   the pure target update at each time, then restores the displayed time the
   render loop expects. */
function captureAim(ctx, yaw, pitch, hit, hitTime) {
  const tm = hit || ctx.targets.meshes[0];
  if (!tm) return null;

  // Throwaway camera at the DISPLAY FOV and the live aspect, oriented to the
  // freshest aim — projecting through it matches what the crosshair sees.
  _aimCam.position.copy(ctx.camera.position);
  _aimCam.aspect = ctx.camera.aspect;
  _aimCam.quaternion.setFromEuler(_euler.set(pitch, yaw, 0));
  _aimCam.updateMatrixWorld(true);
  _aimCam.updateProjectionMatrix();

  const dispT = ctx.getLastRenderedElapsed(); // the shown (lagged) frame's time

  ctx.targets.update(dispT); ctx.targets.group.updateMatrixWorld(true);
  const dispWorld = tm.getWorldPosition(new THREE.Vector3());
  ctx.targets.update(hitTime); ctx.targets.group.updateMatrixWorld(true);
  const testWorld = tm.getWorldPosition(new THREE.Vector3());
  ctx.targets.update(dispT); ctx.targets.group.updateMatrixWorld(true); // restore

  const d = dispWorld.clone().project(_aimCam);
  const a = testWorld.clone().project(_aimCam);

  _fwd.set(0, 0, -1).applyEuler(_euler);                       // fresh forward (crosshair)
  _dir.copy(testWorld).sub(ctx.camera.position).normalize();   // to the tested target
  const errDeg = THREE.MathUtils.radToDeg(
    Math.acos(Math.max(-1, Math.min(1, _fwd.dot(_dir)))));

  return { displayed: { x: d.x, y: d.y }, actual: { x: a.x, y: a.y }, errDeg };
}
