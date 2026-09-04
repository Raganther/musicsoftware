import { clamp, mtof, poly, reverb, rng, SCALES, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * What does a safety rail cost you?
 *
 * Most music software will not let you play a wrong note. Snap to scale, snap
 * to grid, auto-tune: the pitch you asked for is quietly replaced with the
 * nearest approved one. The pitch is a continuous surface here, and `Guardrail`
 * decides how hard the instrument pulls you toward the scale — 0 leaves your
 * finger exactly where you put it, 1 puts every note on a degree.
 *
 * The argument, which is the point of building it: **an instrument that
 * guarantees you cannot play a wrong note also guarantees you cannot play a
 * distinctive one.** That is not a slogan, it is countable. Snapping at
 * strength s maps an input d cents from the nearest degree to d(1−s), so a
 * scale step w cents wide collapses to an output span of w(1−s). If two outputs
 * closer than the ear's (or the measurement's) resolution τ are the same note,
 * then that step carries
 *
 *     max(1, w(1−s)/τ)
 *
 * distinguishable notes, and the instrument's whole expressive vocabulary is
 * that summed over the steps. At s = 1 it is exactly the number of scale
 * degrees. At s = 0 it is the whole continuum, resolution-limited.
 *
 * So the trade-off has two axes and both are measurable from the recording:
 * how many distinguishable notes the instrument can make, and what fraction of
 * them are in the scale. Safety buys the second with the first.
 *
 * `Guardrail` at 0 is also the control, and a strict one: the output pitch must
 * equal the input pitch, so the whole measurement chain has a known answer
 * before any of the interesting numbers are read off it.
 */

