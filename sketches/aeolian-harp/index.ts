import {
  clamp,
  degree,
  isRunning,
  loadWorklet,
  mtof,
  noteName,
  reverb,
  rng,
  SCALE_NAMES,
  unlock,
  walker,
  type ScaleName,
} from '@core'
import { defineSketch } from '@runtime/sketch'
import workletUrl from './strings.worklet.js?url'

/**
 * The first physical model in the repo. A bank of Karplus-Strong strings —
 * strum them with the pointer, or let the wind do it: a seeded gust wanders
 * across the harp and brushes strings as it goes. Aeolian harps are the
 * original generative instrument; nobody plays one, you just decide where to
 * hang it.
 *
 * Also the first sketch where the *sound source* had to be a worklet rather
 * than the voices in @core: a string is a feedback delay shorter than one
 * render quantum, which native nodes cannot express.
 */

export default defineSketch({
  title: 'Aeolian Harp',
  description: 'Physical-model strings. Strum with the pointer, or let the wind wander over them.',
  tags: ['dsp', 'worklet', 'instrument', 'physical-model', 'generative'],
  status: 'promising',
  bpm: 80,

  params: {
    strings: { type: 'number', value: 10, min: 5, max: 16, step: 1 },
    root: { type: 'number', value: 50, min: 40, max: 64, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'pentatonicMajor', options: SCALE_NAMES },
    decay: { type: 'number', value: 0.7, min: 0, max: 1, step: 0.01 },
    brightness: { type: 'number', value: 0.6, min: 0.05, max: 1, step: 0.01 },
    sympathy: { type: 'number', value: 0.35, min: 0, max: 1, step: 0.01 },
    wind: { type: 'toggle', value: true },
    windForce: { type: 'number', value: 0.35, min: 0, max: 1, step: 0.01, label: 'Wind force' },
    seed: { type: 'number', value: 7, min: 1, max: 999, step: 1 },
  },

  notes: `
Why a worklet: a Karplus-Strong string is a feedback delay of sampleRate/f
samples — under 128 for anything above ~344 Hz — and a DelayNode inside a
cycle is clamped to one render quantum. This timbre is unreachable with the
nodes in @core. The delay line is shortened by the in-loop filter's phase
delay ((1-c)/c samples) or every string plays flat, worse on darker tones.

Sympathy was the experiment, and version one failed in an instructive way:
mixing each string with the bank mean inside the loop is provably stable
(spectral radius fb < 1) — and provably wrong. A single pluck is almost all
difference-modes, which decay at fb·(1−s), so default sympathy killed a
string in ~150 ms. Broadband mean-coupling IS damping; the algebra that
guaranteed stability guaranteed the over-damping too. Real sympathetic
strings exchange energy through shared partials, so v2 spills a quiet, darker
copy of each pluck into strings whose frequencies sit near integer ratios
(p:q ≤ 5, weighted 1/pq). Feed-forward, unconditionally stable, and it
sounds like the thing: strum the root hard and its octaves and fifths lift
behind it.

The wind is a walker, not a rhythm. It ignores the transport entirely —
aeolian harps don't follow a grid — so this is the only sketch whose
generative mode has no clock. Force around 0.3 is weather; past 0.7 it's a
storm and the tuning stops mattering.

Next: a bow (sustained stick-slip excitation), per-string stereo spread, a
palm-damping gesture, and a real bridge model — a shared resonator with
per-partial transfer, which is what continuous sympathetic coupling actually
needs.
`,

  async setup(ctx) {
    await loadWorklet(workletUrl)

    const rev = reverb(ctx.out, { mix: 0.32, seconds: 3.0 })
    // Level and saturation live inside the worklet (tanh body, bounded < 1);
    // this node is only a trim point.
    const bank = ctx.audio.createGain()
    bank.gain.value = 1.0

    const node = new AudioWorkletNode(ctx.audio, 'string-bank', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    })
    node.connect(bank).connect(rev.input)
    ctx.cleanup(() => {
      node.disconnect()
      bank.disconnect()
      rev.dispose()
    })

    // -- tuning ------------------------------------------------------------

    const fbOf = () => 0.975 + ctx.params.decay * 0.0245
    const toneOf = () => 0.15 + ctx.params.brightness * 0.85
    const sympOf = () => ctx.params.sympathy

    let midis: number[] = []
    /** Cosmetic per-string vibration state for the drawing. */
    let anim: { at: number; vel: number }[] = []

    const config = () => {
      const n = Math.round(ctx.params.strings)
      const root = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      // Seeded detune of ±2 cents per string — a real harp is never perfect,
      // and perfectly aligned strings make the sympathy sound like a chorus
      // effect instead of a body.
      const dr = rng(Math.round(ctx.params.seed) * 7919 + 11)
      midis = Array.from({ length: n }, (_, i) => degree(root, scale, i))
      const freqs = midis.map((m) => mtof(m) * Math.pow(2, dr.range(-2, 2) / 1200))
      node.port.postMessage({ type: 'config', freqs, fb: fbOf(), tone: toneOf(), symp: sympOf() })
      anim = midis.map(() => ({ at: -1e9, vel: 0 }))
    }
    config()

    for (const key of ['strings', 'root', 'scale', 'seed'] as const) ctx.onParam(key, config)
    ctx.onParam('decay', () => node.port.postMessage({ type: 'set', fb: fbOf() }))
    ctx.onParam('brightness', () => node.port.postMessage({ type: 'set', tone: toneOf() }))
    ctx.onParam('sympathy', () => node.port.postMessage({ type: 'set', symp: sympOf() }))

    const pluck = (i: number, vel: number, bright: number) => {
      if (i < 0 || i >= midis.length) return
      node.port.postMessage({ type: 'pluck', i, vel, bright })
      anim[i] = { at: performance.now() / 1000, vel }
    }

    // -- wind --------------------------------------------------------------

    let wr = rng(ctx.params.seed)
    let gust = walker(wr, { value: 0.5, step: 0.018, lo: 0.05, hi: 0.95 })
    ctx.onParam('seed', (v) => {
      wr = rng(v)
      gust = walker(wr, { value: 0.5, step: 0.018, lo: 0.05, hi: 0.95 })
    })

    // -- input -------------------------------------------------------------

    const colX = (i: number, w: number) => ((i + 0.5) / midis.length) * w
    let dragging = false
    let lastX = 0

    const brightAt = (y: number, h: number) => clamp(1 - y / h, 0.1, 1)

    const onDown = (e: PointerEvent) => {
      const rect = g.canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      dragging = true
      lastX = x
      g.canvas.setPointerCapture(e.pointerId)
      const i = Math.floor((x / rect.width) * midis.length)
      // The pointerdown is our user gesture — make sure audio is awake first.
      void unlock().then(() => pluck(i, 0.75, brightAt(y, rect.height)))
    }

    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      const rect = g.canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      // Pluck every string centre the pointer crossed since the last event —
      // that's what makes a fast sweep a strum rather than a click per string.
      const vel = clamp(0.25 + (Math.abs(x - lastX) / rect.width) * 5, 0.25, 1)
      for (let i = 0; i < midis.length; i++) {
        const c = colX(i, rect.width)
        if ((lastX < c && x >= c) || (lastX > c && x <= c)) pluck(i, vel, brightAt(y, rect.height))
      }
      lastX = x
    }

    const onUp = () => (dragging = false)

    // -- drawing -----------------------------------------------------------

    const g = ctx.canvas((g, { w, h, t, dt }) => {
      const N = midis.length
      const yTop = 16
      const yBot = h - 30

      // Wind: driven from the render loop, not the transport — an aeolian
      // harp has no tempo. Guarded on isRunning so brushes don't queue up
      // while the context is still suspended.
      if (ctx.params.wind && isRunning()) {
        gust.next()
        const force = ctx.params.windForce
        if (force > 0 && wr.chance(Math.min(0.5, force * 3.2 * dt))) {
          const i = clamp(Math.round(gust.value * (N - 1) + wr.gauss() * 1.4), 0, N - 1)
          pluck(i, 0.06 + wr.next() * 0.2 * (0.3 + force), 0.25 + wr.next() * 0.35)
        }
      }

      // wind band
      if (ctx.params.wind) {
        const gx = gust.value * w
        const bw = w * 0.16
        const grad = g.createLinearGradient(gx - bw, 0, gx + bw, 0)
        const a = 0.04 + ctx.params.windForce * 0.05
        grad.addColorStop(0, 'rgba(125,211,252,0)')
        grad.addColorStop(0.5, `rgba(125,211,252,${a})`)
        grad.addColorStop(1, 'rgba(125,211,252,0)')
        g.fillStyle = grad
        g.fillRect(gx - bw, yTop, bw * 2, yBot - yTop)
      }

      const now = performance.now() / 1000
      const tau = 0.35 + ctx.params.decay * 1.3

      for (let i = 0; i < N; i++) {
        const x = colX(i, w)
        const a = anim[i]
        // Cosmetic envelope only — real string state lives on the audio
        // thread; this just decays at a rate that feels like the sound.
        const env = a.vel * Math.exp(-(now - a.at) / tau)

        if (env > 0.004) {
          const bulge = env * 26 * Math.sin(t * Math.PI * 2 * 5.5 + i * 1.7)
          g.strokeStyle = `rgba(125, 211, 252, ${clamp(0.25 + env * 0.9, 0, 1)})`
          g.lineWidth = 1 + env * 1.6
          g.beginPath()
          g.moveTo(x, yTop)
          g.quadraticCurveTo(x + bulge * 2, (yTop + yBot) / 2, x, yBot)
          g.stroke()
        } else {
          g.strokeStyle = 'rgba(255,255,255,0.22)'
          g.lineWidth = 1
          g.beginPath()
          g.moveTo(x, yTop)
          g.lineTo(x, yBot)
          g.stroke()
        }

        g.fillStyle = env > 0.02 ? 'rgba(125,211,252,0.8)' : 'rgba(255,255,255,0.28)'
        g.font = '9px ui-monospace, monospace'
        g.textAlign = 'center'
        g.fillText(noteName(midis[i]), x, h - 12)
      }

      g.textAlign = 'left'
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.3)'
      g.fillText(
        ctx.params.wind ? `wind ${(ctx.params.windForce * 100) | 0}%` : 'wind off',
        10,
        14,
      )
      if (!isRunning()) {
        g.textAlign = 'center'
        g.fillStyle = 'rgba(255,255,255,0.3)'
        g.font = '11px ui-monospace, monospace'
        g.fillText('click anywhere to wake the audio, then drag across the strings', w / 2, h / 2)
      }
    })

    g.canvas.addEventListener('pointerdown', onDown)
    g.canvas.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    ctx.cleanup(() => window.removeEventListener('pointerup', onUp))

    ctx.status("drag across the strings to strum · the wind plays while you don't")
  },
})
