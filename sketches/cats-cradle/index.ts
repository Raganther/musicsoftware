import { clamp, degree, noteName, poly, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * A melody stored as relationships, not positions.
 *
 * A piano roll records where each note sits. This records only the *interval*
 * from the previous note — the melody is a chain, and its pitches are derived,
 * never stored. That one change of representation makes operations that are
 * tedious edits in a normal roll into single parameters:
 *
 *   transpose  move the anchor
 *   invert     negate every interval (stretch < 0)
 *   stretch    scale every interval (augment / diminish the contour)
 *   retrograde walk the chain backwards
 *
 * Drag a node and you are editing a *relationship*, so everything downstream
 * moves with it and the shape after that point is preserved. That is the
 * whole argument: the representation decides which musical ideas are cheap.
 */

interface Node {
  /** Scale-degree step from the previous node. Node 0 is the anchor. */
  step: number
  /** Length in clock steps. */
  len: number
}

export default defineSketch({
  title: "Cat's Cradle",
  description: 'A melody stored as intervals, not pitches. Invert, stretch and retrograde become one knob each.',
  tags: ['composition', 'sequencer', 'tool', 'generative'],
  status: 'promising',
  bpm: 96,

  params: {
    seed: { type: 'number', value: 8, min: 1, max: 999, step: 1 },
    length: { type: 'number', value: 8, min: 3, max: 14, step: 1, label: 'Nodes' },
    stretch: { type: 'number', value: 1, min: -2, max: 3, step: 0.05, label: 'Stretch' },
    retrograde: { type: 'toggle', value: false, label: 'Retrograde' },
    harmony: { type: 'number', value: 0, min: -7, max: 7, step: 1, label: 'Harmony (deg)' },
    root: { type: 'number', value: 55, min: 36, max: 72, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'dorian', options: SCALE_NAMES },
    gate: { type: 'number', value: 0.9, min: 0.2, max: 2.5, step: 0.05, label: 'Gate' },
    reweave: { type: 'button', label: 'New melody' },
  },

  notes: `
Question: which musical operations does a representation make cheap?

Storing intervals instead of pitches is a small change with a big
consequence. Transpose, invert, augment and retrograde — the classic
transformations, each a laborious multi-note edit in a piano roll — all
become a single parameter here, and crucially they *compose*: stretch -1 is
inversion, stretch -2 is inversion with widened leaps, and it still sounds
like the same tune wearing a different coat.

Stretch is the one to play with. It is a continuous knob through a space a
piano roll cannot express: 0 collapses the melody to a monotone drone (all
intervals vanish, rhythm survives), 0.5 makes a timid version of the same
shape, 2 exaggerates it into leaps, negative values mirror it. Sweeping it
live is the best gesture in this sketch — the tune bends without ever
becoming a different tune.

Dragging a node is the honest demonstration. You are not moving a note, you
are editing one link, so the whole tail of the melody swings with it and its
internal shape is untouched. Doing that in a piano roll means selecting and
nudging every subsequent note.

What did NOT work: I first scaled each interval and rounded it to a degree
before accumulating, which quantised distinct intervals onto the same degree
at low stretch and turned separate phrases into stuttering repeats.
Accumulating in continuous degree-space and rounding only at the moment of
sounding keeps the contour intact all the way down to zero.

The ghost outline shows the untransformed melody whenever a transform is
active — visual proof that the shape is being bent, not replaced.

Next: a second chain whose intervals are defined against the first (real
counterpoint as a constraint), and letting a node reference a node other than
its predecessor — at which point this stops being a chain and becomes a graph.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: 0.26, seconds: 2.2 })
    const lead = poly(rev.input, {
      wave: 'triangle',
      gain: 3.6,
      cutoff: 2600,
      envAmount: 1.5,
      attack: 0.004,
      decay: 0.16,
      sustain: 0.35,
      release: 0.28,
      velToFilter: 0.4,
      keytrack: 0.3,
      spread: 0.25,
      maxVoices: 6,
    })
    const under = poly(rev.input, {
      wave: 'sine',
      gain: 2.4,
      cutoff: 1200,
      attack: 0.02,
      decay: 0.3,
      sustain: 0.4,
      release: 0.5,
      sub: 0.4,
      spread: 0.6,
      maxVoices: 6,
    })
    ctx.cleanup(() => {
      lead.allNotesOff()
      under.allNotesOff()
      rev.dispose()
    })

    // -- the chain ---------------------------------------------------------

    let nodes: Node[] = []

    const weave = () => {
      const r = rng(Math.round(ctx.params.seed))
      const n = Math.round(ctx.params.length)
      // Small steps mostly, with the occasional leap — a shape worth
      // transforming rather than noise.
      nodes = Array.from({ length: n }, (_, i) => ({
        step: i === 0 ? 0 : r.weighted([-4, -2, -1, 1, 2, 3, 5], [1, 3, 4, 4, 3, 2, 1]),
        len: r.weighted([2, 3, 4, 6, 8], [3, 1, 4, 2, 1]),
      }))
    }
    weave()
    ctx.onParam('seed', weave)
    ctx.onParam('length', weave)
    ctx.onPress('reweave', () => ctx.set('seed', Math.floor(Math.random() * 999) + 1))

    /**
     * Derive absolute scale degrees from the chain. Degrees accumulate in
     * continuous space and are rounded only when a note sounds — rounding per
     * step would collapse distinct intervals onto one degree at low stretch.
     */
    const derive = (stretch: number, order: Node[]): number[] => {
      const out: number[] = []
      let d = 0
      for (let i = 0; i < order.length; i++) {
        d += (i === 0 ? 0 : order[i].step) * stretch
        out.push(d)
      }
      return out
    }

    const sequence = () => (ctx.params.retrograde ? [...nodes].reverse() : nodes)

    // -- playback ----------------------------------------------------------

    let cursor = 0
    let nextAt = 0
    let playing = -1

    ctx.clock.onStep((e) => {
      if (e.step < nextAt) return

      const order = sequence()
      if (cursor >= order.length) cursor = 0
      const degs = derive(ctx.params.stretch, order)

      const root = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      const node = order[cursor]
      const deg = Math.round(degs[cursor])
      const dur = e.dur * node.len * ctx.params.gate

      // Accent the leaps: the size of the interval is the phrasing.
      const leap = Math.abs(cursor === 0 ? 0 : node.step * ctx.params.stretch)
      lead.note(degree(root, scale, deg), e.time, dur, clamp(0.5 + leap * 0.11, 0.5, 1))

      const h = Math.round(ctx.params.harmony)
      if (h !== 0) under.note(degree(root, scale, deg + h), e.time, dur * 1.2, 0.5)

      playing = cursor
      nextAt = e.step + node.len
      cursor++
    })

    // -- drawing -----------------------------------------------------------

    let plot: Array<{ x: number; y: number }> = []

    const g = ctx.canvas((g, { w, h }) => {
      const order = sequence()
      const stretch = ctx.params.stretch
      const degs = derive(stretch, order)
      const plain = derive(1, order)

      const all = [...degs, ...plain]
      const lo = Math.min(...all) - 1
      const hi = Math.max(...all) + 1
      const span = Math.max(4, hi - lo)

      const padX = 44
      const padY = 34
      const total = Math.max(1, order.reduce((s, n) => s + n.len, 0))
      const xs: number[] = []
      let acc = 0
      for (const n of order) {
        xs.push(padX + (acc / total) * (w - padX * 2))
        acc += n.len
      }
      const yOf = (d: number) => h - padY - ((d - lo) / span) * (h - padY * 2)

      // Scale-degree guide lines — the lattice the chain is pinned to.
      g.strokeStyle = 'rgba(255,255,255,0.05)'
      g.lineWidth = 1
      for (let d = Math.ceil(lo); d <= Math.floor(hi); d++) {
        const y = yOf(d)
        g.beginPath()
        g.moveTo(padX * 0.5, y)
        g.lineTo(w - padX * 0.5, y)
        g.stroke()
      }

      // Ghost: the same chain untransformed. Visual proof that stretch and
      // retrograde bend the shape rather than replacing it.
      const transformed = Math.abs(stretch - 1) > 0.01 || ctx.params.retrograde
      if (transformed) {
        g.strokeStyle = 'rgba(255,255,255,0.16)'
        g.setLineDash([3, 4])
        g.beginPath()
        plain.forEach((d, i) => (i ? g.lineTo(xs[i], yOf(d)) : g.moveTo(xs[i], yOf(d))))
        g.stroke()
        g.setLineDash([])
      }

      plot = degs.map((d, i) => ({ x: xs[i], y: yOf(d) }))
      g.strokeStyle = '#7dd3fc'
      g.lineWidth = 1.5
      g.beginPath()
      plot.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
      g.stroke()

      // Interval labels sit on the links, because the links are the data.
      g.font = '9px ui-monospace, monospace'
      g.textAlign = 'center'
      for (let i = 1; i < plot.length; i++) {
        const mx = (plot[i - 1].x + plot[i].x) / 2
        const my = (plot[i - 1].y + plot[i].y) / 2
        const shown = order[i].step * stretch
        const txt = Math.abs(shown) < 0.05 ? '0' : shown.toFixed(Math.abs(shown % 1) > 0.01 ? 1 : 0)
        g.fillStyle = 'rgba(255,255,255,0.4)'
        g.fillText(shown > 0 ? `+${txt}` : txt, mx, my - 7)
      }

      const root = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      plot.forEach((p, i) => {
        const isNow = i === playing
        g.beginPath()
        g.arc(p.x, p.y, isNow ? 8 : 5, 0, Math.PI * 2)
        g.fillStyle = i === 0 ? '#fbbf24' : isNow ? '#ffffff' : '#7dd3fc'
        g.fill()
        if (isNow) {
          g.strokeStyle = 'rgba(255,255,255,0.4)'
          g.lineWidth = 1
          g.beginPath()
          g.arc(p.x, p.y, 14, 0, Math.PI * 2)
          g.stroke()
          g.fillStyle = 'rgba(255,255,255,0.55)'
          g.fillText(noteName(degree(root, scale, Math.round(degs[i]))), p.x, p.y - 20)
        }
      })

      g.textAlign = 'left'
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.4)'
      const tags = [
        `×${stretch.toFixed(2)}`,
        stretch < 0 ? 'inverted' : null,
        ctx.params.retrograde ? 'retrograde' : null,
        Math.round(ctx.params.harmony) !== 0 ? `${Math.round(ctx.params.harmony)} under` : null,
      ].filter(Boolean)
      g.fillText(tags.join('  ·  '), 10, 16)
      g.fillStyle = 'rgba(255,255,255,0.22)'
      g.fillText('anchor is amber · drag a node to edit its interval', 10, h - 10)
    })

    // -- editing -----------------------------------------------------------

    let dragging = -1

    const onDown = (e: PointerEvent) => {
      const rect = g.canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      let best = -1
      let bestD = 22
      plot.forEach((p, i) => {
        const d = Math.hypot(p.x - px, p.y - py)
        if (d < bestD) {
          bestD = d
          best = i
        }
      })
      if (best < 0) return
      dragging = best
      g.canvas.setPointerCapture(e.pointerId)
    }

    const onMove = (e: PointerEvent) => {
      if (dragging < 0) return
      const rect = g.canvas.getBoundingClientRect()
      const py = e.clientY - rect.top

      const order = sequence()
      const stretch = ctx.params.stretch
      const degs = derive(stretch, order)
      const all = [...degs, ...derive(1, order)]
      const lo = Math.min(...all) - 1
      const hi = Math.max(...all) + 1
      const span = Math.max(4, hi - lo)
      const padY = 34
      const height = rect.height

      // Invert the y mapping to get the degree the pointer is over.
      const wantDeg = lo + ((height - padY - py) / (height - padY * 2)) * span

      if (dragging === 0) {
        // Dragging the anchor transposes: move the root, shape untouched.
        const delta = Math.round(wantDeg - degs[0])
        if (delta !== 0) ctx.set('root', clamp(Math.round(ctx.params.root) + delta, 36, 72))
        return
      }

      // Editing a link: only this interval changes, and the whole tail of the
      // melody swings with it while keeping its own internal shape.
      const target = wantDeg - degs[dragging - 1]
      const wantStep = Math.abs(stretch) < 0.05 ? nodes[0].step : target / stretch
      const idx = ctx.params.retrograde ? nodes.length - 1 - dragging : dragging
      nodes[idx].step = clamp(Math.round(wantStep), -9, 9)
    }

    const onUp = () => (dragging = -1)

    g.canvas.addEventListener('pointerdown', onDown)
    g.canvas.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    ctx.cleanup(() => window.removeEventListener('pointerup', onUp))

    ctx.status('press space · sweep Stretch through 0 and into negatives')
  },
})
