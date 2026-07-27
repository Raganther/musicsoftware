# Interaction models

The question this repo is actually trying to answer: **what should the
relationship between the person and the machine be?**

Each seed sketch stakes out a different answer. They're deliberately
comparable — same transport, same play button, same output chain — so the
difference you hear is the interaction model, not the sound design.

| Sketch | The machine is a… | You supply | It supplies |
| --- | --- | --- | --- |
| `step-sequencer` | executor | every decision | exact repetition |
| `poly-synth` | instrument | every note, in real time | timbre |
| `euclidean-drift` | system you tend | constraints and nudges | all the notes |
| `chord-loom` | accompanist | gesture and direction | harmony and voicing |
| `worklet-fold` | material | a few parameters | a sound you can't get otherwise |

## Axes worth thinking along

**Who commits, and when?** Direct manipulation commits instantly. `chord-loom`
delays commitment to the next beat, which makes a clumsy gesture sound
deliberate. That single decision changes the feel more than any sound
parameter does.

**What happens when you stop?** Silence (instrument), continuation
(generative), or decay. The `mode` param in `chord-loom` is exactly this
question, isolated: `pad` does nothing, `arp` follows a rule, `bloom` improvises.

**Can you be wrong?** `chord-loom` makes wrong notes impossible. This is
either the point or the problem — an instrument you can't fail at may also be
one you can't succeed at. Genuinely unresolved.

**Is the state visible?** A grid shows you everything. A generative system
mostly doesn't, which is why `euclidean-drift` draws its rings — you can see
the patterns reorganise before you hear them.

## Prior art worth studying

- **Ableton Push / Elektron trig conditions** — probability and conditionality
  as first-class sequencer primitives.
- **Teenage Engineering OP-1** — constraint as a feature; the limits are the
  instrument.
- **Brian Eno & Peter Chilvers, Bloom** — the canonical "can't play a wrong
  note" app. `chord-loom` is downstream of it.
- **Nodal, Iannix, Ossia** — graph and spatial scores instead of timelines.
- **Max/MSP, Pure Data, Reaktor** — patching as the interaction model itself.
- **Sonic Pi, TidalCycles, Strudel** — live coding; the code *is* the
  instrument. Strudel is JS and would slot into this repo unusually easily.
- **Novation Circuit, Polyend Tracker** — hardware-shaped constraints that
  make a genre of workflow.

## Where to take this next

The most under-explored cell in the table is **the machine as a listener**.
Nothing here responds to what you play — `chord-loom` responds to where your
pointer is, which is not the same thing. An accompanist that tracks MIDI input
and fills the gaps you leave would be a genuinely different dynamic, and the
MIDI plumbing already exists in `@core/midi`.
