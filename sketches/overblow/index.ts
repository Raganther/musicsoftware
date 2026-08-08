import {
  clamp,
  loadWorklet,
  mtof,
  noteName,
  quantize,
  reverb,
  rng,
  SCALE_NAMES,
  unlock,
  type ScaleName,
} from '@core'
import { keyboard } from '@core/ui/keyboard'
import { defineSketch } from '@runtime/sketch'
import workletUrl from './bore.worklet.js?url'

/**
 * The register break, which is the strangest thing a wind player has to learn.
 *
 * A clarinet is a stopped cylinder, so it resonates only at odd multiples of
 * its fundamental. Open the register hole and it does not go up an octave like
 * everything else — it goes up a *twelfth*, and every fingering has to be
 * relearned above the break.
 *
 * The register hole is not a filter. It is a hole, a third of the way along.
 * Mode 3 has a pressure node exactly there and does not notice it; modes 1 and
 * 5 have pressure there and bleed away. Move the hole to a fifth of the way
 * along and mode 5 is the one with the node, so the instrument jumps two
 * octaves and a third instead. The interval you get is a fact about where you
 * put the hole — and here it is a slider.
 */

const PARTIALS = 12
/** How much of the wave the open vent absorbs on each pass. */
const LEAK = 0.14

export default defineSketch({
  title: 'Overblow',
  description: 'A reed and a bore. Put a hole in it and hear which mode survives.',
  tags: ['dsp', 'worklet', 'instrument', 'physical-model', 'synth'],
  status: 'sketch',
  bpm: 84,

  params: {
    vent: { type: 'toggle', value: false, label: 'Register vent' },
    hole: { type: 'number', value: 0.333, min: 0.12, max: 0.5, step: 0.002, label: 'Vent position' },
    pressure: { type: 'number', value: 0.46, min: 0.32, max: 0.76, step: 0.01, label: 'Breath' },
    stiffness: { type: 'number', value: 0.44, min: 0.15, max: 0.75, step: 0.01, label: 'Reed stiffness' },
    embouchure: { type: 'number', value: 0.7, min: 0.45, max: 0.95, step: 0.01 },
    bright: { type: 'number', value: 0.55, min: 0.1, max: 0.95, step: 0.01, label: 'Bell' },
    loss: { type: 'number', value: 0.985, min: 0.94, max: 0.999, step: 0.001, label: 'Bore loss' },
    breathNoise: { type: 'number', value: 0.04, min: 0, max: 0.25, step: 0.005, label: 'Breath noise' },
    glide: { type: 'number', value: 0.25, min: 0, max: 1 },
    root: { type: 'number', value: 50, min: 36, max: 72, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'dorian', options: SCALE_NAMES },
    seed: { type: 'number', value: 3, min: 1, max: 999, step: 1 },
  },

  notes: `
One delay line with an inverting reflection is a quarter-wave resonator, so
this bore has only odd modes and makes only odd harmonics. Measured from the
audio: even-harmonic energy sits **-44.9 dB** below odd, and the sounding
pitch lands at 0.998x the note asked for (-3.5 cents, from the fractional
delay and the bell filter's phase). Smith's reed table supplies the
nonlinearity; everything else is the loop.

**The vent is a hole, not a filter.** It shunts the pressure at one position,
and pressure is the *difference* of the two taps the wave crosses on its round
trip (the line stores the inbound wave before its inverting reflection). A
mode with a node at the hole has no pressure there and does not notice it, so
which mode survives is geometry:

| vent at | mode with a node there | measured |
| --- | --- | --- |
| 1/3 | 3 — a twelfth | x2.98 |
| 1/5 | 5 — two octaves + a third | x4.98 |
| 1/7 | 7 | x6.97 |
| 1/4 | none of 1,3,5 | x2.98, falls back to 3 |

Two earlier versions of that vent are recorded in the log; both were plausible
and both were wrong, and the audio said so in one run each.

**The reed has a playable window and both edges are real.** Below breath 0.34
it will not start; above 0.73 it blows shut and goes silent. The slider is set
to 0.32-0.76 so you can reach both — refusing to speak and choking are things
a reed does, and they are worth having under a finger. Level rises across the
window from peak 0.50 to 0.72.

Play with the QWERTY keys. Drag on the bore for breath; drag above the dashed
line to open the vent.
`,

  async setup(ctx) {
    await loadWorklet(workletUrl)

    const rev = reverb(ctx.out, { mix: 0.16, seconds: 1.4 })
    const node = new AudioWorkletNode(ctx.audio, 'bore', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    })
    const analyser = ctx.audio.createAnalyser()
    analyser.fftSize = 8192
    analyser.smoothingTimeConstant = 0.6
    node.connect(analyser)
    node.connect(rev.input)
    const spec = new Float32Array(analyser.frequencyBinCount)
    ctx.cleanup(() => {
      node.port.postMessage({ type: 'panic' })
      node.disconnect()
      analyser.disconnect()
      rev.dispose()
    })

    let r = rng(Math.round(ctx.params.seed))
    const seedWorklet = (v: number) => node.port.postMessage({ rs: (Math.round(v) * 2654435761) | 0 })
    seedWorklet(ctx.params.seed)
    ctx.onParam('seed', (v) => {
      r = rng(Math.round(v))
      seedWorklet(v)
    })

    // -- the instrument's settings ----------------------------------------

    const send = () => {
      node.port.postMessage({
        loss: ctx.params.loss,
        bright: ctx.params.bright,
        offset: ctx.params.embouchure,
        slope: -ctx.params.stiffness,
        noise: ctx.params.breathNoise,
        pos: ctx.params.hole,
        // 0 is an instant change of note, 1 is a slow scoop
        glide: 0.0006 + (1 - ctx.params.glide) ** 2 * 0.06,
        gain: 1.25,
      })
    }
    send()
    for (const k of ['loss', 'bright', 'embouchure', 'stiffness', 'breathNoise', 'glide', 'hole'] as const) {
      ctx.onParam(k, send)
    }

    let pointerVent = false
    const sendVent = () => node.port.postMessage({ vent: ctx.params.vent || pointerVent ? LEAK : 0 })
    sendVent()
    ctx.onParam('vent', sendVent)

    // -- playing ------------------------------------------------------------

    /** Held notes, last-note priority — one bore, one note. */
    const held: number[] = []
    let sounding = 0
    /** Pointer breath overrides the slider while the pointer is down. */
    let blown: number | null = null

    const pitchOf = (m: number) =>
      quantize(m, Math.round(ctx.params.root), ctx.params.scale as ScaleName)

    const blow = () => {
      const on = held.length > 0
      // Nobody blows the same twice: a little seeded variation per note stops
      // repeated notes being bit-identical.
      const jitter = on ? 1 + r.range(-0.05, 0.05) : 1
      const p = blown !== null ? blown : ctx.params.pressure
      node.port.postMessage({ pressure: on ? p * jitter : 0 })
    }

    // Remember what each key was quantised to: changing root or scale while a
    // key is held would otherwise re-quantise on release and strand the note.
    const voiced = new Map<number, number>()

    const noteOn = (m: number) => {
      const q = pitchOf(m)
      voiced.set(m, q)
      held.push(q)
      sounding = q
      node.port.postMessage({ freq: mtof(q), jump: held.length === 1 })
      blow()
      void unlock()
    }
    const noteOff = (m: number) => {
      const q = voiced.get(m) ?? pitchOf(m)
      voiced.delete(m)
      const i = held.lastIndexOf(q)
      if (i >= 0) held.splice(i, 1)
      if (held.length) {
        sounding = held[held.length - 1]
        node.port.postMessage({ freq: mtof(sounding) })
      }
      blow()
    }

    const scopeWrap = document.createElement('div')
    scopeWrap.style.cssText = 'position:relative;height:calc(100% - 118px);min-height:110px;'
    const kbWrap = document.createElement('div')
    kbWrap.style.cssText = 'margin-top:10px;'
    ctx.root.append(scopeWrap, kbWrap)

    const kb = keyboard(kbWrap, { low: 48, octaves: 2, onNoteOn: noteOn, onNoteOff: noteOff })
    ctx.cleanup(() => kb.dispose())

    // -- what the worklet can see and we cannot -----------------------------

    let level = 0
    let leak = 0
    node.port.onmessage = (e) => {
      level = e.data.peak ?? 0
      leak = e.data.leak ?? 0
    }
    ctx.cleanup(() => (node.port.onmessage = null))

    // -- drawing ------------------------------------------------------------

    const VENT_LINE = 0.16 // fraction of height: drag above this to open it

    const g = ctx.canvas((g, { w, h, t }) => {
      const boreTop = h * 0.08
      const boreBot = h * 0.58
      const midY = (boreTop + boreBot) / 2
      const x0 = 26
      const x1 = w - 26
      const span = boreBot - boreTop

      // Which mode is actually sounding — read out of the spectrum, not
      // assumed from the settings.
      analyser.getFloatFrequencyData(spec)
      const binHz = ctx.audio.sampleRate / analyser.fftSize
      const f0 = mtof(sounding)
      const magAt = (hz: number) => {
        const lo = Math.max(1, Math.floor((hz * 0.975) / binHz))
        const hi = Math.min(spec.length - 1, Math.ceil((hz * 1.025) / binHz))
        let m = -200
        for (let k = lo; k <= hi; k++) if (spec[k] > m) m = spec[k]
        return m
      }
      const partial: number[] = []
      let loudest = 1
      let loudestDb = -300
      for (let p = 1; p <= PARTIALS; p++) {
        const db = magAt(f0 * p)
        partial.push(db)
        if (db > loudestDb) {
          loudestDb = db
          loudest = p
        }
      }
      // The sounding mode is odd; even partials are harmonics of it, not modes.
      const mode = loudest % 2 === 1 ? loudest : Math.max(1, loudest - 1)

      // --- the bore in profile -------------------------------------------
      const halfAt = (u: number) => span * (0.16 + 0.26 * Math.pow(u, 4))
      g.strokeStyle = 'rgba(255,255,255,0.24)'
      g.lineWidth = 1.5
      for (const sign of [-1, 1]) {
        g.beginPath()
        for (let i = 0; i <= 60; i++) {
          const u = i / 60
          const x = x0 + (x1 - x0) * u
          const y = midY + sign * halfAt(u)
          i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
        }
        g.stroke()
      }

      // --- the standing wave ----------------------------------------------
      // Pressure in a stopped cylinder: antinode at the reed, node at the
      // bell. Mode k is cos(k·pi·u/2), so mode 1 is a quarter wave and mode 3
      // is three quarters of one.
      const amp = clamp(level * 1.4, 0, 1)
      const wob = Math.sin(t * Math.PI * 2 * 3.1)
      const env = (u: number) => Math.cos(((mode * Math.PI) / 2) * u)
      // The envelope, drawn even when the instantaneous wave happens to be
      // passing through zero — otherwise which mode is sounding blinks in and
      // out at the wobble rate and you cannot read it.
      for (const sign of [-1, 1]) {
        g.beginPath()
        for (let i = 0; i <= 160; i++) {
          const u = i / 160
          const x = x0 + (x1 - x0) * u
          const y = midY - sign * Math.abs(env(u)) * halfAt(u) * 0.88 * Math.max(0.25, amp)
          i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
        }
        g.strokeStyle = 'rgba(125,211,252,0.2)'
        g.lineWidth = 1
        g.stroke()
      }
      g.beginPath()
      for (let i = 0; i <= 160; i++) {
        const u = i / 160
        const x = x0 + (x1 - x0) * u
        const y = midY - env(u) * halfAt(u) * 0.88 * amp * wob
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
      }
      g.strokeStyle = `rgba(125,211,252,${0.3 + amp * 0.65})`
      g.lineWidth = 2
      g.stroke()

      // --- the vent hole ---------------------------------------------------
      const hu = ctx.params.hole
      const hx = x0 + (x1 - x0) * hu
      const nodeHere = Math.abs(env(hu))
      const open = leak > LEAK * 0.5
      const hy = midY - halfAt(hu)
      g.strokeStyle = open ? 'rgba(251,191,36,0.9)' : 'rgba(255,255,255,0.3)'
      g.lineWidth = open ? 2.5 : 1.5
      g.beginPath()
      g.moveTo(hx, hy - (open ? 9 : 4))
      g.lineTo(hx, hy + 1)
      g.stroke()
      g.font = '9px ui-monospace, monospace'
      g.textAlign = 'center'
      // A mode with a node at the hole cannot feel it — that is the whole trick.
      g.fillStyle = nodeHere < 0.18 ? 'rgba(134,239,172,0.75)' : 'rgba(251,191,36,0.7)'
      g.fillText(
        nodeHere < 0.18 ? 'node here — this mode survives' : 'pressure here — this mode bleeds',
        hx,
        hy - (open ? 14 : 9),
      )

      g.textAlign = 'left'
      g.fillStyle = 'rgba(255,255,255,0.3)'
      g.fillText('reed', x0, boreBot + 14)
      g.textAlign = 'right'
      g.fillText('bell', x1, boreBot + 14)

      // the vent gesture line
      const vy = h * VENT_LINE
      g.strokeStyle = open ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.1)'
      g.setLineDash([4, 5])
      g.beginPath()
      g.moveTo(x0, vy)
      g.lineTo(x1, vy)
      g.stroke()
      g.setLineDash([])

      // --- the harmonic ladder --------------------------------------------
      const top = boreBot + 34
      const bot = h - 16
      const bwid = (x1 - x0) / PARTIALS
      for (let p = 1; p <= PARTIALS; p++) {
        // -75 dB is the floor here, and the odd/even gap is ~46 dB, so a
        // wider mapping would flatten the one thing these bars are for.
        const norm = clamp((partial[p - 1] + 75) / 55, 0, 1)
        const bh = norm * (bot - top)
        const x = x0 + (p - 1) * bwid
        g.fillStyle =
          p % 2 === 1
            ? `rgba(125,211,252,${0.22 + norm * 0.68})`
            : `rgba(244,114,182,${0.18 + norm * 0.72})`
        g.fillRect(x + 2, bot - bh, bwid - 4, bh)
        g.fillStyle = p === mode ? 'rgba(251,191,36,0.85)' : 'rgba(255,255,255,0.26)'
        g.textAlign = 'center'
        g.fillText(String(p), x + bwid / 2, h - 4)
      }

      // --- readout ---------------------------------------------------------
      g.textAlign = 'left'
      g.fillStyle = 'rgba(255,255,255,0.42)'
      const semis = Math.round(12 * Math.log2(mode))
      g.fillText(
        held.length
          ? `${noteName(sounding)} · sounding mode ${mode}${mode > 1 ? ` — ${semis} semitones up` : ''}`
          : 'press a key — a w s e d f t g y h u j k',
        x0,
        top - 8,
      )
      g.textAlign = 'right'
      g.fillStyle = 'rgba(125,211,252,0.5)'
      g.fillText('odd', x1 - 32, top - 8)
      g.fillStyle = 'rgba(244,114,182,0.5)'
      g.fillText('even', x1, top - 8)
    }, scopeWrap)

    // -- breath by pointer ---------------------------------------------------

    const breathAt = (e: PointerEvent) => {
      const rect = g.canvas.getBoundingClientRect()
      const u = clamp((e.clientY - rect.top) / rect.height, 0, 1)
      pointerVent = u < VENT_LINE
      // matched to the slider's range: the reed will not start below ~0.34
      // and chokes above ~0.73, and both edges are worth being able to reach
      blown = clamp(0.32 + (1 - u) * 0.44, 0.32, 0.76)
      sendVent()
      blow()
    }
    const onDown = (e: PointerEvent) => {
      g.canvas.setPointerCapture(e.pointerId)
      void unlock()
      breathAt(e)
    }
    const onMove = (e: PointerEvent) => {
      if (blown !== null) breathAt(e)
    }
    const onUp = () => {
      blown = null
      pointerVent = false
      sendVent()
      blow()
    }
    g.canvas.addEventListener('pointerdown', onDown)
    g.canvas.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    ctx.cleanup(() => window.removeEventListener('pointerup', onUp))

    ctx.status('keys play · drag the bore for breath · drag to the top to open the register vent')
  },
})
