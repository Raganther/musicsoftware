import {
  clamp,
  degree,
  delay,
  loadWorklet,
  mtof,
  reverb,
  rng,
  SCALE_NAMES,
  type ScaleName,
} from '@core'
import { defineSketch } from '@runtime/sketch'
import workletUrl from './fm.worklet.js?url'

/**
 * A nonlinear dynamical system you play.
 *
 * Two FM operators modulate each other inside a single sample. Raise the
 * coupling and the pair runs the textbook route to chaos: pure tone →
 * sidebands → period doubling → broadband noise. That route *is* the timbre
 * knob, so the instrument is really a way of navigating a bifurcation.
 *
 * The picture is not a decoration: it plots (y1, y2) straight from the audio
 * thread, so it is the system's actual phase portrait. A closed loop means a
 * periodic waveform and a pitched sound; a filled tangle means chaos and
 * noise. Sound and image are the same state, which is the most honest visual
 * this repo has managed.
 *
 * The Order/Chaos meter is measured, not asserted: it's the live spectral
 * flatness of the output.
 */

export default defineSketch({
  title: 'Attractor',
  description: 'Coupled feedback FM. Ride the route to chaos; the picture is the real phase portrait.',
  tags: ['dsp', 'worklet', 'synth', 'strange'],
  status: 'promising',
  bpm: 84,

  params: {
    seed: { type: 'number', value: 17, min: 1, max: 999, step: 1 },
    couple: { type: 'number', value: 1.75, min: 0, max: 3, step: 0.01, label: 'Coupling' },
    ratio: { type: 'number', value: 1.5, min: 0.25, max: 8, step: 0.01, label: 'Ratio' },
    asym: { type: 'number', value: 0.3, min: -1, max: 1, step: 0.01, label: 'Asymmetry' },
    blend: { type: 'number', value: 0.35, min: 0, max: 1, step: 0.01, label: 'Blend' },
    drift: { type: 'number', value: 0.35, min: 0, max: 1, step: 0.01, label: 'Coupling drift' },
    level: { type: 'number', value: 0.8, min: 0, max: 1, step: 0.01, label: 'Level' },
    glide: { type: 'number', value: 0.05, min: 0, max: 0.5, step: 0.005, unit: 's' },
    density: { type: 'number', value: 0.5, min: 0.05, max: 1, step: 0.01, label: 'Density' },
    root: { type: 'number', value: 38, min: 24, max: 60, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'pentatonicMinor', options: SCALE_NAMES },
    autoplay: { type: 'toggle', value: true, label: 'Auto sequence' },
  },

  notes: `
Question: can a bifurcation be an instrument?

Coupling is the whole sketch, and the route to chaos is much sharper than I
assumed. Measured spectral flatness of the voice (0 = one pure tone, 1 =
white noise), pitch and level held constant, drift and sequencer off:

  0.15  0.0005      a sine
  0.80  0.0014      still essentially a sine
  1.60  0.0091      bright, metallic, firmly pitched
  1.90  0.1079      <-- the knee. 12x the flatness of 1.60
  2.10  0.1366
  2.30  0.2105      a bell that is arguing
  2.50  0.3138
  2.80  0.4161      broken; pitch survives only as a shadow

I had guessed the transition was gradual across 0.6-1.7 and set the default
coupling to 0.75 on that basis. It was wrong and the default was sitting in
a dead zone: everything below ~1.5 is an ordinary FM voice. The whole
instrument lives between about 1.5 and 2.3, and the default now sits at 1.75
— just past the knee, where drift can carry it back and forth across the
transition. That is the good sound: a tone repeatedly *almost* falling apart.

Why it cannot blow up, which cost one line rather than a safety net: sin() is
bounded whatever its argument, so no amount of feedback makes y1 or y2 exceed
±1, and the tanh on the sum bounds the output. Measured worst case at maximum
coupling, maximum level and an awkward ratio: 0.456 pre-limiter. Chaotic but
structurally stable — the right nonlinearity is a guarantee, not a limiter
bolted on afterwards.

Unmeasured, by ear only: integer ratios seem to stay consonant further into
the coupling range than irrational ones. I tried to confirm it with flatness
and could not — flatness measures noisiness, not inharmonicity, and at
coupling 1.2 ratio 2.0 and ratio 1.5 both read ~0.0015. It needs a harmonic-
deviation measure to test properly, so treat the claim as an impression.

Next: per-note coupling, so a hard-struck note lands further into chaos and
dynamics move you through the bifurcation; and a third operator, which should
open quasi-periodic territory rather than merely more chaos.
`,

  async setup(ctx) {
    await loadWorklet(workletUrl)

    const rev = reverb(ctx.out, { mix: 0.3, seconds: 2.8 })
    const dly = delay(rev.input, { time: '3/16', feedback: 0.34, mix: 0.24 })

    const node = new AudioWorkletNode(ctx.audio, 'attractor-fm', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    })
    const amp = ctx.audio.createGain()
    amp.gain.value = 0
    node.connect(amp).connect(dly.input)

    // Analyser on the raw voice, before delay and reverb — the flatness
    // reading has to describe the oscillator, not the room.
    const analyser = ctx.audio.createAnalyser()
    analyser.fftSize = 4096
    analyser.smoothingTimeConstant = 0.6
    node.connect(analyser)
    const spectrum = new Float32Array(analyser.frequencyBinCount)

    ctx.cleanup(() => {
      node.disconnect()
      amp.disconnect()
      analyser.disconnect()
      dly.dispose()
      rev.dispose()
    })

    const pFreq = node.parameters.get('frequency')!
    const pRatio = node.parameters.get('ratio')!
    const pCouple = node.parameters.get('couple')!
    const pAsym = node.parameters.get('asym')!
    const pBlend = node.parameters.get('blend')!

    const now = () => ctx.audio.currentTime
    pRatio.value = ctx.params.ratio
    pCouple.value = ctx.params.couple
    pAsym.value = ctx.params.asym
    pBlend.value = ctx.params.blend

    ctx.onParam('ratio', (v) => pRatio.setTargetAtTime(v, now(), 0.02))
    ctx.onParam('couple', (v) => pCouple.setTargetAtTime(v, now(), 0.03))
    ctx.onParam('asym', (v) => pAsym.setTargetAtTime(v, now(), 0.03))
    ctx.onParam('blend', (v) => pBlend.setTargetAtTime(v, now(), 0.03))

    // -- phase portrait feed ------------------------------------------------

    /** Recent (y1, y2) frames from the audio thread; oldest first. */
    const frames: Float32Array[] = []
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      frames.push(e.data)
      if (frames.length > 3) frames.shift()
    }

    // -- sequencing ---------------------------------------------------------

    const r = rng(Math.round(ctx.params.seed))
    let currentNote = Math.round(ctx.params.root)
    let driftPhase = 0

    const play = (midiNote: number, time: number, dur: number, vel: number) => {
      currentNote = midiNote
      const freq = mtof(midiNote)
      const glide = ctx.params.glide
      if (glide > 0) {
        pFreq.cancelScheduledValues(time)
        pFreq.setTargetAtTime(freq, time, glide / 3)
      } else {
        pFreq.setValueAtTime(freq, time)
      }
      const peak = ctx.params.level * vel
      amp.gain.cancelScheduledValues(time)
      amp.gain.setTargetAtTime(peak, time, 0.01)
      amp.gain.setTargetAtTime(0, time + dur * 0.75, dur * 0.3)
    }

    ctx.clock.onStep((e) => {
      // Coupling drift: a slow wander through the bifurcation, so a held
      // timbre keeps finding new sidebands without anyone touching a knob.
      const d = ctx.params.drift
      if (d > 0 && e.step % 4 === 0) {
        driftPhase += 0.11
        const target = clamp(
          ctx.params.couple + Math.sin(driftPhase) * d * 0.9 + (r.next() - 0.5) * d * 0.25,
          0,
          3,
        )
        pCouple.setTargetAtTime(target, e.time, 0.45)
      }

      if (!ctx.params.autoplay) return
      if (e.step % 4 !== 0 && !r.chance(0.2)) return
      if (!r.chance(ctx.params.density)) return

      const deg = r.pick([0, 0, 2, 3, 4, 5, 7, -2, 9])
      const note = degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, deg)
      play(note, e.time, e.dur * r.pick([2, 3, 4, 6, 8]), 0.65 + r.next() * 0.35)
    })

    // -- drawing ------------------------------------------------------------

    /** Spectral flatness: geometric mean / arithmetic mean of the spectrum. */
    const flatness = (): number => {
      analyser.getFloatFrequencyData(spectrum)
      let logSum = 0
      let sum = 0
      let n = 0
      for (let k = 2; k < spectrum.length; k++) {
        // dB -> linear power, floored so silence can't dominate the log mean.
        const p = Math.max(1e-10, Math.pow(10, spectrum[k] / 10))
        logSum += Math.log(p)
        sum += p
        n++
      }
      if (!n || sum <= 0) return 0
      return clamp(Math.exp(logSum / n) / (sum / n), 0, 1)
    }

    let smoothFlat = 0

    const g = ctx.canvas((g, { w, h }) => {
      // Leave room below the square for the meter and its labels — sizing
      // off min(w,h) alone pushed the labels past the canvas edge.
      const size = Math.min(w - 40, h - 120)
      const cx = w / 2
      const cy = (h - 44) / 2
      const half = size / 2

      // axes
      g.strokeStyle = 'rgba(255,255,255,0.06)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(cx - half, cy)
      g.lineTo(cx + half, cy)
      g.moveTo(cx, cy - half)
      g.lineTo(cx, cy + half)
      g.stroke()
      g.strokeStyle = 'rgba(255,255,255,0.08)'
      g.strokeRect(cx - half, cy - half, size, size)

      // The attractor itself, straight from the audio thread. Newest frame
      // brightest; a closed loop is a pitched sound, a tangle is chaos.
      frames.forEach((f, fi) => {
        g.strokeStyle = `rgba(125, 211, 252, ${0.12 + fi * 0.22})`
        g.lineWidth = fi === frames.length - 1 ? 1.1 : 0.7
        g.beginPath()
        for (let i = 0; i < f.length; i += 2) {
          const x = cx + f[i] * half
          const y = cy - f[i + 1] * half
          i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
        }
        g.stroke()
      })

      // Order/chaos meter — measured, not asserted.
      const flat = flatness()
      smoothFlat += (flat - smoothFlat) * 0.12
      const barW = size
      const bx = cx - half
      const by = cy + half + 18
      g.fillStyle = 'rgba(255,255,255,0.06)'
      g.fillRect(bx, by, barW, 6)
      const lit = clamp(Math.pow(smoothFlat, 0.5), 0, 1) * barW
      const grad = g.createLinearGradient(bx, 0, bx + barW, 0)
      grad.addColorStop(0, '#7dd3fc')
      grad.addColorStop(0.55, '#fbbf24')
      grad.addColorStop(1, '#fb7185')
      g.fillStyle = grad
      g.fillRect(bx, by, lit, 6)

      g.font = '9px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.textAlign = 'left'
      g.fillText('order', bx, by + 18)
      g.textAlign = 'right'
      g.fillText('chaos', bx + barW, by + 18)
      g.textAlign = 'center'
      g.fillText(`flatness ${smoothFlat.toFixed(3)}`, cx, by + 18)

      g.textAlign = 'left'
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.4)'
      g.fillText(
        `couple ${pCouple.value.toFixed(2)}  ·  ratio ${pRatio.value.toFixed(2)}  ·  ${currentNote}`,
        12,
        16,
      )
      g.textAlign = 'right'
      g.fillStyle = 'rgba(255,255,255,0.22)'
      g.fillText('drag: x = coupling, y = ratio', w - 12, 16)
    })

    // -- direct control -----------------------------------------------------

    let dragging = false
    const steer = (e: PointerEvent) => {
      const rect = g.canvas.getBoundingClientRect()
      const x = clamp((e.clientX - rect.left) / rect.width, 0, 1)
      const y = clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1)
      ctx.set('couple', Number((x * 3).toFixed(2)))
      ctx.set('ratio', Number((0.25 + y * 5.75).toFixed(2)))
    }

    const onDown = (e: PointerEvent) => {
      dragging = true
      g.canvas.setPointerCapture(e.pointerId)
      steer(e)
    }
    const onMove = (e: PointerEvent) => {
      if (dragging) steer(e)
    }
    const onUp = () => (dragging = false)

    g.canvas.addEventListener('pointerdown', onDown)
    g.canvas.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    ctx.cleanup(() => window.removeEventListener('pointerup', onUp))

    ctx.status('press space · drag across the portrait to ride the bifurcation')
  },
})
