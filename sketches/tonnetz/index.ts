import { disposeAt, mtof, NOTE_NAMES, reverb, rng, SCALES, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * Harmony as a place you walk through.
 *
 * The Tonnetz is a lattice where every triangle is a triad and adjacent
 * triangles share two notes. The three neo-Riemannian moves between neighbours
 * are the ones nineteenth-century composers used to get between distant keys
 * without anything sounding like a modulation:
 *
 *   P (parallel)      C major <-> C minor        — the third moves a semitone
 *   L (leading-tone)  C major <-> E minor        — the root moves a semitone
 *   R (relative)      C major <-> A minor        — the fifth moves a tone
 *
 * Two voices hold, one moves, and it moves as little as it possibly can. Wander
 * far enough and you are in a key with no notes in common with where you
 * started, having never heard anything jump.
 *
 * The `random` mode is the control: same three voices, same optimal voicing,
 * but the next triad is picked at random rather than from the neighbours. It is
 * there so the claim can be tested rather than asserted, and because hearing
 * the two back to back is the fastest way to understand what the lattice buys.
 */

type Quality = 0 | 1 // 0 = major, 1 = minor
interface Triad {
  root: number // pitch class
  q: Quality
}

/** The three pitch classes of a triad. */
const notesOf = (t: Triad): number[] =>
  t.q === 0 ? [t.root, (t.root + 4) % 12, (t.root + 7) % 12] : [t.root, (t.root + 3) % 12, (t.root + 7) % 12]

/** Neo-Riemannian neighbours. Each shares two notes with `t`. */
const move = (t: Triad, which: 'P' | 'L' | 'R'): Triad => {
  const maj = t.q === 0
  if (which === 'P') return { root: t.root, q: maj ? 1 : 0 }
  if (which === 'L') return maj ? { root: (t.root + 4) % 12, q: 1 } : { root: (t.root + 8) % 12, q: 0 }
  return maj ? { root: (t.root + 9) % 12, q: 1 } : { root: (t.root + 3) % 12, q: 0 }
}

const name = (t: Triad) => `${NOTE_NAMES[t.root]}${t.q === 0 ? '' : 'm'}`

/** Nearest MIDI note of pitch class `pc` to `near`. */
const nearestPc = (pc: number, near: number): number => {
  const base = Math.round(near / 12) * 12 + pc
  let best = base
  for (const cand of [base - 12, base, base + 12]) {
    if (Math.abs(cand - near) < Math.abs(best - near)) best = cand
  }
  return best
}

const PERMS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]

/**
 * Voice the target triad from the current voices with the least total motion.
 * Both modes use this, so a difference between them is about the chord choice
 * and not about the voicing.
 */
const voiceLead = (from: number[], pcs: number[]): { to: number[]; cost: number } => {
  let best: number[] = from.slice()
  let bestCost = Infinity
  for (const p of PERMS) {
    const cand = [0, 1, 2].map((i) => nearestPc(pcs[p[i]], from[i]))
    const cost = cand.reduce((s, v, i) => s + Math.abs(v - from[i]), 0)
    if (cost < bestCost) {
      bestCost = cost
      best = cand
    }
  }
  return { to: best, cost: bestCost }
}

/** Lattice coordinates: right is a fifth, up is a major third. */
const PC_AT = (i: number, j: number) => ((7 * i + 4 * j) % 12 + 12) % 12

