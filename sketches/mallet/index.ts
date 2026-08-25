import { clamp, loadWorklet, mtof, noteName, reverb, rng } from '@core'
import { defineSketch } from '@runtime/sketch'
import workletUrl from './hammer.worklet.js?url'

/**
 * The mallet, not the bar.
 *
 * Most physical models put their effort into the resonator and hit it with a
 * canned impulse. That gets the pitch right and the dynamics wrong: a bar
 * struck harder is not the same sound louder, it is a brighter sound, and the
 * reason has nothing to do with the bar.
 *
 * A mallet is a nonlinear spring. Two curved elastic bodies in contact follow
 * Hertz's law, F = k·c^p with p = 3/2, and for that force law the contact time
 * depends on arrival speed:
 *
 *     t_contact  ∝  v^((1-p)/(1+p))
 *
 * which is v^(-1/5) at p = 3/2 — hit it harder and the mallet is in contact for
 * *less* time, and a shorter contact reaches higher modes. At p = 1 the
 * exponent is zero and contact time is completely independent of velocity,
 * which is the ordinary mass-on-a-spring result.
 *
 * So \`Mallet hardness\` at 1 is the control, and it is a real one: the bar
 * should get louder and not brighter. Anything above 1 should give both.
 *
 * The bar's mode ratios are computed rather than remembered. A free-free beam's
 * modes are at (βL)² where cos(βL)·cosh(βL) = 1, so the sketch finds those
 * roots by bisection at load — 4.730, 7.853, 10.996 and so on, giving ratios
 * 1 : 2.76 : 5.40. \`Undercut\` bends them toward the 1 : 4 : 10 a marimba bar
 * is carved to, which is why a marimba sounds like a pitch and a glockenspiel
 * sounds like a clang.
 */

/** Roots of cos(x)·cosh(x) = 1, the free-free beam eigenvalues. */
function beamRoots(count: number): number[] {
  // cosh overflows fast, so work with f(x) = cos(x) − 1/cosh(x), same roots.
  const f = (x: number) => Math.cos(x) - 1 / Math.cosh(x)
  const out: number[] = []
  let x = 3.0
  const step = 0.05
  let prev = f(x)
  while (out.length < count && x < 200) {
    x += step
    const cur = f(x)
    if (prev === 0 || (prev < 0) !== (cur < 0)) {
      let lo = x - step
      let hi = x
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2
        if ((f(lo) < 0) !== (f(mid) < 0)) hi = mid
        else lo = mid
      }
      out.push((lo + hi) / 2)
    }
    prev = cur
  }
  return out
}

