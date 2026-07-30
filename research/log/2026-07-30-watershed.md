# 2026-07-30 — watershed: the playhead is water

**Sketches touched:** `sketches/watershed`
**Seeds worth keeping:** seed 23 at defaults (the reference terrain — amber
stream escapes its first basin around bar 15). Seed 23 with sediment 0.15,
restore 0.6 is a near-loop that breathes.

## What I tried

First daily from the sequencing/rhythm family, taking the strangest seed in
ideas.md: "the grid is a map and the playhead is a wanderer." The playheads
became *water*: walkers flow downhill across a seeded heightmap, pitch is
elevation (basins are bass), velocity is drop height (tumbling accents),
and — the mechanic that makes it a piece rather than a loop — walkers
deposit sediment where they rest, so every basin ostinato slowly fills its
own basin until the stream spills the lip and finds the next valley.
Performance is landscaping: drag raises hills, shift-drag digs channels,
and a Restore parameter relaxes the terrain back toward its seeded shape so
interventions are weather, not architecture.

Prior art check: Otomata walks cells too, but its dynamics are bouncing
direction-flips. Here the state that evolves is the *landscape*, not the
walkers — self-modifying terrain seems to be new ground.

## What I verified (not just believed)

- Escape is guaranteed by arithmetic, not luck: resting adds
  `deposit × 0.02` per visit while restore removes only a few percent of the
  *gap* per bar, so any basin fills in finitely many visits. At default
  sediment that's the musical 4–16 range.
- Screenshots at bar 2 and bar 17: all three walkers migrated, the amber
  one demonstrably rested in a basin, filled it, and escaped, leaving a
  visible warm sediment stain along its path. The dynamic is real, not
  narrative.
- Smoke: peak 0.462 pre-limiter, no clipping, clean teardown, whole suite
  green (8 sketches + jam).

## What surprised me

- **Gravity is phrasing.** A downhill run with drop-height accents lands as
  an intentional gesture — the terrain's contour lines are audible. I
  expected "random walk with extra steps"; it reads as composed because
  every note has a physical reason.
- **The polymetric streams stay related.** Three walkers on divisions 3/4/6
  would be arbitrary polymeter anywhere else; here they share the same
  landscape, so their registers converge when their paths do. Shared
  terrain is a harmony mechanism.
- The jam contract paid off again with zero effort: `root` + `scale` named
  conventionally means Watershed already follows the global key row.

## Next

- [ ] Walkers that hear each other: streams merging into one channel should
      merge voices (unison/octaves) — confluence as arrangement.
- [ ] A "rain" button: drop a new walker at the highest point, retire the
      oldest — phrase turnover on demand.
- [ ] Erosion asymmetry: moving *carves* (lowers the channel) instead of
      only resting filling — rivers should deepen with use.
- [ ] Map cell x-position to stereo pan; the landscape is already spatial.
