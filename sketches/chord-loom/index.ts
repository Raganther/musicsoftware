import {
  clamp,
  cssVar,
  degree,
  delay,
  noteName,
  poly,
  reverb,
  rng,
  SCALE_NAMES,
  type ScaleName,
} from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * The improvisation dynamic: an instrument you can't play a wrong note on.
 *
 * Everything is drawn from one diatonic set, and chord changes land on the
 * beat rather than the instant you move — so gesture and grid stay married and
 * a clumsy hand still sounds deliberate. That constraint is the whole idea:
 * the interesting question is whether it feels expressive or merely safe.
 */

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']

export default defineSketch({
  title: 'Chord Loom',
  description: 'XY pad of diatonic harmony. Drag to move through chords; changes land on the beat.',
  tags: ['improvisation', 'harmony', 'instrument', 'generative'],
  status: 'promising',
  bpm: 84,
  params: {
    root: { type: 'number', value: 52, min: 36, max: 67, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'lydian', options: SCALE_NAMES },
    mode: { type: 'select', value: 'bloom', options: ['pad', 'arp', 'bloom'] },
    quantise: { type: 'select', value: 'beat', options: ['free', 'beat', 'bar'] },
    seventh: { type: 'toggle', value: true, label: 'Add 7ths' },
    density: { type: 'number', value: 0.6, min: 0.05, max: 1, step: 0.01 },
    hold: { type: 'toggle', value: false, label: 'Latch' },
  },
  notes: `
Modes are three different answers to "what does the machine do between my
gestures":
  pad   — nothing, it just sustains. Closest to an instrument.
  arp   — a fixed rule. Predictable, gets boring fast.
  bloom — probabilistic. The one that feels like accompaniment.

Bloom is the one to develop. The obvious next step is making it respond to
how fast you're moving: hold still and it should thin out and settle, sweep
across and it should get busy.
  `,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: 0.3, seconds: 3.4 })
    const dly = delay(rev.input, { time: '1/4', feedback: 0.28, mix: 0.2 })
    const synth = poly(dly.input, {
      wave: 'sawtooth',
      gain: 2.8,
      attack: 0.02,
      release: 0.9,
      maxVoices: 8,
    })

    // Per-mode velocity trim. Pad holds four voices; bloom stacks eight short
    // overlapping ones, so without this the modes are ~40dB apart and
    // switching between them is unusable.
    const VEL = { pad: 0.5, arp: 0.8, bloom: 0.55 } as const
    const vel = () => VEL[ctx.params.mode as keyof typeof VEL] ?? 0.5
    const r = rng(4)
    ctx.cleanup(() => {
      synth.allNotesOff()
      dly.dispose()
      rev.dispose()
    })

    // Pointer position, normalised. x = harmonic position, y = register.
    let px = 0.5
    let py = 0.5
    let pointerActive = false
    let targetDeg = 3
    let currentDeg = 3
    let arpIndex = 0
    let heldNotes: number[] = []
    let lastChange = -1

    const chordFor = (deg: number, y: number): number[] => {
      const root = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      const intervals = ctx.params.seventh ? [0, 2, 4, 6] : [0, 2, 4]
      // y opens the voicing out: low = close position, high = spread + top note.
      const spread = Math.round(y * 3)
      return intervals.map((i, n) => degree(root, scale, deg + i + (n >= 2 ? spread * 7 : 0)))
    }

    const releaseHeld = (time?: number) => {
      heldNotes.forEach((n) => synth.noteOff(n, time))
      heldNotes = []
    }

    const applyChord = (deg: number, time?: number) => {
      currentDeg = deg
      arpIndex = 0
      if (ctx.params.mode !== 'pad') return
      releaseHeld(time)
      heldNotes = chordFor(deg, py)
      heldNotes.forEach((n, i) => synth.noteOn(n, vel() - i * 0.06, time))
    }

    // -- transport-driven behaviour ---------------------------------------

    ctx.clock.onStep((e) => {
      const q = ctx.params.quantise
      const boundary =
        q === 'free' ? true : q === 'beat' ? e.tick === 0 : e.step % ctx.clock.stepsPerBar === 0

      if (boundary && targetDeg !== currentDeg) {
        applyChord(targetDeg, e.time)
        lastChange = e.step
      }

      const engaged = pointerActive || ctx.params.hold
      if (!engaged) return

      const notes = chordFor(currentDeg, py)
      const mode = ctx.params.mode

      if (mode === 'arp') {
        if (e.step % 2 !== 0) return
        const n = notes[arpIndex % notes.length]
        arpIndex++
        synth.note(n, e.time, e.dur * 1.6, vel())
      } else if (mode === 'bloom') {
        // Each chord tone decides independently whether to sound. Density and
        // register bias make the top of the pad sparkle and the bottom rumble.
        notes.forEach((n, i) => {
          const bias = 1 - Math.abs(i / notes.length - py) * 0.6
          if (!r.chance(ctx.params.density * 0.45 * bias)) return
          const offset = r.next() * e.dur * 0.5
          synth.note(n, e.time + offset, e.dur * (1.5 + r.next() * 2), vel() * (0.7 + r.next() * 0.6))
        })
        if (r.chance(ctx.params.density * 0.12)) {
          const top = degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, currentDeg + r.int(7, 11))
          synth.note(top, e.time, e.dur * 3, vel() * 0.6)
        }
      }
    })

    ctx.onParam('mode', (m) => {
      releaseHeld()
      if (m === 'pad' && (pointerActive || ctx.params.hold)) applyChord(currentDeg)
    })
    ctx.onParam('hold', (on) => {
      if (!on) releaseHeld()
      else if (ctx.params.mode === 'pad') applyChord(currentDeg)
    })

    // -- drawing ----------------------------------------------------------

    const g = ctx.canvas((g, { w, h }) => {
      const cols = 7
      const colW = w / cols
      const accent = cssVar('--accent', '#7dd3fc')
      const playing = ctx.clock.running

      for (let i = 0; i < cols; i++) {
        const isTarget = i === targetDeg
        const isCurrent = i === currentDeg
        const x = i * colW

        const grad = g.createLinearGradient(0, 0, 0, h)
        const alpha = isCurrent ? 0.16 : isTarget ? 0.08 : 0.03
        grad.addColorStop(0, `rgba(125,211,252,${alpha})`)
        grad.addColorStop(1, `rgba(125,211,252,${alpha * 0.25})`)
        g.fillStyle = grad
        g.fillRect(x + 1, 0, colW - 2, h)

        if (isCurrent) {
          g.strokeStyle = accent
          g.lineWidth = 1
          g.strokeRect(x + 1.5, 0.5, colW - 3, h - 1)
        } else if (isTarget) {
          g.strokeStyle = 'rgba(125,211,252,0.35)'
          g.setLineDash([4, 4])
          g.lineWidth = 1
          g.strokeRect(x + 1.5, 0.5, colW - 3, h - 1)
          g.setLineDash([])
        }

        g.fillStyle = isCurrent ? accent : 'rgba(255,255,255,0.25)'
        g.font = '12px ui-monospace, monospace'
        g.textAlign = 'center'
        g.fillText(ROMAN[i], x + colW / 2, h - 14)
      }

      // register guides
      g.strokeStyle = 'rgba(255,255,255,0.04)'
      for (let i = 1; i < 4; i++) {
        g.beginPath()
        g.moveTo(0, (h * i) / 4)
        g.lineTo(w, (h * i) / 4)
        g.stroke()
      }

      // cursor
      if (pointerActive || ctx.params.hold) {
        const cx = px * w
        const cy = py * h
        const pulse = playing && ctx.clock.visualStep === lastChange ? 26 : 16
        g.strokeStyle = accent
        g.lineWidth = 1.5
        g.beginPath()
        g.arc(cx, cy, pulse, 0, Math.PI * 2)
        g.stroke()
        g.fillStyle = accent
        g.beginPath()
        g.arc(cx, cy, 3.5, 0, Math.PI * 2)
        g.fill()
      }

      // current chord readout
      const notes = chordFor(currentDeg, py)
      g.fillStyle = 'rgba(255,255,255,0.4)'
      g.font = '10px ui-monospace, monospace'
      g.textAlign = 'left'
      g.fillText(`${ROMAN[currentDeg]}  ${notes.map(noteName).join(' ')}`, 10, 16)
      if (!playing) {
        g.fillStyle = 'rgba(255,255,255,0.25)'
        g.fillText('press space to start the transport', 10, 32)
      }
    })

    // -- input ------------------------------------------------------------

    const update = (e: PointerEvent) => {
      const rect = g.canvas.getBoundingClientRect()
      px = clamp((e.clientX - rect.left) / rect.width, 0, 0.9999)
      py = clamp((e.clientY - rect.top) / rect.height, 0, 1)
      targetDeg = Math.floor(px * 7)
      if (ctx.params.quantise === 'free' && targetDeg !== currentDeg) applyChord(targetDeg)
    }

    const onDown = (e: PointerEvent) => {
      pointerActive = true
      g.canvas.setPointerCapture(e.pointerId)
      update(e)
      // First touch shouldn't wait for a boundary — that reads as broken.
      if (!ctx.clock.running || ctx.params.quantise === 'free') applyChord(targetDeg)
    }
    const onMove = (e: PointerEvent) => {
      if (!pointerActive) return
      update(e)
    }
    const onUp = () => {
      pointerActive = false
      if (!ctx.params.hold) releaseHeld()
    }

    g.canvas.addEventListener('pointerdown', onDown)
    g.canvas.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    ctx.cleanup(() => window.removeEventListener('pointerup', onUp))

    ctx.status('start the transport, then drag across the pad · Latch keeps it sounding')
  },
})
