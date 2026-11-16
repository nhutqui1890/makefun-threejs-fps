// RIDGEPOINT: a desert outpost at dusk, 64 x 44 m. Vanguard spawns east, Sentinel
// west; two objective sites (A north-west, B south-west) and three lanes between
// them — north, mid and south — with a central silo splitting mid. All textures
// are painted on canvases at load: no image files, no network. The waypoint graph
// at the bottom is what the bots navigate.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

function canvasTexture(size, paint, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  paint(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function speckle(ctx, size, base, flecks, count) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = flecks[(Math.random() * flecks.length) | 0];
    ctx.globalAlpha = 0.12 + Math.random() * 0.25;
    const r = 1 + Math.random() * 3;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const sandTex = canvasTexture(256, (ctx, s) => speckle(ctx, s, '#c8a06a', ['#b28a52', '#d9b57e', '#9c7a48', '#e0c08a'], 900), 10, 7);
  const concreteTex = canvasTexture(256, (ctx, s) => {
    speckle(ctx, s, '#7d7468', ['#6b6257', '#8d8478', '#5d564c'], 500);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, s - 8, s - 8);
    ctx.beginPath();
    ctx.moveTo(0, s / 2);
    ctx.lineTo(s, s / 2);
    ctx.stroke();
  }, 2, 1);
  const metalTex = canvasTexture(128, (ctx, s) => {
    speckle(ctx, s, '#4a4f55', ['#3a3e44', '#5a6067', '#2f3338'], 200);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let y = 0; y < s; y += 16) ctx.fillRect(0, y, s, 3);
  });
  const crateTex = canvasTexture(128, (ctx, s) => {
    speckle(ctx, s, '#6e5a3a', ['#5d4b2f', '#7d6845', '#4f3f27'], 250);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, s - 6, s - 6);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s, s);
    ctx.moveTo(s, 0);
    ctx.lineTo(0, s);
    ctx.stroke();
  });
  const hazardTex = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#1d1812';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = PALETTE.accent;
    for (let x = -s; x < s * 2; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 16, 0);
      ctx.lineTo(x + 16 + s, s);
      ctx.lineTo(x + s, s);
      ctx.closePath();
      ctx.fill();
    }
  }, 4, 1);

  const materials = {
    sand: new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1, metalness: 0 }),
    concrete: new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.95, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ map: metalTex, roughness: 0.6, metalness: 0.45 }),
    crate: new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.85, metalness: 0.05 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.8, metalness: 0.1 }),
    rock: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rock), roughness: 1, metalness: 0 }),
    dark: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.9, metalness: 0.1 }),
  };

  const colliders = [];
  const shootables = [];
  const minimapWalls = [];

  function box(w, h, d, x, y, z, material, collide = true, minimap = false) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
      if (minimap) minimapWalls.push({ x, z, w, d });
    }
    return mesh;
  }

  // Ground: one sand plane, plus a darker apron under each site.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 44), materials.sand);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  shootables.push(ground);

  // Perimeter walls, 4.2 m, open to the dusk sky.
  box(64.8, 4.2, 0.6, 0, 2.1, -22.3, 'concrete', true, true);
  box(64.8, 4.2, 0.6, 0, 2.1, 22.3, 'concrete', true, true);
  box(0.6, 4.2, 44.8, -32.3, 2.1, 0, 'concrete', true, true);
  box(0.6, 4.2, 44.8, 32.3, 2.1, 0, 'concrete', true, true);

  // The silo: a central block splitting mid into two chokes.
  box(10, 3.4, 6, 0, 1.7, 0, 'metal', true, true);
  box(11, 0.3, 7, 0, 3.55, 0, 'dark', true, false);

  // Lane dividers: north and south walls with a door gap each (the A/B connectors).
  box(16, 3.2, 0.5, -22, 1.6, -7, 'concrete', true, true);
  box(10, 3.2, 0.5, -7, 1.6, -7, 'concrete', true, true);
  box(16, 3.2, 0.5, -22, 1.6, 7, 'concrete', true, true);
  box(10, 3.2, 0.5, -7, 1.6, 7, 'concrete', true, true);
  // Spawn gate: three exits from the Vanguard yard.
  box(0.5, 3.2, 12, 14, 1.6, -15, 'concrete', true, true);
  box(0.5, 3.2, 12, 14, 1.6, 15, 'concrete', true, true);
  box(0.5, 3.2, 8, 14, 1.6, 0, 'concrete', true, true);
  // Sentinel back wall with two gaps, guarding the sites' rear.
  box(0.5, 3.2, 10, -28, 1.6, -15, 'concrete', true, true);
  box(0.5, 3.2, 10, -28, 1.6, 15, 'concrete', true, true);

  // Containers: tall cover along the lanes.
  box(6, 2.4, 2.4, -6, 1.2, -15, 'metal', true, true);
  box(6, 2.4, 2.4, -6, 1.2, 15, 'metal', true, true);
  box(2.4, 2.4, 6, 20, 1.2, -9, 'metal', true, true);
  box(2.4, 2.4, 6, 20, 1.2, 9, 'metal', true, true);
  box(4.8, 2.4, 2.4, -16, 1.2, 0, 'metal', true, true);

  // Crates: low cover to crouch behind, scattered on every lane and both sites.
  const crates = [
    [10, -5.5], [10, 5.5], [-10, -4], [-10, 4], [4, -11], [4, 11],
    [-18, -10], [-25, -16], [-20, -17.5], [-18, 10], [-25, 16], [-20, 17.5],
    [24, -6], [24, 6], [-2, -18], [-2, 18], [16, -18], [16, 18],
  ];
  for (const [x, z] of crates) box(1.4, 1.1, 1.4, x, 0.55, z, 'crate', true, false);
  // A double stack at each site for a sightline over the crates.
  box(1.4, 1.1, 1.4, -24.5, 1.65, -11, 'crate');
  box(1.4, 1.1, 1.4, -24.5, 1.65, 11, 'crate');

  // Site pads: hazard border, a letter painted on the ground, a light beacon.
  const sites = [];
  function site(id, x, z) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), materials.concrete);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(x, 0.02, z);
    pad.receiveShadow = true;
    group.add(pad);
    const border = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 9.6), materials.hazard);
    border.rotation.x = -Math.PI / 2;
    border.position.set(x, 0.01, z);
    group.add(border);
    const letterTex = canvasTexture(256, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.fillStyle = 'rgba(232,163,61,0.9)';
      ctx.font = `bold ${s * 0.62}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(id, s / 2, s / 2 + s * 0.03);
    });
    const letter = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 5),
      new THREE.MeshBasicMaterial({ map: letterTex, transparent: true, depthWrite: false }),
    );
    letter.rotation.x = -Math.PI / 2;
    letter.position.set(x, 0.04, z);
    group.add(letter);
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 1.4, 9, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }),
    );
    beacon.position.set(x, 4.5, z);
    group.add(beacon);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.4, 3.8, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.05, z);
    group.add(ring);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 12, 14);
    light.position.set(x, 3.2, z);
    scene.add(light);
    sites.push({ id, x, z, radius: 4.2, ring, beacon, light });
  }
  site('A', -22, -13);
  site('B', -22, 13);

  // Dusk light: a low warm sun with long shadows, a cool sky fill.
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb36b'), 2.6);
  sun.position.set(28, 26, -18);
  sun.target.position.set(-6, 0, 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -42;
  sun.shadow.camera.right = 42;
  sun.shadow.camera.top = 34;
  sun.shadow.camera.bottom = -34;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(new THREE.Color('#8a7a68'), new THREE.Color('#3a2f24'), 1.25);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7a86a8'), 0.5);
  fill.position.set(-20, 14, 20);
  scene.add(fill);

  // Waypoint graph: nodes the bots walk between, edges both ways.
  const nodes = [
    { x: 27, z: 0 }, { x: 20, z: -14 }, { x: 20, z: 14 }, { x: 20, z: 0 },
    { x: 12, z: -15 }, { x: 12, z: 15 }, { x: 12, z: 0 },
    { x: 0, z: -15 }, { x: 0, z: 15 }, { x: 0, z: -5.5 }, { x: 0, z: 5.5 },
    { x: -12, z: -15 }, { x: -12, z: 15 }, { x: -12, z: 0 },
    { x: -19, z: -15 }, { x: -19, z: 15 }, { x: -22, z: -13 }, { x: -22, z: 13 },
    { x: -20, z: 0 }, { x: -27, z: 0 }, { x: -20, z: -8 }, { x: -20, z: 8 },
    { x: -12, z: -7 }, { x: -12, z: 7 }, { x: -6, z: -9 }, { x: -6, z: 9 },
  ];
  const edges = [
    [0, 1], [0, 2], [0, 3], [1, 4], [2, 5], [3, 6],
    [4, 7], [5, 8], [6, 9], [6, 10], [7, 11], [8, 12],
    [9, 13], [10, 13], [11, 14], [12, 15], [14, 16], [15, 17],
    [13, 18], [18, 19], [18, 20], [18, 21], [20, 14], [21, 15],
    [11, 22], [22, 13], [12, 23], [23, 13], [7, 24], [24, 9], [8, 25], [25, 10],
  ];
  const adjacency = nodes.map(() => []);
  for (const [a, b] of edges) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // Breadth-first path over the graph, as a list of node indices (start excluded).
  function findPath(from, to) {
    if (from === to) return [];
    const prev = new Array(nodes.length).fill(-1);
    const queue = [from];
    prev[from] = from;
    while (queue.length > 0) {
      const at = queue.shift();
      for (const next of adjacency[at]) {
        if (prev[next] !== -1) continue;
        prev[next] = at;
        if (next === to) {
          const path = [to];
          let cur = to;
          while (cur !== from) { cur = prev[cur]; path.unshift(cur); }
          return path.slice(1);
        }
        queue.push(next);
      }
    }
    return [];
  }

  return {
    colliders,
    shootables,
    sites,
    minimapWalls,
    nodes,
    nearestNode,
    findPath,
    spawns: {
      vanguard: [
        { x: 27, z: -3, yaw: Math.PI / 2 }, { x: 29, z: 1, yaw: Math.PI / 2 },
        { x: 27, z: 3, yaw: Math.PI / 2 }, { x: 29, z: -5, yaw: Math.PI / 2 },
      ],
      sentinel: [
        { x: -27, z: -3, yaw: -Math.PI / 2 }, { x: -29, z: 1, yaw: -Math.PI / 2 },
        { x: -27, z: 3, yaw: -Math.PI / 2 }, { x: -29, z: -5, yaw: -Math.PI / 2 },
      ],
    },
    // Defender hold spots: site corners, mid and the connectors.
    holds: [16, 17, 20, 21, 13, 14, 15],
  };
}
