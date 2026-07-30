import { clamp, degree, poly, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * The grid is a map and the playheads are water.
 *
 * Walkers flow downhill across a seeded heightmap; pitch follows elevation,
 * so melodies are literally the contour lines of the terrain. Where a walker
 * rests it deposits sediment — a basin ostinato slowly fills its own basin
 * until the walker spills over the lip and the phrase changes. The piece
 * erodes the landscape that produces it.
 *
 * Drag to raise hills, shift-drag to dig channels: performance here is
 * landscaping, not note entry. The terrain slowly restores toward its seeded
 * shape, so your interventions are weather, not architecture.
 */

const W = 14
const H = 9
const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

interface Walker {
  x: number
  y: number
  /** Moves every `div` steps — different divisions make the streams polymetric. */
  div: number
  /** Scale-degree offset, so streams sit in different registers. */
  offset: number
  lastElev: number
  resting: boolean
  trail: Array<{ x: number; y: number }>
}

export default defineSketch({
  title: 'Watershed',
  description: 'Terrain sequencer: walkers flow downhill, pitch follows elevation, basins fill until the melody escapes.',
  tags: ['sequencer', 'generative', 'rhythm', 'strange'],
  status: 'promising',
  bpm: 112,

  params: {
    seed: { type: 'number', value: 23, min: 1, max: 999, step: 1 },
    walkers: { type: 'number', value: 3, min: 1, max: 4, step: 1 },
    relief: { type: 'number', value: 0.6, min: 0.1, max: 1, step: 0.01, label: 'Relief' },
    deposit: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, label: 'Sediment' },
    restore: { type: 'number', value: 0.25, min: 0, max: 1, step: 0.01, label: 'Restore' },
    polymeter: { type: 'toggle', value: true, label: 'Polymetric streams' },
    root: { type: 'number', value: 43, min: 28, max: 64, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'pentatonicMinor', options: SCALE_NAMES },
    spread: { type: 'number', value: 9, min: 3, max: 14, step: 1, label: 'Pitch spread' },
    gate: { type: 'number', value: 1.6, min: 0.3, max: 4, step: 0.05, label: 'Gate' },
    reflow: { type: 'button', label: 'New terrain' },
  },

  notes: `
Question: does a melody that follows a landscape read as intentional?

What actually happens: yes, surprisingly strongly — because gravity gives
phrases direction. A walker tumbling down a slope plays a descending run
with accents on the big drops (velocity = drop height), then settles into a
basin pedal tone. The sediment rule is what makes it a piece instead of a
loop: every rest raises the floor a little, so ostinati are always slowly
dying, and the escape — when the basin finally overflows and the stream
finds the next valley — reads exactly like a phrase resolving.

Sediment is the composition knob. At 0 the landscape is permanent and the
piece is a fixed (if polymetric) loop. Around 0.5 basins hold for a musical
4-16 visits. At 1 nothing pools long enough to feel like home.

Sculpting works as performance: dig a channel and a stream follows it within
a bar or two — you can steer a melody toward the register you want without
touching a note. Raising a wall between two walkers un-syncs their registers.

Restore keeps user edits temporary (weather, not architecture), which turned
out right: you intervene, the piece absorbs it, the terrain remembers itself.

Next: walkers should hear each other — two streams merging into one channel
could literally merge voices (unison). And a "rain" button that drops a new
walker at the highest point.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: 0.3, seconds: 2.6 })
    const synth = poly(rev.input, {
      wave: 'triangle',
      gain: 3.1,
      cutoff: 2400,
      envAmount: 1.4,
      attack: 0.004,
      release: 0.5,
      spread: 0.5,
      sub: 0.25,
      maxVoices: 10,
    })
    ctx.cleanup(() => {
      synth.allNotesOff()
      rev.dispose()
    })

    // -- terrain -----------------------------------------------------------

    /** Current elevation, 0..1-ish. Mutated by sediment and sculpting. */
    let elev = new Float32Array(W * H)
    /** The seeded original the terrain relaxes back toward. */
    let original = new Float32Array(W * H)
    let walkers: Walker[] = []
    let r = rng(ctx.params.seed)

    const at = (x: number, y: number) => y * W + x

    /** Smooth seeded terrain from a few summed plane waves — cheap, organic. */
    const generate = () => {
      r = rng(Math.round(ctx.params.seed))
      const waves = Array.from({ length: 4 }, () => ({
        ax: r.range(0.4, 1.6),
        ay: r.range(0.4, 1.6),
        phase: r.range(0, Math.PI * 2),
        amp: r.range(0.4, 1),
      }))
      let lo = Infinity
      let hi = -Infinity
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let v = 0
          for (const wv of waves) v += wv.amp * Math.sin(wv.ax * x + wv.ay * y + wv.phase)
          elev[at(x, y)] = v
          lo = Math.min(lo, v)
          hi = Math.max(hi, v)
        }
      }
      const span = Math.max(1e-6, hi - lo)
      // Relief scales the contrast: flat plains make walkers pool and rest,
      // steep terrain keeps them tumbling.
      const contrast = 0.3 + ctx.params.relief
      for (let i = 0; i < elev.length; i++) {
        elev[i] = 0.5 + ((elev[i] - lo) / span - 0.5) * contrast
      }
      original = elev.slice()

      walkers = Array.from({ length: Math.round(ctx.params.walkers) }, (_, i) => ({
        x: r.int(0, W - 1),
        y: r.int(0, H - 1),
        div: ctx.params.polymeter ? [3, 4, 6, 2][i] : 4,
        offset: [0, 5, -3, 9][i],
        lastElev: 1,
        resting: false,
        trail: [],
      }))
    }
    generate()

    ctx.onParam('seed', generate)
    ctx.onParam('walkers', generate)
    ctx.onParam('polymeter', generate)
    ctx.onParam('relief', generate)
    ctx.onPress('reflow', () => ctx.set('seed', Math.floor(Math.random() * 999) + 1))

    // -- flow --------------------------------------------------------------

    ctx.clock.onStep((e) => {
      // Terrain memory: relax toward the original a little every bar.
      if (e.step % ctx.clock.stepsPerBar === 0) {
        const k = ctx.params.restore * 0.12
        for (let i = 0; i < elev.length; i++) elev[i] += (original[i] - elev[i]) * k
      }

      const scale = ctx.params.scale as ScaleName
      const root = Math.round(ctx.params.root)
      const spread = Math.round(ctx.params.spread)

      for (const wk of walkers) {
        if (e.step % wk.div !== 0) continue

        const here = at(wk.x, wk.y)
        let bestElev = elev[here]
        let bx = -1
        let by = -1
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = wk.x + dx
          const ny = wk.y + dy
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue
          const v = elev[at(nx, ny)]
          if (v < bestElev - 1e-4) {
            bestElev = v
            bx = nx
            by = ny
          }
        }

        const deposit = ctx.params.deposit
        if (bx >= 0) {
          // Downhill: move, leaving a little sediment in the channel.
          elev[here] += deposit * 0.006
          wk.trail.push({ x: wk.x, y: wk.y })
          if (wk.trail.length > 7) wk.trail.shift()
          wk.x = bx
          wk.y = by
          wk.resting = false
        } else {
          // Local minimum: rest and fill the basin. This is what ends every
          // ostinato — each repeat raises the floor until the lip is lower.
          elev[here] += deposit * 0.02
          wk.resting = true
        }

        const nowElev = elev[at(wk.x, wk.y)]
        const drop = Math.max(0, wk.lastElev - nowElev)
        wk.lastElev = nowElev

        // Pitch is elevation; velocity is how hard it fell to get here.
        const deg = Math.round(clamp(nowElev, 0, 1.2) * spread) + wk.offset
        const vel = wk.resting ? 0.34 : clamp(0.42 + drop * 7, 0.42, 1)
        const dur = e.dur * wk.div * ctx.params.gate * (wk.resting ? 0.5 : 0.9)
        synth.note(degree(root, scale, deg), e.time, dur, vel)
      }
    })

    // -- drawing -----------------------------------------------------------

    let cw = 0
    let chh = 0
    let ox = 0
    let oy = 0

    const g = ctx.canvas((g, { w, h }) => {
      const pad = 10
      cw = Math.min((w - pad * 2) / W, (h - pad * 2) / H)
      chh = cw
      ox = (w - cw * W) / 2
      oy = (h - chh * H) / 2

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = at(x, y)
          const v = clamp(elev[i], 0, 1.3)
          const sediment = clamp((elev[i] - original[i]) * 3, -1, 1)
          // Deep water-dark basins up to pale ridges; sediment tints warm.
          const l = 8 + v * 40
          const hue = 210 - sediment * 24
          const sat = 45 - v * 25
          g.fillStyle = `hsl(${hue} ${sat}% ${l}%)`
          g.fillRect(ox + x * cw + 0.5, oy + y * chh + 0.5, cw - 1, chh - 1)
        }
      }

      const colours = ['#7dd3fc', '#fbbf24', '#4ade80', '#fb7185']
      walkers.forEach((wk, i) => {
        const c = colours[i % colours.length]
        wk.trail.forEach((t, k) => {
          g.globalAlpha = ((k + 1) / wk.trail.length) * 0.35
          g.fillStyle = c
          g.beginPath()
          g.arc(ox + (t.x + 0.5) * cw, oy + (t.y + 0.5) * chh, cw * 0.12, 0, Math.PI * 2)
          g.fill()
        })
        g.globalAlpha = 1
        g.fillStyle = c
        g.beginPath()
        g.arc(
          ox + (wk.x + 0.5) * cw,
          oy + (wk.y + 0.5) * chh,
          cw * (wk.resting ? 0.16 : 0.24),
          0,
          Math.PI * 2,
        )
        g.fill()
        if (wk.resting) {
          g.strokeStyle = c
          g.globalAlpha = 0.5
          g.beginPath()
          g.arc(ox + (wk.x + 0.5) * cw, oy + (wk.y + 0.5) * chh, cw * 0.3, 0, Math.PI * 2)
          g.stroke()
          g.globalAlpha = 1
        }
      })

      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.font = '10px ui-monospace, monospace'
      g.textAlign = 'left'
      g.fillText(`seed ${Math.round(ctx.params.seed)}`, 10, 14)
      g.textAlign = 'right'
      g.fillStyle = 'rgba(255,255,255,0.25)'
      g.fillText('drag: raise · shift-drag: dig', w - 10, 14)
    })

    // -- sculpting ---------------------------------------------------------

    let sculpting = false

    const sculpt = (e: PointerEvent) => {
      const rect = g.canvas.getBoundingClientRect()
      const gx = (e.clientX - rect.left - ox) / cw
      const gy = (e.clientY - rect.top - oy) / chh
      const cx = Math.floor(gx)
      const cy = Math.floor(gy)
      if (cx < 0 || cx >= W || cy < 0 || cy >= H) return
      const sign = e.shiftKey ? -1 : 1
      // A soft mound, not a spike — spread over the neighbourhood.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue
          const fall = dx === 0 && dy === 0 ? 1 : 0.35
          elev[at(nx, ny)] = clamp(elev[at(nx, ny)] + sign * 0.09 * fall, -0.2, 1.6)
        }
      }
    }

    const onDown = (e: PointerEvent) => {
      sculpting = true
      g.canvas.setPointerCapture(e.pointerId)
      sculpt(e)
    }
    const onMove = (e: PointerEvent) => {
      if (sculpting) sculpt(e)
    }
    const onUp = () => (sculpting = false)

    g.canvas.addEventListener('pointerdown', onDown)
    g.canvas.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    ctx.cleanup(() => window.removeEventListener('pointerup', onUp))

    ctx.status('press space — water finds the low ground. drag to landscape it.')
  },
})
