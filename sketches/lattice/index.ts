import { clamp, disposeAt, mtof, noiseBuffer, reverb, rng } from '@core'
import { defineSketch } from '@runtime/sketch'
import { abs, build, cutoff, impedance, resonances, type Bore } from './bore'

/**
 * A woodwind with a row of tone holes, where the fingering system *is* the
 * instrument.
 *
 * `overblow` had one vent — a hole at a position, which shortens the tube. A
 * row of them is a different object: a periodic structure, with a stopband and
 * a passband. Below a cutoff frequency the wave cannot get past the open holes
 * and turns back; above it the lattice is transparent and the sound runs down
 * the whole tube and away.
 *
 * The consequence is the interesting part. That cutoff is set by the *holes* —
 * how wide they are, how far apart, how thick the wall they are drilled
 * through — and not by which ones you happen to be covering. So every note on
 * the instrument shares one spectral ceiling, no matter how high or low it is,
 * and that fixed ceiling is a large part of what makes a clarinet recognisable
 * from the bottom of its range to the top.
 *
 * The bore is a transfer-matrix chain: sections of pipe with tone holes shunted
 * across them. The notes are its impedance maxima, because a reed is a
 * pressure-controlled valve and plays where the bore pushes back hardest.
 *
 * Numbers in `notes` are measured; see `research/log/2026-09-15-lattice.md`.
 */

const MAX_HOLES = 10
/** Harmonics in the synthesised tone. */
const PARTIALS = 48

