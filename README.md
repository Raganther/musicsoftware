# musicsoftware

A sandbox for prototyping music software — sequencers, synths, DAW pieces,
improvisational tools. The point is to try a lot of ideas quickly, keep notes
on what worked, and develop the ones that earn it.

```bash
npm install
npm run dev          # http://localhost:5173
npm run new my-idea  # scaffold a sketch
```

Press <kbd>space</kbd> to start the transport. `[` and `]` move between
sketches, `/` focuses the filter.

## Jam mode

Click **⚡ jam** in the sidebar. The gallery becomes a palette: clicking a
sketch adds it as a channel strip, and every channel runs on the one global
transport, so everything locks together by construction.

Each strip has a level fader, a bipolar DJ filter (left = lowpass closes,
right = highpass rises, double-click resets), mute, solo, a meter, and the
sketch's parameters behind `···`. The rack persists across reloads.

**The key row** syncs the whole rack: click a pitch class and every linked
channel retunes to that root + scale on the next bar line — each instrument
keeps its own register (the bass stays bass). Unlink a strip (its `key` chip)
to hold it in the old key for deliberate bitonality, then resolve it on the
bar. Clicking the lit key releases the rack.

**Morph** makes scene changes performable: recall glides every numeric param,
level, filter, bpm and swing over ½–4 bars instead of jumping. Mutes become
fades. Seeds and roots snap (gliding a seed would re-roll the piece).

Performance controls, everywhere:

| Control | What it does |
| --- | --- |
| key row | retune every linked channel, quantised to the bar |
| morph | how long scene recall takes: cut → 4 bars |
| `1`–`4` | recall scene (`shift` stores — params, mix, key, bpm, swing) |
| `b` / tap | tap tempo |
| `shift+R` / ● | record the master output to a 16-bit WAV — exactly what you hear |
| QWERTY row | plays every listening channel at once; mute what you don't want layered |

The classic move: store a scene, mute a channel, rework it behind the mute,
store that as the next scene, and let a 2-bar morph write the transition.

## Layout

```
sketches/        one folder per experiment — the sandbox
src/core/        the audio kernel: transport, voices, theory, fx, MIDI
src/runtime/     sketch contract, discovery, param panel, mount/teardown
research/        topics, session logs, the idea list
scripts/         the scaffolder
```

## How it works

**Sketches are auto-discovered.** Anything at `sketches/<name>/index.ts` with a
default export appears in the gallery. There's no registry to edit — that
friction is what stops sandboxes from being used.

**One shared transport.** Every sketch runs on the same clock and the same
play button, so two rhythmic ideas are directly comparable rather than each
having its own half-built transport.

**Everything is torn down for you.** Each sketch gets its own output bus and a
`cleanup` hook; leaving a sketch disconnects it. No orphaned oscillators
droning under the next thing you open.

**Parameters are declarative.** Declare them and you get a control panel, live
values, change callbacks, and persistence across reloads for free.

A sketch that makes sound is about fifteen lines:

```ts
import { blip, degree, rng } from '@core'
import { defineSketch } from '@runtime/sketch'

export default defineSketch({
  title: 'Ping',
  params: { density: { type: 'number', value: 0.5, min: 0, max: 1 } },
  setup(ctx) {
    const r = rng(1)
    ctx.clock.onStep((e) => {
      if (!r.chance(ctx.params.density)) return
      blip(ctx.out, degree(48, 'pentatonicMinor', r.int(0, 7)), e.time)
    })
  },
})
```

## The five seed sketches

They exist to stake out different *dynamics* between player and machine, not
to be finished products. See `research/topics/interaction-models.md`.

| Sketch | Dynamic |
| --- | --- |
| Step Sequencer | you decide everything; the machine executes |
| Poly Synth | an instrument — it only sounds when you touch it |
| Euclidean Drift | a system that plays itself while you steer |
| Chord Loom | an accompanist you gesture at; you can't play a wrong note |
| Wavefolder | hand-written DSP in an AudioWorklet — the escape hatch |

## Why the web

Fastest edit-to-hear loop of any audio platform, sample-accurate scheduling
via `AudioContext` time, real DSP through AudioWorklet, hardware through Web
MIDI, and every sketch is a shareable URL. If a sketch outgrows it, the exit
is Rust → WASM inside a worklet — see `research/topics/dsp-in-the-browser.md`.

Web MIDI needs Chrome or Edge. Everything else works anywhere.

## Conventions

- **Schedule against `e.time`, never `currentTime`.** The scheduler runs ahead
  of the audible present; see `research/topics/scheduling-and-timing.md`.
- **Seed your randomness.** Use `rng(seed)` and expose the seed as a param, or
  you can't get the good version back.
- **No side effects at module scope.** Sketches are imported eagerly for their
  metadata; do everything inside `setup`.
- **Promote to `@core` on the second use, not the first.**
- Worklet files are named `*.worklet.js` (plain JS) and loaded via
  `loadWorklet()` — the build keeps those as real files.

## Checks

```bash
npm run check   # typecheck
npm run build   # typecheck + production build
```
