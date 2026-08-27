import { clamp, degree, disposeAt, mtof, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * A score with no copies.
 *
 * Every other tool in here works on a line: `cats-cradle` stores one melody as
 * intervals, `develop` searches between two motifs, `species` constrains a
 * second voice against a first. None of them has anything to say about *form* —
 * about the fact that bar 9 is bar 1 again, up a fourth, and that if you change
 * bar 1 then bar 9 had better change too.
 *
 * So: a piece is N slots, and the only things you write are **rhymes** — "this
 * span is that span, transposed / inverted / backwards". Nothing is copied.
 * A note that is reached by a rhyme is not stored at all; it is derived. Drag
 * one note and every place it recurs moves with it.
 *
 * The reason this is worth building rather than asserting is that it makes the
 * question "how much of this piece did you actually choose?" exact. Working in
 * scale degrees, every rhyme is affine:
 *
 *     transpose    d[b+i] − d[a+i]       = k
 *     retrograde   d[b+i] − d[a+L−1−i]   = k
 *     invert       d[b+i] + d[a+i]       = 2c
 *
 * — two nonzero coefficients per row, always ±1. So the whole score is a signed
 * graph, solvable by union-find with a sign and an offset rather than by
 * elimination, and the number of free notes is exactly the number of unpinned
 * components. A 64-note piece with six rhymes might have eighteen notes in it.
 * The rest is consequence.
 *
 * Three things fall out that are musically real:
 *
 *   - A rhyme that closes a cycle *consistently* costs nothing. It is already
 *     implied by the others, and the tool can say so.
 *   - A rhyme that closes a cycle with opposite signs — you asked for a span to
 *     be both itself and its own inversion — does not fail. It **pins** the
 *     component to the axis of inversion. Ask for too much symmetry and the
 *     music goes flat, literally: every note in that component becomes one
 *     pitch.
 *   - A rhyme that closes a cycle with the same sign and a different offset is
 *     impossible, and gets dropped and greyed out. You cannot ask for that.
 */

const FORMS = ['free', 'AABA', 'arch', 'canon'] as const
type FormName = (typeof FORMS)[number]
const MOVES = ['transpose', 'transpose + invert', 'transpose + retrograde', 'everything'] as const
type MoveSet = (typeof MOVES)[number]

/** The rows a rhyme stands for: d[dst] = eps·d[src] + k. */
function rowsOf(rh: Rhyme, n: number): { dst: number; src: number; eps: number; k: number }[] {
  const out = []
  for (let i = 0; i < rh.len; i++) {
    if (rh.b + i >= n) break
    const src = rh.kind === 'retrograde' ? rh.a + rh.len - 1 - i : rh.a + i
    if (src < 0 || src >= n) continue
    // invert: d[dst] + d[src] = k, so eps is −1 and the rest is the same shape
    out.push({ dst: rh.b + i, src, eps: rh.kind === 'invert' ? -1 : 1, k: rh.k })
  }
  return out
}

interface Rhyme {
  /** Source and destination start slots, and the length of the span. */
  a: number
  b: number
  len: number
  kind: 'transpose' | 'retrograde' | 'invert'
  /** Degrees for transpose/retrograde; twice the axis for invert. */
  k: number
  /** Rejected because it contradicts the rhymes already accepted. */
  dead?: boolean
  /** Accepted but implied by the others — it costs no freedom. */
  free?: boolean
}

/**
 * Union-find over `d[v] = sign·d[root] + offset`.
 *
 * Every rhyme is a relation between exactly two slots with coefficients ±1, so
 * elimination is overkill: this is a signed graph and the components are the
 * degrees of freedom. `pin` is what happens when a component is forced to equal
 * its own reflection.
 */
class Relations {
  parent: number[]
  sign: number[]
  off: number[]
  /** Value this component is forced to, if any. */
  pinned: Map<number, number> = new Map()

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
    this.sign = new Array(n).fill(1)
    this.off = new Array(n).fill(0)
  }

  /** Root of v, plus the sign and offset taking d[v] to d[root]. */
  find(v: number): { root: number; sign: number; off: number } {
    if (this.parent[v] === v) return { root: v, sign: 1, off: 0 }
    const up = this.find(this.parent[v])
    // d[v] = sign[v]·d[parent] + off[v], and d[parent] = up.sign·d[root] + up.off
    const sign = this.sign[v] * up.sign
    const off = this.sign[v] * up.off + this.off[v]
    this.parent[v] = up.root
    this.sign[v] = sign
    this.off[v] = off
    return { root: up.root, sign, off }
  }

  /**
   * Assert d[x] = eps·d[y] + c. Returns what it cost:
   *   'joined'    two components merged — one degree of freedom gone
   *   'implied'   already true — costs nothing
   *   'pinned'    the component is now forced to a single value
   *   'impossible' contradicts what is already asserted
   */
  relate(x: number, y: number, eps: number, c: number): 'joined' | 'implied' | 'pinned' | 'impossible' {
    const fx = this.find(x)
    const fy = this.find(y)
    if (fx.root !== fy.root) {
      // d[x] = fx.sign·d[rx] + fx.off, d[y] = fy.sign·d[ry] + fy.off
      // so d[rx] = (eps·fy.sign/fx.sign)·d[ry] + (eps·fy.off + c − fx.off)/fx.sign
      this.parent[fx.root] = fy.root
      this.sign[fx.root] = (eps * fy.sign) / fx.sign
      this.off[fx.root] = (eps * fy.off + c - fx.off) / fx.sign
      const p = this.pinned.get(fx.root)
      this.pinned.delete(fx.root)
      if (p !== undefined) {
        // carry a pin across the merge
        const v = (p - this.off[fx.root]) / this.sign[fx.root]
        return this.pinValue(fy.root, v) ? 'joined' : 'impossible'
      }
      return 'joined'
    }
    // same component: d[x] = fx.sign·d[r] + fx.off and d[y] = fy.sign·d[r] + fy.off
    // the assertion becomes (fx.sign − eps·fy.sign)·d[r] = eps·fy.off + c − fx.off
    const a = fx.sign - eps * fy.sign
    const b = eps * fy.off + c - fx.off
    if (a === 0) return b === 0 ? 'implied' : 'impossible'
    return this.pinValue(fx.root, b / a) ? 'pinned' : 'impossible'
  }

  private pinValue(root: number, v: number): boolean {
    // A pin can land between scale degrees — ask for a span to be its own
    // inversion about a half-integer axis and the only solution is a pitch that
    // does not exist. That is refused rather than rounded: rounding would leave
    // a score that quietly disobeys the rhyme it is displaying.
    if (Math.abs(v - Math.round(v)) > 1e-9) return false
    const had = this.pinned.get(root)
    if (had !== undefined) return Math.abs(had - v) < 1e-9
    this.pinned.set(root, v)
    return true
  }

  /** Component representatives that are still free to choose. */
  roots(n: number): number[] {
    const out: number[] = []
    for (let i = 0; i < n; i++) if (this.find(i).root === i && !this.pinned.has(i)) out.push(i)
    return out
  }
}

