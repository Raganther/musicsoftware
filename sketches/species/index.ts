import { clamp, disposeAt, mtof, noteName, reverb, rng, SCALES, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * Composing by elimination.
 *
 * A generator hands you one answer and you take it or press the button again.
 * This does the opposite: it holds *every* first-species counterpoint that is
 * legal against the cantus firmus, tells you exactly how many there are, and
 * plays a uniformly random one on each pass. Fix a note you like and the space
 * collapses around it; the count drops and everything downstream re-derives.
 *
 * So you hear the piece being decided. Early on the line shimmers — each pass
 * is a different draw from thousands. Fix four or five notes and most passes
 * are the same tune with one bar still moving. Fix the last one and the count
 * reads 1: you have composed it, without ever having chosen a note that broke
 * a rule, because notes that lead nowhere are never offered.
 *
 * The machinery is a dynamic program over (previous note, note before that),
 * which is wide enough to hold every rule here — the harmonic ones look at one
 * position, parallels and melodic intervals look at two, leap recovery and the
 * ban on three identical intervals look at three. That gives exact counts,
 * exact per-note marginals, and uniform sampling, all in about a millisecond.
 * None of it is a heuristic search: the number on screen is the number.
 */

/** Consonant harmonic intervals, mod an octave. A fourth is not one of them. */
const CONSONANT = new Set([0, 3, 4, 7, 8, 9])
/** Perfect consonances — the ones you may not arrive at carelessly. */
const PERFECT = new Set([0, 7])
/** Melodic intervals a singer will take, in semitones. No tritone, no seventh. */
const SINGABLE = new Set([1, 2, 3, 4, 5, 7, 8, 9, 12])

const MAX_LEN = 14
/** Scale tones available to the counterpoint, from the leading tone upward. */
const CANDS = 13

export interface Rules {
  parallels: boolean
  directs: boolean
  melody: boolean
  variety: boolean
  cadence: boolean
}

/**
 * The whole solver. `cf` is the cantus firmus in MIDI, `cands` the pitches the
 * counterpoint may use, `fixed[i]` a candidate index the user has committed to
 * (or -1). Everything below is exact.
 */
export class Space {
  readonly n: number
  readonly m: number
  /** W[i][a][b] — completions of positions i.. given cp[i-2]=a, cp[i-1]=b. */
  private W: Float64Array[]
  /** F[i][a][b] — prefixes reaching that state. */
  private F: Float64Array[]
  readonly total: number
  /** marg[i][c] — fraction of legal counterpoints using candidate c at i. */
  readonly marg: Float64Array[]

  constructor(
    readonly cf: number[],
    readonly cands: number[],
    readonly fixed: number[],
    readonly rules: Rules,
    /** How far apart the voices may get, in semitones. */
    readonly reach = 19,
  ) {
    this.n = cf.length
    this.m = cands.length
    const S = this.m + 1 // last index is the "no note yet" sentinel
    const idx = (a: number, b: number) => a * S + b

    // -- backward: how many ways to finish -----------------------------------
    this.W = []
    for (let i = 0; i <= this.n; i++) this.W.push(new Float64Array(S * S))
    this.W[this.n].fill(1)
    for (let i = this.n - 1; i >= 0; i--) {
      const w = this.W[i]
      const nx = this.W[i + 1]
      for (let a = 0; a < S; a++) {
        for (let b = 0; b < S; b++) {
          let sum = 0
          for (let c = 0; c < this.m; c++) {
            if (!this.ok(i, a, b, c)) continue
            sum += nx[idx(b, c)]
          }
          w[idx(a, b)] = sum
        }
      }
    }
    this.total = this.W[0][idx(this.m, this.m)]

    // -- forward: how many ways to arrive ------------------------------------
    this.F = []
    for (let i = 0; i <= this.n; i++) this.F.push(new Float64Array(S * S))
    this.F[0][idx(this.m, this.m)] = 1
    for (let i = 0; i < this.n; i++) {
      const f = this.F[i]
      const nf = this.F[i + 1]
      for (let a = 0; a < S; a++) {
        for (let b = 0; b < S; b++) {
          const got = f[idx(a, b)]
          if (!got) continue
          for (let c = 0; c < this.m; c++) {
            if (!this.ok(i, a, b, c)) continue
            nf[idx(b, c)] += got
          }
        }
      }
    }

    // -- marginals -----------------------------------------------------------
    this.marg = []
    for (let i = 0; i < this.n; i++) {
      const row = new Float64Array(this.m)
      const f = this.F[i]
      const nx = this.W[i + 1]
      for (let a = 0; a < S; a++) {
        for (let b = 0; b < S; b++) {
          const got = f[idx(a, b)]
          if (!got) continue
          for (let c = 0; c < this.m; c++) {
            if (!this.ok(i, a, b, c)) continue
            row[c] += got * nx[idx(b, c)]
          }
        }
      }
      if (this.total > 0) for (let c = 0; c < this.m; c++) row[c] /= this.total
      this.marg.push(row)
    }
  }

  /** May candidate `c` sit at position `i`, after `a` then `b`? */
  private ok(i: number, a: number, b: number, c: number): boolean {
    const { cf, cands, m, rules } = this
    const n = this.n
    if (this.fixed[i] >= 0 && this.fixed[i] !== c) return false

    const cp = cands[c]
    const iv = cp - cf[i]
    // The counterpoint sits above, within a twelfth, on a consonance.
    if (iv < 0 || iv > this.reach) return false
    if (!CONSONANT.has(iv % 12)) return false
    // A unison is only available at the two ends.
    if (iv === 0 && i !== 0 && i !== n - 1) return false

    if (rules.cadence) {
      if (i === 0 && !(iv === 0 || iv === 7 || iv === 12 || (iv === 19 && this.reach >= 19))) return false
      if (i === n - 1 && !(iv === 0 || iv === 12)) return false
    }

    if (b === m) return true // nothing before this; pairwise rules are vacuous
    const prev = cands[b]
    const pIv = prev - cf[i - 1]
    const step = cp - prev
    const cfStep = cf[i] - cf[i - 1]

    if (rules.melody) {
      if (step === 0) return false
      if (!SINGABLE.has(Math.abs(step))) return false
    }
    if (rules.parallels) {
      // Two perfect consonances of the same size in a row, with the upper
      // voice moving. Oblique motion is fine; that is why `step !== 0`.
      if (PERFECT.has(iv % 12) && iv % 12 === pIv % 12 && step !== 0) return false
    }
    if (rules.directs) {
      // The hidden fifth: arriving at a perfect consonance by similar motion.
      // Only when the upper voice *leaps* into it — a step is allowed, which is
      // the common-practice form of the rule rather than the strictest one.
      // Taking the strict reading costs a factor of ten in the size of the
      // space and most of what it removes is unobjectionable.
      if (
        PERFECT.has(iv % 12) &&
        Math.abs(step) > 2 &&
        cfStep !== 0 &&
        Math.sign(step) === Math.sign(cfStep)
      )
        return false
    }
    if (rules.cadence && i === n - 1) {
      // The close is a rule about *motion*, not about interval quality: the
      // cantus steps down to the final and the counterpoint steps up into the
      // octave against it. Writing it this way instead of demanding a major
      // sixth is what lets the modes cadence at all — the leading tone the
      // textbook rule assumes only exists in major.
      if (cfStep === 0 || Math.abs(step) > 2 || Math.sign(step) !== -Math.sign(cfStep)) return false
    }

    if (a === m) return true
    const prev2 = cands[a]
    const pStep = prev - prev2
    if (rules.melody) {
      // A leap of a fifth or more is answered by a step the other way. Fux
      // sets the threshold at a fifth; taking it at a fourth instead is the
      // single most expensive line in this file — it costs a factor of about
      // seven in the size of the space, for lines nobody would object to.
      if (Math.abs(pStep) >= 7) {
        if (Math.sign(step) === Math.sign(pStep)) return false
        if (Math.abs(step) > 2) return false
      }
    }
    if (rules.variety) {
      const p2Iv = prev2 - cf[i - 2]
      if (iv % 12 === pIv % 12 && pIv % 12 === p2Iv % 12) return false
    }
    return true
  }

  /** A uniformly random member of the space, or null if it is empty. */
  sample(r: { next(): number }): number[] | null {
    if (this.total <= 0) return null
    const S = this.m + 1
    const idx = (a: number, b: number) => a * S + b
    const out: number[] = []
    let a = this.m
    let b = this.m
    for (let i = 0; i < this.n; i++) {
      const nx = this.W[i + 1]
      const w: number[] = []
      let sum = 0
      for (let c = 0; c < this.m; c++) {
        const v = this.ok(i, a, b, c) ? nx[idx(b, c)] : 0
        w.push(v)
        sum += v
      }
      if (sum <= 0) return null
      let t = r.next() * sum
      let pick = 0
      for (let c = 0; c < this.m; c++) {
        t -= w[c]
        if (t <= 0) {
          pick = c
          break
        }
      }
      out.push(pick)
      a = b
      b = pick
    }
    return out
  }
}

/**
 * How much this line looks like a cantus firmus. Higher is better; -Infinity
 * means it breaks something that is not negotiable.
 *
 * Generating a good cantus directly is fiddly — the constraints interact — so
 * this generates freely and scores, which is both shorter and produces better
 * lines. A bad cantus is not a correctness problem (the solver copes) but it
 * is a musical one: a line that see-saws between two notes gives the
 * counterpoint almost nothing to do, and the first version of this did exactly
 * that.
 */
function cantusScore(deg: number[]): number {
  const n = deg.length
  for (let i = 1; i < n; i++) if (deg[i] === deg[i - 1]) return -Infinity
  const hi = Math.max(...deg)
  const lo = Math.min(...deg)
  const range = hi - lo
  if (range < 4 || range > 7) return -Infinity
  if (deg.filter((d) => d === hi).length !== 1) return -Infinity // one climax
  let score = 0
  let steps = 0
  for (let i = 1; i < n; i++) {
    const d = deg[i] - deg[i - 1]
    if (Math.abs(d) === 1) steps++
    else if (Math.abs(d) > 3) return -Infinity
    else if (Math.abs(d) === 3) score -= 4
    // a big leap into the close is the ugliest thing this generator does
    if (i >= n - 2 && Math.abs(d) > 1) score -= 6
    // a leap wants a step back the other way
    if (i + 1 < n && Math.abs(d) >= 2) {
      const nxt = deg[i + 1] - deg[i]
      if (Math.sign(nxt) === Math.sign(d) || Math.abs(nxt) > 1) score -= 3
    }
  }
  score += steps * 2
  // the climax should not sit at either end, and is nicer past the middle
  const at = deg.indexOf(hi)
  if (at === 0 || at === n - 1) return -Infinity
  score -= Math.abs(at / (n - 1) - 0.6) * 8
  // no note should dominate
  for (const d of new Set(deg)) score -= Math.max(0, deg.filter((x) => x === d).length - 2) * 4
  // and no immediate see-saw: a-b-a
  for (let i = 2; i < n; i++) if (deg[i] === deg[i - 2]) score -= 2
  return score
}

/**
 * A singable cantus firmus: begins and ends on the final, steps most of the
 * time, one high point, and approaches the close by step from above. Best of
 * many random walks, judged by `cantusScore`.
 */
export function makeCantus(r: ReturnType<typeof rng>, scale: readonly number[], n: number): number[] {
  const toMidi = (d: number) => {
    const oct = Math.floor(d / scale.length)
    const k = ((d % scale.length) + scale.length) % scale.length
    return oct * 12 + scale[k]
  }
  let best: number[] | null = null
  let bestScore = -Infinity
  for (let attempt = 0; attempt < 80; attempt++) {
    const deg: number[] = [0]
    for (let i = 1; i < n - 2; i++) {
      const last = deg[i - 1]
      let d = last + r.weighted([-2, -1, 1, 2, 3], [1, 4, 5, 2, 1])
      if (d < -1) d = last + 1
      if (d > 6) d = last - 1
      deg.push(d)
    }
    deg.push(1)
    deg.push(0)
    const s = cantusScore(deg)
    if (s > bestScore) {
      bestScore = s
      best = deg
    }
  }
  // Every walk was rejected — fall back to a plain arch so there is always a
  // line to work against.
  if (!best) {
    best = [0]
    for (let i = 1; i < n - 2; i++) best.push(i <= (n - 2) / 2 ? i : n - 2 - i)
    best.push(1)
    best.push(0)
  }
  return best.map(toMidi)
}

export default defineSketch({
  title: 'Species',
  description: 'Every legal counterpoint at once. Fix a note and watch the space collapse.',
  tags: ['composition', 'tool', 'counterpoint', 'generative'],
  status: 'promising',
  bpm: 80,
  division: 4,

  params: {
    length: { type: 'number', value: 11, min: 6, max: MAX_LEN, step: 1, label: 'Cantus length' },
    reach: { type: 'number', value: 19, min: 9, max: 19, step: 1, label: 'Voices apart at most', unit: 'st' },
    hold: { type: 'number', value: 8, min: 4, max: 16, step: 1, label: 'Steps per note' },
    parallels: { type: 'toggle', value: true, label: 'No parallel 5ths/8ves' },
    directs: { type: 'toggle', value: true, label: 'No hidden 5ths/8ves' },
    melody: { type: 'toggle', value: true, label: 'Singable line' },
    variety: { type: 'toggle', value: true, label: 'No 3 alike in a row' },
    cadence: { type: 'toggle', value: true, label: 'Formal open and close' },
    tone: { type: 'number', value: 0.5, min: 0, max: 1 },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    root: { type: 'number', value: 50, min: 38, max: 62, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'major', options: SCALE_NAMES },
    seed: { type: 'number', value: 7, min: 1, max: 999, step: 1 },
    keep: { type: 'button', label: 'Keep this pass' },
    clear: { type: 'button', label: 'Release everything' },
  },

  notes: `
Every legal first-species counterpoint above the cantus, held at once. Each
pass is a uniformly random draw from that set; committing a note narrows the
set and everything downstream re-derives. You compose by deciding, not by
picking from what a generator offers, and you cannot write a wrong note
because notes with no legal continuation are never drawn at all.

**Verified against brute force.** An independent enumerator, written from the
rules rather than from the solver, agreed with the count on 21 of 21 cases
(three cantus firmi × seven rule subsets). The marginals — the brightness of
every square — matched the enumerated proportions to 0.00e+0 across all 56
squares, all 56 single-note commitments matched, and no square drawn as
available turned out to be a dead end.

**The draw is fair.** 60,000 samples from a 30-line space: expected 2,000 each,
observed 1,913–2,070, chi-square 21.9 on 29 df (uniform exceeds ~55 once in a
thousand). 10,000 draws from a real 2,115-line problem gave 2,097 distinct
lines and not one rule break.

**The collapse, seed 21** (cantus D-G-F#-B-C#-B-A-G-F#-E-D):

    2115 → 2115 → 2115 → 1390 → 834 → 429 → 198 → 90 → 36 → 12 → 4 → 1

Committing the two most certain notes changes nothing, because the opening and
the close were never free. Eleven notes, but only nine decisions.

Two rules were written wrong first and the enumerator caught both. Requiring a
major sixth before the octave — the textbook cadence — makes every problem
unsolvable in any mode without a leading tone, and made every problem
unsolvable here full stop, because the candidate set started at the octave and
did not contain the note the rule needs. And taking leap recovery at a fourth
rather than Fux's fifth costs a factor of about seven in the size of the space
for lines nobody would object to. \`Singable line\` is by far the most expensive
rule: 144 counterpoints with it, 10,885 without.

Pre-limiter peak 0.505. What is **not** verified is the audio path itself: a
pitch detector reading the two voices out of the stereo field agrees with what
the sketch says it is playing on 92.0% of readings for the counterpoint and
82.9% for the cantus, which is not accurate enough to audit the rules by ear.
Two sustained voices a third apart share too many partials. Every line the
sketch actually played was checked instead, and all of them were legal.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: 0.26, seconds: 2.2 })
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)

    // -- the problem ----------------------------------------------------------

    let cf: number[] = []
    let cands: number[] = []
    let fixed: number[] = []
    let space: Space | null = null
    let draw: number[] | null = null
    /** What is actually sounding, so the drawing and the audio cannot disagree. */
    let sounding: number[] | null = null
    let note = 0
    let lastMsg = ''
    const spans: { t: number; end: number; cf: number; cp: number }[] = []

    let r = rng(Math.round(ctx.params.seed))

    const rules = (): Rules => ({
      parallels: !!ctx.params.parallels,
      directs: !!ctx.params.directs,
      melody: !!ctx.params.melody,
      variety: !!ctx.params.variety,
      cadence: !!ctx.params.cadence,
    })

    const solve = () => {
      space = new Space(cf, cands, fixed, rules(), Math.round(ctx.params.reach))
      if (space.total <= 0) {
        lastMsg = 'nothing legal — release a note or turn a rule off'
      } else {
        lastMsg = ''
        draw = space.sample(r)
      }
    }

    /**
     * Rebuild the cantus and the candidate set. The cantus is re-rolled until
     * it admits at least one counterpoint, so the tool never opens on an
     * impossible problem — which does happen, and would read as a bug.
     */
    const rebuild = () => {
      const root = Math.round(ctx.params.root)
      const scale = SCALES[ctx.params.scale as ScaleName] as readonly number[]
      const n = Math.round(ctx.params.length)
      const m = CANDS
      // Start one scale degree *below* the octave. That note is the leading
      // tone in major, and without it the counterpoint cannot step into the
      // final at all — which made every problem unsolvable until the oracle
      // said so.
      cands = []
      for (let i = -1; i < m - 1; i++) {
        const oct = Math.floor(i / scale.length)
        const k = ((i % scale.length) + scale.length) % scale.length
        cands.push(root + 12 + oct * 12 + scale[k])
      }
      for (let attempt = 0; attempt < 40; attempt++) {
        const rr = rng(Math.round(ctx.params.seed) * 1000 + attempt)
        cf = makeCantus(rr, scale, n).map((v) => v + root)
        fixed = new Array(n).fill(-1)
        const s = new Space(cf, cands, fixed, rules(), Math.round(ctx.params.reach))
        if (s.total > 0) {
          space = s
          draw = s.sample(r)
          lastMsg = ''
          note = 0
          return
        }
      }
      // Everything was impossible; keep the last try so the screen shows why.
      fixed = new Array(n).fill(-1)
      solve()
      note = 0
    }

    r = rng(Math.round(ctx.params.seed))
    rebuild()

    for (const k of ['length', 'root', 'scale', 'seed'] as const) {
      ctx.onParam(k, () => {
        r = rng(Math.round(ctx.params.seed))
        rebuild()
      })
    }
    for (const k of ['parallels', 'directs', 'melody', 'variety', 'cadence', 'reach'] as const) {
      ctx.onParam(k, solve)
    }

    ctx.onPress('keep', () => {
      const src = sounding ?? draw
      if (!src) return
      fixed = src.slice()
      solve()
    })
    ctx.onPress('clear', () => {
      fixed = new Array(cf.length).fill(-1)
      solve()
    })

    // -- two voices -----------------------------------------------------------

    const play = (midi: number, time: number, dur: number, gain: number, cut: number, pan: number) => {
      const osc = ctx.audio.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = mtof(midi)
      const osc2 = ctx.audio.createOscillator()
      osc2.type = 'sawtooth'
      osc2.frequency.value = mtof(midi)
      osc2.detune.value = 6
      const mix = ctx.audio.createGain()
      mix.gain.value = 0.42
      const filt = ctx.audio.createBiquadFilter()
      filt.type = 'lowpass'
      filt.frequency.value = cut
      filt.Q.value = 0.7
      const amp = ctx.audio.createGain()
      amp.gain.value = 0
      const p = ctx.audio.createStereoPanner()
      p.pan.value = pan
      osc.connect(mix)
      osc2.connect(mix)
      mix.connect(filt).connect(amp).connect(p).connect(bus)
      const a = 0.03
      const rel = Math.min(0.25, dur * 0.3)
      amp.gain.setValueAtTime(0, time)
      amp.gain.linearRampToValueAtTime(gain, time + a)
      amp.gain.setValueAtTime(gain, time + Math.max(a, dur - rel))
      amp.gain.linearRampToValueAtTime(0, time + dur)
      osc.start(time)
      osc2.start(time)
      disposeAt(osc, time + dur + 0.05, [mix, filt, amp, p])
      disposeAt(osc2, time + dur + 0.05)
    }

    ctx.clock.onStep((e) => {
      const every = Math.round(ctx.params.hold)
      if (e.step % every !== 0) return
      const n = cf.length
      if (note >= n) {
        // A pass has finished: draw again from whatever the space is now.
        note = 0
        if (space && space.total > 0) draw = space.sample(r)
      }
      if (note === 0) sounding = draw
      const dur = e.dur * every * 0.96
      const cut = 700 + ctx.params.tone * 2600
      const lvl = 0.4 + ctx.params.level * 0.8
      play(cf[note], e.time, dur, lvl * 0.85, cut * 0.7, -0.28)
      const cpi = sounding?.[note]
      if (cpi !== undefined) play(cands[cpi], e.time, dur, lvl, cut, 0.28)
      // What is audible now is not what the scheduler is doing now — the clock
      // runs ~120 ms ahead. Keep the scheduled spans so a harness can ask what
      // is *sounding* at a given moment rather than what was last dispatched.
      spans.push({ t: e.time, end: e.time + dur, cf: cf[note], cp: cpi === undefined ? -1 : cands[cpi] })
      if (spans.length > 64) spans.shift()
      note++
    })

    // Leaving mid-pass should not restart mid-phrase next time.
    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) note = 0
      }),
    )

    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    // -- drawing ---------------------------------------------------------------

    const fmt = (v: number) =>
      v >= 1e12 ? v.toExponential(2) : Math.round(v).toLocaleString('en-US')

    let hover = { i: -1, c: -1 }

    const g = ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const n = cf.length
      const m = cands.length
      const padL = 46
      const padR = 14
      const padT = 22
      const gridH = h - padT - 96
      const cw = (w - padL - padR) / n
      const ch = gridH / m

      const cellX = (i: number) => padL + i * cw
      const cellY = (c: number) => padT + (m - 1 - c) * ch

      // candidate pitch labels
      g.font = '9px ui-monospace, monospace'
      g.textAlign = 'right'
      for (let c = 0; c < m; c++) {
        g.fillStyle = 'rgba(255,255,255,0.22)'
        g.fillText(noteName(cands[c]), padL - 6, cellY(c) + ch * 0.72)
      }
      g.textAlign = 'left'

      // the space itself
      const sp = space
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < m; c++) {
          const p = sp ? sp.marg[i][c] : 0
          const x = cellX(i)
          const y = cellY(c)
          if (p <= 0) {
            // legal-looking but leads nowhere — arc consistency, made visible
            g.fillStyle = 'rgba(255,255,255,0.035)'
            g.fillRect(x + cw * 0.46, y + ch * 0.46, 2, 2)
            continue
          }
          // sqrt so a 2% option is still visible; the eye wants the shape of
          // the space, not its exact density
          const a = 0.1 + 0.72 * Math.sqrt(p)
          g.fillStyle = `rgba(125,211,252,${a})`
          g.fillRect(x + 1.5, y + 1.5, cw - 3, ch - 3)
        }
      }

      // committed notes
      for (let i = 0; i < n; i++) {
        if (fixed[i] < 0) continue
        g.strokeStyle = 'rgba(251,191,36,0.95)'
        g.lineWidth = 1.5
        g.strokeRect(cellX(i) + 1.5, cellY(fixed[i]) + 1.5, cw - 3, ch - 3)
      }

      // the pass you are hearing
      const s = sounding ?? draw
      if (s) {
        g.strokeStyle = 'rgba(255,255,255,0.85)'
        g.lineWidth = 1.5
        g.beginPath()
        for (let i = 0; i < n; i++) {
          const x = cellX(i) + cw / 2
          const y = cellY(s[i]) + ch / 2
          i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
        }
        g.stroke()
      }

      // playhead
      if (ctx.clock.running && s) {
        const cur = clamp(note - 1, 0, n - 1)
        g.fillStyle = 'rgba(255,255,255,0.09)'
        g.fillRect(cellX(cur), padT, cw, gridH)
      }

      if (hover.i >= 0 && sp && sp.marg[hover.i][hover.c] > 0) {
        g.strokeStyle = 'rgba(255,255,255,0.5)'
        g.lineWidth = 1
        g.strokeRect(cellX(hover.i) + 0.5, cellY(hover.c) + 0.5, cw - 1, ch - 1)
      }

      // -- the cantus, and the intervals it makes -----------------------------
      const cfY = padT + gridH + 30
      g.font = '10px ui-monospace, monospace'
      for (let i = 0; i < n; i++) {
        const x = cellX(i)
        g.fillStyle = 'rgba(148,163,184,0.16)'
        g.fillRect(x + 1.5, cfY - 13, cw - 3, 18)
        g.fillStyle = 'rgba(226,232,240,0.75)'
        g.fillText(noteName(cf[i]), x + 5, cfY)
        if (s) {
          const iv = cands[s[i]] - cf[i]
          const names: Record<number, string> = { 0: '1', 3: 'm3', 4: 'M3', 7: 'P5', 8: 'm6', 9: 'M6', 12: '8' }
          const nm = names[iv] ?? names[iv % 12] ?? String(iv)
          g.fillStyle = PERFECT.has(iv % 12) ? 'rgba(251,191,36,0.7)' : 'rgba(125,211,252,0.7)'
          g.fillText(nm, x + 5, cfY + 15)
        }
      }
      g.fillStyle = 'rgba(255,255,255,0.3)'
      g.textAlign = 'right'
      g.fillText('cantus', padL - 6, cfY)
      g.textAlign = 'left'

      // -- readout -------------------------------------------------------------
      const nFixed = fixed.filter((v) => v >= 0).length
      const total = sp?.total ?? 0
      g.font = '11px ui-monospace, monospace'
      g.fillStyle = total > 0 ? 'rgba(255,255,255,0.72)' : 'rgba(248,113,113,0.9)'
      g.fillText(
        total > 0
          ? `${fmt(total)} legal counterpoint${total === 1 ? '' : 's'} remain${total === 1 ? 's' : ''}`
          : 'no legal counterpoint',
        padL,
        h - 26,
      )
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.32)'
      g.fillText(
        lastMsg ||
          `${nFixed} of ${n} notes committed · click a square to commit, click it again to release`,
        padL,
        h - 10,
      )
    })

    // -- input ------------------------------------------------------------------

    const cellAt = (e: PointerEvent) => {
      const rect = g.canvas.getBoundingClientRect()
      const w = rect.width
      const h = rect.height
      const n = cf.length
      const m = cands.length
      const padL = 46
      const padT = 22
      const gridH = h - padT - 96
      const cw = (w - padL - 14) / n
      const ch = gridH / m
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      if (x < padL || y < padT || y > padT + gridH) return null
      const i = Math.floor((x - padL) / cw)
      const c = m - 1 - Math.floor((y - padT) / ch)
      if (i < 0 || i >= n || c < 0 || c >= m) return null
      return { i, c }
    }

    const onMove = (e: PointerEvent) => {
      const cell = cellAt(e)
      hover = cell ?? { i: -1, c: -1 }
    }

    const onDown = (e: PointerEvent) => {
      const cell = cellAt(e)
      if (!cell) return
      const { i, c } = cell
      if (fixed[i] === c) {
        fixed[i] = -1
        solve()
        return
      }
      // Only offer notes that some complete counterpoint actually uses. This is
      // the whole promise of the thing: you cannot paint yourself into a corner.
      if (!space || space.marg[i][c] <= 0) {
        ctx.status(`${noteName(cands[c])} there leads to no legal ending`)
        return
      }
      const before = fixed[i]
      fixed[i] = c
      const s = new Space(cf, cands, fixed, rules(), Math.round(ctx.params.reach))
      if (s.total <= 0) {
        fixed[i] = before
        ctx.status('that would leave nothing legal')
        return
      }
      space = s
      draw = s.sample(r)
      lastMsg = ''
    }

    g.canvas.addEventListener('pointerdown', onDown)
    g.canvas.addEventListener('pointermove', onMove)

    // A read-only snapshot for the verification harness. The sketch never
    // reads it; it exists so a test can ask what was *meant* to sound and
    // compare that against what a spectrum analyser actually hears, which is
    // the only way to know whether the listening is any good.
    const w = window as unknown as Record<string, unknown>
    w.__species = () => {
      const now = ctx.audio.currentTime
      const live = spans.filter((s) => s.t <= now && now < s.end).pop() ?? null
      return {
        cf: cf.slice(),
        cands: cands.slice(),
        sounding: sounding ? sounding.map((c) => cands[c]) : null,
        fixed: fixed.slice(),
        total: space?.total ?? 0,
        live,
      }
    }
    ctx.cleanup(() => delete w.__species)

    ctx.status('start the transport · each pass is a fair draw from what is still legal')
  },
})
