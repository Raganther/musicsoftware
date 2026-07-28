# Ideas

Unfiltered. No idea is too small or too silly to write down. Move one into
`sketches/` the moment it gets interesting; strike it through when explored
and link to what came of it.

## Sequencing & rhythm

- Sequencer where each step holds a *probability* and a *condition* ("only on
  every 3rd pass") rather than on/off — Elektron-style trig conditions.
- Polymetric tracks: 5 against 7 against 16, all on one transport.
- A sequencer you edit by singing at it (pitch detection → steps).
- Rhythm as a cellular automaton — Rule 110 as a drum pattern generator.

## Synthesis

- ~~Karplus-Strong string model in an AudioWorklet~~ → `sketches/aeolian-harp`:
  strummable string bank + wind mode + partial-sharing sympathy. The bow is
  still open. See `research/log/2026-07-28-aeolian-harp.md`.
- Bowed excitation for the harp — sustained stick-slip instead of bursts.
- A bridge model: strings coupled through a shared resonator with per-partial
  transfer (the mean-coupling shortcut is damping, not sympathy — measured).
- Palm damping as a gesture: choosing what *not* to ring.
- Granular sampler driven by pointer position over a waveform.
- A synth whose only control is a drawn curve — everything else derived from it.
- Feedback FM: two operators modulating each other, kept just short of chaos.

## Improvisation & interaction

- ~~Accompanist that listens to MIDI input and fills the gaps you leave.~~
  → `sketches/call-response`. Works; inversion is the transformation that
  sounds like a musician. See `research/log/2026-07-28-call-response.md`.
- Answer the *contour* of a phrase rather than its notes — reply with the
  opposite shape (rose → falls). Probably closer to what a human does.
- A partner that sometimes declines to answer. Always replying reads as needy;
  letting a phrase stand would feel considered.
- Harmonise *under* a sustained note instead of answering after it —
  accompanist rather than interlocutor. Different dynamic, own sketch.
- Two-player instrument where each player controls half the parameters.
- An instrument with deliberate latency — you commit a gesture a bar ahead.
- Constraint-based improv: it refuses notes that break a rule you set.

## Composition tools

- Piano roll that can only express relationships (this note is a 4th above
  that one), so transposition is structural rather than a shift.
- A DAW arrangement view where clips have gravity and snap into phrases.
- Score that renders as a diagram of tension rather than notation.

## Jam / performance (sparked by building jam mode)

- Per-channel input routing: focus a strip to own the QWERTY keys and MIDI.
- Stem recording: one aligned WAV per channel, not just the master.
- Global key/scale broadcast sketches can opt into — change key mid-jam.
- Scene morph: glide numeric params to the target over a bar instead of jumping.
- Crossfader assignable to any two channels.

## Wild

- Music software with no undo — everything is a performance.
- An instrument that gets slightly worse the longer you play it.
- Sequencer where the grid is a map and the playhead is a wanderer.
