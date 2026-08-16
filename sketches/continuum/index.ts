import {
  clamp,
  degree,
  loadWorklet,
  mtof,
  noteName,
  reverb,
  rng,
  SCALE_NAMES,
  type ScaleName,
} from '@core'
import { defineSketch } from '@runtime/sketch'
import workletUrl from './pulse.worklet.js?url'

/**
 * Rhythm and pitch are the same thing at different speeds.
 *
 * Cowell's observation, and the reason it is worth building rather than just
 * saying: take a chord, write it as whole-number frequency ratios — a major
 * triad is very nearly 4:5:6 — and run three pulse trains at those ratios.
 * Around 200 Hz you hear a chord. Slow the whole thing down nine octaves and
 * the *identical generator* gives you a 4:5:6 polyrhythm. Nothing switches
 * over; one number moves.
 *
 * The crossover is somewhere near 20 Hz and it is not a clean line. There is a
 * stretch in the middle where the ear cannot decide, and the pulses are neither
 * quite events nor quite a pitch — a rattle with a note buried in it. That
 * region is the most interesting part of the slider and the hardest to
 * describe, which is a good reason to have it under a finger.
 *
 * The ratios come from whatever scale you pick, approximated by the smallest
 * whole numbers that will do the job. A major third wants to be 5:4, which is
 * 14 cents flatter than the tempered one — so this is also a just-intonation
 * instrument, and at the rhythmic end that error is what makes the polyrhythm
 * line up exactly instead of drifting.
 */

const MAX_VOICES = 6
const QMAX = 96

/**
 * The *simplest* p/q within `tol` cents of x — not the closest.
 *
 * Closest is the wrong question and I had it wrong first: the best rational
 * approximation to a tempered major third with denominator ≤ 16 is 19/15, not
 * 5/4. It is nine cents better and musically useless, because the whole reason
 * to want whole numbers is that small ones make a short repeating cycle. So
 * search by Tenney height (p·q) inside a tolerance instead, which is the trade
 * a tuner actually makes.
 */
