import { clamp, degree, disposeAt, euclid, mtof, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * A rhythm that never repeats, and sounds like one that does.
 *
 * Every canon in this repo so far has a rational tempo ratio, so it comes back:
 * `convergence` converges every 5.19 s, `tiling` closes its cycle exactly,
 * `crossing` sweeps but the algebra still says where the voices meet. Make the
 * ratio irrational and none of that exists. The pattern never recurs — not at
 * any length, ever — and yet locally it is indistinguishable from a Euclidean
 * rhythm, because it *is* one, taken to its limit.
 *
 * The construction is the characteristic Sturmian word
 *
 *     s(n) = ⌊(n+1)α + β⌋ − ⌊nα + β⌋
 *
 * which puts a hit on step n or doesn't, at density α. That is the same
 * bucket-and-wrap that generates a Euclidean rhythm — literally the same
 * arithmetic as `euclid()` in the core — so at α = p/q it reproduces E(p,q)
 * exactly, and at irrational α it carries on doing what E(p,q) does without
 * ever closing.
 *
 * Three things are true of it and all three are checkable:
 *
 *   - **It has exactly n+1 distinct windows of length n.** That is the
 *     definition of a Sturmian word and it is the precise sense in which this
 *     is the *simplest possible* aperiodic rhythm: one factor more than the
 *     length, where a periodic rhythm saturates at its period and a random one
 *     runs off toward 2^n. It is the least surprising way to never repeat.
 *   - **The gaps between hits take exactly two values, and they differ by one.**
 *     ⌊1/α⌋ and ⌈1/α⌉ and nothing else — which is why it swings without ever
 *     sounding random.
 *   - **At rational α it is E(p,q) on the nose**, which is what `Snap` is for:
 *     turn it up and the rhythm locks into a loop you can hear coming round,
 *     turn it back to 0 and the loop dissolves while the local feel does not
 *     change at all.
 */

/** s(n) for slope α and offset β — 1 if step n carries a hit. */
const word = (n: number, alpha: number, beta: number) =>
  Math.floor((n + 1) * alpha + beta) - Math.floor(n * alpha + beta)

/** Nearest p/q with q ≤ maxQ. Used by `Snap` to make the rhythm repeat. */
function nearestFraction(x: number, maxQ: number): { p: number; q: number } {
  let best = { p: Math.round(x), q: 1 }
  let err = Math.abs(x - best.p)
  for (let q = 1; q <= maxQ; q++) {
    const p = Math.round(x * q)
    const e = Math.abs(x - p / q)
    if (e < err - 1e-12) {
      err = e
      best = { p, q }
    }
  }
  return best
}

/** How many distinct windows of each length the word has — its complexity. */
function complexity(bits: number[], maxLen: number): number[] {
  const out: number[] = []
  for (let n = 1; n <= maxLen; n++) {
    const seen = new Set<string>()
    for (let i = 0; i + n <= bits.length; i++) seen.add(bits.slice(i, i + n).join(''))
    out.push(seen.size)
  }
  return out
}

export default defineSketch({
  title: 'Irrational',
  description: 'A rhythm at an irrational density. Locally a Euclidean pattern; globally it never repeats.',
  tags: ['rhythm', 'sequencer', 'generative'],
  status: 'promising',
  bpm: 108,
  division: 4,

  params: {
    ratio: { type: 'number', value: 0.618034, min: 0.05, max: 0.95, step: 0.000001, label: 'Density (α)' },
    snap: { type: 'number', value: 0, min: 0, max: 24, step: 1, label: 'Snap to a fraction (0 = never repeats)' },
    voices: { type: 'number', value: 3, min: 1, max: 4, step: 1, label: 'Voices' },
    every: { type: 'number', value: 1, min: 1, max: 4, step: 1, label: 'A step every', unit: 'ticks' },
    decay: { type: 'number', value: 0.3, min: 0.05, max: 0.8, step: 0.01, label: 'Hit length', unit: 's' },
    accent: { type: 'number', value: 0.4, min: 0, max: 1, step: 0.01, label: 'Accent the long gaps' },
    space: { type: 'number', value: 0.2, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    root: { type: 'number', value: 45, min: 33, max: 60, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'minor', options: [...SCALE_NAMES], label: 'Scale' },
    seed: { type: 'number', value: 4, min: 1, max: 999, step: 1 },
    reroll: { type: 'button', label: 'New offsets' },
  },

  notes: `
Every canon in this repo has a rational tempo ratio, so it comes back:
\`convergence\` converges every 5.19 s, \`tiling\` closes exactly, \`crossing\`
sweeps but the algebra still says where the voices meet. Make the density
irrational and none of that exists — and yet locally the rhythm is
indistinguishable from a Euclidean one, because it *is* one, taken to its limit.

The word is s(n) = ⌊(n+1)α+β⌋ − ⌊nα+β⌋, which is the same bucket-and-wrap that
generates a Euclidean rhythm. At α = p/q it should therefore *be* E(p,q).

**Measured.** The oracle for the rational case is a characterisation, not a
copy of the construction: a Euclidean rhythm is the maximally even one, meaning
the number of onsets inside a window of length L varies by at most 1 over all
positions, for every L. Twenty p/q pairs:

  maximally even, with exactly p onsets in q steps    20 of 20
  onset positions equal ⌊k·q/p⌋ up to rotation        20 of 20

At irrational α, over eight constants (1/φ, φ−1 squared, √2−1, √3−1, π−3, e−2,
ln 2, 1/√5):

  exactly n+1 distinct windows of length n, n = 1..24   8 of 8
  exactly two gap lengths, ⌊1/α⌋ and ⌈1/α⌉             8 of 8

n+1 is the definition of a Sturmian word and it is the precise sense in which
this is the **simplest possible** rhythm that never repeats: one factor more
than the length, where a periodic rhythm saturates at its period and a random
one runs away toward 2^n.

**But "never repeats" is a claim no listener can support**, and the sketch says
so. A double is a rational, and long before that a finite window cannot tell an
irrational from its best fraction. The apparent period is the denominator of
that fraction, and it grows with how long you listen — derived independently
from fractional parts, agreeing with the word in **24 of 24** cases:

  α           window 400   1200   3000
  π − 3            113    113    113     16/113 is that good
  ln 2             277    642    642
  1/√5             199    682    682
  √2 − 1           169    408   1393
  1/φ golden       233    377   none below 1400

π is a poor irrational rhythm and the golden ratio is the best one, which is
exactly what "worst-approximable" means. Snap it and the complexity collapses
to the period on the nose: at 13/21 the count of distinct windows is 5, 9, 17,
21 for n = 4, 8, 16, 24 — n+1 until it hits 21, then flat forever.

**From the audio**, three bands sampled on the grid, 32 s: **229 of 229 and 228
of 228 steps recovered correctly**. Snapped, the strongest repeat is at the
period with r = **1.000** exactly. Unsnapped, the best anywhere is r = 0.935 at
lag 34 — a Fibonacci number, and never 1.

Peak 0.575 at the defaults; the loudest reachable configuration is 0.905. The
voices are staggered by 4 ms each: the pitches are consonant on purpose, and
three landing on one step used to sum in phase and put the master at 3.0 — rare
enough to miss in a 24 s run and still clip in a 35 s one.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.0 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)
    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    /**
     * A pure sine per voice. No harmonics means each voice owns a band, which
     * is what lets an analyser say whose hit is whose — and the whole claim
     * here is about *which* steps carry hits, so that has to be readable from
     * the sound rather than from the picture.
     */
    const hit = (midi: number, time: number, gain: number, pan: number, dur: number) => {
      const t = Math.max(time, ctx.audio.currentTime + 0.005)
      const osc = ctx.audio.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = mtof(midi)
      const amp = ctx.audio.createGain()
      amp.gain.value = 0
      const pn = ctx.audio.createStereoPanner()
      pn.pan.value = pan
      osc.connect(amp).connect(pn).connect(bus)
      // 8 ms, not 3: a fast ramp on a sine is a broadband click and the
      // splatter lands in every other voice's band at the same instant.
      amp.gain.setValueAtTime(0, t)
      amp.gain.linearRampToValueAtTime(gain, t + 0.008)
      amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.02), t + dur)
      osc.start(t)
      disposeAt(osc, t + dur + 0.05, [amp, pn])
    }

    // -- the words ---------------------------------------------------------------

    interface Voice {
      alpha: number
      beta: number
      midi: number
      pan: number
      /** A long prefix, for the complexity plot and the gap histogram. */
      bits: number[]
      gaps: Map<number, number>
      comp: number[]
      /** Set when `snap` has made this voice periodic. */
      period: number
    }

    let voices: Voice[] = []
    let snapped: { p: number; q: number } | null = null
    let alpha0 = 0.618034

    const PREFIX = 3000
    const MAXLEN = 32

    const build = () => {
      const r = rng(Math.round(ctx.params.seed))
      const n = Math.round(ctx.params.voices)
      const snap = Math.round(ctx.params.snap)
      alpha0 = ctx.params.ratio
      snapped = null
      if (snap >= 1) {
        snapped = nearestFraction(alpha0, snap)
        alpha0 = snapped.p / snapped.q
      }
      const root = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      voices = []
      for (let v = 0; v < n; v++) {
        // Every voice comes off the same number: slope frac((v+1)·α). One
        // irrational drives the whole kit, and snapping it makes all of them
        // periodic together with a common period.
        const a = clamp(((v + 1) * alpha0) % 1, 0.02, 0.98)
        const beta = r.next()
        const bits: number[] = []
        for (let i = 0; i < PREFIX; i++) bits.push(word(i, a, beta))
        const gaps = new Map<number, number>()
        let last = -1
        for (let i = 0; i < bits.length; i++) {
          if (!bits[i]) continue
          if (last >= 0) gaps.set(i - last, (gaps.get(i - last) ?? 0) + 1)
          last = i
        }
        /**
         * The period the word *appears* to have over this many steps.
         *
         * Always computed, not only when snapped, because "irrational" is a
         * claim a finite window cannot support. A double is a rational with a
         * denominator near 2^52, so the word is always eventually periodic —
         * and long before that, it is indistinguishable from its best rational
         * approximation. The apparent period is the denominator of that
         * approximation, and it grows with how long you listen. Displaying it
         * is more honest than the word "never" and considerably more
         * interesting: at π − 3 it comes out 113.
         */
        let period = 0
        for (let q = 1; q <= 1400 && q < bits.length / 2; q++) {
          let ok = true
          for (let i = 0; i + q < bits.length; i++) {
            if (bits[i] !== bits[i + q]) {
              ok = false
              break
            }
          }
          if (ok) {
            period = q
            break
          }
        }
        voices.push({
          alpha: a,
          beta,
          midi: degree(root, scale, v * 4),
          pan: n === 1 ? 0 : (v / (n - 1) - 0.5) * 1.2,
          bits,
          gaps,
          comp: complexity(bits.slice(0, 1200), MAXLEN),
          period,
        })
      }
    }
    build()
    for (const k of ['ratio', 'snap', 'voices', 'root', 'scale', 'seed'] as const) ctx.onParam(k, build)
    ctx.onPress('reroll', build)

    // -- playback ------------------------------------------------------------------

    let step = 0
    ctx.clock.onStep((e) => {
      const every = Math.max(1, Math.round(ctx.params.every))
      if (e.step % every !== 0) return
      step = Math.floor(e.step / every)
      // sqrt(3/n) so adding voices changes the texture rather than the level
      const g = (0.26 + ctx.params.level * 0.44) * Math.sqrt(3 / Math.max(1, voices.length))
      voices.forEach((v, i) => {
        const at = step % v.bits.length
        if (!v.bits[at]) return
        // A hit that ends a long gap gets leant on. The gaps only ever take two
        // values, so this is a two-level accent and it is what makes the
        // pattern swing rather than tick.
        let back = 1
        while (back < 24 && !v.bits[(at - back + v.bits.length) % v.bits.length]) back++
        const long = back > 1 / v.alpha
        const acc = 1 + (long ? ctx.params.accent * 0.7 : -ctx.params.accent * 0.25)
        // A few ms of flam per voice. The pitches are deliberately consonant —
        // 2:3:4.5 at the defaults — so when three of them land on the same step
        // their waveforms add in phase and the master sees three times one hit.
        // That is rare enough to miss in a 24 s run and still clip in a 35 s one,
        // which is exactly the kind of peak a short measurement lies about.
        // Staggering the attacks costs nothing audible and removes it.
        hit(v.midi, e.time + i * 0.004, g * acc, v.pan, ctx.params.decay * (i === 0 ? 1 : 0.7))
      })
    })

    // -- drawing ---------------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 14
      const n = voices.length
      const stripH = Math.min(26, Math.max(12, (h * 0.32) / n))
      const top = 22

      // -- the words, as steps --------------------------------------------------
      const SHOW = 64
      const cw = (w - pad * 2) / SHOW
      voices.forEach((v, i) => {
        const y = top + i * (stripH + 17)
        const hue = `hsl(${(i * 62 + 190) % 360}, 74%, 62%)`
        for (let k = 0; k < SHOW; k++) {
          const idx = (step - 8 + k + v.bits.length * 4) % v.bits.length
          const on = v.bits[idx] === 1
          const x = pad + k * cw
          g.fillStyle = on ? hue : 'rgba(255,255,255,0.05)'
          g.fillRect(x + 0.5, y, Math.max(1, cw - 1.5), on ? stripH : stripH * 0.28)
          if (k === 8) {
            g.strokeStyle = 'rgba(255,255,255,0.5)'
            g.lineWidth = 1
            g.beginPath()
            g.moveTo(x, y - 3)
            g.lineTo(x, y + stripH + 3)
            g.stroke()
          }
        }
        g.font = '9px ui-monospace, monospace'
        g.fillStyle = 'rgba(255,255,255,0.35)'
        g.fillText(`α ${v.alpha.toFixed(4)}` + (v.period ? `  ·  repeats every ${v.period}` : '  ·  no period'),
          pad, y - 3)
      })

      // -- the complexity, which is the whole claim -----------------------------
      const plotTop = top + n * (stripH + 17) + 22
      const plotH = Math.max(70, h - plotTop - 74)
      const plotW = (w - pad * 2) * 0.58
      const maxY = MAXLEN + 4
      const px = (k: number) => pad + (k / MAXLEN) * plotW
      const py = (c: number) => plotTop + plotH - (Math.min(c, maxY) / maxY) * plotH
      g.strokeStyle = 'rgba(255,255,255,0.10)'
      g.lineWidth = 1
      g.strokeRect(pad, plotTop, plotW, plotH)
      voices.forEach((v, i) => {
        g.strokeStyle = `hsl(${(i * 62 + 190) % 360}, 74%, 62%)`
        g.lineWidth = 1.6
        g.beginPath()
        v.comp.forEach((c, k) => {
          const x = px(k + 1)
          const y = py(c)
          k === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
        })
        g.stroke()
      })
      // n+1 drawn last, on top: every voice sits exactly on it, so underneath
      // the curves it is invisible and the claim cannot be read off the picture
      g.strokeStyle = 'rgba(253,224,71,0.8)'
      g.lineWidth = 1
      g.setLineDash([4, 4])
      g.beginPath()
      g.moveTo(px(1), py(2))
      g.lineTo(px(MAXLEN), py(MAXLEN + 1))
      g.stroke()
      g.setLineDash([])
      g.font = '9px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.fillText('distinct windows of length n — dashed is n+1, the Sturmian line', pad, plotTop - 5)
      g.fillStyle = 'rgba(253,224,71,0.6)'
      g.fillText('n+1', px(MAXLEN) - 22, py(MAXLEN + 1) - 5)

      // -- the two gaps ---------------------------------------------------------
      const gx = pad + plotW + 22
      const gw = w - gx - pad
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.fillText('gaps between hits — a Sturmian word has exactly two', gx, plotTop - 5)
      const v0 = voices[0]
      if (v0 && gw > 60) {
        const entries = [...v0.gaps.entries()].sort((a, b) => a[0] - b[0])
        const total = entries.reduce((a, e) => a + e[1], 0)
        const bh = Math.min(20, plotH / Math.max(1, entries.length) - 5)
        entries.forEach((e, i) => {
          const y = plotTop + 6 + i * (bh + 6)
          const frac = e[1] / total
          g.fillStyle = 'hsl(190, 74%, 62%)'
          g.fillRect(gx, y, Math.max(2, frac * (gw - 44)), bh)
          g.fillStyle = 'rgba(255,255,255,0.7)'
          g.font = '10px ui-monospace, monospace'
          g.fillText(`${e[0]}`, gx - 10, y + bh - 3)
          g.fillStyle = 'rgba(255,255,255,0.4)'
          g.fillText(`${(100 * frac).toFixed(1)}%`, gx + frac * (gw - 44) + 6, y + bh - 3)
        })
        if (entries.length > 2) {
          g.fillStyle = 'rgba(248,113,113,0.8)'
          g.fillText(`${entries.length} gap lengths — that should not happen`, gx, plotTop + plotH - 4)
        }
      }

      // -- the headline ----------------------------------------------------------
      g.font = '12px ui-monospace, monospace'
      g.fillStyle = snapped ? 'rgba(248,113,113,0.9)' : 'rgba(253,224,71,0.9)'
      g.fillText(
        snapped
          ? `α = ${snapped.p}/${snapped.q} = ${alpha0.toFixed(6)} — this loops, and E(${snapped.p},${snapped.q}) is what it loops on`
          : voices[0]?.period
            ? `α = ${alpha0.toFixed(6)} — no period until step ${voices[0].period}, which is its best fraction at this length`
            : `α = ${alpha0.toFixed(6)} — no period at all in ${PREFIX} steps`,
        pad,
        h - 26,
      )
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.4)'
      g.fillText(
        `1/α = ${(1 / (voices[0]?.alpha ?? 1)).toFixed(3)}, so the gaps are ` +
          `${Math.floor(1 / (voices[0]?.alpha ?? 1))} and ${Math.ceil(1 / (voices[0]?.alpha ?? 1))}`,
        pad,
        h - 12,
      )
      g.fillStyle = 'rgba(255,255,255,0.28)'
      g.fillText('turn Snap up to make it repeat — the feel does not change, only the memory', pad, h - 1)
    })

    // A read-only snapshot for the harness.
    const wnd = window as unknown as Record<string, unknown>
    wnd.__irr = () => ({
      alpha: alpha0,
      snapped,
      step,
      voices: voices.map((v) => ({
        alpha: v.alpha,
        beta: v.beta,
        midi: v.midi,
        freq: mtof(v.midi),
        period: v.period,
        comp: v.comp.slice(),
        gaps: [...v.gaps.entries()].sort((a, b) => a[0] - b[0]),
        bits: v.bits.slice(),
      })),
      /** E(p,q) from the core, for the rational case. */
      euclid: snapped ? euclid(snapped.p, snapped.q).map((b) => (b ? 1 : 0)) : null,
    })
    ctx.cleanup(() => delete wnd.__irr)

    ctx.status('the simplest possible rhythm that never repeats — n+1 windows of length n, and two gap lengths')
  },
})
