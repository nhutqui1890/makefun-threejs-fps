// One body for every fighter, player and bot alike: position, velocity, health,
// and axis-separated movement against the world's AABB colliders. The player
// drives it with keys, a bot drives it with a wish direction; the physics is one.
import * as THREE from 'three';
import { clamp } from './util.js';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const GRAVITY = 20;
const JUMP_SPEED = 6.4;

export function createActor(colliders, options) {
  const actor = {
    name: options.name,
    team: options.team,
    isPlayer: !!options.isPlayer,
    position: new THREE.Vector3(options.x, 0, options.z),
    velocity: new THREE.Vector3(),
    yaw: options.yaw ?? 0,
    pitch: 0,
    eye: STAND_EYE,
    height: STAND_HEIGHT,
    onGround: true,
    crouching: false,
    health: 100,
    armor: 0,
    alive: true,
    // Movement tuning: bots walk a touch slower than the player's run.
    walkSpeed: options.walkSpeed ?? 5.2,
    crouchSpeed: 2.4,
    accel: 42,
    airAccel: 9,
    friction: 9,
    // Filled in by the figure builder (bots) or the weapon rig (player).
    figure: null,
    hitMeshes: [],
    // Who this actor last took damage from, for the kill feed.
    lastAttacker: null,
    lastDamageAt: 0,
  };
  const probe = new THREE.Box3();

  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    actor.yaw -= dx * sensitivity;
    actor.pitch = clamp(actor.pitch - dy * sensitivity, -1.45, 1.45);
  }

  function recoil(pitchKick, yawKick) {
    actor.pitch = Math.min(1.45, actor.pitch + pitchKick);
    actor.yaw += yawKick;
  }

  // wish: a unit XZ direction (or zero), jump: bool, crouch: bool. dt in seconds.
  function step(dt, wish, jump, crouch) {
    if (!actor.alive) return;
    if (crouch && !actor.crouching) {
      actor.crouching = true;
      actor.height = CROUCH_HEIGHT;
    } else if (!crouch && actor.crouching && !overlaps(actor.position.x, actor.position.y, actor.position.z, STAND_HEIGHT, 0.02)) {
      actor.crouching = false;
      actor.height = STAND_HEIGHT;
    }
    const eyeTarget = actor.crouching ? CROUCH_EYE : STAND_EYE;
    actor.eye += (eyeTarget - actor.eye) * Math.min(1, dt * 12);

    const speed = actor.crouching ? actor.crouchSpeed : actor.walkSpeed;
    const blend = Math.min(1, ((actor.onGround ? actor.accel : actor.airAccel) * dt) / speed);
    actor.velocity.x += (wish.x * speed - actor.velocity.x) * blend;
    actor.velocity.z += (wish.z * speed - actor.velocity.z) * blend;
    if (actor.onGround && wish.x === 0 && wish.z === 0) {
      const damp = Math.max(0, 1 - actor.friction * dt);
      actor.velocity.x *= damp;
      actor.velocity.z *= damp;
    }
    if (jump && actor.onGround) {
      actor.velocity.y = JUMP_SPEED;
      actor.onGround = false;
    }
    actor.velocity.y -= GRAVITY * dt;

    const nextX = actor.position.x + actor.velocity.x * dt;
    if (!overlaps(nextX, actor.position.y, actor.position.z, actor.height, 0.04)) actor.position.x = nextX;
    else actor.velocity.x = 0;
    const nextZ = actor.position.z + actor.velocity.z * dt;
    if (!overlaps(actor.position.x, actor.position.y, nextZ, actor.height, 0.04)) actor.position.z = nextZ;
    else actor.velocity.z = 0;

    actor.position.y += actor.velocity.y * dt;
    actor.onGround = false;
    const hit = overlaps(actor.position.x, actor.position.y, actor.position.z, actor.height, 0);
    if (hit && actor.velocity.y <= 0) {
      actor.position.y = hit.max.y;
      actor.velocity.y = 0;
      actor.onGround = true;
    } else if (hit) {
      actor.position.y = hit.min.y - actor.height;
      actor.velocity.y = 0;
    }
    if (actor.position.y < 0) {
      actor.position.y = 0;
      actor.velocity.y = 0;
      actor.onGround = true;
    }
    actor.velocity.y = Math.max(-30, actor.velocity.y);
  }

  function eyePosition(out) {
    return out.set(actor.position.x, actor.position.y + actor.eye, actor.position.z);
  }

  function groundSpeed() {
    return Math.hypot(actor.velocity.x, actor.velocity.z);
  }

  function reset(x, z, yaw) {
    actor.position.set(x, 0, z);
    actor.velocity.set(0, 0, 0);
    actor.yaw = yaw;
    actor.pitch = 0;
    actor.health = 100;
    actor.armor = 0;
    actor.alive = true;
    actor.crouching = false;
    actor.height = STAND_HEIGHT;
    actor.eye = STAND_EYE;
    actor.lastAttacker = null;
  }

  return { state: actor, step, look, recoil, eyePosition, groundSpeed, reset, overlaps };
}
