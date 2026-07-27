# Generative systems

Notes on making software that produces music rather than plays it back.

## The central problem

Randomness is boring and rules are rigid. Everything interesting lives in the
gap. A useful frame: a generative system has a **surprise budget**. Too little
and it's a loop; too much and the listener stops perceiving intent and starts
hearing noise.

`sketches/euclidean-drift` exposes this directly as its Drift parameter, and
the interesting region is narrow — roughly 0.2-0.35. Worth testing whether
that narrowness is inherent or an artefact of that particular design.

## Techniques, roughly by how much structure they impose

**Euclidean rhythms.** Distribute *k* pulses as evenly as possible over *n*
steps. E(3,8), E(5,8), E(7,16) are tresillo, cinquillo and a lot of West
African and Latin patterns. Cheap, and almost everything it produces is
musically viable. Implemented as `euclid()` in `@core`.
Toussaint, "The Euclidean Algorithm Generates Traditional Musical Rhythms".

**Markov chains.** Learn transition probabilities from a corpus, then walk
them. First-order is usually too forgetful; second/third-order starts
plagiarising the source. `markov()` in `@core/random` is first-order — fine
for rhythm, thin for melody.

**L-systems.** String rewriting. Produces self-similar, hierarchical material,
which maps well onto phrase structure. Good for anything that should feel
"developed" rather than "sampled".

**Cellular automata.** Rule 30/110 over a grid of steps. Visually compelling
and rhythmically striking, but hard to steer — you get what you get.

**Random walks / drift.** The workhorse. Constrained Brownian motion over a
parameter, reflecting at bounds. Use for slow evolution, not note choice.
`walker()` in `@core/random`.

**Constraint solving.** Define what's forbidden (parallel fifths, leaps over a
seventh) and search. Expensive but produces material that sounds *considered*.
Unexplored here.

## Practical rules learned so far

- **Seed everything.** A generative sketch you can't reproduce is a slot
  machine. Always take an `rng(seed)` and expose the seed as a param.
- **Move parameters at phrase boundaries, not per note.** Advancing a random
  walk on every note reads as noise; advancing it at bar starts reads as a
  decision. `euclidean-drift` only advances on `s === 0` and it matters a lot.
- **Constrain pitch to a scale and you can be far more reckless elsewhere.**
  This is why `chord-loom` can afford to be probabilistic.
- **Cap your voices.** An unbounded generator will happily stack fifty
  overlapping notes into mush. `PolySynth` has `maxVoices` for this.

## Open questions

- Can a system convey *intent* without a plan? Everything here is memoryless;
  nothing sets up an expectation and then pays it off.
- What would it take to make a generator that gets *quieter* when it has
  nothing to say?
- Interaction between voices — currently every voice in `euclidean-drift` is
  deaf to the others. Ensemble behaviour is the obvious next thing to try.
