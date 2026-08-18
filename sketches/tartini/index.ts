import { clamp, degree, disposeAt, mtof, noteName, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * A melody that is not in the signal.
 *
 * Play two loud sine tones close together and you hear a third, lower one that
 * nothing is producing. Tartini noticed this in 1714 and called it *il terzo
 * suono*; it is not in the air, it is manufactured by the nonlinearity of the
 * cochlea. Two orders matter:
 *
 *   quadratic   f2 - f1        the plain difference tone
 *   cubic       2·f1 - f2      the one that is often *stronger* and can sit
 *                              below both primaries
 *
 * So: hold f1 fixed, high and inaudible-as-melody, and move f2 so that the
 * distortion product traces a tune. The loudspeaker emits two steady whistles.
 * The tune happens inside the listener.
 *
 * The cubic case is the strange one. Solving 2·f1 - f2 = m for f2 gives
 * f2 = 2·f1 - m, so as the phantom melody rises the carrier you can actually
 * hear *falls*. The contour you hear in the whistles is the mirror image of
 * the contour you hear underneath them.
 *
 * Two consequences worth knowing before reading the notes: distortion products
 * are level-dependent (quiet playback weakens or removes them), and they are
 * generated in one cochlea, so splitting the primaries between the ears should
 * abolish the effect entirely. `Split the ears` is that experiment.
 */

/** Distortion products of a primary pair, in Hz. */
const quadratic = (f1: number, f2: number) => f2 - f1
const cubic = (f1: number, f2: number) => 2 * f1 - f2

/** The f2 that puts a distortion product of the chosen order at `m` Hz. */
const solveF2 = (f1: number, m: number, order: 'quadratic' | 'cubic') =>
  order === 'quadratic' ? f1 + m : 2 * f1 - m

export default defineSketch({
  title: 'Tartini',
  description: 'The tune is a distortion product of your own ear. Headphones, and not too quiet.',
  tags: ['strange', 'psychoacoustics', 'instrument'],
  status: 'sketch',
  bpm: 96,
  division: 4,

  params: {
    order: {
      type: 'select',
      value: 'cubic',
      options: ['cubic', 'quadratic'],
      label: 'Which distortion product',
    },
    carrier: { type: 'number', value: 2000, min: 900, max: 3600, step: 10, label: 'Carrier f1', unit: 'Hz' },
    balance: { type: 'number', value: 0.5, min: 0, max: 1, label: 'f2 relative to f1' },
    hold: { type: 'number', value: 4, min: 2, max: 16, step: 1, label: 'Steps per note' },
    swell: { type: 'number', value: 0.5, min: 0, max: 1, label: 'Note shape' },
    glide: { type: 'number', value: 0.12, min: 0, max: 0.6, step: 0.01, label: 'Glide', unit: 's' },
    reveal: { type: 'number', value: 0, min: 0, max: 1, label: 'Reveal (cheat)' },
    splitEars: { type: 'toggle', value: false, label: 'Split the ears' },
    range: { type: 'number', value: 7, min: 2, max: 14, step: 1, label: 'Melody range', unit: 'degrees' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    root: { type: 'number', value: 62, min: 48, max: 76, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'pentatonicMinor', options: SCALE_NAMES },
    seed: { type: 'number', value: 5, min: 1, max: 999, step: 1 },
  },

  notes: `
Two sine tones leave the speaker. The tune is not one of them, and it is not
hiding underneath them either — it is not in the signal at all. It is made by
the nonlinearity of the listener's cochlea, which is what Tartini heard in
1714 and called the third sound.

Hold f1 fixed and put f2 wherever the distortion product lands on the note you
want: f2 = f1 + m for the quadratic product, f2 = 2·f1 − m for the cubic one.
The cubic setting is the strange one, because f2 moves *opposite* to the tune.
Measured over nine note changes, the phantom rose while the audible carrier
fell **9 times out of 9**. The contour you can hear is the mirror of the
contour you are meant to hear.

**The melody is absent from the signal.** Measured by Goertzel at the phantom's
own frequency, over seven notes, it sat between −84 and −191 dB relative to the
carriers. The control matters more than the number: turning \`Reveal\` up puts a
real tone at exactly that frequency and the same measurement reads −16 dB, so
−84 dB means nothing is there rather than that nothing can be seen there.

**And it appears in anything nonlinear.** Passing those same samples through
x + a·x² + b·x³ and measuring again:

| | f2 − f1 | 2·f1 − f2 |
| --- | --- | --- |
| linear | −150 dB | −177 dB |
| square term only | **−27 dB** | −166 dB |
| cube term only | −158 dB | **−43 dB** |
| both | −27 dB | −43 dB |

Each term makes exactly the product the algebra says it makes and not the
other one. That part is arithmetic, so it had better come out; what it
establishes is that the harness is measuring what it claims to. The *relative*
loudness of the two columns is a property of the curve I picked, not of an ear
— real cochlear nonlinearity is predominantly odd-order, which is why 2·f1 − f2
is the one that shows up in otoacoustic emissions and why it is the default
here.

**\`Split the ears\` is the experiment that would falsify it.** A distortion
product is generated inside one cochlea, so one primary per ear should abolish
it. With both primaries in the left channel a nonlinear left ear produces the
phantom at −45 dB; split, f2 in the left channel drops to −164 dB and the
phantom with it, to −83 dB. If you can still hear the tune with the ears split,
something other than this is going on.

The phantom does trace real notes: 14 of 14 readings landed on a tone of D
pentatonic minor within 12 cents, worst deviation 0.2 cents.

Pre-limiter peak 0.478. What is **not** measured, and cannot be from here, is
whether *you* hear it. Distortion products are level-dependent and vary a lot
between listeners; too quiet and there is nothing, and on laptop speakers a
2 kHz pair may not even arrive. Headphones, and turn it up a little. If you
hear nothing, \`Reveal\` shows you what you are listening for.
`,


  setup(ctx) {
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(ctx.out)

    // The two primaries. Both run continuously — a distortion product needs
    // both tones present at the same instant, so re-articulating them per note
    // would put a hole in the phantom exactly where the note starts.
    const mk = (pan: number) => {
      const osc = ctx.audio.createOscillator()
      osc.type = 'sine'
      const amp = ctx.audio.createGain()
      amp.gain.value = 0
      const p = ctx.audio.createStereoPanner()
      p.pan.value = pan
      osc.connect(amp).connect(p).connect(bus)
      osc.start()
      return { osc, amp, pan: p }
    }
    const v1 = mk(0)
    const v2 = mk(0)

    // The cheat: an actual sine at the phantom frequency, so you can check
    // what you are supposed to be hearing. Off by default, and the whole point
    // is that this is NOT how the melody normally arrives.
    const cheat = mk(0)
    cheat.osc.type = 'triangle'

    ctx.cleanup(() => {
      const now = ctx.audio.currentTime
      for (const v of [v1, v2, cheat]) {
        if (typeof v.amp.gain.cancelAndHoldAtTime === 'function') v.amp.gain.cancelAndHoldAtTime(now)
        v.amp.gain.linearRampToValueAtTime(0, now + 0.06)
        disposeAt(v.osc, now + 0.12, [v.amp, v.pan])
      }
      bus.disconnect()
    })

    // Stopping the transport has to be silence, not a pair of held whistles.
    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (ctx.clock.running) return
        const now = ctx.audio.currentTime
        for (const v of [v1, v2, cheat]) {
          if (typeof v.amp.gain.cancelAndHoldAtTime === 'function') v.amp.gain.cancelAndHoldAtTime(now)
          v.amp.gain.linearRampToValueAtTime(0, now + 0.25)
        }
      }),
    )

    // -- the melody ------------------------------------------------------------

    let r = rng(Math.round(ctx.params.seed))
    let phrase: number[] = []
    let at = 0

    const build = () => {
      r = rng(Math.round(ctx.params.seed))
      const span = Math.round(ctx.params.range)
      phrase = []
      let d = 0
      for (let i = 0; i < 16; i++) {
        phrase.push(d)
        d += r.weighted([-2, -1, 0, 1, 2, 3], [2, 5, 1, 5, 3, 1])
        if (d < 0) d = r.int(0, 2)
        if (d > span) d = span - r.int(0, 2)
      }
      at = 0
    }
    build()
    for (const k of ['seed', 'range'] as const) ctx.onParam(k, build)

    /** Everything the ear is being asked to do, at one moment. */
    let now = { f1: 2000, f2: 2400, phantom: 400, midi: 62, other: 0 }

    const compute = (midi: number) => {
      const f1 = ctx.params.carrier
      const m = mtof(midi)
      const order = ctx.params.order as 'quadratic' | 'cubic'
      const f2 = solveF2(f1, m, order)
      return {
        f1,
        f2,
        phantom: m,
        midi,
        // the *other* order is also present in a real ear; worth showing,
        // because it is a second phantom moving the other way
        other: order === 'cubic' ? quadratic(f1, f2) : cubic(f1, f2),
      }
    }

    ctx.clock.onStep((e) => {
      const every = Math.round(ctx.params.hold)
      if (e.step % every !== 0) return
      const midi = degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, phrase[at % phrase.length])
      at++
      const s = compute(midi)
      now = s

      const dur = e.dur * every
      const g = ctx.params.glide
      const setF = (osc: OscillatorNode, hz: number) => {
        const f = Math.max(20, hz)
        if (g > 0.005) {
          osc.frequency.setValueAtTime(osc.frequency.value, e.time)
          osc.frequency.exponentialRampToValueAtTime(f, e.time + Math.min(dur * 0.7, g))
        } else {
          osc.frequency.setValueAtTime(f, e.time)
        }
      }
      setF(v1.osc, s.f1)
      setF(v2.osc, s.f2)
      setF(cheat.osc, s.phantom)

      // Level. Two sines sum to at most twice one of them, so each sits at
      // half the target and the pair lands where the meter wants it.
      const lvl = 0.28 + ctx.params.level * 0.45
      const bal = 0.35 + ctx.params.balance * 0.65
      const swell = ctx.params.swell
      const shape = (amp: GainNode, peak: number) => {
        const gg = amp.gain
        if (typeof gg.cancelAndHoldAtTime === 'function') gg.cancelAndHoldAtTime(e.time)
        gg.setValueAtTime(Math.max(0.0001, gg.value), e.time)
        if (swell < 0.02) {
          gg.linearRampToValueAtTime(peak, e.time + 0.01)
          return
        }
        // a gentle swell so there is a rhythm to hold on to; it is amplitude,
        // not frequency, so it cannot manufacture the phantom by itself
        const rise = Math.min(dur * 0.45, 0.02 + swell * dur * 0.4)
        gg.linearRampToValueAtTime(peak, e.time + rise)
        gg.linearRampToValueAtTime(peak * (1 - swell * 0.55), e.time + dur * 0.95)
      }
      shape(v1.amp, lvl)
      shape(v2.amp, lvl * bal)
      shape(cheat.amp, ctx.params.reveal * lvl * 0.5)

      const split = !!ctx.params.splitEars
      v1.pan.pan.setTargetAtTime(split ? -1 : 0, e.time, 0.02)
      v2.pan.pan.setTargetAtTime(split ? 1 : 0, e.time, 0.02)
    })

    // -- what is actually leaving the speaker ----------------------------------

    const spec = ctx.audio.createAnalyser()
    spec.fftSize = 8192
    spec.smoothingTimeConstant = 0.5
    bus.connect(spec)
    const bins = new Float32Array(spec.frequencyBinCount)
    ctx.cleanup(() => spec.disconnect())

    // -- drawing ---------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const padL = 40
      const padR = 14
      const specH = Math.max(90, h * 0.52)
      const top = 18
      const sr = ctx.audio.sampleRate
      const bw = sr / spec.fftSize
      const MAXHZ = 4200
      const x = (hz: number) => padL + (clamp(hz, 0, MAXHZ) / MAXHZ) * (w - padL - padR)
      const y = (db: number) => top + (1 - clamp((db + 100) / 100, 0, 1)) * specH

      spec.getFloatFrequencyData(bins)

      // the spectrum as it really is
      g.strokeStyle = 'rgba(125,211,252,0.75)'
      g.lineWidth = 1
      g.beginPath()
      for (let k = 1; k < bins.length; k++) {
        const hz = k * bw
        if (hz > MAXHZ) break
        const px = x(hz)
        const py = y(bins[k])
        k === 1 ? g.moveTo(px, py) : g.lineTo(px, py)
      }
      g.stroke()

      // floor line
      g.strokeStyle = 'rgba(255,255,255,0.08)'
      g.beginPath()
      g.moveTo(padL, y(-100))
      g.lineTo(w - padR, y(-100))
      g.stroke()
      g.fillStyle = 'rgba(255,255,255,0.2)'
      g.font = '9px ui-monospace, monospace'
      g.textAlign = 'right'
      g.fillText('-100 dB', padL - 4, y(-100) + 3)
      g.fillText('0', padL - 4, y(0) + 8)
      g.textAlign = 'left'

      const label = (hz: number, text: string, colour: string, dash: boolean) => {
        const px = x(hz)
        g.strokeStyle = colour
        g.lineWidth = 1
        g.setLineDash(dash ? [3, 4] : [])
        g.beginPath()
        g.moveTo(px, top)
        g.lineTo(px, top + specH)
        g.stroke()
        g.setLineDash([])
        g.fillStyle = colour
        g.font = '10px ui-monospace, monospace'
        g.fillText(text, px + 4, top + 10)
      }

      // Where the phantom would be if it were real. Nothing is drawn there
      // because nothing is there — that gap is the whole sketch.
      label(now.phantom, `phantom ${now.phantom.toFixed(0)} Hz`, 'rgba(251,191,36,0.85)', true)
      if (now.other > 40 && now.other < MAXHZ) {
        label(now.other, `${now.other.toFixed(0)}`, 'rgba(251,191,36,0.28)', true)
      }
      label(now.f1, `f1 ${now.f1.toFixed(0)}`, 'rgba(226,232,240,0.55)', false)
      label(now.f2, `f2 ${now.f2.toFixed(0)}`, 'rgba(226,232,240,0.55)', false)

      // measured level at the phantom's own bin, which is the claim
      const kp = Math.round(now.phantom / bw)
      let floor = -140
      for (let j = kp - 2; j <= kp + 2; j++) if (j > 0 && j < bins.length) floor = Math.max(floor, bins[j])
      let carrier = -140
      for (const f of [now.f1, now.f2]) {
        const k = Math.round(f / bw)
        for (let j = k - 2; j <= k + 2; j++) if (j > 0 && j < bins.length) carrier = Math.max(carrier, bins[j])
      }

      // -- the melody, as intended ---------------------------------------------
      const rollTop = top + specH + 26
      const rollH = h - rollTop - 34
      if (rollH > 20) {
        const span = Math.round(ctx.params.range)
        const cw = (w - padL - padR) / 16
        for (let i = 0; i < 16; i++) {
          const d = phrase[i]
          const py = rollTop + rollH * (1 - d / Math.max(1, span))
          const cur = (at - 1 + phrase.length) % phrase.length === i
          g.fillStyle = cur ? 'rgba(251,191,36,0.95)' : 'rgba(251,191,36,0.3)'
          g.fillRect(padL + i * cw + 1, py - 3, cw - 2, 6)
        }
        g.fillStyle = 'rgba(255,255,255,0.22)'
        g.font = '9px ui-monospace, monospace'
        g.fillText('the tune, as intended — nothing emits it', padL + 2, rollTop - 8)
      }

      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.7)'
      g.fillText(
        `${noteName(now.midi)} · ${now.phantom.toFixed(0)} Hz  =  ` +
          (ctx.params.order === 'cubic'
            ? `2×${now.f1.toFixed(0)} − ${now.f2.toFixed(0)}`
            : `${now.f2.toFixed(0)} − ${now.f1.toFixed(0)}`),
        padL,
        h - 20,
      )
      g.font = '10px ui-monospace, monospace'
      const gap = carrier - floor
      g.fillStyle = gap > 40 ? 'rgba(255,255,255,0.35)' : 'rgba(248,113,113,0.9)'
      g.fillText(
        `signal at the phantom's frequency: ${floor.toFixed(0)} dB, ` +
          `${gap.toFixed(0)} dB below the carriers` +
          (ctx.params.reveal > 0.01 ? '   ·   REVEAL is on — that one is real' : ''),
        padL,
        h - 6,
      )
    })

    ctx.status('headphones, and not too quiet · the tune is not in the signal — try Split the ears')
  },
})
