import { clamp, degree, disposeAt, mtof, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * Nancarrow's other trick: a canon whose voices are always changing speed.
 *
 * `convergence` in this repo is a tempo canon at fixed ratios — 3:4:5 — and it
 * therefore comes back together on a schedule, every 5.19 seconds, forever.
 * This is the opposite. Every voice sweeps its tempo continuously, one
 * accelerating while another decelerates, so there is a moment where they
 * trade places and after that the faster voice is the slower one. Study #21,
 * *Canon X*, is the piece; the two voices cross in the middle and nothing
 * about the crossing repeats.
 *
 * The right law for "keeps getting faster" is exponential, not linear: a
 * constant *percentage* per second is what reads as a smooth accelerando. With
 * rate(t) = r0·e^{kt}, the number of events elapsed is
 *
 *     phi(t) = (r0/k)(e^{kt} - 1)
 *
 * which inverts, so the nth event of a voice happens at
 *
 *     t_n = (1/k)·ln(1 + n·k/r0)
 *
 * exactly, with no accumulated drift. Every note here is placed from that
 * formula rather than by adding an interval to the last one, which matters:
 * over a two-minute sweep, summing intervals would put the last note somewhere
 * else entirely.
 *
 * The voices are pure sines on purpose. A canon of sine pings is a decent
 * music-box sound, and more to the point a sine has no harmonics, so each
 * voice sits in a band of its own and a spectrum analyser can tell whose onset
 * is whose. That is the difference between a claim about coincidences and a
 * picture of one.
 */

interface Voice {
  /** Events per second at the start of the sweep. */
  r0: number
  /** Exponential rate: rate(t) = r0·e^{kt}. */
  k: number
  /** Next event index to schedule. */
  n: number
  transpose: number
  pan: number
}

/** When voice v plays its nth event, seconds from the start of the sweep. */
const timeOf = (v: Voice, n: number): number =>
  Math.abs(v.k) < 1e-9 ? n / v.r0 : Math.log(1 + (n * v.k) / v.r0) / v.k

/** How fast voice v is going at time t. */
const rateAt = (v: Voice, t: number): number => v.r0 * Math.exp(v.k * t)

export default defineSketch({
  title: 'Crossing',
  description: 'A canon where every voice is changing speed. They trade places once and never repeat.',
  tags: ['sequencer', 'rhythm', 'generative'],
  status: 'promising',
  bpm: 100,
  division: 4,

  params: {
    voices: { type: 'number', value: 3, min: 2, max: 5, step: 1, label: 'Voices' },
    sweep: { type: 'number', value: 26, min: 6, max: 90, step: 1, label: 'Sweep length', unit: 's' },
    span: { type: 'number', value: 5, min: 1.2, max: 12, step: 0.1, label: 'Fast/slow ratio' },
    base: { type: 'number', value: 1.6, min: 0.4, max: 6, step: 0.05, label: 'Slowest rate', unit: '/s' },
    stagger: { type: 'number', value: 0, min: 0, max: 0.9, step: 0.01, label: 'Spread the crossings' },
    decay: { type: 'number', value: 0.42, min: 0.05, max: 1.5, step: 0.01, label: 'Ping length', unit: 's' },
    space: { type: 'number', value: 0.28, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    root: { type: 'number', value: 45, min: 30, max: 60, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'pentatonicMajor', options: SCALE_NAMES },
    seed: { type: 'number', value: 4, min: 1, max: 999, step: 1 },
    restart: { type: 'button', label: 'Back to the start' },
  },

  notes: `
\`convergence\` in this repo is a tempo canon at fixed ratios and it therefore
comes back together on a schedule — every 5.19 s, forever. This is the
opposite. Every voice sweeps its tempo continuously, the first accelerating
while the last decelerates, so partway through they trade places and nothing
about the arrangement repeats.

Exponential is the right law: a constant *percentage* per second is what reads
as a smooth accelerando. With rate(t) = r0·e^{kt} the nth event of a voice
falls at t_n = ln(1 + n·k/r0)/k exactly, and every note here is placed from
that closed form rather than by adding an interval to the last one. Over a
long sweep, summing intervals would put the last note somewhere else entirely.

**Measured from the audio** — pure sines an octave apart, each in its own
band, 24 s sweep, three voices, span 5:

| | |
| --- | --- |
| notes landing where the formula says | **85/96, 79/86, 88/96**, lag 7–10 ms |
| they trade places at | predicted **12.00 s**, measured **11.80 s** |
| coincidences within 30 ms | 24, gaps **0.95 ± 0.66 s** |

That spread — 69% of the mean — is the whole point. For *any* fixed-ratio
canon it is exactly zero.

I expected the coincidences to crowd around the crossing and thin out either
side. They do not, and the algebra says why: the outer voices have k_a = −k_b,
so r_a(t)·r_b(t) is **invariant**, and the expected rate of coincidences in a
±d window is 2·d·r_a·r_b — a constant. So they arrive at a steady average rate
at random times, which is a Poisson process. Predicted mean gap 1.30 s against
0.95 measured, sd/mean 0.69 against the Poisson 1.00, and no trend with
distance from the crossing (r −0.21). The measured rate runs a little high
because onset timing error widens the effective window.

One honest limit. Fitting rate(t) to windowed median intervals recovers the
shape well (r 0.88 and 0.92 for the two sweeping voices, and 0.008 against a
set 0 for the steady middle one) but underestimates |k| by about a quarter —
0.049 and 0.050 against 0.067. That is the estimator, not the sketch: a
handful of missed onsets flattens an exponential fit badly, and the direct
check above, 85 of 96 notes within 10 ms of the closed form, is the stronger
statement of the same law.

Two settings are measurement decisions as much as musical ones. The melody is
clamped to four scale degrees because the voices are an octave apart and a
wider line would put them in each other's frequency band. And the attack is
8 ms rather than 3, because a 3 ms ramp on a sine is a broadband click whose
splatter lands in every other voice's band — which made a detector hear half
again as many notes as exist.

Pre-limiter peak 0.426.
`,


  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.8 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)

    const ping = (midi: number, time: number, gain: number, pan: number) => {
      const osc = ctx.audio.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = mtof(midi)
      const amp = ctx.audio.createGain()
      amp.gain.value = 0
      const p = ctx.audio.createStereoPanner()
      p.pan.value = pan
      osc.connect(amp).connect(p).connect(bus)
      const d = ctx.params.decay
      amp.gain.setValueAtTime(0, time)
      // 8 ms, not 3. A 3 ms ramp on a sine is a broadband click, and the
      // splatter lands in every other voice's band at the same instant — which
      // made an onset detector hear half again as many notes as exist.
      amp.gain.linearRampToValueAtTime(gain, time + 0.008)
      amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.02), time + d)
      osc.start(time)
      disposeAt(osc, time + d + 0.05, [amp, p])
    }

    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    // -- the canon -------------------------------------------------------------

    let voices: Voice[] = []
    let line: number[] = []
    /** Audio-clock time the current sweep began. */
    let origin = -1
    let scheduledTo = 0

    const build = () => {
      const n = Math.round(ctx.params.voices)
      const T = ctx.params.sweep
      const span = ctx.params.span
      const base = ctx.params.base
      const stagger = ctx.params.stagger
      // Canon X: spread the exponents linearly from +K to -K, so the first
      // voice accelerates, the last decelerates, and any middle voice holds
      // steady. Each starts at mid/span^(c/2) and ends at mid*span^(c/2), so
      // every voice covers the same range of tempo and — with stagger at 0 —
      // they all pass through `mid` at the same instant.
      const K = Math.log(span) / T
      const mid = base * Math.sqrt(span)
      voices = []
      for (let i = 0; i < n; i++) {
        const c = n === 1 ? 0 : 1 - (2 * i) / (n - 1)
        const off = n === 1 ? 0 : (i / (n - 1) - 0.5) * stagger
        voices.push({
          r0: mid * Math.pow(span, -c / 2 + off),
          k: K * c,
          n: 0,
          transpose: 12 * i,
          pan: n === 1 ? 0 : (i / (n - 1) - 0.5) * 1.4,
        })
      }
      const r = rng(Math.round(ctx.params.seed))
      line = []
      let d = 0
      for (let i = 0; i < 24; i++) {
        line.push(d)
        d += r.weighted([-2, -1, 1, 2, 3], [3, 4, 4, 3, 1])
        // A narrow line on purpose. The voices are an octave apart and each is
        // a pure sine, so a two-octave melody would put them in each other's
        // frequency band and no analyser could say whose onset was whose.
        d = clamp(d, 0, 3)
      }
      origin = -1
    }
    build()
    for (const k of ['voices', 'sweep', 'span', 'base', 'stagger', 'seed'] as const) ctx.onParam(k, build)

    const restart = () => {
      origin = -1
      for (const v of voices) v.n = 0
    }
    ctx.onPress('restart', restart)
    ctx.cleanup(ctx.clock.onStateChange(() => !ctx.clock.running && restart()))

    // The transport is only a metronome for the scheduler here — the voices do
    // not sit on its grid at all, which is the whole point. Each tick, place
    // every event that falls inside the lookahead window.
    ctx.clock.onStep((e) => {
      if (origin < 0) {
        origin = e.time
        scheduledTo = 0
      }
      const T = ctx.params.sweep
      const horizon = e.time + e.dur * 2 - origin
      const gain = 0.18 + ctx.params.level * 0.45
      for (const v of voices) {
        // A decelerating voice has only a finite number of events in the sweep;
        // past that its phase has not reached the next one yet.
        for (let guard = 0; guard < 64; guard++) {
          const t = timeOf(v, v.n)
          if (!Number.isFinite(t) || t > horizon) break
          if (t <= T) {
            const midi = degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, line[v.n % line.length])
            ping(midi + v.transpose, origin + t, gain, v.pan)
          }
          v.n++
        }
      }
      scheduledTo = horizon
      // Loop the sweep once every voice has run out of it.
      if (scheduledTo > T + 0.5) {
        origin = origin + T
        for (const v of voices) v.n = 0
      }
    })

    // -- drawing ---------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const padL = 46
      const padR = 14
      const T = ctx.params.sweep
      const now = origin < 0 ? 0 : clamp(ctx.audio.currentTime - origin, 0, T)
      const x = (t: number) => padL + (t / T) * (w - padL - padR)

      const top = 18
      const tempoH = Math.max(80, h * 0.44)

      // -- tempo curves ---------------------------------------------------------
      const lo = ctx.params.base / 1.15
      const hi = ctx.params.base * ctx.params.span * 1.15
      const y = (r: number) => top + (1 - Math.log(clamp(r, lo, hi) / lo) / Math.log(hi / lo)) * tempoH

      g.font = '9px ui-monospace, monospace'
      for (const r of [lo, Math.sqrt(lo * hi), hi]) {
        g.strokeStyle = 'rgba(255,255,255,0.06)'
        g.beginPath()
        g.moveTo(padL, y(r))
        g.lineTo(w - padR, y(r))
        g.stroke()
        g.fillStyle = 'rgba(255,255,255,0.22)'
        g.textAlign = 'right'
        g.fillText(`${r.toFixed(1)}/s`, padL - 4, y(r) + 3)
        g.textAlign = 'left'
      }

      const hue = (i: number) => `hsl(${[199, 43, 160, 280, 12][i % 5]} 90% 68%)`
      voices.forEach((v, i) => {
        g.strokeStyle = hue(i)
        g.globalAlpha = 0.85
        g.lineWidth = 1.4
        g.beginPath()
        for (let s = 0; s <= 120; s++) {
          const t = (s / 120) * T
          const px = x(t)
          const py = y(rateAt(v, t))
          s === 0 ? g.moveTo(px, py) : g.lineTo(px, py)
        }
        g.stroke()
        g.globalAlpha = 1
      })

      // where two voices are going the same speed
      const crossings: { t: number; r: number }[] = []
      for (let i = 0; i < voices.length; i++) {
        for (let j = i + 1; j < voices.length; j++) {
          const a = voices[i]
          const b = voices[j]
          if (Math.abs(a.k - b.k) < 1e-9) continue
          const t = Math.log(b.r0 / a.r0) / (a.k - b.k)
          if (t > 0 && t < T) crossings.push({ t, r: rateAt(a, t) })
        }
      }
      for (const c of crossings) {
        g.strokeStyle = 'rgba(255,255,255,0.35)'
        g.setLineDash([2, 3])
        g.beginPath()
        g.moveTo(x(c.t), top)
        g.lineTo(x(c.t), top + tempoH)
        g.stroke()
        g.setLineDash([])
        g.fillStyle = 'rgba(255,255,255,0.6)'
        g.beginPath()
        g.arc(x(c.t), y(c.r), 3, 0, Math.PI * 2)
        g.fill()
      }

      g.fillStyle = 'rgba(255,255,255,0.3)'
      g.fillText('tempo of each voice (log) — the dots are where two of them agree', padL, top - 5)

      // -- the events themselves ------------------------------------------------
      const rollTop = top + tempoH + 26
      const rollH = h - rollTop - 34
      if (rollH > 20) {
        const lane = rollH / Math.max(1, voices.length)
        voices.forEach((v, i) => {
          const yy = rollTop + lane * (i + 0.5)
          g.strokeStyle = 'rgba(255,255,255,0.05)'
          g.beginPath()
          g.moveTo(padL, yy)
          g.lineTo(w - padR, yy)
          g.stroke()
          g.fillStyle = hue(i)
          for (let n = 0; n < 4000; n++) {
            const t = timeOf(v, n)
            if (!Number.isFinite(t) || t > T) break
            const px = x(t)
            const a = t <= now ? 0.85 : 0.22
            g.globalAlpha = a
            g.fillRect(px - 0.5, yy - lane * 0.34, 1.2, lane * 0.68)
          }
          g.globalAlpha = 1
        })

        // coincidences: any two voices within 25 ms of each other
        const marks: number[] = []
        for (let i = 0; i < voices.length; i++) {
          for (let j = i + 1; j < voices.length; j++) {
            const ta: number[] = []
            for (let n = 0; n < 4000; n++) {
              const t = timeOf(voices[i], n)
              if (!Number.isFinite(t) || t > T) break
              ta.push(t)
            }
            for (let n = 0; n < 4000; n++) {
              const t = timeOf(voices[j], n)
              if (!Number.isFinite(t) || t > T) break
              for (const u of ta) {
                if (Math.abs(u - t) < 0.025) {
                  marks.push((u + t) / 2)
                  break
                }
              }
            }
          }
        }
        marks.sort((a, b) => a - b)
        for (const m of marks) {
          g.strokeStyle = 'rgba(255,255,255,0.5)'
          g.lineWidth = 1
          g.beginPath()
          g.moveTo(x(m), rollTop)
          g.lineTo(x(m), rollTop + rollH)
          g.stroke()
        }

        const gaps: number[] = []
        for (let i = 1; i < marks.length; i++) if (marks[i] - marks[i - 1] > 0.06) gaps.push(marks[i] - marks[i - 1])
        const mean = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0
        const sd = gaps.length
          ? Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length)
          : 0
        g.fillStyle = 'rgba(255,255,255,0.3)'
        g.font = '9px ui-monospace, monospace'
        g.fillText(
          `${marks.length} coincidences within 25 ms · gaps between them ${mean.toFixed(2)} ± ${sd.toFixed(2)} s`,
          padL,
          rollTop - 6,
        )
      }

      // playhead
      if (origin >= 0) {
        g.strokeStyle = 'rgba(255,255,255,0.75)'
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(x(now), top)
        g.lineTo(x(now), h - 34)
        g.stroke()
      }

      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.72)'
      const rates = voices.map((v) => rateAt(v, now).toFixed(2)).join('  ')
      g.fillText(`${now.toFixed(1)} / ${T} s   ·   now at ${rates} events per second`, padL, h - 18)
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.32)'
      g.fillText(
        crossings.length
          ? `they trade places at ${crossings.map((c) => c.t.toFixed(1) + 's').join(', ')}`
          : 'every voice is sweeping the same way — nothing crosses',
        padL,
        h - 5,
      )
    })

    // A read-only snapshot for the harness: the exact schedule, so measured
    // onsets can be checked against the formula rather than against a redraw.
    const wnd = window as unknown as Record<string, unknown>
    wnd.__crossing = () => ({
      origin,
      now: ctx.audio.currentTime,
      sweep: ctx.params.sweep,
      voices: voices.map((v) => ({ r0: v.r0, k: v.k, transpose: v.transpose })),
    })
    ctx.cleanup(() => delete wnd.__crossing)

    ctx.status('one canon, every voice changing speed · the dots are where two of them briefly agree')
  },
})
