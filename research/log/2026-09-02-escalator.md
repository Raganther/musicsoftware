# 2026-09-02 — escalator: a pulse that accelerates forever

**Sketches touched:** `sketches/escalator`
**Settings worth keeping:** the defaults — 16 s cycle, 5 layers, slowest layer
8 per cycle, bell width 1.2, seed 3. Let it run through three or four cycles
before deciding whether you believe it. Then turn on `Flat`: the same onsets,
no bell, and the climb collapses into a texture that just gets busier and
jumps. `Downwards` is the same cycle backwards and is, if anything, more
unsettling.

## What I tried

Sequencing/rhythm, the stalest family — last visited 2026-08-28 with
`irrational`.

A Shepard tone is octave-spaced sinusoids under a fixed spectral envelope:
every partial rises, each fades in at the bottom and out at the top, and the
ensemble is unchanged, so it climbs endlessly without going anywhere. Do the
same thing to *tempo* and you get a Risset rhythm. `staircase` did the pitch
version here on 2026-08-23; this is the rhythmic one, and it has been sitting
in `ideas.md` unbuilt since.

I wanted the construction exact rather than approximate, because the whole
illusion rests on the seam being genuinely invisible rather than nearly so:

- layer i has pulse rate r_i(u) = base·2^(i + u/T), so over one cycle every
  layer doubles and lands exactly where its neighbour began
- integrating gives phase A_i·(2^(u/T) − 1) with A_i = base·2^i·T/ln2, so the
  k-th onset is at **u_k = T·log2(1 + k/A_i)** — a closed form, the same trick
  `crossing` used for exponential tempo sweeps
- choosing **base = n·ln2/T** makes every A_i the integer n·2^i, so each layer
  fires a whole number of times per cycle and the pattern is *exactly* periodic
  rather than nearly periodic
- amplitude and pitch depend only on the octave position p = i + u/T, so at
  u = T layer i has become, in every respect, what layer i+1 was at u = 0

## What I measured

**The closed form is right to 2.9 ms.** One layer, eight onsets, each detected
from the audio and compared against T·log2(1 + k/n):

| k | predicted | measured | error |
| --- | --- | --- | --- |
| 0 | 0.1397s | 0.1397s | 0.0 ms |
| 1 | 1.8389s | 1.8398s | +0.9 ms |
| 2 | 3.3590s | 3.3564s | −2.6 ms |
| 3 | 4.7340s | 4.7333s | −0.8 ms |
| 4 | 5.9893s | 5.9864s | −2.9 ms |
| 5 | 7.1441s | 7.1438s | −0.3 ms |
| 6 | 8.2132s | 8.2133s | +0.1 ms |
| 7 | 9.2086s | 9.2071s | −1.5 ms |

The inter-onset interval falls 1.700s → 0.994s, a ratio of **1.711 against
1.707 predicted**. Not 2.00: the full doubling needs the wrap interval, which
does not sit between two onsets. Predicting the number you can actually observe
is the point — predicting 2.00 here would be predicting a different experiment.

**The bell flattens the density but does not abolish it.** Loudest moment
against quietest across one cycle, at five layers: **1.36x with the bell, 1.75x
without.** The control matches its own prediction of 1.75x exactly, and its
shape correlates at 0.971, so the measurement is trustworthy where there is
something to measure.

**Flatness is bought with layers**, which it must be, since it comes from the
ladder being long enough that the bell's edges are quiet:

| layers | predicted ripple | measured |
| --- | --- | --- |
| 2 | 66.9% | 58.2% |
| 3 | 46.5% | 46.6% |
| 4 | 34.9% | 26.9% |
| 5 | 25.3% | 31.3% |
| 6 | 17.7% | 14.0% |
| 7 | 11.9% | 16.1% |
| 8 | 9.0% | 14.5% |

The measured column stops falling around 14%, which is this measurement's own
noise floor rather than the sketch's. Adding that floor in quadrature to the
25.3% predicted at five layers gives 28.9% against 31.3% measured, so the
residual at the default setting is mostly the ruler.

So the honest headline is **not** "the density is constant". It is that the
density moves by about a third while every layer inside it doubles, and the gap
between those two numbers is the whole illusion. A genuinely constant density
would need an infinite ladder; what the sketch shows is exactly what a finite
one costs, which is more interesting than the idealisation.

