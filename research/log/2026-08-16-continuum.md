# 2026-08-16 — continuum: the tuning and the bar are one number

**Sketches touched:** `sketches/continuum`
**Settings worth keeping:** root A3, major, seed 3, 3 voices, ping 12 ms — then
drag `Octaves down` slowly from 0 to 6 and back. The demo is not the endpoints,
it is the crossing: somewhere around octaves 3 it stops being a chord and has
not yet become a rhythm, and it sits there for a good half-second of slider.
Seed 3 with tolerance 4¢ at octaves 5 is the other one to keep — a 46:58:69
polyrhythm that takes 6.7 seconds to come back round and never sounds random.

## What I tried

Sequencing/rhythm, the stalest family (last visited 2026-08-10, tiling).
Cowell's claim from *New Musical Resources*: rhythm and pitch are the same
thing at different speeds. Write a chord as whole-number frequency ratios — a
major triad is very nearly 4:5:6 — run three pulse trains at those ratios, and
one slider takes you from a chord at 220 Hz to a 4:5:6 polyrhythm at 6.9 Hz
with nothing switching over on the way.

The build is deliberately literal so that the claim is testable: an
AudioWorklet holding N phasors, each striking a damped sine at its own formant
when it wraps. No sequencer, no envelope generator, no note events. The only
thing the slider moves is the base rate.

## The thing I got wrong before measuring anything

The first version took the ratios from a "ratio limit" — the best rational
approximation to each scale degree with denominator no larger than N. I wrote
in the notes that this gives 4:5:6 for major and 10:12:15 for minor, which is
what everyone means by just intonation, and it is what the sketch's whole
framing depends on.

It does not. With limit 16 the best approximation to a tempered major third is
**19/15**, not 5/4 — nine cents closer, and the triad comes out 30:38:45. The
shipped default would have produced a 30-pulse cycle and I would have described
it as four.

Closest is the wrong question. What a tuner actually does is take the
*simplest* ratio that is close enough, so the param is now a tolerance in
cents and the search minimises Tenney height p·q inside it. At 20¢ major is
4:5:6 and minor is 10:12:15; at 12¢ you get 30:38:45 back; at 4¢ major is
46:58:69.

That was luck, not process: I only caught it because I sat down to compute the
expected numbers for the harness and they disagreed with the sentence I had
already written. Had the harness measured "the ratios on screen" instead of
"the ratios the theory predicts" it would have passed and shipped.

## What I measured

One detector, band-pass each voice at its own formant, rectify, smooth with a
boxcar exactly one formant period long (which nulls the carrier and every
harmonic of it, so the detector cannot report the ping's own frequency), then
autocorrelate the envelope. Root A3, major, tolerance 20¢ — 4:5:6.

| octaves down | base | measured pulse rates | as ratios | want |
| --- | --- | --- | --- | --- |
| 5 | 6.9 Hz | 6.88 / 8.59 / 10.31 Hz | 1 : 1.2496 : 1.4994 | 1 : 1.25 : 1.5 |
| 3 | 27.5 Hz | 27.51 / 34.37 / 41.32 Hz | 1 : 1.2495 : 1.5022 | 1 : 1.25 : 1.5 |
| 0 | 220 Hz | *(see below)* | | |

At the pitched end the loudest partials are at **219.4 / 274.5 / 329.7 Hz**
against 220 / 275 / 330 — inside one FFT bin (1.46 Hz). So the claim holds:
worst error 0.16% at the rhythmic end, under a bin at the pitched end, same
generator, one slider.

Before trusting any of that I checked the detector was reading the sketch and
not my expectations, by changing the ratios and requiring it to follow:

| | measured | want |
| --- | --- | --- |
| minor, 10:12:15 | 1 : 1.2001 : 1.5001 | 1 : 1.2 : 1.5 |
| tolerance 4¢, 46:58:69 | 1 : 1.2607 : 1.4999 | 1 : 1.2609 : 1.5 |

and spectrally, the middle voice moves 274.5 → 263.8 → 277.2 Hz across major,
minor and 4¢-major. Four decimal places on a ratio I would not have guessed.

**The number that is the same at both ends.** Every voice is a whole multiple
of base/ints[0], so the whole figure repeats after ints[0] pulses of the lowest
voice. At the rhythmic end that is the length of the bar. At the pitched end it
is the periodicity of the chord — and it is measurable as such:

| ratios | composite period, measured | want |
| --- | --- | --- |
| 4:5:6 | 55.04 Hz | 55.00 |
| 10:12:15 | 21.99 Hz | 22.00 |
| 46:58:69 | 4.78 Hz | 4.78 |

Tightening the tuning from 20¢ to 4¢ drops the periodicity of the chord by
three and a half octaves while the chord still sounds like a major triad, and
the identical change stretches the bar from 4 pulses to 46. Those are one fact.
I did not expect to be able to put a number on the cost of good intonation, and
it is 9 cents for 3.5 octaves of periodicity.

Levels: 0.377–0.518 across the slider at defaults, 0.692 worst case (six
voices, level at maximum). 0.453 in the suite. Green: 23 sketches + jam, no
clipping, clean teardown.

## What I could not explain

The per-voice method is exact up to base 78 Hz and then breaks completely:
every band returns the composite instead, at precisely 1/4, 1/5, 1/6 of each
voice's rate. I had three explanations and tested all three.

| | prediction | result |
| --- | --- | --- |
| pings overlap once the gap is short | shortening the ping to 2 ms moves the boundary | it did not |
| the band is too narrow to hold two of a voice's comb lines | widening it moves the boundary | widening made every setting fail |
| the third voice leaks into the others' bands | two voices should work | both bands still returned the composite |

So I do not know what sets it. What I can say is that the boundary is real,
sharp, independent of voice count, ping length and analysis bandwidth, and
sits between base 78 Hz and base 156 Hz — which is suspiciously close to where
the sketch's own bar says fusion happens, and might be a coincidence.

The thing I want to flag is the shape of the temptation here. There was a very
attractive sentence available — *"the measurement has the same two regimes the
ear does"* — and it is the sort of thing that reads as a finding. It is not
one. Three refuted hypotheses is the finding.

## The recurring failure, day fifteen

Not an invented number this time but an invented *design constant*, which is
day eight's failure returning: "major gives 4:5:6" was theory I was confident
enough about that I wrote it into the notes and built the parameter around it,
and it was false for every value the shipped default could take. The
`TODO:measure` marker does not catch this, because the claim is not a
measurement — it is arithmetic I did in my head and did not check.

What caught it was computing the expected values for the harness *separately*
from the sketch. That is worth keeping as a rule: the harness should never
import the sketch's own idea of what the answer is. Today it worked only
because I happened to compute expectations before writing the comparison; a
harness that had read `ints` off the page and checked the audio against it
would have been perfectly self-consistent and perfectly wrong.

## Next

- [ ] Find out what actually sets the 78 Hz boundary. A synthetic input with
      known formants and rates, fed to the same detector, would separate a
      property of the signal from a property of the analysis in one run.
- [ ] Draw the repeat cycle on the raster — the moment all voices coincide is
      the strongest event in the bar and it is currently invisible.
- [ ] Sweep the tolerance continuously while sounding and watch the cycle
      length jump: it is a staircase, not a slope, and the steps are the
      Stern–Brocot tree.
- [ ] Two independent chords on the continuum at once, at different octaves —
      one heard as harmony, one as rhythm, sharing a tuning.
- [ ] Let `Octaves down` be automated by the transport so the crossing itself
      is a musical gesture rather than a mouse drag.
