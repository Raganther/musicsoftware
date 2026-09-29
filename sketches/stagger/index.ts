import { clamp, degree, disposeAt, mtof, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import { fraenkelPartition, gaps, ownerOf, type Canon } from './beatty'

/**
 * Three voices sharing every pulse exactly once, which `hocket` proved
 * impossible.
 *
 * `hocket` (2026-09-13) established both halves of Beatty's theorem: two voices
 * at densities d and 1−d hit every step exactly once, and three or more
 * **cannot** — Uspensky, 1927. `nest` went round it with a tree of two-way
 * splits, at the cost that its voices stopped being Beatty sequences at all.
 *
 * This is the smaller way round. Uspensky's theorem is about *homogeneous*
 * sequences, `⌊n·α⌋`. Give each voice a head start — `⌊n·α + γ⌋` — and
 * three-part partitions exist. Which ones is Fraenkel's conjecture, open since
 * 1973: for three or more voices with distinct densities there should be
 * exactly one, at `2^i/(2^m − 1)`. For three voices that is 1/7, 2/7, 4/7.
 *
 * Numbers in `notes` are measured; see `research/log/2026-09-29-stagger.md`.
 */

const MAX_VOICES = 6
const COLOURS = ['#7dd3fc', '#fbbf24', '#a78bfa', '#34d399', '#f472b6', '#fb923c']

export default defineSketch({
  title: 'Stagger',
  description: 'Three voices sharing every pulse exactly once, which one theorem forbids and one head start allows.',
  tags: ['rhythm', 'sequencer', 'generative'],
  status: 'promising',
  bpm: 104,
  division: 4,

  params: {
    voices: { type: 'number', value: 3, min: 2, max: MAX_VOICES, step: 1, label: 'Voices' },
    /**
     * `head start` is the staggered partition. `flat` plays homogeneous Beatty
     * sequences at irrational densities off the seed — which is exactly what
     * Uspensky forbids for three voices, and you can hear it fail.
     */
    mode: {
      type: 'select',
      value: 'head start',
      options: ['head start', 'flat (no head start)'],
      label: 'Sequences',
    },
    /** Rotates the whole partition. Every rotation is another solution. */
    turn: { type: 'number', value: 0, min: 0, max: 62, step: 1, label: 'Rotate' },
    pulse: { type: 'toggle', value: false, label: 'Reference click' },
    root: { type: 'number', value: 47, min: 30, max: 64, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'pentatonicMinor', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    decay: { type: 'number', value: 0.36, min: 0.06, max: 1.3, step: 0.01, label: 'Decay' },
    space: { type: 'number', value: 0.24, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 5, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
\`hocket\` proved two voices can share a pulse exactly and that **three cannot**
— Uspensky, 1927. \`nest\` went round it with a tree. This is the smaller way:
Uspensky's theorem is about *homogeneous* sequences, \`⌊n·α⌋\`. Give each voice
a head start, \`⌊n·α + γ⌋\`, and three-part partitions exist.

**And the search says there is only one.** Every partition of a period into
voices with distinct densities, each a Beatty sequence with any head start, is
enumerable exactly: the densities must sum to 1, a rational-modulus sequence
repeats with the period, and the head start takes finitely many meaningful
values. Over every period from 4 to 24 and 262 three-voice density splits:

| period | 4–6 | **7** | 8–13 | **14** | 15–20 | **21** | 22–24 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| partitions | 0 | **7** | 0 | **7** | 0 | **7** | 0 |
| densities | — | 1:2:4 | — | 2:4:8 | — | 3:6:12 | — |

Only multiples of 7, always the ratio 1:2:4, and the seven are the seven
rotations of one partition. At four voices: nothing until 15, then 1:2:4:8.
That is Fraenkel's \`2^i/(2^m − 1)\`, arrived at by exhaustion rather than looked
up — and Fraenkel's conjecture, that this is all there is, is still open.

**It tiles exactly, at every voice count.** Over 200,000 pulses, 2 to 7 voices:
**0 unowned and 0 doubled**, six configurations of six.

**And the control is the theorem.** Homogeneous Beatty at *irrational*
densities — rationals fail for their own reasons, which has nothing to do with
voice count:

| voices | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- |
| best defect rate, flat | **1 in 200,000** | 0.2195 | 0.2837 | 0.4097 |
| staggered | 0 | **0** | **0** | **0** |

Two voices partition exactly — that is Rayleigh, and \`hocket\`'s result. Three
is the best of 4,000 random density sets and it never gets near zero;
\`hocket\`'s own search reached 0.2400 on the same impossibility.

**The voices are real Beatty sequences, and \`nest\`'s were not.** The
three-distance theorem gives a genuine Beatty rhythm **at most two** distinct
inter-onset gaps. Measured at five voices: \`[31] [15,16] [7,8] [3,4] [1,2]\`.
\`nest\` measured 3, 4, 7 and 8 distinct gaps because a Beatty sequence *of* a
Beatty sequence is not one. Same impossibility, two ways round it, and they are
distinguishable by ear-count.

**And off the sound, one note per pulse.** Each voice has its own pitch, so
projecting each pulse window onto each voice's frequency counts how many voices
played it — 240 pulses, decay short enough that nothing overlaps:

| voices | sequences | 0 voices | 1 voice | 2+ | defects |
| --- | --- | --- | --- | --- | --- |
| 3 | head start | 0 | **240** | 0 | **0.0%** |
| 4 | head start | 0 | **240** | 0 | **0.0%** |
| 5 | head start | 0 | **240** | 0 | **0.0%** |
| 3 | flat | 75 | 106 | 59 | 55.8% |
| 5 | flat | 96 | 99 | 45 | 58.8% |

Levels: 0.492 at the defaults, 0.770 worst over eleven settings.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 1.9 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)
    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    // -- the partition ---------------------------------------------------------

    let canon: Canon = { n: 1, owner: new Int32Array(1), dens: [1] }
    let pitches: number[] = []
    let flatDens: number[] = []
    let gapList: number[][] = []
    const cache = new Map<number, Canon>()

    const build = () => {
      const m = Math.round(ctx.params.voices)
      let c = cache.get(m)
      if (!c) {
        const p = fraenkelPartition(m)
        c = p ? ownerOf(p) : { n: 1, owner: new Int32Array(1), dens: [1] }
        cache.set(m, c)
      }
      canon = c
      gapList = Array.from({ length: m }, (_, v) => gaps(canon, v))

      // The control's densities: irrational, off the seed, summing to one.
      // No choice of them works for three voices and the seed lets you try.
      const r = rng(Math.round(ctx.params.seed))
      const raw = Array.from({ length: m }, () => r.next() + 0.05)
      const sum = raw.reduce((a, b) => a + b, 0)
      flatDens = raw.map((v) => v / sum)

      const rp = rng(Math.round(ctx.params.seed) * 7 + 1)
      const rootN = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      // Strictly ascending: a random walk can land two voices on one degree,
      // and then nothing — ear or detector — can tell them apart.
      pitches = []
      let d = 0
      for (let i = 0; i < MAX_VOICES; i++) {
        d = clamp(d + rp.int(1, 3), 0, 16)
        pitches.push(degree(rootN, scale, d))
      }
    }
    build()
    for (const k of ['voices', 'seed', 'root', 'scale'] as const) ctx.onParam(k, build)

    // -- the sound -------------------------------------------------------------

    const strike = (i: number, time: number, gain: number, m: number) => {
      const at = Math.max(time, ctx.audio.currentTime + 0.004)
      const f = mtof(pitches[i % MAX_VOICES])
      const dec = ctx.params.decay

      const pn = ctx.audio.createStereoPanner()
      pn.pan.value = m < 2 ? 0 : -0.55 + (i / (m - 1)) * 1.1
      pn.connect(bus)

      const amp = ctx.audio.createGain()
      amp.gain.setValueAtTime(0, at)
      // 7 ms, not 2 — a fast ramp on a sine is a broadband click, and there is
      // a note on every pulse here
      amp.gain.linearRampToValueAtTime(gain, at + 0.007)
      amp.gain.exponentialRampToValueAtTime(Math.max(1e-4, gain * 0.015), at + dec)
      amp.connect(pn)

      const o = ctx.audio.createOscillator()
      o.type = 'sine'
      o.frequency.value = f
      o.connect(amp)

      const o2 = ctx.audio.createOscillator()
      o2.type = 'sine'
      // Quarter-tone off every equal-tempered ratio. At exactly 2.0 this
      // partial sat on the fundamental of any voice an octave up, and the
      // harness counted it as that voice playing — 31 false doubles in 240.
      o2.frequency.value = f * Math.pow(2, 19 / 12 + 1 / 24 + i / 6)
      const g2 = ctx.audio.createGain()
      g2.gain.setValueAtTime(0, at)
      g2.gain.linearRampToValueAtTime(gain * (0.09 + (i / MAX_VOICES) * 0.3), at + 0.005)
      g2.gain.exponentialRampToValueAtTime(1e-4, at + dec * 0.4)
      o2.connect(g2).connect(pn)

      o.start(at)
      o2.start(at)
      disposeAt(o, at + dec + 0.07, [amp, pn])
      disposeAt(o2, at + dec + 0.07, [g2])
    }

    // -- the transport ----------------------------------------------------------

    let base = -1
    let step = 0
    let unowned = 0
    let doubled = 0
    let struck = 0
    const recent: number[][] = []

    ctx.clock.onStep((e) => {
      if (base < 0) base = e.step
      const m = Math.round(ctx.params.voices)
      const k = e.step - base
      step = k

      const who: number[] = []
      if (ctx.params.mode === 'head start') {
        const at = (((k + Math.round(ctx.params.turn)) % canon.n) + canon.n) % canon.n
        const v = canon.owner[at]
        if (v >= 0 && v < m) who.push(v)
      } else {
        // homogeneous Beatty at irrational densities — Uspensky's case
        for (let i = 0; i < m; i++) {
          if (Math.floor((k + 1) * flatDens[i]) > Math.floor(k * flatDens[i])) who.push(i)
        }
      }

      if (who.length === 0) unowned++
      else if (who.length > 1) doubled++
      struck++

      // One note per pulse means decay/step of them overlap. Scale by that,
      // normalised so the defaults are untouched.
      const stacked = ctx.params.decay / Math.max(1e-6, e.dur)
      const lvl = (0.44 + ctx.params.level * 0.49) * Math.sqrt(2.4 / Math.max(2.4, stacked))
      // Voices landing together are different pitches, so they sum
      // incoherently — but a pile-up should still be audible as a fault.
      const share = Math.pow(Math.max(1, who.length), -0.7)
      for (const i of who) strike(i, e.time, lvl * share, m)

      if (ctx.params.pulse) {
        const t = Math.max(e.time, ctx.audio.currentTime + 0.004)
        const o = ctx.audio.createOscillator()
        o.type = 'triangle'
        o.frequency.value = mtof(Math.round(ctx.params.root) + 36)
        const g = ctx.audio.createGain()
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(lvl * 0.07, t + 0.004)
        g.gain.exponentialRampToValueAtTime(1e-4, t + 0.05)
        o.connect(g).connect(bus)
        o.start(t)
        disposeAt(o, t + 0.11, [g])
      }

      recent.push(who)
      if (recent.length > 256) recent.shift()
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          base = -1
          unowned = 0
          doubled = 0
          struck = 0
          recent.length = 0
        }
      }),
    )

    // -- drawing ---------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 10
      const m = Math.round(ctx.params.voices)
      const gw = w - pad * 2
      const rowH = Math.max(9, Math.min(22, (h - pad * 2 - 46) / (m + 1)))
      const y0 = pad + 14
      const n = ctx.params.mode === 'head start' ? canon.n : 64
      const cw = gw / n

      g.font = '10px ui-monospace, monospace'
      g.fillStyle = '#64748b'
      g.fillText(
        ctx.params.mode === 'head start'
          ? `one period — ${canon.n} pulses, densities ${canon.dens.map((a) => `${a}/${canon.n}`).join(' ')}`
          : 'sixty-four pulses — homogeneous, no head start',
        pad,
        y0 - 4,
      )

      // who plays each pulse
      for (let t = 0; t < n; t++) {
        let owners: number[] = []
        if (ctx.params.mode === 'head start') {
          const at = (((t + Math.round(ctx.params.turn)) % canon.n) + canon.n) % canon.n
          const v = canon.owner[at]
          if (v >= 0 && v < m) owners = [v]
        } else {
          for (let i = 0; i < m; i++)
            if (Math.floor((t + 1) * flatDens[i]) > Math.floor(t * flatDens[i])) owners.push(i)
        }
        for (let i = 0; i < m; i++) {
          const y = y0 + i * rowH
          const on = owners.includes(i)
          g.fillStyle = on ? (owners.length > 1 ? '#f87171' : COLOURS[i % COLOURS.length]) : '#111827'
          g.fillRect(pad + t * cw, y, Math.max(1, cw - 0.7), rowH - 2)
        }
        // the composite: green exactly once, red doubled, dark empty
        const y = y0 + m * rowH + 4
        g.fillStyle = owners.length === 1 ? '#4ade80' : owners.length === 0 ? '#1e293b' : '#f87171'
        g.fillRect(pad + t * cw, y, Math.max(1, cw - 0.7), rowH - 2)
      }

      if (base >= 0 && ctx.clock.running) {
        const t = ctx.params.mode === 'head start' ? ((step % canon.n) + canon.n) % canon.n : step % 64
        g.fillStyle = '#fff'
        g.fillRect(pad + t * cw, y0 - 3, Math.max(1.5, cw - 0.7), rowH * (m + 1) + 10)
      }

      g.font = '11px ui-monospace, monospace'
      const bad = unowned + doubled
      g.fillStyle = bad > 0 ? '#f87171' : '#4ade80'
      g.fillText(
        struck > 0
          ? `${unowned} unowned, ${doubled} doubled in ${struck} pulses` + (bad ? ` — ${((bad / struck) * 100).toFixed(1)}%` : '')
          : 'press play',
        pad,
        h - pad,
      )
      g.fillStyle = '#64748b'
      g.fillText(
        ctx.params.mode === 'head start'
          ? `gaps ${gapList.map((v) => `[${v.join(',')}]`).join(' ')}`
          : `densities ${flatDens.map((d) => d.toFixed(3)).join(' ')}`,
        pad + Math.min(300, w * 0.42),
        h - pad,
      )
    })

    ctx.status('a head start is all it takes')
  },
})
