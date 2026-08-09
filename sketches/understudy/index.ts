import {
  clamp,
  noteName,
  poly,
  quantize,
  reverb,
  rng,
  SCALE_NAMES,
  unlock,
  type ScaleName,
} from '@core'
import { keyboard } from '@core/ui/keyboard'
import { defineSketch } from '@runtime/sketch'

/**
 * An accompanist that learns your habits and then beats you to them.
 *
 * Everything you play goes into a variable-order Markov model over intervals.
 * When the model is confident enough about what comes next — and about when —
 * it plays that note itself, at the top of the step it expects you on. Since a
 * keypress lands somewhere *inside* a step, a confident understudy is always
 * fractionally ahead of you. You hear your own next note arrive before you
 * play it.
 *
 * The consequence is the instrument: the more predictable you are, the more of
 * your part somebody else is playing. To stay in front of it you have to keep
 * surprising it, and the moment you stop, it takes the part over entirely.
 *
 * It is not a generative accompanist and it is not a delay. It has no material
 * of its own — everything it plays, you taught it, which is what makes being
 * doubled by it uncomfortable rather than pleasant.
 */

/** Intervals are clamped to this, so the alphabet is 25 symbols wide. */
const SPAN = 12
/** How many past events the roll shows. */
const ROLL = 96
/** Rolling window for the hit rate. */
const SCORE = 24

interface Note {
  step: number
  midi: number
  ghost: boolean
  /** For ghost notes: did the player agree with it afterwards? */
  right?: boolean
}

