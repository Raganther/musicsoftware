# 2026-07-28 — aeolian harp: first physical model, and a proof that proved the wrong thing

**Sketches touched:** `sketches/aeolian-harp`
**Seeds worth keeping:** seed 7 at defaults — wind 0.35 over D pentatonic major
is the reference "weather". Seed 7 with decay 1.0, sympathy 1.0, wind 0.6 is
the storm-drone.

## What I tried

The repo had no physical model — every voice is an oscillator or a noise
burst. Built a bank of Karplus-Strong strings in one AudioWorklet processor:
strum with the pointer, or let a seeded wind (a random walker, deliberately
off-transport — aeolian harps have no tempo) wander across the strings and
brush them.

The deliberate experiment was **sympathetic resonance**: strings exciting each
other, with the coupling designed by algebra instead of tuned by fear.

## What actually happened

**The stability proof was correct and the design was still wrong.** Version
one mixed each string with the bank mean inside the feedback loop:
`y = fb·((1−s)·own + s·mean)`. The loop matrix `fb·[(1−s)I + s·J/N]` has
eigenvalues `fb` (uniform mode) and `fb(1−s)` (all N−1 difference modes) —
spectral radius `fb < 1`, provably stable at any sympathy. But a single pluck
is almost entirely difference modes, so it decays at `fb(1−s)`: at default
sympathy that's an extra ~5% loss *per period*, and a plucked string died in
~150 ms. The smoke test caught it as a peak of 0.007 where ~0.4 was expected.
Broadband mean-coupling *is* damping. The proof guaranteed stability; nothing
in it guaranteed the thing I actually wanted.

**Real sympathy is frequency-selective.** Strings exchange energy through
shared partials. v2 spills a quiet, darker copy of each pluck into strings
whose frequencies sit near integer ratios (p:q, p,q ≤ 5, weighted 1/pq).
Feed-forward, so stability is trivial — and measured at the octave-partner's
fundamental bin it lifts the tail by **+5.7 dB**, which is clearly audible as
the harp "breathing in" behind a hard pluck.

**Tuning needed a phase-delay compensation.** The in-loop lowpass delays the
recirculating wave by ≈ (1−c)/c samples, so every string plays flat unless
the delay line is shortened by that much — worse the darker the tone.
Measured after compensation: **0.2 / 0.5 / 1.0 cents** error on strings 0/4/9.

**tanh as the instrument's body.** Stacked strums summed past 1.5 pre-limiter.
Instead of trimming gain, the bank sum passes through `tanh(2x)` inside the
worklet: output bounded below 1 *by construction*, hard strums saturate the
way a body does, and the sketch cannot clip no matter what the player does.
Worst-case measured: 0.611 during a triple strum at max decay + max sympathy,
decaying to 0.261.

## What surprised me

- A proof can be airtight and aimed at the wrong property. "Stable" and
  "musical" share no theorems.
- Autocorrelation pitch measurement falls into the octave-below trap by
  default — r(2T) ties r(T) for any periodic signal, and overlapping ring
  breaks the tie the wrong way. First measurements read −1200.0 cents exactly.
  Windowing the lag search around the expected period fixed it; the exactness
  of the −1200 was itself diagnostic (a real detune is never that clean).
- The wind not following the transport is what makes it feel like weather.
  Every other generative sketch here breathes on the grid; this one doesn't,
  and you can hear the difference in kind.

## Next

- [ ] A bow: sustained stick-slip excitation instead of bursts.
- [ ] A real bridge — a shared resonator with per-partial transfer, which is
      what continuous sympathetic coupling actually needs.
- [ ] Palm damping: rest the pointer on strings to stop them. Most of playing
      a real zither is choosing what *not* to ring.
- [ ] Per-string stereo spread.
