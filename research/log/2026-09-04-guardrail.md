# 2026-09-04 — guardrail: what a safety rail costs, in notes

**Sketches touched:** `sketches/guardrail`
**Settings worth keeping:** the defaults — root 60, major, guardrail 0.6, range
24, seed 7. Drag across the surface and watch the second panel: the hollow dot
is where your finger went, the gold one is what you heard. Then take
`Guardrail` from 0 to 1 slowly while dragging. The diagonal flattens into a
staircase, and the staircase is the instrument's whole vocabulary drawn to
scale.

## What I tried

Improvisation/performance, the stalest family — last visited 2026-08-31 with
`inertia`.

Most music software will not let you play a wrong note. Snap to scale, snap to
grid, auto-tune: the pitch you asked for is quietly replaced with the nearest
approved one, and the replacement is sold as help. I wanted to build the
opinion I actually hold about that and then find out whether it survives being
measured.

The opinion: **an instrument that guarantees you cannot play a wrong note also
guarantees you cannot play a distinctive one.** That is countable rather than
rhetorical. Snapping at strength s maps an input d cents from the nearest degree
to d(1−s), so a scale step w cents wide collapses to an output span of w(1−s).
If two outputs closer than a resolution τ are the same note, that step carries

    max(1, w(1−s)/τ)

distinguishable notes, and the instrument's vocabulary is that summed over the
steps. At s = 1 it is exactly the number of degrees. At s = 0 it is the
continuum, resolution-limited.

So the trade-off has two axes and both come off the recording: how many notes
the instrument can distinguish, and what fraction of them are in the scale.

## What I measured

Sweeping the input across an octave in 20-cent steps, measuring every output
pitch from the audio, and clustering at 10 cents:

| guardrail | distinguishable (pred / meas) | bits | in scale (pred / meas) |
| --- | --- | --- | --- |
| 0.00 | 61 / 61 | 5.93 | 13% / 13% |
| 0.25 | 61 / 60 | 5.91 | 13% / 15% |
| 0.50 | 38 / 38 | 5.25 | 30% / 25% |
| 0.75 | 8 / 9 | 3.17 | 52% / 46% |
| 0.90 | 8 / 8 | 3.00 | 97% / 84% |
| 1.00 | 8 / 8 | 3.00 | 100% / 100% |

**From no help to full help the vocabulary falls 61 → 8 notes per octave — 5.93
to 3.00 bits — while the fraction in tune with the scale goes 13% → 100%.**
Prediction and measurement never disagree by more than one note out of 61.

So the opinion survives, with a caveat I did not expect to have to make: the
collapse is not gradual. Nothing happens at all until the rail is half on
(61 → 61 → 38), and then the vocabulary falls off a cliff between 0.5 and 0.75.
That is not a smooth trade — it is a threshold, and it sits where the snap
becomes strong enough that neighbouring inputs 20 cents apart land closer
together than the ear's resolution. **A little help really is free; a lot of
help takes almost everything.**

**The control is strict and it passed.** At guardrail 0 the output pitch must
equal the input: worst error **6.38 cents** across 61 notes, mean **+3.39**.

That mean is not noise, and chasing it was worth the five minutes: the voice
runs two oscillators 6 cents apart, so the pair's centroid sits about 3 cents
sharp of the note requested. Fully explained, smaller than the 10-cent
clustering tolerance, and it is exactly why the 0.90 row reads 84% rather than
97% — at that setting outputs land within 10 cents of a degree by design, so a
3-cent bias tips the borderline ones over the line. A residual that explains a
second residual elsewhere is a good sign the model is right.

**An honest ceiling:** 61 is the most this sweep could ever resolve, because the
inputs are 20 cents apart and the tolerance is 10. That bounds the measurement,
not the instrument — at guardrail 0 the surface is genuinely continuous, and the
"61" column would grow with a finer sweep while the "8" column would not.

Levels: 0.50 pre-limiter at the defaults, through the smoke gate.

## What went wrong

**Scheduling sixty-one notes at once into a ten-voice synth plays ten of them.**
The first run found 10 onsets where 61 were played, and reported a tuning error
of +1021 cents — which was not a tuning error at all but the ten survivors being
paired with the first ten inputs. `PolySynth` allocates a voice when `note()` is
called rather than when the note is due, so handing it the whole sweep meant the
later calls stole the voices the earlier ones were holding.

The plumbing line saved me again: printing "61 notes played, 10 onsets found"
next to the pitch table made it obvious in one glance that the pitches were
irrelevant until the counts matched. I have now been rescued by a
count-what-you-asked-for line three days running, and it costs one `console.log`.

**A sub-oscillator gives a pitch tracker a real octave to find.** With the
counts fixed, the control still read a mean of −96 cents with a worst case of
exactly 1200: the voice has a sub an octave down, so a double-length period is
genuinely present in the signal and YIN is not wrong to find it. The fix is to
search only the instrument's declared range rather than the whole audible band,
which removes octave-down errors without assuming anything about *which* note
this is — the output could still be anywhere across the two-octave span, so the
control could still have failed. It didn't.

## The gate's retry, one day on

Yesterday's retry mechanism logged `arc` and I inferred from three occurrences
in five runs that `arc` was specifically slow to start. Today it logged `bloom`
instead. That is one data point against the inference, and worth recording as
such rather than leaving yesterday's confident sentence standing: the retries
are looking more like something that can happen to any sketch than a property of
`arc`. Six runs is not enough to tell, which is the entire reason the count is
now printed instead of remembered.

## Next

- [ ] The timing rail is built and unmeasured. Snapping onsets to a grid should
      collapse rhythmic vocabulary exactly the same way, and the arithmetic is
      identical with the grid step in place of the scale step.
- [ ] Measure the *knee* properly rather than noticing it. The cliff between
      0.5 and 0.75 should sit exactly where 20(1−s) = τ, which is s = 0.5 for
      this sweep — so a finer input sweep should move the knee, and if it does
      not, my explanation is wrong.
- [ ] A rail that adapts: strong on the first note of a phrase and weak
      afterwards, so it places you in the key and then leaves you alone. That is
      what a good teacher does and it should cost far fewer bits for the same
      in-scale fraction.
- [ ] Per-degree rail strength. Pulling hard to the tonic and barely at all to
      the seventh is closer to how tonality actually behaves than a uniform
      snap, and it makes the staircase uneven in a way you could compose with.
- [ ] Vibrato survives auto-tune only if the rail is slow. A rail with a time
      constant rather than an instantaneous one is a different instrument, and
      the measurement would be of *modulation depth* rather than of static
      pitch.
