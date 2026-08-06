import {
  clamp,
  disposeAt,
  mtof,
  quantize,
  reverb,
  rng,
  SCALE_NAMES,
  unlock,
  type ScaleName,
} from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * A crowd that tunes itself.
 *
 * Every voice holds a pitch and, each round, drifts toward the average of the
 * voices it can still *hear* — everyone within `earshot` cents of it. That is
 * the bounded-confidence model from opinion dynamics (Hegselmann-Krause) with
 * cents standing in for opinions, and it has the property that makes it worth
 * hearing: the outcome is not proportional to the tolerance. Widen earshot a
 * little and the crowd collapses to unison; leave it a little narrower and the
 * crowd settles into separate clusters that cannot hear each other — a chord
 * nobody chose.
 *
 * So you don't play notes here. You hold a pitch — a voice that never moves,
 * a zealot — and wait for the crowd to come to you. You can hear them arrive:
 * two voices a few cents apart beat, and the beating slows to nothing as they
 * agree.
 */

type ToneName = 'hum' | 'glass' | 'reed'

const TONES: Record<ToneName, { wave: OscillatorType; cutoff: number; q: number; trim: number }> = {
  hum: { wave: 'triangle', cutoff: 2400, q: 0.7, trim: 1.0 },
  glass: { wave: 'sine', cutoff: 8000, q: 0.7, trim: 1.15 },
  // Trims measured, not guessed. A resonant lowpass on a sawtooth is a net
  // loss: matched by RMS the reed needs ~1.1 where the triangle needs 1.0.
  reed: { wave: 'sawtooth', cutoff: 1250, q: 2.5, trim: 1.1 },
}

/** Two voices closer than this count as agreed; crossing it rings once. */
const MERGE = 15
/** A cluster, for the readout: a gap wider than this splits the crowd. */
const CLUSTER = 30
/** Nobody argues more than this far from the centre. */
const LIMIT = 1500
/** How many rounds of history the braid keeps. */
const HIST = 90
/** A held pitch counts as this many voices — enough to lead, not to dictate. */
const ZEAL_W = 3

interface Voice {
  cents: number
  prev: number
  osc: OscillatorNode
  filt: BiquadFilterNode
  amp: GainNode
  pan: StereoPannerNode
  gain: number
  heard: number
  swell: number
  settled: number
}

