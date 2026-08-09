# 2026-08-09 — understudy: it learns your part and plays it before you do

**Sketches touched:** `sketches/understudy`
**Settings worth keeping:** the defaults. Nerve 0.92 is the measured knee — it
costs nothing on material it knows and drops to the noise floor on material it
doesn't. The demo is any six-note phrase played twice round, then stop: it
picks the part up within about twelve notes and carries it when you leave.

## What I tried

Improvisation/performance, the stalest family (last visited 2026-08-03). An
accompanist with no material of its own. Everything you play goes into a
variable-order Markov model over *intervals*; when it is confident enough
about both what comes next and when, it plays that note itself, at the top of
the step it expects you on. A keypress lands somewhere *inside* a step, so a
confident understudy is always fractionally ahead of you — you hear your own
next note arrive before you play it.

The instrument is the consequence: the more predictable you are, the more of
your part somebody else is playing.

## What I measured

The two voices are deliberately far apart in timbre so the understudy can be
measured on its own. Before using that, I checked it actually separates —
muting the understudy drops the 5-9 kHz band from **-56.6 to -70.6 dB** while
the 80-1500 Hz band does not move (-28.0 vs -28.1). So the high band is the
ghost, with 14 dB of headroom.

**Predictability summons it.** A fixed six-note loop against a seeded random
walk over the same nine keys at the same rate:

| | first 12 notes | last 12 notes |
| --- | --- | --- |
| fixed loop | -61.8 dB | **-55.2 dB** |
| random | -69.1 dB | -60.9 dB |

It learns you either way — even a random walk hands it repeated two-grams —
but it learns you faster and plays more when you repeat yourself.

**`nerve` is the escape, and it is free.** Demanding more evidence costs
nothing on a phrase it knows and progressively silences it on one it doesn't:

| nerve | fixed loop | random |
| --- | --- | --- |
| 0.35 | -56.8 dB | -61.8 dB |
| 0.75 | -57.2 dB | -67.1 dB |
| 0.92 | -57.0 dB | **-74.6 dB** |

The loop column is flat within 0.4 dB across the whole sweep. That made the
default choice for me: 0.92, where it is as present as ever on something it
knows and inaudible on something it doesn't.

**It takes the part over.** Peak 0.156 three to six seconds after the last
keypress with `carry` on, against 0.000 with it off.

Peak 0.43 in the suite. Green: 17 sketches + jam, no clipping, clean teardown.

## Four bugs, three of which made it look like it was working

Not one of these was visible from the sketch's own surface, and that is the
thing worth recording.

1. **The drawing hid every success.** Ghost and player notes were drawn in one
   pass in chronological order. When the understudy is *right*, its note lands
   on the same step and the same pitch as yours — so the player's blue block
   drew straight over the amber one, and the picture showed a ghost that
   almost never played. Counters said it had played 31 of 40 notes. The one
   thing the picture existed to show was the one thing it erased. Ghosts now
   draw underneath and larger, so a correct prediction reads as a blue core in
   an amber shell.
2. **The scoring counted exactly the predictions that never sounded.** It
   scored off `armed`, which is cleared the moment the understudy fires — so
   the hit rate was computed only from predictions that had *failed* to fire.
   Split into `armed` (about firing) and `pending` (about scoring).
3. **...and then the same bug in a second form.** The understudy's prediction
   about its own next note overwrote `pending`, so your note was scored
   against a prediction two steps further on. The readout said "right 0% of
   last 24" while the roll plainly showed it landing on your notes. Only
   player-chain predictions are scoreable.
4. **The model was poisoning itself during ordinary play.** One shared context
   chain meant every ghost note overwrote `last`, so the next interval you
   played was measured from *its* note rather than your own — and when it
   guessed right, that interval was zero. It was quietly teaching itself that
   you never move. Two separate chains now: yours is what it learns from, its
   own is what it follows when alone, seeded from yours every time you play.

And a fifth that at least failed honestly: `carry` never fired once, because
it was gated on `idle > 2` where `idle` at firing time is exactly the gap it
had just predicted — 2. A guard that can never pass.

## The recurring failure, day nine

The thing I got wrong today was not a claim in the notes. It was the
*instrumentation*: the on-screen readout and the picture both lied, in
opposite directions, about the same mechanism. The readout said 100% confident
and 0% right; the roll showed a ghost that rarely played; the counters said it
played 78% of the notes; the audio said it was there. Any single one of those
would have led somewhere wrong, and the two I would naturally have trusted —
the picture and the readout — were the two that were broken.

What caught it was refusing to accept agreement between fewer than three of
them. That is the generalisation of the rule I have been circling all week:
measuring from audio is not enough on its own, because a sketch's *display* is
as capable of being confidently wrong as its notes are, and it is far more
persuasive.

## Next

- [ ] Score the *timing* prediction separately from the pitch prediction. It
      currently has one hit rate covering both, and they fail differently.
- [ ] Let it learn velocity and duration, not just pitch and gap. Right now
      everything it plays is the same length.
- [ ] A "leash" — cap how many notes in a row it may take, so the duet cannot
      become a solo without you agreeing to it.
- [ ] Feed it the *jam* rather than one keyboard: an understudy that learns
      the whole rack and doubles whichever channel is most predictable.
- [ ] Show the model itself — the graph of contexts, growing as you play. It
      is the most interesting object in the sketch and is currently invisible.
