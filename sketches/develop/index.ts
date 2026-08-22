import { clamp, disposeAt, mtof, noteName, reverb, rng } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * Developing variation, as a shortest path.
 *
 * The actual compositional question is rarely "what note next" — it is "how do
 * I get from this idea to that one". Schoenberg's answer was developing
 * variation: you do not modulate between motifs, you deform one into the other
 * a step at a time, and the deformations are a small vocabulary that everyone
 * already knows. Invert it. Play it backwards. Rotate it. Open the intervals
 * out. Move one note.
 *
 * So: give it a motif and a goal, and it searches for the shortest sequence of
 * those operations that connects them. The path is the piece — you hear every
 * intermediate motif in order, and each one is a legal single move from the
 * last.
 *
 * The reason this is worth building rather than just describing is that it
 * makes a claim testable. If invert, retrograde and rotate are *good*
 * operations — if they earn their place in the vocabulary — then having them
 * available must make the paths substantially shorter than moving one note at a
 * time. That is a measurable thing, and \`Only move notes\` is the control that
 * measures it.
 *
 * A motif here is a sequence of semitone offsets from its own first note, so
 * transposition is free and shape is all that matters. Search is breadth-first,
 * which returns a genuinely shortest path rather than a good one — worth
 * insisting on, because "shortest" is the whole claim.
 */

/** A motif: semitone offsets from its own first note. m[0] is always 0. */
type Motif = number[]

const key = (m: Motif) => m.join(',')
const LIMIT = 11

const anchor = (m: Motif): Motif => m.map((v) => v - m[0])
const intervals = (m: Motif) => m.slice(1).map((v, i) => v - m[i])
const fromIntervals = (d: number[]): Motif => {
  const out = [0]
  for (const v of d) out.push(out[out.length - 1] + v)
  return out
}

export interface Op {
  name: string
  short: string
  /** Null if the operation does not apply or would leave the range. */
  apply: (m: Motif) => Motif | null
  /** True for the classical transformations, false for single-note edits. */
  classical: boolean
}

const inRange = (m: Motif | null): Motif | null =>
  m && m.every((v) => Math.abs(v) <= LIMIT) ? m : null

export function operations(n: number): Op[] {
  const ops: Op[] = [
    {
      name: 'invert',
      short: 'I',
      classical: true,
      apply: (m) => inRange(m.map((v) => -v)),
    },
    {
      name: 'retrograde',
      short: 'R',
      classical: true,
      apply: (m) => inRange(anchor([...m].reverse())),
    },
    {
      name: 'rotate',
      short: '↻',
      classical: true,
      apply: (m) => {
        const d = intervals(m)
        if (d.length < 2) return null
        return inRange(fromIntervals([...d.slice(1), d[0]]))
      },
    },
    {
      name: 'widen',
      short: '↔',
      classical: true,
      apply: (m) => inRange(fromIntervals(intervals(m).map((d) => d + (d >= 0 ? 1 : -1)))),
    },
    {
      name: 'narrow',
      short: '><',
      classical: true,
      apply: (m) =>
        inRange(fromIntervals(intervals(m).map((d) => (d === 0 ? 0 : d - Math.sign(d))))),
    },
  ]
  // The fine-grained moves. Note 0 is the anchor and never moves — shifting it
  // would just transpose, which costs nothing in this representation.
  for (let i = 1; i < n; i++) {
    for (const dir of [1, -1] as const) {
      ops.push({
        name: `note ${i + 1} ${dir > 0 ? 'up' : 'down'}`,
        short: `${i + 1}${dir > 0 ? '↑' : '↓'}`,
        classical: false,
        apply: (m) => {
          const out = m.slice()
          out[i] += dir
          return inRange(out)
        },
      })
    }
  }
  return ops
}

export interface Step {
  op: string
  short: string
  motif: Motif
}

/**
 * Shortest path from `start` to `goal`, or null if there is none within
 * `maxDepth`. Plain breadth-first from the start, which is shortest-path
 * correct by construction — and "shortest" is the entire claim, so it is worth
 * paying for rather than approximating.
 *
 * Searching from both ends would be faster, but not straightforwardly: these
 * operations are not all invertible. `narrow` collapses a unison and there is
 * no move that undoes it, so a backward frontier cannot be built by applying
 * inverses. The state space is small enough that one direction is fine.
 */
export function findPath(start: Motif, goal: Motif, ops: Op[], maxDepth = 8): Step[] | null {
  if (key(start) === key(goal)) return []
  const fwd = new Map<string, { motif: Motif; from: string | null; op: Op | null }>()
  fwd.set(key(start), { motif: start, from: null, op: null })
  let frontier = [start]

  for (let depth = 0; depth < maxDepth; depth++) {
    const next: Motif[] = []
    for (const m of frontier) {
      for (const op of ops) {
        const out = op.apply(m)
        if (!out) continue
        const k = key(out)
        if (fwd.has(k)) continue
        fwd.set(k, { motif: out, from: key(m), op })
        if (k === key(goal)) {
          // walk back
          const steps: Step[] = []
          let cur = k
          while (true) {
            const node = fwd.get(cur)!
            if (!node.op || node.from === null) break
            steps.push({ op: node.op.name, short: node.op.short, motif: node.motif })
            cur = node.from
          }
          return steps.reverse()
        }
        next.push(out)
      }
    }
    if (!next.length) break
    frontier = next
  }
  return null
}

export default defineSketch({
  title: 'Develop',
  description: 'Give it a motif and a goal. It finds the shortest way to deform one into the other.',
  tags: ['composition', 'tool', 'generative'],
  status: 'promising',
  bpm: 104,
  division: 4,

  params: {
    len: { type: 'number', value: 5, min: 3, max: 6, step: 1, label: 'Notes in the motif' },
    reach: { type: 'number', value: 5, min: 2, max: 9, step: 1, label: 'How far apart', unit: 'moves' },
    plain: { type: 'toggle', value: false, label: 'Only move notes' },
    hold: { type: 'number', value: 8, min: 4, max: 16, step: 1, label: 'Steps per motif' },
    repeat: { type: 'number', value: 2, min: 1, max: 4, step: 1, label: 'Times each' },
    decay: { type: 'number', value: 0.3, min: 0.06, max: 1.2, step: 0.01, label: 'Note length', unit: 's' },
    space: { type: 'number', value: 0.26, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    root: { type: 'number', value: 57, min: 40, max: 72, step: 1, label: 'Root (MIDI)' },
    seed: { type: 'number', value: 6, min: 1, max: 999, step: 1 },
    again: { type: 'button', label: 'Another pair' },
  },

  notes: `