export default defineSketch({
  title: 'Mallet',
  description: 'The excitation is the instrument. A linear mallet gets louder; a real one gets brighter.',
  tags: ['dsp', 'worklet', 'physical-model', 'instrument'],
  status: 'promising',
  bpm: 84,
  division: 4,

  params: {
    hardness: { type: 'number', value: 1.5, min: 1, max: 3.5, step: 0.01, label: 'Mallet hardness (p)' },
    stiff: { type: 'number', value: 24, min: 4, max: 160, step: 1, label: 'Head stiffness', unit: 'N @ 250µm' },
    mass: { type: 'number', value: 8, min: 1, max: 40, step: 0.5, label: 'Mallet mass', unit: 'g' },
    force: { type: 'number', value: 0.55, min: 0.05, max: 1, step: 0.01, label: 'How hard' },
    undercut: { type: 'number', value: 0.75, min: 0, max: 1, step: 0.01, label: 'Undercut (bar → marimba)' },
    modes: { type: 'number', value: 8, min: 3, max: 16, step: 1, label: 'Modes' },
    where: { type: 'number', value: 0.5, min: 0.04, max: 0.96, step: 0.01, label: 'Where you hit it' },
    ring: { type: 'number', value: 2.2, min: 0.2, max: 8, step: 0.1, label: 'Ring', unit: 's' },
    every: { type: 'number', value: 8, min: 2, max: 32, step: 1, label: 'Strike every', unit: 'steps' },
    space: { type: 'number', value: 0.24, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    root: { type: 'number', value: 55, min: 36, max: 76, step: 1, label: 'Root (MIDI)' },
    seed: { type: 'number', value: 7, min: 1, max: 999, step: 1 },
    hit: { type: 'button', label: 'Strike' },
  },

  notes: `
The claim: for a contact force F = k·c^p the contact time goes as
v^((1-p)/(1+p)), so at p = 1 a mallet gets louder without getting brighter and
at p > 1 it gets both. p = 1 is a real control — the whole coupled system is
linear there, so the spectrum *cannot* move, and if it moves I have a bug.

Measured, all three from the shipped build:

  mode ratios vs the free-free beam roots, undercut 0
    1.000  2.757  5.404  8.933  13.344  18.638 — 0.000% disagreement

  contact time vs strike velocity, ms (model state, not sound)
    p       0.3    0.6    1.2    2.4    4.8    fitted   predicted
    1.00   0.907  0.907  0.907  0.907  0.907   0.000     0.000
    1.50   1.156  0.998  0.884  0.748  0.658  -0.204    -0.200
    2.00   1.338  1.043  0.839  0.658  0.522  -0.338    -0.333
    3.00   1.542  1.088  0.771  0.544  0.385  -0.500    -0.500

  mode 4 : mode 1 in the audio, same velocities
    1.00  .0155  .0152  .0153  .0152  .0152   -0.005   <- flat, as required
    1.50  .0019  .0064  .0053  .0079  .0196    0.699
    2.00  .0017  .0032  .0037  .0026  .0495    0.935
    3.00  .0002  .0020  .0195  .1207  .2677    2.641

The control is flat to 1% over a 16x velocity range while everything else
climbs, and both survive a 4x level change (p=1: -0.005 and -0.005; p=2: 0.927
and 0.932), so nothing nonlinear downstream is making the trend.

Two things I got wrong first and would get wrong again. Stiffness cannot be a
raw k, because k in N/m^p means a different mallet at every p — the first
version was 100x quieter at p = 3 and the "control" was changing the level.
It is now the force at 250 µm compression, which is how you would measure a
real head. And the sketch had a tanh on its output that was fully saturating;
every spectrum I measured through it was the tanh's harmonics. There is no
soft-clipper here now, only a runaway clamp at ±2 that never engages.

Defaults peak 0.548 pre-limiter over 14 s, 0.383 over the smoke suite's shorter
window — the strike force is randomised, so how loud it gets depends on how
long you listen. p = 1.5 gives 0.66-1.16 ms of contact, which
is a real marimba mallet; p = 3 gives 1.54 ms falling to 0.39, also plausible.
Turn Undercut to 0 for a glockenspiel clang and 1 for a marimba pitch — same
bar, same mallet, only the mode ratios move.
`,

  async setup(ctx) {
    await loadWorklet(workletUrl)
    const node = new AudioWorkletNode(ctx.audio, 'mallet-hammer', { numberOfInputs: 0 })
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.2 })
    ctx.onParam('space', (v) => rev.setMix(v))
    node.connect(rev.input)
    ctx.cleanup(() => {
      node.port.postMessage({ type: 'panic' })
      node.disconnect()
      rev.dispose()
    })

    type Report = { peak: number; raw: number; drive: number; contactMs: number; force: number; scope: number[] }
    let reported: Report = { peak: 0, raw: 0, drive: 0, contactMs: 0, force: 0, scope: [] }
    /** Running maxima, so headroom and saturation can be read directly. */
    let rawMax = 0
    let driveMax = 0
    node.port.onmessage = (e) => {
      reported = e.data
      if (reported.raw > rawMax) rawMax = reported.raw
      if (reported.drive > driveMax) driveMax = reported.drive
    }

    const ROOTS = beamRoots(20)
    let freqs: number[] = []

    const build = () => {
      const count = Math.round(ctx.params.modes)
      const f0 = mtof(Math.round(ctx.params.root))
      const where = ctx.params.where
      const under = ctx.params.undercut
      const ring = ctx.params.ring
      const sr = ctx.audio.sampleRate
      // Ideal free-free beam ratios from the computed roots, bent toward the
      // undercut marimba's 1 : 4 : 10 : 20 as `undercut` rises.
      const ideal = ROOTS.map((b) => (b / ROOTS[0]) ** 2)
      const tuned = [1, 4, 10, 20, 32, 46, 62, 80]
      freqs = []
      const modes = []
      for (let i = 0; i < count; i++) {
        const a = ideal[i]
        const b = i < tuned.length ? tuned[i] : ideal[i]
        const ratio = a * (1 - under) + b * under
        const f = Math.min(sr * 0.45, f0 * ratio)
        freqs.push(f)
        // Free-free beam mode shape, near enough for a strike weighting: the
        // nth mode has n+1 antinodes across the bar.
        const shape = Math.cos((i + 1) * Math.PI * where) * (i % 2 === 0 ? 1 : -1)
        modes.push({
          f,
          t60: Math.max(0.05, ring / Math.pow(ratio, 0.42)),
          shape: Math.abs(shape) < 0.02 ? 0.02 * Math.sign(shape || 1) : shape,
          // higher modes are stiffer to move, which is why a soft mallet
          // cannot reach them however hard you swing
          mmass: 1 + i * 0.55,
        })
      }
      node.port.postMessage({ modes })
    }
    build()
    for (const k of ['modes', 'root', 'where', 'undercut', 'ring'] as const) ctx.onParam(k, build)

    const send = () => {
      node.port.postMessage({
        hardness: ctx.params.hardness,
        // newtons at 250 µm compression, not a raw k — see the worklet
        stiff: ctx.params.stiff,
        mass: ctx.params.mass / 1000,
        gain: ctx.params.level * 1.4,
      })
    }
    send()
    for (const k of ['hardness', 'stiff', 'mass', 'level'] as const) ctx.onParam(k, send)

    /** Strike velocity in metres per second — a real mallet is 0.3 to 4 m/s. */
    const velocityOf = (f: number) => 0.25 + f * f * 3.6

    const strike = (f: number) => node.port.postMessage({ strike: velocityOf(clamp(f, 0.02, 1)) })
    ctx.onPress('hit', () => strike(ctx.params.force))

    let step = 0
    let nextAt = -1
    ctx.clock.onStep((e) => {
      if (e.step < nextAt) return
      nextAt = e.step + Math.round(ctx.params.every)
      const r = rng(Math.round(ctx.params.seed) * 811 + step)
      step++
      const f = clamp(ctx.params.force * (0.7 + r.next() * 0.6), 0.02, 1)
      const wait = Math.max(0, (e.time - ctx.audio.currentTime) * 1000)
      const t = setTimeout(() => strike(f), wait)
      ctx.cleanup(() => clearTimeout(t))
    })
    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (ctx.clock.running) nextAt = -1
        else node.port.postMessage({ type: 'panic' })
      }),
    )

    const spec = ctx.audio.createAnalyser()
    spec.fftSize = 8192
    spec.smoothingTimeConstant = 0.4
    node.connect(spec)
    const bins = new Float32Array(spec.frequencyBinCount)
    ctx.cleanup(() => spec.disconnect())

    // -- drawing ---------------------------------------------------------------

    const g = ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const padL = 44
      const padR = 14
      const top = 20

      // -- the contact force, as it actually happened ---------------------------
      const scopeH = Math.max(60, h * 0.26)
      const sc = reported.scope
      g.fillStyle = 'rgba(255,255,255,0.03)'
      g.fillRect(padL, top, w - padL - padR, scopeH)
      if (sc.length) {
        const mx = Math.max(1e-9, ...sc)
        g.strokeStyle = 'rgba(251,191,36,0.95)'
        g.lineWidth = 1.5
        g.beginPath()
        sc.forEach((v, i) => {
          const x = padL + (i / (sc.length - 1)) * (w - padL - padR)
          const y = top + scopeH - (v / mx) * scopeH * 0.92
          i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
        })
        g.stroke()
      }
      g.font = '9px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.3)'
      g.fillText(
        `contact force — ${reported.contactMs.toFixed(2)} ms in contact, peak ${reported.force.toFixed(0)} N`,
        padL + 2,
        top - 6,
      )

      // -- the spectrum, with the computed mode positions -----------------------
      const specTop = top + scopeH + 30
      const specH = Math.max(70, h - specTop - 74)
      spec.getFloatFrequencyData(bins)
      const sr = ctx.audio.sampleRate
      const bw = sr / spec.fftSize
      // Log frequency. The top mode is 60x the bottom one at full undercut, so
      // on a linear axis the entire bar lives in the left 5% of the plot.
      const minF = Math.max(20, (freqs[0] ?? 200) * 0.6)
      const maxF = Math.max(minF * 4, (freqs[freqs.length - 1] ?? 2000) * 1.5)
      const span = Math.log(maxF / minF)
      const sx = (hz: number) => padL + (Math.log(clamp(hz, minF, maxF) / minF) / span) * (w - padL - padR)
      const sy = (db: number) => specTop + (1 - clamp((db + 96) / 96, 0, 1)) * specH

      g.strokeStyle = 'rgba(125,211,252,0.75)'
      g.lineWidth = 1
      g.beginPath()
      let started = false
      for (let k = 1; k < bins.length; k++) {
        const hz = k * bw
        if (hz < minF) continue
        if (hz > maxF) break
        const x = sx(hz)
        const y = sy(bins[k])
        started ? g.lineTo(x, y) : g.moveTo(x, y)
        started = true
      }
      g.stroke()

      freqs.forEach((f, i) => {
        const x = sx(f)
        g.strokeStyle = 'rgba(251,191,36,0.22)'
        g.setLineDash([2, 3])
        g.beginPath()
        g.moveTo(x, specTop)
        g.lineTo(x, specTop + specH)
        g.stroke()
        g.setLineDash([])
        g.fillStyle = 'rgba(251,191,36,0.6)'
        g.font = '9px ui-monospace, monospace'
        // stagger, so neighbouring ratios do not collide at the low end
        g.fillText(`${(f / freqs[0]).toFixed(2)}`, x + 3, specTop + 10 + (i % 2) * 11)
      })
      g.fillStyle = 'rgba(255,255,255,0.3)'
      g.font = '9px ui-monospace, monospace'
      g.fillText(
        `mode ratios — free-free beam roots, bent ${(100 * ctx.params.undercut).toFixed(0)}% toward 1:4:10`,
        padL + 2,
        specTop - 6,
      )

      // -- the bar, and where the mallet lands ----------------------------------
      const barY = h - 46
      g.strokeStyle = 'rgba(255,255,255,0.18)'
      g.lineWidth = 6
      g.beginPath()
      g.moveTo(padL, barY)
      g.lineTo(w - padR, barY)
      g.stroke()
      const hx = padL + ctx.params.where * (w - padL - padR)
      g.fillStyle = 'rgba(251,191,36,0.9)'
      g.beginPath()
      g.arc(hx, barY - 12, 5, 0, Math.PI * 2)
      g.fill()

      const expo = (1 - ctx.params.hardness) / (1 + ctx.params.hardness)
      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.72)'
      g.fillText(
        `${noteName(Math.round(ctx.params.root))} · p = ${ctx.params.hardness.toFixed(2)}` +
          `   ·   contact time should go as v^${expo.toFixed(3)}` +
          (ctx.params.hardness < 1.02 ? '   ·   LINEAR — louder, not brighter' : ''),
        padL,
        h - 18,
      )
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.32)'
      g.fillText('click the bar to strike it there · peak ' + reported.peak.toFixed(3), padL, h - 4)
    })

    const onDown = (e: PointerEvent) => {
      const rect = g.canvas.getBoundingClientRect()
      const x = clamp((e.clientX - rect.left - 44) / (rect.width - 58), 0.04, 0.96)
      ctx.set('where', x)
      strike(ctx.params.force)
    }
    g.canvas.addEventListener('pointerdown', onDown)

    // A read-only snapshot for the harness.
    const wnd = window as unknown as Record<string, unknown>
    wnd.__mallet = () => ({
      freqs: freqs.slice(),
      ratios: freqs.map((f) => f / freqs[0]),
      contactMs: reported.contactMs,
      hardness: ctx.params.hardness,
      /** Modal sum in metres, and what that becomes going into the `tanh`. */
      rawPeak: rawMax,
      drivePeak: driveMax,
      resetPeak: () => ((rawMax = 0), (driveMax = 0)),
      strike: (vel: number) => node.port.postMessage({ strike: vel }),
    })
    ctx.cleanup(() => delete wnd.__mallet)

    ctx.status('hardness 1 is the control — it should get louder without getting brighter')
  },
})
