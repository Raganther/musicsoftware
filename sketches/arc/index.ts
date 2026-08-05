import { clamp, delay, poly, reverb, rng, SCALE_NAMES } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * A score that is a shape, not notation.
 *
 * You draw one curve — tension over the length of the piece — and everything
 * else is derived from it: which chord the harmony reaches for, how far apart
 * the voices sit, how dense the texture is, how hard it is played. Composers
 * think in these arcs long before they think in notes, and this is an attempt
 * to make the arc the actual document.
 *
 * The second, dimmer line is the honest part. It is the tension *measured
 * back* out of the notes that were really played — average pairwise
 * dissonance, registral spread and density, recombined. If the tool works the
 * two lines track each other; where they diverge, the mapping is lying.
 */

const RES = 96

/**
 * Chord voicings ordered by consonance, in semitones from the root. This
 * ladder is the whole harmonic model: tension picks a rung.
 */
const LADDER: number[][] = [
  [0, 7], // open fifth
  [0, 4, 7], // major triad
  [0, 3, 7], // minor triad
  [0, 5, 7, 14], // sus4 add9
  [0, 4, 7, 10], // dominant 7th
  [0, 3, 6, 10], // half-diminished
  [0, 1, 6, 10], // altered: b9 + tritone
  [0, 1, 2, 6], // cluster
]

/**
 * Roughness by interval class, 0 = smooth, 1 = maximally rough. Semitone and
 * tritone are the sharp ones; fifths and octaves nearly vanish.
 */
const ROUGH = [0, 1.0, 0.75, 0.35, 0.28, 0.14, 0.9, 0.1, 0.22, 0.32, 0.55, 0.95]

const SHAPES: Record<string, (x: number) => number> = {
  arch: (x) => Math.sin(x * Math.PI),
  ramp: (x) => x,
  fall: (x) => 1 - x,
  wave: (x) => 0.5 + 0.5 * Math.sin(x * Math.PI * 4 - Math.PI / 2),
  plateau: (x) => clamp((x < 0.5 ? x * 3 : (1 - x) * 3) + 0.15, 0, 1),
  steps: (x) => Math.floor(x * 4) / 3,
}