Levels: 0.632 pre-limiter at five layers with the room off, 0.755 flat.

## What went wrong

**A capture tap records nothing while its input is disconnected, and that
deletes the silences.** This is the best bug I have had in a while, because it
manufactured precisely the result I was looking for.

The first run reported onsets 0.65 s apart when one layer should give 1.0 to
1.7 s, with intervals that were not shrinking at all. The plumbing line I had
added on a hunch gave it away: a 24 second capture came back **6.0 seconds
long** — 2051 blocks where 8270 were due, almost exactly the fraction of the
time a click was actually sounding.

The cause is that this sketch's clicks connect an oscillator to the bus and
disconnect it again, so between events the bus has no connected inputs at all.
Chrome then hands the capture worklet an empty input array, and
`capture.worklet.js` posts a block only `if (input && input.length)`. So the
recording skipped every silence and butted the clicks up against each other.
Every timestamp after the first was compressed toward its neighbour — which
turns an accelerating pulse into a steady one. **The instrument was producing
the exact answer the experiment existed to test.** A constant source at offset 0
into the same tap fixes it and costs nothing.

Every earlier harness in this repo tapped something continuously driven — a
master bus, a worklet that always outputs, a polysynth — so this has been
latent the whole time and only a sparse sketch could expose it.

**Two of my summary statistics were measuring nothing.** "Density at the start
of the cycle versus the end" is guaranteed to be ≈1 for any periodic curve
sampled over exactly one period, because the first and last samples are the
same phase; it dutifully reported 0.96 for the case that doubles. Loudest
against quietest is the quantity with content. And the correlation between the
measured and predicted density curves was −0.230 until I noticed the capture
starts whenever the tap starts while the cycle starts whenever the transport
does, with nothing aligning them: the curves are now compared at the best
circular shift, and the shift is printed rather than hidden.

**A low correlation on a flat curve is not disagreement.** The bell case
correlates at 0.407 against 0.971 for the control, and that is what should
happen: when the thing being predicted is nearly constant there is almost no
signal to agree about, and the residual is noise. The ripple magnitude is the
statement; the correlation only means something for the control, where there is
a real shape.

## The gate is getting unreliable, and that is now its own problem

The first `npm run smoke` after adding `escalator` failed `arc: silent` and
`attractor: silent`; the re-run passed everything, with `escalator` reproducing
at exactly 0.437 both times. That is the third day in a row with spurious
`silent` failures — four sketches on 2026-08-30, `arc` on 09-01, `arc` and
`attractor` today — every one cleared by re-running, and `arc` in two of the
last four runs.

Each time I have written it off as CPU contention, and each time that has been
consistent with the evidence. But a gate that cries wolf on a third of its runs
is training me to re-run rather than investigate, which is exactly how a real
regression gets waved through. It needs fixing at the gate rather than
explaining again: retry a sketch that reads silent before failing it, and make
the retry visible in the output so the flake rate is measured instead of
remembered.

## Next

- [ ] The bell edges are the whole cost. A window with lighter tails — a
      raised cosine over a fixed span rather than a Gaussian — should flatten
      the density at fewer layers, and the prediction is computable before
      building it.
- [ ] Measure the *illusion* rather than the construction: how many cycles can
      a listener follow before the seam becomes apparent? That needs ears, but
      the machine version is to ask at what cycle length the loop becomes
      detectable by autocorrelation of the envelope.
- [ ] Shepard pitch and Risset rhythm at once, which is the entry `ideas.md`
      has always had: `staircase` and this share a ladder, so the two could run
      off one octave position.
- [ ] Non-octave ladders. Spacing the layers by a factor of 3 instead of 2 and
      making the cycle a tripling should work identically, and would sound
      completely different.
- [ ] The rhythm is currently a bare pulse per layer. Give each layer a
      Euclidean pattern rather than every pulse and the texture becomes music
      rather than a demonstration — but the density arithmetic has to be
      rederived, since the pattern changes the weight.
- [ ] `arc`, `staircase` and now this all shape a form longer than the 10 s
      smoke window. A gate that samples a full form per sketch is overdue.
