# Scheduling and timing

The single most important thing to get right. Bad timing is audible
immediately and no amount of good sound design rescues it.

## The rule

**Never sequence with `setInterval` alone.** JS timers are subject to
throttling, GC pauses, and background-tab clamping (browsers drop to ~1 Hz for
hidden tabs). Timing errors of 20-50 ms are routine, and 10 ms of jitter on a
hi-hat is clearly audible.

Instead: a timer wakes you up periodically, and you schedule notes *into the
future* using `AudioContext` time, which is sample-accurate because it's
computed on the audio thread.

```
every ~25ms:
  while (nextNoteTime < currentTime + lookahead):
    scheduleNote(at: nextNoteTime)   // exact
    nextNoteTime += secondsPerStep
```

The timer only needs to be roughly on time. This is Chris Wilson's "A Tale of
Two Clocks", and it's implemented once in `src/core/clock.ts`.

- <https://web.dev/articles/audio-scheduling>
- <https://github.com/cwilso/metronome>

## Consequences you have to live with

**You are always scheduling ahead of the present.** With a 120 ms lookahead, a
parameter change now affects notes ~120 ms from now. For knob tweaks that's
imperceptible. For anything that must respond to a gesture *immediately*,
schedule that separately at `currentTime`, not through the step callback.

**Visuals must be delayed to match.** If you draw the step you just
*scheduled*, the animation runs ahead of the sound. `clock.visualStep` keeps a
queue of scheduled steps and only advances when `currentTime` passes them.
This is why the playhead lines up.

**Changing tempo mid-flight** only affects steps not yet scheduled. That's
usually what you want; it's why the clock recomputes `stepDur` each iteration
rather than caching it.

## Latency

`AudioContext` has two relevant numbers: `baseLatency` (the graph's own
buffering) and `outputLatency` (the OS/hardware path). Total round-trip on a
laptop is typically 10-30 ms. That's fine for sequenced playback and
noticeable but playable for live keyboard input.

Use `latencyHint: 'interactive'` (we do) for the smallest buffer. Use
`'playback'` if you're rendering something non-interactive and want stability.

## Swing

Swing delays every second subdivision. The natural implementation is to offset
the *emitted* time without moving the underlying grid, so error doesn't
accumulate:

```
swung = (step % 2 === 1) ? gridTime + swing * stepDur : gridTime
```

At `swing = 1/3` you get triplet feel. Most drum machines top out around 0.6.

## Open questions for this repo

- Is a single global transport the right call, or should sketches be able to
  run independent clocks (polytempo)? Currently global — simpler, and it makes
  sketches directly comparable.
- Worth exploring: scheduling from inside an AudioWorklet, which removes JS
  timer jitter entirely at the cost of a much more awkward programming model.
