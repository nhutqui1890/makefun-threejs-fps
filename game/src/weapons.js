// The armoury: four guns and a grenade, each with its own damage, fire rate,
// spread and price. The rig owns the player's view model and the state of every
// weapon the player owns (magazine, reserve, cooldown); bots read the same table
// but never build a view model. Spread grows with movement and falls when still
// or crouched, so stopping to aim pays.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P-9 Sidearm', slot: 2, price: 0,
    damage: 34, headMult: 4, rpm: 320, mag: 15, reserveAmmo: 60,
    reloadTime: 1.5, auto: false, spreadStill: 0.002, spreadMove: 0.02,
    recoil: 0.011, range: 60, falloff: 25, kick: 0.04, sound: 'p9',
  },
  vk9: {
    id: 'vk9', name: 'VK-9 Repeater', slot: 1, price: 1200,
    damage: 26, headMult: 4, rpm: 750, mag: 32, reserveAmmo: 128,
    reloadTime: 2.1, auto: true, spreadStill: 0.004, spreadMove: 0.032,
    recoil: 0.008, range: 55, falloff: 18, kick: 0.035, sound: 'vk9',
  },
  ar77: {
    id: 'ar77', name: 'AR-77 Carbine', slot: 1, price: 2700,
    damage: 36, headMult: 4, rpm: 600, mag: 30, reserveAmmo: 90,
    reloadTime: 2.3, auto: true, spreadStill: 0.0022, spreadMove: 0.026,
    recoil: 0.013, range: 80, falloff: 30, kick: 0.05, sound: 'ar77',
  },
  lw50: {
    id: 'lw50', name: 'LW-50 Longshot', slot: 1, price: 4750,
    damage: 110, headMult: 2, rpm: 42, mag: 5, reserveAmmo: 20,
    reloadTime: 3.2, auto: false, spreadStill: 0.0004, spreadMove: 0.05,
    recoil: 0.045, range: 120, falloff: 60, kick: 0.12, sound: 'lw50',
  },
};

export const GRENADE = { id: 'frag', name: 'Frag Grenade', price: 300, damage: 90, radius: 5.5, fuse: 1.4 };

const VIEW = {
  p9: { receiver: [0.07, 0.09, 0.3], barrel: [0.04, 0.04, 0.22], stock: [0, 0, 0], grip: [0.06, 0.14, 0.07] },
  vk9: { receiver: [0.08, 0.1, 0.4], barrel: [0.04, 0.04, 0.3], stock: [0.07, 0.08, 0.2], grip: [0.06, 0.12, 0.06] },
  ar77: { receiver: [0.09, 0.11, 0.46], barrel: [0.045, 0.045, 0.42], stock: [0.08, 0.09, 0.24], grip: [0.06, 0.13, 0.07] },
  lw50: { receiver: [0.09, 0.12, 0.55], barrel: [0.04, 0.04, 0.6], stock: [0.08, 0.1, 0.28], grip: [0.06, 0.13, 0.07] },
};

