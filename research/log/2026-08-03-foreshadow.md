# 2026-08-03 — foreshadow: playing a bar into the future

**Sketches touched:** `sketches/foreshadow`
**Seeds worth keeping:** seed 12 at defaults (lead 1 bar, 2-bar loop, ghost
0.35) is the reference. Seed 12 with lead 0.25 and grid 1/16 is the
"almost-normal" version, useful for feeling how much the lead is doing.

## What I tried

Improvisation/performance, the stalest family. The idea from ideas.md I had
not touched: *an instrument with deliberate latency — you commit a gesture a
bar ahead.*

Keys you press do not sound. They are committed to a looping ring at a
position `lead` ahead of the playhead, and you hear them when the playhead
arrives. So you listen to your past self while playing your future one, and
to land a phrase on a downbeat you must play it a bar early. The ring decays
— each pass costs a note a life — so material fades unless refreshed, which
makes it a garden tended at one bar's remove rather than a keyboard.

## What I measured

The whole sketch rests on the delay being real, so I measured the gap between
a keypress and the note it produces, with the ghost player and commit tick
disabled and the ring emptied:

| lead | measured gap | expected |
| --- | --- | --- |
| 1 bar | 2.400 s | 2.500 s (96 bpm) |
| 0 | 0.232 s | — |

100 ms early at lead 1, which is inside the one-eighth-note grid the commit
snaps to. Peak 0.5 pre-limiter. Suite green: 12 sketches + jam.

## The bug the timing test caught

Nearest-grid quantising can round a commit **down**, landing it just behind
the playhead — where it then waits an entire loop to sound. At lead 1 this is
invisible (the note is a bar away regardless). At lead 0 it is fatal: the
test found a keypress that produced no sound at all within four seconds,
because it had landed one grid cell in the past and was waiting two bars.
Commits are now never allowed to land behind the playhead.

Worth noting the shape of it: the bug was undetectable at the default setting
and only appeared at the edge of the parameter's range. Testing the mechanism
at one value would have missed it entirely.

## What I could not verify, and said so

I wrote a paragraph claiming this is "easier than it sounds, because you are
predicting against a loop you already know", and another claiming it breaks
down past lead 2. Both are plausible and neither is a finding — I can measure
latency but I cannot play the instrument, and the difference matters. Rewrote
the notes to mark them explicitly as design reasoning awaiting a human.

This is a different failure mode from the last few days. Those were confident
wrong *numbers*; this is a confident claim about *experience*, which no amount
of measurement can settle and which is therefore easier to smuggle past
myself. Worth watching for.

## What surprised me

- **Acknowledgement and output are separate jobs.** With no tick on commit,
  the instrument reads as broken — you press, nothing happens for 2.5s, you
  press again, and now two notes are committed. A quiet high tick fixes it
  completely without touching the musical output. Obvious in hindsight, and I
  did not design it in from the start.
- Quantising is doing much heavier lifting here than in an ordinary
  sequencer: your playing is tidied *on the way into the future*, so the loop
  is always more precise than the performance that produced it. Setting grid
  to "free" makes that unmistakable.

## Next

- [ ] Someone should actually play it and settle the two open hypotheses.
- [ ] A piano-roll ring instead of pitch-as-radius, which goes to soup past
      two octaves.
- [ ] Variable lead per note — hold a modifier to commit further out, so a
      single performance spans several time horizons.
- [ ] Lead as a jam-wide parameter: every channel writing a bar ahead would
      make the whole rack a prediction exercise.