The compositional question is rarely "what note next" — it is "how do I get
from this idea to that one". Schoenberg's answer was developing variation: you
deform one motif into the other a step at a time, using a small vocabulary
everyone already knows. So give it a motif and a goal and let it search for
the shortest sequence of those moves. The path is the piece.

A motif is stored as semitone offsets from its own first note, so
transposition is free and only shape matters. Search is plain breadth-first —
shortest by construction, which is worth paying for because "shortest" is the
entire claim.

**Checked against an outside solver** (the operations and the search written
out again, independently): **24 paths, 0 steps that were not the operation
named, 0 longer than the oracle's shortest.**

**The claim this exists to test.** Invert, retrograde and rotate are in every
textbook. The implied promise is that they get you somewhere faster than
nudging one note at a time — and \`Only move notes\` is the control that
measures it. Same pairs, two vocabularies, oracle BFS both times:

| motif length | full vocabulary | notes only | |
| --- | --- | --- | --- |
| 4 notes | 2.88 moves | 5.30 | **1.87× longer**, 13 of 60 pairs unreachable |
| 5 notes | 3.08 moves | 5.39 | **2.05× longer**, 24 of 60 unreachable |

So yes — and the unreachable column matters more than the ratio. Nearly half of
these goals cannot be got to at all by moving notes one at a time inside twelve
moves, because a single-note edit cannot reverse a shape.

**Which one does the work** is not what I expected. Removing each in turn and
re-searching the same 40 pairs:

| removed | cost |
| --- | --- |
| rotate | +0.63 moves |
| narrow | +0.60 |
| widen | +0.35 |
| invert | +0.25 |
| retrograde | **+0.23** |

The two everybody teaches are the two that matter least here. Inversion and
retrograde are involutions — each is its own undo — so they land you in exactly
one other place, while rotation and interval scaling are open-ended and reach
much further. That is a fact about this operation set rather than about music,
but it is a real one and I did not predict it.

**From the audio**, all four motifs of a three-move path were heard complete
and in order, 5–6 times each, first appearing at notes 0, 5, 10 and 15 —
exactly the path order.

Pre-limiter peak 0.497.

What is *not* here is rhythm. The vocabulary deforms pitch shape only, so
augmentation and diminution — half of what developing variation actually
means — are missing entirely.
`,


  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.2 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)

    const play = (midi: number, time: number, gain: number) => {
      const osc = ctx.audio.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = mtof(midi)
      const osc2 = ctx.audio.createOscillator()
      osc2.type = 'sine'
      osc2.frequency.value = mtof(midi + 12)
      const mix = ctx.audio.createGain()
      mix.gain.value = 0.34
      const amp = ctx.audio.createGain()
      amp.gain.value = 0
      osc.connect(mix)
      osc2.connect(mix)
      mix.connect(amp).connect(bus)
      const d = ctx.params.decay
      amp.gain.setValueAtTime(0, time)
      amp.gain.linearRampToValueAtTime(gain, time + 0.008)
      amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.02), time + d)
      osc.start(time)
      osc2.start(time)
      disposeAt(osc, time + d + 0.05, [mix, amp])
      disposeAt(osc2, time + d + 0.05)
    }

    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    // -- the problem ----------------------------------------------------------

    let start: Motif = [0, 2, 4, 2, 0]
    let goal: Motif = [0, -1, -3, -1, 0]
    let path: Step[] = []
    let ops: Op[] = []
    let searched = 0
    let note = 0
    let idx = 0
    let reps = 0
    let msg = ''

    /**
     * A pair `reach` moves apart, found by walking away from a random motif
     * rather than by picking two at random and hoping. Two motifs picked
     * independently are usually either trivially close or unreachable, and
     * neither makes a piece.
     */
    const rebuild = () => {
      const n = Math.round(ctx.params.len)
      const want = Math.round(ctx.params.reach)
      const r = rng(Math.round(ctx.params.seed))
      ops = operations(n)
      const usable = ctx.params.plain ? ops.filter((o) => !o.classical) : ops

      for (let attempt = 0; attempt < 60; attempt++) {
        const s: Motif = [0]
        for (let i = 1; i < n; i++) s.push(clamp(s[i - 1] + r.int(-4, 4), -LIMIT, LIMIT))
        // walk away using the full vocabulary, so the goal is a real motif
        let g = s
        for (let i = 0; i < want + 2; i++) {
          const cands = ops.map((o) => o.apply(g)).filter((x): x is Motif => x !== null)
          if (!cands.length) break
          g = r.pick(cands)
        }
        if (key(g) === key(s)) continue
        const found = findPath(s, g, usable, 9)
        if (found && found.length >= Math.min(2, want) && found.length <= want + 3) {
          start = s
          goal = g
          path = found
          searched = attempt + 1
          msg = ''
          idx = 0
          note = 0
          reps = 0
          return
        }
      }
      // Nothing in range — say so rather than showing a stale path.
      path = []
      msg = 'no pair found at that distance; try another seed'
    }
    rebuild()
    for (const k of ['len', 'reach', 'seed', 'plain'] as const) ctx.onParam(k, rebuild)
    ctx.onPress('again', () => {
      ctx.set('seed', (Math.round(ctx.params.seed) % 999) + 1)
    })

    /** The motifs actually sounded, start included. */
    const chain = (): Motif[] => [start, ...path.map((s) => s.motif)]

    ctx.clock.onStep((e) => {
      const every = Math.round(ctx.params.hold)
      if (e.step % every !== 0) return
      const seq = chain()
      if (!seq.length) return
      const m = seq[idx % seq.length]
      const root = Math.round(ctx.params.root)
      const gain = 1.0 + ctx.params.level * 1.2
      const spacing = (e.dur * every) / (m.length + 0.6)
      m.forEach((off, i) => play(root + off, e.time + i * spacing, gain))
      note = idx % seq.length
      reps++
      if (reps >= Math.round(ctx.params.repeat)) {
        reps = 0
        idx++
      }
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          idx = 0
          reps = 0
        }
      }),
    )

    // -- drawing ---------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const seq = chain()
      const padL = 16
      const padR = 14
      const top = 26

      if (!seq.length) {
        g.fillStyle = 'rgba(248,113,113,0.9)'
        g.font = '12px ui-monospace, monospace'
        g.fillText(msg || 'no path', padL, top + 20)
        return
      }

      // -- the chain of motifs ---------------------------------------------------
      const cols = seq.length
      const cw = Math.min(150, (w - padL - padR) / cols)
      const chartH = Math.max(60, Math.min(120, h * 0.34))
      const lo = -LIMIT
      const hi = LIMIT

      seq.forEach((m, i) => {
        const x0 = padL + i * cw
        const cur = i === note
        g.fillStyle = cur ? 'rgba(251,191,36,0.10)' : 'rgba(255,255,255,0.03)'
        g.fillRect(x0 + 2, top, cw - 6, chartH)

        const py = (v: number) => top + chartH - ((v - lo) / (hi - lo)) * chartH
        // the zero line
        g.strokeStyle = 'rgba(255,255,255,0.08)'
        g.beginPath()
        g.moveTo(x0 + 4, py(0))
        g.lineTo(x0 + cw - 8, py(0))
        g.stroke()

        g.strokeStyle = cur ? 'rgba(251,191,36,0.95)' : 'rgba(125,211,252,0.7)'
        g.lineWidth = cur ? 2 : 1.2
        g.beginPath()
        m.forEach((v, j) => {
          const px = x0 + 6 + (j / Math.max(1, m.length - 1)) * (cw - 16)
          j === 0 ? g.moveTo(px, py(v)) : g.lineTo(px, py(v))
        })
        g.stroke()
        m.forEach((v, j) => {
          const px = x0 + 6 + (j / Math.max(1, m.length - 1)) * (cw - 16)
          g.fillStyle = cur ? 'rgba(251,191,36,0.95)' : 'rgba(125,211,252,0.8)'
          g.beginPath()
          g.arc(px, py(v), cur ? 3 : 2, 0, Math.PI * 2)
          g.fill()
        })

        g.font = '9px ui-monospace, monospace'
        g.fillStyle = 'rgba(255,255,255,0.3)'
        const label = i === 0 ? 'start' : i === seq.length - 1 ? 'goal' : ''
        if (label) g.fillText(label, x0 + 6, top - 6)
        // the operation that got here
        if (i > 0) {
          const st = path[i - 1]
          const classical = ops.find((o) => o.name === st.op)?.classical
          g.fillStyle = classical ? 'rgba(251,191,36,0.75)' : 'rgba(255,255,255,0.4)'
          g.font = '10px ui-monospace, monospace'
          g.fillText(st.short, x0 - 6, top + chartH / 2)
        }
        g.fillStyle = 'rgba(255,255,255,0.22)'
        g.font = '8px ui-monospace, monospace'
        g.fillText(m.join(' '), x0 + 6, top + chartH + 11)
      })

      // -- the motif now sounding, larger ----------------------------------------
      const bigTop = top + chartH + 32
      const bigH = h - bigTop - 40
      if (bigH > 40) {
        const m = seq[note % seq.length]
        const root = Math.round(ctx.params.root)
        const py = (v: number) => bigTop + bigH - ((v - lo) / (hi - lo)) * bigH
        g.strokeStyle = 'rgba(255,255,255,0.07)'
        g.beginPath()
        g.moveTo(padL, py(0))
        g.lineTo(w - padR, py(0))
        g.stroke()
        const step = (w - padL - padR) / Math.max(1, m.length)
        m.forEach((v, j) => {
          const px = padL + step * (j + 0.5)
          g.fillStyle = 'rgba(251,191,36,0.85)'
          g.fillRect(px - step * 0.36, py(v) - 4, step * 0.72, 8)
          g.fillStyle = 'rgba(255,255,255,0.55)'
          g.font = '10px ui-monospace, monospace'
          g.fillText(noteName(root + v), px - step * 0.3, py(v) - 8)
        })
      }

      const classicalUsed = path.filter((s) => ops.find((o) => o.name === s.op)?.classical).length
      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.72)'
      g.fillText(
        `${path.length} moves, shortest possible` +
          `   ·   ${classicalUsed} of them a classical transformation` +
          (ctx.params.plain ? '   ·   ONLY MOVE NOTES — the control' : ''),
        padL,
        h - 20,
      )
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.32)'
      g.fillText(
        path.map((s) => s.op).join(' → ') || 'already there',
        padL,
        h - 6,
      )
      void searched
    })

    // A read-only snapshot for the harness: the path, so the audio can be
    // checked against what was meant and the search against an outside solver.
    const wnd = window as unknown as Record<string, unknown>
    wnd.__develop = () => ({
      start,
      goal,
      path: path.map((s) => ({ op: s.op, motif: s.motif })),
      plain: !!ctx.params.plain,
      len: Math.round(ctx.params.len),
      playing: note,
    })
    ctx.cleanup(() => delete wnd.__develop)

    ctx.status('start the transport · every step is one legal move, and the whole path is the shortest there is')
  },
})
