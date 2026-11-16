// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. The game state lives in game.js; this file wires the pieces
// together, owns the camera, and stages the deterministic screenshot frames:
// ?shot=firefight|plant|buy|score with &seed=N sets a scene up, renders it
// twice, freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './util.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createActor } from './actor.js';
import { createWeaponRig } from './weapons.js';
import { createCombat } from './combat.js';
import { createBots } from './bots.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createGame } from './game.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 42, 115);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const hud = createHud();
const playerApi = createActor(world.colliders, {
  name: 'You', team: 'vanguard', isPlayer: true, x: 27, z: -3, yaw: Math.PI / 2,
});
const player = playerApi.state;
const rig = createWeaponRig(camera);
const combat = createCombat(scene, world);
const botsApi = createBots(scene, world);
for (let i = 0; i < 3; i++) {
  const spawn = world.spawns.vanguard[i + 1];
  botsApi.addBot('vanguard', spawn, i);
}
for (let i = 0; i < 4; i++) {
  botsApi.addBot('sentinel', world.spawns.sentinel[i], i);
}

const game = createGame({
  scene, world, combat, audio, hud, bots: botsApi, playerApi, rig, camera, random,
  onMatchEnd(won) {
    input.exitLock();
    const kills = game.state.kills.get(player) ?? 0;
    const deaths = game.state.deaths.get(player) ?? 0;
    hud.showOverlay('matchEnd', {
      title: won ? 'VICTORY' : 'DEFEAT',
      copy: won
        ? `Vanguard takes the match ${game.state.scores.vanguard}–${game.state.scores.sentinel}. The outpost is yours.`
        : `Sentinel holds the outpost ${game.state.scores.sentinel}–${game.state.scores.vanguard}. Run it back.`,
      extra: `<span>You: ${kills} kills, ${deaths} deaths · ${game.state.round} rounds played</span>`,
    });
  },
});

