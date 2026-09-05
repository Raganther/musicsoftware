import { clamp, loadWorklet, mtof, reverb, rng } from '@core'
import { defineSketch } from '@runtime/sketch'
import workletUrl from './bore.worklet.js?url'

/**
 * Why a saxophone overblows an octave and a clarinet a twelfth.
 *
 * `overblow` built the cylinder here and measured its register break at 2.98
 * against a predicted 3. The cone is the other half of that story and has been
 * sitting in `ideas.md` unbuilt since, with a note recording that the cheap way
 * of getting one — flipping the far-end reflection in a waveguide — does not
 * oscillate at all. A cone is not a sign flip.
 *
 * The difference is a boundary condition. Pressure in a cone goes as
 * p = (A/r)·sin(kr + φ) rather than as a plane wave, so a pressure release at
 * the open end and zero flow at the truncated apex give
 *
 *     kL + arctan(k·r₀) = nπ
 *
 * and the truncation r₀ is the whole story:
 *
 *   - **r₀ → 0**, a complete cone: kL = nπ, so the bore resonates at
 *     f, 2f, 3f, 4f — a full harmonic series
 *   - **r₀ → ∞**, a cylinder: kL = (n − ½)π, so f, 3f, 5f — odd only
 *
 * Everything between is a real truncated cone, which is what a saxophone
 * actually is: nobody plays an instrument with a needle-sharp apex, and the
 * mouthpiece stands in for the missing tip.
 *
 * So the mode frequencies are derived rather than imposed. What the reed does
 * with them is not: which mode it locks onto when the first one is spoiled is
 * nonlinear dynamics deciding, and that is the measurement. A bore with a
 * complete harmonic series should break at the octave and one with odd
 * harmonics at the twelfth, with everything between landing between.
 *
 * Measured 1.999 at truncation 0 and 2.986 at 20, worst error 0.060 across
 * six geometries — and that 2.986 lands on the 2.98 `overblow` measured with a
 * waveguide rather than a modal bore. Blowing harder, incidentally, never
 * changes register at all: eight pressures across five bores, no jump
 * anywhere, which is why instruments have register keys.
 */

/**
 * The n-th root of kL + arctan(t·kL) = nπ, where t = r₀/L.
 *
 * Monotone in x = kL, and bracketed between (n−1)π and nπ, so bisection is
 * both sufficient and exact to machine precision. Worth doing properly rather
 * than approximating: the whole point is that the frequencies come out of the
 * geometry, and an approximation here would be quietly imposing the answer.
 */
export function boreRoot(n: number, truncation: number): number {
  const f = (x: number) => x + Math.atan(truncation * x) - n * Math.PI
  let lo = (n - 1) * Math.PI + 1e-9
  let hi = n * Math.PI
  for (let i = 0; i < 90; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) < 0) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Mode frequencies of the bore, in Hz, given the first mode's pitch. */
export function boreModes(f1: number, truncation: number, count: number): number[] {
  const x1 = boreRoot(1, truncation)
  const out: number[] = []
  for (let n = 1; n <= count; n++) out.push((f1 * boreRoot(n, truncation)) / x1)
  return out
}

