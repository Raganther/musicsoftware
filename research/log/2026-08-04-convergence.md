# 2026-08-04 — convergence: one phrase, several clocks

**Sketches touched:** `sketches/convergence`
**Seeds worth keeping:** seed 6, 3:4:5, 12 steps, detune 0 is the reference —
convergence every 5.19s and you can hear it coming. Same with detune 0.03 is
the better piece: arrivals that approach and fail.

## What I tried

Sequencing/rhythm, the stalest family. A tempo canon: every voice plays the
identical phrase, only their tempi differ, in ratios like 3:4:5. They walk
apart, spend most of the time as a shifting blur, and periodically snap back
into unison at a convergence point. Nancarrow built player-piano studies
around engineering where those arrivals land; here it is a knob.

## What I measured

The convergence period is arithmetic, not taste. For 3:4:5 over 12 steps the
voices drift apart at 1/3 and 2/3 phrase-steps per clock step, so they
realign every **36 clock steps = 5.19s at 104bpm = 2.25 bars**.

Verified from the audio, not from the model: autocorrelating the output's
amplitude envelope over 32 seconds finds strong periodic structure at
**5.05s (r = 0.49)**, matching the prediction within the sampling loop's
drift. With ratios detuned by 0.08, correlation in the same window falls to
**0.24** and no longer peaks at the convergence period. The alignment meter
independently recorded a peak of 1.00 during the exact-ratio run — the voices
really do reach literal unison.

Peak 0.61 pre-limiter. Suite green: 13 sketches + jam.

## Two measurement mistakes worth recording

Both were in the *test*, and both would have produced a confident wrong
conclusion:

1. **Fixed-lag probing.** I first compared autocorrelation at exactly 5.19s
   between the exact and detuned runs. The envelope of discrete notes is
   spiky, so its autocorrelation is sharply peaked, and the sampling loop
   drifts a few percent over 640 samples — so the probe landed in a trough
   and reported the detuned run as *more* convergent than the exact one.
   Comparing the best correlation within a window fixes it.
2. **Harmonic ambiguity.** Searching 2–12s for the best period returned
   10.05s — almost exactly 2× the true period, because anything periodic at
   T is also periodic at 2T and a spiky envelope often correlates higher at
   the double. Bracketing the search around the predicted period is the only
   way the measurement tests the claim rather than a harmonic of it.

## What I got wrong before measuring

I wrote the notes first again, claiming alignment "returns to 0.98+ every 12
bars" with a table of specific values at three detune settings. The period is
2.25 bars, not 12, and I never measured the alignment values at all. Rewrote
the notes to state only the two things I actually established — the period,
and that detuning halves the periodic structure — and to mark the on-screen
alignment number as indicative rather than calibrated.

Fifth day running that writing-before-measuring produced plausible, specific,
wrong numbers. The pattern is stable enough now to name: the notes field
invites narrative, and narrative wants numbers, and inventing them costs
nothing at the moment of writing.

## What surprised me

- **Sub-step placement is the whole thing.** A voice at rate 4/3 lands
  between sixteenths; snapping to the clock grid turns the canon into a
  shuffle and the ratios stop being audible at all. Six lines of fractional
  offset separate the idea existing from not.
- Detuned ratios are more interesting than exact ones. Exact gives you
  architecture you can hear arriving; detuned gives convergences that
  approach and *fail*, which is a tension I did not know was available and
  would not have found without building the failure case as a control.

## Next

- [ ] Display the countdown to the next convergence, computed from the
      ratios — the arrival is much more powerful if you can see it coming.
- [ ] Per-voice phrase transposition, so a convergence is a chord rather
      than a unison.
- [ ] Tempo ratios as a jam-wide parameter: the whole rack in canon.
- [ ] Accelerating canon (Nancarrow's other trick): a voice whose rate
      changes continuously, so convergence points are non-periodic.
