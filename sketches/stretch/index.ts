import { clamp, degree, disposeAt, mtof, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import { beatRate, octaveCents, partial, partialDecay, strikeComb, type OctaveType } from './stiff'

/**
 * A stiff string, and why a piano has several different right answers for the
 * same octave.
 *
 * Every string in this repo — `aeolian-harp`, `bow`, `wolf` — is ideal: its
 * partials are exact multiples of the fundamental, because an ideal string
 * restores only through tension. A real wire also resists *bending*, which
 * stiffens the short wavelengths, so partial `n` sits at `n·f₀·√(1 + B·n²)`.
 * The partials are **stretched**, further the higher you go.
 *
 * Tuning an octave means making a partial of the lower note beat-free against a
 * partial of the upper one. Which pair you pick is a decision, and once the
 * partials are stretched the decisions **disagree**. Null the 2:1 and the 4:2
 * still beats; null the 4:2 and the 2:1 beats instead. Both are right. A tuner
 * picks, and that is why no two pianos are tuned the same.
 *
 * Numbers in `notes` are measured; see `research/log/2026-10-01-stretch.md`.
 */

const TYPES: Record<string, OctaveType | 0> = {
  'equal (1200 exactly)': 0,
  '2:1': 1,
  '4:2': 2,
  '6:3': 3,
  '8:4': 4,
}
const TYPE_NAMES = Object.keys(TYPES)

export default defineSketch({
  title: 'Stretch',
  description: 'A stiff string: the partials are stretched, so the same octave has several right answers.',
  tags: ['dsp', 'physical', 'tuning'],
  status: 'promising',
  bpm: 60,
  division: 4,

  params: {
    /** Inharmonicity coefficient. A real piano runs 1e-4 in the bass to 3e-3 up top. */
    stiffness: { type: 'number', value: 0.001, min: 0, max: 0.012, step: 0.0001, label: 'Stiffness B' },
    /**
     * Which partial pair the octave is tuned to make beat-free. They disagree,
     * and the one you are not listening to is the one that beats.
     */
    octave: { type: 'select', value: '4:2', options: TYPE_NAMES, label: 'Octave tuned for' },
    /** Where the hammer lands. At m/n partial n is exactly absent. */
    strike: { type: 'number', value: 0.125, min: 0.02, max: 0.5, step: 0.005, label: 'Strike point' },
    partials: { type: 'number', value: 16, min: 4, max: 24, step: 1, label: 'Partials' },
    /** Play the octave pair, or just the lower string. The beats need both. */
    pair: { type: 'toggle', value: true, label: 'Play the octave' },
    root: { type: 'number', value: 45, min: 33, max: 57, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'pentatonicMajor', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    decay: { type: 'number', value: 2.6, min: 0.4, max: 6, step: 0.1, label: 'Decay' },
    space: { type: 'number', value: 0.26, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 9, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
Every string here is ideal — its partials are exact multiples, because an ideal
string restores only through tension. A real wire also resists **bending**,
which stiffens short wavelengths, so partial n sits at \`n·f₀·√(1 + B·n²)\`.

**How far out they get.** Cents above where an ideal string would put them:

| B | n=2 | n=4 | n=8 | n=16 | n=24 |
| --- | --- | --- | --- | --- | --- |
| 0.0001 | 0.35 | 1.38 | 5.52 | 21.88 | 48.48 |
| 0.0010 | 3.46 | 13.74 | 53.70 | 197.30 | 393.76 |
| 0.0080 | 27.27 | 104.26 | 357.87 | 964.72 | 1492.49 |

At B = 0.001 the sixteenth partial is **197 cents sharp** of its harmonic — two
whole semitones.

**And so the octave has several right answers.** Tuning an octave means nulling
the beat between partial 2k of the lower note and partial k of the upper. With
both strings at the same B:

| B | 2:1 | 4:2 | 6:3 | 8:4 | worst disagreement |
| --- | --- | --- | --- | --- | --- |
| 0 | 1200.00 | 1200.00 | 1200.00 | 1200.00 | **0.00** |
| 0.0002 | 1200.52 | 1202.07 | 1204.65 | 1208.24 | 7.72 |
| 0.0010 | 1202.59 | 1210.28 | 1222.86 | 1239.96 | **37.37** |
| 0.0040 | 1210.28 | 1239.96 | 1285.84 | 1343.60 | 133.32 |

At B = 0 every type agrees exactly — the disagreement *is* the stiffness.

**There is a closed form**, and it says more than the table does. For equal B,
\`width = 1200·log₂(2·√(4 − 3/(1 + B·k²)))\`, matching \`octaveCents\` to 1.1e−12
cents over 1600 cells. Three things fall out of it: every type is always
**wide**, never narrow, for any B > 0; the order 2:1 < 4:2 < 6:3 < 8:4 is a
theorem rather than an accident of the rows above; and the width tops out at
**exactly 2400 cents**, so the widest conceivable beat-free "octave" approaches
*two* octaves however stiff the wire. At B = 0.001 the k = 16 pair already
wants 1613 cents.

**In beats you could count**, A2 to A3 at B = 0.001:

| octave width | beat at 2:1 | beat at 4:2 |
| --- | --- | --- |
| 1200.00 | 0.330 Hz | 2.627 Hz |
| 1202.59 | **0.000** | 1.967 Hz |
| 1210.28 | 0.982 Hz | **0.000** |

You can null one or the other and not both, and the equal-tempered octave nulls
neither. \`Octave tuned for\` is that choice, and whichever you pick you can hear
the other one beating.

**Heard, not asserted.** One note struck alone at 185 Hz, B = 0.002, the beat
read off a narrowband envelope of the mix — predicted → measured, in Hz:

| tuned for | 2:1 | 4:2 |
| --- | --- | --- |
| equal | 1.107 → **1.100** | 8.793 → **8.790** |
| 2:1 | nulled, depth 0.065 | 6.571 → **6.570** |
| 4:2 | 3.276 → **3.280** | nulled, depth 0.039 |

Every live beat within 0.01 Hz, which is the resolution of the search; the two
tuned out have a tenth the modulation depth of the live ones. The partial
amplitudes track comb × 1/n × decay to **0.1%** across all sixteen.

**The strike point still nulls exactly.** Stiffness moves the frequencies and
leaves the mode shapes sinusoidal, so striking at m/n puts a node of partial n
under the hammer and that partial is **exactly** absent — measured 137 dB below
its neighbours at 1/8, against 10.5 dB at the deepest dip of a strike point with
no rational null. 1/8 removes partials 8, 16 and 24, which is why pianos are
strung to be struck there — and it also takes the 8:4 octave away from the
tuner.

**Where B comes from.** The tension is not free: a wire of length L and diameter
d tuned to f₀ must be at \`T = 4f₀²L²·ρπd²/4\`, and substituting that into
\`B = π³Ed⁴/(64L²T)\` leaves \`B = π²Ed²/(64ρf₀²L⁴)\` — only the speaking length,
the gauge and the pitch. On plain steel from A2 up it gives B = 1.1e−3 at A2,
dipping to 1.0e−3 at A3 and climbing to 1.9e−2 at A7, at tensions of 185–650 N,
which is where real plain-wire piano tensions sit. Chaining those five octaves
lands the top note **+10.1 cents** of equal temperament tuned 2:1 and **+40.0**
tuned 4:2: the Railsback stretch out of nothing but millimetres, with the
tuner's choice mattering four times more than the wire's.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 3.2 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)
    ctx.cleanup(() => {
      // The host fades its own bus out with a 10 ms time constant and
      // disconnects at 120 ms, precisely so that leaving mid-note does not
      // click. Cleanup runs *before* that fade, so disconnecting here cuts the
      // ringing partials instantly and clicks anyway — measured, the sound
      // stopped dead inside one render quantum where the fade would have left
      // 13% of it 20 ms later. Hand the teardown to the same timer.
      setTimeout(() => {
        bus.disconnect()
        rev.dispose()
      }, 200)
    })

    // -- the line --------------------------------------------------------------

    let notes: number[] = []
    const build = () => {
      const r = rng(Math.round(ctx.params.seed))
      const rootN = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      notes = []
      let d = 0
      for (let i = 0; i < 16; i++) {
        d = clamp(d + r.int(-2, 3), -2, 8)
        notes.push(degree(rootN, scale, d))
      }
    }
    build()
    for (const k of ['seed', 'root', 'scale'] as const) ctx.onParam(k, build)

    /** The octave width the current setting asks for, in cents. */
    const widthFor = (B: number) => {
      const k = TYPES[ctx.params.octave]
      return k === 0 ? 1200 : octaveCents(B, B, k)
    }

    // -- one struck string -----------------------------------------------------

    /** A plucked stiff string, built out of its partials. */
    const pluck = (f0: number, time: number, gain: number, pan: number) => {
      const at = Math.max(time, ctx.audio.currentTime + 0.004)
      const B = ctx.params.stiffness
      const x = ctx.params.strike
      const nmax = Math.round(ctx.params.partials)
      const base = ctx.params.decay

      const pn = ctx.audio.createStereoPanner()
      pn.pan.value = pan
      pn.connect(bus)

      // normalise against the comb and the rolloff, so the strike point and the
      // partial count are timbre knobs rather than level knobs
      let norm = 0
      for (let n = 1; n <= nmax; n++) norm += strikeComb(x, n) / n
      norm = Math.max(0.2, norm)

      // Collect, then dispose: the panner has to outlive the longest partial,
      // and `disposeAt` needs a node that was actually started — handing it a
      // bare `createOscillator()` as a timer throws, because `stop()` on an
      // unstarted source is an InvalidStateError.
      const made: { o: OscillatorNode; g: GainNode; dec: number }[] = []
      for (let n = 1; n <= nmax; n++) {
        const a = (strikeComb(x, n) / n) / norm
        if (a < 1e-4) continue
        const f = partial(f0, B, n)
        if (f > 16000) continue
        const dec = partialDecay(base, n)

        const o = ctx.audio.createOscillator()
        o.type = 'sine'
        o.frequency.value = f
        const g = ctx.audio.createGain()
        g.gain.setValueAtTime(0, at)
        // 4 ms, not 0 — a step into a sine is a broadband click, and with
        // twenty-four of them the click is the loudest thing in the note
        g.gain.linearRampToValueAtTime(gain * a, at + 0.004)
        // The floor has to be positive — an exponential ramp cannot reach zero —
        // but it also has to be *relative*. A constant floor is a different
        // number of dB down for a quiet partial than for a loud one, so the
        // quiet ones stop decaying early and ring on as a halo. With the 1e-5
        // this started as, every partial from the twelfth up measured high,
        // by up to 55%, and the crossover sat exactly where gain·a·0.0008
        // fell under the floor.
        g.gain.exponentialRampToValueAtTime(Math.max(1e-9, gain * a * 0.0008), at + dec)
        o.connect(g).connect(pn)
        o.start(at)
        made.push({ o, g, dec })
      }
      if (!made.length) {
        pn.disconnect()
        return
      }
      let last = 0
      for (let i = 1; i < made.length; i++) if (made[i].dec > made[last].dec) last = i
      made.forEach((m, i) => disposeAt(m.o, at + m.dec + 0.08, i === last ? [m.g, pn] : [m.g]))
    }

    // -- the transport ----------------------------------------------------------

    let base = -1
    let note = 0
    let width = 1200
    let beats: { k: number; hz: number }[] = []

    ctx.clock.onStep((e) => {
      if (base < 0) base = e.step
      const k = e.step - base
      if (k % 8 !== 0) return
      const i = Math.floor(k / 8) % notes.length
      note = notes[i]

      const B = ctx.params.stiffness
      width = widthFor(B)
      const f0 = mtof(note)
      const f1 = f0 * Math.pow(2, width / 1200)
      beats = [1, 2, 3, 4].map((kk) => ({ k: kk, hz: beatRate(f0, B, f1, B, kk) }))

      // Twenty-four partials per string and two strings is a lot of sine, but
      // `pluck` normalises the comb so the partials always sum to one — what
      // actually moves the peak is how well they line up in phase, and that is
      // a weak function of the count. Measured at the same gain, the peak runs
      // 0.398 at four partials, 0.306 at sixteen and 0.290 at twenty-four: a
      // 1.37× spread across the whole range, so the sqrt(12/n) this started
      // with was overcorrecting at the top. A gentle taper below sixteen is
      // enough to keep the thinnest setting from being the loudest one.
      const nmax = Math.round(ctx.params.partials)
      const lvl = (0.24 + ctx.params.level * 1.3) * Math.pow(Math.min(16, nmax) / 16, 0.25)
      pluck(f0, e.time, lvl, -0.3)
      if (ctx.params.pair) pluck(f1, e.time, lvl * 0.85, 0.3)
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) base = -1
      }),
    )

    // -- drawing ---------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 10
      const B = ctx.params.stiffness
      const nmax = Math.round(ctx.params.partials)
      const x0 = ctx.params.strike
      const f0 = mtof(note || Math.round(ctx.params.root))
      const f1 = f0 * Math.pow(2, widthFor(B) / 1200)

      const lo = Math.log2(f0 * 0.9)
      const hi = Math.log2(Math.min(16000, partial(f1, B, nmax)) * 1.05)
      const X = (f: number) => pad + ((Math.log2(f) - lo) / (hi - lo)) * (w - pad * 2)
      const plotH = h - pad * 2 - 40
      const y0 = pad + 14

      g.font = '10px ui-monospace, monospace'
      g.fillStyle = '#64748b'
      g.fillText('partials of the two strings — bar height is what the hammer leaves', pad, y0 - 4)

      // where an ideal string would have put them, for reference
      for (let n = 1; n <= nmax; n++) {
        const f = n * f0
        if (f > 16000) continue
        g.strokeStyle = '#1e293b'
        g.beginPath()
        g.moveTo(X(f), y0)
        g.lineTo(X(f), y0 + plotH)
        g.stroke()
      }

      const bars = (f: number, B2: number, colour: string, top: number, hgt: number) => {
        for (let n = 1; n <= nmax; n++) {
          const amp = strikeComb(x0, n) / n
          const fr = partial(f, B2, n)
          if (fr > 16000) continue
          const bh = Math.max(1, hgt * Math.min(1, amp * 3))
          g.fillStyle = amp < 1e-4 ? '#334155' : colour
          g.fillRect(X(fr) - 1.5, top + hgt - bh, 3, bh)
        }
      }
      bars(f0, B, '#7dd3fc', y0, plotH * 0.46)
      if (ctx.params.pair) bars(f1, B, '#fbbf24', y0 + plotH * 0.54, plotH * 0.46)

      // the pair the tuning is listening to
      const k = TYPES[ctx.params.octave]
      if (k !== 0 && ctx.params.pair) {
        const a = partial(f0, B, 2 * k)
        g.strokeStyle = '#4ade80'
        g.lineWidth = 1.5
        g.beginPath()
        g.moveTo(X(a), y0)
        g.lineTo(X(a), y0 + plotH)
        g.stroke()
        g.lineWidth = 1
      }

      g.font = '11px ui-monospace, monospace'
      g.fillStyle = '#94a3b8'
      g.fillText(`octave ${width.toFixed(2)} cents`, pad, h - pad - 14)
      g.fillStyle = '#64748b'
      g.fillText(
        `beats  ${beats.map((b) => `${b.k * 2}:${b.k} ${b.hz.toFixed(2)}`).join('   ')}`,
        pad,
        h - pad,
      )
      const nulled: number[] = []
      for (let n = 1; n <= nmax; n++) if (strikeComb(x0, n) < 1e-9) nulled.push(n)
      g.fillStyle = '#475569'
      g.fillText(
        nulled.length ? `strike nulls partials ${nulled.join(', ')}` : 'strike nulls nothing',
        pad + Math.min(360, w * 0.5),
        h - pad - 14,
      )
    })

    ctx.status('the same octave, several right answers')
  },
})
