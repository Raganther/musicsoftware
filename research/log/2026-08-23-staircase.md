# 2026-08-23 — staircase: the rhythm recurs four times as often as the sound

**Sketches touched:** `sketches/staircase`
**Settings worth keeping:** the defaults — 6 layers, 24 s cycle, 4 octaves,
slowest 0.8/s, seed 5 — which is slow enough that no single layer ever draws
attention to itself. The demonstration is `Seam`: leave it at 0 for a minute so
the illusion settles, then take it to 1 while it plays. The tempos and the
notes do not change at all, and it stops being a staircase and becomes an
ordinary four-bar loop. 8 layers with a 40 s cycle is the most convincing and
the least interesting to look at.

## What I tried

Wild/strange, the stalest family (last visited 2026-08-18, tartini).

Two days ago `crossing` accelerated for real — the tempo goes up, stays up, and
the piece ends somewhere different from where it began. This is the lie:
Risset's rhythmic version of the Shepard tone, where every layer is genuinely
and continuously speeding up and the whole thing repeats exactly.

The construction is a staircase of pulse layers, each sliding up through four
octaves of tempo, evenly spaced around the same loop. Each layer's loudness is
a bell over its position — silent entering at the bottom, silent leaving at the
top — so the jump from top back to bottom happens under cover of zero
amplitude. Nothing audible ever goes down.

Pulses come from the same closed form as `crossing`,
u_n = ln(1 + n·k/r0)/k with k = S·ln2/L. Adding intervals would drift, and the
entire claim is that the cycle closes exactly.

## What I measured

**It repeats, and only at the cycle.** Correlating the *stack* of per-band
envelopes, which keeps track of which layer is doing what:

| lag | 3 s (L/4) | 6 s (L/2) | 12 s (L) |
| --- | --- | --- | --- |
| stacked by layer | −0.18 | −0.23 | **0.960** |
| mix envelope alone | 0.938 | 0.930 | 0.947 |

A search over every lag from 1 to 14 s puts the strongest true repeat at
**12.00 s**, exactly the cycle.

The second row is the better finding and I did not go looking for it. The
envelope of the mix cannot hear pitch, so it repeats every time the layers
merely swap places — every L/N. **The rhythm recurs four times as often as the
sound does.** That is almost certainly a large part of why the illusion works:
by the time the ear has anything to compare against, it has already heard the
same rhythmic figure three times at what appear to be different pitches.

**The wrap is silent**, with `Seam` as the control. Band energy at each layer's
own wrap instant, against that layer at its loudest:

| seam | 0 | 0.5 | 1 |
| --- | --- | --- | --- |
| energy at the wrap | **2.9%** | 62.9% | 122.5% |

**Each layer doubles four times across the cycle.** Rates at p = 0.25 and
p = 0.75, half a cycle apart, should differ by 4×: measured **5.20, 4.38,
4.20** for the upper three layers.

Peak 0.521 in the suite. Green: 30 sketches + jam, no clipping, clean teardown.

## The one I could not fix

The lowest layer sits at 92 Hz and its band never came clean. It hears **231
onsets where 90 exist**, and only 45 of those match a predicted pulse, with
±32 ms of scatter. Every other layer matched *every* audible pulse — 106/106,
73/73, 79/79 — at 13–30 ms of lag.

Two things I did fix on the way, both worth keeping:

The envelope box has to be at least one *carrier* period long. A flat 4 ms box
is fine at 370 Hz and far too short at 92 Hz, where the rectified ripple at
185 Hz sails straight through it and re-triggers the detector; it read 9.4
pulses per second where 1.6 existed. Making the box exactly one carrier period
nulls the ripple and every harmonic of it — the same fix `continuum` needed and
that I did not think to carry over.

And the rate estimator should take the **longest** intervals, not the median.
The known-answer channel says the detector finds every real pulse and invents
some extras; an extra can only ever *split* an interval, never lengthen one, so
the long intervals are the uncontaminated ones. Switching from the median to
the 90th percentile took layer 0's apparent doubling from 1.32× to 3.97×. It
biases a little high in exchange, which is why the ratios above sit at 4.2–5.2
rather than on 4.00, and that is the honest cost.

What defeated the lowest band is that raising the sketch's gain made it worse.
At the level I first measured, layer 0 matched 90 of 90; at the shipped level
it matches 45. Louder neighbours mean more attack splatter into the one band
that has no room below it. So the measurement is level-dependent, which is not
a property I want in a harness and not one I noticed until the last run.

## The recurring failure, day twenty-two

Not invention, and the known-answer channel worked again — but it caught
something at the *last* moment rather than the first, and only because I
re-ran it after changing the gain.

I had "90/90 pulses matched" from an early run and was about to write it into
the notes. The gain changed twice after that measurement, for level reasons
that had nothing to do with the detector, and I re-ran only because quoting a
number measured at a different setting felt wrong. It was: the real figure at
the shipped level is 45/90 for that layer. The near-miss was not a wrong number
but a **stale** one — measured honestly, on a build that no longer exists.

That is a new failure mode for this log and it has an obvious rule attached:
the numbers that go in the notes have to come from the build being committed,
not from the build that was convenient to measure. Every parameter I touched
after measuring invalidated the measurement, and nothing announced it.

## Next

- [ ] Give the lowest layer somewhere to hide: a band-limited click instead of
      a bare sine, or simply start the stack higher. The measurement problem is
      real but it is also a sound-design problem — 92 Hz pings are muddy.
- [ ] Tie pitch to position as well as tempo, so it is a Shepard tone *and* a
      Risset rhythm at once. Everything rises, nothing arrives. Band separation
      gets much harder, which is exactly why it is worth doing.
- [ ] Downward. The same construction inverted should feel like falling
      forever, and there is a claim in the literature that descending Shepard
      tones are less convincing — testable with the same harness.
- [ ] A control that is *not* the amplitude bell: hide the wrap with masking
      instead (a noise burst at the seam), and see whether the illusion
      survives at seam 1.
- [ ] Let the transport tempo drive the cycle length, so a jam can put the
      staircase against something that really is periodic.
