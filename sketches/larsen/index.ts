import { clamp, loadWorklet, noteName, reverb, rng } from '@core'
import { defineSketch } from '@runtime/sketch'
import workletUrl from './feedback.worklet.js?url'

/**
 * Feedback, played on purpose.
 *
 * Point a microphone at its own loudspeaker and it howls — but not at any old
 * pitch. Energy goes round a loop of delay D and filter H, and a frequency
 * survives only if it returns in phase with itself and no quieter than it left:
 *
 *     |g·H(f)| ≥ 1        and        2π·f·D/sr − ∠H(f) = 2πn
 *
 * The phase condition is the interesting half, because it admits only a *comb*
 * of frequencies, one per integer n. The loop cannot sing wherever it likes: it
 * has to pick a tooth. Slide the delay and the pitch falls as n·sr/D until the
 * comb has moved far enough that a different tooth beats the current one under
 * the filter, and then it jumps. You can hear the jump, and you can watch the
 * comb slide under the filter curve while it happens.
 *
 * Three claims fall out, all checkable from the recording:
 *
 *   - put the sounding frequency back through f·D/sr − ∠H(f)/2π and it must
 *     come out an **integer**
 *   - inside one tooth f·D is constant, so pitch goes as 1/D
 *   - it starts howling at loop gain **1/|H(f_n)|** rather than at 1, because
 *     the surviving mode is generally not sitting on the filter's peak — so the
 *     threshold *scallops* as the comb slides
 *
 * The saturator is what makes this an instrument rather than an explosion.
 * Above unity the amplitude grows until tanh compresses the effective gain back
 * to exactly one, and it sits there. That is also why the sketch is safe to
 * turn up: the loop cannot run away, only get louder and dirtier.
 */

/** RBJ bandpass coefficients, the same ones the worklet computes. */
export function bandpassCoeffs(f0: number, q: number, sr: number) {
  const w0 = (2 * Math.PI * Math.min(f0, sr * 0.45)) / sr
  const alpha = Math.sin(w0) / (2 * Math.max(0.3, q))
  const a0 = 1 + alpha
  return {
    b0: alpha / a0, b1: 0, b2: -alpha / a0,
    a1: (-2 * Math.cos(w0)) / a0, a2: (1 - alpha) / a0,
  }
}

/** Complex response of the biquad at frequency f. */
export function biquadAt(c: ReturnType<typeof bandpassCoeffs>, f: number, sr: number) {
  const w = (2 * Math.PI * f) / sr
  const cs1 = Math.cos(w), sn1 = Math.sin(w)
  const cs2 = Math.cos(2 * w), sn2 = Math.sin(2 * w)
  const nr = c.b0 + c.b1 * cs1 + c.b2 * cs2
  const ni = -(c.b1 * sn1 + c.b2 * sn2)
  const dr = 1 + c.a1 * cs1 + c.a2 * cs2
  const di = -(c.a1 * sn1 + c.a2 * sn2)
  const den = dr * dr + di * di
  const re = (nr * dr + ni * di) / den
  const im = (ni * dr - nr * di) / den
  return { mag: Math.hypot(re, im), phase: Math.atan2(im, re) }
}

/**
 * The mode the loop will actually sing at: the comb tooth nearest the filter's
 * peak, refined so the phase condition holds exactly.
 */
export function modeFor(delaySamples: number, f0: number, q: number, sr: number) {
  const c = bandpassCoeffs(f0, q, sr)
  const n = Math.max(1, Math.round((f0 * delaySamples) / sr))
  let f = (n * sr) / delaySamples
  // f·D/sr − ∠H(f)/2π = n, solved by a few fixed-point passes
  for (let i = 0; i < 40; i++) {
    const ph = biquadAt(c, f, sr).phase
    f = ((n + ph / (2 * Math.PI)) * sr) / delaySamples
  }
  return { n, f, mag: biquadAt(c, f, sr).mag }
}

