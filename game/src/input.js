// Keyboard and mouse, and the pointer lock that turns the mouse into look.
// Two kinds of key state: `keys` (held down, for movement) and `pressed` (fired
// once per keydown, for actions like reload and buy, consumed by the game loop).
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressedQueue = new Set();
  const state = { keys, locked: false, firing: false, lookX: 0, lookY: 0 };

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    keys.add(event.code);
    pressedQueue.add(event.code);
    if (event.code === 'Space' || event.code === 'Tab') event.preventDefault();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => {
    keys.clear();
    pressedQueue.clear();
    state.firing = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (state.locked && event.button === 0) state.firing = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    exitLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    // True once per keydown; the game loop calls it every frame for the keys it cares about.
    pressed(code) {
      if (!pressedQueue.has(code)) return false;
      pressedQueue.delete(code);
      return true;
    },
    clearPressed() {
      pressedQueue.clear();
    },
  };
}
