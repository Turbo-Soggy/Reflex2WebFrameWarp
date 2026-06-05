/* ---------------------------------------------------------------------------
   scene.js — The static environment: an indoor shooting range
   ---------------------------------------------------------------------------
   A stripped-down but believable firing range: concrete floor with painted
   lanes + distance markers, back/side/near walls, a ceiling with strip lights,
   and a couple of foreground posts for parallax. The aim is the "engineering
   tool" look — the scene is the hero, not a void with floating targets.

   The shootable targets live in targets.js; main.js drops them in. The range
   dimensions are exported so the targets sit correctly against the back wall.
--------------------------------------------------------------------------- */

import * as THREE from 'three';

// Range geometry shared with targets.js (all in world units).
export const RANGE = {
  halfW: 8,      // half-width (walls at ±halfW)
  height: 6,     // floor→ceiling
  backZ: -20,    // back wall
  nearZ: 4,      // near wall (behind the player)
  trackZ: -18,   // depth the targets travel along
  trackXLimit: 6 // targets sweep x ∈ [-limit, +limit]
};

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0c10);
  scene.fog = new THREE.Fog(0x0a0c10, 22, 48);

  const { halfW, height, backZ, nearZ } = RANGE;
  const depth = nearZ - backZ;
  const midZ = (nearZ + backZ) / 2;

  // --- Lighting ------------------------------------------------------------
  // An indoor range should read as well-lit, not a void. Generous fill so the
  // walls/floor are clearly visible; the strip lights add character, not all
  // the illumination.
  scene.add(new THREE.AmbientLight(0xb9c6da, 0.55));
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x141a22, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 0.6);
  key.position.set(3, 9, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 50;
  key.shadow.camera.left = -halfW - 2;
  key.shadow.camera.right = halfW + 2;
  key.shadow.camera.top = 12;
  key.shadow.camera.bottom = -2;
  key.shadow.bias = -0.0004;
  scene.add(key);

  // --- Materials -----------------------------------------------------------
  const wallMat = new THREE.MeshStandardMaterial({ map: makeConcreteTexture(0x3a414c), roughness: 0.95 });
  const ceilMat = new THREE.MeshStandardMaterial({ map: makeConcreteTexture(0x2a3038), roughness: 1.0 });
  const floorTex = makeFloorTexture();
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9, metalness: 0.0 });
  const backTex = makeBackWallTexture();
  const backMat = new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.9 });

  // --- Shell (floor, ceiling, 4 walls) -------------------------------------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, depth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = midZ;
  floor.receiveShadow = true;
  scene.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, depth), ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, height, midZ);
  scene.add(ceiling);

  const back = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, height), backMat);
  back.position.set(0, height / 2, backZ);
  back.receiveShadow = true;
  scene.add(back);

  for (const sx of [-halfW, halfW]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(depth, height), wallMat);
    wall.position.set(sx, height / 2, midZ);
    wall.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2;
    wall.receiveShadow = true;
    scene.add(wall);
  }

  const near = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, height), wallMat);
  near.position.set(0, height / 2, nearZ);
  near.rotation.y = Math.PI;
  scene.add(near);

  // --- Ceiling strip lights (soft emissive bars + pooled point lights) -----
  // Kept gentle so they read as recessed strips, not a glaring slash.
  for (const sx of [-3.5, 3.5]) {
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(0.28, depth - 6),
      new THREE.MeshStandardMaterial({ color: 0xeaf1ff, emissive: 0xdbe7ff, emissiveIntensity: 0.32 })
    );
    strip.rotation.x = Math.PI / 2;
    strip.position.set(sx, height - 0.03, midZ);
    scene.add(strip);

    const lamp = new THREE.PointLight(0xeaf1ff, 30, 42, 2);
    lamp.position.set(sx, height - 0.6, midZ);
    scene.add(lamp);
  }

  // --- Foreground posts for parallax (sells the warp's depth) --------------
  const postMat = new THREE.MeshStandardMaterial({ color: 0x161a20, roughness: 0.7, metalness: 0.3 });
  for (const [px, pz] of [[-halfW + 1.2, -2], [halfW - 1.2, -2], [-halfW + 1.2, -10], [halfW - 1.2, -10]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, height, 0.3), postMat);
    post.position.set(px, height / 2, pz);
    post.castShadow = true;
    scene.add(post);
  }

  // The environment is static; targets.js owns the only motion.
  return { scene, update(_elapsed) {}, range: RANGE };
}

/* --- Procedural textures (canvas-baked, no downloads) --------------------- */

// Fill a canvas with a flat base colour plus subtle light/dark speckle, for a
// concrete feel. Works for any rectangle; pass (size, size) for a square.
function baseConcrete(ctx, w, h, hex) {
  ctx.fillStyle = '#' + hex.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < (w * h) / 200; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const up = Math.random() > 0.5;
    ctx.fillStyle = up ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    ctx.fillRect(x, y, 2, 2);
  }
}

function makeConcreteTexture(hex) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  baseConcrete(c.getContext('2d'), size, size, hex);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  return tex;
}

/* Floor: concrete + painted lane lines (depth) and distance bars (across). */
function makeFloorTexture() {
  const w = 512, h = 1024; // taller: maps to the long axis (depth)
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  baseConcrete(ctx, w, h, 0x343b45);

  // lane lines (vertical in texture = along range depth)
  ctx.strokeStyle = 'rgba(190,205,225,0.40)';
  ctx.lineWidth = 3;
  for (const fx of [0.5, 0.25, 0.75, 0.08, 0.92]) {
    ctx.beginPath(); ctx.moveTo(fx * w, 0); ctx.lineTo(fx * w, h); ctx.stroke();
  }
  // distance bars (horizontal = across the range)
  ctx.strokeStyle = 'rgba(150,165,185,0.20)';
  ctx.lineWidth = 4;
  for (let i = 1; i < 8; i++) {
    const y = (i / 8) * h;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  // bright firing line near the player end
  ctx.strokeStyle = 'rgba(255,209,102,0.55)';
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(0, h * 0.93); ctx.lineTo(w, h * 0.93); ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* Back wall: concrete + faint horizontal track guides at the target heights. */
function makeBackWallTexture() {
  const w = 512, h = 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  baseConcrete(ctx, w, h, 0x434a55);
  ctx.strokeStyle = 'rgba(150,170,195,0.30)';
  ctx.lineWidth = 2;
  for (const fy of [0.35, 0.6]) { // track rails
    ctx.beginPath(); ctx.moveTo(0, fy * h); ctx.lineTo(w, fy * h); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
