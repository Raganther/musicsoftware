import { degree, disposeAt, mtof, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import {
  advance,
  bestAlpha,
  order,
  predictedDecay,
  RULES,
  start,
  unevenness,
  type Rule,
  type State,
} from './ring'

/**
 * An ensemble sharing a bar out between them, by ear, with nobody counting.
 *
 * `entrain` (2026-08-26) put players on a ring and had them agree on a tempo.
 * Running that coupling backwards — "get away from whoever you can hear" — gave
 * clumps rather than an even spread, and the note left in `research/ideas.md`
 * said why: an even ring requires knowing how many players there are, and no
 * player does.
 *
 * There is a rule that never needs to know. Listen to the player immediately
 * **before** you and the one immediately **after** you, and move to the middle
 * of the gap they leave. Nobody counts, nobody leads, and the ensemble lands on
 * a perfect round-robin — a hocket that assembles itself. It is Degesys and
 * Nagpal's DESYNC (2007), written for radios sharing a channel.
 *
 * Numbers in `notes` are measured; see `research/log/2026-09-24-elbows.md`.
 */

const CYCLE = 8
const MAX_PLAYERS = 12
const TRACE = 96

const COLOURS = [
  '#7dd3fc',
  '#fbbf24',
  '#a78bfa',
  '#34d399',
  '#f472b6',
  '#fb923c',
  '#4ade80',
  '#60a5fa',
  '#f87171',
  '#c4b5fd',
  '#2dd4bf',
  '#facc15',
]

export default defineSketch({
  title: 'Elbows',
  description: 'Players spread themselves evenly across a bar by listening only to their two nearest neighbours.',
  tags: ['rhythm', 'generative', 'ensemble'],
  status: 'promising',
  bpm: 112,
  division: 4,

  params: {
    players: { type: 'number', value: 8, min: 2, max: MAX_PLAYERS, step: 1, label: 'Players' },
    /**
     * `midpoint` is the rule that works. The other two are what you would try
     * first, and both of them drive the bunching statistic to zero while
     * leaving the bar unevenly shared.
     */
    rule: { type: 'select', value: 'midpoint', options: RULES as unknown as string[], label: 'Listening rule' },
    /** How far toward the gap's middle you move each bar. At 1 and above it breaks. */
    alpha: { type: 'number', value: 0.8, min: 0, max: 1.3, step: 0.01, label: 'Correction' },
    /** 0 starts everyone on the downbeat — one flam that has to push itself apart. */
    scatter: { type: 'number', value: 0.15, min: 0, max: 1, step: 0.01, label: 'Start spread' },
    restart: { type: 'button', label: 'Bunch them up again' },
    downbeat: { type: 'toggle', value: true, label: 'Bar click' },
    root: { type: 'number', value: 48, min: 30, max: 64, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'pentatonicMinor', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    decay: { type: 'number', value: 0.3, min: 0.05, max: 1.2, step: 0.01, label: 'Decay' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 5, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
Everyone plays once a bar. Nobody has a part, nobody counts the players, and
there is no conductor — each player hears only whoever went immediately before
them and immediately after them, and moves to the middle of that gap. Within
about twenty bars the ensemble is a perfect round-robin.

**The error is the discrete heat equation on a ring**, so all of it is closed
form. The update has eigenvalues \`(1−α) + α·cos(2πk/n)\`; mode 0 is the
ensemble's mean phase, held at exactly 1, so the group never drifts while its
members rearrange.

**Decay per bar, measured against the largest of those.** Twenty-one runs across
seven ensemble sizes and three correction strengths:

| n | α = 0.4 | α = 0.8 | α = 0.95 |
| --- | --- | --- | --- |
| 5 | 0.723607 | 0.447214 | 0.718566 |
| 8 | 0.882843 | 0.765685 | 0.900000 |
| 16 | 0.969552 | 0.939104 | 0.927686 |

Measured/predicted was **1.0000 on 20 of 21**, the exception 0.9997. Across all
of them the phase sum drifted by at most **4e−15** and **no two players ever
swapped places** — both integers that had to come out that way and did.

**The bunching statistic cannot see the difference, and that is the trap.** Over
twelve seeds at eight players:

| rule | how unevenly the bar ends up shared | order parameter |
| --- | --- | --- |
| midpoint | **1.8e−16** | 0.000000 |
| repel all | **0.468** | 0.000000 |
| repel nearest | 1.30 | 0.631 |

\`repel all\` reads *perfectly spread out* on the obvious measure and settles
with one gap twice the ideal and another half of it. Only the gaps know.

**At exactly α = 1 the parity of the ensemble decides.** The shortest-wavelength
mode has eigenvalue 1 − 2α, so at 1 it flips sign each bar and never shrinks —
but it only exists when n is even. Measured at α = 1: **every even ensemble
sticks at ≈ 0.64 forever, every odd one converges**, 9 sizes of 9.

**The fastest correction depends on n, which is the one thing nobody knows.**
Balancing the longest wavelength against the shortest gives
α\\* = 2/(2 − cos(2π/n) − cos(2π⌊n/2⌋/n)); measured against it over ten sizes,
ratios **0.9963 → 1.0020**. At three players α\\* = 2/3 sends every mode to
exactly zero and they find their places **in a single bar**. So an ensemble can
share a bar out perfectly without counting itself, and still cannot tune how
fast it does so without counting itself.

**Order is preserved, so the tune does not change — only the rhythm.** Push
\`Correction\` past 1 and players cross, and you hear the melody scramble as the
rhythm falls apart.

**Off a recording**, with no pitch detection at all: n players firing once each
span exactly a bar, so n consecutive onsets *are* the ring gaps. Thirty bars,
eight players, the sketch checked against the same model re-run in node:

| rule | onsets per bar | bars read | heard, first → last | model, first → last | log rms |
| --- | --- | --- | --- | --- | --- |
| midpoint | 8.07 | 29/30 | 0.452 → **5.9e−3** | 0.548 → 3.4e−4 | 0.041 |
| repel all | 8.07 | 29/30 | 0.703 → **0.418** | 0.673 → 0.414 | 0.006 |
| none | 8.13 | 30/30 | 1.064 → 1.06 | 1.060 → 1.06 | 0.002 |

The floor the recording reaches, 5.9e−3 of an ideal gap, is **0.79 ms** of
timing. The two arrangements that stand still agree with the model to 0.006 and
0.002; the one that is *moving* agrees to 0.041, because a one-bar window
straddles a bar line and so mixes the arrangement before the update with the one
after.

Levels: 0.445 over the first bars, 0.496 once settled, 0.745 worst over fourteen
settings.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: 0.2, seconds: 1.6 })
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)
    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    // -- the ensemble ----------------------------------------------------------

    let st: State = start(2, () => 0, 0)
    let pitches: number[] = []
    let trace: number[] = []
    let rateSeen = NaN

    const reset = () => {
      const n = Math.round(ctx.params.players)
      st = start(n, rng(Math.round(ctx.params.seed)).next, ctx.params.scatter)
      trace = [unevenness(st.p)]
      rateSeen = NaN
    }

    const repitch = () => {
      const rootN = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      // Pitch by position in the ring. The midpoint rule preserves order, so
      // that *is* pitch by identity — and when it stops being, you hear it.
      pitches = []
      for (let i = 0; i < MAX_PLAYERS; i++) pitches.push(degree(rootN, scale, i))
    }
    reset()
    repitch()

    for (const k of ['players', 'seed', 'scatter'] as const) ctx.onParam(k, reset)
    for (const k of ['root', 'scale'] as const) ctx.onParam(k, repitch)
    ctx.onPress('restart', reset)

    // -- the sound -------------------------------------------------------------

    const strike = (i: number, time: number, gain: number, n: number) => {
      const at = Math.max(time, ctx.audio.currentTime + 0.004)
      const f = mtof(pitches[i % MAX_PLAYERS])
      const dec = ctx.params.decay

      const pn = ctx.audio.createStereoPanner()
      pn.pan.value = n < 2 ? 0 : -0.6 + (i / (n - 1)) * 1.2
      pn.connect(bus)

      const amp = ctx.audio.createGain()
      amp.gain.setValueAtTime(0, at)
      // 5 ms, not 1 — a fast ramp on a sine is a broadband click, and the whole
      // point of this sketch is where the attacks land
      amp.gain.linearRampToValueAtTime(gain, at + 0.005)
      amp.gain.exponentialRampToValueAtTime(Math.max(1e-4, gain * 0.012), at + dec)
      amp.connect(pn)

      const o = ctx.audio.createOscillator()
      o.type = 'triangle'
      o.frequency.value = f
      o.connect(amp)

      const o2 = ctx.audio.createOscillator()
      o2.type = 'sine'
      o2.frequency.value = f * 2.01
      const g2 = ctx.audio.createGain()
      g2.gain.setValueAtTime(0, at)
      g2.gain.linearRampToValueAtTime(gain * 0.3, at + 0.004)
      g2.gain.exponentialRampToValueAtTime(1e-4, at + dec * 0.4)
      o2.connect(g2).connect(pn)

      o.start(at)
      o2.start(at)
      disposeAt(o, at + dec + 0.06, [amp, pn])
      disposeAt(o2, at + dec + 0.06, [g2])
    }

    const click = (time: number, gain: number) => {
      const at = Math.max(time, ctx.audio.currentTime + 0.004)
      const o = ctx.audio.createOscillator()
      o.type = 'square'
      o.frequency.value = 1180
      const g = ctx.audio.createGain()
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(gain, at + 0.003)
      g.gain.exponentialRampToValueAtTime(1e-4, at + 0.035)
      o.connect(g).connect(bus)
      o.start(at)
      disposeAt(o, at + 0.1, [g])
    }

    // -- the transport ----------------------------------------------------------

    let base = -1
    let bars = 0
    /** Phases of the bar currently sounding, for the playhead. */
    let sounding: number[] = []

    ctx.clock.onStep((e) => {
      if (base < 0) base = e.step
      if ((e.step - base) % CYCLE !== 0) return

      // Everyone has heard the whole of the last bar and re-places themselves
      // for the next one, all at once.
      const n = Math.round(ctx.params.players)
      if (st.p.length !== n) reset()
      advance(st, ctx.params.alpha, ctx.params.rule as Rule)
      bars++
      trace.push(unevenness(st.p))
      if (trace.length > TRACE) trace.shift()

      const barDur = CYCLE * e.dur
      // One note per player per bar, so n of them overlap by decay/bar. Scale by
      // that, normalised so the defaults are untouched.
      const stacked = (n * ctx.params.decay) / Math.max(1e-6, barDur)
      // A bunched ensemble is all one chord and a spread one is a pulse train,
      // which is a 2x difference in peak for the same notes. The sketch already
      // computes how bunched it is, so divide by it and the level stops
      // depending on how far through reorganising itself the ensemble is.
      const lvl =
        ((0.48 + ctx.params.level * 0.64) * Math.sqrt(2.2 / Math.max(2.2, stacked))) / (1 + order(st.p))

      sounding = []
      for (let i = 0; i < n; i++) {
        const ph = ((st.p[i] % 1) + 1) % 1
        sounding.push(ph)
        strike(i, e.time + ph * barDur, lvl, n)
      }
      if (ctx.params.downbeat) click(e.time, lvl * 0.16)

      // The decay factor of the last stretch of the trace, as the ensemble sees
      // it — compared on screen against the eigenvalue it should be.
      const t = trace.filter((v) => v > 1e-12)
      if (t.length > 12) {
        const a = t[t.length - 12]
        const b = t[t.length - 1]
        rateSeen = a > 0 ? Math.pow(b / a, 1 / 11) : NaN
      }
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          base = -1
          bars = 0
          reset()
        }
      }),
    )

    // -- drawing ---------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 10
      const n = st.p.length
      const ringR = Math.min((h - pad * 2) / 2 - 12, 96)
      const cx = pad + ringR + 12
      const cy = h / 2
      const ang = (p: number) => -Math.PI / 2 + p * 2 * Math.PI

      // the bar, as a clock face
      g.strokeStyle = '#1e293b'
      g.lineWidth = 1
      g.beginPath()
      g.arc(cx, cy, ringR, 0, Math.PI * 2)
      g.stroke()

      // where an even share would put them
      g.strokeStyle = '#334155'
      for (let i = 0; i < n; i++) {
        const a = ang(i / n)
        g.beginPath()
        g.moveTo(cx + Math.cos(a) * (ringR - 6), cy + Math.sin(a) * (ringR - 6))
        g.lineTo(cx + Math.cos(a) * (ringR + 6), cy + Math.sin(a) * (ringR + 6))
        g.stroke()
      }

      // the playhead, from the transport rather than from the step just scheduled
      if (base >= 0) {
        const ph = (((ctx.clock.visualStep - base) % CYCLE) + CYCLE) % CYCLE
        const a = ang(ph / CYCLE)
        g.strokeStyle = '#475569'
        g.beginPath()
        g.moveTo(cx, cy)
        g.lineTo(cx + Math.cos(a) * ringR, cy + Math.sin(a) * ringR)
        g.stroke()
      }

      for (let i = 0; i < n && i < sounding.length; i++) {
        const a = ang(sounding[i])
        g.fillStyle = COLOURS[i % COLOURS.length]
        g.beginPath()
        g.arc(cx + Math.cos(a) * ringR, cy + Math.sin(a) * ringR, 4.5, 0, Math.PI * 2)
        g.fill()
      }

      // how unevenly the bar is shared, per bar, on a log scale — with the
      // eigenvalue drawn as the straight line it should be
      const x0 = cx + ringR + 22
      const plotW = w - pad - x0
      const plotH = h - pad * 2 - 30
      const y0 = pad + 18
      if (plotW > 60) {
        const lo = -16
        const at = (v: number) => {
          const l = Math.max(lo, Math.log10(Math.max(v, 1e-18)))
          return y0 + plotH * (1 - (l - lo) / (Math.log10(3) - lo))
        }
        g.strokeStyle = '#1e293b'
        g.beginPath()
        g.moveTo(x0, at(1e-16))
        g.lineTo(x0 + plotW, at(1e-16))
        g.stroke()

        const pred = predictedDecay(n, ctx.params.alpha)
        if (trace.length > 2 && pred > 0 && pred < 1) {
          g.strokeStyle = '#475569'
          g.setLineDash([3, 3])
          g.beginPath()
          const from = trace[0]
          for (let i = 0; i < TRACE; i++) {
            const x = x0 + (i / (TRACE - 1)) * plotW
            const y = at(from * Math.pow(pred, i))
            i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
          }
          g.stroke()
          g.setLineDash([])
        }

        g.strokeStyle = '#7dd3fc'
        g.lineWidth = 1.5
        g.beginPath()
        trace.forEach((v, i) => {
          const x = x0 + (i / (TRACE - 1)) * plotW
          const y = at(v)
          i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
        })
        g.stroke()
        g.lineWidth = 1

        g.font = '10px ui-monospace, monospace'
        g.fillStyle = '#64748b'
        g.fillText('how unevenly the bar is shared, per bar', x0, y0 - 6)
      }

      g.font = '11px ui-monospace, monospace'
      const pred = predictedDecay(n, ctx.params.alpha)
      const un = unevenness(st.p)
      g.fillStyle = st.swaps > 0 ? '#f87171' : '#94a3b8'
      g.fillText(
        `bar ${bars}   uneven ${un.toExponential(1)}   order ${order(st.p).toFixed(3)}   swaps ${st.swaps}`,
        pad,
        h - pad,
      )
      g.fillStyle = '#64748b'
      const shown = Number.isFinite(rateSeen) ? rateSeen.toFixed(4) : '—'
      g.fillText(
        `decay ${shown} vs ${pred.toFixed(4)}   fastest α ${bestAlpha(n).toFixed(3)}`,
        pad + Math.min(300, w * 0.42),
        h - pad,
      )
    })

    ctx.status(`${Math.round(ctx.params.players)} players, nobody counting`)
  },
})
