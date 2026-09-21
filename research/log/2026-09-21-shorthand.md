# 2026-09-21 — shorthand: the shortest way to write a tune down

**Sketches touched:** `sketches/shorthand`
**Settings worth keeping:** the defaults — 64 notes, structure 0.6, seed 11,
tolerance 0, rhymes 3–16, G dorian from root 55. The demonstration is the `Play`
select: `all` is the tune, `skeleton` is only the notes somebody had to *choose*,
and at the defaults that is 13 notes of 64. Hand somebody those thirteen and the
rhyme list and they have the piece.

## What I tried

Composition tools, the stalest family — last visited 2026-09-16 with `tuplet`.
Two unstruck ideas from `rhyme` join up: *"Export only the free notes as the
score — the compression claim made real"* and *"a rhyme with a **tolerance**."*

`rhyme` was handed the structure — "bar 5 is bar 2, up a third" — and solved for
the notes. This asks the question the other way round: given the notes, *find*
the structure. And the way to make that precise is to ask what the shortest
description is.

Written as a coding problem it is Lempel–Ziv, with one change that makes it
music. LZ77 parses a string left to right into literals and back-references; a
back-reference here may also be transposed, inverted or reversed, which is a
composer's vocabulary rather than a compressor's. And because the parse runs
left to right, each token's position is *implicit* — so the cheapest description
is a shortest path over note positions and the optimum is a dynamic program, not
a search. That is the whole trick, and it is why there is an exact answer to
report rather than a heuristic's output.

## What I measured

Everything is `sketches/shorthand/parse.ts`, checked in node before anything
made a sound. The code is written out in `bits`, because a description length is
only a number if the code is.

**Two gates first.** A description that does not rebuild the tune is not a
description, and a "shortest" one is only shortest if nothing shorter exists:

| | result |
| --- | --- |
| `realise(parse(d)) === d` at tolerance 0, over composed / walk / noise | **180 of 180 exact** |
| the dynamic program against an exhaustive search sharing none of its bookkeeping | **95 of 95, gap 0.0e+0 bits** |

The exhaustive search is a plain recursion with no memoisation at all, so it
shares nothing with the DP but the cost function.

**What compresses.** Bits per note, against the 5.00 a flat list of degrees
costs:

| tune | bits/note | ratio | notes you must write |
| --- | --- | --- | --- |
| composed, structure 0.7 | 3.17 | 0.634 | 21.3 of 80 |
| composed, structure 0.5 | 3.32 | 0.664 | 25.0 of 80 |
| composed, structure 0.3 | 3.39 | 0.679 | 27.0 of 80 |
| random walk | 4.57 | 0.913 | 43.0 of 80 |
| uniform noise | **4.99** | **0.998** | 77.6 of 80 |

Noise is incompressible to within 0.2%, which is the control that says the rest
is not an artefact of the code. A random *walk* is not: it compresses 8.7%,
because a walk really does repeat small shapes by accident.

**A transform is worth exactly what the tune contains.** This is the table the
first pass got wrong — it measured how much inversion helps on tunes built
*using* inversion, which is circular. Done with controls:

| tune built with | transpose only | + invert | + retro | all three | best saving |
| --- | --- | --- | --- | --- | --- |
| transposition only | 3.148 | 3.138 | 3.131 | 3.120 | **0.9%** |
| inversion too | 3.496 | **3.183** | 3.450 | 3.170 | 9.3% |
| all three | 3.725 | 3.449 | 3.468 | 3.185 | 14.5% |
| nobody — a walk | 4.777 | 4.685 | 4.681 | 4.567 | 4.4% |
| nobody — noise | 4.999 | 4.995 | 4.994 | 4.989 | **0.2%** |

Read the second row across: on tunes that contain inversions, *allowing
inversion* gives 3.183 where allowing retrograde instead gives 3.450. It finds
the transform that is there, and on noise the whole vocabulary buys 0.2%. Both
halves matter — a detector that finds structure everywhere is not a detector.

**And it contradicts a prediction I took from `develop`**, which found that
invert (+0.25) and retrograde (+0.23) mattered least of its operations because
involutions open almost no new space. I predicted the same here and wrote it
down before looking. They are worth 9.3% and more. The contradiction dissolves
on inspection and the lesson is the useful part: `develop` measured what a
transform is worth for *reaching* a target, and this measures what it is worth
for *describing* one. A transform that opens no new territory can still be the
cheapest way to say where you already are.

**The parser beats the composer, 199 times in 200** (equal once, never worse).
Given a tune built *from* a description, it finds a cheaper one — 15.7% to 17.7%
cheaper. Which makes "did it recover the structure I planted" the wrong
question, and recovery duly pools to a dismal 33%. Asked by length it makes
sense:

| planted rhyme length | 3 | 4 | 5 | 8 | 10 | 12 | 15 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| recovered | **0.0%** | **0.0%** | 39.1% | 51.5% | 58.9% | 69.2% | 66.0% |