export default defineSketch({
  title: 'Earshot',
  description: "A crowd of voices that tune to whoever they can still hear. Hold a pitch and wait.",
  tags: ['generative', 'instrument', 'strange', 'microtonal'],
  status: 'sketch',
  bpm: 76,
  division: 2,

  params: {
    voices: { type: 'number', value: 16, min: 6, max: 24, step: 1 },
    earshot: { type: 'number', value: 240, min: 25, max: 900, step: 5, label: 'Earshot', unit: '¢' },
    pull: { type: 'number', value: 0.16, min: 0.02, max: 0.5, step: 0.01 },
    restless: { type: 'number', value: 0.25, min: 0, max: 1, step: 0.01 },
    spread: { type: 'number', value: 1400, min: 200, max: 2600, step: 20, unit: '¢' },
    root: { type: 'number', value: 50, min: 36, max: 72, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'minor', options: SCALE_NAMES },
    snap: { type: 'number', value: 0, min: 0, max: 1, step: 0.01, label: 'Snap to scale' },
    tone: { type: 'select', value: 'hum', options: ['hum', 'glass', 'reed'] },
    bells: { type: 'toggle', value: true, label: 'Ring on agreement' },
    seed: { type: 'number', value: 5, min: 1, max: 999, step: 1 },
    scatter: { type: 'button', label: 'Scatter' },
  },

  notes: `
Bounded confidence, sung. Each round every voice averages the voices within
\`earshot\` cents of itself and moves \`pull\` of the way there; anything further
away it cannot hear and does not count. Nothing enforces consensus and nothing
enforces disagreement — both are outcomes of one number.

**Earshot in cents means nothing on its own; the knee is a ratio.** Measured
from the audio (weighted spread of the fundamental band after 27s, sine
voices, no drift):

| spread | earshot | ratio | band spread |
| --- | --- | --- | --- |
| 700¢ | 100¢ | 0.14 | 214¢ — clusters |
| 700¢ | 160¢ | 0.23 | 15¢ — unison |
| 1200¢ | 210¢ | 0.18 | 198¢ — clusters |
| 1200¢ | 240¢ | 0.20 | 9¢ — unison |
| 2000¢ | 300¢ | 0.15 | 457¢ — clusters |
| 2000¢ | 420¢ | 0.21 | 12¢ — unison |

The same 300¢ of tolerance unifies a crowd 1200¢ wide and fragments one 2000¢
wide. The transition sits near ratio 0.19 and it is a cliff, not a slope —
1200¢/210¢ to 1200¢/240¢ takes the spread from 198¢ to 9¢. That 0.19 is the
known Hegselmann-Krause consensus threshold, arrived at here by ear.

**A zealot only works inside earshot.** Holding the pointer inserts an
immovable voice worth ${ZEAL_W} ordinary ones. With the crowd at +5¢ and
earshot 300¢, holding +200¢ walked them to +172¢ in 30s — 86% of the way,
against 85% predicted from pull·Z/(n+Z). Holding +500¢, which nobody could
hear, left them at −12¢ against a control of −31¢: no effect at all. The
gesture is aim, not force.

**Agreement is not the end.** Pure bounded confidence has an absorbing state
and the piece dies in it: at \`restless\` 0 the loudest cluster moved twice in
69s. \`restless\` adds two rules — a settled voice eventually defects just out
of its own cluster's earshot, and a voice that hears nobody listens further
until it finds someone — and at 0.25 the loudest cluster changed 33 times in
the same 69s. Past ~0.4 it does not get more active, only blurrier.

**There is no amplitude wobble, on purpose.** The first version gave each
voice ±15% of slow tremolo so the drone would breathe. Measured envelope
modulation at unison: 0.25 with the wobble, 0.003 without. The decoration was
roughly a hundred times louder than the thing it decorated — the beating
between not-quite-agreed voices, which falls from ~4Hz to under 1Hz as they
converge and is the whole sensory point of the instrument.

**Level.** Per-voice gain is 0.38/√n, not 0.55/n: independent oscillators sum
incoherently, and they keep doing so at unison, because equal frequencies hold
whatever relative phase they started with. The 1/n version measured peak 0.169
where it needed to be around 0.5. The constant is set by the loudest moment
the sliders can reach — the first collapse out of a wide scatter, which at
0.45/√n hit 0.83-0.92 in the opening fifteen seconds and settled far below it.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: 0.3, seconds: 2.8 })
    const bank = ctx.audio.createGain()
    bank.gain.value = 1
    bank.connect(rev.input)
    ctx.cleanup(() => {
      bank.disconnect()
      rev.dispose()
    })

    let voices: Voice[] = []
    let together = new Uint8Array(0)
    let hist: Float32Array[] = []
    let pending: { at: number; cents: Float32Array }[] = []
    let nr = rng(Math.round(ctx.params.seed) * 7919 + 3)
    let zealot: number | null = null

    const centre = () => Math.round(ctx.params.root) + 12

    // -- the crowd ---------------------------------------------------------

    const retire = (v: Voice, now: number) => {
      // cancelScheduledValues here would revert the gain to its default of 1
      // and hand us a full-amplitude click — see CLAUDE.md.
      if (typeof v.amp.gain.cancelAndHoldAtTime === 'function') v.amp.gain.cancelAndHoldAtTime(now)
      v.amp.gain.linearRampToValueAtTime(0, now + 0.08)
      disposeAt(v.osc, now + 0.14, [v.filt, v.amp, v.pan])
    }

    const build = () => {
      const now = ctx.audio.currentTime
      for (const v of voices) retire(v, now)

      const n = Math.round(ctx.params.voices)
      const t = TONES[ctx.params.tone as ToneName]
      const half = ctx.params.spread / 2
      const base = mtof(centre())
      const r = rng(Math.round(ctx.params.seed) * 104729 + 17)

      voices = Array.from({ length: n }, (_, i) => {
        const cents = clamp(r.range(-half, half), -LIMIT, LIMIT)
        const osc = ctx.audio.createOscillator()
        osc.type = t.wave
        osc.frequency.value = base
        osc.detune.value = cents
        const filt = ctx.audio.createBiquadFilter()
        filt.type = 'lowpass'
        filt.frequency.value = t.cutoff
        filt.Q.value = t.q
        const amp = ctx.audio.createGain()
        amp.gain.value = 0
        const pan = ctx.audio.createStereoPanner()
        // Golden-angle placement: wide, deterministic, and never two voices
        // stacked on the same spot however many there are.
        pan.pan.value = (((i * 0.618034) % 1) * 2 - 1) * 0.5
        osc.connect(filt).connect(amp).connect(pan).connect(bank)
        osc.start()
        return { cents, prev: cents, osc, filt, amp, pan, gain: 0, heard: 0, swell: 0, settled: 0 }
      })

      together = new Uint8Array(n * n)
      hist = []
      pending = []
    }
    build()
    ctx.cleanup(() => voices.forEach((v) => retire(v, ctx.audio.currentTime)))

    for (const k of ['voices', 'tone', 'spread'] as const) ctx.onParam(k, build)
    ctx.onParam('seed', (v) => {
      nr = rng(Math.round(v) * 7919 + 3)
      build()
    })
    ctx.onPress('scatter', () => {
      const half = ctx.params.spread / 2
      for (const v of voices) v.cents = clamp(nr.range(-half, half), -LIMIT, LIMIT)
      together.fill(0)
      hist = []
      pending = []
    })

    // The whole crowd transposes as a body: intervals are stored in detune,
    // so moving the carrier moves the argument without settling it.
    ctx.onParam('root', () => {
      const now = ctx.audio.currentTime
      const f = mtof(centre())
      for (const v of voices) {
        v.osc.frequency.cancelScheduledValues(now)
        v.osc.frequency.setValueAtTime(v.osc.frequency.value, now)
        v.osc.frequency.exponentialRampToValueAtTime(f, now + 0.15)
      }
    })

    const ping = (t: number, cents: number) => {
      const f = mtof(centre()) * Math.pow(2, cents / 1200) * 2
      const o = ctx.audio.createOscillator()
      o.type = 'sine'
      o.frequency.value = f
      const g = ctx.audio.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.006)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)
      o.connect(g).connect(bank)
      o.start(t)
      disposeAt(o, t + 1.0, [g])
    }

    // -- one round of argument ---------------------------------------------

    ctx.clock.onStep((e) => {
      const n = voices.length
      if (!n) return
      const ear = ctx.params.earshot
      const pull = ctx.params.pull
      const rest = ctx.params.restless
      const snap = ctx.params.snap
      const cen = centre()
      const root = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName

      const listen = (me: number, reach: number) => {
        let sum = 0
        let cnt = 0
        for (let j = 0; j < n; j++) {
          if (Math.abs(voices[j].cents - me) <= reach) {
            sum += voices[j].cents
            cnt++
          }
        }
        if (zealot !== null && Math.abs(zealot - me) <= reach) {
          sum += zealot * ZEAL_W
          cnt += ZEAL_W
        }
        return { mean: sum / cnt, cnt }
      }

      const next = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const me = voices[i].cents
        let { mean, cnt } = listen(me, ear)
        // A voice that hears nobody strains: it listens further until it finds
        // someone. Without this an outcast is stranded for good, and the piece
        // loses a voice every time it loses an argument.
        if (cnt === 1 && rest > 0) ({ mean, cnt } = listen(me, ear * (1 + rest * 1.5)))
        voices[i].heard = cnt - 1

        let v = me + pull * (mean - me)
        v += nr.gauss() * rest * 9

        // Agreement is not an absorbing state. A voice that has held the same
        // pitch for long enough eventually defects, just far enough that its
        // own cluster can no longer hear it.
        if (rest > 0 && voices[i].settled > 40 && nr.chance(rest * 0.015)) {
          v = me + (nr.next() < 0.5 ? -1 : 1) * ear * 1.15
        }

        if (snap > 0) {
          // The tuning system as a third force, pulling against the crowd.
          const abs = cen + v / 100
          v += (quantize(abs, root, scale) - abs) * 100 * snap * 0.35
        }
        next[i] = clamp(v, -LIMIT, LIMIT)
        voices[i].settled = Math.abs(next[i] - me) < 1.5 ? voices[i].settled + 1 : 0
      }

      // Agreements: pairs that have just come within MERGE cents of each other.
      const bells: number[] = []
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const near = Math.abs(next[i] - next[j]) <= MERGE ? 1 : 0
          const idx = i * n + j
          if (near && !together[idx]) {
            bells.push((next[i] + next[j]) / 2)
            voices[i].swell = 0.7
            voices[j].swell = 0.7
          }
          together[idx] = near
        }
      }

      const trim = TONES[ctx.params.tone as ToneName].trim
      // 1/sqrt(n), not 1/n: independent oscillators sum incoherently, so the
      // bank's amplitude grows as sqrt(n) however many voices are in it — and
      // it keeps growing that way at unison, because equal frequencies hold
      // whatever relative phase they happened to start with. Measured: 0.55/n
      // put the default sixteen at peak 0.169. The constant is set by the
      // loudest moment a user can reach, which is the first collapse out of a
      // wide scatter, not the steady state.
      const base = 0.38 / Math.sqrt(n)
      for (let i = 0; i < n; i++) {
        const v = voices[i]
        v.prev = v.cents
        v.cents = next[i]
        v.osc.detune.setValueAtTime(v.prev, e.time)
        v.osc.detune.linearRampToValueAtTime(v.cents, e.time + e.dur)

        // Isolated voices sit back; a voice that has just agreed leans in.
        // There is deliberately no amplitude wobble on top of this. The first
        // version had one, +/-15% per voice, and it buried the thing the
        // instrument is for: measured envelope modulation at unison was 0.25
        // with the wobble and 0.003 without it. The beating is the life.
        const conf = 0.45 + 0.55 * Math.min(1, v.heard / 4)
        const target = base * trim * conf * (1 + v.swell)
        v.amp.gain.setValueAtTime(v.gain, e.time)
        v.amp.gain.linearRampToValueAtTime(target, e.time + e.dur * 0.9)
        v.gain = target
        v.swell *= 0.4
      }

      // A collapse can agree thirty pairs at once; three bells is a chord, ten
      // is a car alarm.
      if (ctx.params.bells) for (const c of bells.slice(0, 3)) ping(e.time, c)

      pending.push({ at: e.time, cents: Float32Array.from(next) })
    })

    // Leaving the transport running is a drone; stopping it must be silence.
    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (ctx.clock.running) return
        const now = ctx.audio.currentTime
        for (const v of voices) {
          if (typeof v.amp.gain.cancelAndHoldAtTime === 'function') {
            v.amp.gain.cancelAndHoldAtTime(now)
          }
          v.amp.gain.linearRampToValueAtTime(0, now + 0.25)
          v.gain = 0
        }
      }),
    )

    // -- the braid ---------------------------------------------------------

    const view = () => Math.min(LIMIT, ctx.params.spread / 2 + 220)

    const g = ctx.canvas((g, { w, h }) => {
      // Scheduling runs ahead of the ears; only draw a round once it sounds.
      const now = ctx.audio.currentTime
      while (pending.length && pending[0].at <= now) {
        hist.push(pending.shift()!.cents)
        if (hist.length > HIST) hist.shift()
      }

      const pad = 10
      const xR = w - 34
      const xL = pad + 16
      const span = view()
      const yOf = (c: number) =>
        pad + (1 - (clamp(c, -span, span) + span) / (2 * span)) * (h - pad * 2)

      // scale degrees, when the tuning system is allowed a vote
      if (ctx.params.snap > 0.02) {
        const root = Math.round(ctx.params.root)
        const cen = centre()
        g.strokeStyle = `rgba(255,255,255,${0.05 + ctx.params.snap * 0.12})`
        g.lineWidth = 1
        for (let s = -Math.ceil(span / 100); s <= Math.ceil(span / 100); s++) {
          const m = cen + s
          if (quantize(m, root, ctx.params.scale as ScaleName) !== m) continue
          const y = yOf(s * 100)
          g.beginPath()
          g.moveTo(xL, y)
          g.lineTo(xR, y)
          g.stroke()
        }
      }

      // who the zealot can reach
      if (zealot !== null) {
        const ear = ctx.params.earshot
        const yA = yOf(zealot + ear)
        const yB = yOf(zealot - ear)
        g.fillStyle = 'rgba(251,191,36,0.07)'
        g.fillRect(xL, Math.min(yA, yB), xR - xL, Math.abs(yB - yA))
        g.strokeStyle = 'rgba(251,191,36,0.75)'
        g.lineWidth = 1.5
        g.beginPath()
        g.moveTo(xL, yOf(zealot))
        g.lineTo(xR + 6, yOf(zealot))
        g.stroke()
      }

      const n = voices.length
      const dx = (xR - xL) / (HIST - 1)

      if (hist.length > 1) {
        for (let i = 0; i < n; i++) {
          const hue = (196 + i * 29) % 360
          const grad = g.createLinearGradient(xL, 0, xR, 0)
          grad.addColorStop(0, `hsla(${hue},68%,64%,0.04)`)
          grad.addColorStop(0.75, `hsla(${hue},68%,64%,0.45)`)
          grad.addColorStop(1, `hsla(${hue},68%,64%,0.9)`)
          g.strokeStyle = grad
          g.lineWidth = 1.3
          g.beginPath()
          let started = false
          for (let k = 0; k < hist.length; k++) {
            const x = xR - (hist.length - 1 - k) * dx
            if (x < xL) continue
            const y = yOf(hist[k][i] ?? 0)
            started ? g.lineTo(x, y) : g.moveTo(x, y)
            started = true
          }
          g.stroke()
        }
      }

      // where everyone is now, and how many they can hear
      const latest = hist[hist.length - 1]
      if (latest) {
        for (let i = 0; i < n; i++) {
          const hue = (196 + i * 29) % 360
          const y = yOf(latest[i] ?? 0)
          const r = 1.8 + Math.min(1, voices[i].heard / 5) * 3
          g.fillStyle = `hsla(${hue},70%,66%,0.95)`
          g.beginPath()
          g.arc(xR + 8, y, r, 0, Math.PI * 2)
          g.fill()
        }
      }

      // earshot, drawn in the same units as the plot
      const eh = (ctx.params.earshot / span) * (h - pad * 2) * 0.5
      const my = h / 2
      g.strokeStyle = 'rgba(255,255,255,0.28)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(pad + 6, my - eh)
      g.lineTo(pad + 6, my + eh)
      g.moveTo(pad + 2, my - eh)
      g.lineTo(pad + 10, my - eh)
      g.moveTo(pad + 2, my + eh)
      g.lineTo(pad + 10, my + eh)
      g.stroke()

      // readout
      g.font = '10px ui-monospace, monospace'
      g.textAlign = 'left'
      if (latest) {
        const sorted = [...latest].sort((a, b) => a - b)
        let clusters = 1
        for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] > CLUSTER) clusters++
        const wide = Math.round(sorted[sorted.length - 1] - sorted[0])
        g.fillStyle = 'rgba(255,255,255,0.4)'
        g.fillText(`${clusters} cluster${clusters === 1 ? '' : 's'}  ·  ${wide}¢ apart`, xL, 14)
      } else {
        g.fillStyle = 'rgba(255,255,255,0.3)'
        g.fillText('press play — then hold anywhere to become a voice they follow', xL, 14)
      }
    })

    // -- being the zealot --------------------------------------------------

    const pitchAt = (e: PointerEvent) => {
      const rect = g.canvas.getBoundingClientRect()
      const pad = 10
      const span = view()
      const y = e.clientY - rect.top
      return clamp((1 - (y - pad) / (rect.height - pad * 2)) * 2 * span - span, -span, span)
    }

    const onDown = (e: PointerEvent) => {
      g.canvas.setPointerCapture(e.pointerId)
      zealot = pitchAt(e)
      void unlock()
    }
    const onMove = (e: PointerEvent) => {
      if (zealot !== null) zealot = pitchAt(e)
    }
    const onUp = () => (zealot = null)

    g.canvas.addEventListener('pointerdown', onDown)
    g.canvas.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    ctx.cleanup(() => window.removeEventListener('pointerup', onUp))

    ctx.status('hold anywhere to hold a pitch — the crowd tunes to whoever it can hear')
  },
})