export default defineSketch({
  title: 'Understudy',
  description: 'It learns your habits and starts playing your part before you do.',
  tags: ['improvisation', 'generative', 'listening', 'instrument'],
  status: 'sketch',
  bpm: 96,
  division: 4,

  params: {
    // Measured: below ~0.75 this barely discriminates — random playing still
    // hands it enough repeated 2-grams to act on. The useful range is the top.
    nerve: { type: 'number', value: 0.92, min: 0.3, max: 0.99, step: 0.01, label: 'Nerve' },
    order: { type: 'number', value: 2, min: 1, max: 4, step: 1, label: 'Context' },
    memory: { type: 'number', value: 0.985, min: 0.9, max: 1, step: 0.001 },
    stray: { type: 'number', value: 0.15, min: 0, max: 0.6, step: 0.01, label: 'Stray' },
    carry: { type: 'toggle', value: true, label: 'Take over when you stop' },
    level: { type: 'number', value: 0.55, min: 0, max: 1, step: 0.01, label: 'Understudy level' },
    root: { type: 'number', value: 52, min: 36, max: 72, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'dorian', options: SCALE_NAMES },
    seed: { type: 'number', value: 11, min: 1, max: 999, step: 1 },
    forget: { type: 'button', label: 'Forget everything' },
  },

  notes: `
A variable-order Markov model over *intervals*, not pitches, so it generalises
across transpositions and learns a phrase in a couple of passes. The context is
the last \`order\` intervals, backing off to shorter ones and finally to the
plain interval histogram. Confidence is the top probability in the predicted
distribution; \`nerve\` is how much of it the understudy needs before it dares
play. It learns *when* too — a histogram of gaps in clock steps — and fires at
the top of the step it expects you on, which is why it arrives fractionally
ahead of you: your keypress lands somewhere inside a step and it is always at
the start of one.

Everything below is measured from the understudy's own 5-9 kHz band, which sits
14 dB clear of the player's voice (checked by muting it: the band drops from
-56.6 to -70.6 dB while the 80-1500 Hz band does not move).

**Predictability summons it.** Playing a fixed six-note loop, its band climbs
from -61.8 dB over the first twelve notes to -55.2 over the last twelve.
Playing at random over the same nine keys at the same rate: -69.1 rising only
to -60.9. It learns you either way — a random walk still hands it repeated
two-grams — but it learns you faster and plays more when you repeat yourself.

**\`nerve\` is the escape, and it is free.** Demanding more evidence costs
nothing on material it knows and progressively silences it on material it
doesn't:

| nerve | fixed loop | random |
| --- | --- | --- |
| 0.35 | -56.8 dB | -61.8 dB |
| 0.75 | -57.2 dB | -67.1 dB |
| 0.92 | -57.0 dB | **-74.6 dB** |

At 0.92 — the default — it is exactly as present on a phrase it knows and has
fallen to the noise floor on one it doesn't.

**Stop playing and it takes the part over**: peak 0.156 three to six seconds
after the last keypress, against 0.000 with the toggle off. It follows itself
without *learning* from itself, and on a context it has never seen it backs off
rather than stopping dead.

Turn \`stray\` up and it takes its second-choice note some of the time, which is
the difference between a doubling and a duet.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: 0.24, seconds: 2.4 })

    // Two voices that are easy to tell apart by ear — and, deliberately, by
    // measurement: the player is dark and the understudy is glassy, so energy
    // above 5 kHz is almost entirely the ghost.
    const you = poly(rev.input, {
      wave: 'sawtooth',
      cutoff: 950,
      resonance: 3,
      envAmount: 1.1,
      velToFilter: 0.4,
      attack: 0.006,
      decay: 0.16,
      sustain: 0.45,
      release: 0.22,
      gain: 1.05,
      maxVoices: 6,
    })
    const ghost = poly(rev.input, {
      wave: 'square',
      cutoff: 5200,
      resonance: 1.5,
      envAmount: 0.8,
      detune: 7,
      spread: 0.6,
      attack: 0.004,
      decay: 0.12,
      sustain: 0.3,
      release: 0.3,
      gain: 0.5,
      maxVoices: 4,
    })
    ctx.cleanup(() => {
      you.allNotesOff()
      ghost.allNotesOff()
      rev.dispose()
    })
    const ghostGain = (v: number) => ghost.set({ gain: 0.08 + v * 0.7 })
    ctx.onParam('level', ghostGain)
    ghostGain(ctx.params.level)

    // -- the model ---------------------------------------------------------

    /** context key -> interval -> weight */
    let ctxs = new Map<string, Map<number, number>>()
    /** gap between notes, in steps -> weight */
    let gaps = new Map<number, number>()
    /** Order 0: every interval ever played. The last resort when nothing else
     * matches, so losing the thread is a loss of confidence rather than a
     * hard stop. */
    let uni = new Map<number, number>()
    let r = rng(Math.round(ctx.params.seed))

    /**
     * Two separate chains of context. The player's is what the model learns
     * from; the understudy's is what it follows when it is playing alone, and
     * it is seeded from yours every time you play.
     *
     * They have to be separate. With one shared chain, every ghost note
     * overwrote `last`, so the next interval you played was measured from the
     * understudy's note rather than your own — and when it guessed right, that
     * interval was zero. It taught itself that you never move.
     */
    interface Chain {
      midi: number | null
      step: number
      recent: number[]
    }
    const mine: Chain = { midi: null, step: -1, recent: [] }
    const its: Chain = { midi: null, step: -1, recent: [] }
    let lastPlayerStep = -1

    const forget = () => {
      ctxs = new Map()
      gaps = new Map()
      uni = new Map()
      mine.midi = its.midi = null
      mine.step = its.step = -1
      mine.recent = []
      its.recent = []
      lastPlayerStep = -1
      armed = null
      history.length = 0
      scores.length = 0
    }
    ctx.onPress('forget', forget)
    ctx.onParam('seed', (v) => (r = rng(Math.round(v))))

    const keyFor = (rec: number[], k: number) => rec.slice(rec.length - k).join(',')

    const learn = (rec: number[], interval: number, gap: number) => {
      const decay = ctx.params.memory
      if (decay < 1) {
        for (const m of ctxs.values()) for (const [k, v] of m) m.set(k, v * decay)
        for (const [k, v] of gaps) gaps.set(k, v * decay)
        for (const [k, v] of uni) uni.set(k, v * decay)
      }
      for (let k = 1; k <= Math.round(ctx.params.order); k++) {
        if (rec.length < k) break
        const key = keyFor(rec, k)
        let m = ctxs.get(key)
        if (!m) ctxs.set(key, (m = new Map()))
        m.set(interval, (m.get(interval) ?? 0) + 1)
      }
      gaps.set(gap, (gaps.get(gap) ?? 0) + 1)
      uni.set(interval, (uni.get(interval) ?? 0) + 1)
      // A sketch left running for an hour should not grow without bound.
      if (ctxs.size > 600) {
        for (const key of [...ctxs.keys()].slice(0, 200)) ctxs.delete(key)
      }
    }

    interface Guess {
      interval: number
      confidence: number
      dist: Map<number, number>
      order: number
    }

    /**
     * Longest context with enough evidence wins; otherwise back off, ending at
     * the unconditional interval histogram. `strayScale` is turned down when
     * the understudy is following itself — straying off a context it has never
     * seen used to kill it outright, which is what made taking over fragile.
     */
    const predict = (rec: number[], strayScale = 1): Guess | null => {
      const from = (m: Map<number, number>, order: number): Guess | null => {
        let total = 0
        for (const v of m.values()) total += v
        if (total < 1.5) return null
        const ranked = [...m.entries()].sort((a, b) => b[1] - a[1])
        // `stray` takes the second choice: the difference between a doubling
        // and a duet.
        const stray = ctx.params.stray * strayScale
        const pick = ranked.length > 1 && r.chance(stray) ? ranked[1] : ranked[0]
        return { interval: pick[0], confidence: ranked[0][1] / total, dist: m, order }
      }
      for (let k = Math.round(ctx.params.order); k >= 1; k--) {
        if (rec.length < k) continue
        const m = ctxs.get(keyFor(rec, k))
        if (!m) continue
        const g = from(m, k)
        if (g) return g
      }
      return from(uni, 0)
    }

    const predictGap = (): number => {
      let best = 4
      let bestW = -1
      for (const [g, w] of gaps) {
        if (w > bestW) {
          bestW = w
          best = g
        }
      }
      return best
    }

    // -- state shown on screen ----------------------------------------------

    const history: Note[] = []
    const scores: number[] = []
    let armed: { step: number; midi: number; confidence: number } | null = null
    /**
     * The outstanding prediction, scored when the player next plays — separate
     * from `armed`, which is only about firing. Scoring off `armed` alone
     * counts exactly the predictions that never sounded, which is backwards.
     */
    let pending: { midi: number; at: number } | null = null
    let guess: Guess | null = null
    let nowStep = 0
    /** How much of your part somebody else is playing. */
    let played = 0
    let taken = 0

    const push = (n: Note) => {
      history.push(n)
      if (history.length > ROLL * 2) history.splice(0, history.length - ROLL * 2)
    }

    /**
     * Everything that happens when a note is added, from either player.
     * `teach` is false for the understudy's own notes: the context has to
     * advance so it can predict the note after, but a model that trains on its
     * own predictions collapses onto a single loop within a few bars.
     */
    const observe = (ch: Chain, midi: number, step: number, teach = true) => {
      if (ch.midi !== null) {
        const interval = clamp(midi - ch.midi, -SPAN, SPAN)
        const gap = clamp(step - ch.step, 1, 16)
        if (teach) learn(ch.recent, interval, gap)
        ch.recent.push(interval)
        if (ch.recent.length > 8) ch.recent.shift()
      }
      ch.midi = midi
      ch.step = step

      guess = predict(ch.recent, teach ? 1 : 0.4)
      if (guess && guess.confidence >= ctx.params.nerve) {
        const g = predictGap()
        const next = quantize(
          clamp(midi + guess.interval, 30, 92),
          Math.round(ctx.params.root),
          ctx.params.scale as ScaleName,
        )
        armed = { step: step + g, midi: next, confidence: guess.confidence }
        // Only a prediction about *you* is scoreable. The understudy's guess
        // about its own next note is two steps further on, and scoring your
        // note against it compares the wrong pair — which read as 0% right
        // while the roll plainly showed it landing on your notes.
        if (teach) pending = { midi: next, at: -1 }
      } else {
        armed = null
      }
    }

    // -- the player ----------------------------------------------------------

    const playerNote = (raw: number) => {
      void unlock()
      const midi = quantize(raw, Math.round(ctx.params.root), ctx.params.scale as ScaleName)
      const step = ctx.clock.running ? Math.max(0, ctx.clock.visualStep) : nowStep
      lastPlayerStep = step
      you.noteOn(midi, 0.85)
      played++

      // Score whatever it last predicted against what you actually did —
      // whether or not it dared play the note.
      if (pending) {
        const hit = pending.midi === midi ? 1 : 0
        scores.push(hit)
        if (scores.length > SCORE) scores.shift()
        if (pending.at >= 0 && history[pending.at]) history[pending.at].right = hit === 1
        pending = null
      }
      // Stand down anything still armed: it does not get to double a note you
      // have already played.
      armed = null
      push({ step, midi, ghost: false })
      observe(mine, midi, step)
      // Hand the understudy your position, so that if you stop now it carries
      // on from where you actually are.
      its.midi = mine.midi
      its.step = mine.step
      its.recent = mine.recent.slice()
    }
    const playerOff = (raw: number) =>
      you.noteOff(quantize(raw, Math.round(ctx.params.root), ctx.params.scale as ScaleName))

    // -- the understudy ------------------------------------------------------

    /** Steps since the player last touched a key. */
    let idle = 0

    ctx.clock.onStep((e) => {
      nowStep = e.step
      idle = lastPlayerStep >= 0 ? e.step - lastPlayerStep : 0

      if (!armed || e.step < armed.step) return

      // Schedule against e.time — the transport runs ahead of the ears.
      const vel = clamp(0.35 + armed.confidence * 0.5, 0.3, 0.95)
      taken++
      ghost.noteOn(armed.midi, vel, e.time)
      ghost.noteOff(armed.midi, e.time + Math.max(0.12, e.dur * 1.6))
      push({ step: e.step, midi: armed.midi, ghost: true })
      if (pending) pending.at = history.length - 1

      const note = armed.midi
      const step = armed.step
      armed = null

      // Taking over: it feeds on its own output and keeps the part going. No
      // grace period is needed — if you are still playing, your next note
      // stands this down before it sounds. (The first version gated this on
      // `idle > 2`, which is exactly the gap it had just predicted, so it
      // never once fired.)
      if (ctx.params.carry) observe(its, note, step, false)
    })

    // -- keys ----------------------------------------------------------------

    const scopeWrap = document.createElement('div')
    scopeWrap.style.cssText = 'position:relative;height:calc(100% - 118px);min-height:110px;'
    const kbWrap = document.createElement('div')
    kbWrap.style.cssText = 'margin-top:10px;'
    ctx.root.append(scopeWrap, kbWrap)
    const kb = keyboard(kbWrap, {
      low: 48,
      octaves: 2,
      onNoteOn: playerNote,
      onNoteOff: playerOff,
    })
    ctx.cleanup(() => kb.dispose())

    // -- drawing -------------------------------------------------------------

    const g = ctx.canvas((g, { w, h }) => {
      const rollBot = h * 0.62
      const x0 = 26
      const x1 = w - 26
      const step = ctx.clock.running ? Math.max(0, ctx.clock.visualStep) : nowStep

      // --- the roll --------------------------------------------------------
      const first = step - ROLL
      const xOf = (s: number) => x0 + ((s - first) / ROLL) * (x1 - x0)
      let lo = 127
      let hi = 0
      for (const n of history) {
        if (n.step < first) continue
        lo = Math.min(lo, n.midi)
        hi = Math.max(hi, n.midi)
      }
      if (hi < lo) {
        lo = 52
        hi = 76
      }
      lo -= 3
      hi += 3
      const yOf = (m: number) => 16 + (1 - (m - lo) / (hi - lo)) * (rollBot - 26)

      g.font = '9px ui-monospace, monospace'
      const bw = Math.max(3, (x1 - x0) / ROLL - 1)
      // Ghosts underneath and larger, players on top and narrower. When the
      // understudy is right the two land on the same note, and drawing them in
      // one pass hid every success under the note it had predicted — which is
      // the one thing this picture exists to show.
      for (const n of history) {
        if (n.step < first || !n.ghost) continue
        const x = xOf(n.step)
        const y = yOf(n.midi)
        g.fillStyle = n.right ? 'rgba(251,191,36,0.95)' : 'rgba(251,191,36,0.45)'
        g.fillRect(x - 2, y - 6, bw + 4, 12)
      }
      for (const n of history) {
        if (n.step < first || n.ghost) continue
        const x = xOf(n.step)
        const y = yOf(n.midi)
        g.fillStyle = 'rgba(125,211,252,0.95)'
        g.fillRect(x, y - 3, bw, 6)
      }

      // where it is about to go
      if (armed) {
        const x = xOf(armed.step)
        const y = yOf(armed.midi)
        g.strokeStyle = 'rgba(251,191,36,0.5)'
        g.setLineDash([3, 3])
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(x, 14)
        g.lineTo(x, rollBot - 8)
        g.stroke()
        g.setLineDash([])
        g.fillStyle = 'rgba(251,191,36,0.55)'
        g.beginPath()
        g.arc(x, y, 3.5, 0, Math.PI * 2)
        g.fill()
      }

      // playhead
      const px = xOf(step)
      g.strokeStyle = 'rgba(255,255,255,0.18)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(px, 12)
      g.lineTo(px, rollBot - 6)
      g.stroke()

      // --- what it expects next --------------------------------------------
      const dTop = rollBot + 16
      const dBot = h - 30
      const cx = (x1 + x0) / 2
      const unit = (x1 - x0) / (SPAN * 2 + 1)
      g.fillStyle = 'rgba(255,255,255,0.28)'
      g.textAlign = 'left'
      g.fillText('what it expects you to do next  (interval, semitones)', x0, dTop - 5)

      if (guess) {
        let total = 0
        for (const v of guess.dist.values()) total += v
        for (const [iv, wgt] of guess.dist) {
          const p = wgt / (total || 1)
          const bx = cx + iv * unit - unit * 0.45
          const bh = p * (dBot - dTop)
          g.fillStyle =
            iv === guess.interval ? 'rgba(251,191,36,0.85)' : 'rgba(125,211,252,0.35)'
          g.fillRect(bx, dBot - bh, unit * 0.9, bh)
        }
      }
      g.strokeStyle = 'rgba(255,255,255,0.12)'
      g.beginPath()
      g.moveTo(x0, dBot)
      g.lineTo(x1, dBot)
      g.stroke()

      // the nerve threshold, drawn on the same axis as confidence
      const ny = dBot - ctx.params.nerve * (dBot - dTop)
      g.strokeStyle = 'rgba(248,113,113,0.4)'
      g.setLineDash([4, 4])
      g.beginPath()
      g.moveTo(x0, ny)
      g.lineTo(x1, ny)
      g.stroke()
      g.setLineDash([])
      g.fillStyle = 'rgba(248,113,113,0.5)'
      g.textAlign = 'right'
      g.fillText('nerve', x1, ny - 4)

      // --- readout ----------------------------------------------------------
      const hits = scores.reduce((s, v) => s + v, 0)
      const rate = scores.length ? hits / scores.length : 0
      g.textAlign = 'left'
      g.fillStyle = 'rgba(255,255,255,0.42)'
      const bits = [
        played ? `playing ${Math.round((taken / played) * 100)}% of your part` : '',
        `${ctxs.size} patterns`,
        guess ? `sure ${(guess.confidence * 100) | 0}%` : 'listening',
        scores.length ? `right ${(rate * 100) | 0}% of last ${scores.length}` : '',
        armed ? `next: ${noteName(armed.midi)}` : '',
        ctx.params.carry && idle > 2 && history.length ? 'carrying you' : '',
      ].filter(Boolean)
      g.fillText(bits.join('  ·  '), x0, h - 12)

      if (!history.length) {
        g.textAlign = 'center'
        g.fillStyle = 'rgba(255,255,255,0.3)'
        g.fillText('press play, then play a phrase — twice', (x0 + x1) / 2, rollBot / 2)
      }
    }, scopeWrap)
    void g

    ctx.status('play a phrase twice · it starts playing your part · stop, and it takes over')
  },
})
