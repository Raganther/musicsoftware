import {
  cssVar,
  degree,
  delay,
  drums,
  euclid,
  poly,
  reverb,
  rng,
  SCALE_NAMES,
  walker,
  type ScaleName,
} from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * The tended-system dynamic: it plays itself, you steer. Nothing is stored as
 * a pattern — every bar is derived from the seed plus a slow random walk, so
 * the piece never repeats exactly but stays recognisably itself.
 *
 * The seed makes this reproducible. If a run sounds good, write the number down.
 */

const VOICES = 3

export default defineSketch({
  title: 'Euclidean Drift',
  description: 'Three euclidean voices over a drifting scale. Self-playing; you steer.',
  tags: ['generative', 'rhythm', 'sequencer'],
  status: 'promising',
  bpm: 96,
  params: {
    seed: { type: 'number', value: 12, min: 1, max: 999, step: 1 },
    density: { type: 'number', value: 0.45, min: 0.05, max: 1, step: 0.01 },
    drift: { type: 'number', value: 0.35, min: 0, max: 1, step: 0.01, label: 'Drift rate' },
    root: { type: 'number', value: 45, min: 24, max: 72, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'dorian', options: SCALE_NAMES },
    spread: { type: 'number', value: 12, min: 0, max: 24, step: 1, label: 'Pitch spread' },
    wave: { type: 'select', value: 'triangle', options: ['triangle', 'sawtooth', 'square', 'sine'] },
    tone: { type: 'number', value: 2600, min: 400, max: 8000, step: 10, label: 'Tone', unit: 'Hz' },
    width: { type: 'number', value: 0.35, min: 0, max: 1, step: 0.01, label: 'Width' },
    drums: { type: 'toggle', value: true, label: 'Drums' },
    reseed: { type: 'button', label: 'New seed' },
  },
  notes: `
The interesting knob is Drift. At 0 it is a fixed euclidean loop; past ~0.5
the pattern reorganises faster than you can memorise it, and it stops feeling
composed. Somewhere around 0.2-0.35 it feels like it has intentions.

Worth trying next: let the voices listen to each other — e.g. voice 3 only
fires on steps where voice 1 was silent for two bars running.
  `,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: 0.34, seconds: 3.2 })
    const dly = delay(rev.input, { time: '1/8', feedback: 0.3, mix: 0.22 })
    const synth = poly(dly.input, { wave: 'triangle', gain: 2.6, cutoff: 2600, envAmount: 1.6 })
    const kit = drums(rev.input)
    ctx.cleanup(() => {
      synth.allNotesOff()
      dly.dispose()
      rev.dispose()
    })

    const applyTone = () => {
      synth.set({
        wave: ctx.params.wave as 'triangle' | 'sawtooth' | 'square' | 'sine',
        cutoff: ctx.params.tone,
        spread: ctx.params.width,
      })
    }
    applyTone()
    ctx.onParam('wave', applyTone)
    ctx.onParam('tone', applyTone)
    ctx.onParam('width', applyTone)

    // Per-voice state, all derived from the seed.
    let r = rng(ctx.params.seed)
    let voices = makeVoices(r)
    const lit: number[] = new Array(VOICES).fill(-1)

    function makeVoices(r: ReturnType<typeof rng>) {
      return Array.from({ length: VOICES }, (_, i) => ({
        steps: [16, 12, 8][i],
        pulses: r.int(2, 6),
        rotation: r.int(0, 7),
        pattern: [] as boolean[],
        pitch: walker(r, { value: i * 3, step: 0.9, lo: -4, hi: 11 }),
        octave: [0, 12, -12][i],
        gate: [0.9, 0.45, 1.8][i],
      }))
    }

    const rebuild = () => {
      for (const v of voices) {
        const scaled = Math.max(1, Math.round(v.pulses * ctx.params.density * 1.6))
        v.pattern = euclid(Math.min(scaled, v.steps), v.steps, v.rotation)
      }
    }
    rebuild()

    ctx.onParam('density', rebuild)
    ctx.onParam('seed', (v) => {
      r = rng(v)
      voices = makeVoices(r)
      rebuild()
      ctx.status(`seed ${v}`)
    })
    ctx.onPress('reseed', () => ctx.set('seed', Math.floor(Math.random() * 999) + 1))

    // -- playback ---------------------------------------------------------

    ctx.clock.onStep((e) => {
      const scale = ctx.params.scale as ScaleName
      const root = Math.round(ctx.params.root)
      const spread = ctx.params.spread

      voices.forEach((v, i) => {
        const s = e.step % v.steps
        if (!v.pattern[s]) return

        // Drift: the walk only advances at pattern boundaries, so pitch moves
        // in phrase-sized gestures rather than note by note.
        if (s === 0 && r.chance(ctx.params.drift)) {
          v.pitch.next()
          if (r.chance(ctx.params.drift * 0.3)) v.rotation = (v.rotation + 1) % v.steps
          rebuild()
        }

        const deg = Math.round(v.pitch.value * (spread / 12))
        const note = degree(root, scale, deg) + v.octave
        const vel = 0.55 + (s === 0 ? 0.35 : 0) + r.next() * 0.12

        synth.note(note, e.time, e.dur * v.gate, vel)
        lit[i] = e.step
      })

      if (ctx.params.drums) {
        const s16 = e.step % 16
        if (s16 === 0 || s16 === 10) kit.kick(e.time, 0.85)
        if (s16 === 4 || s16 === 12) kit.snare(e.time, 0.5)
        if (e.step % 2 === 0) kit.hat(e.time, 0.3 + r.next() * 0.15)
      }
    })

    // -- drawing ----------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      const cx = w / 2
      const cy = h / 2
      const maxR = Math.min(w, h) * 0.4
      const accent = cssVar('--accent', '#7dd3fc')
      const step = ctx.clock.running ? ctx.clock.visualStep : -1

      voices.forEach((v, i) => {
        const radius = maxR * (1 - i * 0.26)
        const active = step >= 0 ? step % v.steps : -1

        g.strokeStyle = 'rgba(255,255,255,0.06)'
        g.lineWidth = 1
        g.beginPath()
        g.arc(cx, cy, radius, 0, Math.PI * 2)
        g.stroke()

        for (let s = 0; s < v.steps; s++) {
          const a = (s / v.steps) * Math.PI * 2 - Math.PI / 2
          const x = cx + Math.cos(a) * radius
          const y = cy + Math.sin(a) * radius
          const on = v.pattern[s]
          const isNow = s === active

          g.beginPath()
          g.arc(x, y, on ? (isNow ? 7 : 4.5) : 2, 0, Math.PI * 2)
          g.fillStyle = on
            ? isNow
              ? '#ffffff'
              : accent
            : 'rgba(255,255,255,0.14)'
          g.fill()

          if (on && isNow) {
            g.strokeStyle = 'rgba(125,211,252,0.5)'
            g.lineWidth = 1
            g.beginPath()
            g.arc(x, y, 12, 0, Math.PI * 2)
            g.stroke()
          }
        }

        g.fillStyle = 'rgba(255,255,255,0.3)'
        g.font = '9px ui-monospace, monospace'
        g.textAlign = 'center'
        g.fillText(
          `${v.pattern.filter(Boolean).length}/${v.steps}`,
          cx,
          cy - radius - 8,
        )
      })

      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.font = '10px ui-monospace, monospace'
      g.textAlign = 'left'
      g.fillText(`seed ${Math.round(ctx.params.seed)}`, 10, 16)
    })

    ctx.status('press space — it plays itself. change seed for a different piece.')
  },
})
