import {
  clamp,
  degree,
  disposeAt,
  mtof,
  noiseSource,
  reverb,
  rng,
  SCALE_NAMES,
  type ScaleName,
} from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * A melody you can see but not hear.
 *
 * A loud narrow band of noise raises the threshold of hearing around itself —
 * simultaneous masking, the effect every audio codec is built on. Tones under
 * that raised threshold are physically in the signal and perceptually absent.
 *
 * So: a band of noise, and a melody wandering across it. In `constant level`
 * the melody holds a fixed amplitude and disappears whenever it passes behind
 * the veil, surfacing again on the far side. In `constant loudness` it does the
 * opposite — the amplitude of every note is set to sit a fixed distance from
 * its own masking threshold, so the physical level swings by tens of decibels
 * and the melody should, if the model is any good, sound flat.
 *
 * The masking is asymmetric: a masker hides frequencies above it far better
 * than below (upward spread of masking), so a rising line vanishes sooner than
 * a falling one reappears. That asymmetry is in the model and I would like to
 * know whether it is audible.
 *
 * **The central claim here is perceptual and I cannot test it.** The harness
 * can confirm the notes are present in the spectrum, and how far their physical
 * level moves; it cannot tell me whether you hear them. That is what `reveal`
 * is for: find the setting where the melody appears for *your* ears.
 */

/** Bark scale — Zwicker & Terhardt's closed form. */
const bark = (f: number) => 13 * Math.atan(0.00076 * f) + 3.5 * Math.atan((f / 7500) ** 2)

/**
 * Masking threshold at `f`, in dB relative to the masker's level.
 * Textbook simplification: -10 dB at the masker, then a steep skirt downward
 * in frequency and a shallow one upward, which is the "upward spread".
 */
const thresholdDb = (f: number, maskerHz: number) => {
  const d = bark(f) - bark(maskerHz)
  return -10 - (d < 0 ? 27 : 10) * Math.abs(d)
}