export default defineSketch({
  title: 'Cone',
  description: 'A reed on a bore you can morph from cone to cylinder — and the register break moves from an octave to a twelfth.',
  tags: ['dsp', 'worklet', 'physical-model', 'instrument'],
  status: 'promising',
  bpm: 84,
  division: 2,

  params: {
    /**
     * Truncation r₀/L. 0 is a complete cone (harmonic series), and by 6 the
     * arctan is most of the way to π/2; it takes about 20 before the bore is a
     * cylinder to within a percent, which is itself worth knowing — a
     * saxophone's truncation is small and its octave is genuine. The
     * interesting behaviour is between 0.1 and 1.
     */
    trunc: { type: 'number', value: 0.05, min: 0, max: 24, step: 0.01, label: 'Truncation (0 = full cone)' },
    note: { type: 'number', value: 50, min: 34, max: 70, step: 1, label: 'First mode (MIDI)' },
    blow: { type: 'number', value: 0.34, min: 0, max: 1.4, step: 0.005, label: 'Blowing pressure' },
    stiff: { type: 'number', value: 0.62, min: 0.15, max: 1.6, step: 0.01, label: 'Reed stiffness' },
    modes: { type: 'number', value: 12, min: 2, max: 24, step: 1, label: 'Modes' },
    damp: { type: 'number', value: 0.34, min: 0.05, max: 1.2, step: 0.01, label: 'Bore damping' },
    /**
     * Peak input impedance of the first mode. Each mode is normalised against a
     * *fixed* reference damping rather than its own, so relative heights are
     * controlled — that is what decides which mode the reed prefers — while the
     * vent can still push mode 1 down. That leaves the absolute scale as the
     * loop gain, and a reed sustains only when it beats the bore's losses: at
     * the default damping, 4 gives a tail RMS of 9.6e-4 and 6 gives 2.8e-1.
     */
    boreZ: { type: 'number', value: 9, min: 1, max: 40, step: 0.5, label: 'Bore impedance' },
    breath: { type: 'number', value: 0.004, min: 0, max: 0.03, step: 0.0005, label: 'Breath noise' },
    /**
     * A register key spoils the first resonance rather than retuning the bore —
     * a small hole near a pressure node of mode 2 wrecks mode 1 and leaves
     * mode 2 almost untouched, so the reed has nothing to lock onto but the
     * second. Modelled here as damping on mode 1 alone, which is the effect
     * without the geometry. `overblow` got its twelfth from a vent too, not
     * from blowing harder; blowing harder on its own does not change register.
     */
    vent: { type: 'number', value: 0, min: 0, max: 1, step: 0.01, label: 'Register vent' },
    auto: { type: 'toggle', value: true, label: 'Play itself' },
    space: { type: 'number', value: 0.2, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 11, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
Why a saxophone overblows an octave and a clarinet a twelfth. \`overblow\` built
the cylinder here and measured its break at 2.98; this is the other half, and
\`ideas.md\` has carried a note since then that the cheap way of getting a cone —
flipping the far-end reflection in a waveguide — does not oscillate at all.

The difference is a boundary condition. Pressure in a cone goes as
p = (A/r)·sin(kr + φ), so a pressure release at the open end and zero flow at
the truncated apex give **kL + arctan(k·r₀) = nπ**. A complete cone (r₀ → 0)
gives kL = nπ — a full harmonic series. A cylinder (r₀ → ∞) gives kL = (n−½)π —
odd harmonics only. Everything between is a real truncated cone, which is what
a saxophone is.

**The bore is where the arithmetic says.** Blown with noise and no pressure, the
resonances match the roots of that equation — solved by Newton in the harness
where the sketch bisects — to a worst error of **0.016** on ratios running up to
8.83, across truncations from 0 to 20. That is plumbing rather than discovery:
the resonators are where I put them. Nothing below means anything without it.

**The register break follows the geometry, and that is not plumbing.** A vent
spoils the first resonance so the reed has nothing to lock onto but the second;
which mode it then chooses is the nonlinear dynamics deciding, and it could have
picked the third, or refused to move.

| truncation | predicted m2/m1 | open | vented | measured break |
| --- | --- | --- | --- | --- |
| 0.00 | 2.000 | 1.00 | 2.00 | **1.999** |
| 0.20 | 2.055 | 1.02 | 2.09 | 2.044 |
| 0.60 | 2.271 | 1.03 | 2.29 | 2.211 |
| 1.50 | 2.543 | 1.01 | 2.53 | 2.500 |
| 4.00 | 2.777 | 0.99 | 2.76 | 2.793 |
| 20.0 | 2.948 | 0.98 | 2.94 | **2.986** |

Worst error **0.060** on a ratio that runs 2.00 to 2.95. A complete cone breaks
at an octave and a cylinder at a twelfth — and the cylinder's 2.986 sits on top
of the 2.98 \`overblow\` measured from a completely different model, a waveguide
rather than a modal bore. Two ways of being a clarinet agreeing to a hundredth.

**Blowing harder does not change register**, here or on a real instrument. The
first sweep tried it across eight pressures on five bores and found no jump
anywhere; the sounding pitch simply stays on the first mode and gets louder.
That is why instruments have register keys.

**There is a real oscillation threshold.** Bore impedance below about 5 gives
silence — a tail RMS of 9.6e-4 at impedance 4 against 2.8e-1 at 6, a factor of
300 across one step. A reed only sustains when the bore's peak impedance
exceeds its losses, and the cliff between those two numbers is that condition.

Levels: 0.51 pre-limiter at the defaults (0.508 and 0.517 on two smoke runs).

Set \`Truncation\` to 0 and push \`Register vent\` to 1: octave. Take truncation to
20 and do the same: twelfth. The bore in between is neither, which is exactly
why saxophone fingerings work in both registers and clarinet fingerings do not.
(Leave \`Play itself\` on and it alternates the vent for you, four bars each.)
`,

  async setup(ctx) {
    await loadWorklet(workletUrl)
    const node = new AudioWorkletNode(ctx.audio, 'cone-bore', { numberOfInputs: 0 })
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.2 })
    ctx.onParam('space', (v) => rev.setMix(v))
    node.connect(rev.input)

    let peak = 0
    node.port.onmessage = (e) => (peak = e.data.peak)
    ctx.cleanup(() => {
      node.port.postMessage({ type: 'panic' })
      node.disconnect()
      rev.dispose()
    })

    const sendModes = () => {
      const count = Math.round(ctx.params.modes)
      const fs = boreModes(mtof(Math.round(ctx.params.note)), ctx.params.trunc, count)
      node.port.postMessage({
        modes: fs.map((f, i) => ({
          f,
          // Higher modes lose energy faster, as they do in a real bore where
          // radiation and wall losses both climb with frequency.
          t60: Math.max(
            0.004,
            (ctx.params.damp / Math.pow(i + 1, 0.8)) * (i === 0 ? 1 - 0.985 * ctx.params.vent : 1),
          ),
          // The unvented damping, used only to normalise, so that opening the
          // vent genuinely lowers this mode's peak instead of being cancelled.
          t60ref: Math.max(0.004, ctx.params.damp / Math.pow(i + 1, 0.8)),
          // Modal amplitude falls with n; without this the top of the series
          // dominates and the reed locks onto whatever is loudest rather than
          // onto whatever the bore supports.
          g: ctx.params.boreZ / Math.pow(i + 1, 0.5),
        })),
      })
    }

    const sendReed = () => {
      node.port.postMessage({
        mouth: ctx.params.blow,
        pClose: ctx.params.stiff,
        reedW: 0.4,
        noise: ctx.params.breath,
        // Measured through the smoke gate, not guessed — see the notes.
        gain: 0.65 + ctx.params.level * 1.2,
        seed: Math.round(ctx.params.seed),
      })
    }
    sendModes()
    sendReed()
    for (const k of ['trunc', 'note', 'modes', 'damp', 'vent', 'boreZ'] as const) ctx.onParam(k, sendModes)
    for (const k of ['blow', 'stiff', 'breath', 'level', 'seed'] as const) ctx.onParam(k, sendReed)

    // -- playing itself --------------------------------------------------------

    let r = rng(Math.round(ctx.params.seed))
    ctx.onParam('seed', (v) => (r = rng(Math.round(v))))
    let phase = 0
    const timers = new Set<ReturnType<typeof setTimeout>>()
    ctx.cleanup(() => {
      for (const t of timers) clearTimeout(t)
      timers.clear()
    })

    ctx.clock.onStep((e) => {
      if (!ctx.params.auto) return
      if (e.step % 4 !== 0) return
      phase++
      // Four bars open, four bars vented: the same fingering in both registers,
      // which is the whole thing to listen for. Set the truncation and the
      // interval between them is what the geometry says it should be.
      const k = phase % 8
      const wobble = (r.next() - 0.5) * 0.04
      // Schedule against e.time — but a worklet message cannot be scheduled, so
      // wait out the lookahead rather than firing the change early.
      const wait = Math.max(0, (e.time - ctx.audio.currentTime) * 1000)
      const id = setTimeout(() => {
        timers.delete(id)
        ctx.set('vent', k < 4 ? 0 : 1)
        node.port.postMessage({ mouth: clamp(ctx.params.blow + wobble, 0, 1.6) })
      }, wait)
      timers.add(id)
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          node.port.postMessage({ type: 'panic', mouth: 0 })
          node.port.postMessage({ mouth: 0 })
          phase = 0
        } else sendReed()
      }),
    )

    // -- the series ------------------------------------------------------------

    const spec = ctx.audio.createAnalyser()
    spec.fftSize = 16384
    spec.smoothingTimeConstant = 0.6
    node.connect(spec)
    const bins = new Float32Array(spec.frequencyBinCount)
    ctx.cleanup(() => spec.disconnect())

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 46
      const top = 20
      const sr = ctx.audio.sampleRate
      const f1 = mtof(Math.round(ctx.params.note))
      const fs = boreModes(f1, ctx.params.trunc, Math.round(ctx.params.modes))
      const fLo = f1 * 0.6
      const fHi = f1 * 14
      const fx = (f: number) =>
        pad + (Math.log(clamp(f, fLo, fHi) / fLo) / Math.log(fHi / fLo)) * (w - pad - 16)

      // -- the ladder of modes, against the harmonic series --------------------
      const ladH = Math.max(80, h * 0.34)
      // where a complete harmonic series would put them
      for (let n = 1; n <= 14; n++) {
        const f = f1 * n
        if (f > fHi) break
        g.strokeStyle = 'rgba(255,255,255,0.10)'
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(fx(f), top)
        g.lineTo(fx(f), top + ladH)
        g.stroke()
      }
      // where this bore actually puts them
      fs.forEach((f, i) => {
        if (f > fHi) return
        const ratio = f / f1
        g.strokeStyle = `rgba(125,211,252,${0.85 - i * 0.045})`
        g.lineWidth = 2
        g.beginPath()
        g.moveTo(fx(f), top + 8)
        g.lineTo(fx(f), top + ladH)
        g.stroke()
        if (i < 6) {
          g.fillStyle = 'rgba(125,211,252,0.85)'
          g.font = '9px ui-monospace, monospace'
          g.fillText(ratio.toFixed(2), fx(f) - 8, top + 4)
        }
      })
      g.fillStyle = 'rgba(255,255,255,0.34)'
      g.font = '9px ui-monospace, monospace'
      g.fillText('the bore’s modes (blue) against a plain harmonic series (grey)', pad, h - 58)

      // -- the second mode as the truncation moves ------------------------------
      const cTop = top + ladH + 30
      const cH = Math.max(60, h - cTop - 74)
      const tMax = 3
      const cx = (t: number) => pad + (t / tMax) * (w - pad - 16)
      const cy = (ratio: number) => cTop + cH - ((ratio - 1.8) / 1.4) * cH
      for (const [lvl, label] of [[2, 'octave'], [3, 'twelfth']] as const) {
        g.strokeStyle = 'rgba(255,255,255,0.14)'
        g.setLineDash([3, 3])
        g.beginPath()
        g.moveTo(pad, cy(lvl))
        g.lineTo(w - 16, cy(lvl))
        g.stroke()
        g.setLineDash([])
        g.fillStyle = 'rgba(255,255,255,0.3)'
        g.fillText(label, w - 60, cy(lvl) - 3)
      }
      g.strokeStyle = 'rgba(251,191,36,0.85)'
      g.lineWidth = 1.8
      g.beginPath()
      for (let i = 0; i <= 240; i++) {
        const t = (i / 240) * tMax
        const ratio = boreRoot(2, t) / boreRoot(1, t)
        i === 0 ? g.moveTo(cx(t), cy(ratio)) : g.lineTo(cx(t), cy(ratio))
      }
      g.stroke()
      const hereT = clamp(ctx.params.trunc, 0, tMax)
      const hereR = boreRoot(2, ctx.params.trunc) / boreRoot(1, ctx.params.trunc)
      g.fillStyle = 'rgba(251,191,36,1)'
      g.beginPath()
      g.arc(cx(hereT), cy(hereR), 4.5, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = 'rgba(255,255,255,0.34)'
      g.fillText('second mode / first, as the cone is truncated toward a cylinder', pad, cTop - 6)

      // -- what it is actually doing --------------------------------------------
      spec.getFloatFrequencyData(bins)
      const bw = sr / spec.fftSize
      g.strokeStyle = 'rgba(248,113,113,0.5)'
      g.lineWidth = 1
      g.beginPath()
      let first = true
      let loud = -300
      let loudF = 0
      for (let i = 1; i < bins.length; i++) {
        const hz = i * bw
        if (hz < fLo) continue
        if (hz > fHi) break
        if (bins[i] > loud) {
          loud = bins[i]
          loudF = hz
        }
        const y = top + ladH - clamp((bins[i] + 100) / 100, 0, 1) * (ladH - 10)
        first ? (g.moveTo(fx(hz), y), (first = false)) : g.lineTo(fx(hz), y)
      }
      g.stroke()

      // -- numbers ---------------------------------------------------------------
      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.75)'
      g.fillText(
        `truncation ${ctx.params.trunc.toFixed(2)}  ·  modes at ` +
          fs.slice(0, 5).map((f) => (f / f1).toFixed(2)).join(', ') +
          `  ·  sounding ${loudF > 0 ? loudF.toFixed(0) + ' Hz' : '—'}` +
          `  ·  ${peak.toFixed(2)}`,
        pad,
        h - 26,
      )
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.42)'
      g.fillText(
        hereR < 2.35
          ? `a nearly complete cone: the series is ${fs.slice(0, 4).map((f) => (f / f1).toFixed(1)).join(':')}, ` +
            `so the vent should find the octave`
          : hereR > 2.75
            ? `effectively a cylinder: odd harmonics only, so the vent should find the twelfth`
            : `in between — the second mode is at ${hereR.toFixed(2)}, neither an octave nor a twelfth`,
        pad,
        h - 11,
      )
    })

    const wnd = window as unknown as Record<string, unknown>
    wnd.__cone = () => ({
      trunc: ctx.params.trunc,
      f1: mtof(Math.round(ctx.params.note)),
      modes: boreModes(mtof(Math.round(ctx.params.note)), ctx.params.trunc, Math.round(ctx.params.modes)),
      peak,
      blow: (p: number) => node.port.postMessage({ mouth: p }),
      vent: (v: number) => ctx.set('vent', v),
      panic: () => node.port.postMessage({ type: 'panic' }),
      tap: () => node,
    })
    ctx.cleanup(() => delete wnd.__cone)

    ctx.status('press space — same bore, same fingering, vent alternating; the truncation decides the interval')
  },
})
