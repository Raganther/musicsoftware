import { cssVar, drums, rng, roundRect } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * The direct-manipulation dynamic: you are the composer, the machine is a
 * plain executor. Nothing surprises you. Baseline to judge the others against.
 */

const TRACKS = ['kick', 'snare', 'hat', 'clap', 'tom', 'rim'] as const
const MAX_STEPS = 32

export default defineSketch({
  title: 'Step Sequencer',
  description: 'Six drum voices on a grid. Click to toggle, drag to paint.',
  tags: ['sequencer', 'rhythm', 'drums'],
  status: 'sketch',
  bpm: 104,
  params: {
    steps: { type: 'number', value: 16, min: 4, max: MAX_STEPS, step: 1, label: 'Steps' },
    humanize: { type: 'number', value: 0.2, min: 0, max: 1, step: 0.01, label: 'Humanize' },
    accentEvery: { type: 'number', value: 4, min: 1, max: 8, step: 1, label: 'Accent every' },
    randomise: { type: 'button', label: 'Randomise' },
    clear: { type: 'button', label: 'Clear' },
  },
  notes: `
Try: humanize at 0.4+ with swing around 0.15 on the transport.
Open question — at what point does a grid stop being expressive?
Everything here is quantised to the grid; the humanize param is the only
thing pulling against it, and it already changes the feel a lot.
  `,

  setup(ctx) {
    const kit = drums(ctx.out)
    const r = rng(7)

    // Fixed-size grid; `steps` just changes how much of it is used.
    const grid: boolean[][] = TRACKS.map(() => new Array(MAX_STEPS).fill(false))

    const seed = () => {
      grid[0][0] = grid[0][8] = true
      grid[1][4] = grid[1][12] = true
      for (let i = 0; i < MAX_STEPS; i += 2) grid[2][i] = true
    }
    seed()

    ctx.onPress('clear', () => {
      grid.forEach((row) => row.fill(false))
      ctx.status('cleared')
    })

    ctx.onPress('randomise', () => {
      const density = [0.3, 0.18, 0.55, 0.1, 0.12, 0.14]
      grid.forEach((row, t) => {
        for (let i = 0; i < MAX_STEPS; i++) row[i] = r.chance(density[t])
      })
      ctx.status('randomised')
    })

    // -- playback ---------------------------------------------------------

    ctx.clock.onStep((e) => {
      const steps = Math.round(ctx.params.steps)
      const s = e.step % steps
      const accent = s % Math.round(ctx.params.accentEvery) === 0

      for (let t = 0; t < TRACKS.length; t++) {
        if (!grid[t][s]) continue

        // Nudge each hit off the grid a little. ±12ms is plenty to hear.
        const jitter = (r.next() - 0.5) * ctx.params.humanize * 0.024
        const time = e.time + jitter
        const vel = (accent ? 1 : 0.68) * (0.9 + r.next() * 0.1)

        switch (TRACKS[t]) {
          case 'kick': kit.kick(time, vel); break
          case 'snare': kit.snare(time, vel); break
          case 'hat': kit.hat(time, vel * 0.8, s % 8 === 6); break
          case 'clap': kit.clap(time, vel); break
          case 'tom': kit.tom(time, vel, 150); break
          case 'rim': kit.rim(time, vel); break
        }
      }
    })

    // -- drawing ----------------------------------------------------------

    const pad = 8
    const labelW = 54
    let cellW = 0
    let cellH = 0
    let originX = 0
    let originY = 0

    const g = ctx.canvas((g, { w, h }) => {
      const steps = Math.round(ctx.params.steps)
      const gridW = w - labelW - pad * 2
      const gridH = h - pad * 2
      cellW = gridW / steps
      cellH = Math.min(46, gridH / TRACKS.length)
      originX = labelW + pad
      originY = pad + Math.max(0, (gridH - cellH * TRACKS.length) / 2)

      const playhead = ctx.clock.running ? ctx.clock.visualStep % steps : -1
      const accentEvery = Math.round(ctx.params.accentEvery)
      const accent = cssVar('--accent', '#7dd3fc')
      const dim = cssVar('--text-faint', '#5a616e')

      for (let t = 0; t < TRACKS.length; t++) {
        const y = originY + t * cellH

        g.fillStyle = dim
        g.font = '10px ui-monospace, monospace'
        g.textAlign = 'right'
        g.textBaseline = 'middle'
        g.fillText(TRACKS[t], labelW - 2, y + cellH / 2)

        for (let s = 0; s < steps; s++) {
          const x = originX + s * cellW
          const on = grid[t][s]
          const isBeat = s % accentEvery === 0
          const isHead = s === playhead

          g.fillStyle = on
            ? isHead
              ? '#ffffff'
              : accent
            : isHead
              ? 'rgba(125,211,252,0.16)'
              : isBeat
                ? 'rgba(255,255,255,0.055)'
                : 'rgba(255,255,255,0.025)'

          roundRect(g, x + 1.5, y + 1.5, cellW - 3, cellH - 3, 3)
          g.fill()
        }
      }

      // step ruler
      g.fillStyle = dim
      g.font = '9px ui-monospace, monospace'
      g.textAlign = 'center'
      for (let s = 0; s < steps; s += accentEvery) {
        g.fillText(String(s + 1), originX + s * cellW + cellW / 2, originY + TRACKS.length * cellH + 9)
      }
    })

    // -- editing ----------------------------------------------------------

    const cellAt = (e: PointerEvent): [number, number] | null => {
      const rect = g.canvas.getBoundingClientRect()
      const x = e.clientX - rect.left - originX
      const y = e.clientY - rect.top - originY
      const s = Math.floor(x / cellW)
      const t = Math.floor(y / cellH)
      if (s < 0 || s >= Math.round(ctx.params.steps) || t < 0 || t >= TRACKS.length) return null
      return [t, s]
    }

    let painting: boolean | null = null

    const onDown = (e: PointerEvent) => {
      const cell = cellAt(e)
      if (!cell) return
      const [t, s] = cell
      painting = !grid[t][s]
      grid[t][s] = painting
      g.canvas.setPointerCapture(e.pointerId)
      // Audition the hit so editing while stopped still tells you something.
      if (painting && !ctx.clock.running) auditionTrack(t)
    }

    const onMove = (e: PointerEvent) => {
      if (painting === null) return
      const cell = cellAt(e)
      if (!cell) return
      grid[cell[0]][cell[1]] = painting
    }

    const onUp = () => (painting = null)

    const auditionTrack = (t: number) => {
      switch (TRACKS[t]) {
        case 'kick': kit.kick(); break
        case 'snare': kit.snare(); break
        case 'hat': kit.hat(); break
        case 'clap': kit.clap(); break
        case 'tom': kit.tom(); break
        case 'rim': kit.rim(); break
      }
    }

    g.canvas.addEventListener('pointerdown', onDown)
    g.canvas.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    ctx.cleanup(() => window.removeEventListener('pointerup', onUp))

    ctx.status('click cells to toggle · drag to paint · space to play')
  },
})
