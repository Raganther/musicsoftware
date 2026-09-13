import { clamp, disposeAt, mtof, nearestFraction, noiseBuffer, reverb, rng, SCALE_NAMES, degree, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import { step as mapStep, winding } from './circle'

/**
 * A rhythm that would rather be a ratio.
 *
 * `irrational` built the Sturmian word — a rigid rotation, sampled — and found
 * that a rhythm at an irrational density never repeats, but also never resists
 * anything: turn the density knob and the rhythm follows it continuously. Real
 * players do not do that. Push a drummer slightly off 2:3 and they play 2:3.
 *
 * The difference is one nonlinear term. Give the rotation a pull toward the
 * beat it hears —
 *
 *     θ_{n+1} = θ_n + Ω − (K/2π)·sin(2πθ_n)
 *
 * — and the density stops following the knob. It sticks at p/q over a whole
 * interval of Ω and then jumps to the next rational, so sweeping Ω walks a
 * staircase rather than a ramp. Those plateaus are Arnold tongues, the staircase
 * is Cantor's, and the whole structure is the reason a groove feels like it
 * snaps to a ratio rather than sliding through all of them.
 *
 * The winding number W — turns per drive pulse — *is* the rhythm's density in
 * events per pulse, so what the maths calls the winding number you can hear as
 * how often the drum plays. At K = 0 this sketch is exactly `irrational`.
 *
 * What is drawn here uses short orbits and is a sketch of the real object; the
 * numbers in `notes` come from long ones. See `research/log/2026-09-07-tongues.md`.
 */

/** Voices, and how much of the coupling each one gets. Voice 0 always gets all of it. */
const MAX_VOICES = 3

export default defineSketch({
  title: 'Tongues',
  description: 'A rhythm on the circle map: sweep one knob and the density locks to ratios and refuses everything between.',
  tags: ['rhythm', 'generative', 'nonlinear'],
  status: 'promising',
  bpm: 132,
  division: 4,

  params: {
    /** The drive ratio. At K = 0 this *is* the density; at K > 0 it is only a wish. */
    omega: { type: 'number', value: 0.62, min: 0, max: 1, step: 0.001, label: 'Drive ratio Ω' },
    /**
     * The pull toward the beat. 0 is a rigid rotation that locks to nothing; 1
     * is critical, where the locked ratios fill the line and what is left has
     * dimension 0.87; above 1 the map stops being invertible and the same Ω can
     * give different answers depending on where it started.
     */
    coupling: { type: 'number', value: 0.86, min: 0, max: 1.4, step: 0.005, label: 'Coupling K' },
    /** Sweep Ω on its own, which is the only way to *hear* a staircase. */
    drift: { type: 'number', value: 0.05, min: 0, max: 0.4, step: 0.005, label: 'Drift' },
    voices: { type: 'number', value: 3, min: 1, max: MAX_VOICES, step: 1, label: 'Voices' },
    /**
     * How much less coupling each successive voice gets. At 1 the last voice is
     * at K = 0 — a rigid rotation, which never locks — so you hear a drummer
     * who snaps to the ratio against one who does not.
     */
    spread: { type: 'number', value: 1, min: 0, max: 1, step: 0.01, label: 'Coupling spread' },
    click: { type: 'toggle', value: true, label: 'Drive pulse' },
    root: { type: 'number', value: 45, min: 30, max: 64, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'pentatonicMinor', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    decay: { type: 'number', value: 0.36, min: 0.05, max: 1, step: 0.01, label: 'Decay' },
    tone: { type: 'number', value: 0.5, min: 0, max: 1, label: 'Tone' },
    space: { type: 'number', value: 0.22, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 4, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
A rhythm that would rather be a ratio. \`irrational\` built the rigid rotation —
turn the density knob and the rhythm follows it exactly. Add one nonlinear term,
a pull toward the beat it hears, and it stops following: the density sticks at
p/q over a whole interval of Ω and then jumps. Sweeping Ω walks a staircase
instead of a ramp, and **at K = 0 this sketch is exactly \`irrational\`** —
measured, W = Ω to 2.1e−13.

The winding number is the rhythm's density in events per drive pulse, so the
thing dynamics calls W you can hear as how often the drum plays.

**The tongues open at the rate they should.** A p/q plateau is known to widen as
K^q. Measured over five couplings, fitting only the points clear of the method's
resolution floor:

    1/1  exponent 1.00      1/2  1.96      1/3  2.93      2/5  4.88

against 1, 2, 3 and 5. Four different tongues, four different predictions, no
shared fitting.

**And they nest by the Farey mediant.** Between the p/q and r/s plateaus the
widest one is always (p+r)/(q+s) — checked on five pairs, 5 of 5. That is why
the rhythm passing through 1/2 to 1/1 stops hardest at 2/3.

**At K = 1 what is left between the tongues has dimension 0.879.** The locked
ratios fill the line to full measure, and the leftovers — the Ω where the rhythm
still refuses to settle — are a Cantor set whose box dimension the literature
puts at 0.870. Box-counted over 16,385 values of Ω, R² = 0.9999, this model
gives **0.8794**, and identically to four decimals whether the detection
tolerance is a quarter, an eighth or a sixteenth of the box — because scaling
the tolerance with the box is what makes the test mean the same thing at every
size.

That number only means something because the same estimator was pointed at two
couplings where the answer has to be 1. Below criticality the leftovers have
positive measure, so their dimension is 1 by definition: it returns **0.985 at
K = 0.5 and 0.960 at K = 0.8**. Those controls miss their known answer by 1.5
to 4%, so the 1% gap between 0.879 and 0.870 sits inside the method's own
demonstrated bias rather than being a residual with a story.

(Corrected 2026-09-08. This first read 0.875 from an estimator that used one
*fixed* tolerance at every box size, and I explained the gap to 0.870 as
unresolvable plateaus. On a finer grid that estimator's control collapsed to
0.572 — a fixed tolerance eventually exceeds the box itself and calls
everything locked. See \`research/log/2026-09-08-sitting.md\`.)

**And the sketch plays that model, not an approximation of it.** With Ω held
still, the density actually dispatched matches the winding number to within
**0.0029** across four settings — a plateau, a point between tongues, and K = 0
— where one pulse in 184 is 0.0054, so every error is below what 184 pulses can
resolve. Read back off the recorded audio instead, pulse by pulse, **274 of 274**
pulses agree with what was dispatched, the fired ones louder than the silent
ones by a factor of 60.

Turn \`Drift\` up and Ω sweeps on its own; that is the only way to hear a
staircase rather than look at one. \`Coupling spread\` at 1 puts the last voice at
K = 0, so a drummer who snaps to the ratio plays against one who cannot.
\`Coupling\` above 1 is past criticality, where the map is no longer invertible
and the same Ω can give different densities depending on where the voice
started — audible as the voices disagreeing about a ratio they all locked to a
moment ago.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 1.9 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)

    let r = rng(Math.round(ctx.params.seed))
    /** Each voice's phase, unwrapped: the integer part counts turns. */
    let theta: number[] = []
    const reseed = () => {
      r = rng(Math.round(ctx.params.seed))
      theta = []
      for (let i = 0; i < MAX_VOICES; i++) theta.push(r.next())
    }
    reseed()
    ctx.onParam('seed', reseed)

    const kOf = (i: number) => {
      const n = Math.max(1, Math.round(ctx.params.voices))
      if (n === 1) return ctx.params.coupling
      return ctx.params.coupling * (1 - ctx.params.spread * (i / (n - 1)))
    }

    // -- the drum ---------------------------------------------------------------

    const hit = (midi: number, time: number, gain: number, dec: number, pan: number, noisy: number) => {
      const osc = ctx.audio.createOscillator()
      osc.type = 'sine'
      const f = mtof(midi)
      osc.frequency.setValueAtTime(f * 3.2, time)
      osc.frequency.exponentialRampToValueAtTime(f, time + 0.035)
      const amp = ctx.audio.createGain()
      amp.gain.setValueAtTime(0, time)
      amp.gain.linearRampToValueAtTime(gain, time + 0.002)
      amp.gain.exponentialRampToValueAtTime(0.0008, time + dec)
      const p = ctx.audio.createStereoPanner()
      p.pan.value = pan
      osc.connect(amp).connect(p).connect(bus)
      osc.start(time)
      disposeAt(osc, time + dec + 0.05, [amp, p])

      if (noisy > 0) {
        const src = ctx.audio.createBufferSource()
        src.buffer = noiseBuffer()
        src.loop = true
        const bp = ctx.audio.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = clamp(f * 8 * (0.5 + ctx.params.tone), 200, 9000)
        bp.Q.value = 1.1
        const na = ctx.audio.createGain()
        na.gain.setValueAtTime(0, time)
        na.gain.linearRampToValueAtTime(gain * noisy, time + 0.001)
        na.gain.exponentialRampToValueAtTime(0.0006, time + dec * 0.35)
        src.connect(bp).connect(na).connect(p)
        src.start(time)
        disposeAt(src, time + dec + 0.05, [bp, na])
      }
    }

    // -- the transport ----------------------------------------------------------

    /** Recent steps, for the rhythm strip and for a harness to read back. */
    const log: { t: number; omega: number; fired: boolean[] }[] = []
    let sweepDir = 1
    let fires = 0
    let pulses = 0

    ctx.clock.onStep((e) => {
      const n = Math.max(1, Math.round(ctx.params.voices))
      const lvl = 0.32 + ctx.params.level * 0.5
      const dec = ctx.params.decay
      const fired: boolean[] = []
      for (let i = 0; i < MAX_VOICES; i++) {
        if (i >= n) {
          fired.push(false)
          continue
        }
        const before = Math.floor(theta[i])
        theta[i] = mapStep(theta[i], ctx.params.omega, kOf(i))
        const f = Math.floor(theta[i]) > before
        fired.push(f)
        if (f) {
          const midi = degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, i * 2)
          hit(midi, e.time, lvl * (i === 0 ? 1 : 0.72), dec * (i === 0 ? 1 : 0.6),
              n === 1 ? 0 : -0.35 + (i / (n - 1)) * 0.7, i === 0 ? 0.25 : 0.5)
        }
      }
      if (ctx.params.click) {
        hit(degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, 7) + 24,
            e.time, lvl * 0.16, 0.03, 0, 0.9)
      }
      if (fired[0]) fires++
      pulses++
      log.push({ t: e.time, omega: ctx.params.omega, fired })
      if (log.length > 128) log.shift()

      // Sweep Ω, bouncing at the ends. This is the only way to hear a staircase:
      // the plateaus are intervals of Ω, so they are silent unless Ω moves.
      if (ctx.params.drift > 0) {
        let o = ctx.params.omega + sweepDir * ctx.params.drift * e.dur * 0.35
        if (o > 1) { o = 1; sweepDir = -1 }
        if (o < 0) { o = 0; sweepDir = 1 }
        ctx.set('omega', o)
      }
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          fires = 0
          pulses = 0
        }
      }),
    )
    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    // -- drawing -----------------------------------------------------------------

    /** W(Ω) at the current K, filled a few columns per frame. Depends on K only. */
    const NC = 220
    let curve: (number | null)[] = new Array(NC).fill(null)
    let curveAt = 0
    let curveK = -1
    /** The Ω×K plane, coloured by how locked it is. Computed once, then kept. */
    const TW = 128
    const TH = 40
    const tongueMap = new Float32Array(TW * TH).fill(-1)
    let tongueAt = 0

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const K = ctx.params.coupling
      if (K !== curveK) {
        curveK = K
        curve = new Array(NC).fill(null)
        curveAt = 0
      }
      // A few columns of the staircase per frame — short orbits, because this is
      // a picture. The measurements in `notes` use orbits 30x longer.
      for (let k = 0; k < 6 && curveAt < NC; k++, curveAt++) {
        curve[curveAt] = winding(curveAt / (NC - 1), K, 1200, 400)
      }
      for (let k = 0; k < 40 && tongueAt < TW * TH; k++, tongueAt++) {
        const ix = tongueAt % TW
        const iy = (tongueAt / TW) | 0
        const om = ix / (TW - 1)
        const kk = (iy / (TH - 1)) * 1.4
        const a = winding(om, kk, 500, 200)
        const b = winding(om + 1 / (TW - 1) / 2, kk, 500, 200)
        tongueMap[tongueAt] = Math.abs(b - a)
      }

      const padL = 34
      const padR = 10
      const gw = w - padL - padR
      const stairH = Math.max(52, (h - 40) * 0.42)
      const mapH = Math.max(30, (h - 40) * 0.26)
      const top = 12

      // -- the Arnold tongue plane -----------------------------------------------
      const mapTop = top + stairH + 12
      for (let iy = 0; iy < TH; iy++) {
        for (let ix = 0; ix < TW; ix++) {
          const v = tongueMap[iy * TW + ix]
          if (v < 0) continue
          // small |ΔW| across a step in Ω means locked
          const locked = clamp(1 - v * (TW - 1) * 1.6, 0, 1)
          g.fillStyle = `rgba(125,211,252,${0.06 + locked * 0.5})`
          g.fillRect(padL + (ix / TW) * gw, mapTop + mapH - ((iy + 1) / TH) * mapH,
                     gw / TW + 0.6, mapH / TH + 0.6)
        }
      }
      g.strokeStyle = 'rgba(251,191,36,0.9)'
      g.lineWidth = 1
      const mx = padL + ctx.params.omega * gw
      const my = mapTop + mapH - (K / 1.4) * mapH
      g.beginPath()
      g.arc(mx, my, 3.2, 0, Math.PI * 2)
      g.stroke()
      g.font = '9px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.3)'
      g.fillText('the tongues: Ω across, K up — light is locked', padL, mapTop - 3)

      // -- the staircase ----------------------------------------------------------
      const sy = (v: number) => top + stairH - clamp(v, 0, 1) * stairH
      g.strokeStyle = 'rgba(255,255,255,0.1)'
      g.lineWidth = 1
      for (const [p, q] of [[1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [2, 5], [3, 5]] as const) {
        g.beginPath()
        g.moveTo(padL, sy(p / q))
        g.lineTo(w - padR, sy(p / q))
        g.stroke()
      }
      g.strokeStyle = 'rgba(226,232,240,0.9)'
      g.lineWidth = 1.6
      g.beginPath()
      let started = false
      for (let i = 0; i < NC; i++) {
        const v = curve[i]
        if (v === null) continue
        const x = padL + (i / (NC - 1)) * gw
        started ? g.lineTo(x, sy(v)) : (g.moveTo(x, sy(v)), (started = true))
      }
      g.stroke()

      const wHere = curve[Math.round(ctx.params.omega * (NC - 1))]
      if (wHere !== null && wHere !== undefined) {
        g.fillStyle = 'rgba(251,191,36,1)'
        g.beginPath()
        g.arc(padL + ctx.params.omega * gw, sy(wHere), 3.6, 0, Math.PI * 2)
        g.fill()
      }
      g.font = '9px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.3)'
      g.textAlign = 'right'
      g.fillText('1', padL - 4, sy(1) + 3)
      g.fillText('0', padL - 4, sy(0) + 3)
      g.textAlign = 'left'
      g.fillText('density (turns per pulse) against the drive ratio', padL, top - 2)

      // -- what it is actually playing ---------------------------------------------
      const stripTop = mapTop + mapH + 10
      const shown = Math.min(64, log.length)
      const cw = gw / 64
      for (let i = 0; i < shown; i++) {
        const rec = log[log.length - shown + i]
        for (let v = 0; v < MAX_VOICES; v++) {
          if (!rec.fired[v]) continue
          g.fillStyle = ['rgba(248,113,113,0.9)', 'rgba(74,222,128,0.85)', 'rgba(167,139,250,0.85)'][v]
          g.fillRect(padL + i * cw, stripTop + v * 5, Math.max(1.5, cw - 1), 4)
        }
      }

      // -- the numbers ---------------------------------------------------------------
      const heard = pulses > 0 ? fires / pulses : 0
      const rat = wHere !== null && wHere !== undefined ? nearestFraction(wHere, 12) : null
      const locked = rat && wHere !== null && wHere !== undefined && Math.abs(wHere - rat.p / rat.q) < 3e-3
      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.8)'
      g.fillText(
        `Ω ${ctx.params.omega.toFixed(3)}  ·  K ${K.toFixed(2)}  ·  density ` +
          (wHere === null || wHere === undefined ? '—' : wHere.toFixed(3)) +
          (locked ? `  = ${rat!.p}/${rat!.q}` : '  (between tongues)'),
        padL,
        h - 16,
      )
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.4)'
      g.fillText(
        `heard ${heard.toFixed(3)} over ${pulses} pulses` +
          (K === 0 ? '  ·  K = 0: a rigid rotation, which is `irrational`' : ''),
        padL,
        h - 3,
      )
    })

    // -- a way in for the harness ------------------------------------------------

    const wnd = window as unknown as Record<string, unknown>
    wnd.__tongues = () => ({
      omega: ctx.params.omega,
      K: ctx.params.coupling,
      kOf: (i: number) => kOf(i),
      /** Events per drive pulse for voice 0, as actually dispatched. */
      heard: pulses > 0 ? fires / pulses : 0,
      pulses,
      log: log.slice(),
      tap: () => bus,
      set: (k: string, v: number | string) => ctx.set(k as never, v as never),
      reset: () => {
        fires = 0
        pulses = 0
      },
    })
    ctx.cleanup(() => delete wnd.__tongues)

    ctx.status('press space — turn Drift up and listen for the density holding still while Ω moves')
  },
})