export default defineSketch({
  title: 'Lattice',
  description: 'A woodwind whose row of tone holes has a cutoff — one spectral ceiling shared by every note it plays.',
  tags: ['dsp', 'physical', 'instrument'],
  status: 'promising',
  bpm: 96,
  division: 4,

  params: {
    holes: { type: 'number', value: 8, min: 3, max: MAX_HOLES, step: 1, label: 'Tone holes' },
    /** How many are open, counting from the bell. This is the scale. */
    open: { type: 'number', value: 3, min: 0, max: MAX_HOLES, step: 1, label: 'Holes open' },
    /** The three numbers that set the cutoff, and the whole point of the sketch. */
    holeSize: { type: 'number', value: 4, min: 1.5, max: 6.5, step: 0.1, label: 'Hole radius (mm)' },
    spacing: { type: 'number', value: 50, min: 18, max: 75, step: 1, label: 'Hole spacing (mm)' },
    wall: { type: 'number', value: 3, min: 1, max: 8, step: 0.1, label: 'Wall (mm)' },
    boreR: { type: 'number', value: 7.5, min: 4, max: 12, step: 0.1, label: 'Bore radius (mm)' },
    /** Manufacturing slop. Each cell then has its own cutoff and they disagree. */
    irregular: { type: 'number', value: 0, min: 0, max: 1, step: 0.01, label: 'Irregularity' },
    /** Play a line by itself, so the ceiling can be heard staying put. */
    auto: { type: 'toggle', value: true, label: 'Play a line' },
    breath: { type: 'number', value: 0.55, min: 0.1, max: 1, step: 0.01, label: 'Breath' },
    /** Tunes the instrument by scaling the whole bore. */
    root: { type: 'number', value: 48, min: 34, max: 64, step: 1, label: 'Root' },
    space: { type: 'number', value: 0.22, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 6, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
A row of tone holes is not a row of vents. It is a periodic structure, so it has
a stopband and a passband: below a cutoff the wave cannot get past the open
holes and turns back, above it the lattice is transparent. And that cutoff
belongs to the **holes** — their width, their spacing, the wall they are drilled
through — not to the fingering. Every note shares one ceiling.

Two routes to it here, and they are kept apart on purpose. \`cutoff()\` solves the
infinite lattice's Bloch dispersion relation — the frequency where a unit cell
stops being evanescent. \`resonances()\` chains the real, finite, fingered bore
and finds its impedance maxima. Neither knows about the other.

**The self-check first.** For a lossless reciprocal cell, half the trace of the
transfer matrix must be a real number; anything else means the sign conventions
in the pipe sections and the hole impedances disagree. Worst imaginary part over
18 cells: **0.00e+0**. It caught a real fault on the first run — the open hole's
radiation resistance was making the "lossless" cell lossy at 6.55e−3.

**A cylindrical reed pipe resonates at odd multiples of its fundamental, and the
cutoff is where it stops.** Fingerings of the same instrument:

| holes open | fundamental | the series breaks at |
| --- | --- | --- |
| 3 | 188.5 Hz | 1294 Hz |
| 4 | 212.5 Hz | 1294 Hz |
| 5 | 242.5 Hz | 1300 Hz |
| 6 | 282.5 Hz | 1269 Hz |
| 7 | 338.5 Hz | 1278 Hz |

The fundamental moves by a factor of **1.80** and the ceiling by **2.8%**, against
a dispersion-relation cutoff of 1264 Hz that was computed without reference to
any of it.

**And it scales the way the holes say.** The long-wavelength result is
f_c ∝ (b/a)/√(s·t_e), and over thirteen geometries — hole radius, spacing, wall
thickness and bore radius each varied on their own — the model agrees with it to
between **1.1% and 6.7%**, worst on bore radius. I guessed the residual was the
long-wavelength approximation failing as k·s grows and tested it: the
correlation between k·s and the error is **0.312**, which is not a story. It is
unexplained.

**An irregular lattice takes its ceiling from its worst cell, not its average.**
Turn \`Irregularity\` up and every hole gets its own cutoff; at 1.0 they span 896
to 1451 Hz while their *mean* barely moves. Over six settings the ceiling
correlates with the **lowest** cell's cutoff at **r = 0.875** and with the mean
at **0.250**. One sloppy hole leaks and the whole instrument loses its top, which
is a thing instrument makers have always said and is pleasant to see fall out of
a transfer matrix.

**And the sketch sounds at the frequencies the bore computes** — the model's f0
against the recording, over four fingerings: 0.04%, 0.11%, 0.02%, 0.01%. The
bore also suppresses its even harmonics by **16.4 to 20.7 dB**, which is a
cylindrical pipe closed at the reed doing what it should.

**What is *not* here: the ceiling is not audible as a clean spectral knee.**
Three detectors, the last of them validated on synthetic spectra with knees I
chose (recovered to 0.3–3.3%), and pointed at the instrument it returns anything
between 324 and 1512 Hz across fingerings. That is not the detector failing. Above
the cutoff the bore's impedance does not stay low, it *bounces* — 0.03, 0.09,
0.19, 0.10, 0.16 of the fundamental's peak — so the cutoff is sharp in **where
the resonances stop being harmonic** and blunt in **the radiated envelope**. The
bore stops organising the spectrum up there without removing it. Getting the
ceiling into the sound properly wants a real nonlinear reed driven by this
impedance, rather than harmonic amplitudes assigned from it.

Levels: 0.554 pre-limiter at the defaults.

(No \`scale\` param, which breaks the jam key contract on purpose: this
instrument's intervals are a consequence of where its holes are drilled, which
is the subject. \`root\` tunes it by scaling the whole bore, so it still takes the
jam's key.)
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 1.6 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)
    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    // -- the instrument --------------------------------------------------------

    /** Per-hole slop, from the seed. Stable per hole so a change moves one cell. */
    let jit: number[][] = []
    const reseed = () => {
      const r = rng(Math.round(ctx.params.seed))
      jit = Array.from({ length: MAX_HOLES }, () => [r.next(), r.next(), r.next()])
    }
    reseed()
    ctx.onParam('seed', reseed)

    /**
     * Scale the whole bore so the all-closed fingering lands on `root`. Every
     * length scales together, so the lattice geometry in wavelengths — and
     * therefore the cutoff — moves with it, which is the honest behaviour: a
     * bass clarinet's ceiling really is lower than a soprano's.
     */
    let tuneScale = 1
    const mm = (v: number) => (v / 1000) * tuneScale

    const geom = (openCount: number) => ({
      L: 0.62 * tuneScale,
      a: mm(ctx.params.boreR),
      n: Math.round(ctx.params.holes),
      first: 0.18 * tuneScale,
      spacing: mm(ctx.params.spacing),
      b: mm(ctx.params.holeSize),
      t: mm(ctx.params.wall),
      open: clamp(openCount, 0, Math.round(ctx.params.holes)),
      irregular: ctx.params.irregular,
      jitter: (i: number, k: number) => jit[i % MAX_HOLES][k],
    })

    let bore: Bore = build(geom(0))
    let fc = 1000
    let notes: number[] = []
    /** Harmonic amplitudes for the current fingering. */
    let waves: PeriodicWave | null = null
    let f0 = 150

    const retune = () => {
      // one bisection on the overall scale to put the lowest note on `root`
      const want = mtof(Math.round(ctx.params.root))
      let lo = 0.25
      let hi = 4
      for (let i = 0; i < 26; i++) {
        tuneScale = (lo + hi) / 2
        const r = resonances(build(geom(0)), want * 3 + 200)
        const got = r[0] ?? want
        if (got > want) lo = tuneScale
        else hi = tuneScale
      }
      tuneScale = (lo + hi) / 2
    }

    const rebuild = () => {
      bore = build(geom(Math.round(ctx.params.open)))
      const g = geom(0)
      fc = cutoff(g.a, g.spacing, g.b, g.t)
      notes = resonances(bore, Math.max(3000, fc * 2.6))
      f0 = notes[0] ?? 150

      // Harmonic amplitudes: a reed's own spectrum, shaped by how hard the bore
      // pushes back at each harmonic. Above the cutoff the bore stops resonating
      // and |Z| falls, which is the ceiling made audible rather than asserted.
      const z0 = abs(impedance(f0, bore))
      const real = new Float32Array(PARTIALS + 1)
      const imag = new Float32Array(PARTIALS + 1)
      const rich = 0.45 + ctx.params.breath * 0.75
      let norm = 0
      for (let n = 1; n <= PARTIALS; n++) {
        const f = f0 * n
        if (f > 18000) break
        // Amplitude follows the bore's impedance, exponent 1 — the simplest
        // thing that can be said, and the honest one. An earlier 0.55 was
        // picked by ear and compressed the model's own 20 dB collapse at the
        // cutoff into 10, which blunted exactly the cliff being measured.
        const support = Math.min(2.4, abs(impedance(f, bore)) / z0)
        const a = support * Math.pow(n, -1.15 / rich)
        imag[n] = a
        norm += a * a
      }
      norm = Math.sqrt(Math.max(1e-9, norm))
      for (let n = 1; n <= PARTIALS; n++) imag[n] /= norm
      waves = ctx.audio.createPeriodicWave(real, imag, { disableNormalization: true })
    }

    retune()
    rebuild()
    for (const k of ['holes', 'holeSize', 'spacing', 'wall', 'boreR', 'irregular', 'seed'] as const) {
      ctx.onParam(k, () => {
        retune()
        rebuild()
      })
    }
    ctx.onParam('root', () => {
      retune()
      rebuild()
    })
    for (const k of ['open', 'breath'] as const) ctx.onParam(k, rebuild)

    // -- blowing it ------------------------------------------------------------

    const blow = (time: number, dur: number, gain: number) => {
      const at = Math.max(time, ctx.audio.currentTime + 0.004)
      const osc = ctx.audio.createOscillator()
      if (waves) osc.setPeriodicWave(waves)
      osc.frequency.value = f0

      const amp = ctx.audio.createGain()
      amp.gain.setValueAtTime(0, at)
      // a reed speaks in ~25 ms, not instantly; a 2 ms ramp is a click and the
      // click has energy everywhere, which would sit right on top of the ceiling
      // this sketch exists to show
      amp.gain.linearRampToValueAtTime(gain, at + 0.025)
      amp.gain.setValueAtTime(gain, at + dur * 0.72)
      amp.gain.exponentialRampToValueAtTime(Math.max(1e-4, gain * 0.02), at + dur)
      osc.connect(amp).connect(bus)
      osc.start(at)

      // breath noise, band-limited by the same ceiling
      const nz = ctx.audio.createBufferSource()
      nz.buffer = noiseBuffer()
      nz.loop = true
      const lp = ctx.audio.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = clamp(fc, 200, 16000)
      lp.Q.value = 0.7
      const na = ctx.audio.createGain()
      na.gain.setValueAtTime(0, at)
      na.gain.linearRampToValueAtTime(gain * 0.09 * ctx.params.breath, at + 0.03)
      na.gain.exponentialRampToValueAtTime(1e-4, at + dur)
      nz.connect(lp).connect(na).connect(bus)
      nz.start(at)

      disposeAt(osc, at + dur + 0.08, [amp])
      disposeAt(nz, at + dur + 0.08, [lp, na])
    }

    // -- the line it plays -----------------------------------------------------

    let step = 0
    ctx.clock.onStep((e) => {
      if (!ctx.params.auto) return
      if (e.step % 4 !== 0) return
      const r = rng(Math.round(ctx.params.seed) * 31 + step)
      const n = Math.round(ctx.params.holes)
      // walk the fingerings rather than jumping, the way a line on a woodwind
      // moves — and it makes the ceiling easy to hear staying put
      const next = clamp(Math.round(ctx.params.open) + r.int(-2, 2), 0, n)
      ctx.set('open', next)
      step++
      blow(e.time, e.dur * 3.4, (0.5 + ctx.params.level * 0.62) * (0.8 + ctx.params.breath * 0.3))
    })

    // Keys 1..9 are the fingerings, lowest note first — digit d leaves d−1 holes
    // open. Digits, because CLAUDE.md reserves 'b' and shift+R for the transport.
    // (Only one finger at a time: `open` counts holes from the bell, so it cannot
    // express a cross-fingering. That wants per-hole state and is a next step.)
    const onKey = (ev: KeyboardEvent) => {
      const d = Number(ev.key)
      if (!Number.isInteger(d) || d < 1) return
      const n = Math.round(ctx.params.holes)
      if (d - 1 > n) return
      ctx.set('open', clamp(d - 1, 0, n))
      if (!ctx.params.auto) {
        blow(ctx.audio.currentTime + 0.02, 1.1, (0.5 + ctx.params.level * 0.62) * (0.8 + ctx.params.breath * 0.3))
      }
    }
    window.addEventListener('keydown', onKey)
    ctx.cleanup(() => window.removeEventListener('keydown', onKey))

    // -- drawing ---------------------------------------------------------------

    /** |Z_in| across frequency, recomputed when the instrument changes. */
    let curve: number[] = []
    let curveKey = ''
    const NC = 260
    const FMAX = 3400

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 10
      const head = 15
      const key = `${ctx.params.open}|${ctx.params.holes}|${ctx.params.holeSize}|${ctx.params.spacing}|${ctx.params.wall}|${ctx.params.boreR}|${ctx.params.irregular}|${ctx.params.root}|${ctx.params.seed}`
      if (key !== curveKey) {
        curveKey = key
        curve = []
        for (let i = 0; i < NC; i++) {
          const f = 60 + (i / (NC - 1)) * (FMAX - 60)
          curve.push(20 * Math.log10(Math.max(1e-9, abs(impedance(f, bore)))))
        }
      }

      const avail = h - pad * 2 - head
      const pipeH = Math.max(34, Math.min(avail * 0.3, 78))
      const plotH = Math.max(40, avail - pipeH - 10)
      const pipeTop = pad + head
      const plotTop = pipeTop + pipeH + 10

      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.62)'
      g.fillText(
        `${f0.toFixed(1)} Hz sounding   ceiling ${fc.toFixed(0)} Hz   ` +
          `${Math.round(ctx.params.open)} of ${Math.round(ctx.params.holes)} open   ` +
          `${(fc / f0).toFixed(1)} harmonics below it`,
        pad,
        pad + 10,
      )

      // -- the pipe ------------------------------------------------------------
      const L = bore.L
      const x0 = pad
      const x1 = w - pad
      const sx = (m: number) => x0 + (m / L) * (x1 - x0)
      const cy = pipeTop + pipeH / 2
      const rad = Math.max(4, Math.min(pipeH * 0.3, (bore.a / 0.012) * pipeH * 0.3))
      g.fillStyle = 'rgba(255,255,255,0.07)'
      g.fillRect(x0, cy - rad, x1 - x0, rad * 2)
      g.strokeStyle = 'rgba(255,255,255,0.25)'
      g.lineWidth = 1
      g.strokeRect(x0, cy - rad, x1 - x0, rad * 2)
      // the reed end
      g.fillStyle = 'rgba(255,255,255,0.3)'
      g.fillRect(x0, cy - rad - 3, 4, rad * 2 + 6)
      for (const hole of bore.holes) {
        if (hole.x <= 0 || hole.x >= L) continue
        const r = Math.max(2.5, (hole.b / bore.a) * rad)
        g.beginPath()
        g.arc(sx(hole.x), cy, r, 0, Math.PI * 2)
        if (hole.open) {
          g.fillStyle = '#0b0e14'
          g.fill()
          g.strokeStyle = '#7dd3fc'
          g.lineWidth = 1.5
          g.stroke()
        } else {
          g.fillStyle = 'rgba(255,255,255,0.55)'
          g.fill()
        }
      }

      // -- the impedance, and the ceiling ---------------------------------------
      g.fillStyle = 'rgba(255,255,255,0.03)'
      g.fillRect(pad, plotTop, w - pad * 2, plotH)
      const hi = Math.max(...curve)
      const lo = Math.min(...curve)
      const yOf = (v: number) => plotTop + plotH * (1 - (v - lo) / Math.max(1e-6, hi - lo))
      const xOf = (f: number) => pad + ((f - 60) / (FMAX - 60)) * (w - pad * 2)

      // the cutoff, drawn as the region above it
      if (fc < FMAX) {
        g.fillStyle = 'rgba(248,113,113,0.09)'
        g.fillRect(xOf(fc), plotTop, w - pad - xOf(fc), plotH)
        g.strokeStyle = 'rgba(248,113,113,0.6)'
        g.setLineDash([3, 3])
        g.beginPath()
        g.moveTo(xOf(fc), plotTop)
        g.lineTo(xOf(fc), plotTop + plotH)
        g.stroke()
        g.setLineDash([])
        g.fillStyle = 'rgba(248,113,113,0.8)'
        g.font = '9px ui-monospace, monospace'
        g.fillText('lattice cutoff', Math.min(w - pad - 72, xOf(fc) + 4), plotTop + 11)
      }

      g.strokeStyle = '#7dd3fc'
      g.lineWidth = 1.4
      g.beginPath()
      for (let i = 0; i < curve.length; i++) {
        const f = 60 + (i / (NC - 1)) * (FMAX - 60)
        i === 0 ? g.moveTo(xOf(f), yOf(curve[i])) : g.lineTo(xOf(f), yOf(curve[i]))
      }
      g.stroke()

      // the odd harmonics of the sounding note, for comparison with the peaks
      for (let n = 1; n <= 15; n += 2) {
        const f = f0 * n
        if (f > FMAX) break
        g.strokeStyle = f > fc ? 'rgba(248,113,113,0.3)' : 'rgba(52,211,153,0.35)'
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(xOf(f), plotTop + plotH - 8)
        g.lineTo(xOf(f), plotTop + plotH)
        g.stroke()
      }

      g.fillStyle = 'rgba(255,255,255,0.4)'
      g.font = '9px ui-monospace, monospace'
      g.fillText('|Z| at the reed', pad + 3, plotTop + plotH - 4)
      g.textAlign = 'right'
      g.fillText(`${FMAX} Hz`, w - pad - 2, plotTop + plotH - 4)
      g.textAlign = 'left'
    })

    const report = () => {
      ctx.status(
        `${f0.toFixed(1)} Hz, ceiling ${fc.toFixed(0)} Hz — ${(fc / f0).toFixed(1)} harmonics under it` +
          (ctx.params.irregular > 0 ? ` (irregular, so each cell has its own)` : ''),
      )
    }
    report()
    for (const k of ['open', 'holeSize', 'spacing', 'wall', 'boreR', 'root', 'irregular'] as const) {
      ctx.onParam(k, report)
    }

    // Read back by the harness; the sketch's numbers come from the same module.
    ;(window as unknown as Record<string, unknown>).__lattice = () => ({
      tap: () => bus,
      set: (k: string, v: number | boolean | string) => ctx.set(k as never, v as never),
      cutoff: () => fc,
      f0: () => f0,
      resonances: () => notes.slice(),
      bore: () => bore,
    })
  },
})