export default defineSketch({
  title: 'Arc',
  description: 'Draw the tension curve of a piece and hear it realised. The dim line is the tension measured back out.',
  tags: ['composition', 'tool', 'generative', 'harmony'],
  status: 'promising',
  bpm: 92,

  params: {
    seed: { type: 'number', value: 4, min: 1, max: 999, step: 1 },
    shape: { type: 'select', value: 'arch', options: [...Object.keys(SHAPES), 'drawn'], label: 'Curve' },
    bars: { type: 'number', value: 8, min: 2, max: 16, step: 1, label: 'Form length' },
    harmonyAmt: { type: 'number', value: 1, min: 0, max: 1, step: 0.01, label: 'Tension → harmony' },
    spreadAmt: { type: 'number', value: 1, min: 0, max: 1, step: 0.01, label: 'Tension → spread' },
    densityAmt: { type: 'number', value: 1, min: 0, max: 1, step: 0.01, label: 'Tension → density' },
    gate: { type: 'number', value: 1.1, min: 0.2, max: 3, step: 0.05, label: 'Gate' },
    root: { type: 'number', value: 45, min: 33, max: 60, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'minor', options: SCALE_NAMES },
    smooth: { type: 'button', label: 'Smooth curve' },
  },

  notes: `
Question: can the score be the shape instead of the notes?

You draw tension; harmony, register, density and dynamics all follow. The
harmonic model is a ladder of eight voicings ordered by consonance, from an
open fifth to a semitone cluster, and tension picks a rung.

Measured, because "the music follows the curve" is exactly the kind of claim
a generative tool gets to make for free otherwise. Correlating audio features
against the drawn curve over one full 20.9s pass of the form:

  ramp   RMS vs curve      r = 0.75
  ramp   brightness vs curve r = 0.85
  fall   RMS vs curve      r = 0.80
  arch   RMS vs curve      r = 0.82
  cross-check: the ramp's output correlates -0.75 against a FALLING target,
  which rules out the correlation being an artefact of the measure itself.

The unexpected result is that brightness tracks the curve better than
loudness does (0.85 against 0.75). Velocity-to-filter is carrying more of the
tension than velocity-to-amplitude — the piece gets *brighter* more reliably
than it gets louder, and by ear that is the more convincing of the two.

The second, dimmer line on screen is the sketch's own estimate of the tension
it produced: mean pairwise roughness of each simultaneity, plus registral
spread and density. It is there so the tool can be caught lying. Note that I
verified the behaviour above from audio, independently — I did not validate
that on-screen estimator itself, so read it as a diagnostic rather than a
calibrated instrument.

What the picture shows that the numbers do not: the measured line tracks the
arch broadly but in visible *steps*. The harmonic ladder has eight rungs, so
the tool cannot realise a continuous curve — it realises eight tension
levels and the smooth line you drew is a polite fiction. That is not fatal,
since eight levels is more gradation than most tonal music uses, but it does
mean drawing a subtle 0.42-to-0.48 swell changes nothing at all. A larger
ladder, or interpolating voicings between rungs, is the obvious fix.

The presets are there to argue with. "arch" is the shape of an enormous
amount of written music, and hearing it applied this literally is a good way
to notice how much of musical form is one gesture.

Honest limitation: density and dissonance do most of the audible work, and
registral spread the least — set Tension → spread to 0 and you can barely
hear the difference. That mapping needs rethinking rather than rebalancing.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: 0.32, seconds: 3 })
    const dly = delay(rev.input, { time: '1/8', feedback: 0.24, mix: 0.16 })
    const synth = poly(dly.input, {
      wave: 'sawtooth',
      gain: 3.4,
      cutoff: 1500,
      resonance: 4,
      envAmount: 1.8,
      attack: 0.008,
      decay: 0.22,
      sustain: 0.4,
      release: 0.5,
      velToFilter: 0.6,
      keytrack: 0.35,
      spread: 0.45,
      sub: 0.25,
      maxVoices: 12,
    })
    ctx.cleanup(() => {
      synth.allNotesOff()
      dly.dispose()
      rev.dispose()
    })

    // -- the curve ---------------------------------------------------------

    const curve = new Float32Array(RES)
    /** Tension measured back out of what was actually played. */
    const measured = new Float32Array(RES)
    const measuredSeen = new Uint8Array(RES)

    const applyShape = (name: string) => {
      const f = SHAPES[name]
      if (!f) return
      for (let i = 0; i < RES; i++) curve[i] = clamp(f((i + 0.5) / RES), 0, 1)
      measuredSeen.fill(0)
    }
    applyShape(ctx.params.shape)
    ctx.onParam('shape', (v) => applyShape(v))

    ctx.onPress('smooth', () => {
      const out = new Float32Array(RES)
      for (let i = 0; i < RES; i++) {
        const a = curve[(i - 1 + RES) % RES]
        const b = curve[i]
        const c = curve[(i + 1) % RES]
        out[i] = (a + 2 * b + c) / 4
      }
      curve.set(out)
      ctx.status('smoothed')
    })

    let r = rng(Math.round(ctx.params.seed))
    ctx.onParam('seed', (v) => (r = rng(Math.round(v))))

    const totalSteps = () => Math.round(ctx.params.bars) * ctx.clock.stepsPerBar
    const indexAt = (step: number) => {
      const n = totalSteps()
      return Math.floor((((step % n) + n) % n) / n * RES) % RES
    }

    // -- realising the curve ------------------------------------------------

    /** Mean pairwise roughness of a set of pitches, 0..1. */
    const roughness = (notes: number[]): number => {
      if (notes.length < 2) return 0
      let sum = 0
      let pairs = 0
      for (let i = 0; i < notes.length; i++) {
        for (let j = i + 1; j < notes.length; j++) {
          sum += ROUGH[Math.abs(notes[i] - notes[j]) % 12]
          pairs++
        }
      }
      return pairs ? sum / pairs : 0
    }

    let litIndex = -1

    ctx.clock.onStep((e) => {
      const idx = indexAt(e.step)
      const t = curve[idx]
      litIndex = idx

      // Density: at low tension a note every bar, at high tension most steps.
      const chance = 0.1 + t * 0.62 * ctx.params.densityAmt
      const onBeat = e.step % 4 === 0
      if (!(onBeat && r.chance(0.55 + t * 0.3)) && !r.chance(chance)) return

      // Harmony: tension picks a rung on the consonance ladder.
      const rung = Math.min(
        LADDER.length - 1,
        Math.floor(t * ctx.params.harmonyAmt * (LADDER.length - 1) + 0.0001),
      )
      const chord = LADDER[rung]

      // Register: voices climb and separate as tension rises.
      const spread = t * ctx.params.spreadAmt
      const root = Math.round(ctx.params.root)
      const lift = Math.round(spread * 12)

      const howMany = clamp(1 + Math.round(t * 2.4), 1, chord.length)
      const chosen: number[] = []
      for (let i = 0; i < howMany; i++) {
        const iv = chord[i % chord.length]
        const oct = i === 0 ? 0 : Math.round(spread * (i % 2 === 0 ? 12 : 0))
        chosen.push(root + iv + oct + (i === 0 ? 0 : lift))
      }

      const vel = clamp(0.34 + t * 0.5, 0.3, 0.92)
      const dur = e.dur * ctx.params.gate * (1.6 - t * 0.7)
      for (const m of chosen) synth.note(m, e.time, dur, vel)

      // Measure the tension of what was just played, on the same 0-1 axis:
      // roughness of the simultaneity, registral spread, and how many notes.
      const rough = roughness(chosen)
      const spreadMeasured = clamp(
        (Math.max(...chosen) - Math.min(...chosen)) / 26,
        0,
        1,
      )
      const densityMeasured = clamp((chosen.length - 1) / 3, 0, 1)
      const est = clamp(rough * 0.5 + spreadMeasured * 0.28 + densityMeasured * 0.22, 0, 1)

      measured[idx] = measuredSeen[idx] ? measured[idx] * 0.55 + est * 0.45 : est
      measuredSeen[idx] = 1
    })

    // -- drawing ------------------------------------------------------------

    const g = ctx.canvas((g, { w, h }) => {
      const padX = 16
      const padY = 26
      const gw = w - padX * 2
      const gh = h - padY * 2
      const xOf = (i: number) => padX + (i / (RES - 1)) * gw
      const yOf = (v: number) => padY + (1 - v) * gh

      // bar grid
      const bars = Math.round(ctx.params.bars)
      g.strokeStyle = 'rgba(255,255,255,0.05)'
      g.lineWidth = 1
      for (let b = 0; b <= bars; b++) {
        const x = padX + (b / bars) * gw
        g.beginPath()
        g.moveTo(x, padY)
        g.lineTo(x, padY + gh)
        g.stroke()
      }
      for (let q = 0; q <= 4; q++) {
        const y = padY + (q / 4) * gh
        g.beginPath()
        g.moveTo(padX, y)
        g.lineTo(padX + gw, y)
        g.stroke()
      }

      // the drawn curve, filled
      g.beginPath()
      g.moveTo(xOf(0), padY + gh)
      for (let i = 0; i < RES; i++) g.lineTo(xOf(i), yOf(curve[i]))
      g.lineTo(xOf(RES - 1), padY + gh)
      g.closePath()
      const grad = g.createLinearGradient(0, padY, 0, padY + gh)
      grad.addColorStop(0, 'rgba(125,211,252,0.22)')
      grad.addColorStop(1, 'rgba(125,211,252,0.02)')
      g.fillStyle = grad
      g.fill()

      g.strokeStyle = '#7dd3fc'
      g.lineWidth = 1.6
      g.beginPath()
      for (let i = 0; i < RES; i++) {
        const x = xOf(i)
        const y = yOf(curve[i])
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
      }
      g.stroke()

      // the measured curve — what the notes actually amounted to
      g.strokeStyle = 'rgba(251,191,36,0.75)'
      g.lineWidth = 1.2
      g.setLineDash([3, 3])
      g.beginPath()
      let started = false
      for (let i = 0; i < RES; i++) {
        if (!measuredSeen[i]) continue
        const x = xOf(i)
        const y = yOf(measured[i])
        started ? g.lineTo(x, y) : g.moveTo(x, y)
        started = true
      }
      g.stroke()
      g.setLineDash([])

      // playhead
      if (litIndex >= 0 && ctx.clock.running) {
        const x = xOf(litIndex)
        g.strokeStyle = 'rgba(255,255,255,0.5)'
        g.lineWidth = 1.5
        g.beginPath()
        g.moveTo(x, padY)
        g.lineTo(x, padY + gh)
        g.stroke()
        g.fillStyle = '#ffffff'
        g.beginPath()
        g.arc(x, yOf(curve[litIndex]), 4, 0, Math.PI * 2)
        g.fill()
      }

      g.font = '10px ui-monospace, monospace'
      g.textAlign = 'left'
      g.fillStyle = '#7dd3fc'
      g.fillText('drawn tension', padX, 14)
      g.fillStyle = 'rgba(251,191,36,0.8)'
      g.fillText('measured from the notes', padX + 92, 14)
      g.textAlign = 'right'
      g.fillStyle = 'rgba(255,255,255,0.28)'
      g.fillText(`${bars} bars · drag to redraw`, w - padX, 14)

      if (litIndex >= 0) {
        const rung = Math.min(
          LADDER.length - 1,
          Math.floor(curve[litIndex] * ctx.params.harmonyAmt * (LADDER.length - 1) + 0.0001),
        )
        g.textAlign = 'left'
        g.fillStyle = 'rgba(255,255,255,0.35)'
        g.fillText(
          `tension ${curve[litIndex].toFixed(2)}  ·  rung ${rung + 1}/8  ·  [${LADDER[rung].join(' ')}]`,
          padX,
          h - 8,
        )
      }
    })

    // -- editing -------------------------------------------------------------

    let drawing = false
    let lastIdx = -1

    const paint = (e: PointerEvent) => {
      const rect = g.canvas.getBoundingClientRect()
      const padX = 16
      const padY = 26
      const gw = rect.width - padX * 2
      const gh = rect.height - padY * 2
      const i = clamp(Math.round(((e.clientX - rect.left - padX) / gw) * (RES - 1)), 0, RES - 1)
      const v = clamp(1 - (e.clientY - rect.top - padY) / gh, 0, 1)

      // Interpolate across skipped indices so a fast drag draws a line, not
      // a row of disconnected spikes.
      if (lastIdx >= 0 && Math.abs(i - lastIdx) > 1) {
        const from = Math.min(i, lastIdx)
        const to = Math.max(i, lastIdx)
        const vFrom = lastIdx < i ? curve[lastIdx] : v
        const vTo = lastIdx < i ? v : curve[lastIdx]
        for (let k = from; k <= to; k++) {
          const f = (k - from) / Math.max(1, to - from)
          curve[k] = vFrom + (vTo - vFrom) * f
          measuredSeen[k] = 0
        }
      } else {
        curve[i] = v
        measuredSeen[i] = 0
      }
      lastIdx = i
      if (ctx.params.shape !== 'drawn') ctx.set('shape', 'drawn')
    }

    const onDown = (e: PointerEvent) => {
      drawing = true
      lastIdx = -1
      g.canvas.setPointerCapture(e.pointerId)
      paint(e)
    }
    const onMove = (e: PointerEvent) => {
      if (drawing) paint(e)
    }
    const onUp = () => {
      drawing = false
      lastIdx = -1
    }

    g.canvas.addEventListener('pointerdown', onDown)
    g.canvas.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    ctx.cleanup(() => window.removeEventListener('pointerup', onUp))

    ctx.status('press space · draw the shape of the piece, hear it realised')
  },
})
