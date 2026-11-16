// The match: one state object for the whole game. Phases run menu → buy → live
// → roundEnd, first to 5 rounds takes the match. It owns the money, the bomb,
// the kills and the round timer, and it drives the player, the bots and the HUD
// from a single step(). Nothing else keeps game state.
import * as THREE from 'three';
import { WEAPONS, GRENADE } from './weapons.js';

const BUY_TIME = 15;
const ROUND_TIME = 100;
const FUSE_TIME = 35;
const PLANT_TIME = 3;
const DEFUSE_TIME = 5;
const ROUNDS_TO_WIN = 5;
const MAX_ROUNDS = 9;
const START_MONEY = 800;
const WIN_BONUS = 3250;
const LOSS_BONUS = 1400;
const LOSS_STREAK_BONUS = 500;
const KILL_BONUS = 300;

export function createGame(ctx) {
  const { world, combat, audio, hud, bots: botsApi, playerApi, rig, camera, random } = ctx;
  const player = playerApi.state;

  // The charge itself: a small device with a blinking light, carried, dropped or planted.
  const bombMesh = new THREE.Group();
  const bombBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.2, 0.26),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b2620'), roughness: 0.5, metalness: 0.5 }),
  );
  const bombLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a1a') }),
  );
  bombLight.position.set(0.1, 0.13, 0);
  bombMesh.add(bombBody, bombLight);
  bombMesh.visible = false;
  ctx.scene.add(bombMesh);

  const state = {
    phase: 'menu',
    round: 1,
    scores: { vanguard: 0, sentinel: 0 },
    lossStreak: { vanguard: 0, sentinel: 0 },
    phaseTime: 0,
    roundTime: ROUND_TIME,
    money: new Map(),
    kills: new Map(),
    deaths: new Map(),
    bomb: {
      carrier: null, planted: false, dropped: false,
      site: null, x: 0, z: 0, fuse: FUSE_TIME,
      plantProgress: 0, defuseProgress: 0,
    },
    noises: [],
    spotted: new Map(),
    time: 0,
    beepTimer: 0,
    roundWinner: null,
    roundReason: '',
  };

  const actors = () => [player, ...botsApi.list.map((b) => b.actor)];
  const botsOf = (team) => botsApi.list.filter((b) => b.actor.team === team);

  function moneyOf(actor) {
    return state.money.get(actor) ?? START_MONEY;
  }
  function setMoney(actor, value) {
    state.money.set(actor, Math.max(0, Math.min(16000, value)));
  }

  function botContext() {
    return {
      actors: actors(),
      combat,
      random,
      time: state.time,
      bomb: state.bomb,
      damage: (victim, amount, attacker, part) => damage(victim, amount, attacker, part),
      noise: (x, z, source) => state.noises.push({ x, z, time: state.time, source }),
      noises: state.noises,
      spot: (actor) => state.spotted.set(actor, state.time + 3),
      onPlant: (site, actor) => plantBomb(site, actor),
      onDefuse: (actor) => defuseBomb(actor),
      onPickup: (actor) => pickupBomb(actor),
      onBotShot: (actor, distance) => {
        if (distance < 45) audio.shootFar();
      },
    };
  }

  function resetRound() {
    // Everyone back to spawn, healed, weapons kept (death costs the guns).
    for (const bot of botsApi.list) {
      const spawns = world.spawns[bot.actor.team];
      const index = botsOf(bot.actor.team).indexOf(bot);
      const spawn = spawns[(index + 1) % spawns.length];
      const assignment = bot.actor.team === 'vanguard'
        ? (index % 2 === 0 ? 16 : 17)
        : world.holds[index % world.holds.length];
      botsApi.reset(bot, spawn, assignment);
      // Bots spend their money: a rifle when they can afford it, kevlar too.
      const money = moneyOf(bot.actor);
      if (money >= WEAPONS.ar77.price && bot.weapon.id === 'vk9') {
        bot.weapon = WEAPONS.ar77;
        setMoney(bot.actor, money - WEAPONS.ar77.price);
      }
      if (moneyOf(bot.actor) >= 650 && bot.actor.armor === 0) {
        bot.actor.armor = 50;
        setMoney(bot.actor, moneyOf(bot.actor) - 650);
      }
    }
    const spawn = world.spawns.vanguard[0];
    playerApi.reset(spawn.x, spawn.z, spawn.yaw);
    if (!player.alive) player.alive = true;
    rig.refill();
    combat.clearGrenades();
    state.bomb.carrier = player;
    state.bomb.planted = false;
    state.bomb.dropped = false;
    state.bomb.site = null;
    state.bomb.fuse = FUSE_TIME;
    state.bomb.plantProgress = 0;
    state.bomb.defuseProgress = 0;
    state.noises.length = 0;
    state.spotted.clear();
    state.roundTime = ROUND_TIME;
    state.phaseTime = BUY_TIME;
    state.phase = 'buy';
    bombMesh.visible = false;
    hud.clearBomb();
    hud.banner(`ROUND ${state.round}`, 'Buy your gear — the round starts when the timer ends', 'vanguard');
    hud.showBuyMenu(moneyOf(player), rig.state.owned, rig.state.grenades);
    syncHud();
  }

  function startMatch() {
    state.scores.vanguard = 0;
    state.scores.sentinel = 0;
    state.lossStreak.vanguard = 0;
    state.lossStreak.sentinel = 0;
    state.round = 1;
    for (const actor of actors()) {
      setMoney(actor, START_MONEY);
      state.kills.set(actor, 0);
      state.deaths.set(actor, 0);
    }
    rig.reset();
    resetRound();
  }

  function plantBomb(site, actor) {
    state.bomb.planted = true;
    state.bomb.dropped = false;
    state.bomb.carrier = null;
    state.bomb.site = site;
    state.bomb.x = site.x;
    state.bomb.z = site.z;
    state.bomb.fuse = FUSE_TIME;
    state.beepTimer = 0;
    bombMesh.visible = true;
    bombMesh.position.set(site.x, 0.12, site.z);
    audio.plant();
    hud.message(`Charge planted at Site ${site.id} — Sentinel must defuse it`, 3600);
    hud.banner('CHARGE PLANTED', `Site ${site.id} — ${FUSE_TIME} seconds to detonation`, 'vanguard');
  }

  function defuseBomb(actor) {
    state.bomb.planted = false;
    bombMesh.visible = false;
    audio.defuse();
    endRound('sentinel', `${actor.name} defused the charge`);
  }

  function pickupBomb(actor) {
    state.bomb.carrier = actor;
    state.bomb.dropped = false;
    bombMesh.visible = false;
    if (actor.isPlayer) hud.message('You picked up the charge — plant it at A or B', 3000);
  }

  function dropBomb(actor) {
    if (state.bomb.carrier !== actor) return;
    state.bomb.carrier = null;
    state.bomb.dropped = true;
    state.bomb.x = actor.position.x;
    state.bomb.z = actor.position.z;
    bombMesh.visible = true;
    bombMesh.position.set(state.bomb.x, 0.12, state.bomb.z);
  }

  function damage(victim, amount, attacker, part) {
    if (!victim.alive || state.phase !== 'live') return;
    let remaining = amount;
    if (victim.armor > 0) {
      const absorbed = Math.min(victim.armor, Math.ceil(remaining / 2));
      victim.armor -= absorbed;
      remaining -= absorbed;
    }
    victim.health -= remaining;
    victim.lastAttacker = attacker;
    if (attacker && attacker.team !== victim.team) state.spotted.set(victim, state.time + 3);
    if (victim.isPlayer) hud.damageFlash();
    if (attacker && attacker.isPlayer) {
      hud.hitmarker(victim.health <= 0);
      if (victim.health <= 0) audio.kill();
      else audio.hit();
    }
    if (victim.health > 0) return;
    victim.health = 0;
    victim.alive = false;
    state.deaths.set(victim, (state.deaths.get(victim) ?? 0) + 1);
    if (attacker && attacker !== victim) {
      state.kills.set(attacker, (state.kills.get(attacker) ?? 0) + 1);
      setMoney(attacker, moneyOf(attacker) + KILL_BONUS);
      hud.killfeed(attacker.name, victim.name, attacker.team, part === 'head');
    } else {
      hud.killfeed('—', victim.name, victim.team === 'vanguard' ? 'sentinel' : 'vanguard', false);
    }
    const bot = botsApi.list.find((b) => b.actor === victim);
    if (bot) botsApi.kill(bot);
    if (victim.isPlayer) {
      hud.message('You are down — your team fights on', 3000);
      rig.state.reloadLeft = 0;
    }
    dropBomb(victim);
    checkElimination();
  }

  function checkElimination() {
    if (state.phase !== 'live') return;
    const vanguardAlive = actors().some((a) => a.team === 'vanguard' && a.alive);
    const sentinelAlive = actors().some((a) => a.team === 'sentinel' && a.alive);
    // With the charge planted, elimination alone decides nothing: the fuse or
    // the defuse decides the round, even if one side is already wiped out.
    if (!vanguardAlive && !state.bomb.planted) endRound('sentinel', 'Vanguard eliminated');
    else if (!sentinelAlive && !state.bomb.planted) endRound('vanguard', 'Sentinel eliminated');
  }

  function endRound(winner, reason) {
    if (state.phase !== 'live') return;
    state.phase = 'roundEnd';
    state.phaseTime = 4;
    state.roundWinner = winner;
    state.roundReason = reason;
    state.scores[winner] += 1;
    const loser = winner === 'vanguard' ? 'sentinel' : 'vanguard';
    state.lossStreak[winner] = 0;
    state.lossStreak[loser] += 1;
    for (const actor of actors()) {
      if (actor.team === winner) setMoney(actor, moneyOf(actor) + WIN_BONUS);
      else setMoney(actor, moneyOf(actor) + LOSS_BONUS + Math.min(2000, (state.lossStreak[loser] - 1) * LOSS_STREAK_BONUS));
    }
    // The dead lose their guns; the living keep theirs.
    if (!player.alive) rig.reset();
    hud.clearBomb();
    hud.hideBuyMenu();
    const playerWon = winner === 'vanguard';
    if (playerWon) audio.roundWin();
    else audio.roundLose();
    hud.banner(
      playerWon ? 'ROUND WON' : 'ROUND LOST',
      `${winner === 'vanguard' ? 'Vanguard' : 'Sentinel'} takes the round — ${reason}`,
      winner,
    );
    syncHud();
  }

  function buy(itemId) {
    if (state.phase !== 'buy') return;
    const money = moneyOf(player);
    if (itemId === 'frag') {
      if (money < GRENADE.price || rig.state.grenades >= 2) { audio.denied(); return; }
      setMoney(player, money - GRENADE.price);
      rig.state.grenades += 1;
    } else if (itemId === 'kevlar') {
      if (money < 650 || player.armor >= 50) { audio.denied(); return; }
      setMoney(player, money - 650);
      player.armor = 50;
    } else {
      const def = WEAPONS[itemId];
      if (!def || money < def.price || rig.state.owned[itemId]) { audio.denied(); return; }
      setMoney(player, money - def.price);
      rig.buy(itemId);
    }
    audio.buy();
    hud.updateBuyMenu(moneyOf(player), rig.state.owned, rig.state.grenades);
    syncHud();
  }

  const wish = new THREE.Vector3();
  const aimDir = new THREE.Vector3();
  const throwDir = new THREE.Vector3();

  // The player's movement from the held keys, shared by the buy and live phases.
  function movePlayer(dt, keys) {
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }
    playerApi.step(dt, wish, keys.has('Space'), keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC'));
  }

  function playerShoot() {
    if (!rig.ready()) {
      if (rig.state.owned[rig.state.current].mag === 0 && rig.state.cooldown === 0) {
        audio.dryFire();
        rig.state.cooldown = 0.3;
      }
      return;
    }
    const def = rig.currentDef();
    rig.takeRound();
    rig.pullTrigger();
    camera.getWorldDirection(aimDir);
    const spread = rig.spread(playerApi.groundSpeed(), !player.onGround, player.crouching);
    aimDir.x += (random() * 2 - 1) * spread;
    aimDir.y += (random() * 2 - 1) * spread;
    aimDir.z += (random() * 2 - 1) * spread;
    aimDir.normalize();
    combat.shootFrom(camera.position, aimDir, player, def, actors(), (victim, amount, part) => {
      damage(victim, amount, player, part);
    });
    playerApi.recoil(def.recoil * (0.9 + random() * 0.3), (random() * 2 - 1) * def.recoil * 0.4);
    state.noises.push({ x: player.position.x, z: player.position.z, time: state.time, source: player });
    audio.shoot(def.sound);
    syncHud();
  }

  function playerThrowGrenade() {
    if (rig.state.grenades <= 0) return;
    rig.state.grenades -= 1;
    camera.getWorldDirection(throwDir);
    const origin = camera.position.clone().addScaledVector(throwDir, 0.6);
    origin.y -= 0.1;
    const velocity = throwDir.clone().multiplyScalar(13);
    velocity.y += 3.5;
    combat.throwGrenade(origin, velocity, player);
    syncHud();
  }

  function syncHud() {
    hud.setHealth(player.health, player.armor);
    const owned = rig.state.owned[rig.state.current];
    hud.setAmmo(owned.mag, owned.reserve, rig.currentDef().name, rig.state.grenades);
    hud.setMoney(moneyOf(player));
    hud.setScores(state.scores.vanguard, state.scores.sentinel, state.round);
    if (state.phase === 'buy') hud.setTimer(state.phaseTime, false);
    else if (state.phase === 'live') hud.setTimer(state.roundTime, true);
    else hud.setTimer(0);
    const spread = rig.spread(playerApi.groundSpeed(), !player.onGround, player.crouching);
    hud.setCrosshairSpread(4 + spread * 260);
  }

  function step(dt, input) {
    state.time += dt;
    // Old noises fade; bots only chase fresh sound.
    while (state.noises.length > 0 && state.time - state.noises[0].time > 4) state.noises.shift();
    for (const [actor, until] of state.spotted) {
      if (until < state.time) state.spotted.delete(actor);
    }

    if (state.phase === 'buy') {
      state.phaseTime -= dt;
      if (input.pressed('KeyB')) {
        if (hud.buyMenuOpen()) hud.hideBuyMenu();
        else hud.showBuyMenu(moneyOf(player), rig.state.owned, rig.state.grenades);
      }
      if (input.pressed('Digit1')) buy('vk9');
      if (input.pressed('Digit2')) buy('ar77');
      if (input.pressed('Digit3')) buy('lw50');
      if (input.pressed('Digit4')) buy('frag');
      if (input.pressed('Digit5')) buy('kevlar');
      // Players can reposition (and reload) during the buy phase.
      movePlayer(dt, input.state.keys);
      rig.step(dt);
      if (state.phaseTime <= 0) {
        state.phase = 'live';
        hud.hideBuyMenu();
        hud.message('Round live — plant the charge at A or B', 3000);
      }
      syncHud();
      return;
    }

    if (state.phase === 'roundEnd') {
      state.phaseTime -= dt;
      if (state.phaseTime <= 0) {
        if (state.scores.vanguard >= ROUNDS_TO_WIN || state.scores.sentinel >= ROUNDS_TO_WIN || state.round >= MAX_ROUNDS) {
          state.phase = 'matchEnd';
          const won = state.scores.vanguard > state.scores.sentinel;
          ctx.onMatchEnd(won);
        } else {
          state.round += 1;
          resetRound();
        }
      }
      syncHud();
      return;
    }

    if (state.phase !== 'live') {
      syncHud();
      return;
    }

    state.roundTime -= dt;
    if (state.roundTime <= 0 && !state.bomb.planted) {
      endRound('sentinel', 'Time expired — Sentinel holds the outpost');
      return;
    }

    // The planted charge ticks down and beeps faster as it nears zero.
    if (state.bomb.planted) {
      state.bomb.fuse -= dt;
      state.beepTimer -= dt;
      const interval = state.bomb.fuse > 20 ? 1.0 : state.bomb.fuse > 10 ? 0.5 : 0.25;
      if (state.beepTimer <= 0) {
        state.beepTimer = interval;
        audio.beep();
      }
      bombLight.material.color.setHex(Math.sin(state.time * 10) > 0 ? 0xff2a1a : 0x550000);
      hud.setBomb(state.bomb.site.id, state.bomb.fuse / FUSE_TIME);
      if (state.bomb.fuse <= 0) {
        bombMesh.visible = false;
        audio.explode();
        endRound('vanguard', 'The charge detonated');
        return;
      }
    }

    // Player actions.
    const keys = input.state.keys;
    if (player.alive) {
      movePlayer(dt, keys);
      if (input.state.firing) playerShoot();
      if (input.pressed('KeyR') && rig.reload()) audio.reload();
      if (input.pressed('Digit1')) rig.switchTo('ar77') || rig.switchTo('vk9') || rig.switchTo('lw50');
      if (input.pressed('Digit2')) rig.switchTo('p9');
      if (input.pressed('KeyG')) playerThrowGrenade();
      if (input.pressed('KeyM')) {
        audio.setMuted(!audio.isMuted());
        hud.message(audio.isMuted() ? 'Sound muted' : 'Sound on', 1500);
      }

      // Planting: the carrier holds E inside a site.
      if (state.bomb.carrier === player && !state.bomb.planted) {
        const site = world.sites.find((s) => Math.hypot(s.x - player.position.x, s.z - player.position.z) < s.radius);
        if (site) {
          if (keys.has('KeyE')) {
            state.bomb.plantProgress += dt;
            hud.setHint(`Planting the charge… ${Math.max(0, PLANT_TIME - state.bomb.plantProgress).toFixed(1)}s`);
            if (state.bomb.plantProgress >= PLANT_TIME) {
              state.bomb.plantProgress = 0;
              hud.setHint('');
              plantBomb(site, player);
            }
          } else {
            state.bomb.plantProgress = 0;
            hud.setHint('Hold E to plant the charge');
          }
        } else {
          state.bomb.plantProgress = 0;
          hud.setHint('Carry the charge to Site A or B');
        }
      } else if (state.bomb.dropped) {
        const dx = state.bomb.x - player.position.x;
        const dz = state.bomb.z - player.position.z;
        if (Math.hypot(dx, dz) < 1.4) pickupBomb(player);
        hud.setHint('The charge is down — pick it up');
      } else {
        hud.setHint('');
      }
    }

    // Bots play the round.
    const botCtx = botContext();
    for (const bot of botsApi.list) botsApi.update(bot, dt, botCtx);

    // Scoreboard while Tab is held.
    if (keys.has('Tab')) {
      hud.showScoreboard(actors().map((a) => ({
        name: a.name, team: a.team, isPlayer: a.isPlayer, alive: a.alive,
        kills: state.kills.get(a) ?? 0, deaths: state.deaths.get(a) ?? 0, money: moneyOf(a),
      })));
    } else {
      hud.hideScoreboard();
    }

    combat.step(dt, actors(), (victim, amount, attacker, part) => damage(victim, amount, attacker, part), () => {
      audio.explode();
    });
    rig.step(dt);
    syncHud();
  }

  return {
    state,
    startMatch,
    resetRound,
    step,
    buy,
    damage,
    syncHud,
    moneyOf,
    actors,
  };
}