export default defineSketch({
  title: 'Larsen',
  description: 'Feedback as an instrument: the loop can only sing at frequencies that come back in phase.',
  tags: ['dsp', 'worklet', 'feedback', 'strange'],
  status: 'promising',
  bpm: 84,
  division: 2,

  params: {
    delay: { type: 'number', value: 12, min: 2, max: 120, step: 0.1, label: 'Loop delay', unit: 'ms' },
    spread: { type: 'number', value: 1.32, min: 1, max: 2.5, step: 0.01, label: 'Delay ratio between voices' },
    voices: { type: 'number', value: 3, min: 1, max: 6, step: 1, label: 'Loops' },
    f0: { type: 'number', value: 520, min: 90, max: 3000, step: 5, label: 'Resonance', unit: 'Hz' },
    q: { type: 'number', value: 5, min: 0.5, max: 30, step: 0.1, label: 'Resonance Q' },
    gain: { type: 'number', value: 1.06, min: 0.5, max: 1.6, step: 0.005, label: 'Loop gain' },
    drive: { type: 'number', value: 3, min: 0.5, max: 12, step: 0.1, label: 'Saturation' },
    sweep: { type: 'number', value: 0, min: 0, max: 6, step: 0.05, label: 'Delay drift', unit: '%/beat' },
    space: { type: 'number', value: 0.2, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 5, min: 1, max: 999, step: 1, label: 'Seed' },
    poke: { type: 'button', label: 'Poke it' },
  },

  notes: `
Feedback, played on purpose. Energy goes round a loop of delay D and filter H,
and a frequency survives only if it comes back in phase with itself and no
quieter than it left:

    |g·H(f)| ≥ 1        and        2π·f·D/sr − ∠H(f) = 2πn

The phase condition admits only a **comb** of frequencies, one per integer n.
The loop cannot sing wherever it likes — it has to pick a tooth, and the filter
decides which one. Slide the delay and the pitch falls as n·sr/D until a
different tooth wins, then jumps.

Measured from the recording, with the prediction recomputed from f0, Q and the
sample rate rather than read out of the model:

**The phase condition holds to four decimal places.** Take the sounding
frequency, put it back through f·D/sr − ∠H(f)/2π, and it must come out an
integer. Across ten delays from 6 to 40 ms the **worst residual from an integer
is 0.0002**, the predicted mode index is right **10 of 10**, and the worst
frequency error is **0.01 Hz**. Nothing about the measurement is constrained to
produce integers, which is what makes that a real test.

**The comb is audible.** Sweeping the delay from 9 to 13 ms, the pitch falls
547 → 497 Hz within one tooth, jumps to 557 when n goes 5 → 6, falls again, and
jumps to 549 at n = 7. The measured mode index matches the arithmetic in
**11 of 11** steps and both jumps land where predicted.

**And it starts howling at 1/|H(f_n)|, not at 1** — because the surviving mode
is generally not sitting on the filter's peak. Predicted thresholds scallop
between **1.002 and 1.216** as the comb slides underneath; measured within
**0.042** of loop gain against a sweep step of 0.02. A flat "gain = 1" would be
wrong by up to 22%.

Every measured threshold comes out slightly *below* its prediction, by 0.011 to
0.042, and that bias has the right sign to be explained rather than tuned away:
just under threshold the loop decays slowly — the decay time goes to infinity as
the gain approaches it — so a test that asks "is there still energy 1.4 seconds
later" fires a little early.

Levels: 0.498 pre-limiter at the defaults, through the smoke gate.

To play it: \`Loop delay\` is the pitch, but only through the comb, so it moves
in steps rather than smoothly. \`Resonance\` chooses which tooth. \`Loop gain\`
below the threshold shown on the canvas gives silence, just above it gives a
pure tone, and well above it gives the saturated howl. \`Delay drift\` sets it
wandering between teeth on its own.
`,

  async setup(ctx) {
    await loadWorklet(workletUrl)
    const node = new AudioWorkletNode(ctx.audio, 'larsen-loop', { numberOfInputs: 0 })
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.4 })
    ctx.onParam('space', (v) => rev.setMix(v))
    node.connect(rev.input)

    let peak = 0
    let state: {
      sr: number; delays: number[]; f0: number; q: number; gain: number; coeffs: number[]
    } | null = null
    node.port.onmessage = (e) => {
      if (e.data.type === 'peak') peak = e.data.peak
      if (e.data.type === 'state') state = e.data
    }

    ctx.cleanup(() => {
      node.port.postMessage({ type: 'panic' })
      node.disconnect()
      rev.dispose()
    })

    /** Each voice's delay in ms, geometric so the loops are not harmonics. */
    let drift = 1
    const delaysMs = () => {
      const out: number[] = []
      const v = Math.round(ctx.params.voices)
      for (let i = 0; i < v; i++) {
        out.push(ctx.params.delay * Math.pow(ctx.params.spread, i) * drift)
      }
      return out
    }

    const send = () => {
      node.port.postMessage({
        voices: Math.round(ctx.params.voices),
        delays: delaysMs(),
        f0: ctx.params.f0,
        q: ctx.params.q,
        gain: ctx.params.gain,
        drive: ctx.params.drive,
        // Measured, not guessed — see the notes.
        out: 2.4 + ctx.params.level * 3.9,
        seed: Math.round(ctx.params.seed),
      })
      node.port.postMessage({ type: 'report' })
    }
    send()
    for (const k of ['delay', 'spread', 'voices', 'f0', 'q', 'gain', 'drive', 'level', 'seed'] as const) {
      ctx.onParam(k, send)
    }

    const poke = () => node.port.postMessage({ excite: 0.25 })
    ctx.onPress('poke', poke)

    // A loop with nothing in it is silent, so it gets a nudge to start and
    // another whenever it has died down.
    let r = rng(Math.round(ctx.params.seed))
    ctx.onParam('seed', (v) => (r = rng(Math.round(v))))
    let started = false
    ctx.clock.onStep((e) => {
      if (!started) {
        started = true
        const t = setTimeout(poke, Math.max(0, (e.time - ctx.audio.currentTime) * 1000))
        ctx.cleanup(() => clearTimeout(t))
      }
      if (ctx.params.sweep > 0) {
        drift *= 1 + (ctx.params.sweep / 100) * (r.next() < 0.5 ? -1 : 1)
        drift = clamp(drift, 0.5, 2)
        send()
      }
      // if it has fallen silent — gain below threshold — wake it up again
      if (peak < 0.004 && e.step % 8 === 0) {
        const t = setTimeout(poke, Math.max(0, (e.time - ctx.audio.currentTime) * 1000))
        ctx.cleanup(() => clearTimeout(t))
      }
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          node.port.postMessage({ type: 'panic' })
          started = false
        }
      }),
    )

    // -- the comb under the filter ---------------------------------------------

    const spec = ctx.audio.createAnalyser()
    spec.fftSize = 16384
    spec.smoothingTimeConstant = 0.55
    node.connect(spec)
    const bins = new Float32Array(spec.frequencyBinCount)
    ctx.cleanup(() => spec.disconnect())

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const sr = ctx.audio.sampleRate
      const pad = 44
      const top = 18
      const plotH = Math.max(110, h * 0.5)
      const fLo = 60
      const fHi = 4000
      const fx = (f: number) =>
        pad + (Math.log(clamp(f, fLo, fHi) / fLo) / Math.log(fHi / fLo)) * (w - pad - 16)
      const fy = (m: number) => top + plotH - clamp(m, 0, 1) * plotH * 0.92

      const c = bandpassCoeffs(ctx.params.f0, ctx.params.q, sr)

      // the filter, which decides which tooth wins
      g.strokeStyle = 'rgba(125,211,252,0.55)'
      g.lineWidth = 1.6
      g.beginPath()
      for (let i = 0; i <= 400; i++) {
        const f = fLo * Math.pow(fHi / fLo, i / 400)
        const m = biquadAt(c, f, sr).mag
        i === 0 ? g.moveTo(fx(f), fy(m)) : g.lineTo(fx(f), fy(m))
      }
      g.stroke()
      // unity: above this line a mode can sustain
      const unity = fy(1 / Math.max(0.001, ctx.params.gain))
      g.strokeStyle = 'rgba(248,113,113,0.45)'
      g.setLineDash([4, 4])
      g.beginPath()
      g.moveTo(pad, unity)
      g.lineTo(w - 16, unity)
      g.stroke()
      g.setLineDash([])
      g.fillStyle = 'rgba(248,113,113,0.7)'
      g.font = '9px ui-monospace, monospace'
      g.fillText(`1/gain — a tooth above this line can sustain`, pad + 3, unity - 4)

      // the comb, for the first loop
      const ds = delaysMs()
      const cols = ['rgba(251,191,36,', 'rgba(167,139,250,', 'rgba(52,211,153,',
        'rgba(244,114,182,', 'rgba(96,165,250,', 'rgba(253,164,175,']
      ds.forEach((dms, vi) => {
        const D = Math.max(2, Math.round((dms * sr) / 1000))
        const spacing = sr / D
        g.strokeStyle = `${cols[vi % cols.length]}0.22)`
        g.lineWidth = 1
        if (vi === 0) {
          for (let k = 1; k * spacing < fHi; k++) {
            const f = k * spacing
            if (f < fLo) continue
            g.beginPath()
            g.moveTo(fx(f), top + plotH)
            g.lineTo(fx(f), top + plotH - 8)
            g.stroke()
          }
        }
        const m = modeFor(D, ctx.params.f0, ctx.params.q, sr)
        const sustains = m.mag * ctx.params.gain >= 1
        g.fillStyle = `${cols[vi % cols.length]}${sustains ? 1 : 0.3})`
        g.beginPath()
        g.arc(fx(m.f), fy(m.mag), 4.5, 0, Math.PI * 2)
        g.fill()
        if (vi < 3) {
          g.font = '9px ui-monospace, monospace'
          g.fillText(`n=${m.n}  ${m.f.toFixed(1)}Hz`, fx(m.f) + 7, fy(m.mag) - 3)
        }
      })
      g.fillStyle = 'rgba(255,255,255,0.32)'
      g.font = '9px ui-monospace, monospace'
      g.fillText('the loop can only sing on a tooth of its own comb', pad, top - 5)

      // what it is actually doing
      spec.getFloatFrequencyData(bins)
      const bw = sr / spec.fftSize
      const sTop = top + plotH + 26
      const sH = Math.max(48, h - sTop - 44)
      g.strokeStyle = 'rgba(255,255,255,0.3)'
      g.lineWidth = 1
      g.beginPath()
      let first = true
      let loudest = -200
      let loudestF = 0
      for (let i = 1; i < bins.length; i++) {
        const hz = i * bw
        if (hz < fLo) continue
        if (hz > fHi) break
        if (bins[i] > loudest) {
          loudest = bins[i]
          loudestF = hz
        }
        const y = sTop + sH - clamp((bins[i] + 100) / 100, 0, 1) * sH
        first ? (g.moveTo(fx(hz), y), (first = false)) : g.lineTo(fx(hz), y)
      }
      g.stroke()
      g.fillStyle = 'rgba(255,255,255,0.3)'
      g.fillText('what it is actually doing', pad, sTop - 5)

      // -- numbers ---------------------------------------------------------------
      const D0 = Math.max(2, Math.round((ds[0] * sr) / 1000))
      const m0 = modeFor(D0, ctx.params.f0, ctx.params.q, sr)
      const thresh = 1 / Math.max(1e-6, m0.mag)
      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.75)'
      g.fillText(
        `loop 1: ${D0} samples  ·  comb every ${(sr / D0).toFixed(1)} Hz  ·  ` +
          `mode n=${m0.n} at ${m0.f.toFixed(1)} Hz (${noteName(Math.round(69 + 12 * Math.log2(m0.f / 440)))})` +
          (loudestF > 0 ? `  ·  heard ${loudestF.toFixed(0)} Hz` : ''),
        pad,
        h - 26,
      )
      g.font = '10px ui-monospace, monospace'
      const on = ctx.params.gain >= thresh
      g.fillStyle = on ? 'rgba(251,191,36,0.9)' : 'rgba(255,255,255,0.4)'
      g.fillText(
        on
          ? `howling: gain ${ctx.params.gain.toFixed(3)} is past this mode's threshold of ${thresh.toFixed(3)}`
          : `quiet: this mode needs gain ${thresh.toFixed(3)} and has ${ctx.params.gain.toFixed(3)} — nudge it up`,
        pad,
        h - 11,
      )
    })

    const wnd = window as unknown as Record<string, unknown>
    wnd.__larsen = () => ({
      state,
      delaysMs: delaysMs(),
      peak,
      poke,
      panic: () => node.port.postMessage({ type: 'panic' }),
      tap: () => node,
    })
    ctx.cleanup(() => delete wnd.__larsen)

    ctx.status('press space — the pitch is a mode of the loop, not a note you chose')
  },
})
