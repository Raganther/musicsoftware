# DSP in the browser

Three tiers, in increasing order of effort. Start at the top and only descend
when you actually hit a wall.

## 1. Built-in nodes

`OscillatorNode`, `BiquadFilterNode`, `ConvolverNode`, `WaveShaperNode`,
`DynamicsCompressorNode`, `DelayNode`. These run in optimised native code and
cost almost nothing. Most classic subtractive and FM synthesis is reachable
here — see `src/core/voices.ts` and `src/core/fx.ts`.

Things that bite:

- **`exponentialRampToValueAtTime` cannot touch zero.** Ramp to `1e-4` instead.
  `src/core/audio.ts` wraps this.
- **`cancelScheduledValues` reverts the param to its last set value**, which
  may be the *default*. If you cancel a not-yet-started envelope, the gain
  jumps to 1 and you get a full-amplitude click. Use `cancelAndHoldAtTime`.
  (This exact bug produced velocity-independent clicks in `PolySynth`'s voice
  stealing — worth knowing about, it's easy to reintroduce.)
- **`ConvolverNode.normalize` defaults to `true`**, so it rescales your impulse
  response. If you generate IRs procedurally, know that your own scaling is
  not the last word on level.
- **A resonant filter has real gain.** `Q = 6` is about +16 dB at cutoff, so a
  synth's nominal `gain` says little about its output level unless you
  compensate. We divide by `sqrt(Q)`.

## 2. AudioWorklet

When you need per-sample control: wavefolding, physical models, custom
filters, anything with feedback inside the sample loop.

- Runs on the audio thread in 128-sample blocks. **No allocation, no logging,
  no DOM** inside `process()` — a GC pause is an audible dropout.
- Worklet scope has no `import`. Keep the file plain JS and self-contained.
- Load with `audioWorklet.addModule(url)`. In this repo, name the file
  `*.worklet.js` and import it with `?url`; the Vite config exempts that
  pattern from asset inlining, because `addModule()` can't reliably load a
  `data:` URI. Use `loadWorklet()` from `@core` so a module is only
  registered once.
- Communicate with `AudioParam`s (sample-accurate, automatable) for anything
  continuous, and `port.postMessage` only for events. The message port is not
  sample-accurate.

Working example: `sketches/worklet-fold/`.

- <https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor>
- <https://developer.chrome.com/blog/audio-worklet>

## 3. Rust / C++ → WebAssembly, called from a worklet

Only worth it when the DSP itself is the bottleneck: convolution, FFT-heavy
work, physical modelling, many-voice polyphony. The pattern is a WASM module
instantiated inside the worklet, with the processor copying its 128-sample
block in and out of WASM linear memory.

Costs: a build step, a debugging story that's much worse, and no hot reload.
Don't pay it until a sketch has earned it.

- `wasm-bindgen` is convenient but heavier than needed here; raw `wasm32-unknown-unknown`
  with a hand-written ABI is often simpler for a single `process` function.
- Faust (<https://faust.grame.fr>) compiles a DSP-specific language straight to
  an AudioWorklet and is worth a look before writing your own.

## Reference material worth owning

- Julius O. Smith's online books (physical modelling, filters, spectral audio)
  — <https://ccrma.stanford.edu/~jos/>
- Will Pirkle, *Designing Software Synthesizer Plugins in C++* — the standard
  filter/oscillator recipes.
- musicdsp.org archive — short, practical algorithm snippets.
- Vadim Zavalishin, *The Art of VA Filter Design* (free PDF) — the reference
  for virtual-analogue filters, if we ever want a real ladder filter.
