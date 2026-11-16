// The bots: boxy figures in team colours, and the AI that plays them. Each bot
// walks a waypoint path (breadth-first over the map's graph), holds a position,
// or fights: it checks line of sight on a stagger, waits out a reaction delay,
// then fires bursts with distance-based aim error. Bots hear gunshots and
// investigate, attackers carry and plant the charge, defenders defuse it.
import * as THREE from 'three';
import { createActor } from './actor.js';
import { WEAPONS } from './weapons.js';
import { PALETTE } from './palette.js';
import { angleDelta, yawTo, clamp } from './util.js';

const BOT_NAMES = {
  vanguard: ['Rook', 'Fable', 'Wren'],
  sentinel: ['Ash', 'Kite', 'Moss', 'Vale'],
};

function buildFigure(scene, team) {
  const color = team === 'vanguard' ? PALETTE.vanguard : PALETTE.sentinel;
  const teamMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.7, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b2620'), roughness: 0.85, metalness: 0.05 });
  const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#8a6f52'), roughness: 0.8, metalness: 0 });

  const group = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.72, 0.32), teamMat);
  torso.position.y = 1.02;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.38, 0.36), skinMat);
  head.position.y = 1.58;
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.42), teamMat);
  helmet.position.y = 1.78;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.68, 0.24), darkMat);
  legL.position.set(-0.15, 0.34, 0);
  const legR = legL.clone();
  legR.position.x = 0.15;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.62), darkMat);
  gun.position.set(0.2, 1.15, -0.35);
  for (const mesh of [torso, head, helmet, legL, legR, gun]) {
    mesh.castShadow = true;
    group.add(mesh);
  }
  scene.add(group);
  return { group, torso, head, helmet, legL, legR };
}

