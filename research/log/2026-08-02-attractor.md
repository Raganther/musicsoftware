# 2026-08-02 — attractor: a bifurcation you can play

**Sketches touched:** `sketches/attractor` (new), `scripts/smoke.mjs` (fix)
**Seeds worth keeping:** seed 17 at defaults. The good sound is coupling
1.75 with drift 0.35 — parked just past the knee so the drift carries the
tone back and forth across the transition. Coupling 2.45, ratio 1.5, drift 0
is the chaos demo; 1.2 is the ordered one.

## What I tried

Synthesis/DSP, the stalest family in the rotation. Two FM operators that
modulate *each other* inside a single sample:

    y1 = sin(2πp1 + a·y2)
    y2 = sin(2πp2 + b·y1)

Native nodes cannot express this — a DelayNode in a feedback cycle is clamped
to one 128-sample render quantum, already longer than the entire loop. Raise
the coupling and the pair runs the textbook route to chaos, so the bifurcation
*is* the timbre knob.

The visual plots (y1, y2) straight from the audio thread, so it is the
system's genuine phase portrait rather than an illustration of one: a closed
loop is a periodic waveform and a pitched sound, a filled tangle is chaos.
Sound and image are literally the same state. The order/chaos meter is live
measured spectral flatness.

## What I measured, and how it corrected me

Flatness of the voice with pitch and level fixed, drift and sequencer off:

| coupling | flatness | |
| --- | --- | --- |
| 0.15 | 0.0005 | a sine |
| 0.80 | 0.0014 | still essentially a sine |
| 1.60 | 0.0091 | bright, metallic, firmly pitched |
| **1.90** | **0.1079** | **the knee — 12× the flatness of 1.60** |
| 2.10 | 0.1366 | |
| 2.30 | 0.2105 | a bell that is arguing |
| 2.50 | 0.3138 | |
| 2.80 | 0.4161 | broken; pitch survives as a shadow |

**I had written the notes before measuring**, guessing a gradual transition
across 0.6–1.7, and set the default coupling to 0.75 on that basis. Both were
wrong: the transition is sharp and late, and the default was sitting in a dead
zone where the sketch is an ordinary FM voice. The instrument actually lives
between about 1.5 and 2.3. Default moved to 1.75 and drift widened so it
crosses the knee.

Worst case at maximum coupling, maximum level and an awkward ratio: 0.709
pre-limiter, bounded. That is structural rather than lucky — sin() is bounded
whatever its argument, so no amount of feedback can push y1 or y2 past ±1, and
the tanh bounds the sum. The right nonlinearity is a guarantee, not a limiter
bolted on afterwards.

## A claim I could not verify, left in as a claim

Integer frequency ratios *seem* to stay consonant further into the coupling
range than irrational ones. I tried to confirm it with flatness and could
not: at coupling 1.2, ratio 2.0 and ratio 1.5 both read ~0.0015. Flatness
measures noisiness, not inharmonicity, so it is the wrong instrument for the
question. Recorded in the notes as an ear impression, and the smoke gate for
it removed rather than weakened — a test that cannot detect the thing it
claims to test is worse than no test.

## The smoke failure worth keeping

The suite flagged 0.054 residual after unmount. It was not a leak: the newly
mounted sketch's own note was still decaying, because Attractor's notes run
to ~1.4s into a 2.8s reverb and the check only waited 900ms. Widened to 3.2s
— long enough that anything still sounding with the transport stopped is
genuinely stuck — and the residual reads 0.000 exactly, which confirms the
diagnosis rather than papering over it. The check was previously calibrated
to sketches with short releases and would have started producing false
failures for any slow sketch.

## What surprised me

- **The bifurcation is a cliff, not a slope.** 1.6 → 1.9 is a 12× change in
  flatness over 0.3 of a parameter. Everything musical is crowded into a
  narrow band, which makes drift far more valuable than I expected: parking
  just below the edge and letting it wander across is the sketch.
- Writing the notes before measuring produced confident, specific, wrong
  numbers. Third time in a week the discipline has caught me; the failure
  mode is always *plausible* detail, which is exactly what makes it dangerous.

## Next

- [ ] Per-note coupling: a harder-struck note lands further into chaos, so
      dynamics move you through the bifurcation.
- [ ] A third operator — should open quasi-periodic (torus) territory rather
      than merely more chaos, and the portrait would show it as a filled band
      rather than a tangle.
- [ ] A harmonic-deviation measure so the ratio claim can actually be tested.
