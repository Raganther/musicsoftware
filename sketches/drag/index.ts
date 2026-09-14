import { clamp, degree, disposeAt, mtof, noiseBuffer, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import {
  C,
  dist,
  dragDelay,
  LAYOUTS,
  meanDelay,
  positions,
  settled,
  weight,
  type Layout,
  type Pt,
} from './room'

/**
 * An ensemble listening to each other across a room.
 *
 * Sound goes 343 m/s. A player ten metres away is heard 29 ms late — so when
 * the ensemble is *perfectly* together, every one of them still hears everyone
 * else as late, because the sound arriving now left before now. Correct toward
 * what you hear and you wait. They all wait. The room slows down.
 *
 * Nobody in it is playing badly and nobody can fix it from where they stand:
 * measured, every player drags at the same rate whatever their own distance
 * from the others, because the rate is set by the ensemble's mean travel time
 * and no individual owns that. What fixes it is a beat you can *see*, since
 * light does not take 29 ms to cross a stage. That is what a conductor is for,
 * and the measurement says a thousandth of your attention on one is enough.
 *
 * `entrain` asked how fast an ensemble agrees — the rate is the listening
 * graph's algebraic connectivity. This asks what tempo it agrees *on*.
 *
 * Numbers in `notes` are measured; see `research/log/2026-09-14-drag.md`.
 */

const MAX_PLAYERS = 8
const COLOURS = ['#7dd3fc', '#fbbf24', '#a78bfa', '#34d399', '#f472b6', '#fb923c', '#4ade80', '#60a5fa']

export default defineSketch({
  title: 'Drag',
  description: 'An ensemble listening to each other across a room. The further apart they stand, the slower they play.',
  tags: ['ensemble', 'generative', 'performance'],
  status: 'promising',
  bpm: 120,
  division: 4,

  params: {
    players: { type: 'number', value: 5, min: 2, max: MAX_PLAYERS, step: 1, label: 'Players' },
    /** How far apart they stand. This is the instrument. */
    spread: { type: 'number', value: 12, min: 0.5, max: 40, step: 0.5, label: 'Room (m)', unit: 'm' },
    layout: { type: 'select', value: 'ring', options: LAYOUTS as unknown as string[], label: 'Standing' },
    /** How much of the heard gap lands on this beat. Above ~1.5 it overshoots. */
    alpha: { type: 'number', value: 0.4, min: 0, max: 1.8, step: 0.01, label: 'Phase correction α' },
    /** How much of it lands on the tempo, and stays there. */
    beta: { type: 'number', value: 0.15, min: 0, max: 0.4, step: 0.005, label: 'Period correction β' },
    /** Each player's memory of the tempo they meant. At 0 there is no fixed point. */
    gamma: { type: 'number', value: 0.1, min: 0, max: 0.4, step: 0.005, label: 'Tempo memory γ' },
    /** A beat you can see. Any weight at all pins the tempo — that is the point. */
    conductor: { type: 'number', value: 0, min: 0, max: 1, step: 0.001, label: 'Watch conductor' },
    /** Stop listening to the far ones and the room holds together better. */
    earshot: { type: 'number', value: 40, min: 1, max: 60, step: 0.5, label: 'Earshot (m)', unit: 'm' },
    cue: { type: 'button', label: 'Cue (reset tempo)' },
    root: { type: 'number', value: 40, min: 28, max: 60, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'pentatonicMinor', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    space: { type: 'number', value: 0.26, min: 0, max: 0.6, step: 0.01, label: 'Room tone' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 4, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
An ensemble listening to each other across a room. Sound goes 343 m/s, so when
they are *perfectly* together every one of them still hears the others as late —
the sound arriving now left before now. Correct toward what you hear and you
wait; they all wait; the room slows down. Drag the players apart and listen to
the tempo sag.

**The drag rate is β times the ensemble's mean travel time.** Measured against
that closed form over four layouts × three room sizes × two values of β:
**24 of 24 cells, ratio 1.00000, worst departure 0.0000%.**

**And it is the *ensemble's* mean, not your own.** Five players huddled together
with one stranded 30 m away: their own mean delays run 18.47 to 85.77 ms, and
all six drag at **4531.82 µs per beat** — the same number to six figures. You
cannot improve your own drag by standing closer to someone.

**The average is over *attention*, not over people.** The weight on each
player's delay is how much the ensemble listens to them — the stationary
distribution of the listening matrix. With everyone in earshot that is the plain
average to 0.0000%, which is why it took a narrow earshot to show it: the huddle
then stops hearing the stranded player while still being heard by them, and the
prediction moves from 20.67 ms to 5.69 ms, 111.26 bpm to 117.46. The recording
says **117.457**. The tempo belongs to the players everybody listens to, and the
one nobody can hear does not drag the room.

**The tempo it settles on is T + (α + β/γ)·τ.** Exact to **0.00000%** on 30 of
36 settings. Only the *ratio* β/γ matters: β 0.05 with γ 0.10 and β 0.30 with
γ 0.60 land on 111.282112 bpm alike. Six players in a ring lose 0.49 bpm at half
a metre, 9.17 at ten metres and 29.83 at forty.

The other 6 of 36 are not a worse prediction — they are settings with **no
settled tempo to predict**. On an asymmetric layout at β/γ = 2 the ensemble
hunts instead, swinging **3.07 bpm** window to window; the symmetric ring at the
same settings is flat to 0.0000%.

**A conductor works by being *seen*.** An ear gives you a delayed, relative
reference; an eye gives an undelayed, absolute one, and any weight at all on it
pins the tempo at exactly the nominal — 120.00000 bpm at \`Watch conductor\` =
0.001, where the same room without one settles at 96.15. The weight only sets
how long it takes: 0.01 arrives immediately, 0.0001 needs 100,000 beats.

**And stopping listening helps.** Narrow \`Earshot\` on that stranded-player room
and the tempo comes back from 106.85 to 117.46 bpm — measured off the recording
at 106.847 and 117.457. Ignoring the person you can barely hear is not rudeness,
it is the only move available to you from where you are standing, and it
recovers ten of the thirteen bpm the room was costing.

**The wobble above α ≈ 1.5 is not the delay's fault.** Push phase correction too
far and the ensemble oscillates instead of agreeing. The threshold is
2/(1 − μ) where μ is the smallest eigenvalue of the listening matrix — three
player counts predicting 1.333, 1.500 and 1.667, measured at a uniform ratio of
0.987 across twelve cells. But a 20× change in delay moves it by **0.049%**.
\`ideas.md\` expected the delay to cause the instability; it does not. The delay
causes the drag. The overshoot is over-correction and would happen in a room of
no size at all.

**And the room really plays it.** Tempo read off a recording, against the closed
form: **0.018% at 6 m, 0.002% at 20 m, 0.050% at 40 m**, and the stranded-player
rooms within 0.03% at every earshot. The detector is checked first against a
tempo that is 120.000 by construction, with the ensemble tight *and* smeared
across 58 ms — 119.988 and 119.983.

Two things only the sound shows. With \`Tempo memory γ\` at 0 there is no fixed
point, and one capture falls from 93.79 bpm to 71.96 without levelling. And
switching a conductor on mid-drag does not simply restore the tempo: the room
has a lag to recover, so it **sprints** — 95.82 bpm, then 160.43, 119.63,
119.93, 119.99 across the quarters of one 80 s capture.

Levels: 0.468 pre-limiter at the defaults, 0.606 at the loudest setting there is.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.2 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)
    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    // -- who stands where ------------------------------------------------------

    let pos: Pt[] = []
    let pitch: number[] = []
    const layoutNow = () => ctx.params.layout as Layout

    const place = () => {
      const n = Math.round(ctx.params.players)
      pos = positions(layoutNow(), n, ctx.params.spread, Math.round(ctx.params.seed))
    }
    const tune = () => {
      const r = rng(Math.round(ctx.params.seed))
      const root = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      pitch = []
      for (let i = 0; i < MAX_PLAYERS; i++) pitch.push(degree(root, scale, r.int(0, 11)))
    }
    place()
    tune()
    for (const k of ['players', 'spread', 'layout', 'seed'] as const) ctx.onParam(k, place)
    for (const k of ['root', 'scale', 'seed'] as const) ctx.onParam(k, tune)

    // -- the ensemble ----------------------------------------------------------

    /** Next onset per player, in AudioContext time. */
    let t: number[] = []
    /** The period each player currently believes in. */
    let T: number[] = []
    let baton = 0
    let beat = 0
    let started = false

    /** bpm actually heard, per beat, for the plot. */
    const trace: number[] = []
    let lastBeatAt = 0

    const nominal = () => ctx.clock.secondsPerBeat

    const reset = (at: number) => {
      const n = Math.round(ctx.params.players)
      const T0 = nominal()
      t = Array.from({ length: n }, () => at)
      T = Array.from({ length: n }, () => T0)
      baton = at
      beat = 0
      lastBeatAt = 0
      trace.length = 0
      started = true
    }
    ctx.onPress('cue', () => {
      if (started) reset(ctx.audio.currentTime + 0.1)
    })

    // -- the sound -------------------------------------------------------------

    const strike = (i: number, when: number, gain: number, pan: number) => {
      const at = Math.max(when, ctx.audio.currentTime + 0.004)
      const f = mtof(pitch[i])
      const pn = ctx.audio.createStereoPanner()
      pn.pan.value = pan
      pn.connect(bus)

      const amp = ctx.audio.createGain()
      amp.gain.setValueAtTime(0, at)
      // 8 ms, not 2 — a fast ramp on a sine is a broadband click, and a click
      // per player per beat is exactly the attack this sketch is measuring.
      amp.gain.linearRampToValueAtTime(gain, at + 0.008)
      amp.gain.exponentialRampToValueAtTime(Math.max(1e-4, gain * 0.02), at + 0.42)
      amp.connect(pn)

      const o1 = ctx.audio.createOscillator()
      o1.type = 'triangle'
      o1.frequency.value = f
      o1.connect(amp)
      o1.start(at)

      const o2 = ctx.audio.createOscillator()
      o2.type = 'sine'
      o2.frequency.value = f * 2.01
      const a2 = ctx.audio.createGain()
      a2.gain.setValueAtTime(0, at)
      a2.gain.linearRampToValueAtTime(gain * 0.3, at + 0.006)
      a2.gain.exponentialRampToValueAtTime(1e-4, at + 0.16)
      o2.connect(a2).connect(pn)
      o2.start(at)

      // a breath of noise, so an onset is legible in a recording as well as a
      // picture — the whole claim is about *when* each player plays
      const nz = ctx.audio.createBufferSource()
      nz.buffer = noiseBuffer()
      nz.loop = true
      const bp = ctx.audio.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = clamp(f * 6, 200, 6000)
      bp.Q.value = 1.4
      const na = ctx.audio.createGain()
      na.gain.setValueAtTime(0, at)
      na.gain.linearRampToValueAtTime(gain * 0.34, at + 0.003)
      na.gain.exponentialRampToValueAtTime(1e-4, at + 0.05)
      nz.connect(bp).connect(na).connect(pn)
      nz.start(at)

      disposeAt(o1, at + 0.5, [amp])
      disposeAt(o2, at + 0.5, [a2])
      disposeAt(nz, at + 0.5, [bp, na, pn])
    }

    /** Play one beat, then let everyone correct toward what they heard. */
    const advance = () => {
      const n = Math.round(ctx.params.players)
      if (t.length !== n) reset(t.length ? Math.max(...t) : ctx.audio.currentTime + 0.1)
      const T0 = nominal()
      const ear = ctx.params.earshot
      const cond = ctx.params.conductor
      const lvl = (0.52 + ctx.params.level * 0.44) / Math.sqrt(n)
      const cap = 4 * T0

      // sound first — what reaches you is delayed by how far away they are
      for (let i = 0; i < n; i++) {
        const dl = Math.hypot(pos[i].x, pos[i].y) / C
        const span = Math.max(1e-6, ctx.params.spread / 2)
        strike(i, t[i] + dl, lvl, clamp(pos[i].x / span, -1, 1) * 0.75)
      }
      if (beat > 0) trace.push(60 / Math.max(1e-3, t[0] - lastBeatAt))
      if (trace.length > 400) trace.shift()
      lastBeatAt = t[0]

      const nt = t.slice()
      const nT = T.slice()
      for (let i = 0; i < n; i++) {
        let num = 0
        let den = 0
        for (let j = 0; j < n; j++) {
          if (j === i) continue
          const d = dist(pos[i], pos[j])
          const w = weight(d, ear)
          // what player i HEARS: j's onset, arriving d/C later
          num += w * (t[j] + d / C - t[i])
          den += w
        }
        const heard = den > 0 ? num / den : 0
        const e = (1 - cond) * heard + cond * (baton - t[i])
        nt[i] = t[i] + T[i] + ctx.params.alpha * e
        nT[i] = clamp(T[i] + ctx.params.beta * e - ctx.params.gamma * (T[i] - T0), 0.08 * T0, cap)
      }
      t = nt
      T = nT
      baton += T0
      beat++
    }

    ctx.clock.onStep((e) => {
      if (!started) reset(e.time + 0.05)
      // The clock is only a lookahead pump here — the ensemble keeps its own
      // time, which is the entire subject. Schedule against e.time, never
      // currentTime.
      const horizon = e.time + e.dur
      for (let guard = 0; guard < 8; guard++) {
        if (t.length === 0 || Math.max(...t) >= horizon) break
        advance()
      }
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) started = false
      }),
    )

    // -- drawing ---------------------------------------------------------------

    const g2d = ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const n = Math.round(ctx.params.players)
      const pad = 10
      const T0 = nominal()
      const tau = dragDelay(pos, ctx.params.earshot)
      const pred = settled(T0, ctx.params.alpha, ctx.params.beta, ctx.params.gamma, tau)
      const heardBpm = trace.length ? trace[trace.length - 1] : 60 / T0

      const head = 15
      const avail = h - pad * 2 - head
      const roomH = Math.max(80, Math.min(avail * 0.62, 230))
      const plotH = Math.max(34, avail - roomH - 8)
      const roomTop = pad + head
      const plotTop = roomTop + roomH + 8

      // -- header --------------------------------------------------------------
      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.62)'
      g.fillText(
        `${(tau * 1000).toFixed(1)} ms mean travel   ` +
          `settles at ${Number.isFinite(pred) ? (60 / pred).toFixed(1) : '—'} bpm   ` +
          `hearing ${heardBpm.toFixed(1)}   of ${(60 / T0).toFixed(0)} intended`,
        pad,
        pad + 10,
      )

      // -- the room ------------------------------------------------------------
      const cx = w / 2
      const cy = roomTop + roomH / 2
      const viewM = ctx.params.spread * 1.35 + 2
      const sc = Math.min(w - pad * 2, roomH) / viewM
      const sx = (p: Pt) => cx + p.x * sc
      const sy = (p: Pt) => cy + p.y * sc

      g.fillStyle = 'rgba(255,255,255,0.03)'
      g.fillRect(pad, roomTop, w - pad * 2, roomH)

      // who hears whom
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const d = dist(pos[i], pos[j])
          const a = weight(d, ctx.params.earshot)
          if (a < 0.02) continue
          g.strokeStyle = `rgba(255,255,255,${(a * 0.3).toFixed(3)})`
          g.lineWidth = 1
          g.beginPath()
          g.moveTo(sx(pos[i]), sy(pos[i]))
          g.lineTo(sx(pos[j]), sy(pos[j]))
          g.stroke()
        }
      }

      // the listener, at the middle of the room
      g.strokeStyle = 'rgba(255,255,255,0.28)'
      g.lineWidth = 1
      g.beginPath()
      g.arc(cx, cy, 4, 0, Math.PI * 2)
      g.stroke()

      // the conductor, if anyone is watching
      if (ctx.params.conductor > 0) {
        const onBeat = started ? ((ctx.audio.currentTime - baton) / T0 + 1) % 1 : 0
        const r = 6 + 7 * Math.max(0, 1 - onBeat * 4)
        g.fillStyle = `rgba(255,255,255,${(0.25 + 0.5 * Math.max(0, 1 - onBeat * 4)).toFixed(3)})`
        g.beginPath()
        g.arc(cx, roomTop + 12, r, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = 'rgba(255,255,255,0.4)'
        g.font = '9px ui-monospace, monospace'
        g.fillText('seen', cx + 12, roomTop + 15)
        g.font = '11px ui-monospace, monospace'
      }

      // the players
      const now = ctx.audio.currentTime
      for (let i = 0; i < n; i++) {
        const since = now - (t[i] ?? 0) + (T[i] ?? T0)
        const flash = Math.max(0, 1 - Math.abs(since) * 6)
        const x = sx(pos[i])
        const y = sy(pos[i])
        g.fillStyle = COLOURS[i % COLOURS.length]
        g.globalAlpha = 0.55 + 0.45 * flash
        g.beginPath()
        g.arc(x, y, 5 + 5 * flash, 0, Math.PI * 2)
        g.fill()
        g.globalAlpha = 1
        // how late this player hears the rest
        g.fillStyle = 'rgba(255,255,255,0.34)'
        g.font = '9px ui-monospace, monospace'
        g.fillText(`${(meanDelay(pos, i, ctx.params.earshot) * 1000).toFixed(0)}`, x + 8, y - 6)
      }
      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.3)'
      g.fillText(`${ctx.params.spread.toFixed(1)} m across`, pad + 4, roomTop + roomH - 5)

      // -- the tempo -----------------------------------------------------------
      g.fillStyle = 'rgba(255,255,255,0.03)'
      g.fillRect(pad, plotTop, w - pad * 2, plotH)
      const hi = 60 / T0 + 4
      const lo = Math.min(60 / T0 - 34, Number.isFinite(pred) ? 60 / pred - 6 : 60 / T0 - 34)
      const yOf = (b: number) => plotTop + plotH * (1 - (clamp(b, lo, hi) - lo) / (hi - lo))

      for (const [b, col, lab] of [
        [60 / T0, 'rgba(255,255,255,0.22)', 'intended'],
        ...(Number.isFinite(pred) ? [[60 / pred, 'rgba(251,191,36,0.55)', 'predicted'] as const] : []),
      ] as [number, string, string][]) {
        g.strokeStyle = col
        g.setLineDash([3, 3])
        g.beginPath()
        g.moveTo(pad, yOf(b))
        g.lineTo(w - pad, yOf(b))
        g.stroke()
        g.setLineDash([])
        g.fillStyle = col
        g.font = '9px ui-monospace, monospace'
        g.fillText(lab, w - pad - 52, yOf(b) - 3)
      }

      if (trace.length > 1) {
        g.strokeStyle = '#7dd3fc'
        g.lineWidth = 1.5
        g.beginPath()
        for (let i = 0; i < trace.length; i++) {
          const x = pad + ((w - pad * 2) * i) / Math.max(1, trace.length - 1)
          const y = yOf(trace[i])
          i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
        }
        g.stroke()
      }
      g.fillStyle = 'rgba(255,255,255,0.4)'
      g.font = '9px ui-monospace, monospace'
      g.fillText(`${hi.toFixed(0)} bpm`, pad + 3, plotTop + 10)
      g.fillText(`${lo.toFixed(0)}`, pad + 3, plotTop + plotH - 4)
    })

    // -- dragging a player around ------------------------------------------------

    const cv = g2d.canvas
    let held = -1
    const roomPt = (ev: PointerEvent): Pt => {
      const r = cv.getBoundingClientRect()
      const n = Math.round(ctx.params.players)
      const head = 15
      const avail = r.height - 20 - head
      const roomH = Math.max(80, Math.min(avail * 0.62, 230))
      const cy = 10 + head + roomH / 2
      const viewM = ctx.params.spread * 1.35 + 2
      const sc = Math.min(r.width - 20, roomH) / viewM
      void n
      return { x: (ev.clientX - r.left - r.width / 2) / sc, y: (ev.clientY - r.top - cy) / sc }
    }
    const onDown = (ev: PointerEvent) => {
      const p = roomPt(ev)
      const n = Math.round(ctx.params.players)
      let best = -1
      let bd = Infinity
      for (let i = 0; i < n; i++) {
        const d = dist(p, pos[i])
        if (d < bd) {
          bd = d
          best = i
        }
      }
      if (best >= 0 && bd < ctx.params.spread * 0.2 + 1) {
        held = best
        cv.setPointerCapture(ev.pointerId)
        ev.preventDefault()
      }
    }
    const onMove = (ev: PointerEvent) => {
      if (held < 0) return
      pos[held] = roomPt(ev)
      ev.preventDefault()
    }
    const onUp = () => {
      held = -1
    }
    cv.addEventListener('pointerdown', onDown)
    cv.addEventListener('pointermove', onMove)
    cv.addEventListener('pointerup', onUp)
    cv.addEventListener('pointercancel', onUp)
    ctx.cleanup(() => {
      cv.removeEventListener('pointerdown', onDown)
      cv.removeEventListener('pointermove', onMove)
      cv.removeEventListener('pointerup', onUp)
      cv.removeEventListener('pointercancel', onUp)
    })

    const report = () => {
      const tau = dragDelay(pos, ctx.params.earshot)
      const T0 = nominal()
      const p = settled(T0, ctx.params.alpha, ctx.params.beta, ctx.params.gamma, tau)
      ctx.status(
        Number.isFinite(p)
          ? `${(tau * 1000).toFixed(1)} ms mean travel — settles at ${(60 / p).toFixed(1)} bpm, ${((60 / T0) - 60 / p).toFixed(1)} slower than intended`
          : `${(tau * 1000).toFixed(1)} ms mean travel — no tempo memory, so it never stops slowing down`,
      )
    }
    report()
    for (const k of ['spread', 'players', 'layout', 'alpha', 'beta', 'gamma', 'earshot', 'conductor'] as const) {
      ctx.onParam(k, report)
    }

    // Read back by the harness; the sketch's numbers come from the same module.
    ;(window as unknown as Record<string, unknown>).__drag = () => ({
      tap: () => bus,
      set: (k: string, v: number | boolean | string) => ctx.set(k as never, v as never),
      pos,
      tau: () => dragDelay(pos, ctx.params.earshot),
      predicted: () =>
        settled(nominal(), ctx.params.alpha, ctx.params.beta, ctx.params.gamma, dragDelay(pos, ctx.params.earshot)),
      nominal,
      trace,
      periods: () => T.slice(),
    })
  },
})