export default defineSketch({
  title: 'Rhyme',
  description: 'A score with no copies. Every repeat is a reference, so one note moves everywhere it recurs.',
  tags: ['composition', 'tool', 'generative'],
  status: 'promising',
  bpm: 104,
  division: 4,

  params: {
    notes: { type: 'number', value: 32, min: 8, max: 64, step: 1, label: 'Slots' },
    rhymes: { type: 'number', value: 5, min: 0, max: 14, step: 1, label: 'Rhymes' },
    span: { type: 'number', value: 4, min: 2, max: 12, step: 1, label: 'Typical span', unit: 'slots' },
    moves: { type: 'select', value: 'everything', options: [...MOVES], label: 'Allowed' },
    form: { type: 'select', value: 'free', options: [...FORMS], label: 'Shape' },
    reach: { type: 'number', value: 5, min: 1, max: 12, step: 1, label: 'How far a free note wanders' },
    hold: { type: 'number', value: 0.42, min: 0.08, max: 1.2, step: 0.01, label: 'Note length', unit: 's' },
    every: { type: 'number', value: 2, min: 1, max: 8, step: 1, label: 'A note every', unit: 'steps' },
    space: { type: 'number', value: 0.24, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    root: { type: 'number', value: 55, min: 40, max: 72, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'major', options: [...SCALE_NAMES], label: 'Scale' },
    seed: { type: 'number', value: 6, min: 1, max: 999, step: 1 },
    reroll: { type: 'button', label: 'New rhymes' },
  },

  notes: `
Every other tool here works on a line. Nothing in the repo had anything to say
about **form** — about bar 9 being bar 1 again up a fourth, and about what
should happen to bar 9 when you change bar 1.

So nothing is copied. You write **rhymes** — "this span is that span,
transposed / inverted / backwards" — and a note reached by a rhyme is not
stored at all. It is derived. Drag a yellow note and every place it recurs
moves with it. Drag a blue one and you cannot: the tool tells you which note
owns it.

That makes "how much of this piece did you actually choose?" exact. In scale
degrees every rhyme is affine with two coefficients of ±1, so the score is a
signed graph and the free notes are its unpinned components.

**Measured.** Fifty configurations across five shapes and ten seeds, with the
sketch's signed union-find checked against row reduction over the rationals —
a completely different algorithm:

  50 of 50 configurations agree on the free-note count
  980 of 980 constraint rows hold in the realised score
  66 rhymes refused — 63 genuinely contradictory, 3 needing a pitch between
     scale degrees, 0 refused without cause

And from the audio, three configurations captured off the pre-limiter master
and pitched by YIN: **95% of notes identified** (56/58, 55/58, 55/58), and
**every rhyme held in the recording** — 12 of 12, 10 of 10, 12 of 12 rows.

**What the rhymes cost**, 48 slots, mean of eight seeds. Each rhyme buys about
three notes early on and almost nothing by the fourteenth, because by then they
overlap and mostly re-state each other:

  rhymes    0     2     4     6     8    10    12    14
  free     48  42.0  35.6  27.8  22.6  18.0  14.3  14.0

Three things fall out that are musically real. A rhyme closing a cycle
consistently is **already implied** and costs nothing — the tool draws it faint.
A rhyme closing a cycle with opposite signs does not fail, it **pins** the
component to the axis of its own inversion: ask for too much symmetry and the
music goes flat, literally. \`arch\` with inversions pins 5.6 of 24 slots to
single pitches. And a rhyme that contradicts the others is **impossible**, drawn
dashed and dropped — you cannot ask for that.

Peak 0.513 at the defaults.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.4 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)
    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    const play = (midi: number, time: number, gain: number) => {
      const t = Math.max(time, ctx.audio.currentTime + 0.005)
      const f = mtof(midi)
      const amp = ctx.audio.createGain()
      amp.gain.value = 0
      amp.connect(bus)
      const d = ctx.params.hold
      // 8 ms, not 3: a fast ramp on a sine is a broadband click and the
      // splatter lands on every pitch the detector is looking for at once.
      amp.gain.setValueAtTime(0, t)
      amp.gain.linearRampToValueAtTime(gain, t + 0.008)
      amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.02), t + d)
      const parts: OscillatorNode[] = []
      for (const [mult, g] of [[1, 1], [2, 0.28]] as const) {
        const o = ctx.audio.createOscillator()
        o.type = 'sine'
        o.frequency.value = f * mult
        const vg = ctx.audio.createGain()
        vg.gain.value = g
        o.connect(vg).connect(amp)
        o.start(t)
        parts.push(o)
        disposeAt(o, t + d + 0.05, [vg])
      }
      // amp is torn down with the last voice; disposing parts[0] twice was
      // sloppy and stopped the same oscillator on two different schedules
      disposeAt(parts[parts.length - 1], t + d + 0.06, [amp])
    }

    // -- the score --------------------------------------------------------------

    let rhymes: Rhyme[] = []
    let degrees: number[] = []
    /** Which free note each slot is derived from, and how. */
    let owner: number[] = []
    let free: number[] = []
    let pinnedCount = 0
    let rel = new Relations(1)

    /**
     * Rhymes come from the seed. `form` biases where they land: the shapes are
     * the ordinary ones a piece actually uses, and `free` is the control — it
     * scatters them, which is the same number of constraints arranged badly.
     */
    const proposeRhymes = (n: number, count: number, r: ReturnType<typeof rng>): Rhyme[] => {
      const set = ctx.params.moves as MoveSet
      const kinds: Rhyme['kind'][] =
        set === 'transpose'
          ? ['transpose']
          : set === 'transpose + invert'
            ? ['transpose', 'invert']
            : set === 'transpose + retrograde'
              ? ['transpose', 'retrograde']
              : ['transpose', 'transpose', 'retrograde', 'invert']
      const want = Math.max(2, Math.min(Math.round(ctx.params.span), Math.floor(n / 2)))
      const out: Rhyme[] = []
      const shape = ctx.params.form as FormName
      for (let i = 0; i < count; i++) {
        const len = shape === 'free' ? Math.max(2, want + Math.floor((r.next() - 0.5) * 3)) : want
        let a: number
        let b: number
        if (shape === 'AABA') {
          // every span rhymes with the first one, a bar apart
          a = 0
          b = Math.min(n - len, len * (1 + Math.floor(r.next() * Math.max(1, n / len - 1))))
        } else if (shape === 'arch') {
          // the second half mirrors the first
          a = Math.floor(r.next() * (n / 2 - len))
          b = n - len - a
        } else if (shape === 'canon') {
          // each span rhymes with the one just before it
          a = Math.floor(r.next() * (n - 2 * len))
          b = a + len
        } else {
          a = Math.floor(r.next() * (n - len))
          b = Math.floor(r.next() * (n - len))
        }
        a = clamp(Math.round(a), 0, n - len)
        b = clamp(Math.round(b), 0, n - len)
        if (a === b) continue
        const kind = kinds[Math.floor(r.next() * kinds.length)]
        const k = Math.round((r.next() - 0.5) * 8)
        out.push({ a, b, len, kind, k })
      }
      return out
    }

    const build = () => {
      const n = Math.round(ctx.params.notes)
      const r = rng(Math.round(ctx.params.seed))
      rhymes = proposeRhymes(n, Math.round(ctx.params.rhymes), r)

      /**
       * Accepting a rhyme is all-or-nothing.
       *
       * The first version asserted the rows one at a time and only called a
       * rhyme impossible if *every* row failed. A rhyme with four workable rows
       * and one contradictory one was therefore accepted, the union-find
       * quietly dropped the bad row, and the score on screen disobeyed the arc
       * drawn over it — 146 of 1150 rows in the first run. A rhyme is one
       * musical statement, so it survives whole or not at all. Re-solving from
       * scratch per candidate is O(R²·L) on numbers that never leave two
       * figures, which is cheaper than making the union-find undoable.
       */
      const acc: Rhyme[] = []
      for (const rh of rhymes) {
        const trial = new Relations(n)
        let ok = true
        for (const q of [...acc, rh]) {
          for (const row of rowsOf(q, n)) {
            if (trial.relate(row.dst, row.src, row.eps, row.k) === 'impossible') { ok = false; break }
          }
          if (!ok) break
        }
        if (ok) acc.push(rh)
        else rh.dead = true
      }

      rel = new Relations(n)
      for (const rh of acc) {
        let real = false
        for (const row of rowsOf(rh, n)) {
          if (rel.relate(row.dst, row.src, row.eps, row.k) !== 'implied') real = true
        }
        rh.free = !real
      }

      free = rel.roots(n)
      pinnedCount = 0
      // Choose the free notes: a random walk in scale degrees, which is the only
      // material in the piece. Everything else is a consequence of these.
      const chosen = new Map<number, number>()
      let walk = 0
      const reach = Math.round(ctx.params.reach)
      for (const v of free) {
        walk = clamp(walk + Math.round((r.next() - 0.5) * reach * 1.4), -reach, reach)
        chosen.set(v, walk)
      }
      degrees = new Array(n).fill(0)
      owner = new Array(n).fill(-1)
      for (let i = 0; i < n; i++) {
        const f = rel.find(i)
        const p = rel.pinned.get(f.root)
        if (p !== undefined) {
          degrees[i] = Math.round(f.sign * p + f.off)
          owner[i] = -2
          pinnedCount++
        } else {
          degrees[i] = Math.round(f.sign * (chosen.get(f.root) ?? 0) + f.off)
          owner[i] = f.root
        }
      }
    }
    build()
    for (const k of ['notes', 'rhymes', 'span', 'moves', 'form', 'reach', 'seed'] as const)
      ctx.onParam(k, build)
    ctx.onPress('reroll', build)

    /** Re-derive every slot after a free note has been dragged. */
    const setFree = (root: number, value: number) => {
      const n = degrees.length
      const cur = new Map<number, number>()
      for (const v of free) {
        const f = rel.find(v)
        cur.set(v, f.sign * degrees[v] - f.sign * f.off)
      }
      cur.set(root, value)
      for (let i = 0; i < n; i++) {
        const f = rel.find(i)
        if (rel.pinned.has(f.root)) continue
        degrees[i] = Math.round(f.sign * (cur.get(f.root) ?? 0) + f.off)
      }
    }

    // -- playback ----------------------------------------------------------------

    let at = 0
    let lastPlayed = -1
    ctx.clock.onStep((e) => {
      const every = Math.max(1, Math.round(ctx.params.every))
      if (e.step % every !== 0) return
      const n = degrees.length
      at = Math.floor(e.step / every) % n
      lastPlayed = at
      const midi = degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, degrees[at])
      play(midi, e.time, 0.40 + ctx.params.level * 0.58)
    })

    // -- drawing -------------------------------------------------------------------

    const KIND_HUE: Record<Rhyme['kind'], string> = {
      transpose: 'rgba(125,211,252,',
      retrograde: 'rgba(167,139,250,',
      invert: 'rgba(251,191,36,',
    }

    const g = ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const n = degrees.length
      const padL = 16
      const padR = 16
      const arcH = Math.max(56, h * 0.34)
      const laneY = arcH + 26
      const laneH = Math.max(70, h - laneY - 54)
      const cw = (w - padL - padR) / n
      const lo = Math.min(...degrees)
      const hi = Math.max(...degrees)
      const sx = (i: number) => padL + (i + 0.5) * cw
      const sy = (d: number) => laneY + laneH - ((d - lo) / Math.max(1, hi - lo)) * laneH

      // -- the rhymes, as arcs over the spans they relate -----------------------
      rhymes.forEach((rh, idx) => {
        const x1 = sx(rh.a + (rh.len - 1) / 2)
        const x2 = sx(rh.b + (rh.len - 1) / 2)
        const lift = arcH * (0.32 + 0.62 * ((idx % 4) / 3))
        const alpha = rh.dead ? 0.14 : rh.free ? 0.3 : 0.85
        g.strokeStyle = KIND_HUE[rh.kind] + alpha + ')'
        g.lineWidth = rh.dead ? 1 : 2
        if (rh.dead) g.setLineDash([3, 3])
        g.beginPath()
        g.moveTo(x1, arcH)
        g.bezierCurveTo(x1, arcH - lift, x2, arcH - lift, x2, arcH)
        g.stroke()
        g.setLineDash([])
        // the two spans themselves
        g.fillStyle = KIND_HUE[rh.kind] + (rh.dead ? 0.08 : 0.2) + ')'
        for (const s of [rh.a, rh.b]) {
          g.fillRect(padL + s * cw, arcH + 2, Math.max(2, rh.len * cw - 2), 5)
        }
      })
      g.font = '9px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.3)'
      g.fillText('rhymes — solid costs a note, faint is already implied, dashed is impossible', padL, 12)

      // -- the notes ------------------------------------------------------------
      for (let i = 0; i < n; i++) {
        const x = sx(i)
        const y = sy(degrees[i])
        const isFree = owner[i] === i
        const isPinned = owner[i] === -2
        if (i === lastPlayed) {
          g.fillStyle = 'rgba(255,255,255,0.10)'
          g.fillRect(padL + i * cw, laneY, cw, laneH)
        }
        g.strokeStyle = 'rgba(255,255,255,0.07)'
        g.beginPath()
        g.moveTo(x, laneY)
        g.lineTo(x, laneY + laneH)
        g.stroke()
        g.beginPath()
        if (isFree) {
          // the notes you actually chose
          g.fillStyle = 'rgba(253,224,71,0.95)'
          g.arc(x, y, Math.min(5, cw * 0.4), 0, Math.PI * 2)
          g.fill()
        } else if (isPinned) {
          g.strokeStyle = 'rgba(248,113,113,0.8)'
          g.lineWidth = 1.5
          g.arc(x, y, Math.min(4, cw * 0.34), 0, Math.PI * 2)
          g.stroke()
        } else {
          g.strokeStyle = 'rgba(125,211,252,0.65)'
          g.lineWidth = 1.2
          g.arc(x, y, Math.min(3.4, cw * 0.3), 0, Math.PI * 2)
          g.stroke()
        }
      }

      // -- the count, which is the whole point ----------------------------------
      const live = rhymes.filter((r) => !r.dead && !r.free).length
      const implied = rhymes.filter((r) => r.free).length
      const dead = rhymes.filter((r) => r.dead).length
      g.font = '12px ui-monospace, monospace'
      g.fillStyle = 'rgba(253,224,71,0.9)'
      g.fillText(`you chose ${free.length} of ${n} notes`, padL, h - 30)
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.45)'
      g.fillText(
        `${live} rhyme${live === 1 ? '' : 's'} cost you something` +
          (implied ? `, ${implied} already implied` : '') +
          (dead ? `, ${dead} impossible` : '') +
          (pinnedCount ? `  ·  ${pinnedCount} notes pinned flat by their own symmetry` : ''),
        padL,
        h - 16,
      )
      g.fillStyle = 'rgba(255,255,255,0.28)'
      g.fillText('drag a filled note — everything that rhymes with it moves too', padL, h - 4)
    })

    // -- dragging ------------------------------------------------------------------

    let dragging = -1
    const slotAt = (e: PointerEvent) => {
      const rect = g.canvas.getBoundingClientRect()
      const n = degrees.length
      const cw = (rect.width - 32) / n
      const i = Math.floor((e.clientX - rect.left - 16) / cw)
      return clamp(i, 0, n - 1)
    }
    const degreeAt = (e: PointerEvent) => {
      const rect = g.canvas.getBoundingClientRect()
      const reach = Math.round(ctx.params.reach)
      const t = 1 - (e.clientY - rect.top) / rect.height
      return Math.round(clamp(t * 2 * reach - reach, -reach, reach))
    }
    const onDown = (e: PointerEvent) => {
      const i = slotAt(e)
      if (owner[i] === i) {
        dragging = i
        setFree(i, degreeAt(e))
      } else if (owner[i] >= 0) {
        // not yours to move — say who owns it
        dragging = -1
        ctx.status(`slot ${i} is derived from slot ${owner[i]}. Move that one.`)
      } else {
        ctx.status(`slot ${i} is pinned by its own symmetry — it has no freedom left.`)
      }
    }
    const onMove = (e: PointerEvent) => {
      if (dragging >= 0) setFree(dragging, degreeAt(e))
    }
    const onUp = () => (dragging = -1)
    g.canvas.addEventListener('pointerdown', onDown)
    g.canvas.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    ctx.cleanup(() => window.removeEventListener('pointerup', onUp))

    // A read-only snapshot for the harness.
    const wnd = window as unknown as Record<string, unknown>
    wnd.__rhyme = () => ({
      degrees: degrees.slice(),
      owner: owner.slice(),
      free: free.slice(),
      pinned: pinnedCount,
      rhymes: rhymes.map((r) => ({ ...r })),
      midi: degrees.map((d) => degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, d)),
      freqs: degrees.map((d) => mtof(degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, d))),
      at,
    })
    ctx.cleanup(() => delete wnd.__rhyme)

    ctx.status('every repeat is a reference — the yellow notes are the only ones you wrote')
  },
})