const input = createInput(renderer.domElement, onLockChange);
const body = player;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (game.state.phase === 'menu' || game.state.phase === 'matchEnd') {
    started = true;
    game.startMatch();
  }
  input.requestLock();
});
hud.onBuy((itemId) => {
  if (game.state.phase === 'buy') game.buy(itemId);
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    hud.hideOverlay();
  } else if (game.state.phase === 'live' || game.state.phase === 'buy') {
    hud.showOverlay('paused');
  }
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(x, y, z) {
  const dx = x - body.position.x;
  const dy = y - (body.position.y + body.eye);
  const dz = z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function step(dt) {
  const look = input.takeLook();
  if (!shot) playerApi.look(look.x, look.y);
  // Raycasts test the hit boxes at their matrixWorld, and only the renderer
  // refreshes those — between renders (and in shot mode, where no render runs
  // at all during staging) the matrices go stale and shots miss fighters that
  // moved. Refresh them here so the sim is correct on its own.
  scene.updateMatrixWorld();
  game.step(dt, input);
  combat.updatePlayerProxy(player);
  syncCamera();
  // The minimap and the bomb bar follow the sim, not the render.
  const spotted = new Set();
  for (const [actor, until] of game.state.spotted) {
    if (until > game.state.time) spotted.add(actor);
  }
  hud.drawMinimap(world, game.actors(), game.state.bomb, player, spotted);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const phase = game.state.phase;
    const running = shot || input.state.locked || phase === 'menu' || phase === 'roundEnd' || phase === 'matchEnd';
    if (running) {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 5) {
        step(FIXED_STEP);
        accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (accumulator > FIXED_STEP * 5) accumulator = 0;
    }
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function placeBot(team, index, x, z, yaw) {
  const bot = botsApi.list.filter((b) => b.actor.team === team)[index];
  bot.api.reset(x, z, yaw);
  bot.holdNode = -1;
  bot.path = [];
  bot.mode = 'hold';
  return bot;
}

function runShot(name) {
  hud.hideOverlay();
  game.startMatch();
  hud.hideBuyMenu();
  if (name === 'firefight') {
    // The cover: a live round, frozen mid-burst. The player headshots the near
    // Sentinel (kill feed, red hitmarker, the body drops), then walks rounds
    // onto the second one — muzzle flash, two tracers and hit sparks all on
    // screen at once. The teammate is placed after the kill so it cannot steal
    // the headshot during the settle.
    game.state.phase = 'live';
    game.state.roundTime = 74;
    game.state.round = 4;
    game.state.scores.vanguard = 2;
    game.state.scores.sentinel = 1;
    game.state.money.set(player, 4800);
    rig.buy('ar77');
    player.armor = 50;
    rig.state.grenades = 1;
    body.position.set(16, 0, -6);
    body.yaw = Math.PI / 2;
    body.pitch = 0;
    const s0 = placeBot('sentinel', 0, 4, -8, -Math.PI / 2);
    const s1 = placeBot('sentinel', 1, -6, -12, -Math.PI / 2);
    placeBot('sentinel', 2, -10, -2, -Math.PI / 2);
    s0.actor.armor = 0;
    s1.actor.armor = 0;
    settle(24);
    aimAt(s0.actor.position.x, s0.actor.position.y + 1.58, s0.actor.position.z);
    input.state.firing = true;
    step(FIXED_STEP);
    input.state.firing = false;
    placeBot('vanguard', 0, 9, -11, Math.PI / 2);
    aimAt(s1.actor.position.x, s1.actor.position.y + 1.2, s1.actor.position.z);
    input.state.firing = true;
    settle(8);
    input.state.firing = false;
    settle(1);
    // The live hitmarker fades in 110 ms and the live kill-feed line in 6 s —
    // both can die before a software-rendered capture lands. Hold this
    // hitmarker up, and re-seed the feed with a held copy of the headshot line.
    hud.hitmarker(false, true);
    hud.clearKillfeed();
    hud.killfeed('You', 'Ash', 'vanguard', true, true);
  } else if (name === 'plant') {
    // Mid-plant at Site A: the channel is two-thirds done, the hint counts it
    // down, the site beacon and the painted A fill the frame, and two
    // Sentinels close in. The defenders are placed after the channel so they
    // cannot shoot the planter mid-charge; E stays held through the last step
    // so the progress hint survives to the freeze.
    game.state.phase = 'live';
    game.state.roundTime = 61;
    game.state.round = 2;
    game.state.scores.vanguard = 1;
    game.state.scores.sentinel = 0;
    game.state.money.set(player, 4050);
    rig.buy('ar77');
    player.armor = 50;
    body.position.set(-19.5, 0, -10.5);
    body.yaw = Math.PI / 2;
    body.pitch = 0;
    settle(24);
    input.state.keys.add('KeyE');
    settle(110);
    placeBot('sentinel', 0, -27, -15.5, -Math.PI / 2);
    placeBot('sentinel', 1, -23, -17, -Math.PI / 2);
    aimAt(-24, 1.2, -14);
    settle(1);
    input.state.keys.delete('KeyE');
  } else if (name === 'buy') {
    // The buy phase with money to spend: the rifle, kevlar and a grenade are
    // already bought (owned states show), the longshot is still out of reach.
    game.state.money.set(player, 5200);
    game.buy('ar77');
    game.buy('kevlar');
    game.buy('frag');
    body.position.set(24, 0, -6);
    body.yaw = Math.PI / 2;
    body.pitch = 0;
    settle(20);
    aimAt(-6, 1.5, -8);
    hud.showBuyMenu(game.moneyOf(player), rig.state.owned, rig.state.grenades);
  } else {
    // score: the round just ended in Vanguard's favour — the ROUND WON banner,
    // the kill feed and the full scoreboard over a quiet site.
    game.state.phase = 'roundEnd';
    game.state.phaseTime = 4;
    game.state.round = 4;
    game.state.scores.vanguard = 3;
    game.state.scores.sentinel = 1;
    game.state.roundWinner = 'vanguard';
    game.state.roundReason = 'The charge detonated';
    rig.buy('ar77');
    player.armor = 50;
    rig.state.grenades = 1;
    const stats = {
      You: [7, 2, 4800], Rook: [5, 3, 3900], Fable: [3, 4, 2100], Wren: [2, 3, 2400],
      Ash: [4, 5, 1800], Kite: [3, 4, 2600], Moss: [2, 5, 1400], Vale: [1, 6, 900],
    };
    for (const actor of game.actors()) {
      const s = stats[actor.name];
      game.state.kills.set(actor, s[0]);
      game.state.deaths.set(actor, s[1]);
      game.state.money.set(actor, s[2]);
    }
    body.position.set(-8, 0, -10);
    body.yaw = Math.PI / 2;
    body.pitch = 0;
    settle(20);
    aimAt(-22, 1.6, -13);
    hud.banner('ROUND WON', 'Vanguard takes the round — The charge detonated', 'vanguard', true);
    hud.clearKillfeed();
    hud.killfeed('You', 'Vale', 'vanguard', true, true);
    hud.killfeed('Rook', 'Moss', 'vanguard', false, true);
    hud.showScoreboard(game.actors().map((a) => ({
      name: a.name, team: a.team, isPlayer: a.isPlayer, alive: a.alive,
      kills: game.state.kills.get(a) ?? 0, deaths: game.state.deaths.get(a) ?? 0, money: game.moneyOf(a),
    })));
  }
  game.syncHud();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__game = game;
window.__player = player;
window.__bots = botsApi;
window.__rig = rig;
window.__combat = combat;
window.__camera = camera;
window.__scene = scene;

syncCamera();
if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
