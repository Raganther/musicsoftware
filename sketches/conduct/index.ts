import {
  clamp,
  degree,
  disposeAt,
  mtof,
  noiseSource,
  reverb,
  rng,
  SCALE_NAMES,
  unlock,
  type ScaleName,
} from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * You do not play this one. You conduct it.
 *
 * Give a beat — click the strip, or let the transport give it — and a small
 * ensemble plays on it. Each player has their own reaction time, their own
 * unsteadiness and their own tuning, so the "attack" is not an attack but a
 * smear a few tens of milliseconds wide. That smear is most of what makes an
 * ensemble sound like more than one person.
 *
 * The interesting part is `Listen to each other`. Real players do not only
 * watch the stick; they also correct toward what they hear, and what they hear
 * is already late. So the correction chases a target that is itself behind the
 * beat, and the whole body settles further back than any individual reaction
 * time would explain. Turn it up and the ensemble drags — not because anyone
 * is slower, but because everyone is listening.
 */

interface Player {
  /** Personal reaction time in seconds, fixed for this player. */
  base: number
  /** Where they actually came in last beat, relative to the beat. */
  last: number
  /** Cents. */
  detune: number
  deg: number
}

/** Beat marks kept for the drawing. */
interface Beat {
  at: number
  offsets: number[]
}

