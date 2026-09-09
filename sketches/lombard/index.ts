import { clamp, degree, disposeAt, mtof, noteName, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import { edges, growthRate, heard, maxCycleMean, overlap, round, type Player } from './crowd'

/**
 * An ensemble that competes for loudness.
 *
 * Every other interaction sketch here couples through pitch or through time.
 * This one couples through *level*: each player wants to be some number of
 * decibels above what it can hear of everyone else, which is the Lombard
 * reflex, and is why restaurants and rock bands get louder and never quieter.
 *
 * Whether the room settles or runs away has an exact answer, and it does not
 * depend on how loud anyone starts. A sum of powers expressed in dB is very
 * nearly the largest of them, so to first order the update is
 *
 *     L_i ← max_j ( L_j + 10·log10(w_ij) + t_i )
 *
 * which is linear in the max-plus algebra — "add" is max, "multiply" is plus.
 * Those grow at their max-plus eigenvalue, which is the **maximum cycle mean**
 * of the graph whose edge j → i carries t_i + 10·log10(w_ij). Two players each
 * needing 3 dB over the other form a cycle of mean 3: the room gets 3 dB louder
 * every round, forever.
 *
 * The correction to that first order is the interesting part and is measured in
 * `notes`: hearing three rivals at once is louder than hearing the loudest of
 * them, so a crowded band climbs faster than any *pair* of its players would.
 * A room can run away with nobody in it being unreasonable.
 *
 * There is no way to win it. Holding your own level high just raises everyone
 * else, which is the point.
 */

const MAX_PLAYERS = 6
const FLOOR = -45
const CEIL = 0
/** Where a room starts before anyone has adjusted. Audible, with room to climb. */
const START = -10
const COLOURS = [
  'rgba(248,113,113,',
  'rgba(251,191,36,',
  'rgba(74,222,128,',
  'rgba(125,211,252,',
  'rgba(167,139,250,',
  'rgba(244,114,182,',
]

export default defineSketch({
  title: 'Lombard',
  description: 'An ensemble that competes for loudness — and the cycle mean that says whether it ever stops.',
  tags: ['ensemble', 'generative', 'interaction'],
  status: 'promising',
  bpm: 104,
  division: 2,

  params: {
    players: { type: 'number', value: 5, min: 2, max: MAX_PLAYERS, step: 1, label: 'Players' },
    /**
     * How far apart the players sit, in scale steps. This is the whole demo:
     * crowding is what causes the arms race, not assertiveness. Spread the
     * ensemble across registers and the same players, wanting exactly the same
     * margin, settle instead of climbing.
     */
    spacing: { type: 'number', value: 3, min: 1, max: 8, step: 1, label: 'Spacing (scale steps)' },
    /** How many dB above what it hears each player wants to be, on average. */
    assert: { type: 'number', value: 2, min: -6, max: 6, step: 0.1, label: 'Assertiveness (dB)' },
    vary: { type: 'number', value: 1.5, min: 0, max: 4, step: 0.1, label: 'Assertiveness spread' },
    /** How much of the spectrum each player takes up, and listens across. */
    bandwidth: { type: 'number', value: 0.5, min: 0.15, max: 1.2, step: 0.01, label: 'Bandwidth (octaves)' },
    /** How far each player moves toward contentment per bar. Scales the rate exactly. */
    rate: { type: 'number', value: 0.5, min: 0.05, max: 1, step: 0.01, label: 'Reaction' },
    /** Whose level you are holding, and where. 0 is nobody — let them sort it out. */
    you: { type: 'number', value: 0, min: 0, max: MAX_PLAYERS, step: 1, label: 'You are player' },
    yours: { type: 'number', value: -12, min: FLOOR, max: CEIL, step: 0.5, label: 'Your level (dB)' },
    root: { type: 'number', value: 50, min: 36, max: 62, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'dorian', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    space: { type: 'number', value: 0.24, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 6, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
Every other interaction sketch here couples through pitch or through time. This
one couples through **level**: each player wants to be some number of decibels
above what it can hear of everyone else, which is the Lombard reflex and is why
restaurants and rock bands get louder and never quieter.

Whether the room settles or runs away has an exact answer, and it has nothing to
do with how loud anyone starts. A sum of powers in dB is nearly the largest of
them, so to first order the update is a **max-plus** linear system, and those
grow at their max-plus eigenvalue — the **maximum cycle mean** of the graph
whose edge j → i carries (what i wants over j). Two players each needing 3 dB
over the other make a cycle of mean 3, and the room gets 3 dB louder every round
forever.

**Measured, that law is exact.** Across seven configurations — 2 to 6 players,
wide bands and narrow, assertive and not, and reaction rates of 1, 0.6, 0.4 —
the growth rate matches rate × cycle mean to **0.0000 dB per round**, once the
cycle mean is taken on the graph corrected for the soft maximum. Two players in
one band at +3 each give exactly 3.000 dB per round; halve the reaction and it
is exactly 1.500.

**And the correction is the finding.** The plain max-plus value is a strict
lower bound, not an estimate, because hearing three rivals at once is louder
than hearing the loudest of them. Five players whose graph has a cycle mean of
**0.862** actually climb at **3.650** dB per round; six wide-banded ones go from
1.175 to **4.117**. The gap is a property of the overlap alone — shift every
player's assertiveness down by 5 dB and the cycle mean moves by exactly 5 while
the gap does not move at all.

So the threshold is not where any pair of players is unreasonable. **A room can
run away with nobody in it being unreasonable**, purely because everyone hears
several people at once, and the thing that decides it is crowding.

Held at +2 dB of assertiveness throughout — nobody becoming more reasonable —
and varying only how far apart the players sit:

    spacing   pairs alone   with crowding   runs away
       1         +0.945        +3.624          yes
       3         +0.628        +2.409          yes
       5         −0.195        +1.153          yes
       6         −0.503        +0.463          yes
       7         −1.166        −0.182          no

At spacings 5 and 6 **no pair of players is in an escalating relationship at
all** and the room still runs away. Pairwise reasoning puts the threshold two
whole steps early.

**And the room you hear does it.** Measured off the recording, bar by bar: a
crowded ensemble climbs at **0.383 dB per bar** against 0.409 predicted, and the
same ensemble spread across registers drains at **−0.350** against −0.369 — both
within 0.025 dB per bar, in both directions, with nobody's assertiveness
touched. There is a consistent 6% shortfall in magnitude I could not account
for: it is not transient bars inside the fit (dropping them moves the slope by
0.005) and it is not the recording measuring the sum where the prediction
follows the loudest (the model's own total power grows at the predicted rate,
not the heard one). Two explanations tested and killed, and it is still there.

Which is what \`Spacing\` does. Leave the assertiveness alone and spread the
players across registers: the overlaps fall, the correction shrinks, and the
same ensemble that was climbing settles. It is the only control here that
works, and the one nobody in a loud room has.

\`You are player\` hands you one of them at a level you choose. There is no way
to win it — holding yours up just raises everyone else, and the readout shows
the room climbing while you do it.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.0 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)

    // -- who is in the room --------------------------------------------------

    let ps: Player[] = []
    let w: number[][] = []
    let L: number[] = []
    let pitches: number[] = []
    let patterns: boolean[][] = []
    /** Level history, one row per round, for the plot. */
    let hist: number[][] = []
    let rounds = 0
    let predicted = 0
    let predictedPlain = 0

    const build = () => {
      const n = Math.round(ctx.params.players)
      const r = rng(Math.round(ctx.params.seed))
      const root = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      const step = Math.round(ctx.params.spacing)
      ps = []
      pitches = []
      patterns = []
      for (let i = 0; i < n; i++) {
        const p = degree(root, scale, i * step)
        pitches.push(p)
        // A bandpassed saw sits a little above its fundamental, and that
        // centroid — not the pitch — is what the others actually hear.
        ps.push({
          f: mtof(p) * 1.6,
          oct: ctx.params.bandwidth,
          target: ctx.params.assert + (r.next() - 0.5) * 2 * ctx.params.vary,
        })
        const pat: boolean[] = []
        for (let k = 0; k < 16; k++) pat.push(r.next() < 0.34 || k % 8 === i % 8)
        patterns.push(pat)
      }
      w = overlap(ps)
      predictedPlain = maxCycleMean(edges(ps, w)) * ctx.params.rate
      predicted = growthRate(ps, w, ctx.params.rate)
      // Keep the levels the room has already reached. Rebuilding them here
      // would throw away the whole gesture: the thing worth doing with this is
      // to let a crowded room fill up, pull the players apart, and hear it
      // drain — which needs the state to survive the change that causes it.
      if (L.length !== n) L = ps.map(() => START)
      hist = []
      rounds = 0
    }
    build()
    for (const k of ['players', 'spacing', 'assert', 'vary', 'bandwidth', 'rate', 'root', 'scale', 'seed'] as const) {
      ctx.onParam(k, build)
    }

    // -- a voice --------------------------------------------------------------

    const pluck = (i: number, midi: number, time: number, gain: number, dur: number) => {
      const osc = ctx.audio.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = mtof(midi)
      const bp = ctx.audio.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = ps[i].f
      // A wider band is a wider listening window *and* a wider sound; the two
      // are the same number, which is what makes the overlap matrix honest.
      bp.Q.value = clamp(1 / Math.max(0.12, ps[i].oct), 0.6, 8)
      const amp = ctx.audio.createGain()
      amp.gain.setValueAtTime(0, time)
      amp.gain.linearRampToValueAtTime(gain, time + 0.012)
      amp.gain.exponentialRampToValueAtTime(0.0007, time + dur)
      const pan = ctx.audio.createStereoPanner()
      pan.pan.value = ps.length > 1 ? -0.5 + (i / (ps.length - 1)) * 1.0 : 0
      osc.connect(bp).connect(amp).connect(pan).connect(bus)
      osc.start(time)
      disposeAt(osc, time + dur + 0.05, [bp, amp, pan])
    }

    // -- the room -------------------------------------------------------------

    let stepN = 0
    ctx.clock.onStep((e) => {
      const n = ps.length
      // A sawtooth through a bandpass at Q~2 loses most of its energy outside
      // the passband, so this is well above what the peak ends up being.
      const base = 0.64 + ctx.params.level * 1.12
      for (let i = 0; i < n; i++) {
        if (!patterns[i][stepN % 16]) continue
        // dB above the ceiling is not available; the ceiling is the loudest a
        // player can physically be, which is what makes a runaway audible as
        // everyone pinned rather than as an explosion.
        const g = base * Math.pow(10, (L[i] - CEIL) / 20)
        if (g < 1e-4) continue
        pluck(i, pitches[i], e.time, g, 0.32 + (i % 3) * 0.12)
      }
      stepN++
      // one round per bar
      if (stepN % 8 === 0) {
        const you = Math.round(ctx.params.you) - 1
        L = round(L, ps, w, ctx.params.rate, FLOOR, CEIL,
                  you >= 0 && you < n ? you : null, ctx.params.yours)
        hist.push(L.slice())
        if (hist.length > 220) hist.shift()
        rounds++
      }
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          stepN = 0
          L = ps.map(() => START)
          hist = []
          rounds = 0
        }
      }),
    )
    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    // -- drawing ---------------------------------------------------------------

    ctx.canvas((g, { w: cw, h }) => {
      g.clearRect(0, 0, cw, h)
      const n = ps.length
      const padL = 40
      const padR = 96
      const top = 14
      const plotW = cw - padL - padR
      const plotH = Math.max(50, h - top - 34)
      const y = (db: number) => top + plotH - ((clamp(db, FLOOR, CEIL) - FLOOR) / (CEIL - FLOOR)) * plotH

      // the ceiling, which is where a runaway ends up
      g.strokeStyle = 'rgba(248,113,113,0.35)'
      g.setLineDash([4, 4])
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(padL, y(CEIL))
      g.lineTo(padL + plotW, y(CEIL))
      g.stroke()
      g.setLineDash([])

      g.font = '9px ui-monospace, monospace'
      g.textAlign = 'right'
      g.fillStyle = 'rgba(255,255,255,0.3)'
      for (const db of [0, -15, -30, -45]) g.fillText(`${db}`, padL - 5, y(db) + 3)
      g.textAlign = 'left'

      // level traces
      const H = Math.max(2, hist.length)
      const x = (k: number) => padL + (k / Math.max(1, H - 1)) * plotW
      for (let i = 0; i < n; i++) {
        g.strokeStyle = COLOURS[i % COLOURS.length] + '0.9)'
        g.lineWidth = 1.7
        g.beginPath()
        hist.forEach((row, k) => (k === 0 ? g.moveTo(x(k), y(row[i])) : g.lineTo(x(k), y(row[i]))))
        g.stroke()
      }

      // who is who
      g.font = '9px ui-monospace, monospace'
      const you = Math.round(ctx.params.you) - 1
      for (let i = 0; i < n; i++) {
        const yy = top + 10 + i * 12
        g.fillStyle = COLOURS[i % COLOURS.length] + '0.9)'
        g.fillRect(cw - padR + 4, yy - 6, 6, 6)
        g.fillStyle = 'rgba(255,255,255,0.62)'
        g.fillText(
          `${noteName(pitches[i])} ${ps[i].target >= 0 ? '+' : ''}${ps[i].target.toFixed(1)}` +
            (i === you ? ' you' : ''),
          cw - padR + 14,
          yy,
        )
      }

      // measured growth over the last stretch, against the prediction
      let measured = NaN
      if (hist.length > 24) {
        const a = hist[hist.length - 24]
        const b = hist[hist.length - 1]
        measured = (Math.max(...b) - Math.max(...a)) / 24
      }
      const pinned = L.filter((v) => v >= CEIL - 0.01).length

      g.font = '11px ui-monospace, monospace'
      g.fillStyle = predicted > 0.02 ? 'rgba(248,113,113,0.95)' : 'rgba(255,255,255,0.82)'
      g.fillText(
        predicted > 0.02
          ? `running away at ${predicted.toFixed(2)} dB per bar` +
            (pinned ? `  ·  ${pinned}/${n} pinned at the ceiling` : '')
          : `settles  ·  ${predicted.toFixed(2)} dB per bar`,
        padL,
        h - 17,
      )
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.4)'
      g.fillText(
        `cycle mean alone would say ${predictedPlain.toFixed(2)}; hearing several at once adds ` +
          `${(predicted - predictedPlain).toFixed(2)}` +
          (Number.isFinite(measured) ? `  ·  measured ${measured.toFixed(2)}` : '') +
          `  ·  ${rounds} bars`,
        padL,
        h - 4,
      )
    })

    // -- a way in for the harness ------------------------------------------------

    const wnd = window as unknown as Record<string, unknown>
    wnd.__lombard = () => ({
      players: ps.map((p) => ({ ...p })),
      w: w.map((row) => row.slice()),
      levels: L.slice(),
      history: hist.map((r) => r.slice()),
      rounds,
      predicted,
      predictedPlain,
      pitches: pitches.slice(),
      heardBy: (i: number) => heard(L, w, i),
      tap: () => bus,
      set: (k: string, v: number | string) => ctx.set(k as never, v as never),
    })
    ctx.cleanup(() => delete wnd.__lombard)

    ctx.status('press space — leave the assertiveness alone and pull Spacing up; crowding is what causes it')
  },
})