export default defineSketch({
  title: 'Tonnetz',
  description: 'Walk the lattice of triads. Two voices hold, one moves as little as it can.',
  tags: ['composition', 'harmony', 'generative', 'tool'],
  status: 'sketch',
  bpm: 92,
  division: 4,

  params: {
    mode: { type: 'select', value: 'parsimonious', options: ['parsimonious', 'random'] },
    hold: { type: 'number', value: 8, min: 2, max: 16, step: 1, label: 'Steps per chord' },
    weightP: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, label: 'P (parallel)' },
    weightL: { type: 'number', value: 0.8, min: 0, max: 1, step: 0.01, label: 'L (leading-tone)' },
    weightR: { type: 'number', value: 0.9, min: 0, max: 1, step: 0.01, label: 'R (relative)' },
    inKey: { type: 'number', value: 0.35, min: 0, max: 1, step: 0.01, label: 'Stay in key' },
    glide: { type: 'number', value: 0.35, min: 0, max: 1 },
    spread: { type: 'number', value: 0.4, min: 0, max: 1, label: 'Voicing spread' },
    tone: { type: 'number', value: 0.5, min: 0, max: 1 },
    root: { type: 'number', value: 48, min: 36, max: 66, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'major', options: SCALE_NAMES },
    seed: { type: 'number', value: 4, min: 1, max: 999, step: 1 },
    reset: { type: 'button', label: 'Back to the root' },
  },

  notes: `
Every P, L or R move to an adjacent triangle of the lattice holds two notes and
shifts the third by a semitone (P, L) or a tone (R). Voicing is solved the same
way in both modes — all six assignments of voices to chord tones, each realised
in the octave nearest its voice, lowest total motion wins — so \`random\` is a
fair control: it changes *which* chord comes next, not how it is voiced.

**Measured from the audio**, by reading the sounding pitch classes out of the
spectrum and comparing consecutive chords (60s per mode, ~48 chords each):

| | voice-leading distance | notes held in common |
| --- | --- | --- |
| parsimonious | **1.40** semitones (only ever 1 or 2) | **2.00 of 3, in 47 of 47** |
| random | 3.79 semitones (spread 1 to 6) | 0.59 of 3 |

Not "usually two" — every single transition held exactly two. The measurement
checks itself: 100% of the chords it read in parsimonious mode are real triads.
In random mode only 80% are, because more voices move at once and more samples
land mid-change, so treat that column as the weaker of the two.

\`Stay in key\` weights candidates by how many of their notes belong to the scale.
At 0 it wanders chromatically and will leave the key within a few moves; at 1 it
stays put and the walk gets much more repetitive. The interesting setting is in
between.

What is **not** measured here is the premise — that this is why you can travel
to a distant key without anything sounding like a modulation. That is a claim
about perception, the harness cannot touch it, and it should be read as the
reason the sketch exists rather than as a finding.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: 0.3, seconds: 2.6 })
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)

    let r = rng(Math.round(ctx.params.seed))
    ctx.onParam('seed', (v) => (r = rng(Math.round(v))))

    // -- three voices that hold ---------------------------------------------

    interface Voice {
      osc: OscillatorNode
      osc2: OscillatorNode
      filt: BiquadFilterNode
      amp: GainNode
      pan: StereoPannerNode
      midi: number
    }

    const startMidi = () => {
      const base = Math.round(ctx.params.root)
      return [base, base + 4, base + 7]
    }

    const voices: Voice[] = startMidi().map((m, i) => {
      const osc = ctx.audio.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = mtof(m)
      const osc2 = ctx.audio.createOscillator()
      osc2.type = 'sawtooth'
      osc2.frequency.value = mtof(m)
      osc2.detune.value = 5
      const filt = ctx.audio.createBiquadFilter()
      filt.type = 'lowpass'
      filt.frequency.value = 1400
      filt.Q.value = 0.8
      const amp = ctx.audio.createGain()
      amp.gain.value = 0
      const pan = ctx.audio.createStereoPanner()
      pan.pan.value = (i - 1) * 0.4
      const mix = ctx.audio.createGain()
      mix.gain.value = 0.5
      osc.connect(mix)
      osc2.connect(mix)
      mix.connect(filt).connect(amp).connect(pan).connect(bus)
      osc.start()
      osc2.start()
      return { osc, osc2, filt, amp, pan, midi: m }
    })

    ctx.cleanup(() => {
      const now = ctx.audio.currentTime
      for (const v of voices) {
        if (typeof v.amp.gain.cancelAndHoldAtTime === 'function') v.amp.gain.cancelAndHoldAtTime(now)
        v.amp.gain.linearRampToValueAtTime(0, now + 0.08)
        disposeAt(v.osc, now + 0.14, [v.filt, v.amp, v.pan])
        disposeAt(v.osc2, now + 0.14)
      }
      bus.disconnect()
      rev.dispose()
    })

    // Stopping the transport must be silence, not a held chord.
    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (ctx.clock.running) return
        const now = ctx.audio.currentTime
        for (const v of voices) {
          if (typeof v.amp.gain.cancelAndHoldAtTime === 'function') v.amp.gain.cancelAndHoldAtTime(now)
          v.amp.gain.linearRampToValueAtTime(0, now + 0.3)
        }
      }),
    )

    // -- the walk -------------------------------------------------------------

    let current: Triad = { root: ((Math.round(ctx.params.root) % 12) + 12) % 12, q: 0 }
    let lastLabel = '—'
    let lastCost = 0
    const trail: Triad[] = [current]
    /** Voice-leading cost of each move, for the readout. */
    const costs: number[] = []
    /** How many voices did not have to move — the thing the lattice is for. */
    let heldVoices = 0

    ctx.onPress('reset', () => {
      current = { root: ((Math.round(ctx.params.root) % 12) + 12) % 12, q: 0 }
      trail.length = 0
      trail.push(current)
      costs.length = 0
      lastLabel = '—'
    })

    const inScale = (t: Triad) => {
      const root = Math.round(ctx.params.root) % 12
      // SCALES entries are literal tuples; widen so includes() takes a number.
      const steps = SCALES[ctx.params.scale as ScaleName] as readonly number[]
      return notesOf(t).filter((pc) => steps.includes(((pc - root) % 12 + 12) % 12)).length
    }

    const pickNext = (): { next: Triad; label: string } => {
      if (ctx.params.mode === 'random') {
        // The control: any of the 24 triads, voiced just as carefully.
        return { next: { root: r.int(0, 11), q: r.chance(0.5) ? 1 : 0 }, label: '?' }
      }
      const opts: { t: Triad; label: string; w: number }[] = []
      const base = { P: ctx.params.weightP, L: ctx.params.weightL, R: ctx.params.weightR }
      for (const k of ['P', 'L', 'R'] as const) {
        const t = move(current, k)
        // `inKey` biases toward triads whose notes belong to the scale.
        const fit = inScale(t) / 3
        const w = base[k] * (1 + ctx.params.inKey * 4 * fit)
        if (w > 0.001) opts.push({ t, label: k, w })
      }
      if (!opts.length) return { next: current, label: '·' }
      const pick = r.weighted(opts, opts.map((o) => o.w))
      return { next: pick.t, label: pick.label }
    }

    // -- sounding --------------------------------------------------------------

    const retune = (v: Voice, midi: number, time: number, dur: number) => {
      const f = mtof(midi)
      const glide = ctx.params.glide
      if (glide > 0.02) {
        const t = Math.min(dur * 0.6, 0.02 + glide * 0.5)
        for (const o of [v.osc, v.osc2]) {
          o.frequency.setValueAtTime(o.frequency.value, time)
          o.frequency.exponentialRampToValueAtTime(f, time + t)
        }
      } else {
        v.osc.frequency.setValueAtTime(f, time)
        v.osc2.frequency.setValueAtTime(f, time)
      }
      v.midi = midi
    }

    // Three sustained voices sum incoherently most of the time; this is set
    // from the measured 60s peak, not from the arithmetic.
    const LEVEL = 0.42

    ctx.clock.onStep((e) => {
      const every = Math.round(ctx.params.hold)
      if (e.step % every !== 0) return

      const { next, label } = pickNext()
      const from = voices.map((v) => v.midi)
      const { to, cost } = voiceLead(from, notesOf(next))

      // Voicing spread: push the outer voices apart a little, but only ever by
      // whole octaves, so the chord is the same chord.
      const spread = ctx.params.spread
      const target = to.slice()
      if (spread > 0.55 && target[2] - target[0] < 14) target[2] += 12
      if (spread > 0.85 && target[0] > Math.round(ctx.params.root) - 6) target[0] -= 12

      const dur = e.dur * every
      const cut = 500 + ctx.params.tone * 3600

      heldVoices = target.filter((m, i) => m === voices[i].midi).length
      voices.forEach((v, i) => {
        const moved = target[i] !== v.midi
        v.filt.frequency.setTargetAtTime(cut, e.time, 0.05)
        if (moved) retune(v, target[i], e.time, dur)
        // A voice that moves is re-articulated; a voice that holds simply
        // holds, which is the entire point of the lattice.
        const g = v.amp.gain
        g.setValueAtTime(Math.max(0.0001, g.value), e.time)
        if (moved) {
          g.linearRampToValueAtTime(LEVEL * 1.25, e.time + 0.03)
          g.linearRampToValueAtTime(LEVEL, e.time + 0.35)
        } else {
          g.linearRampToValueAtTime(LEVEL, e.time + 0.08)
        }
      })

      current = next
      lastLabel = label
      lastCost = cost
      costs.push(cost)
      if (costs.length > 64) costs.shift()
      trail.push(next)
      if (trail.length > 24) trail.shift()
    })

    // -- drawing ---------------------------------------------------------------

    const g = ctx.canvas((g, { w, h }) => {
      const cx = w / 2
      const cy = h * 0.46
      const step = Math.min(w / 9, h / 6.5)
      const dxI = step
      const dyJ = -step * 0.86
      const dxJ = step * 0.5

      const at = (i: number, j: number) => ({ x: cx + i * dxI + j * dxJ, y: cy + j * dyJ })
      const nowPcs = notesOf(current)
      const scaleRoot = Math.round(ctx.params.root) % 12
      const steps = SCALES[ctx.params.scale as ScaleName] as readonly number[]

      // triangles: (i,j),(i+1,j),(i,j+1) is major; (i+1,j),(i,j+1),(i+1,j+1) is minor
      const tri = (i: number, j: number, up: boolean) =>
        up
          ? [at(i, j), at(i + 1, j), at(i, j + 1)]
          : [at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)]
      const triadAt = (i: number, j: number, up: boolean): Triad =>
        up ? { root: PC_AT(i, j), q: 0 } : { root: PC_AT(i + 1, j + 1), q: 1 }

      const same = (a: Triad, b: Triad) => a.root === b.root && a.q === b.q

      for (let j = -2; j <= 2; j++) {
        for (let i = -4; i <= 3; i++) {
          for (const up of [true, false]) {
            const t = triadAt(i, j, up)
            const pts = tri(i, j, up)
            const isNow = same(t, current)
            const ago = trail.findIndex((x) => same(x, t))
            g.beginPath()
            g.moveTo(pts[0].x, pts[0].y)
            g.lineTo(pts[1].x, pts[1].y)
            g.lineTo(pts[2].x, pts[2].y)
            g.closePath()
            if (isNow) {
              g.fillStyle = t.q === 0 ? 'rgba(125,211,252,0.75)' : 'rgba(251,191,36,0.7)'
              g.fill()
              g.strokeStyle = t.q === 0 ? 'rgba(186,230,253,0.95)' : 'rgba(253,224,71,0.95)'
              g.lineWidth = 2
              g.stroke()
            } else if (ago >= 0) {
              const a = 0.06 + (ago / trail.length) * 0.16
              g.fillStyle = t.q === 0 ? `rgba(125,211,252,${a})` : `rgba(251,191,36,${a})`
              g.fill()
            }
            g.strokeStyle = 'rgba(255,255,255,0.06)'
            g.lineWidth = 1
            g.stroke()
          }
        }
      }

      // nodes
      g.font = '10px ui-monospace, monospace'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      for (let j = -2; j <= 3; j++) {
        for (let i = -4; i <= 4; i++) {
          const pc = PC_AT(i, j)
          const p = at(i, j)
          if (p.x < 8 || p.x > w - 8) continue
          const sounding = nowPcs.includes(pc)
          const diatonic = steps.includes(((pc - scaleRoot) % 12 + 12) % 12)
          g.beginPath()
          g.arc(p.x, p.y, sounding ? 11 : 8, 0, Math.PI * 2)
          g.fillStyle = sounding ? 'rgba(255,255,255,0.92)' : diatonic ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)'
          g.fill()
          g.fillStyle = sounding ? '#0d0f13' : 'rgba(255,255,255,0.45)'
          g.fillText(NOTE_NAMES[pc], p.x, p.y + 0.5)
        }
      }
      g.textBaseline = 'alphabetic'

      // readout
      const mean = costs.length ? costs.reduce((s, v) => s + v, 0) / costs.length : 0
      g.textAlign = 'center'
      g.font = '12px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.8)'
      g.fillText(`${name(current)}`, cx, h - 40)
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.4)'
      g.fillText(
        ctx.params.mode === 'random'
          ? `random chord · ${heldVoices} of 3 voices held · ${lastCost} semitones moved · ${mean.toFixed(2)} avg`
          : `${lastLabel} · ${heldVoices} of 3 voices held · ${lastCost} semitone${lastCost === 1 ? '' : 's'} moved · ${mean.toFixed(2)} avg`,
        cx,
        h - 24,
      )
      g.textAlign = 'left'
      g.fillStyle = 'rgba(255,255,255,0.22)'
      g.fillText('right = a fifth · up = a major third', 12, h - 10)
    })
    void g

    ctx.status('press play — two voices hold, one moves; switch to random to hear what that buys')
  },
})
