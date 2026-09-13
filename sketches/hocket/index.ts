import { clamp, degree, disposeAt, mtof, nearestFraction, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import { defects, densities, plays } from './beatty'

/**
 * Two players share one pulse. Neither of them has the tune.
 *
 * A hocket is the medieval trick of splitting a melody between voices so that
 * each plays the notes the other rests through. The question this asks is how
 * the split may be chosen: if each voice plays its own steady-ish rhythm, when
 * do the two of them between them hit every pulse exactly once?
 *
 * Give a voice of density d the steps { floor(n/d) : n ≥ 1 } — a Beatty
 * sequence — and the answer is Rayleigh's theorem (1894): d and 1−d tile the
 * pulse exactly, and **only if d is irrational**. So the interlock needs no
 * negotiation at all. One number, chosen badly, and it is perfect forever.
 *
 * `irrational` built one such word and asked what it looks like on its own —
 * complexity n+1, maximally even, and an apparent period set by how well you
 * can approximate d. This asks the complementary question, which is about the
 * *pair*, and it has two answers the single word cannot have:
 *
 *   - land on a simple ratio p/q and the hocket does not degrade gently. It
 *     drops exactly 1/q of the notes and doubles exactly 1/q of them.
 *   - add a third player and it is no longer possible at all. Uspensky (1927):
 *     the integers do not partition into three or more Beatty sequences.
 *
 * The numbers in `notes` are measured; see `research/log/2026-09-13-hocket.md`.
 */

const MAX_VOICES = 4
/** Melody length. Prime, so it lines up with nothing in the rhythm. */
const TUNE = 13

const COLOURS = ['#7dd3fc', '#fbbf24', '#a78bfa', '#34d399']

export default defineSketch({
  title: 'Hocket',
  description: 'Two voices split one pulse between them. Exactly, at an irrational density — and never, with three.',
  tags: ['rhythm', 'sequencer', 'generative'],
  status: 'promising',
  bpm: 104,
  division: 4,

  params: {
    /**
     * Voice 1's density. Voice 2 takes the rest, so this one number is the
     * whole agreement between the players.
     */
    split: { type: 'number', value: 0.618034, min: 0.06, max: 0.94, step: 0.000001, label: 'Voice 1 share' },
    /**
     * Added to voice 2's density. The complement is otherwise computed rather
     * than played, and a hocket nobody can get wrong is not a claim about
     * anything — this is the knob that says how close is close enough.
     */
    err: { type: 'number', value: 0, min: -0.004, max: 0.004, step: 0.000001, label: 'Partner error' },
    voices: { type: 'number', value: 2, min: 2, max: MAX_VOICES, step: 1, label: 'Voices' },
    /** Snap the share to the nearest p/q with q ≤ this. 0 leaves it alone. */
    snap: { type: 'number', value: 0, min: 0, max: 16, step: 1, label: 'Snap to q ≤' },
    /** 0 plays everyone. 1…n leaves one voice alone, which is the thing to hear. */
    solo: { type: 'number', value: 0, min: 0, max: MAX_VOICES, step: 1, label: 'Solo voice' },
    pulse: { type: 'toggle', value: true, label: 'Reference click' },
    root: { type: 'number', value: 52, min: 30, max: 68, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'pentatonicMinor', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    decay: { type: 'number', value: 0.34, min: 0.06, max: 1.2, step: 0.01, label: 'Decay' },
    /** How many steps the readout and the curve below it look at. */
    window: { type: 'number', value: 512, min: 64, max: 4096, step: 64, label: 'Listen for (steps)' },
    space: { type: 'number', value: 0.24, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 7, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
Two players share one pulse and neither has the tune. Give voice 1 the steps
\`floor(n/d)\` and voice 2 the steps \`floor(n/(1−d))\` and Rayleigh's theorem
says they hit every step exactly once — provided d is irrational. The whole
agreement between the players is one number.

**It is exact, and the complement is the only partner.** Two voices at d and
1−d, over 200,000 steps: **0 collisions and 0 gaps**, for each of φ−1, √2−1,
1/e, π−3 and 1/φ². Sweeping voice 2 over 4001 other densities in [0.05, 0.95]
finds no second answer.

**Neither voice is steady; the sum is.** Voice 1 at φ−1 plays gaps of 1 and 2
steps only (1180 and 1909 of them), voice 2 plays gaps of 2 and 3 only (729 and
1180) — two values each, which is the three-distance theorem. Together:
**one value, 5000 onsets in 5000 steps**, and the ratio of each voice's two gap
counts is 0.618, which is d again.

**Land on a simple ratio and it fails by exactly 1/q.** At an exact p/q the
hocket drops 1/q of the notes and doubles 1/q of them — measured on 17
fractions from 1/2 to 55/89, every one matching 1/q. So the *simpler* the
relationship between the two parts, the worse the interlock, which is the
opposite of how ratios usually behave in music.

That is a fact about the *ratio*, and \`Snap\` can only give you a double. Over
every p/q with q ≤ 16, exact integer arithmetic collapses all 79; as doubles, 63
collapse at the ratio's own rate, 10 collapse at less than it, and **6 tile
perfectly anyway** — 6/7, 8/9, 7/10, 10/11, 11/12, 11/15. Snapping to 2/3 sounds
like nothing happened, because 0.66666666666666663 and its complement are not
2/3 and 1/3, and they interlock. Same phenomenon \`irrational\` found from the
other side: how rational a number *behaves* is a question about the window.

**The agreement has to be good to about 1/M to survive M steps.** With voice 2
off the complement by ε, the defect rate is **M·ε** — worst departure **0.8%**
over nine cells spanning three window lengths and five values of ε. It is a
rate that *grows with how long you listen*: the players do not drift apart
steadily, they come apart faster the longer they go. Past ε ≈ 1/M it saturates
at **0.4722**, and that is not "a mess" — it is 2·d·(1−d) = 0.4721, exactly what
two *independent* streams of those densities would give. Interlocked, or
statistically unrelated, and very little in between.

**A third player cannot help.** Uspensky proved there is no partition into
three or more. Searched with 40 random restarts and local refinement at 20,000
steps, no voice below density 0.12: two voices reach **0.0000**, three reach
**0.2400**, four **0.3164**, five **0.4510** — and the minimum always runs to
the boundary, so what the search wants to do with the extra voices is turn them
off. Three equal voices give 0.6667.

Set \`Voices\` to 3 and no setting of anything rescues it. That is a fact about
rhythm rather than about this program: two parts can agree to share a pulse
with one number between them, and three parts can never.

**And the sketch plays it.** Read off a recording, one binary decision per step
aligned to the audio clock: each voice alone matches \`floor(n/d)\` on **229 of
229 steps**, where the same pattern slid to any other alignment agrees on 23.6%.
Both together: **229 of 229 steps carry a note, none empty**, and the quietest
step is 0.65 of the loudest — there is no silence in the recording to find.
Snapped, the holes arrive at 1/q (0.5022, 0.2489, 0.1965, 0.1659, 0.1441,
0.1223 against 1/2, 1/4, 1/5, 1/6, 1/7, 1/8). Off the complement by ε it has the
model's missing steps exactly — 14, 26 and 57 of them — and agrees on *which*
steps at **100.00%** every time.

Levels: 0.523 pre-limiter at the defaults, 0.699 at the loudest setting the
sketch has.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 1.8 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)
    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    // -- the tune ---------------------------------------------------------------

    /** Scale degrees, one per grid step, cycling. Whoever owns the step plays it. */
    let tune: number[] = []
    const reseed = () => {
      const r = rng(Math.round(ctx.params.seed))
      const root = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      tune = []
      let deg = 2
      for (let i = 0; i < TUNE; i++) {
        deg = clamp(deg + r.int(-3, 3), -2, 9)
        tune.push(degree(root, scale, deg))
      }
    }
    reseed()
    ctx.onParam('seed', reseed)
    ctx.onParam('root', reseed)
    ctx.onParam('scale', reseed)

    // -- the densities ----------------------------------------------------------

    /** Live so the curve and the scheduler cannot disagree about the setting. */
    const shareNow = () => {
      const q = Math.round(ctx.params.snap)
      if (q < 1) return ctx.params.split
      const f = nearestFraction(ctx.params.split, q)
      return clamp(f.p / f.q, 0.06, 0.94)
    }
    const dsNow = () =>
      densities(shareNow(), Math.round(ctx.params.voices), ctx.params.err)

    // -- the voices -------------------------------------------------------------

    /**
     * A mallet. Voice 1 is dark and centre-left, voice 2 bright and
     * centre-right; same register, because a hocket that splits by octave is
     * two parts rather than one shared out.
     */
    const strike = (midi: number, time: number, gain: number, pan: number, bright: number, dec: number) => {
      const f = mtof(midi)
      const pn = ctx.audio.createStereoPanner()
      pn.pan.value = pan
      pn.connect(bus)
      const amp = ctx.audio.createGain()
      amp.gain.setValueAtTime(0, time)
      // 7 ms, not 2: a fast ramp on a sine is a broadband click, and a click on
      // every step is exactly the steady pulse this sketch is claiming to break.
      amp.gain.linearRampToValueAtTime(gain, time + 0.007)
      amp.gain.exponentialRampToValueAtTime(Math.max(1e-4, gain * 0.015), time + dec)
      amp.connect(pn)

      const o1 = ctx.audio.createOscillator()
      o1.type = 'sine'
      o1.frequency.value = f
      o1.connect(amp)
      o1.start(time)

      // One inharmonic partial, decaying faster — enough to tell the two players
      // apart without either of them leaving the melody's register.
      const o2 = ctx.audio.createOscillator()
      o2.type = 'sine'
      o2.frequency.value = f * (2 + bright * 1.76)
      const a2 = ctx.audio.createGain()
      a2.gain.setValueAtTime(0, time)
      a2.gain.linearRampToValueAtTime(gain * (0.1 + bright * 0.45), time + 0.005)
      a2.gain.exponentialRampToValueAtTime(1e-4, time + dec * 0.42)
      o2.connect(a2).connect(pn)
      o2.start(time)

      disposeAt(o1, time + dec + 0.06, [amp])
      disposeAt(o2, time + dec + 0.06, [a2, pn])
    }

    // -- the transport ----------------------------------------------------------

    interface Row {
      step: number
      /** Grid position, 1-based from when the transport started. */
      m: number
      fired: boolean[]
      midi: number
    }

    /** What was actually dispatched. The readout measures this, not the model. */
    const log: Row[] = []
    /** Voices firing per step, over a long ring, for the defect counts. */
    const counts: number[] = []
    let base = -1

    ctx.clock.onStep((e) => {
      if (base < 0) base = e.step
      const m = e.step - base + 1
      const ds = dsNow()
      const n = ds.length
      const solo = Math.round(ctx.params.solo)
      // Extra voices mean more simultaneous notes, and 3 or 4 voices is the
      // broken mode rather than the instrument, so it gives back some headroom.
      const lvl = (0.80 + ctx.params.level * 0.58) / (1 + 0.16 * (n - 2))
      const dec = ctx.params.decay
      const midi = tune[m % TUNE]

      const fired: boolean[] = []
      let k = 0
      let sounding = 0
      for (let i = 0; i < MAX_VOICES; i++) {
        const f = i < n && plays(ds[i], m)
        fired.push(f)
        if (f) {
          k++
          if (solo === 0 || solo === i + 1) sounding++
        }
      }

      /**
       * Voices that collide are playing the same note at the same instant, so
       * their oscillators sum coherently and k of them is k times the
       * amplitude. Sharing as k^-0.75 leaves a doubling audible as a +1.5 dB
       * accent — which is what a defect should sound like — while bounding the
       * worst case at 1.3x instead of 4x.
       */
      const share = Math.pow(Math.max(1, sounding), -0.75)
      for (let i = 0; i < n; i++) {
        if (!fired[i] || (solo !== 0 && solo !== i + 1)) continue
        strike(
          midi,
          e.time,
          lvl * share * (i === 0 ? 1 : 0.86),
          n === 1 ? 0 : -0.45 + (i / (n - 1)) * 0.9,
          i / Math.max(1, MAX_VOICES - 1),
          dec * (i === 0 ? 1 : 0.86),
        )
      }

      if (ctx.params.pulse) {
        const t = Math.max(e.time, ctx.audio.currentTime + 0.004)
        const o = ctx.audio.createOscillator()
        o.type = 'triangle'
        o.frequency.value = mtof(Math.round(ctx.params.root) + 36)
        const g = ctx.audio.createGain()
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(lvl * 0.075, t + 0.004)
        g.gain.exponentialRampToValueAtTime(1e-4, t + 0.05)
        o.connect(g).connect(bus)
        o.start(t)
        disposeAt(o, t + 0.11, [g])
      }

      log.push({ step: e.step, m, fired, midi })
      if (log.length > 200) log.shift()
      counts.push(k)
      if (counts.length > 4096) counts.shift()
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          base = -1
          counts.length = 0
          log.length = 0
        }
      }),
    )

    // -- drawing -----------------------------------------------------------------

    /** Defect rate against voice 1's share, at the current error and voice count. */
    const NC = 220
    let curve: number[] = []
    let curveKey = ''

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 10
      const vs = ctx.clock.visualStep
      const n = Math.round(ctx.params.voices)
      const share = shareNow()
      const win = Math.round(ctx.params.window)

      // -- what was dispatched -------------------------------------------------
      const seen = Math.min(counts.length, win)
      let coll = 0
      let gap = 0
      for (let i = counts.length - seen; i < counts.length; i++) {
        if (counts[i] === 0) gap++
        else if (counts[i] > 1) coll++
      }

      const LO = 0.06
      const HI = 0.94
      const key = `${ctx.params.err}|${n}|${win}`
      if (key !== curveKey) {
        curveKey = key
        const cw = Math.min(NC, Math.max(60, Math.floor(w - pad * 2)))
        const steps = Math.min(win, 1200)
        curve = new Array(cw)
        for (let i = 0; i < cw; i++) {
          const s = LO + (i / (cw - 1)) * (HI - LO)
          curve[i] = defects(densities(s, n, ctx.params.err), steps).rate
        }
      }

      const head = 15
      const avail = h - pad * 2 - head
      const stripH = Math.max(46, Math.min(avail * 0.52, 132))
      const curveH = Math.max(34, avail - stripH - 10)
      const stripTop = pad + head
      const curveTop = stripTop + stripH + 10

      // -- header ---------------------------------------------------------------
      g.font = '11px ui-monospace, monospace'
      g.textBaseline = 'alphabetic'
      g.fillStyle = 'rgba(255,255,255,0.62)'
      const snapQ = Math.round(ctx.params.snap)
      const frac = snapQ >= 1 ? nearestFraction(ctx.params.split, snapQ) : null
      g.fillText(
        `share ${share.toFixed(6)}${frac ? ` = ${frac.p}/${frac.q}` : ''}` +
          `   ${n} voices   over ${seen} steps: ${coll} doubled, ${gap} missing`,
        pad,
        pad + 10,
      )

      // -- who owns which step --------------------------------------------------
      const rows: Row[] = []
      for (let i = log.length - 1; i >= 0 && rows.length < 84; i--) {
        if (log[i].step <= vs) rows.unshift(log[i])
      }
      const COLS = 84
      const cw = (w - pad * 2) / COLS
      const laneH = stripH / (n + 1)

      g.fillStyle = 'rgba(255,255,255,0.035)'
      g.fillRect(pad, stripTop, w - pad * 2, stripH)

      for (let c = 0; c < rows.length; c++) {
        const row = rows[c]
        const x = pad + (COLS - rows.length + c) * cw
        let k = 0
        for (let i = 0; i < n; i++) if (row.fired[i]) k++

        for (let i = 0; i < n; i++) {
          if (!row.fired[i]) continue
          const y = stripTop + i * laneH
          g.fillStyle = k > 1 ? '#f87171' : COLOURS[i]
          g.globalAlpha = 0.9
          g.fillRect(x + 0.5, y + 2, Math.max(1, cw - 1), laneH - 4)
          g.globalAlpha = 1
        }

        // the composite lane: one mark per step is what the whole thing is for
        const y = stripTop + n * laneH
        if (k === 1) {
          g.fillStyle = 'rgba(255,255,255,0.55)'
          g.fillRect(x + 0.5, y + laneH * 0.35, Math.max(1, cw - 1), laneH * 0.3)
        } else if (k === 0) {
          g.strokeStyle = 'rgba(248,113,113,0.75)'
          g.lineWidth = 1
          g.strokeRect(x + 1, y + laneH * 0.25, Math.max(1, cw - 2), laneH * 0.5)
        } else {
          g.fillStyle = '#f87171'
          g.fillRect(x + 0.5, y + laneH * 0.15, Math.max(1, cw - 1), laneH * 0.7)
        }
      }

      g.strokeStyle = 'rgba(255,255,255,0.1)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(pad, stripTop + n * laneH)
      g.lineTo(w - pad, stripTop + n * laneH)
      g.stroke()

      // -- the defect landscape --------------------------------------------------
      const gw = w - pad * 2
      g.fillStyle = 'rgba(255,255,255,0.035)'
      g.fillRect(pad, curveTop, gw, curveH)
      const top = Math.max(0.02, Math.max(...curve))
      const bw = gw / curve.length
      for (let i = 0; i < curve.length; i++) {
        const v = curve[i] / top
        if (v <= 0) continue
        g.fillStyle = v > 0.5 ? '#f87171' : v > 0.15 ? '#fbbf24' : 'rgba(251,191,36,0.55)'
        g.fillRect(pad + i * bw, curveTop + curveH * (1 - v), Math.max(1, bw), curveH * v)
      }
      // where the share sits now
      const sx = pad + ((share - LO) / (HI - LO)) * gw
      g.strokeStyle = '#7dd3fc'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(sx, curveTop)
      g.lineTo(sx, curveTop + curveH)
      g.stroke()

      g.fillStyle = 'rgba(255,255,255,0.4)'
      g.font = '10px ui-monospace, monospace'
      g.fillText(`defect rate vs share, over ${Math.min(win, 1200)} steps (peak ${top.toFixed(3)})`, pad + 3, curveTop + 11)
      g.fillText(LO.toFixed(2), pad + 1, curveTop + curveH - 3)
      g.textAlign = 'right'
      g.fillText(HI.toFixed(2), w - pad - 1, curveTop + curveH - 3)
      g.textAlign = 'left'
    })

    const report = () => {
      const ds = dsNow()
      const d = defects(ds, Math.min(Math.round(ctx.params.window), 2000))
      ctx.status(
        ds.length === 2 && d.rate === 0
          ? `${ds.map((v) => v.toFixed(5)).join(' + ')} — every step exactly once`
          : `${ds.map((v) => v.toFixed(5)).join(' + ')} — ${d.coll} doubled, ${d.gap} missing in ${Math.min(Math.round(ctx.params.window), 2000)} steps`,
      )
    }
    report()
    for (const k of ['split', 'err', 'voices', 'snap', 'window'] as const) ctx.onParam(k, report)

    // Read back by the harness; the sketch's own numbers come from the same code.
    ;(window as unknown as Record<string, unknown>).__hocket = () => ({
      tap: () => bus,
      set: (k: string, v: number | boolean | string) =>
        ctx.set(k as never, v as never),
      densities: dsNow(),
      log,
      counts,
      tune,
    })
  },
})
