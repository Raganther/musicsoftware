# CLAUDE.md

A sandbox for prototyping music software. Optimise for *how fast an idea can
be heard*, not for architecture. Most sketches here are meant to be thrown
away; the notes about them are what we keep.

## Commands

```bash
npm run dev            # dev server on :5173
npm run check          # tsc --noEmit
npm run build          # typecheck + production build
npm run new <name>     # scaffold sketches/<name>/index.ts
```

## Layout

- `sketches/<name>/index.ts` — one experiment. Auto-discovered; no registry.
- `src/core/` — the audio kernel, imported as `@core`.
- `src/runtime/` — sketch contract, discovery, param panel, mount/teardown.
- `research/` — `topics/` (durable reference), `log/` (dated sessions),
  `ideas.md`.

## Non-obvious things that will bite you

**Schedule against `e.time`, never `ctx.audio.currentTime`.** The clock is a
lookahead scheduler: it wakes every 25 ms and schedules ~120 ms into the
future. Using `currentTime` inside a step callback puts the note in the past
and the timing falls apart. Same reason `clock.visualStep` exists — draw with
that, not with the step you just scheduled, or visuals run ahead of the sound.

**`cancelScheduledValues` reverts an AudioParam to its last set value, which
may be its default.** Cancelling a not-yet-started envelope leaves a gain node
at 1.0 and produces a full-amplitude click. Use `cancelAndHoldAtTime`. This
caused a real, hard-to-find bug in `PolySynth` voice stealing; the fix and the
reasoning are in `src/core/voices.ts`.

**A resonant filter has real gain.** `Q = 6` is ~+16 dB at cutoff, so a
synth's `gain` option means nothing without compensation. `PolySynth` divides
by `sqrt(Q)` and normalises the oscillator sum so `gain` ≈ peak amplitude of
one voice. If you change that, every sketch's level shifts.

**The master limiter is a safety net, not a mixer.** If a sketch is pushing
past ~0.9 pre-limiter it's too loud — fix the sketch. Levels should sit around
0.4-0.8.

**No side effects at module scope in a sketch.** Sketches are imported eagerly
so the gallery can read their metadata. Everything goes inside `setup`.

**Worklets must be `*.worklet.js`** — plain JS, no imports, loaded with `?url`
through `loadWorklet()`. The Vite config exempts that filename pattern from
asset inlining because `addModule()` can't reliably load a `data:` URI.

**Vite serves invalidated modules with a `?t=` query.** If you're driving the
page from a script, importing `/src/core/audio.ts` by bare path can hand back
a *second* copy of the module with its own AudioContext. Resolve the real URL
from `performance.getEntriesByType('resource')`.

## Writing a sketch

```ts
export default defineSketch({
  title: 'Thing',
  description: 'one line on what it explores',
  tags: ['generative'],
  status: 'sketch',        // sketch | promising | parked | graduated
  bpm: 110,
  params: { … },           // becomes the control panel automatically
  notes: `what I learned`, // shown in the panel; keep it honest
  setup(ctx) { … },        // return a cleanup fn, or use ctx.cleanup()
})
```

`ctx` gives you `audio`, `out` (your own bus), `clock`, live `params`, `set`,
`onParam`, `onPress`, `root`, `canvas()`, `cleanup()`, `status()`. Transport
subscriptions and canvases registered through `ctx` are torn down for you;
anything else you create, register with `ctx.cleanup`.

`setup` may be `async` — that's how the worklet sketch loads its module.

## Conventions

- Seed all randomness with `rng(seed)` and expose the seed as a param.
- Promote code to `@core` on the second use, not the first.
- Cap voices on anything generative (`maxVoices`).
- Sketch-specific findings go in the sketch's `notes`; anything spanning
  several sketches goes in `research/log/`.
- Record seeds for results worth keeping.

## Verifying audio changes

Typechecking proves nothing about sound. For changes to `src/core/` or to a
sketch's level, drive the page with Playwright (installed globally; Chromium
at `/opt/pw-browsers/`), tap the master bus *before* the limiter, and check:
sketch produces sound, pre-limiter peak stays under 1.0, and nothing is still
audible after navigating away.
