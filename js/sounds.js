// sounds.js — Web Audio API synthesized poker sound effects (no external files)

const _SFX = (() => {
  let _ctx = null;
  let muted = false;

  function ctx() {
    if (muted) return null;
    if (!_ctx) {
      try { _ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return null; }
    }
    if (_ctx.state === 'suspended') _ctx.resume().catch(() => { });
    return _ctx;
  }

  // White-noise burst through a bandpass filter
  function noise(dur, freq, vol, startAt = 0) {
    const c = ctx(); if (!c) return;
    const len = Math.ceil(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
    const src = c.createBufferSource(); src.buffer = buf;
    const flt = c.createBiquadFilter();
    flt.type = 'bandpass'; flt.frequency.value = freq; flt.Q.value = 1;
    const g = c.createGain();
    const t = c.currentTime + startAt;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(c.destination);
    src.start(t);
  }

  // Pure oscillator tone
  function tone(freq, dur, vol, type = 'sine', startAt = 0) {
    const c = ctx(); if (!c) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    const t = c.currentTime + startAt;
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(c.destination);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  return {
    // Eagerly unlock AudioContext on first user interaction
    unlock() {
      const c = ctx();
      if (c && c.state === 'suspended') c.resume().catch(() => { });
    },

    // Card slide swish (one card)
    deal(delay = 0) {
      noise(0.065, 3500, 0.22, delay);
    },

    // Chip click + brief metallic ring
    chip() {
      noise(0.016, 6000, 0.30);
      tone(780, 0.14, 0.14, 'sine');
    },

    // Soft table knock (check)
    check() {
      tone(165, 0.09, 0.22, 'sine');
      noise(0.045, 350, 0.14);
    },

    // Card placed face-down (fold)
    fold() {
      noise(0.11, 480, 0.18);
      tone(125, 0.09, 0.10, 'sine');
    },

    // Ascending arpeggio: C5-E5-G5-C6
    win() {
      [523, 659, 784, 1047].forEach((f, i) =>
        tone(f, 0.30, 0.18, 'sine', i * 0.12));
    },

    // Descending 3-note: G4-E4-C4
    lose() {
      [392, 330, 262].forEach((f, i) =>
        tone(f, 0.40, 0.14, 'sine', i * 0.17));
    },

    setMuted(val) {
      muted = !!val;
    }
  };
})();

// Unlock audio on first click/touch anywhere on the page
document.addEventListener('click', () => _SFX.unlock(), { once: true });
document.addEventListener('touchstart', () => _SFX.unlock(), { once: true });
