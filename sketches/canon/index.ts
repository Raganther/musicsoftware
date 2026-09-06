import { disposeAt, mtof, noteName, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import { ALL_RULES, Canon, spec, SPAN, violations, type Rules } from './solve'

/**
 * Composing a canon by elimination.
 *
 * `species` holds every legal counterpoint against a fixed cantus firmus and
 * lets you compose by fixing notes until the count reaches one. This asks the
 * same question of a much less forgiving object: a canon, where the second
 * voice *is* the first one, delayed.
 *
 * That one change alters the character of the problem completely. In a
 * counterpoint the two lines are independent, so a note has one job. In a canon
 * every note has two: it is sung once as melody and again, d notes later, as
 * harmony against whatever the melody has become. Fixing a note therefore
 * constrains the future *and* the past, and the constraint graph closes on
 * itself. It is why canons feel like puzzles and counterpoints feel like
 * writing.
 *
 * There is a nice consequence for parallel fifths in particular. The vertical
 * interval moves by (melodic interval at i) − (melodic interval at i−d, as the
 * follower sings it), so it stays put exactly when the melody repeats one of
 * its own intervals d notes later. A parallel perfect is therefore not a fact
 * about two lines at all; it is a self-similarity in one line, landing where
 * the vertical interval happens to be perfect. That is the sort of thing you
 * only notice by building the object.
 *
 * The interval of imitation is a parameter and the sketch counts all eight at
 * once, which turns the textbook's advice into a measurement — and contradicts
 * it. The third below is the roomiest by some way; the classic fifth is only
 * fourth, at under half the count. See `notes`.
 */

const IMITATIONS = [-7, -6, -5, -4, -3, -2, -1, 0]
const IM_NAMES = ['8ve below', '7th below', '6th below', '5th below', '4th below', '3rd below', '2nd below', 'unison']

export default defineSketch({
  title: 'Canon',
  description: 'Every legal canon at once — the second voice is the first one delayed, so fixing a note constrains the past as well as the future.',
  tags: ['composition', 'counterpoint', 'generative'],
  status: 'promising',
  bpm: 96,
  division: 2,

  params: {
    length: { type: 'number', value: 14, min: 8, max: 18, step: 1, label: 'Melody length' },
    /**
     * How far behind the follower comes in, in notes. This is the whole cost of
     * the sketch: the DP state has to hold delay+1 notes, so the space is
     * 8^(d+1) states — 4,096 at three, 32,768 at four. Four is the ceiling and
     * it is a real one.
     */
    delay: { type: 'number', value: 2, min: 1, max: 4, step: 1, label: 'Delay (notes)' },
    /** Interval of imitation, in scale steps below. −4 is the classic fifth. */
    imitate: { type: 'number', value: -4, min: -7, max: 0, step: 1, label: 'Imitation (scale steps)' },
    root: { type: 'number', value: 62, min: 48, max: 74, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'major', options: SCALE_NAMES as unknown as string[], label: 'Scale' },

    consonance: { type: 'toggle', value: true, label: 'Consonance' },
    parallels: { type: 'toggle', value: true, label: 'No parallel perfects' },
    melody: { type: 'toggle', value: true, label: 'Singable line' },
    variety: { type: 'toggle', value: true, label: 'Variety' },
    cadence: { type: 'toggle', value: true, label: 'Close on a perfect' },

    hold: { type: 'number', value: 2, min: 1, max: 4, step: 1, label: 'Steps per note' },
    solo: { type: 'select', value: 'both', options: ['both', 'leader', 'follower'], label: 'Hear' },
    tone: { type: 'number', value: 0.5, min: 0, max: 1, label: 'Tone' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 7, min: 1, max: 999, step: 1, label: 'Seed' },
    keep: { type: 'button', label: 'Fix what you just heard' },
    clear: { type: 'button', label: 'Release everything' },
  },

  notes: `
Every legal canon at once. \`species\` did this for counterpoint against a fixed
cantus firmus; a canon is the harder object, because the second voice **is** the
first one delayed. Each note is sung twice — once as melody, once as harmony d
notes later — so committing to one constrains the future *and* the past.

That widens the machine. The harmonic rule reads notes i and i−d, parallels also
read i−1 and i−d−1, so the state is the last d+1 notes rather than the last two:
8^(d+1) states, 32,768 at the maximum delay of four. Still exact, and it buys
exact counts, exact per-note marginals and uniform sampling. The number on
screen is the number.

**It agrees with brute force.** Eight configurations with the span, length,
delay and imitation all varied: counts identical, per-note marginals to
**0.0e+0**, and identical again with a note committed — the case the tool
actually runs. 40,000 draws over a 235-canon space found all 235, none illegal,
chi-square **220.0 on 234 df**.

**A canon costs three to four orders of magnitude.** The same line rules with no
second voice admit 1.09e12 melodies; the canon admits ×15,790 fewer at delay 1,
falling to ×2,003 at delay 4. The delay does not make canon-writing easier in
any interesting sense — it just removes simultaneities.

**And at the fifth, each simultaneity costs almost exactly one bit.** Fit over
24 configurations spanning 7 to 15 simultaneities, along two independent axes:

    canons = melodies / (1.89 × 2.012 ^ simultaneities)

worst residual **10.6%** on counts running from 1.5 million to 6.9 billion. The
2.012 is not arbitrary: six of the twelve semitone classes are consonant, so a
simultaneity whose interval is spread evenly costs a factor of two, and it does.

**That law is about the fifth, not about canons.** Refit at each of the eight
imitations and only the fifth (11.2%) and the third (17.1%) are described by it;
the octave and the unison miss by **74.7%**, the second below by 87.5%. At the
unison the follower sings the leader's own pitch classes, so the vertical
interval *is* the melody's interval across d notes — already shaped by the
melodic rules, no longer spread evenly, and the per-simultaneity cost drops to
1.72. Two parameters cannot absorb that.

**The textbook's fifth is not the roomiest imitation.** Counted at length 14 and
delay 2: the **third below** is widest at 247M, the octave and unison next at
235M, and the fifth only fourth at 120M — under half the third. The fifth's
standing is about tonal answer, which this model does not represent at all.

**And nothing simple predicts that ordering.** Consonance alone does the sorting
(the spread is ×2.21 of ×2.33 with every other rule off; turning the cadence
rule off changes it from ×2.33 to ×2.32, which is nothing). But no first-order
statistic gets it: whether a degree is consonant against itself gives r = 0.66,
flat pair density 0.58, and pair density properly weighted by how melodies
actually move only 0.84, with predictions off by up to 70%. Consecutive
simultaneities share notes, and that is where the ordering lives.

Rule costs at the fifth, delay 2: consonance ×1606, parallels ×3.84, singable
line ×3.67, cadence ×2.26, variety ×1.67.

Click a cell to fix a note; the count collapses and everything re-derives. Fix
them all and the count reads 1 — you have composed a canon without ever having
been offered a note that breaks a rule.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: 0.24, seconds: 2.0 })
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)

    // -- the problem ----------------------------------------------------------

    const rules = (): Rules => ({
      consonance: !!ctx.params.consonance,
      parallels: !!ctx.params.parallels,
      melody: !!ctx.params.melody,
      variety: !!ctx.params.variety,
      cadence: !!ctx.params.cadence,
    })

    let sp = spec(62, 'major', 14, 2, -4, ALL_RULES)
    let space: Canon | null = null
    let fixed: number[] = []
    let draw: number[] | null = null
    /** What is actually sounding, so the drawing and the audio cannot disagree. */
    let sounding: number[] | null = null
    let pos = 0
    let msg = ''
    let r = rng(Math.round(ctx.params.seed))
    let solveMs = 0

    /** Counts for every interval of imitation, filled in one per frame. */
    let chart: (number | null)[] = IMITATIONS.map(() => null)
    let chartAt = 0
    /** How many melodies the melodic rules alone allow — what the canon is compared to. */
    let bare = 0

    const build = () => {
      const n = Math.round(ctx.params.length)
      const d = Math.round(ctx.params.delay)
      sp = spec(
        Math.round(ctx.params.root),
        ctx.params.scale as ScaleName,
        n,
        d,
        Math.round(ctx.params.imitate),
        rules(),
      )
      if (fixed.length !== n) fixed = new Array(n).fill(-1)
      const t0 = performance.now()
      space = new Canon(sp, fixed)
      solveMs = performance.now() - t0
      msg = space.total > 0 ? '' : 'nothing legal — release a note or turn a rule off'
      draw = space.total > 0 ? space.sample(r) : null
      // The same melody with no second voice: what self-imitation costs.
      const alone = new Canon(
        { ...sp, rules: { ...rules(), consonance: false, parallels: false, cadence: false } },
        fixed,
      )
      bare = alone.total
      chart = IMITATIONS.map(() => null)
      chartAt = 0
    }

    const resize = () => {
      fixed = new Array(Math.round(ctx.params.length)).fill(-1)
      pos = 0
      build()
    }

    resize()

    for (const k of ['length'] as const) ctx.onParam(k, resize)
    for (const k of ['delay', 'imitate', 'root', 'scale', 'consonance', 'parallels', 'melody', 'variety', 'cadence'] as const) {
      ctx.onParam(k, build)
    }
    ctx.onParam('seed', (v) => {
      r = rng(Math.round(v))
      build()
    })

    ctx.onPress('keep', () => {
      const src = sounding ?? draw
      if (!src) return
      fixed = src.slice()
      build()
    })
    ctx.onPress('clear', () => {
      fixed = new Array(sp.n).fill(-1)
      build()
    })

    // -- two voices, one melody ------------------------------------------------

    const play = (midi: number, time: number, dur: number, gain: number, cut: number, pan: number) => {
      const osc = ctx.audio.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = mtof(midi)
      const osc2 = ctx.audio.createOscillator()
      osc2.type = 'sawtooth'
      osc2.frequency.value = mtof(midi)
      osc2.detune.value = 5
      const mix = ctx.audio.createGain()
      mix.gain.value = 0.4
      const filt = ctx.audio.createBiquadFilter()
      filt.type = 'lowpass'
      filt.frequency.value = cut
      filt.Q.value = 0.7
      const amp = ctx.audio.createGain()
      amp.gain.value = 0
      const p = ctx.audio.createStereoPanner()
      p.pan.value = pan
      osc.connect(mix)
      osc2.connect(mix)
      mix.connect(filt).connect(amp).connect(p).connect(bus)
      const a = 0.02
      const rel = Math.min(0.22, dur * 0.35)
      amp.gain.setValueAtTime(0, time)
      amp.gain.linearRampToValueAtTime(gain, time + a)
      amp.gain.setValueAtTime(gain, time + Math.max(a, dur - rel))
      amp.gain.linearRampToValueAtTime(0, time + dur)
      osc.start(time)
      osc2.start(time)
      disposeAt(osc, time + dur + 0.05, [mix, filt, amp, p])
      disposeAt(osc2, time + dur + 0.05)
    }

    /** What the scheduler dispatched, so a harness can ask what is *sounding*. */
    const spans: { t: number; end: number; lead: number; foll: number }[] = []

    ctx.clock.onStep((e) => {
      const every = Math.round(ctx.params.hold)
      if (e.step % every !== 0) return
      const n = sp.n
      const d = sp.d
      if (pos >= n + d) {
        pos = 0
        if (space && space.total > 0) draw = space.sample(r)
      }
      if (pos === 0) sounding = draw
      const x = sounding
      if (!x) return
      const dur = e.dur * every * 0.94
      const cut = 600 + ctx.params.tone * 2800
      const lvl = 0.5 + ctx.params.level * 1.1
      const hear = ctx.params.solo as string
      const lm = pos < n ? sp.lead[x[pos]] : -1
      const fm = pos >= d ? sp.foll[x[pos - d]] : -1
      if (lm > 0 && hear !== 'follower') play(lm, e.time, dur, lvl, cut, 0.3)
      if (fm > 0 && hear !== 'leader') play(fm, e.time, dur, lvl * 0.95, cut * 0.72, -0.3)
      spans.push({ t: e.time, end: e.time + dur, lead: lm, foll: fm })
      if (spans.length > 96) spans.shift()
      pos++
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) pos = 0
      }),
    )

    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    // -- drawing ---------------------------------------------------------------

    const fmt = (v: number) =>
      v >= 1e15 ? v.toExponential(2) : Math.round(v).toLocaleString('en-US')

    let hover = { i: -1, c: -1 }

    const g = ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      if (!space) return
      const n = sp.n
      const d = sp.d
      const cols = n + d
      const padL = 40
      const padR = 12
      const padT = 16
      const chartH = 54
      const gridH = h - padT - chartH - 52
      const cw = (w - padL - padR) / cols

      // Fill in one column of the imitation chart per frame, so a param change
      // never blocks on eight solves.
      if (chartAt < IMITATIONS.length) {
        const q = IMITATIONS[chartAt]
        const s2 = spec(Math.round(ctx.params.root), ctx.params.scale as ScaleName, n, d, q, rules())
        chart[chartAt] = new Canon(s2, fixed).total
        chartAt++
      }

      const lo = Math.min(...sp.foll) - 1
      const hi = Math.max(...sp.lead) + 1
      const py = (midi: number) => padT + gridH - ((midi - lo) / (hi - lo)) * gridH
      const px = (i: number) => padL + (i + 0.5) * cw

      // -- the space, as heat over the leader's candidates ---------------------
      const rowH = Math.max(3, (gridH / (hi - lo)) * 1.6)
      let maxM = 1
      for (let i = 0; i < n; i++) for (let c = 0; c < SPAN; c++) maxM = Math.max(maxM, space.marg[i][c])
      for (let i = 0; i < n; i++) {
        const tot = space.total || 1
        for (let c = 0; c < SPAN; c++) {
          const frac = space.marg[i][c] / tot
          const y = py(sp.lead[c])
          if (frac <= 0) {
            g.fillStyle = 'rgba(255,255,255,0.035)'
          } else {
            g.fillStyle = `rgba(125,211,252,${0.09 + Math.min(1, frac * 2.4) * 0.55})`
          }
          g.fillRect(px(i) - cw * 0.42, y - rowH / 2, cw * 0.84, rowH)
          if (fixed[i] === c) {
            g.strokeStyle = 'rgba(251,191,36,0.95)'
            g.lineWidth = 1.5
            g.strokeRect(px(i) - cw * 0.42, y - rowH / 2, cw * 0.84, rowH)
          }
        }
      }
      if (hover.i >= 0 && hover.i < n) {
        g.strokeStyle = 'rgba(255,255,255,0.3)'
        g.lineWidth = 1
        g.strokeRect(px(hover.i) - cw * 0.42, py(sp.lead[hover.c]) - rowH / 2, cw * 0.84, rowH)
      }

      // -- pitch labels ----------------------------------------------------------
      g.font = '9px ui-monospace, monospace'
      g.textAlign = 'right'
      g.fillStyle = 'rgba(255,255,255,0.32)'
      for (let c = 0; c < SPAN; c += 2) g.fillText(noteName(sp.lead[c]), padL - 5, py(sp.lead[c]) + 3)
      g.textAlign = 'left'

      const x = sounding ?? draw
      if (x) {
        // -- the vertical intervals ---------------------------------------------
        for (let i = d; i < n; i++) {
          const A = sp.lead[x[i]]
          const B = sp.foll[x[i - d]]
          const iv = (((A - B) % 12) + 12) % 12
          const perfect = iv === 0 || iv === 7
          g.strokeStyle = perfect ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.13)'
          g.lineWidth = perfect ? 1.6 : 1
          g.beginPath()
          g.moveTo(px(i), py(A))
          g.lineTo(px(i), py(B))
          g.stroke()
        }

        // -- the two voices ------------------------------------------------------
        const line = (get: (i: number) => number, from: number, to: number, col: string, wdt: number) => {
          g.strokeStyle = col
          g.lineWidth = wdt
          g.beginPath()
          for (let i = from; i < to; i++) {
            const y = py(get(i))
            i === from ? g.moveTo(px(i), y) : g.lineTo(px(i), y)
          }
          g.stroke()
          for (let i = from; i < to; i++) {
            g.fillStyle = col
            g.beginPath()
            g.arc(px(i), py(get(i)), 2.6, 0, Math.PI * 2)
            g.fill()
          }
        }
        line((i) => sp.lead[x[i]], 0, n, 'rgba(226,232,240,0.95)', 1.8)
        line((i) => sp.foll[x[i - d]], d, n + d, 'rgba(74,222,128,0.85)', 1.8)

        // the playhead, from the audio clock rather than the scheduler
        const now = ctx.audio.currentTime
        const live = spans.find((s) => now >= s.t && now < s.end)
        if (live) {
          const idx = spans.indexOf(live) - (spans.length - 1) + (pos - 1)
          const i = ((idx % cols) + cols) % cols
          g.strokeStyle = 'rgba(255,255,255,0.5)'
          g.lineWidth = 1
          g.beginPath()
          g.moveTo(px(i), padT)
          g.lineTo(px(i), padT + gridH)
          g.stroke()
        }
      }

      // -- the imitation chart ----------------------------------------------------
      const cTop = padT + gridH + 16
      const bw = (w - padL - padR) / IMITATIONS.length
      let cMax = 1
      for (const v of chart) if (v !== null) cMax = Math.max(cMax, v)
      const here = IMITATIONS.indexOf(Math.round(ctx.params.imitate))
      for (let k = 0; k < IMITATIONS.length; k++) {
        const v = chart[k]
        const bx = padL + k * bw
        if (v === null) {
          g.fillStyle = 'rgba(255,255,255,0.06)'
          g.fillRect(bx + 2, cTop + chartH - 12, bw - 4, 4)
        } else {
          // log scale: the spread between the best and worst imitation is large
          const frac = v <= 0 ? 0 : Math.log10(1 + v) / Math.log10(1 + cMax)
          const bh = Math.max(1.5, frac * (chartH - 14))
          g.fillStyle = k === here ? 'rgba(251,191,36,0.9)' : 'rgba(125,211,252,0.5)'
          g.fillRect(bx + 2, cTop + chartH - 12 - bh, bw - 4, bh)
        }
        g.font = '8px ui-monospace, monospace'
        g.fillStyle = k === here ? 'rgba(251,191,36,0.9)' : 'rgba(255,255,255,0.34)'
        g.fillText(IM_NAMES[k], bx + 2, cTop + chartH - 2)
      }
      g.font = '9px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.34)'
      g.fillText('legal canons by interval of imitation (log)', padL, cTop - 3)

      // -- the numbers -------------------------------------------------------------
      g.font = '12px ui-monospace, monospace'
      g.fillStyle = msg ? 'rgba(248,113,113,0.95)' : 'rgba(255,255,255,0.85)'
      const nFixed = fixed.filter((v) => v >= 0).length
      g.fillText(
        msg ||
          `${fmt(space.total)} legal canon${space.total === 1 ? '' : 's'}` +
            `  ·  ${nFixed}/${n} fixed  ·  delay ${d}, ${IM_NAMES[here] ?? ctx.params.imitate}`,
        padL,
        h - 20,
      )
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.4)'
      const cost = space.total > 0 ? bare / space.total : 0
      g.fillText(
        `${fmt(bare)} melodies pass the line rules alone — self-imitation costs ${cost >= 1 ? '×' + fmt(cost) : 'nothing'}` +
          `  ·  ${space.S.toLocaleString('en-US')} states, ${solveMs.toFixed(0)} ms`,
        padL,
        h - 6,
      )
    })

    // -- fixing notes by hand ------------------------------------------------------

    const cell = (ev: PointerEvent) => {
      const rect = g.canvas.getBoundingClientRect()
      const w = rect.width
      const h = rect.height
      const cols = sp.n + sp.d
      const padL = 40
      const padT = 16
      const gridH = h - padT - 54 - 52
      const cw = (w - padL - 12) / cols
      const i = Math.floor((ev.clientX - rect.left - padL) / cw)
      const lo = Math.min(...sp.foll) - 1
      const hi = Math.max(...sp.lead) + 1
      const midi = lo + (1 - (ev.clientY - rect.top - padT) / gridH) * (hi - lo)
      let best = 0
      for (let c = 1; c < SPAN; c++) {
        if (Math.abs(sp.lead[c] - midi) < Math.abs(sp.lead[best] - midi)) best = c
      }
      if (i < 0 || i >= sp.n) return null
      if (ev.clientY - rect.top < padT || ev.clientY - rect.top > padT + gridH) return null
      return { i, c: best }
    }

    const onDown = (ev: PointerEvent) => {
      const hit = cell(ev)
      if (!hit) return
      fixed[hit.i] = fixed[hit.i] === hit.c ? -1 : hit.c
      build()
      if (space && space.total <= 0) {
        // Never leave the tool in a dead state it cannot explain its way out of.
        fixed[hit.i] = -1
        build()
        msg = 'no canon has that note there'
      }
    }
    const onMove = (ev: PointerEvent) => {
      const hit = cell(ev)
      hover = hit ?? { i: -1, c: -1 }
    }
    g.canvas.addEventListener('pointerdown', onDown)
    g.canvas.addEventListener('pointermove', onMove)
    ctx.cleanup(() => {
      g.canvas.removeEventListener('pointerdown', onDown)
      g.canvas.removeEventListener('pointermove', onMove)
    })

    // -- a way in for the harness ----------------------------------------------

    const wnd = window as unknown as Record<string, unknown>
    wnd.__canon = () => ({
      n: sp.n,
      d: sp.d,
      total: space?.total ?? 0,
      bare,
      states: space?.S ?? 0,
      solveMs,
      melody: sounding ?? draw,
      pitches: (sounding ?? draw) ? space!.voices((sounding ?? draw)!) : null,
      lead: sp.lead.slice(),
      foll: sp.foll.slice(),
      spans: spans.slice(),
      /** The dry bus, before the room — a reverb tail is no help to a pitch detector. */
      tap: () => bus,
      set: (k: string, v: number | string) => ctx.set(k as never, v as never),
      /** Commit what is sounding, so the space collapses to it and every pass repeats. */
      pin: () => {
        const x = sounding ?? draw
        if (!x) return null
        fixed = x.slice()
        build()
        return x.slice()
      },
      /** Is what is drawn actually legal? Asked of the definition, not the DP. */
      check: () => {
        const x = sounding ?? draw
        return x ? violations(sp, x) : ['nothing drawn']
      },
    })
    ctx.cleanup(() => delete wnd.__canon)

    ctx.status('press space — click a cell to fix a note and watch the count collapse')
  },
})
