// Sound cues for the game, synthesized at play time with the Web Audio API.
// There are no audio files and no third-party recordings anywhere in the
// project — every cue is a few oscillator notes defined below (provenance:
// assets/SOUNDS.md). Pages opt in with <script src="/sounds.js"> and a
// [data-sound-toggle] button; everything here fails silent, because a game
// must never break over audio.
'use strict';

const Sounds = (() => {
  const KEY = 'cp_muted';
  let muted = false;
  try { muted = localStorage.getItem(KEY) === '1'; } catch { /* private mode */ }

  let ctx = null;
  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  // Browsers keep audio locked until the page is touched. The first tap or
  // keypress (joining, starting the game) unlocks it for the whole session;
  // a TV screen that is never touched simply stays silent, never errors.
  for (const ev of ['pointerdown', 'keydown']) {
    document.addEventListener(ev, () => { ensureCtx(); }, { once: true, capture: true });
  }

  // One note: a plain oscillator through a fast-attack, exponential-decay
  // gain envelope. Every cue below is built from these alone.
  function note(t0, freq, dur, { type = 'sine', gain = 0.12, glide = 0 } = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  const CUES = {
    // A player joined the lobby: a bright two-note blip (C5 -> G5).
    join(t) {
      note(t, 523.25, 0.08, { gain: 0.10 });
      note(t + 0.09, 783.99, 0.14, { gain: 0.10 });
    },
    // Your turn: a gentle rising arpeggio (D5 - G5 - B5), soft triangle.
    yourturn(t) {
      note(t, 587.33, 0.14, { type: 'triangle', gain: 0.14 });
      note(t + 0.15, 783.99, 0.14, { type: 'triangle', gain: 0.14 });
      note(t + 0.30, 987.77, 0.22, { type: 'triangle', gain: 0.14 });
    },
    // A word landed: a soft two-note pluck (G4 -> C5).
    played(t) {
      note(t, 392.00, 0.10, { gain: 0.10 });
      note(t + 0.08, 523.25, 0.16, { gain: 0.10 });
    },
    // Pyramids were stolen: a short descending sting (A4 - E4 - B3, falling off).
    steal(t) {
      note(t, 440.00, 0.12, { type: 'sawtooth', gain: 0.05 });
      note(t + 0.12, 329.63, 0.12, { type: 'sawtooth', gain: 0.05 });
      note(t + 0.24, 246.94, 0.22, { type: 'sawtooth', gain: 0.06, glide: 180 });
    },
    // Game over: a small fanfare (C5 - E5 - G5 - high C held over a low C).
    over(t) {
      note(t, 523.25, 0.14, { type: 'triangle', gain: 0.13 });
      note(t + 0.15, 659.25, 0.14, { type: 'triangle', gain: 0.13 });
      note(t + 0.30, 783.99, 0.14, { type: 'triangle', gain: 0.13 });
      note(t + 0.46, 1046.50, 0.50, { type: 'triangle', gain: 0.15 });
      note(t + 0.46, 523.25, 0.50, { gain: 0.07 });
    },
  };

  function play(name) {
    if (muted || !CUES[name]) return;
    const c = ensureCtx();
    if (!c) return;
    const fire = () => { try { CUES[name](c.currentTime + 0.02); } catch { /* never break the game over audio */ } };
    // Oscillators queued on a suspended context would all burst out together
    // whenever it finally resumes, so a locked cue is dropped, not queued.
    if (c.state === 'running') fire();
    else c.resume().then(() => { if (c.state === 'running') fire(); }).catch(() => {});
  }

  // Any [data-sound-toggle] button on the page becomes the mute switch; the
  // choice persists across games on this device.
  function paint() {
    document.querySelectorAll('[data-sound-toggle]').forEach((b) => {
      b.textContent = muted ? '\u{1F507}' : '\u{1F50A}';
      b.setAttribute('aria-pressed', String(!muted));
      b.setAttribute('aria-label', muted ? 'Sound is off. Turn sound on' : 'Sound is on. Turn sound off');
      b.title = muted ? 'Sound off' : 'Sound on';
    });
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-sound-toggle]');
    if (!b) return;
    muted = !muted;
    try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch { /* private mode */ }
    paint();
    if (!muted) play('join'); // audible confirmation that sound is back
  });
  paint();

  return { play, get muted() { return muted; } };
})();