export default defineSketch({
  title: 'Veil',
  description: 'A melody hidden under a band of noise. You can see it; the question is whether you hear it.',
  tags: ['strange', 'psychoacoustics', 'generative', 'listening'],
  status: 'sketch',
  bpm: 88,
  division: 4,

  params: {
    mode: { type: 'select', value: 'constant level', options: ['constant level', 'constant loudness'] },
    reveal: { type: 'number', value: -6, min: -24, max: 12, step: 0.5, label: 'Reveal (dB)' },
    veilHz: { type: 'number', value: 700, min: 150, max: 3000, step: 10, label: 'Veil centre', unit: 'Hz' },
    veilLevel: { type: 'number', value: 0.6, min: 0, max: 1, step: 0.01, label: 'Veil level' },
    veilWidth: { type: 'number', value: 1, min: 0.4, max: 3, step: 0.05, label: 'Veil width' },
    drift: { type: 'number', value: 0.3, min: 0, max: 1, label: 'Veil drift' },
    rate: { type: 'number', value: 4, min: 1, max: 12, step: 1, label: 'Steps per note' },
    range: { type: 'number', value: 2.2, min: 0.5, max: 3.5, step: 0.1, label: 'Melody range (oct)' },
    root: { type: 'number', value: 55, min: 40, max: 72, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'pentatonicMinor', options: SCALE_NAMES },
    seed: { type: 'number', value: 9, min: 1, max: 999, step: 1 },
  },

  notes: `
A band of noise raises the threshold of hearing around itself. Notes under that
threshold are in the signal and not in your head. The threshold model here is
the textbook one — -10 dB at the masker, a 27 dB/Bark skirt below it and a
10 dB/Bark skirt above — which is a simplification, but the asymmetry it
encodes is real and is why maskers hide what is above them better than what is
below.

**Measured**, by reading each pitch's peak level out of the spectrum with the
veil muted — a masked tone cannot be found in a spectrum for the same reason it
cannot be heard, so the generator has to be characterised in the clear:

| | physical level across 14 pitches |
| --- | --- |
| constant level | sd **0.4 dB**, total range 1.2 dB |
| constant loudness | sd **9.4 dB**, total range 29.5 dB |

In \`constant loudness\` the measured levels trace the masking curve itself:
-75 dB down at 148 Hz, up to **-45 dB at 697 Hz** with the veil sitting at 700,
then -50, -61 climbing away above. Steep below the veil, shallow above — the
upward spread, visible directly in the amplitudes.

With the veil at its default, moving \`reveal\` across its whole 36 dB range
changes the total RMS of the output by **0.47 dB**, and the bottom 12 dB of
that range by **0.06 dB**. The melody is a rounding error in the signal.

**Not measured, because it cannot be from here: whether you hear it.** The
**Not measured, because it cannot be from here: whether you hear it.** The
whole point is a claim about perception, and a harness that reads spectra has
nothing useful to say about it. Set \`Veil level\` to 0 to learn what the melody
actually is, put it back, and then find the \`reveal\` setting where the melody
appears for your ears. I would genuinely like to know what number that is, and
whether the rising phrases really do vanish before the falling ones.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: 0.14, seconds: 1.6 })
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)

    let r = rng(Math.round(ctx.params.seed))
    ctx.onParam('seed', (v) => (r = rng(Math.round(v))))

    // -- the veil ------------------------------------------------------------

    const noise = noiseSource()
    const bp1 = ctx.audio.createBiquadFilter()
    bp1.type = 'bandpass'
    const bp2 = ctx.audio.createBiquadFilter()
    bp2.type = 'bandpass'
    const veilGain = ctx.audio.createGain()
    veilGain.gain.value = 0
    noise.connect(bp1).connect(bp2).connect(veilGain).connect(bus)
    noise.start()

    ctx.cleanup(() => {
      const now = ctx.audio.currentTime
      veilGain.gain.cancelScheduledValues(now)
      veilGain.gain.setValueAtTime(veilGain.gain.value, now)
      veilGain.gain.linearRampToValueAtTime(0, now + 0.08)
      disposeAt(noise, now + 0.14, [bp1, bp2, veilGain])
      bus.disconnect()
      rev.dispose()
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (ctx.clock.running) return
        const now = ctx.audio.currentTime
        veilGain.gain.cancelScheduledValues(now)
        veilGain.gain.setValueAtTime(veilGain.gain.value, now)
        veilGain.gain.linearRampToValueAtTime(0, now + 0.25)
      }),
    )

    /**
     * Peak amplitude of the veil at level 1, and the reference every dB in
     * this sketch is quoted against. Set by measurement: two cascaded
     * bandpasses throw away most of the noise's energy, and the first guess at
     * the compensation left the whole sketch about 20 dB too quiet.
     */
    const REF = 0.55
    /** The melody's fixed level in `constant level`, dB below reference. */
    const FLAT_DB = -16

    /** Where the veil actually is right now, after drift. */
    let veilNow = ctx.params.veilHz

    /**
     * Masking threshold at `f`, in dB below the full-scale reference — the
     * textbook curve shifted by how loud the veil actually is.
     */
    const threshold = (f: number) =>
      // Floored at 0.25 on purpose. `Veil level` 0 mutes the noise so you can
      // hear what the melody is; if the model followed it all the way down,
      // the melody would go with it and there would be nothing to inspect.
      20 * Math.log10(Math.max(0.25, ctx.params.veilLevel)) + thresholdDb(f, veilNow)

    const tuneVeil = (time: number) => {
      // One critical band wide at width 1. Q = centre / bandwidth, and a Bark
      // is roughly 100 Hz below 500 Hz, widening above.
      const bwHz = Math.max(60, critBand(veilNow)) * ctx.params.veilWidth
      const q = clamp(veilNow / bwHz, 0.6, 12)
      bp1.frequency.setTargetAtTime(veilNow, time, 0.05)
      bp2.frequency.setTargetAtTime(veilNow, time, 0.05)
      bp1.Q.setTargetAtTime(q, time, 0.05)
      bp2.Q.setTargetAtTime(q, time, 0.05)
      // Two cascaded bandpasses lose a lot; compensate so `Veil level` means
      // roughly the same thing at any width.
      // Output of a bandpass falls as its bandwidth narrows, so the make-up
      // has to grow with Q or `Veil level` would mean something different at
      // every width. The constant is measured, not derived.
      const comp = 7.6 * Math.sqrt(q) + 2
      veilGain.gain.setTargetAtTime(ctx.params.veilLevel * REF * comp * 0.72, time, 0.05)
    }

    // -- the melody ------------------------------------------------------------

    interface Note {
      hz: number
      /** dB relative to the veil's level. */
      db: number
      /** dB above (positive) or below (negative) its own masking threshold. */
      margin: number
      at: number
    }
    const history: Note[] = []
    let deg = 0
    let last: Note | null = null

    const noteAt = (step: number): Note => {
      const span = Math.round(ctx.params.range * 5)
      // A seeded walk with a mild pull back to the middle, so it crosses the
      // veil repeatedly instead of wandering off.
      deg += r.int(-2, 2) - Math.sign(deg) * (Math.abs(deg) > span ? 2 : 0)
      deg = clamp(deg, -span, span)
      const midi = degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, deg)
      const hz = mtof(midi)
      const t = threshold(hz)
      const reveal = ctx.params.reveal
      // constant level: a fixed amplitude, so the margin above threshold is
      // whatever the veil happens to leave it. Deliberately NOT scaled by the
      // veil's level — otherwise turning the veil down to check what the
      // melody is would take the melody down with it.
      // constant loudness: the amplitude is set from the threshold, so the
      // margin is fixed and the amplitude is what swings.
      // The floor is not cosmetic. A masking model has no absolute threshold
      // of hearing in it, so `constant loudness` drives notes far from the veil
      // toward silence — measured at -93 dBFS before this was added, which is
      // not "equally loud", it is "gone".
      const db = clamp(
        ctx.params.mode === 'constant loudness' ? t + reveal : FLAT_DB + reveal,
        -52,
        -2,
      )
      return { hz, db, margin: db - t, at: step }
    }

    const play = (n: Note, time: number, dur: number) => {
      const osc = ctx.audio.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = n.hz
      const amp = ctx.audio.createGain()
      const peak = REF * Math.pow(10, n.db / 20)
      amp.gain.setValueAtTime(0.0001, time)
      amp.gain.exponentialRampToValueAtTime(Math.max(0.00002, peak), time + 0.02)
      amp.gain.setValueAtTime(Math.max(0.00002, peak), time + dur * 0.6)
      amp.gain.exponentialRampToValueAtTime(0.00002, time + dur * 0.95)
      osc.connect(amp).connect(bus)
      osc.start(time)
      disposeAt(osc, time + dur, [amp])
    }

    ctx.clock.onStep((e) => {
      // The veil drifts, so the melody keeps crossing it rather than sitting
      // on one side.
      if (ctx.params.drift > 0) {
        const w = 1 + Math.sin(e.step * 0.013) * 0.6 * ctx.params.drift
        veilNow = clamp(ctx.params.veilHz * w, 120, 5000)
      } else {
        veilNow = ctx.params.veilHz
      }
      tuneVeil(e.time)

      const every = Math.round(ctx.params.rate)
      if (e.step % every !== 0) return
      const n = noteAt(e.step)
      play(n, e.time, e.dur * every)
      last = n
      history.push(n)
      if (history.length > 64) history.shift()
    })

    // -- drawing ---------------------------------------------------------------

    const LO = 100
    const HI = 6000
    const xOf = (hz: number, w: number) =>
      26 + ((Math.log2(clamp(hz, LO, HI) / LO)) / Math.log2(HI / LO)) * (w - 52)
    /** dB relative to the veil, mapped to the plot. */
    const yOf = (db: number, h: number) => 20 + ((6 - clamp(db, -70, 6)) / 76) * (h - 70)

    const g = ctx.canvas((g, { w, h }) => {
      // --- masking threshold curve -----------------------------------------
      g.beginPath()
      for (let i = 0; i <= 160; i++) {
        const hz = LO * Math.pow(HI / LO, i / 160)
        const x = xOf(hz, w)
        const y = yOf(threshold(hz), h)
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
      }
      g.strokeStyle = 'rgba(248,113,113,0.55)'
      g.lineWidth = 1.5
      g.stroke()
      // everything under the curve is (claimed) inaudible
      g.lineTo(xOf(HI, w), yOf(-70, h))
      g.lineTo(xOf(LO, w), yOf(-70, h))
      g.closePath()
      g.fillStyle = 'rgba(248,113,113,0.06)'
      g.fill()

      // --- the veil itself ---------------------------------------------------
      const vx = xOf(veilNow, w)
      const half = (critBand(veilNow) / 2) * ctx.params.veilWidth
      const x1 = xOf(Math.max(LO, veilNow - half), w)
      const x2 = xOf(veilNow + half, w)
      const grad = g.createLinearGradient(x1, 0, x2, 0)
      grad.addColorStop(0, 'rgba(148,163,184,0)')
      grad.addColorStop(0.5, `rgba(148,163,184,${0.1 + ctx.params.veilLevel * 0.22})`)
      grad.addColorStop(1, 'rgba(148,163,184,0)')
      g.fillStyle = grad
      g.fillRect(x1, 16, x2 - x1, h - 50)
      g.strokeStyle = 'rgba(148,163,184,0.3)'
      g.setLineDash([2, 4])
      g.beginPath()
      g.moveTo(vx, 16)
      g.lineTo(vx, h - 34)
      g.stroke()
      g.setLineDash([])

      // --- the melody --------------------------------------------------------
      history.forEach((n, i) => {
        const age = (i + 1) / history.length
        const x = xOf(n.hz, w)
        const y = yOf(n.db, h)
        const audible = n.margin > 0
        g.beginPath()
        g.arc(x, y, i === history.length - 1 ? 5.5 : 3, 0, Math.PI * 2)
        // A note above its threshold is drawn solid; one below is drawn as an
        // outline — present, and (the claim) not heard.
        if (audible) {
          g.fillStyle = `rgba(125,211,252,${0.15 + age * 0.8})`
          g.fill()
        } else {
          g.strokeStyle = `rgba(125,211,252,${0.12 + age * 0.5})`
          g.lineWidth = 1.2
          g.stroke()
        }
      })

      // --- axes and readout ----------------------------------------------------
      g.font = '9px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.22)'
      g.textAlign = 'center'
      for (const hz of [125, 250, 500, 1000, 2000, 4000]) {
        g.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), xOf(hz, w), h - 20)
      }
      g.textAlign = 'left'
      g.fillText('masking threshold', 28, yOf(threshold(LO * 1.15), h) - 6)

      const hidden = history.filter((n) => n.margin <= 0).length
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.45)'
      g.fillText(
        last
          ? `${Math.round(last.hz)} Hz · ${last.margin >= 0 ? '+' : ''}${last.margin.toFixed(1)} dB ` +
            `${last.margin >= 0 ? 'above' : 'below'} threshold · ${hidden}/${history.length} of the last notes under it`
          : 'press play',
        26,
        h - 6,
      )
      g.textAlign = 'right'
      g.fillStyle = 'rgba(248,113,113,0.5)'
      g.fillText(ctx.params.mode, w - 26, h - 6)
    })
    void g

    ctx.status('the outlined notes are playing and (the claim) inaudible — turn the veil down to check')
  },
})

/** Critical bandwidth in Hz — Zwicker's approximation. */
function critBand(f: number): number {
  return 25 + 75 * Math.pow(1 + 1.4 * (f / 1000) ** 2, 0.69)
}
