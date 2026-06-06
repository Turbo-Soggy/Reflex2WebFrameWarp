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

import { shoot } from './raycast.js';

const SHOOT_COOLDOWN_MS = 120; // spam-click guard so the score data stays clean

/**
 * @param {object} ctx
 *   refs:     input, warpTarget, targets, camera, scoreboard, clock
 *   getters:  getWarpEnabled, getMotionVectorsOn, getLastRenderedElapsed,
 *             getLastRenderWallTime
 * @returns {{ fire: () => void }}
 */
export function createShooter(ctx) {
  const crosshair = document.getElementById('crosshair');
  let lastShot = -Infinity;

  function pulseCrosshair() {
    crosshair.classList.remove('shoot');
    void crosshair.offsetWidth; // restart the animation
    crosshair.classList.add('shoot');
  }

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

    ctx.scoreboard.registerShot(ctx.getWarpEnabled(), !!hit);
    pulseCrosshair();

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
