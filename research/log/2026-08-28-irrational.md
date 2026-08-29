# 2026-08-28 — irrational: the simplest rhythm that never repeats

**Sketches touched:** `sketches/irrational`
**Settings worth keeping:** the defaults — α = 0.618034, snap 0, 3 voices, root
45 minor, seed 4. The demonstration is `Snap`: leave it at 0 for a minute so
the pattern settles into your ear, then take it to 8 while it plays. The tempo
does not change, the density does not change, the local feel does not change at
all — and it starts coming round every eight steps. Then back to 0 and the loop
dissolves. π − 3 (α = 0.141593) is the instructive failure: it *sounds* like it
loops, because 16/113 is such a good approximation that its apparent period is
113 no matter how long you listen.

## What I tried

Sequencing/rhythm, the stalest family (last visited 2026-08-21, `crossing`).

Every canon in this repo so far has a rational tempo ratio, so it comes back.
`convergence` converges every 5.19 s, `tiling` closes its cycle exactly,
`crossing` sweeps continuously but the algebra still says where the voices
meet. Make the ratio irrational and none of that exists.

The construction is the characteristic Sturmian word,

    s(n) = ⌊(n+1)α + β⌋ − ⌊nα + β⌋

a hit on step n or not, at density α. That is the same bucket-and-wrap that
generates a Euclidean rhythm — `euclid()` in the core accumulates `pulses` per
step and fires on each wrap, which is precisely ⌊(i+1)p/q⌋ − ⌊ip/q⌋ — so at
rational α this *is* E(p,q), and at irrational α it carries on doing what
E(p,q) does without ever closing.

## What I measured

**The rational case, against a characterisation rather than a copy.**
Re-transcribing `euclid()` in the harness would only prove I can copy a loop.
So the oracle is a property of the *set*: a Euclidean rhythm is the maximally
even one, meaning the count of onsets inside a window of length L varies by at
most 1 over every position of that window, for every L. That is checkable
without knowing how the set was built. Twenty p/q pairs from 2/3 to 13/24:

| | |
| --- | --- |
| maximally even, with exactly p onsets in q steps | **20 of 20** |
| onset positions equal ⌊k·q/p⌋ up to rotation | **20 of 20** |

**The irrational case.** Eight constants — 1/φ, φ−1 squared, √2−1, √3−1, π−3,
e−2, ln 2, 1/√5:

| | |
| --- | --- |
| exactly n+1 distinct windows of length n, for n = 1…24 | **8 of 8** |
| exactly two gap lengths, and they are ⌊1/α⌋ and ⌈1/α⌉ | **8 of 8** |

n+1 is the definition of a Sturmian word, and it is the precise sense in which
this is the **simplest possible** rhythm that never repeats: one factor more
than the length. A periodic rhythm saturates at its period; a random one runs
off toward 2^n. This is the least surprising way to never come back.

**And it is audible.** Three bands sampled on the known grid over 32 s, a hit
read as a *rise* across the grid point because the previous hit is still
ringing:

| | notes recovered | strongest repeat |
| --- | --- | --- |
| snap 0 | **229 of 229** | lag 34, r = 0.935 |
| snap 8 | **228 of 228** | lag 8, r = **1.000** |

That is the whole piece in two numbers. Snapped, the autocorrelation of what
you actually hear reaches exactly 1 at the period. Unsnapped, the best it ever
manages anywhere is 0.935 — and at lag 34, a Fibonacci number, which is where a
golden-ratio word comes closest to itself without arriving.

## The finding I did not expect

**"Never repeats" is a claim no listener can support, and the sketch now says
so.** A double is a rational with a denominator near 2^52, so the word is
always eventually periodic. Long before that, a finite window cannot tell an
irrational from its best rational approximation — and the apparent period is
exactly the denominator of that approximation.

I measured it two ways. One by comparing the generated bits at every lag; the
other derived from number theory alone, never consulting the word: write
qα = m + δ, and the word repeats at lag q precisely when adding δ to the
fractional parts {nα+β} never carries one across an integer.

| α | window 400 | 1200 | 3000 |
| --- | --- | --- | --- |
| π − 3 | 113 | 113 | **113** |
| ln 2 | 277 | 642 | 642 |
| 1/√5 | 199 | 682 | 682 |
| √2 − 1 | 169 | 408 | 1393 |
| φ−1 squared | 144 | 987 | none ≤ 1400 |
| **1/φ golden** | 233 | 377 | **none ≤ 1400** |

**24 of 24** agree between the two methods.

π − 3 is a poor choice for an aperiodic rhythm and the golden ratio is the best
one, which is exactly what "worst-approximable" means — 16/113 approximates
π − 3 so well that no listening window resolves the difference. The golden
ratio has no such fraction, which is the whole content of φ being the number
hardest to approximate. It is nice to have that turn up as an audible property
of a drum pattern.

