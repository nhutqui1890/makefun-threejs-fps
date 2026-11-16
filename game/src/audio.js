// All sound is synthesized with WebAudio: no audio files, no network. A shared
// noise buffer feeds the gunshots and the explosion; short oscillators make the
// clicks, beeps and stings. The context starts on the first user gesture.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let muted = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function noise(when, duration, filterFreq, gainValue, type = 'lowpass') {
    if (!ctx || muted) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    src.connect(filter).connect(gain).connect(master);
    src.start(when, Math.random());
    src.stop(when + duration + 0.02);
  }

  function tone(when, freq, duration, gainValue, type = 'sine', slideTo = null) {
    if (!ctx || muted) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(slideTo, when + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    osc.connect(gain).connect(master);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }

  const api = {
    unlock() { ensure(); },
    setMuted(value) { muted = value; },
    isMuted() { return muted; },
    shoot(kind) {
      if (!ensure()) return;
      const t = ctx.currentTime;
      if (kind === 'lw50') {
        noise(t, 0.32, 900, 0.9);
        tone(t, 90, 0.22, 0.7, 'sine', 45);
      } else if (kind === 'ar77') {
        noise(t, 0.14, 1800, 0.65);
        tone(t, 140, 0.09, 0.4, 'square', 70);
      } else if (kind === 'vk9') {
        noise(t, 0.09, 2600, 0.45);
      } else {
        noise(t, 0.12, 2200, 0.55);
        tone(t, 180, 0.07, 0.3, 'square', 90);
      }
    },
    // A distant shot: same crack, quieter and duller.
    shootFar() {
      if (!ensure()) return;
      noise(ctx.currentTime, 0.1, 700, 0.12);
    },
    dryFire() {
      if (!ensure()) return;
      tone(ctx.currentTime, 900, 0.04, 0.2, 'square');
    },
    reload() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(t, 500, 0.05, 0.25, 'square');
      tone(t + 0.18, 700, 0.05, 0.25, 'square');
      tone(t + 0.4, 900, 0.06, 0.3, 'square');
    },
    hit() {
      if (!ensure()) return;
      tone(ctx.currentTime, 1400, 0.05, 0.3, 'sine');
    },
    kill() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(t, 1200, 0.06, 0.3, 'sine');
      tone(t + 0.07, 1800, 0.09, 0.3, 'sine');
    },
    plant() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(t, 660, 0.09, 0.35, 'square');
      tone(t + 0.12, 660, 0.09, 0.35, 'square');
    },
    defuse() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(t, 520, 0.1, 0.3, 'square');
      tone(t + 0.14, 780, 0.14, 0.3, 'square');
    },
    beep() {
      if (!ensure()) return;
      tone(ctx.currentTime, 1100, 0.07, 0.35, 'square');
    },
    explode() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      noise(t, 0.9, 300, 1.0);
      tone(t, 60, 0.8, 0.9, 'sine', 30);
    },
    roundWin() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(t, 523, 0.12, 0.3, 'sine');
      tone(t + 0.12, 659, 0.12, 0.3, 'sine');
      tone(t + 0.24, 784, 0.22, 0.3, 'sine');
    },
    roundLose() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(t, 392, 0.14, 0.3, 'sine');
      tone(t + 0.14, 330, 0.14, 0.3, 'sine');
      tone(t + 0.28, 262, 0.26, 0.3, 'sine');
    },
    buy() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(t, 880, 0.06, 0.25, 'sine');
      tone(t + 0.07, 1174, 0.09, 0.25, 'sine');
    },
    denied() {
      if (!ensure()) return;
      tone(ctx.currentTime, 220, 0.12, 0.3, 'square');
    },
  };
  return api;
}
