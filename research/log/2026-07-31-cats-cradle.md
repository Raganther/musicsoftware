# 2026-07-31 — cat's cradle: representation as the instrument

**Sketches touched:** `sketches/cats-cradle` (new), `sketches/watershed` (fix)
**Seeds worth keeping:** seed 8 is the reference — an eight-node arch
(G3 A3 C4 D4 C4 A3 F3 D3) whose inversion is a clean valley. Seed 8 at
stretch −1 with harmony −2 is the demo. Seed 8 at stretch 0.35 is the same
tune whispered.

## What I tried

First daily from **composition & arrangement tools** — the only family in the
rotation never used, and the one `interaction-models.md` flagged as the
emptiest cell in the repo.

The idea: a melody that stores **intervals, not pitches**. Every note is a
scale-degree step from its predecessor; absolute pitch is derived and never
stored. The claim being tested is that a representation decides which musical
ideas are cheap — transpose, invert, augment and retrograde are laborious
multi-note edits in a piano roll, and here each is a single parameter.

## What I verified

Rather than assert the algebra, I reproduced `derive()` in the page against
the same seeded chain and checked the four transformations element-by-element:

- stretch 0 → every degree identical (monotone; rhythm survives, pitch dies)
- stretch 0.5 → exactly half of every degree, **contour sign-for-sign
  identical** to the original
- stretch −1 → exact mirror (`neg[i] === -base[i]`), contour negated
  element-for-element. Audibly: arch `G3 A3 C4 D4 C4 A3 F3 D3` becomes
  valley `G3 F3 D3 C3 D3 F3 A3 C4`, anchor fixed.
- stretch 2 → exactly double

Pre-limiter peak 0.438. Whole suite green (9 sketches + jam).

## What did not work

My first version scaled each interval and **rounded it to a degree before
accumulating**. At stretch 0.5 that quantised distinct intervals (+1 and +2)
onto the same rounded step, so separate phrases collapsed into stuttering
repeats — the melody didn't shrink, it *disintegrated*. Fix: accumulate in
continuous degree-space and round only at the instant a note sounds. Verified
by the distinct-degree count staying at 4 at half stretch rather than
collapsing to 1–2.

## What surprised me

- **Stretch is a continuous knob through a space a piano roll cannot
  express.** Not just "inversion" and "augmentation" as discrete commands,
  but everything between and beyond: 0.35 is a timid version of the same
  idea, −2 is an inverted version with widened leaps. Sweeping it live is the
  best gesture in the sketch, and it's only possible because the pitches were
  never the source of truth.
- **The ghost outline is the whole explanation.** Showing the untransformed
  chain as a dashed line next to the live one makes "the shape is bent, not
  replaced" self-evident in one glance. Cheaper than any amount of prose —
  which is exactly the lesson I'd just learned the hard way on Watershed.

## Watershed legibility fix (same session)

A reader could not tell what Watershed's squares meant, and they were right
to be confused. Diagnosis: sediment was drawn as a hue shift **within the
blues** — measured at 4–10° at realistic build-ups, plus +0.4% lightness per
repeat. The central mechanic was audible but effectively invisible, and worse,
I'd described a "visible warm sediment stain" from a screenshot without
checking. Three fixes: a warm overlay in a genuinely different colour, a fill
level rising in a resting pool toward its escape lip, and a flash on the
square a walker lands on. All three confirmed rendering.

The general lesson, and it's the same one Cat's Cradle stumbled into from the
other direction: **state that exists but isn't rendered may as well not
exist.** Both sketches store the interesting thing (accumulated sediment; the
untransformed chain) and both only became legible when that hidden state was
drawn.

## Next

- [ ] A second chain whose intervals are defined *against the first* — real
      counterpoint as a constraint system rather than two independent lines.
- [ ] Let a node reference a node other than its predecessor: the chain
      becomes a graph, and motifs can recur by reference.
- [ ] Rhythm deserves the same treatment — store duration *ratios*, so
      swing and augmentation become one knob each too.