function simplestRatio(x: number, tol: number): { p: number; q: number } {
  let best: { p: number; q: number } | null = null
  let cost = Infinity
  let fallback = { p: 1, q: 1 }
  let ferr = Infinity
  for (let q = 1; q <= QMAX; q++) {
    for (let p = Math.max(1, Math.floor(x * q) - 1); p <= Math.ceil(x * q) + 1; p++) {
      const cents = Math.abs(1200 * Math.log2(p / q / x))
      if (cents < ferr) {
        ferr = cents
        fallback = { p, q }
      }
      if (cents <= tol && p * q < cost) {
        cost = p * q
        best = { p, q }
      }
    }
  }
  return best ?? fallback
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
const lcm = (a: number, b: number) => (a * b) / gcd(a, b)

export default defineSketch({
  title: 'Continuum',
  description: 'A chord and a polyrhythm are the same thing. One slider, nine octaves apart.',
  tags: ['rhythm', 'sequencer', 'harmony', 'strange'],
  status: 'sketch',
  bpm: 100,

  params: {
    octaves: { type: 'number', value: 4.5, min: 0, max: 8, step: 0.01, label: 'Octaves down' },
    notes: { type: 'number', value: 3, min: 2, max: MAX_VOICES, step: 1, label: 'Voices' },
    tol: { type: 'number', value: 20, min: 1, max: 45, step: 1, label: 'Tolerance', unit: '¢' },
    width: { type: 'number', value: 12, min: 0.5, max: 60, step: 0.5, label: 'Ping length', unit: 'ms' },
    colour: { type: 'number', value: 0.5, min: 0, max: 1, label: 'Ping colour' },
    spread: { type: 'number', value: 0.55, min: 0, max: 1 },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    root: { type: 'number', value: 57, min: 33, max: 69, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'major', options: SCALE_NAMES },
    seed: { type: 'number', value: 3, min: 1, max: 999, step: 1 },
    align: { type: 'button', label: 'Line them up' },
  },

  notes: `
One pulse-train generator per voice at exact whole-number ratios, and a single
slider that moves the base rate. It never switches strategy — the same phasors
that make the polyrhythm at the bottom make the chord at the top.

Measured, root A3, major, tolerance 20¢ (4:5:6):

  octaves 5, base 6.9 Hz   pulse rates  6.88  8.59 10.31 Hz  = 1 : 1.2496 : 1.4994
  octaves 3, base 27.5 Hz  pulse rates 27.51 34.37 41.32 Hz  = 1 : 1.2495 : 1.5022
  octaves 0, base 220 Hz   partials    219.4 274.5 329.7 Hz  (want 220 275 330)

so the claim holds: same generator, same ratios, worst error 0.16% at the
rhythmic end and under one FFT bin at the pitched end.

\`Tolerance\` is the interesting control. It asks for the *simplest* whole
numbers within that many cents, not the closest — closest is a trap, because
the best rational approximation to a tempered major third with denominator ≤ 16
is 19/15, which is nine cents better than 5/4 and musically worthless. At 20¢
major is 4:5:6 and minor is 10:12:15; at 4¢ major becomes 46:58:69.

That is one trade seen from two ends, and it is the same number: every voice is
a whole multiple of base/ints[0], so the figure repeats after ints[0] pulses.
Tighten from 20¢ to 4¢ and the bar goes from 4 pulses to 46 — and at the pitch
end the chord's periodicity falls from 55.04 Hz to 4.78 Hz (want 55.00 and
4.78) while the chord itself still sounds like a major triad. Three and a half
octaves of periodicity is what those nine cents cost.

One honest limit. Band-passing each voice at its own formant and reading the
period of the envelope works exactly up to about base 78 Hz and then every band
returns the composite instead — precisely 1/4, 1/5, 1/6 of each voice's rate.
Shortening the ping from 6 ms to 2 ms did not move that boundary, widening or
narrowing the analysis band did not move it (wider was worse), and dropping to
two voices did not move it. I do not know what sets it. Above there the pitch
end has to be measured spectrally, which is the natural measurement there
anyway — but I could not find one detector that spans the whole slider.

Pre-limiter peak 0.38-0.52 across the range at defaults; 0.69 at six voices
with level at maximum.
`,

  async setup(ctx) {
    await loadWorklet(workletUrl)

    const rev = reverb(ctx.out, { mix: 0.16, seconds: 1.8 })
    const node = new AudioWorkletNode(ctx.audio, 'pulse-bank', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
    const analyser = ctx.audio.createAnalyser()
    analyser.fftSize = 16384
    analyser.smoothingTimeConstant = 0.6
    node.connect(analyser)
    node.connect(rev.input)
    const spec = new Float32Array(analyser.frequencyBinCount)
    ctx.cleanup(() => {
      node.port.postMessage({ type: 'panic' })
      node.disconnect()
      analyser.disconnect()
      rev.dispose()
    })

    // -- the ratios --------------------------------------------------------------

    let ints: number[] = [4, 5, 6]
    let cents: number[] = [0, 386, 702]
    let errs: number[] = [0, 0, 0]

    const buildRatios = () => {
      const n = Math.round(ctx.params.notes)
      const root = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      const tol = ctx.params.tol
      const wanted: number[] = []
      for (let i = 0; i < n; i++) {
        const semis = degree(root, scale, i * 2) - root
        wanted.push(Math.pow(2, semis / 12))
      }
      const approx = wanted.map((x) => simplestRatio(x, tol))
      const denom = approx.reduce((a, r) => lcm(a, r.q), 1)
      ints = approx.map((r) => (r.p * denom) / r.q)
      const g = ints.reduce((a, b) => gcd(a, b))
      ints = ints.map((v) => v / g)
      cents = ints.map((v) => 1200 * Math.log2(v / ints[0]))
      errs = ints.map((v, i) => 1200 * Math.log2(v / ints[0]) - 1200 * Math.log2(wanted[i]))
      send()
      scatter()
    }

    /**
     * Where the voices sit relative to each other at t=0. In a polyrhythm the
     * moment they all coincide is the strongest event in the bar, and the seed
     * decides how far away from it you start.
     */
    const scatter = () => {
      const r = rng(Math.round(ctx.params.seed))
      node.port.postMessage({ phases: ints.map(() => r.next()) })
    }
    ctx.onParam('seed', scatter)

    const send = () => {
      const n = ints.length
      // Each voice gets its own formant so the pings are separable by ear —
      // and, at the rhythmic end, separable by a band-pass in a harness.
      const formants = ints.map((_, i) => 700 * Math.pow(1.85, i) * (0.7 + ctx.params.colour * 0.9))
      const pans = ints.map((_, i) =>
        n < 2 ? 0 : ((i / (n - 1)) * 2 - 1) * ctx.params.spread,
      )
      node.port.postMessage({
        ratios: ints,
        formants,
        pans,
        // Divided by ints[0] so the lowest voice always lands on the root,
        // whatever whole numbers the tolerance happened to pick. Without this,
        // switching major to minor jumps the pitch by an octave and a fifth.
        base: baseHz() / ints[0],
        width: ctx.params.width / 1000,
        // Pings sum; more voices need less each, and the ping's own length
        // matters because a long one overlaps itself at the pitched end.
        gain: (0.5 + ctx.params.level * 1.8) / Math.sqrt(n),
      })
    }

    const baseHz = () => mtof(Math.round(ctx.params.root)) / Math.pow(2, ctx.params.octaves)

    buildRatios()
    for (const k of ['notes', 'tol', 'root', 'scale'] as const) ctx.onParam(k, buildRatios)
    for (const k of ['octaves', 'width', 'colour', 'spread', 'level'] as const) ctx.onParam(k, send)
    ctx.onPress('align', () => node.port.postMessage({ type: 'reset' }))

    // -- what the worklet reports ------------------------------------------------

    let level = 0
    let strikes: number[] = []
    /** Recent strike counts, so the raster can draw actual events. */
    const raster: { t: number; voice: number }[] = []
    let lastStrikes: number[] = []
    node.port.onmessage = (e) => {
      level = e.data.peak ?? 0
      strikes = e.data.strikes ?? []
      const now = performance.now() / 1000
      for (let i = 0; i < strikes.length; i++) {
        const d = strikes[i] - (lastStrikes[i] ?? strikes[i])
        // Only draw events while they are events; past a few per frame the
        // raster is meaningless and the spectrum is the honest picture.
        for (let k = 0; k < Math.min(d, 4); k++) raster.push({ t: now, voice: i })
      }
      lastStrikes = strikes.slice()
      while (raster.length && raster[0].t < now - 6) raster.shift()
    }
    ctx.cleanup(() => (node.port.onmessage = null))

    // -- drawing -------------------------------------------------------------------

    const g = ctx.canvas((g, { w, h }) => {
      const SPLIT = Math.round(w * 0.5)
      const T = 40
      const B = h - 48
      const base = baseHz()
      const n = ints.length

      // --- the slider's own position on the continuum ------------------------
      const barY = 18
      const xForHz = (hz: number) =>
        26 + (Math.log2(clamp(hz, 0.2, 800) / 0.2) / Math.log2(800 / 0.2)) * (w - 52)
      const grad = g.createLinearGradient(26, 0, w - 26, 0)
      grad.addColorStop(0, 'rgba(251,191,36,0.5)')
      grad.addColorStop(0.42, 'rgba(148,163,184,0.35)')
      grad.addColorStop(0.62, 'rgba(125,211,252,0.5)')
      g.strokeStyle = grad
      g.lineWidth = 5
      g.beginPath()
      g.moveTo(26, barY)
      g.lineTo(w - 26, barY)
      g.stroke()
      g.font = '9px ui-monospace, monospace'
      g.textAlign = 'left'
      g.fillStyle = 'rgba(251,191,36,0.6)'
      g.fillText('rhythm', 26, barY - 9)
      g.textAlign = 'right'
      g.fillStyle = 'rgba(125,211,252,0.6)'
      g.fillText('pitch', w - 26, barY - 9)
      // the fusion region, where it is neither
      g.fillStyle = 'rgba(148,163,184,0.14)'
      g.fillRect(xForHz(12), barY - 6, xForHz(30) - xForHz(12), 12)
      g.textAlign = 'center'
      g.fillStyle = 'rgba(148,163,184,0.55)'
      g.fillText('fusion', (xForHz(12) + xForHz(30)) / 2, barY - 9)
      const px = xForHz(base)
      g.strokeStyle = 'rgba(255,255,255,0.9)'
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(px, barY - 8)
      g.lineTo(px, barY + 8)
      g.stroke()

      // --- left: the raster, which is honest only while there are events -----
      const rl = 26
      const rr = SPLIT - 20
      const now = performance.now() / 1000
      g.strokeStyle = 'rgba(255,255,255,0.07)'
      g.lineWidth = 1
      for (let i = 0; i < n; i++) {
        const y = T + ((i + 0.5) / n) * (B - T)
        g.beginPath()
        g.moveTo(rl, y)
        g.lineTo(rr, y)
        g.stroke()
      }
      for (const e of raster) {
        const age = now - e.t
        if (age > 6) continue
        const x = rr - (age / 6) * (rr - rl)
        const y = T + ((e.voice + 0.5) / n) * (B - T)
        const hue = (196 + e.voice * 34) % 360
        g.fillStyle = `hsla(${hue},72%,64%,${clamp(1 - age / 6, 0.05, 0.95)})`
        g.fillRect(x - 1.5, y - 9, 3, 18)
      }
      g.textAlign = 'left'
      g.fillStyle = 'rgba(255,255,255,0.25)'
      g.fillText('the last six seconds', rl, B + 14)

      // --- right: the spectrum, honest only once they fuse -------------------
      analyser.getFloatFrequencyData(spec)
      const binHz = ctx.audio.sampleRate / analyser.fftSize
      const sl = SPLIT + 20
      const sr2 = w - 26
      const LO = 40
      const HI = 4000
      const xOf = (hz: number) =>
        sl + (Math.log2(clamp(hz, LO, HI) / LO) / Math.log2(HI / LO)) * (sr2 - sl)
      g.beginPath()
      for (let k = 2; k < spec.length; k++) {
        const hz = k * binHz
        if (hz < LO || hz > HI) continue
        const x = xOf(hz)
        const y = B - clamp((spec[k] + 96) / 76, 0, 1) * (B - T)
        g.lineTo(x, y)
      }
      g.strokeStyle = 'rgba(125,211,252,0.5)'
      g.lineWidth = 1
      g.stroke()
      // where the voices should be
      for (let i = 0; i < n; i++) {
        const hz = (base * ints[i]) / ints[0]
        if (hz < LO || hz > HI) continue
        const hue = (196 + i * 34) % 360
        g.strokeStyle = `hsla(${hue},72%,64%,0.55)`
        g.setLineDash([2, 4])
        g.beginPath()
        g.moveTo(xOf(hz), T)
        g.lineTo(xOf(hz), B)
        g.stroke()
        g.setLineDash([])
      }
      g.textAlign = 'right'
      g.fillStyle = 'rgba(255,255,255,0.25)'
      g.fillText('what is actually there', sr2, B + 14)

      // --- readout --------------------------------------------------------------
      g.textAlign = 'left'
      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.75)'
      g.fillText(`${ints.join(' : ')}`, 26, T - 10)
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.4)'
      g.fillText(
        `${base < 1 ? `${(1 / base).toFixed(2)} s per pulse` : `${base.toFixed(1)} Hz`}` +
          `  ·  ${noteName(Math.round(ctx.params.root))} · ` +
          `${base > 30 ? 'a chord' : base < 12 ? 'a polyrhythm' : 'neither, quite'}`,
        26 + 90,
        T - 10,
      )
      // The cycle is the price of the tuning: every voice's rate is a whole
      // multiple of base/ints[0], so the whole figure repeats after ints[0]
      // pulses of the lowest voice. 4:5:6 costs four; 46:58:69 costs forty-six.
      const worst = errs.reduce((a, e) => Math.max(a, Math.abs(e)), 0)
      g.fillStyle = worst > 12 ? 'rgba(251,191,36,0.6)' : 'rgba(255,255,255,0.3)'
      g.fillText(
        `${worst.toFixed(0)}¢ from equal temperament` +
          `  ·  cycle ${ints[0]} pulses = ${(ints[0] / base).toFixed(2)} s` +
          `  ·  ${cents.map((c) => `${c.toFixed(0)}¢`).join(' ')}`,
        26,
        h - 12,
      )
      void level
    })
    void g

    ctx.status('drag "octaves down" slowly — the chord becomes a polyrhythm without changing')
  },
})