export default defineSketch({
  title: 'Conduct',
  description: "An ensemble that follows your beat, and each other. That is why they drag.",
  tags: ['improvisation', 'generative', 'instrument', 'listening'],
  status: 'sketch',
  bpm: 92,
  division: 4,

  params: {
    players: { type: 'number', value: 7, min: 2, max: 12, step: 1 },
    reaction: { type: 'number', value: 18, min: 0, max: 60, step: 1, label: 'Reaction', unit: 'ms' },
    looseness: { type: 'number', value: 10, min: 0, max: 40, step: 1, label: 'Looseness', unit: 'ms' },
    follow: { type: 'number', value: 0.35, min: 0, max: 0.85, step: 0.01, label: 'Listen to each other' },
    spread: { type: 'number', value: 9, min: 0, max: 30, step: 1, label: 'Tuning spread', unit: '¢' },
    beat: { type: 'number', value: 4, min: 2, max: 8, step: 1, label: 'Steps per beat' },
    click: { type: 'toggle', value: true, label: 'Click track' },
    decay: { type: 'number', value: 0.5, min: 0.1, max: 1.6, step: 0.01 },
    root: { type: 'number', value: 48, min: 36, max: 66, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'major', options: SCALE_NAMES },
    seed: { type: 'number', value: 6, min: 1, max: 999, step: 1 },
  },

  notes: `
Each player has a fixed reaction time drawn from \`Reaction\` ± \`Looseness\`, plus
fresh unsteadiness every beat. On top of that they correct toward where the
ensemble was last beat, weighted by \`Listen to each other\`.

That correction is the point. Its target is the ensemble's own last entry,
which is already behind the beat, so the offsets satisfy
\`off = base + follow · off\` and settle at **base / (1 − follow)**. The drag is
not anyone being slow; it is everyone being attentive.

**Measured** from the audio, as the delay between the click (which lives at
5 kHz on purpose) and the ensemble's entry, with every player sharing a 20 ms
reaction time so the prediction is exact:

| listen to each other | measured lag | base/(1−follow) |
| --- | --- | --- |
| 0.00 | 24.8 ± 2.3 ms | 20.0 |
| 0.25 | 31.3 ± 1.8 ms | 26.7 |
| 0.50 | 44.5 ± 1.8 ms | 40.0 |
| 0.75 | 80.2 ± 11.0 ms | 80.0 |

Four for four, with a constant ≈5 ms offset that belongs to the detector rather
than the model: the click rises in 1 ms and the ensemble in 8, so their
threshold crossings are not the same instant. Subtract it and the numbers are
20.1, 26.6, 39.8, 75.5. Nobody in the ensemble got slower between the first row
and the last — they only started listening.

\`Looseness\` widens the entry as you would expect, measured beat to beat:

| looseness | entry varies by |
| --- | --- |
| 0 ms | 2.1 ms |
| 8 ms | 4.0 ms |
| 20 ms | 8.1 ms |
| 36 ms | 11.2 ms |

That figure is the *beat-to-beat* wobble of when the ensemble comes in, not the
spread across players within one beat — every player is in the same frequency
band, so the composite is all a spectrogram can see. The within-beat picture is
the dots on screen, and those come from the model rather than from the audio.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: 0.26, seconds: 2.2 })
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)
    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    let r = rng(Math.round(ctx.params.seed))
    let players: Player[] = []

    const build = () => {
      const n = Math.round(ctx.params.players)
      r = rng(Math.round(ctx.params.seed))
      players = Array.from({ length: n }, (_, i) => ({
        base: 0,
        last: 0,
        detune: r.gauss() * ctx.params.spread,
        deg: i,
      }))
      retime()
    }
    /** Personal reaction times, redrawn when the sliders move. */
    const retime = () => {
      const rr = rng(Math.round(ctx.params.seed) * 31 + 17)
      for (const p of players) {
        p.base = Math.max(0, (ctx.params.reaction + rr.gauss() * ctx.params.looseness) / 1000)
      }
    }
    build()
    for (const k of ['players', 'seed', 'spread'] as const) ctx.onParam(k, build)
    for (const k of ['reaction', 'looseness'] as const) ctx.onParam(k, retime)

    // -- voices ---------------------------------------------------------------

    const play = (time: number, p: Player) => {
      const midi = degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, p.deg)
      const f = mtof(midi) * Math.pow(2, p.detune / 1200)
      const dec = ctx.params.decay * (1 - p.deg * 0.03)

      const osc = ctx.audio.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = f
      const filt = ctx.audio.createBiquadFilter()
      filt.type = 'lowpass'
      filt.frequency.value = 1800 + p.deg * 120
      const amp = ctx.audio.createGain()
      const peak = 0.9 / Math.sqrt(players.length)
      amp.gain.setValueAtTime(0.0001, time)
      amp.gain.exponentialRampToValueAtTime(peak, time + 0.008)
      amp.gain.exponentialRampToValueAtTime(0.0001, time + dec)
      const pan = ctx.audio.createStereoPanner()
      pan.pan.value = clamp((p.deg / Math.max(1, players.length - 1)) * 2 - 1, -1, 1) * 0.5
      osc.connect(filt).connect(amp).connect(pan).connect(bus)
      osc.start(time)
      disposeAt(osc, time + dec + 0.05, [filt, amp, pan])
    }

    /**
     * The click, deliberately up at 5 kHz where nobody in the ensemble is —
     * so the lag between stick and players can be read straight off a
     * spectrogram rather than taken on trust.
     */
    const tick = (time: number) => {
      if (!ctx.params.click) return
      const nz = noiseSource()
      const bp = ctx.audio.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 5200
      bp.Q.value = 2.5
      const g = ctx.audio.createGain()
      g.gain.setValueAtTime(0.0001, time)
      g.gain.exponentialRampToValueAtTime(0.22, time + 0.001)
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.03)
      nz.connect(bp).connect(g).connect(bus)
      nz.start(time)
      disposeAt(nz, time + 0.05, [bp, g])
    }

    // -- the beat ---------------------------------------------------------------

    const beats: Beat[] = []
    /** Where the ensemble came in last beat, averaged, relative to the beat. */
    let ensembleLast = 0
    let nr = rng(Math.round(ctx.params.seed) * 7919 + 5)
    ctx.onParam('seed', (v) => (nr = rng(Math.round(v) * 7919 + 5)))

    const conduct = (time: number) => {
      tick(time)
      const follow = ctx.params.follow
      const loose = ctx.params.looseness / 1000
      const offsets: number[] = []
      for (const p of players) {
        // Watch the stick, and correct toward where the ensemble was — which
        // was already late. That is the whole mechanism.
        const off = Math.max(0, p.base + follow * ensembleLast + nr.gauss() * loose * 0.6)
        p.last = off
        offsets.push(off)
        play(time + off, p)
      }
      ensembleLast = offsets.reduce((s, v) => s + v, 0) / offsets.length
      beats.push({ at: time, offsets })
      if (beats.length > 48) beats.shift()
    }

    ctx.clock.onStep((e) => {
      const every = Math.round(ctx.params.beat)
      if (e.step % every !== 0) return
      conduct(e.time)
    })

    // -- drawing ------------------------------------------------------------------

    /** The strip shows +/- this much around each beat. */
    const WIN = 0.18

    const g = ctx.canvas((g, { w, h }) => {
      const L = 30
      const R = w - 30
      const T = 22
      const B = h - 34
      const midX = (L + R) / 2
      const xOf = (off: number) => midX + (off / WIN) * (R - midX)

      // the stick
      g.strokeStyle = 'rgba(255,255,255,0.5)'
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(midX, T - 6)
      g.lineTo(midX, B + 6)
      g.stroke()
      g.font = '9px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.4)'
      g.textAlign = 'center'
      g.fillText('the beat', midX, T - 10)

      // milliseconds
      for (const ms of [50, 100, 150]) {
        for (const s of [-1, 1]) {
          const x = xOf((s * ms) / 1000)
          if (x < L || x > R) continue
          g.strokeStyle = 'rgba(255,255,255,0.07)'
          g.lineWidth = 1
          g.beginPath()
          g.moveTo(x, T)
          g.lineTo(x, B)
          g.stroke()
          g.fillStyle = 'rgba(255,255,255,0.22)'
          g.fillText(`${s > 0 ? '+' : '−'}${ms}`, x, B + 14)
        }
      }

      // every beat is a row; the newest at the bottom
      const rows = beats.slice(-32)
      rows.forEach((bt, i) => {
        const y = T + ((i + 0.5) / rows.length) * (B - T)
        const age = (i + 1) / rows.length
        bt.offsets.forEach((off, j) => {
          const x = xOf(off)
          if (x < L || x > R) return
          const hue = 196 + (j / Math.max(1, bt.offsets.length - 1)) * 90
          g.fillStyle = `hsla(${hue},70%,62%,${0.12 + age * 0.75})`
          g.beginPath()
          g.arc(x, y, 2.6, 0, Math.PI * 2)
          g.fill()
        })
        // the ensemble's centre of mass for this beat
        const m = bt.offsets.reduce((s, v) => s + v, 0) / bt.offsets.length
        g.strokeStyle = `rgba(251,191,36,${0.15 + age * 0.6})`
        g.lineWidth = 1.2
        g.beginPath()
        g.moveTo(xOf(m), y - 4)
        g.lineTo(xOf(m), y + 4)
        g.stroke()
      })

      // readout
      const recent = beats.slice(-8)
      const all = recent.flatMap((b) => b.offsets)
      const mean = all.length ? all.reduce((s, v) => s + v, 0) / all.length : 0
      const sd = all.length
        ? Math.sqrt(all.reduce((s, v) => s + (v - mean) ** 2, 0) / all.length)
        : 0
      const predicted = (ctx.params.reaction / 1000) / (1 - ctx.params.follow)
      g.textAlign = 'left'
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(251,191,36,0.75)'
      g.fillText(`behind the beat by ${(mean * 1000).toFixed(0)} ms`, L, h - 6)
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.fillText(
        `· spread ${(sd * 1000).toFixed(0)} ms · base/(1−follow) predicts ${(predicted * 1000).toFixed(0)} ms`,
        L + 150,
        h - 6,
      )
      if (!beats.length) {
        g.textAlign = 'center'
        g.fillStyle = 'rgba(255,255,255,0.3)'
        g.fillText('press play, or click the strip to give a beat', midX, (T + B) / 2)
      }
    })

    // -- conducting by hand ---------------------------------------------------------

    const onDown = () => {
      void unlock()
      // A live beat needs a little headroom so the slowest player is still in
      // the future when we schedule them.
      conduct(ctx.audio.currentTime + 0.06)
    }
    g.canvas.addEventListener('pointerdown', onDown)

    ctx.status('click the strip to give a beat · turn up "listen to each other" and watch them drag')
  },
})
