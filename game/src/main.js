// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. The game state lives in game.js; this file wires the pieces
// together, owns the camera, and stages the deterministic screenshot frames:
// ?shot=start|play|buy|end with &seed=N sets a scene up, renders it twice,
// freezes it and sets window.__shotReady.
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
  if (name === 'start') {
    body.position.set(24, 0, -6);
    body.yaw = Math.PI / 2;
    body.pitch = 0;
    settle(20);
    aimAt(-6, 1.5, -8);
    hud.showOverlay('start');
  } else if (name === 'buy') {
    game.state.money.set(player, 3250);
    body.position.set(24, 0, -6);
    body.yaw = Math.PI / 2;
    body.pitch = 0;
    settle(20);
    aimAt(-6, 1.5, -8);
    hud.showBuyMenu(3250, rig.state.owned, 0);
  } else if (name === 'play') {
    game.state.phase = 'live';
    game.state.roundTime = 83;
    game.state.round = 4;
    game.state.scores.vanguard = 2;
    game.state.scores.sentinel = 1;
    game.state.money.set(player, 3250);
    body.position.set(16, 0, -6);
    body.yaw = Math.PI / 2;
    body.pitch = 0;
    placeBot('sentinel', 0, -2, -8, -Math.PI / 2);
    placeBot('sentinel', 1, -10, -13, -Math.PI / 2);
    placeBot('vanguard', 0, 8, -11, Math.PI / 2);
    settle(24);
    // One real shot at the visible enemy, frozen mid-flight: muzzle flash,
    // tracer and the hitmarker all stay on screen while the sim is frozen.
    const target = botsApi.list.filter((b) => b.actor.team === 'sentinel')[0].actor;
    aimAt(target.position.x, target.position.y + 1.2, target.position.z);
    input.state.firing = true;
    step(FIXED_STEP);
    input.state.firing = false;
    settle(1);
  } else {
    // end: the match is decided, the scoreboard tells the story.
    game.state.phase = 'matchEnd';
    game.state.scores.vanguard = 5;
    game.state.scores.sentinel = 3;
    game.state.round = 8;
    game.state.kills.set(player, 11);
    game.state.deaths.set(player, 6);
    body.position.set(-8, 0, -10);
    body.yaw = Math.PI / 2;
    body.pitch = 0;
    settle(20);
    aimAt(-22, 1.6, -13);
    hud.showOverlay('matchEnd', {
      title: 'VICTORY',
      copy: 'Vanguard takes the match 5–3. The outpost is yours.',
      extra: '<span>You: 11 kills, 6 deaths · 8 rounds played</span>',
    });
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
