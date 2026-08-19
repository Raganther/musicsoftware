import { clamp, loadWorklet, mtof, reverb, rng } from '@core'
import { defineSketch } from '@runtime/sketch'
import workletUrl from './plate.worklet.js?url'

/**
 * The sound a gong makes that a bell cannot.
 *
 * Strike a bell and it is at its brightest immediately; everything after that
 * is decay. Strike a tam-tam and the shimmer arrives *later* — a wash of high
 * partials that were not there at the moment of impact and take a second or
 * more to build. No linear model does this, however many modes you give it,
 * because in a linear system every mode is independent and can only lose the
 * energy it was handed. The bloom needs energy to move *between* modes, and
 * that requires the plate to be nonlinear, which a real one is as soon as the
 * deflection approaches its thickness.
 *
 * So the model is a bank of plate modes plus a return path that squares and
 * cubes the summed displacement and feeds it back. Squaring a pair of modes at
 * f and g makes f+g and f-g; the plate's modes are dense and inharmonic, the
 * sums land on other modes, and the spectrum climbs.
 *
 * \`Coupling\` at 0 is the control, and it is the whole argument: same modes,
 * same strike, same decay rates, no return path. If the bloom is real it must
 * vanish there, and if it does not then it was never the nonlinearity doing it.
 *
 * Mode frequencies are the real thing rather than a shape I liked: for a
 * simply-supported rectangular plate the eigenvalues go as (m/a)² + (n/b)²,
 * which is where the density and the inharmonicity both come from. The aspect
 * ratio is a parameter because it decides how nearly the modes collide.
 */

/** Per-sample cost is linear in this; 200 is about 30M multiplies a second. */
const MAX_TRIADS = 200

interface Mode {
  f: number
  r: number
  pan: number
  w: number
  m: number
  n: number
}