/** Nearest scale degree to a continuous semitone offset, in semitones. */
export function snapTo(semis: number, root: number, scale: ScaleName): number {
  const steps = SCALES[scale] as readonly number[]
  const rel = semis - root
  const oct = Math.floor(rel / 12)
  const within = rel - oct * 12
  let best = steps[0]
  let bestD = Infinity
  for (const s of [...steps, 12]) {
    const d = Math.abs(within - s)
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return root + oct * 12 + best
}

/** Where a raw input actually ends up, given the rail strength. */
export function railed(semis: number, root: number, scale: ScaleName, safety: number): number {
  return semis + safety * (snapTo(semis, root, scale) - semis)
}

/**
 * How many distinguishable notes survive, summed over one octave of the scale.
 *
 * Each step of width w collapses to w(1−s), and anything narrower than the
 * resolution τ counts as one note rather than none — the degree itself is
 * always still there.
 */
export function vocabulary(scale: ScaleName, safety: number, tolCents: number): number {
  const steps = [...(SCALES[scale] as readonly number[]), 12]
  let total = 0
  for (let i = 0; i < steps.length - 1; i++) {
    const w = (steps[i + 1] - steps[i]) * 100
    total += Math.max(1, (w * (1 - safety)) / tolCents)
  }
  return total
}

export default defineSketch({
  title: 'Guardrail',
  description: 'An instrument that will not let you play a wrong note, with the cost of that shown in bits.',
  tags: ['performance', 'instrument', 'tuning'],
  status: 'promising',
  bpm: 100,
  division: 4,

  params: {
    root: { type: 'number', value: 60, min: 48, max: 72, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'major', options: SCALE_NAMES },
    safety: { type: 'number', value: 0.6, min: 0, max: 1, step: 0.01, label: 'Guardrail (0 = no help)' },
    grid: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, label: 'Timing rail' },
    span: { type: 'number', value: 24, min: 12, max: 36, step: 1, label: 'Range', unit: 'semitones' },
    /**
     * The ear's pitch resolution is around 5-10 cents for successive tones, so
     * 10 is a defensible stand-in — but it is also exactly the tolerance the
     * harness clusters at, which keeps the drawn number and the measured one
     * commensurable.
     */
    tol: { type: 'number', value: 10, min: 3, max: 50, step: 1, label: 'Counts as the same note within', unit: 'cents' },
    wander: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, label: 'Play itself' },
    space: { type: 'number', value: 0.22, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 7, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
Most music software will not let you play a wrong note. The pitch surface here
is continuous, and \`Guardrail\` decides how hard the instrument pulls you toward
the scale: 0 leaves your finger where you put it, 1 puts every note on a degree.

The argument is that **an instrument which guarantees you cannot play a wrong
note also guarantees you cannot play a distinctive one** — and that is countable
rather than rhetorical. Snapping at strength s maps an input d cents from a
degree to d(1−s), so a step w cents wide collapses to an output span of w(1−s),
carrying max(1, w(1−s)/τ) distinguishable notes at a resolution τ.

Measured from the recording, sweeping the input across an octave in 20-cent
steps and clustering the outputs at 10 cents:

| guardrail | distinguishable notes (pred / meas) | bits | in scale (pred / meas) |
| --- | --- | --- | --- |
| 0.00 | 61 / 61 | 5.93 | 13% / 13% |
| 0.25 | 61 / 60 | 5.91 | 13% / 15% |
| 0.50 | 38 / 38 | 5.25 | 30% / 25% |
| 0.75 | 8 / 9 | 3.17 | 52% / 46% |
| 0.90 | 8 / 8 | 3.00 | 97% / 84% |
| 1.00 | 8 / 8 | 3.00 | 100% / 100% |

**From no help to full help the vocabulary falls 61 → 8 notes per octave, 5.93
→ 3.00 bits, while the fraction in tune with the scale goes 13% → 100%.**
Prediction and measurement never disagree by more than one note out of 61.

**The control is strict**: at guardrail 0 the output pitch must equal the input.
Worst error **6.38 cents** across 61 notes, mean **+3.39**. That bias is not
noise and not a mystery — the voice runs two oscillators 6 cents apart, so the
pair's centroid sits about 3 cents sharp of the note asked for. It is smaller
than the 10-cent clustering tolerance, and it is why the 0.90 row reads 84%
rather than 97%: at that setting the outputs sit within 10 cents of a degree by
design, so a 3-cent bias tips the borderline ones over the line.

An honest limit: **61 is the most this sweep could ever resolve**, because the
inputs are 20 cents apart and the clustering tolerance is 10. That is a ceiling
on the measurement, not on the instrument — at guardrail 0 the surface is
genuinely continuous.

Levels: 0.50 pre-limiter at the defaults, through the smoke gate.

The picture worth looking at is the second panel: the diagonal is the identity,
and as the guardrail comes up it flattens into a staircase. That staircase *is*
the instrument's vocabulary, drawn.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.2 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const dry = ctx.audio.createGain()
    dry.connect(rev.input)
    const synth = poly(dry, {
      wave: 'triangle', detune: 6, cutoff: 2200, resonance: 2, envAmount: 1.3,
      sub: 0.2, spread: 0.25, attack: 0.004, decay: 0.22, sustain: 0.25, release: 0.3,
      // Measured, not guessed — see the notes.
      gain: 2.0, maxVoices: 10,
    })
    ctx.cleanup(() => {
      synth.allNotesOff()
      rev.dispose()
    })

    /** Recent notes, as (raw input, railed output), for the drawing. */
    const trail: { raw: number; out: number; t: number }[] = []

    const fire = (raw: number, at: number, vel = 0.8, dur = 0.5) => {
      const out = railed(raw, Math.round(ctx.params.root), ctx.params.scale as ScaleName, ctx.params.safety)
      synth.note(out, at, dur, vel)
      trail.push({ raw, out, t: at })
      if (trail.length > 200) trail.shift()
      return out
    }

    // -- playing it ------------------------------------------------------------

    /**
     * The surface is the instrument: x is a continuous pitch across the range,
     * so a finger between two degrees really is between them until the rail
     * pulls it in.
     */
    let pointerDown = false
    const pitchAtX = (x: number, w: number) => {
      const lo = Math.round(ctx.params.root)
      return lo + clamp(x / w, 0, 1) * ctx.params.span
    }

    /** Timing rail: how far the onset is dragged toward the nearest step. */
    const timed = (t: number) => {
      const step = ctx.clock.stepDur
      const snapped = Math.round(t / step) * step
      return t + ctx.params.grid * (snapped - t)
    }

    let canvasEl: HTMLCanvasElement | null = null
    const onDown = (e: PointerEvent) => {
      if (!canvasEl) return
      const r = canvasEl.getBoundingClientRect()
      if (e.clientY < r.top || e.clientY > r.bottom) return
      pointerDown = true
      const now = ctx.audio.currentTime
      fire(pitchAtX(e.clientX - r.left, r.width), Math.max(now, timed(now)))
    }
    const onMove = (e: PointerEvent) => {
      if (!pointerDown || !canvasEl) return
      const r = canvasEl.getBoundingClientRect()
      const now = ctx.audio.currentTime
      if (now - (trail[trail.length - 1]?.t ?? 0) < 0.09) return
      fire(pitchAtX(e.clientX - r.left, r.width), Math.max(now, timed(now)), 0.6)
    }
    const onUp = () => (pointerDown = false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    ctx.cleanup(() => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    })

    // -- playing itself --------------------------------------------------------

    let r = rng(Math.round(ctx.params.seed))
    ctx.onParam('seed', (v) => (r = rng(Math.round(v))))
    let walk = 0.5

    ctx.clock.onStep((e) => {
      const w = ctx.params.wander
      if (w <= 0 || pointerDown) return
      if (e.step % 2 !== 0) return
      if (r.next() > 0.55 * w + 0.2) return
      // A continuous random walk across the surface, which is the point: an
      // input that does not know where the scale degrees are.
      walk = clamp(walk + (r.next() - 0.5) * 0.34, 0, 1)
      fire(Math.round(ctx.params.root) + walk * ctx.params.span, e.time, 0.55 + r.next() * 0.3)
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) synth.allNotesOff()
      }),
    )

    // -- what the rail costs ---------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      // The 2D context knows its own element, which is how the pointer handlers
      // get a rectangle to measure against.
      canvasEl = g.canvas
      g.clearRect(0, 0, w, h)
      const root = Math.round(ctx.params.root)
      const span = ctx.params.span
      const sc = ctx.params.scale as ScaleName
      const pad = 40
      const top = 18
      const surfH = Math.max(90, h * 0.4)
      const px = (semis: number) => pad + clamp((semis - root) / span, 0, 1) * (w - pad - 16)

      // the surface, with the degrees marked
      g.fillStyle = 'rgba(255,255,255,0.03)'
      g.fillRect(pad, top, w - pad - 16, surfH)
      for (let s = 0; s <= span; s++) {
        const at = root + s
        const isDegree = Math.abs(snapTo(at, root, sc) - at) < 1e-6
        g.strokeStyle = isDegree ? 'rgba(125,211,252,0.45)' : 'rgba(255,255,255,0.07)'
        g.lineWidth = isDegree ? 1.4 : 1
        g.beginPath()
        g.moveTo(px(at), top)
        g.lineTo(px(at), top + surfH)
        g.stroke()
      }

      // where the rail sends you: the input axis mapped onto the output axis
      g.strokeStyle = 'rgba(251,191,36,0.75)'
      g.lineWidth = 1.6
      g.beginPath()
      for (let i = 0; i <= 400; i++) {
        const raw = root + (i / 400) * span
        const out = railed(raw, root, sc, ctx.params.safety)
        const x = px(raw)
        const y = top + surfH - ((out - root) / span) * surfH
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
      }
      g.stroke()
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.font = '9px ui-monospace, monospace'
      g.fillText('where your finger goes (across) against what sounds (up)', pad, top - 5)

      // recent notes: raw as a hollow dot, output as a filled one, joined
      const now = ctx.audio.currentTime
      for (const n of trail) {
        const age = now - n.t
        if (age < 0 || age > 5) continue
        const a = 1 - age / 5
        const xr = px(n.raw)
        const xo = px(n.out)
        const y = top + surfH + 16
        g.strokeStyle = `rgba(255,255,255,${0.18 * a})`
        g.beginPath()
        g.moveTo(xr, y - 5)
        g.lineTo(xo, y + 5)
        g.stroke()
        g.strokeStyle = `rgba(255,255,255,${0.5 * a})`
        g.beginPath()
        g.arc(xr, y - 5, 2.6, 0, Math.PI * 2)
        g.stroke()
        g.fillStyle = `rgba(251,191,36,${0.85 * a})`
        g.beginPath()
        g.arc(xo, y + 5, 3, 0, Math.PI * 2)
        g.fill()
      }

      // -- the trade-off, drawn as a curve ---------------------------------------
      const cTop = top + surfH + 42
      const cH = Math.max(60, h - cTop - 46)
      const vMax = vocabulary(sc, 0, ctx.params.tol)
      const vx = (s: number) => pad + s * (w - pad - 16)
      const vy = (v: number) => cTop + cH - (Math.log2(Math.max(1, v)) / Math.log2(vMax)) * cH
      g.strokeStyle = 'rgba(248,113,113,0.7)'
      g.lineWidth = 1.6
      g.beginPath()
      for (let i = 0; i <= 200; i++) {
        const s = i / 200
        const v = vocabulary(sc, s, ctx.params.tol)
        i === 0 ? g.moveTo(vx(s), vy(v)) : g.lineTo(vx(s), vy(v))
      }
      g.stroke()
      const here = vocabulary(sc, ctx.params.safety, ctx.params.tol)
      g.fillStyle = 'rgba(251,191,36,1)'
      g.beginPath()
      g.arc(vx(ctx.params.safety), vy(here), 4.5, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.font = '9px ui-monospace, monospace'
      g.fillText('distinguishable notes per octave, against how much help you take', pad, cTop - 5)

      // -- numbers ---------------------------------------------------------------
      const degrees = (SCALES[sc] as readonly number[]).length
      const inScale = ctx.params.safety >= 1 ? 100 : Math.round((degrees / 12) * 100)
      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.75)'
      g.fillText(
        `guardrail ${ctx.params.safety.toFixed(2)}  ·  ${here.toFixed(1)} distinguishable notes/octave ` +
          `(${Math.log2(here).toFixed(2)} bits)  ·  ${degrees} degrees`,
        pad,
        h - 26,
      )
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.42)'
      g.fillText(
        ctx.params.safety >= 0.999
          ? `every note is in the scale, and there are exactly ${degrees} of them per octave`
          : ctx.params.safety <= 0.001
            ? `nothing is corrected: ${vMax.toFixed(0)} notes per octave, about ${inScale}% of them in the scale`
            : `pulled ${(100 * ctx.params.safety).toFixed(0)}% of the way home — ` +
              `${(vMax / here).toFixed(1)}x fewer notes than with no help at all`,
        pad,
        h - 11,
      )
      void mtof
    })

    const wnd = window as unknown as Record<string, unknown>
    wnd.__guardrail = () => ({
      root: Math.round(ctx.params.root),
      scale: ctx.params.scale,
      safety: ctx.params.safety,
      tol: ctx.params.tol,
      /** Play a list of raw input pitches at a fixed spacing, ignoring the rail
       *  on timing so the harness can segment the recording unambiguously. */
      sequence: (raws: number[], spacing: number) => {
        const t0 = ctx.audio.currentTime + 0.35
        // Short enough that each note is over before the next begins: a tail
        // lapping into the next window would be measured as that note's pitch.
        raws.forEach((raw, i) => fire(raw, t0 + i * spacing, 0.8, spacing * 0.55))
        return t0
      },
      tap: () => dry,
    })
    ctx.cleanup(() => delete wnd.__guardrail)

    ctx.status('drag across the surface — the hollow dot is where you put your finger, the gold one is what you heard')
  },
})
