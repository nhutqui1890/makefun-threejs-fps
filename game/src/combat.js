// Shooting, damage and grenades. One raycast per shot against the world's
// surfaces and every fighter's hit boxes; damage falls off with distance and
// headshots multiply. Tracers and impact puffs are pooled, so a firefight makes
// no new objects. The player gets invisible hit boxes so bots can shoot them.
import * as THREE from 'three';
import { GRENADE } from './weapons.js';
import { PALETTE } from './palette.js';

const TRACER_POOL = 24;
const PUFF_POOL = 40;

export function createCombat(scene, world) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 150;
  const tmpOrigin = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  // The player's hit boxes: rendered with no colour or depth write, so they are
  // invisible but still catch the bots' raycasts.
  const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const proxyBody = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.45), proxyMat);
  const proxyHead = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.42), proxyMat);
  proxyBody.userData.part = 'body';
  proxyHead.userData.part = 'head';
  scene.add(proxyBody, proxyHead);

  // Tracer pool: fading lines from muzzle to impact.
  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i++) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color('#ffd27a'), transparent: true, opacity: 0 }));
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerCursor = 0;

  // Impact puffs: small tetrahedra that burst out and shrink away.
  const puffs = [];
  const puffGeo = new THREE.TetrahedronGeometry(0.06);
  for (let i = 0; i < PUFF_POOL; i++) {
    const mesh = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.sand), transparent: true, opacity: 0 }));
    mesh.visible = false;
    scene.add(mesh);
    puffs.push({ mesh, velocity: new THREE.Vector3(), life: 0 });
  }
  let puffCursor = 0;

  const explosionLight = new THREE.PointLight(new THREE.Color('#ff9a3d'), 0, 18);
  scene.add(explosionLight);
  let explosionFlash = 0;

  const grenades = [];
  const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.metal), roughness: 0.4, metalness: 0.7 });

  function spawnTracer(from, to) {
    const tracer = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % TRACER_POOL;
    const positions = tracer.line.geometry.attributes.position;
    positions.setXYZ(0, from.x, from.y, from.z);
    positions.setXYZ(1, to.x, to.y, to.z);
    positions.needsUpdate = true;
    tracer.line.material.opacity = 0.85;
    tracer.line.visible = true;
    tracer.life = 0.09;
  }

  function spawnPuff(point, normal, color) {
    for (let i = 0; i < 4; i++) {
      const puff = puffs[puffCursor];
      puffCursor = (puffCursor + 1) % PUFF_POOL;
      puff.mesh.position.copy(point);
      puff.mesh.material.color.set(color);
      puff.mesh.material.opacity = 0.9;
      puff.mesh.visible = true;
      puff.mesh.scale.setScalar(1);
      puff.velocity.set(
        normal.x + (Math.random() - 0.5) * 2,
        normal.y + Math.random() * 1.6,
        normal.z + (Math.random() - 0.5) * 2,
      ).multiplyScalar(1.6);
      puff.life = 0.35 + Math.random() * 0.2;
    }
  }

  // Fire one hitscan round. actors: every fighter (bots and the player proxy).
  // Returns the damage dealt, or 0. onHit(actor, damage, part, killed) is called
  // for a fighter hit; onSurface(point) for a world hit.
  function shootFrom(origin, direction, shooter, def, actors, onHit, onSurface) {
    tmpOrigin.copy(origin);
    tmpDir.copy(direction).normalize();
    raycaster.set(tmpOrigin, tmpDir);
    raycaster.far = def.range;
    const targets = world.shootables;
    const hitMeshes = [];
    for (const actor of actors) {
      if (!actor.alive || actor === shooter) continue;
      for (const mesh of actor.hitMeshes) hitMeshes.push(mesh);
    }
    const hits = raycaster.intersectObjects(targets.concat(hitMeshes), false);
    const end = tmpOrigin.clone().addScaledVector(tmpDir, def.range);
    if (hits.length === 0) {
      spawnTracer(origin, end);
      return 0;
    }
    const hit = hits[0];
    spawnTracer(origin, hit.point);
    const mesh = hit.object;
    if (mesh.userData.actor) {
      const victim = mesh.userData.actor;
      const part = mesh.userData.part || 'body';
      const distance = hit.distance;
      const falloff = distance <= def.falloff ? 1 : Math.max(0.4, 1 - ((distance - def.falloff) / (def.range - def.falloff)) * 0.6);
      let damage = def.damage * falloff;
      if (part === 'head') damage *= def.headMult;
      damage = Math.round(damage);
      spawnPuff(hit.point, hit.face ? hit.face.normal : tmpDir, '#c23b2e');
      onHit(victim, damage, part);
      return damage;
    }
    spawnPuff(hit.point, hit.face ? hit.face.normal : tmpDir, PALETTE.sand);
    if (onSurface) onSurface(hit.point);
    return 0;
  }

  function throwGrenade(origin, velocity, owner) {
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.position.copy(origin);
    mesh.castShadow = true;
    scene.add(mesh);
    grenades.push({ mesh, velocity: velocity.clone(), fuse: GRENADE.fuse, owner });
  }

  const probe = new THREE.Box3();
  function step(dt, actors, onDamage, onExplode) {
    explosionFlash = Math.max(0, explosionFlash - dt * 3);
    explosionLight.intensity = explosionFlash * 60;
    for (const tracer of tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.life / 0.09) * 0.85;
      if (tracer.life <= 0) tracer.line.visible = false;
    }
    for (const puff of puffs) {
      if (puff.life <= 0) continue;
      puff.life -= dt;
      puff.velocity.y -= 6 * dt;
      puff.mesh.position.addScaledVector(puff.velocity, dt);
      puff.mesh.material.opacity = Math.max(0, puff.life / 0.5) * 0.9;
      puff.mesh.scale.setScalar(Math.max(0.2, puff.life * 2));
      if (puff.life <= 0) puff.mesh.visible = false;
    }
    for (let i = grenades.length - 1; i >= 0; i--) {
      const grenade = grenades[i];
      grenade.fuse -= dt;
      grenade.velocity.y -= 16 * dt;
      grenade.mesh.position.addScaledVector(grenade.velocity, dt);
      const p = grenade.mesh.position;
      if (p.y < 0.09) {
        p.y = 0.09;
        grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.45;
        grenade.velocity.x *= 0.7;
        grenade.velocity.z *= 0.7;
      }
      probe.min.set(p.x - 0.1, p.y - 0.1, p.z - 0.1);
      probe.max.set(p.x + 0.1, p.y + 0.1, p.z + 0.1);
      for (const collider of world.colliders) {
        if (!probe.intersectsBox(collider)) continue;
        const dx = Math.min(Math.abs(p.x - collider.min.x), Math.abs(p.x - collider.max.x));
        const dz = Math.min(Math.abs(p.z - collider.min.z), Math.abs(p.z - collider.max.z));
        if (dx < dz) grenade.velocity.x *= -0.5;
        else grenade.velocity.z *= -0.5;
        break;
      }
      if (grenade.fuse <= 0) {
        scene.remove(grenade.mesh);
        grenades.splice(i, 1);
        explosionFlash = 1;
        explosionLight.position.copy(p);
        spawnPuff(p, new THREE.Vector3(0, 1, 0), '#ff9a3d');
        spawnPuff(p, new THREE.Vector3(0, 1, 0), '#ffd27a');
        for (const actor of actors) {
          if (!actor.alive) continue;
          const distance = actor.position.distanceTo(p);
          if (distance > GRENADE.radius) continue;
          const damage = Math.round(GRENADE.damage * (1 - (distance / GRENADE.radius) * 0.7));
          onDamage(actor, damage, grenade.owner, 'blast');
        }
        if (onExplode) onExplode(p);
      }
    }
  }

  function updatePlayerProxy(actor) {
    proxyBody.userData.actor = actor;
    proxyHead.userData.actor = actor;
    const crouch = actor.crouching;
    proxyBody.position.set(actor.position.x, actor.position.y + (crouch ? 0.55 : 0.95), actor.position.z);
    proxyHead.position.set(actor.position.x, actor.position.y + (crouch ? 1.0 : 1.55), actor.position.z);
  }

  function clearGrenades() {
    for (const grenade of grenades) scene.remove(grenade.mesh);
    grenades.length = 0;
  }

  return { shootFrom, throwGrenade, step, updatePlayerProxy, clearGrenades };
}