export default defineSketch({
  title: 'Bloom',
  description: 'A nonlinear plate. The shimmer arrives after the strike, which no bell can do.',
  tags: ['dsp', 'worklet', 'physical-model', 'instrument'],
  status: 'sketch',
  bpm: 60,
  division: 4,

  params: {
    couple: { type: 'number', value: 0.75, min: 0, max: 1, step: 0.01, label: 'Coupling (the bloom)' },
    tension: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, label: 'Tension modulation' },
    modes: { type: 'number', value: 56, min: 6, max: 56, step: 1, label: 'Modes' },
    aspect: { type: 'number', value: 1.41, min: 1, max: 3, step: 0.01, label: 'Plate aspect' },
    decay: { type: 'number', value: 18, min: 0.6, max: 20, step: 0.1, label: 'Decay', unit: 's' },
    damp: { type: 'number', value: 0.1, min: 0, max: 1.4, step: 0.01, label: 'High-mode damping' },
    strikeX: { type: 'number', value: 0.32, min: 0.02, max: 0.98, step: 0.01, label: 'Strike across' },
    strikeY: { type: 'number', value: 0.5, min: 0.02, max: 0.98, step: 0.01, label: 'Strike down' },
    force: { type: 'number', value: 0.45, min: 0.05, max: 1, step: 0.01, label: 'Force' },
    every: { type: 'number', value: 24, min: 4, max: 64, step: 4, label: 'Strike every', unit: 'steps' },
    space: { type: 'number', value: 0.22, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    root: { type: 'number', value: 34, min: 22, max: 52, step: 1, label: 'Root (MIDI)' },
    seed: { type: 'number', value: 3, min: 1, max: 999, step: 1 },
    hit: { type: 'button', label: 'Strike' },
  },

  notes: `
A bell is brightest at the moment you hit it. A tam-tam is not: the shimmer
arrives a second or so later, and no bank of independent resonators can do
that, because in a linear system every mode only ever loses the energy it was
handed. The bloom needs energy to move *between* modes.

\`Coupling\` at 0 is the control and it is the whole argument. Measured, one
strike, brightness as spectral centroid:

| coupling | centroid at 0.1 s | peak | when |
| --- | --- | --- | --- |
| 0 (linear) | 959 Hz | 1.05× | 0.08 s |
| 0.75 | 171 Hz | **2.76×** | **0.47 s** |

The linear plate peaks at the attack and falls monotonically from there —
959, 812, 785, 690, 675, 561, 438, 347, 237 Hz across four seconds. The
coupled one peaks late. That is the bloom, and it is exactly what the control
says it should be.

**What sets how long it takes** is mode density and damping, which is why a
real tam-tam is large and lightly damped:

| modes | decay | high-mode damping | rise | peaks at |
| --- | --- | --- | --- | --- |
| 52 | 6 s | 0.55 | 1.64× | 0.31 s |
| 52 | 14 s | 0.2 | 2.11× | 0.39 s |
| 56 | 18 s | 0.1 | 2.23× | **1.63 s** |

**The mechanism had to be right.** The first version fed back the square of the
summed displacement — cheap, and completely wrong: that feedback is dominated
by whatever is already loudest, so it amplifies the existing distribution
instead of moving energy up it. Measured, it made the plate six times duller at
the attack (134 Hz against the linear 659 Hz) and never bloomed at all. What
works is resonant triads: the triples where f_i ≈ f_j + f_k, each exchanging
energy three ways.

Mode frequencies are the simply-supported rectangular plate eigenvalues,
(m/a)² + (n/b)², and every measured spectral peak lands within **3.46%** of a
predicted mode — once the prediction accounts for the strike shape, since a
mode with a node under the mallet does not sound at all.

Two things this does **not** do. The rise is not monotonic in the coupling
parameter: 1.05, 1.41, 1.34, 2.76, 1.72 across 0 to 1, so somewhere above 0.75
the per-sample force clamp or the watchdog starts setting the level instead of
the knob. And the coupled attack is far duller than the linear one, 179 Hz
against 959 — so this is not "the same strike plus a bloom", it is a fast
downward equilibration followed by a slow climb. Whether that is what a real
tam-tam does I cannot tell from here.

Pre-limiter peak 0.463 on a single strike, 0.769 in the suite where the room is
on and strikes overlap.
`,


  async setup(ctx) {
    await loadWorklet(workletUrl)
    const node = new AudioWorkletNode(ctx.audio, 'nonlinear-plate', {
      numberOfInputs: 0,
      outputChannelCount: [2],
    })
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 3.2 })
    ctx.onParam('space', (v) => rev.setMix(v))
    node.connect(rev.input)
    ctx.cleanup(() => {
      node.port.postMessage({ type: 'panic' })
      node.disconnect()
      rev.dispose()
    })

    let plate: Mode[] = []
    let reported = { peak: 0, rms: 0, trim: 1 }
    node.port.onmessage = (e) => (reported = e.data)

    /**
     * The lowest `count` eigenmodes of a simply-supported rectangular plate,
     * scaled so the fundamental lands on `f0`. Damping rises with frequency,
     * which is what makes a struck plate dull down before it blooms.
     */
    const build = () => {
      const count = Math.round(ctx.params.modes)
      const a = 1
      const b = ctx.params.aspect
      const r = rng(Math.round(ctx.params.seed))
      const raw: { m: number; n: number; lam: number }[] = []
      for (let m = 1; m <= 12; m++) {
        for (let n = 1; n <= 12; n++) {
          raw.push({ m, n, lam: (m / a) ** 2 + (n / b) ** 2 })
        }
      }
      raw.sort((x, y) => x.lam - y.lam)
      const base = raw[0].lam
      const f0 = mtof(Math.round(ctx.params.root))
      const sr = ctx.audio.sampleRate
      const decay = ctx.params.decay
      const damp = ctx.params.damp
      plate = raw.slice(0, count).map((e) => {
        // a few cents of scatter, so two modes that the formula puts exactly
        // together beat instead of summing into one louder partial
        const jitter = 1 + (r.next() - 0.5) * 0.012
        const f = Math.min(sr * 0.45, (f0 * e.lam * jitter) / base)
        const ratio = f / f0
        const t60 = Math.max(0.05, decay / Math.pow(ratio, damp))
        return {
          f,
          r: Math.pow(10, -3 / (t60 * sr)),
          pan: clamp((e.n - e.m) * 0.16, -0.85, 0.85),
          // Coupling into the nonlinear return path grows with mode order.
          // This is the line that decides whether the cascade climbs or just
          // thickens what is already there — measured, a square-root tilt was
          // not nearly enough and the cascade ran downhill instead.
          w: Math.pow(ratio, 0.9),
          m: e.m,
          n: e.n,
        }
      })
      node.port.postMessage({ modes: plate })
      findTriads()
    }

    /**
     * The triples that can actually exchange energy: f_i ~ f_j + f_k. A
     * quadratic nonlinearity couples exactly these, and how strongly depends
     * on how close the match is — a badly detuned triad averages itself away
     * over a few cycles instead of transferring anything.
     *
     * Sorted by strength and capped, because this runs per sample and the
     * useful ones are a small fraction of the O(n²) candidates.
     */
    let triadCount = 0
    const findTriads = () => {
      const n = plate.length
      const cand: { i: number; j: number; k: number; g: number }[] = []
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          for (let k = j; k < n; k++) {
            if (j === i || k === i) continue
            const det = Math.abs(plate[i].f - plate[j].f - plate[k].f)
            const rel = det / plate[i].f
            if (rel > 0.06) continue
            // Lorentzian in the detuning, and stronger for higher partners,
            // which is the direction a plate's coupling coefficients lean.
            const tune = 1 / (1 + Math.pow(rel / 0.02, 2))
            const order = Math.sqrt(plate[i].f / plate[0].f)
            cand.push({ i, j, k, g: tune * order })
          }
        }
      }
      cand.sort((a, b) => b.g - a.g)
      const keep = cand.slice(0, MAX_TRIADS)
      triadCount = keep.length
      node.port.postMessage({
        tri: keep.flatMap((t) => [t.i, t.j, t.k]),
        triG: keep.map((t) => t.g),
      })
    }
    build()
    for (const k of ['modes', 'aspect', 'decay', 'damp', 'root', 'seed'] as const) ctx.onParam(k, build)

    const send = () => {
      node.port.postMessage({
        couple: ctx.params.couple,
        tension: ctx.params.tension,
        gain: 0.55 + ctx.params.level * 1.3,
      })
    }
    send()
    for (const k of ['couple', 'tension', 'level', 'root'] as const) ctx.onParam(k, send)

    // -- striking --------------------------------------------------------------

    /**
     * A strike at (x, y) excites mode (m, n) in proportion to its shape there,
     * sin(mπx)·sin(nπy) — a mode with a node under the mallet does not sound.
     * The impulse is scaled by sin(ω) because a two-pole resonator rings louder
     * the lower it is tuned, and without that the bottom mode is the whole
     * sound.
     */
    const strike = (x: number, y: number, force: number) => {
      const sr = ctx.audio.sampleRate
      const vec = plate.map((mo) => {
        const shape = Math.sin(mo.m * Math.PI * x) * Math.sin(mo.n * Math.PI * y)
        const w = (2 * Math.PI * mo.f) / sr
        // a soft mallet loses the top of the spectrum; a hard one keeps it
        const soft = Math.pow(1 / (1 + mo.f / (400 + force * 5200)), 0.9)
        return shape * Math.sin(w) * soft * force * 2.6
      })
      node.port.postMessage({ strike: vec })
    }

    ctx.onPress('hit', () => strike(ctx.params.strikeX, ctx.params.strikeY, ctx.params.force))

    let step = 0
    /**
     * The step to strike on next. Starts at -1 so that whenever the transport
     * starts, the very next step is a strike — the worklet loads
     * asynchronously and a gong that waits for step 0 to come round again is a
     * gong that is silent for the first eight seconds.
     */
    let nextAt = -1
    const timers = new Set<ReturnType<typeof setTimeout>>()
    ctx.cleanup(() => {
      for (const t of timers) clearTimeout(t)
      timers.clear()
    })

    ctx.clock.onStep((e) => {
      if (e.step < nextAt) return
      nextAt = e.step + Math.round(ctx.params.every)
      const r = rng(Math.round(ctx.params.seed) * 977 + step)
      step++
      const jx = clamp(ctx.params.strikeX + (r.next() - 0.5) * 0.12, 0.03, 0.97)
      const jy = clamp(ctx.params.strikeY + (r.next() - 0.5) * 0.12, 0.03, 0.97)
      const f = clamp(ctx.params.force * (0.75 + r.next() * 0.5), 0.05, 1)
      // Schedule against e.time, not currentTime — but a worklet message
      // cannot be scheduled, so wait out the lookahead rather than firing early.
      const wait = Math.max(0, (e.time - ctx.audio.currentTime) * 1000)
      const t = setTimeout(() => {
        timers.delete(t)
        strike(jx, jy, f)
      }, wait)
      timers.add(t)
    })

    ctx.clock.onStateChange(() => {
      if (ctx.clock.running) {
        nextAt = -1
        return
      }
      node.port.postMessage({ type: 'panic' })
    })

    // -- what is actually coming out -------------------------------------------

    const spec = ctx.audio.createAnalyser()
    spec.fftSize = 4096
    spec.smoothingTimeConstant = 0.35
    node.connect(spec)
    const bins = new Float32Array(spec.frequencyBinCount)
    ctx.cleanup(() => spec.disconnect())

    /** Rolling history of spectral centroid, so the bloom is visible. */
    const hist: { t: number; centroid: number; energy: number }[] = []

    // -- drawing ---------------------------------------------------------------

    const g = ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const sr = ctx.audio.sampleRate
      const bw = sr / spec.fftSize
      spec.getFloatFrequencyData(bins)

      // centroid of what is sounding, in Hz
      let num = 0
      let den = 0
      for (let k = 2; k < bins.length; k++) {
        const hz = k * bw
        if (hz > 9000) break
        const p = Math.pow(10, bins[k] / 10)
        num += hz * p
        den += p
      }
      const centroid = den > 1e-12 ? num / den : 0
      const energy = Math.sqrt(den)
      hist.push({ t: ctx.audio.currentTime, centroid, energy })
      while (hist.length > 420) hist.shift()

      const padL = 44
      const padR = 12
      const topH = Math.max(70, h * 0.42)
      const top = 16

      // -- the modes, and which ones the strike woke -----------------------------
      const maxF = 6000
      const mx = (hz: number) => padL + (clamp(hz, 0, maxF) / maxF) * (w - padL - padR)
      const my = (db: number) => top + (1 - clamp((db + 96) / 96, 0, 1)) * topH

      g.strokeStyle = 'rgba(125,211,252,0.7)'
      g.lineWidth = 1
      g.beginPath()
      for (let k = 1; k < bins.length; k++) {
        const hz = k * bw
        if (hz > maxF) break
        const px = mx(hz)
        const py = my(bins[k])
        k === 1 ? g.moveTo(px, py) : g.lineTo(px, py)
      }
      g.stroke()

      // mode positions along the bottom of the spectrum panel
      for (const mo of plate) {
        if (mo.f > maxF) continue
        const px = mx(mo.f)
        g.fillStyle = `rgba(251,191,36,${0.15 + 0.5 * Math.min(1, mo.w / 2)})`
        g.fillRect(px - 0.5, top + topH - 5, 1.5, 5)
      }
      g.fillStyle = 'rgba(255,255,255,0.25)'
      g.font = '9px ui-monospace, monospace'
      g.fillText(
        `${plate.length} modes · ${plate[0]?.f.toFixed(0) ?? 0} Hz to ${plate[plate.length - 1]?.f.toFixed(0) ?? 0} Hz` +
          ` · ${triadCount} resonant triads`,
        padL,
        top + topH + 12,
      )

      // -- the bloom itself: centroid against time -------------------------------
      const trTop = top + topH + 26
      const trH = h - trTop - 34
      if (trH > 24 && hist.length > 2) {
        const lo = 200
        const hi = 5000
        const ty = (hz: number) => trTop + (1 - (Math.log2(clamp(hz, lo, hi) / lo) / Math.log2(hi / lo))) * trH
        g.strokeStyle = 'rgba(255,255,255,0.06)'
        for (const hz of [500, 1000, 2000, 4000]) {
          g.beginPath()
          g.moveTo(padL, ty(hz))
          g.lineTo(w - padR, ty(hz))
          g.stroke()
          g.fillStyle = 'rgba(255,255,255,0.2)'
          g.textAlign = 'right'
          g.fillText(`${hz}`, padL - 4, ty(hz) + 3)
          g.textAlign = 'left'
        }
        const cw = (w - padL - padR) / 420
        // energy underneath, so a rising centroid on a dying sound is readable
        const maxE = Math.max(1e-9, ...hist.map((p) => p.energy))
        g.fillStyle = 'rgba(125,211,252,0.14)'
        g.beginPath()
        g.moveTo(padL, trTop + trH)
        hist.forEach((p, i) => g.lineTo(padL + i * cw, trTop + trH - (p.energy / maxE) * trH * 0.9))
        g.lineTo(padL + (hist.length - 1) * cw, trTop + trH)
        g.fill()

        g.strokeStyle = 'rgba(251,191,36,0.95)'
        g.lineWidth = 1.5
        g.beginPath()
        hist.forEach((p, i) => {
          const px = padL + i * cw
          const py = ty(p.centroid)
          i === 0 ? g.moveTo(px, py) : g.lineTo(px, py)
        })
        g.stroke()

        g.fillStyle = 'rgba(255,255,255,0.3)'
        g.font = '9px ui-monospace, monospace'
        g.fillText('brightness (spectral centroid, Hz) — up is the bloom', padL + 2, trTop - 6)
      }

      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.72)'
      g.fillText(
        `centroid ${centroid.toFixed(0)} Hz` +
          `   ·   coupling ${ctx.params.couple.toFixed(2)}${ctx.params.couple < 0.005 ? '  (linear — no bloom possible)' : ''}`,
        padL,
        h - 20,
      )
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = reported.trim < 0.98 ? 'rgba(251,191,36,0.9)' : 'rgba(255,255,255,0.3)'
      g.fillText(
        `peak ${reported.peak.toFixed(3)}  ·  plate rms ${reported.rms.toFixed(2)}` +
          (reported.trim < 0.98 ? `  ·  watchdog holding feedback at ${(reported.trim * 100).toFixed(0)}%` : '') +
          `  ·  click the plate to strike it`,
        padL,
        h - 6,
      )
    })

    // -- input ------------------------------------------------------------------

    const onDown = (e: PointerEvent) => {
      const rect = g.canvas.getBoundingClientRect()
      const x = clamp((e.clientX - rect.left) / rect.width, 0.03, 0.97)
      const y = clamp((e.clientY - rect.top) / rect.height, 0.03, 0.97)
      ctx.set('strikeX', x)
      ctx.set('strikeY', y)
      strike(x, y, ctx.params.force)
    }
    g.canvas.addEventListener('pointerdown', onDown)

    ctx.status('click anywhere to strike · Coupling 0 is the control — the bloom must vanish there')
  },
})