And `Snap` puts a number on what it costs. At 13/21 the complexity is 5, 9, 17,
21 for n = 4, 8, 16, 24 — exactly n+1 until it reaches the period, then flat
forever.

## What went wrong

**A peak of 3.010 that a 24-second run could not see.** The three voices are at
110, 165 and 247 Hz — a 2 : 3 : 4.5 ratio, consonant on purpose — so when all
three land on the same step their waveforms add *in phase* and the master sees
three times one hit. Coincidences of three irrationally-spaced voices are rare:
a 24 s run read 0.335 and a 35 s one read 3.010, from the same build with the
same parameters. Staggering the voices by 4 ms each removes it entirely, and
the same configuration now reads 0.579 over 75 seconds.

The lesson is about the measurement rather than the fix. **A peak is a maximum,
so a short run does not estimate it — it under-reports it, always, and by an
amount that depends on how rare the worst case is.** Every level in this repo
has been checked over 20–40 seconds. That is fine for a sketch whose loudest
moment comes round every bar and useless for one whose loudest moment is a
coincidence.

**And I spent three runs reasoning about which parameter caused it** — Room?
hit length? the accent? — before doing the obvious thing and changing one at a
time. The sweep took four minutes and answered it immediately: none of them.
Every configuration sat between 0.20 and 0.50, which is what told me the cause
was not a parameter at all.

One thing I could not explain: the same configuration read 1.9 when measured
inside the audio-capture script and 0.579 in four repeated A/B runs with the
capture tap attached and detached. The capture tap is not the cause — that A/B
is clean and repeatable. Something else about that script differs and I have
not found it. No shipped number depends on it: the levels quoted here come from
the parameter sweep and from the smoke suite, which agree with each other.

## And the gate was making the same mistake

`npm run smoke` failed once on `call-response: silent` and passed on a re-run
with nothing changed. Chasing that found the same defect as above, in the thing
whose whole job is to catch it.

`sample()` read a 2048-sample analyser — a **46 ms window** — once every
**100 ms**. Fifty-four milliseconds in every hundred were never examined. For a
dense sketch that hardly matters, because the peak comes round again. For a
sparse one it is the difference between a number and a coin flip, and
`call-response` deliberately answers *after* a silence, so its single response
either lands in a sampled window or does not exist.

The meter now runs in the page on a 20 ms interval, so the windows overlap and
the timeline is covered.

**Correction, 2026-08-29.** What was written here originally was a before/after
table — watershed 0.542 → 0.839, staircase 0.508 → 0.775 — presented as showing
that sparse sketches had been under-reported by about half. That table does not
support that claim and I should not have published it. It compared one run of
the old meter against one run of the new one, and these are generative
sketches: two runs of the *same* meter the next day gave watershed 0.872 and
0.520, and `bow` silent then 0.558. The run-to-run spread is as large as the
effect I attributed to the fix.

I also guessed at a mechanism — that Chromium was throttling the in-page timer
— and that is wrong too. Measured directly, the interval ticks 50 times a
second with the anti-throttling flags and 49.9 without them, four runs.

The honest measurement is a within-run one: meter the same signal two ways at
once, one accumulating every 20 ms and one only looking every 100 ms as the old
driver did. Same audio, same window, so the only difference is the gap.

| sketch | continuous | every 100 ms | under-reported |
| --- | --- | --- | --- |
| watershed | 0.873 | 0.767 | 12.2% |
| groove | 0.194 | 0.187 | 3.9% |
| staircase, irrational, crab, step-sequencer, arc, bloom, tartini | — | — | 0.0% |

**Mean 1.6%, worst 12.2%.** The sampling gap was real and worth closing, and it
is nothing like fifty percent. The change stands; the evidence I gave for it
did not.

The same probe found something the gate had been missing for far longer, which
is in `research/log/2026-08-29-crab.md`.

That is two instances of the same error in one day, found independently: a peak
is a maximum, and a maximum cannot be sampled sparsely. It has to be
accumulated.

## Next

- [ ] Two voices whose *densities* are α and 1−α, so between them they hit every
      step exactly once. That is a tiling canon with an irrational rhythm, which
      `tiling` cannot express.
- [ ] Sturmian words are exactly the cutting sequences of a line through a grid.
      Drawing that line and letting it be dragged would make the whole thing one
      gesture, and the slope is the only parameter there is.
- [ ] The three-distance theorem for the *positions* rather than the gaps: with
      the offsets β spread over several voices, the inter-voice gaps should take
      exactly three values. One more exact prediction from the same construction.
- [ ] Christoffel words as the finite version — the exact rational rhythms that
      are the convergents of an irrational one. Snapping already lands on them;
      naming them would make the tool teach.
- [ ] Let α drift slowly. The rhythm would pass through its own convergents in
      order, locking briefly at each and slipping between, which is a form nobody
      has to compose.
- [ ] The smoke meter is continuous now but still only watches 2.4 s per
      sketch. `irrational` needed 35 s to show its worst case. Either watch for
      longer or compute the worst case rather than waiting for it.
