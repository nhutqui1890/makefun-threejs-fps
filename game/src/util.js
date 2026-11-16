// Small shared helpers: a seeded RNG (so the screenshot modes are deterministic),
// clamps and angle math. No allocations in the hot path: the RNG is a closure over one number.
export function mulberry32(initial) {
  let a = initial | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Shortest signed turn from `from` to `to`, in radians.
export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Yaw (three.js YXZ) that faces from (x0,z0) toward (x1,z1).
export function yawTo(x0, z0, x1, z1) {
  return Math.atan2(-(x1 - x0), -(z1 - z0));
}