A three-note rhyme is not a fact about a tune. It is one of several equally
cheap readings, and the parser picks another. Long ones are real.

**A tolerance is not a bound on the error.** `Tolerance` 1 cuts the description
by 33% — 4.57 to 3.08 bits per note on a random walk, and free notes from 43 to
16.5 — for a mean error of 0.61 degrees. But the worst error is **4**, and 454
notes in 4,800 end up further off than the tolerance allowed:

| tolerance | mean error | worst | notes over tolerance | worst ÷ tolerance |
| --- | --- | --- | --- | --- |
| 1 | 0.610 | **4** | 454 of 4,800 | 4.0 |
| 2 | 1.167 | 6 | 507 of 4,800 | 3.0 |
| 3 | 1.567 | 8 | 441 of 4,800 | 2.7 |

The cause is chaining: a span fitted loosely becomes the source for the next
one. Reference chains run up to **5 deep** and average 1.56 at tolerance 1
against 0.63 at tolerance 0. "Roughly that phrase, up a third" is a promise
about one step, not about the result — which is a real hazard for the
least-squares version of `rhyme` that this was supposed to be a step toward.

**From the sound.** The parse is a schedule, so the audio is checked against it
rather than by detecting onsets blind. First that the sketch is describing the
same tunes the numbers came from — bits and free-note counts, sketch against the
node model:

| tune | tol | model bits | sketch bits | model free | sketch free |
| --- | --- | --- | --- | --- | --- |
| composed | 0 | 175.4 | 175.4 | 13 | 13 |
| composed | 1 | 150.0 | 150.0 | 9 | 9 |
| composed, no transforms | 0 | 177.3 | 177.3 | 14 | 14 |
| walk | 0 | 298.1 | 298.1 | 35 | 35 |
| noise | 0 | 320.0 | 320.0 | **64** | **64** |

Five of five exact, and noise has 64 free notes of 64: nothing about it is worth
saying twice.

**Then the claim itself.** `Play: skeleton` should sound at exactly the free
positions and nowhere else, which is a partition and therefore has no threshold
to tune. Measuring the *rise* at each step boundary rather than the level in it:

| Play | steps | rise at free notes | rise at derived notes | agreement |
| --- | --- | --- | --- | --- |
| all | 74 | 0.17087 | 0.20557 | 98.6% |
| skeleton | 74 | **0.40750** | **0.00000** | **100.0%** |
| derived | 74 | **0.00000** | 0.16789 | **100.0%** |

Exactly zero, both ways round. The thirteen notes are the thirteen notes.

Levels: **0.517** at the defaults and 0.752 worst over seven settings.

## What went wrong

**My first ablation measured what I had put in.** The generator uses inversion
25% of the time and retrograde 20%, and the first transform table was computed
only on tunes it had made — so "allowing inversion saves 7.4%" was a statement
about the generator, not about music. The fix is the control row: tunes built
with transposition alone, where the whole extra vocabulary buys 0.9%, and noise,
where it buys 0.2%. Same shape of error as `afteryou`'s circular backoff sample
two days ago, and it is worth naming the pattern: **if the thing you are
measuring the value of also appears in how you made the data, you have measured
your generator.**

**The first onset detector could not tell a new note from an old one.** These
notes ring for up to five steps, so the level inside a step window is mostly the
previous note's tail — and thresholding it put `skeleton` at 93.2% agreement
with an 8.5x contrast, which looks like a result and is a measurement artefact.
An onset is a *rise*, which a decaying tail cannot fake; on that the same audio
reads 100.0% and exactly 0.00000. Fifth sketch in this repo to hand-roll an
onset detector and get it wrong on the first try.

**And I checked recovery before checking whether recovery was answerable.** 33%
looks like a failure and is not: the parser is finding *better* descriptions
than the planted ones in 199 of 200 tunes, so the planted parse is essentially
never the optimum, and a parse cannot both be optimal and agree with it. The
cost comparison was the test that meant something and it was already passing.
Splitting recovery by rhyme length turned a bad number into the actual finding.

## Next

- [ ] Point it at real tunes rather than generated ones. Everything here is
      measured against structure I planted, which is the right way to test a
      tool and the wrong way to learn anything about music.
- [ ] Rhythm as well as pitch: `elastic` showed durations are affine in log
      time, so a rhyme could carry both and the parse would find augmentation.
      That is also the half `develop` is missing.
- [ ] The tolerance chains, so bound the *realised* error rather than the
      per-step one: a token's tolerance should shrink with its source's depth.
      One line in `fit`, and it turns the hazard above into a guarantee.
- [ ] Entropy-code the tokens. Every cost here is a flat log2, which is an upper
      bound; a real code would price a short back-reference far below a long
      one and might change which parse wins.
- [ ] Let the parse reference *forward* as well as back. Music does — a theme is
      often stated after the material it explains — and it turns the shortest
      path into a genuinely harder problem.
- [ ] Two voices at once, where a rhyme may point into the other part. That is
      `canon`'s object seen from the description side, and neither sketch knows
      about the other.