export function createWeaponRig(camera) {
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#8a857e'), roughness: 0.45, metalness: 0.4 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#4c4741'), roughness: 0.6, metalness: 0.35 });
  const gripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5a5348'), roughness: 0.7, metalness: 0.2 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });

  // The view model sits low and right, small enough to see past: the original
  // sat so close to the camera it filled a third of the frame.
  const VIEW_POS = new THREE.Vector3(0.28, -0.25, -0.55);
  const VIEW_SCALE = 0.62;
  const model = new THREE.Group();
  model.position.copy(VIEW_POS);
  model.scale.setScalar(VIEW_SCALE);
  camera.add(model);
  // A dim warm fill on the camera so the gun reads as metal, not a black slab.
  const viewLight = new THREE.PointLight(new THREE.Color('#ffe0b3'), 4, 5);
  camera.add(viewLight);
  const parts = {};
  function part(name, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    mesh.visible = false;
    model.add(mesh);
    parts[name] = mesh;
    return mesh;
  }
  part('receiver', bodyMat);
  part('barrel', darkMat);
  part('stock', gripMat);
  part('grip', gripMat);
  part('sight', accentMat);

  // The muzzle flash is a painted starburst, not a flat quad: a white-hot core,
  // amber spikes and a soft halo, drawn once on a canvas at load.
  function flashTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const cx = 64;
    const cy = 64;
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, 62);
    halo.addColorStop(0, 'rgba(255,244,214,1)');
    halo.addColorStop(0.25, 'rgba(255,205,110,0.9)');
    halo.addColorStop(0.6, 'rgba(255,150,60,0.35)');
    halo.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = 'rgba(255,226,150,0.95)';
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((i * Math.PI) / 2 + Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(0, -58);
      ctx.lineTo(7, -8);
      ctx.lineTo(-7, -8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(255,255,240,1)';
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fill();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  );
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color('#ffb36b'), 0, 6);
  camera.add(flashLight);

  const state = {
    current: 'p9',
    owned: {
      p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserveAmmo },
    },
    grenades: 0,
    cooldown: 0,
    reloadLeft: 0,
    reloadTotal: 0,
    flash: 0,
    kick: 0,
    switchLeft: 0,
  };

  function buildView(weaponId) {
    const spec = VIEW[weaponId];
    const set = (name, dims, x, y, z) => {
      const mesh = parts[name];
      mesh.scale.set(dims[0], dims[1], dims[2]);
      mesh.position.set(x, y, z);
      mesh.visible = dims[0] > 0;
    };
    set('receiver', spec.receiver, 0, 0, 0);
    set('barrel', spec.barrel, 0, 0.03, -spec.receiver[2] / 2 - spec.barrel[2] / 2 + 0.04);
    set('stock', spec.stock, 0, -0.02, spec.receiver[2] / 2 + (spec.stock[2] || 0) / 2);
    set('grip', spec.grip, 0, -spec.receiver[1] / 2 - spec.grip[1] / 2 + 0.03, 0.08);
    set('sight', [0.02, 0.05, 0.1], 0, spec.receiver[1] / 2 + 0.025, -0.05);
    // The muzzle sits at the model's local muzzleZ, scaled into camera space.
    const muzzleZ = -spec.receiver[2] / 2 - spec.barrel[2] + 0.02;
    flash.position.set(VIEW_POS.x, VIEW_POS.y + 0.03, VIEW_POS.z + muzzleZ * VIEW_SCALE);
    flashLight.position.set(VIEW_POS.x, VIEW_POS.y + 0.03, VIEW_POS.z + muzzleZ * 0.6 * VIEW_SCALE);
  }

  function currentDef() {
    return WEAPONS[state.current];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.switchLeft = Math.max(0, state.switchLeft - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 13);
    model.position.z = VIEW_POS.z + state.kick;
    model.rotation.x = state.kick * 2.4;
    flash.visible = state.flash > 0;
    if (state.flash > 0) flash.rotation.z = state.flash * 40;
    flashLight.intensity = state.flash > 0 ? 20 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const progress = state.reloadTotal > 0 ? 1 - state.reloadLeft / state.reloadTotal : 1;
      model.rotation.x = -0.6 * Math.sin(progress * Math.PI);
      if (state.reloadLeft === 0) {
        const def = currentDef();
        const owned = state.owned[state.current];
        const take = Math.min(def.mag - owned.mag, owned.reserve);
        owned.mag += take;
        owned.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    currentDef,
    ready() {
      return state.reloadLeft === 0 && state.cooldown === 0 && state.switchLeft === 0 && state.owned[state.current].mag > 0;
    },
    spread(speed, airborne, crouching) {
      const def = currentDef();
      const move = Math.min(1, speed / 5.2);
      let spread = def.spreadStill + move * def.spreadMove;
      if (airborne) spread += def.spreadMove * 1.2;
      if (crouching) spread *= 0.7;
      return spread;
    },
    pullTrigger() {
      const def = currentDef();
      state.cooldown = 60 / def.rpm;
      state.flash = 0.06;
      state.kick = def.kick;
    },
    takeRound() {
      const owned = state.owned[state.current];
      if (owned.mag <= 0) return false;
      owned.mag -= 1;
      return true;
    },
    reload() {
      const def = currentDef();
      const owned = state.owned[state.current];
      if (state.reloadLeft > 0 || owned.mag === def.mag || owned.reserve === 0) return false;
      state.reloadLeft = def.reloadTime;
      state.reloadTotal = def.reloadTime;
      return true;
    },
    switchTo(weaponId) {
      if (!state.owned[weaponId] || weaponId === state.current) return false;
      state.current = weaponId;
      state.reloadLeft = 0;
      state.switchLeft = 0.35;
      buildView(weaponId);
      return true;
    },
    buy(weaponId) {
      const def = WEAPONS[weaponId];
      state.owned[weaponId] = { mag: def.mag, reserve: def.reserveAmmo };
      state.current = weaponId;
      state.reloadLeft = 0;
      state.switchLeft = 0.35;
      buildView(weaponId);
    },
    refill() {
      for (const id of Object.keys(state.owned)) {
        state.owned[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserveAmmo };
      }
      state.reloadLeft = 0;
      state.cooldown = 0;
    },
    reset() {
      state.current = 'p9';
      state.owned = { p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserveAmmo } };
      state.grenades = 0;
      state.reloadLeft = 0;
      state.cooldown = 0;
      buildView('p9');
    },
    buildView,
  };
}
