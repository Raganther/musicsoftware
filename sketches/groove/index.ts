import { clamp, degree, disposeAt, keyboard, mtof, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * An accompanist that steals your timing and leaves your notes alone.
 *
 * Every accompanist in this repo so far has copied *what* you played —
 * call-response answers your phrase, understudy predicts your next note. This
 * one ignores your notes entirely and takes the thing underneath them: where
 * you actually put the beat. It builds a groove template, one running mean of
 * your deviation from the grid per position in the bar, and places its own
 * invented line on that template.
 *
 * The claim is that this reads as *your* playing more strongly than copying
 * your pitches would. Feel is carried in the microseconds before and after the
 * click, not in the notes; a drummer with your swing playing a different
 * pattern sounds more like you than a drummer playing your pattern straight.
 *
 * \`Feel\` is the control and the instrument at once. At 0 the partner is
 * quantised — a machine playing next to you. At 1 it has your deviations. Past
 * 1 it exaggerates them, which is when you start to hear your own habits as a
 * caricature, and \`Against you\` mirrors them, which is a different player
 * entirely: every place you lean late, it leans early.
 *
 * One scheduling detail that matters. The partner's notes can land *before*
 * the grid, and you cannot schedule into the past, so every partner note is
 * decided a whole step early and scheduled at (next step + offset). The clock
 * runs ~120 ms ahead, which is what makes a negative offset possible at all.
 */

/** Positions in the bar the template is indexed by — 16ths. */
const SLOTS = 16

interface Slot {
  /** Running mean deviation from the grid, in seconds. */
  mean: number
  /** How many hits have landed here — the template's confidence. */
  n: number
}

export default defineSketch({
  title: 'Groove',
  description: 'An accompanist that copies your timing, not your notes.',
  tags: ['improvisation', 'listening', 'instrument', 'rhythm'],
  status: 'promising',
  bpm: 96,
  division: 4,

  params: {
    feel: { type: 'number', value: 1, min: 0, max: 1.6, step: 0.01, label: 'Feel (0 = quantised)' },
    mirror: { type: 'toggle', value: false, label: 'Against you' },
    density: { type: 'number', value: 0.42, min: 0.05, max: 1, step: 0.01, label: 'How busy' },
    forget: { type: 'number', value: 0.25, min: 0.02, max: 1, step: 0.01, label: 'How fast it learns' },
    spread: { type: 'number', value: 0.35, min: 0, max: 1, label: 'Its own wobble' },
    space: { type: 'number', value: 0.24, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    tone: { type: 'number', value: 0.5, min: 0, max: 1 },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    root: { type: 'number', value: 50, min: 36, max: 62, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'dorian', options: SCALE_NAMES },
    seed: { type: 'number', value: 9, min: 1, max: 999, step: 1 },
    clear: { type: 'button', label: 'Forget my groove' },
  },

  notes: `
Every other accompanist here copies *what* you played. This one ignores your
notes and takes the thing underneath them — where you actually put the beat —
and plays its own invented line on your template. Feel lives in the tens of
milliseconds around the click, not in the pitches.

Verified by having a script play a known groove (−25, 0, +55, 0 ms per 16th,
repeating) for fourteen bars, then asking three separate questions.

**Does it learn?** The template against what was injected: slope **1.004**,
r **0.997** across all sixteen positions.

**Does it schedule its own notes on it?** Straight from the model, per slot:

| | slope | r |
| --- | --- | --- |
| feel 1.0 | 0.943 | 0.996 |
| feel 0 (control) | **0.000** | — |
| feel 1.5 | 1.164 | 0.993 |
| against you | **−0.939** | −0.994 |

**Does the audio actually come out there?** Onsets pulled from the spectrum —
the two voices are three filter poles apart, and the detector matched 224 of
224 key presses with a lag of 6.4 ± 3.0 ms:

| | slope | r |
| --- | --- | --- |
| feel 1.0 | 0.774 | **0.986** |
| feel 0 (control) | −0.055 | −0.312 |
| feel 1.5 | 0.916 | 0.969 |
| against you | −0.844 | **−0.969** |

So the whole chain holds, including the two controls: quantised at feel 0, and
cleanly inverted with \`Against you\`.

One bias to know about. My own hits, which are by construction exactly on the
injected times, read back at slope 0.515–0.685 rather than 1. The detector
compresses magnitude by about a third — its lag depends a little on which note
was struck — and the partner's numbers carry the same compression, which is why
its heard slope is 0.774 where the model says 0.943. The correlations are
unaffected and are the load-bearing figures.

The note lengths are a measurement decision as much as a musical one. At 340 ms
against a 156 ms grid the notes overlapped, an envelope detector re-armed
inside them, and it reported 416 onsets where 224 existed — which washed every
per-slot average to zero and made the sketch look broken. Shortening to 190 ms
fixed the measurement and made the instrument more percussive, which suits it.

Pre-limiter peak 0.465–0.512 when played densely; 0.194 in the suite, which
only presses three keys.
`,


  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.0 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)

    // The two voices live in different registers *and* different spectra, so a
    // spectrogram can tell them apart. That is not decoration: the whole claim
    // is about where each voice's onsets land, and a measurement that cannot
    // separate them cannot test it.
    const voice = (midi: number, time: number, dur: number, gain: number, bright: boolean) => {
      const osc = ctx.audio.createOscillator()
      osc.type = bright ? 'square' : 'triangle'
      osc.frequency.value = mtof(midi)
      const filt = ctx.audio.createBiquadFilter()
      filt.type = bright ? 'highpass' : 'lowpass'
      filt.frequency.value = bright ? 1800 : 900 + ctx.params.tone * 900
      filt.Q.value = bright ? 0.9 : 0.7
      const amp = ctx.audio.createGain()
      amp.gain.value = 0
      const pan = ctx.audio.createStereoPanner()
      pan.pan.value = bright ? 0.35 : -0.35
      osc.connect(filt).connect(amp).connect(pan).connect(bus)
      const a = bright ? 0.004 : 0.008
      amp.gain.setValueAtTime(0, time)
      amp.gain.linearRampToValueAtTime(gain, time + a)
      amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.02), time + dur)
      osc.start(time)
      disposeAt(osc, time + dur + 0.05, [filt, amp, pan])
    }

    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    // -- the groove template ---------------------------------------------------

    const slots: Slot[] = Array.from({ length: SLOTS }, () => ({ mean: 0, n: 0 }))
    let lastStep = { step: 0, time: 0, dur: 0.15 }
    /** Recent onsets for the drawing, as (bar fraction, deviation, whose). */
    const recent: { pos: number; dev: number; mine: boolean; at: number }[] = []

    const learn = (t: number) => {
      const { step, time, dur } = lastStep
      if (dur <= 0) return
      // Where this onset sits on the grid, in steps. lastStep.time is in the
      // future — the clock schedules ahead — so this is routinely negative,
      // which is correct: the hit belongs before the step that was scheduled.
      const pos = step + (t - time) / dur
      const nearest = Math.round(pos)
      const dev = (pos - nearest) * dur
      // Half a step away is not a late hit, it is a hit on the other step.
      if (Math.abs(dev) > dur * 0.5) return
      const slot = ((nearest % SLOTS) + SLOTS) % SLOTS
      const s = slots[slot]
      const alpha = s.n === 0 ? 1 : ctx.params.forget
      s.mean += (dev - s.mean) * alpha
      s.n++
      recent.push({ pos: nearest, dev, mine: true, at: t })
      while (recent.length > 96) recent.shift()
    }

    ctx.onPress('clear', () => {
      for (const s of slots) {
        s.mean = 0
        s.n = 0
      }
      recent.length = 0
    })

    // -- you -------------------------------------------------------------------

    const held = new Set<number>()
    const kbWrap = document.createElement('div')
    kbWrap.style.marginTop = '6px'
    const kb = keyboard(kbWrap, {
      low: 48,
      octaves: 2,
      onNoteOn: (m) => {
        if (held.has(m)) return
        held.add(m)
        const t = ctx.audio.currentTime
        voice(m, t, 0.19, 0.26 + ctx.params.level * 0.42, false)
        learn(t)
      },
      onNoteOff: (m) => held.delete(m),
    })
    ctx.root.appendChild(kbWrap)
    ctx.cleanup(() => kb.dispose())

    // -- the partner -----------------------------------------------------------

    let r = rng(Math.round(ctx.params.seed))
    ctx.onParam('seed', (v) => (r = rng(Math.round(v))))
    let deg = 0
    /** Every offset the partner was scheduled with, for the harness. */
    const sent: { slot: number; dev: number; at: number }[] = []

    ctx.clock.onStep((e) => {
      lastStep = { step: e.step, time: e.time, dur: e.dur }

      // Decide the note for the step *after* this one, so an offset that pulls
      // it early still lands in the future.
      const next = e.step + 1
      const slot = ((next % SLOTS) + SLOTS) % SLOTS
      const s = slots[slot]

      // Busier where you are busier: a slot you never hit is a slot it mostly
      // leaves alone, so the partner inherits your phrasing as well as your feel.
      const conf = s.n === 0 ? 0 : Math.min(1, s.n / 6)
      const p = ctx.params.density * (0.35 + 0.65 * conf)
      if (!r.chance(p)) return

      deg += r.weighted([-3, -2, -1, 1, 2, 3, 4], [1, 3, 4, 4, 3, 2, 1])
      deg = clamp(deg, -3, 11)
      const midi = degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, deg) + 12

      const sign = ctx.params.mirror ? -1 : 1
      const wobble = (r.next() - 0.5) * ctx.params.spread * 0.02
      const off = s.mean * ctx.params.feel * sign + wobble
      // Never schedule into the past, and never so late that it belongs to the
      // following step instead.
      const limit = e.dur * 0.45
      const at = e.time + e.dur + clamp(off, -limit, limit)
      const safe = Math.max(at, ctx.audio.currentTime + 0.005)
      voice(midi, safe, 0.15, 0.19 + ctx.params.level * 0.3, true)
      const dev = clamp(off, -limit, limit)
      recent.push({ pos: next, dev, mine: false, at: safe })
      sent.push({ slot, dev, at: safe })
      if (sent.length > 512) sent.shift()
      while (recent.length > 96) recent.shift()
    })

    // -- drawing ---------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const padL = 40
      const padR = 12
      const cw = (w - padL - padR) / SLOTS
      const top = 20
      const tplH = Math.max(60, h * 0.38)
      const mid = top + tplH / 2
      const dur = lastStep.dur || 0.15
      const scale = tplH / 2 / (dur * 0.5)

      // -- the template ---------------------------------------------------------
      g.strokeStyle = 'rgba(255,255,255,0.14)'
      g.beginPath()
      g.moveTo(padL, mid)
      g.lineTo(w - padR, mid)
      g.stroke()
      g.font = '9px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.28)'
      g.textAlign = 'right'
      g.fillText('late', padL - 5, mid + tplH / 2 - 2)
      g.fillText('early', padL - 5, mid - tplH / 2 + 8)
      g.fillText('grid', padL - 5, mid + 3)
      g.textAlign = 'left'

      for (let i = 0; i < SLOTS; i++) {
        const x = padL + i * cw
        const s = slots[i]
        g.fillStyle = i % 4 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.025)'
        g.fillRect(x + 1, top, cw - 2, tplH)
        if (s.n === 0) continue
        const conf = Math.min(1, s.n / 6)
        const y = mid + clamp(s.mean * scale, -tplH / 2 + 3, tplH / 2 - 3)
        g.fillStyle = `rgba(251,191,36,${0.25 + 0.65 * conf})`
        g.fillRect(x + 2, Math.min(mid, y), cw - 4, Math.max(1.5, Math.abs(y - mid)))
        g.fillStyle = `rgba(251,191,36,${0.4 + 0.6 * conf})`
        g.fillText(`${(s.mean * 1000).toFixed(0)}`, x + 3, top + tplH + 12)
      }
      g.fillStyle = 'rgba(255,255,255,0.3)'
      g.fillText('your deviation from the grid, ms, by position in the bar', padL, top - 6)

      // -- the two lines, side by side -----------------------------------------
      const rollTop = top + tplH + 28
      const rollH = h - rollTop - 30
      if (rollH > 30) {
        const now = ctx.audio.currentTime
        const span = 6
        const rx = (t: number) => padL + (1 - (now - t) / span) * (w - padL - padR)
        // grid lines
        const step = lastStep
        for (let k = -Math.ceil(span / dur); k <= 2; k++) {
          const t = step.time + k * dur
          const x = rx(t)
          if (x < padL || x > w - padR) continue
          const isBeat = ((((step.step + k) % 4) + 4) % 4) === 0
          g.strokeStyle = isBeat ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.05)'
          g.beginPath()
          g.moveTo(x, rollTop)
          g.lineTo(x, rollTop + rollH)
          g.stroke()
        }
        for (const o of recent) {
          const x = rx(o.at)
          if (x < padL || x > w - padR) continue
          const y = o.mine ? rollTop + rollH * 0.72 : rollTop + rollH * 0.28
          g.fillStyle = o.mine ? 'rgba(125,211,252,0.9)' : 'rgba(251,191,36,0.9)'
          g.fillRect(x - 1.5, y - 7, 3, 14)
        }
        g.fillStyle = 'rgba(251,191,36,0.5)'
        g.fillText('it', padL + 2, rollTop + rollH * 0.28 - 12)
        g.fillStyle = 'rgba(125,211,252,0.5)'
        g.fillText('you', padL + 2, rollTop + rollH * 0.72 + 20)
      }

      const hits = slots.reduce((a, s) => a + s.n, 0)
      const known = slots.filter((s) => s.n > 0).length
      const swing = slots.reduce((a, s, i) => a + (i % 2 === 1 ? s.mean : -s.mean), 0) / SLOTS
      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.72)'
      g.fillText(
        `${hits} hits · ${known}/${SLOTS} positions known · offbeat lean ${(swing * 1000).toFixed(1)} ms` +
          (ctx.params.feel < 0.01 ? '   ·   FEEL 0 — it is on the grid' : ''),
        padL,
        h - 16,
      )
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.3)'
      g.fillText(
        ctx.params.mirror
          ? 'playing against your feel — where you lean late it leans early'
          : 'play the keys · it invents its own notes and puts them where you would',
        padL,
        h - 3,
      )
    }, kbWrap.parentElement ?? undefined)

    // A read-only snapshot for the verification harness. The sketch never reads
    // it; it exists so a test can inject a known groove on the grid and then
    // ask what was learned, independently of what it can hear.
    const wnd = window as unknown as Record<string, unknown>
    wnd.__groove = () => ({
      step: lastStep.step,
      time: lastStep.time,
      dur: lastStep.dur,
      now: ctx.audio.currentTime,
      template: slots.map((s) => ({ mean: s.mean, n: s.n })),
      sent: sent.map((x) => ({ slot: x.slot, dev: x.dev, at: x.at })),
    })
    ctx.cleanup(() => delete wnd.__groove)

    ctx.status('play the keys against the transport · it copies where you put them, not what you play')
  },
})