export function createBots(scene, world) {
  const bots = [];
  const raycaster = new THREE.Raycaster();
  raycaster.far = 120;
  const tmpEye = new THREE.Vector3();
  const tmpTarget = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  function addBot(team, spawn, index) {
    const actorApi = createActor(world.colliders, {
      name: BOT_NAMES[team][index],
      team,
      x: spawn.x,
      z: spawn.z,
      yaw: spawn.yaw,
      walkSpeed: 4.4,
    });
    const actor = actorApi.state;
    const figure = buildFigure(scene, team);
    figure.torso.userData.actor = actor;
    figure.torso.userData.part = 'body';
    figure.head.userData.actor = actor;
    figure.head.userData.part = 'head';
    figure.helmet.userData.actor = actor;
    figure.helmet.userData.part = 'head';
    actor.hitMeshes = [figure.torso, figure.head, figure.helmet];
    actor.figure = figure;
    const weaponId = team === 'sentinel' && index === 3 ? 'lw50' : index === 1 ? 'vk9' : 'ar77';
    const bot = {
      api: actorApi,
      actor,
      figure,
      weapon: WEAPONS[weaponId],
      mode: 'advance',
      destination: -1,
      path: [],
      holdNode: -1,
      holdUntil: 0,
      target: null,
      reaction: 0,
      scanTimer: Math.random() * 0.15,
      fireTimer: 0,
      burstLeft: 0,
      burstPause: 0,
      walkPhase: 0,
      stuckTimer: 0,
      investigateUntil: 0,
      lastX: spawn.x,
      lastZ: spawn.z,
      sidestep: 0,
      plantProgress: 0,
      defuseProgress: 0,
      skill: 0.75 + Math.random() * 0.5,
    };
    bots.push(bot);
    return bot;
  }

  function setDestination(bot, nodeIndex) {
    const from = world.nearestNode(bot.actor.position.x, bot.actor.position.z);
    bot.destination = nodeIndex;
    bot.path = world.findPath(from, nodeIndex);
    bot.mode = 'advance';
  }

  function hasLineOfSight(fromActor, toActor) {
    tmpEye.set(fromActor.position.x, fromActor.position.y + 1.5, fromActor.position.z);
    tmpTarget.set(toActor.position.x, toActor.position.y + 1.2, toActor.position.z);
    tmpDir.subVectors(tmpTarget, tmpEye);
    const distance = tmpDir.length();
    tmpDir.normalize();
    raycaster.set(tmpEye, tmpDir);
    raycaster.far = distance;
    const hits = raycaster.intersectObjects(world.shootables, false);
    return hits.length === 0;
  }

  function scanForEnemies(bot, actors) {
    let best = null;
    let bestD = Infinity;
    for (const other of actors) {
      if (!other.alive || other.team === bot.actor.team) continue;
      const d = bot.actor.position.distanceToSquared(other.position);
      if (d > 60 * 60 || d > bestD) continue;
      if (!hasLineOfSight(bot.actor, other)) continue;
      best = other;
      bestD = d;
    }
    return best;
  }

  function fireAt(bot, ctx) {
    const target = bot.target;
    if (!target || !target.alive) return;
    const distance = bot.actor.position.distanceTo(target.position);
    const error = (0.006 + distance * 0.00045) / bot.skill;
    tmpEye.set(bot.actor.position.x, bot.actor.position.y + 1.5, bot.actor.position.z);
    tmpTarget.set(target.position.x, target.position.y + 1.15, target.position.z);
    tmpDir.subVectors(tmpTarget, tmpEye).normalize();
    tmpDir.x += (ctx.random() * 2 - 1) * error;
    tmpDir.y += (ctx.random() * 2 - 1) * error * 0.7;
    tmpDir.z += (ctx.random() * 2 - 1) * error;
    tmpDir.normalize();
    ctx.combat.shootFrom(tmpEye, tmpDir, bot.actor, bot.weapon, ctx.actors, (victim, damage, part) => {
      ctx.damage(victim, damage, bot.actor, part);
    });
    ctx.noise(bot.actor.position.x, bot.actor.position.z, bot.actor);
    if (ctx.onBotShot) ctx.onBotShot(bot.actor, distance);
  }

  function update(bot, dt, ctx) {
    const actor = bot.actor;
    if (!actor.alive) return;
    const wish = { x: 0, z: 0 };
    bot.scanTimer -= dt;
    if (bot.scanTimer <= 0) {
      bot.scanTimer = 0.12;
      const seen = scanForEnemies(bot, ctx.actors);
      if (seen && bot.target !== seen) {
        bot.target = seen;
        bot.reaction = (0.35 + ctx.random() * 0.4) / bot.skill;
        if (ctx.spot) ctx.spot(seen);
      } else if (!seen) {
        bot.target = null;
      }
    }

    // Fight if there is a target in sight.
    if (bot.target && bot.target.alive) {
      const targetYaw = yawTo(actor.position.x, actor.position.z, bot.target.position.x, bot.target.position.z);
      actor.yaw += angleDelta(actor.yaw, targetYaw) * Math.min(1, dt * 10);
      bot.reaction -= dt;
      if (bot.reaction <= 0) {
        if (bot.burstLeft <= 0) {
          if (bot.burstPause <= 0) {
            bot.burstLeft = 3 + ((ctx.random() * 3) | 0);
            bot.burstPause = 0.5 + ctx.random() * 0.5;
          } else {
            bot.burstPause -= dt;
          }
        }
        bot.fireTimer -= dt;
        if (bot.burstLeft > 0 && bot.fireTimer <= 0) {
          bot.fireTimer = 60 / bot.weapon.rpm;
          bot.burstLeft -= 1;
          fireAt(bot, ctx);
        }
      }
      // Strafe a little while fighting so bots are not statues.
      if (ctx.random() < dt * 0.5) bot.sidestep = (ctx.random() * 2 - 1) * 0.6;
      const strafe = bot.sidestep;
      wish.x = Math.cos(actor.yaw) * strafe;
      wish.z = -Math.sin(actor.yaw) * strafe;
      bot.api.step(dt, wish, false, false);
      syncFigure(bot, dt);
      return;
    }

    // No enemy: play the objective.
    const bomb = ctx.bomb;

    // Hear gunfire: a fresh nearby shot pulls a bot off its post to look,
    // throttled so bots don't chase every crack. The carrier and the bomb
    // guard stay on the objective.
    if (ctx.noises.length > 0 && bot.investigateUntil < ctx.time && bomb.carrier !== actor && !bomb.planted) {
      const noise = ctx.noises[ctx.noises.length - 1];
      const nd = Math.hypot(noise.x - actor.position.x, noise.z - actor.position.z);
      if (noise.source.team !== actor.team && nd < 28 && nd > 4) {
        bot.investigateUntil = ctx.time + 8;
        setDestination(bot, world.nearestNode(noise.x, noise.z));
      }
    }

    if (actor.team === 'vanguard') {
      if (bomb.planted) {
        // Guard the planted charge from a hold near its site.
        if (bot.holdNode < 0 || bot.mode !== 'hold') {
          const site = bomb.site;
          bot.holdNode = site.id === 'A' ? 14 : 15;
          setDestination(bot, bot.holdNode);
        }
      } else if (bomb.carrier === actor) {
        // Carry the charge to the assigned site and plant it.
        const siteNode = bot.holdNode === 17 ? 17 : 16;
        const site = world.sites[siteNode === 16 ? 0 : 1];
        const dx = site.x - actor.position.x;
        const dz = site.z - actor.position.z;
        if (Math.hypot(dx, dz) < site.radius - 0.5) {
          bot.plantProgress += dt;
          actor.yaw += dt * 0.4;
          if (bot.plantProgress >= 3) {
            bot.plantProgress = 0;
            ctx.onPlant(site, actor);
          }
          bot.api.step(dt, wish, false, false);
          syncFigure(bot, dt);
          return;
        }
        if (bot.destination !== siteNode) setDestination(bot, siteNode);
      } else if (bomb.carrier === null && bomb.dropped) {
        // The charge is on the ground: go and pick it up.
        const dx = bomb.x - actor.position.x;
        const dz = bomb.z - actor.position.z;
        if (Math.hypot(dx, dz) < 1.4) {
          ctx.onPickup(actor);
        } else {
          moveToward(bot, bomb.x, bomb.z, dt, ctx);
          syncFigure(bot, dt);
          return;
        }
      } else if (bot.mode !== 'advance' || bot.path.length === 0) {
        // Push the assigned site with the team.
        const siteNode = bot.holdNode === 17 ? 17 : 16;
        if (bot.destination !== siteNode) setDestination(bot, siteNode);
      }
    } else {
      if (bomb.planted) {
        const dx = bomb.x - actor.position.x;
        const dz = bomb.z - actor.position.z;
        if (Math.hypot(dx, dz) < 1.6) {
          bot.defuseProgress += dt;
          if (bot.defuseProgress >= 5) {
            bot.defuseProgress = 0;
            ctx.onDefuse(actor);
          }
          bot.api.step(dt, wish, false, false);
          syncFigure(bot, dt);
          return;
        }
        moveToward(bot, bomb.x, bomb.z, dt, ctx);
        syncFigure(bot, dt);
        return;
      }
      if (bot.mode !== 'hold' && bot.holdNode >= 0 && bot.investigateUntil < ctx.time) {
        if (bot.destination !== bot.holdNode) setDestination(bot, bot.holdNode);
      }
      if (bot.mode === 'hold') {
        // Hold the angle: slow sweeps across the approach.
        actor.yaw += Math.sin(ctx.time * 0.4 + bot.actor.name.length) * dt * 0.35;
        bot.api.step(dt, wish, false, false);
        syncFigure(bot, dt);
        return;
      }
    }

    // Follow the waypoint path.
    if (bot.path.length > 0) {
      const node = world.nodes[bot.path[0]];
      const dx = node.x - actor.position.x;
      const dz = node.z - actor.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.9) {
        bot.path.shift();
        if (bot.path.length === 0 && actor.team === 'sentinel') bot.mode = 'hold';
      } else {
        wish.x = dx / distance;
        wish.z = dz / distance;
        const targetYaw = yawTo(actor.position.x, actor.position.z, node.x, node.z);
        actor.yaw += angleDelta(actor.yaw, targetYaw) * Math.min(1, dt * 8);
      }
      // Unstuck: no progress for a while means a sidestep.
      bot.stuckTimer += dt;
      if (bot.stuckTimer > 1.2) {
        const moved = Math.hypot(actor.position.x - bot.lastX, actor.position.z - bot.lastZ);
        bot.lastX = actor.position.x;
        bot.lastZ = actor.position.z;
        bot.stuckTimer = 0;
        if (moved < 0.25 && bot.path.length > 0) {
          bot.path.shift();
          wish.x = -wish.z;
          wish.z = wish.x;
        }
      }
    } else if (actor.team === 'vanguard' && bomb.carrier === actor) {
      // At the site already: the plant branch above handles it.
    }
    bot.api.step(dt, wish, false, false);
    syncFigure(bot, dt);
  }

  function moveToward(bot, x, z, dt, ctx) {
    const actor = bot.actor;
    const dx = x - actor.position.x;
    const dz = z - actor.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.5) {
      bot.api.step(dt, { x: 0, z: 0 }, false, false);
      return;
    }
    const targetYaw = yawTo(actor.position.x, actor.position.z, x, z);
    actor.yaw += angleDelta(actor.yaw, targetYaw) * Math.min(1, dt * 8);
    bot.api.step(dt, { x: dx / distance, z: dz / distance }, false, false);
  }

  function syncFigure(bot, dt) {
    const actor = bot.actor;
    const figure = bot.figure;
    figure.group.position.set(actor.position.x, actor.position.y, actor.position.z);
    figure.group.rotation.y = actor.yaw;
    if (!actor.alive) return;
    const speed = Math.hypot(actor.velocity.x, actor.velocity.z);
    bot.walkPhase += dt * (4 + speed * 1.6);
    const swing = speed > 0.5 ? Math.sin(bot.walkPhase) * 0.55 : 0;
    figure.legL.rotation.x = swing;
    figure.legR.rotation.x = -swing;
    figure.group.position.y = actor.position.y + (speed > 0.5 ? Math.abs(Math.sin(bot.walkPhase)) * 0.04 : 0);
  }

  function kill(bot) {
    const figure = bot.figure;
    figure.group.rotation.x = -Math.PI / 2;
    figure.group.position.y = 0.25;
    figure.legL.rotation.x = 0;
    figure.legR.rotation.x = 0;
  }

  function reset(bot, spawn, assignment) {
    bot.api.reset(spawn.x, spawn.z, spawn.yaw);
    bot.figure.group.rotation.set(0, spawn.yaw, 0);
    bot.figure.group.position.set(spawn.x, 0, spawn.z);
    bot.mode = 'advance';
    bot.destination = -1;
    bot.path = [];
    bot.target = null;
    bot.reaction = 0;
    bot.burstLeft = 0;
    bot.burstPause = 0;
    bot.plantProgress = 0;
    bot.defuseProgress = 0;
    bot.investigateUntil = 0;
    bot.holdNode = assignment;
    bot.stuckTimer = 0;
    bot.walkPhase = 0;
    syncFigure(bot, 0);
  }

  return {
    list: bots,
    addBot,
    update,
    kill,
    reset,
    setDestination,
  };
}
