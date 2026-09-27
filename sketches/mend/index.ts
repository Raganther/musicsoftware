import { clamp, degree, disposeAt, mtof, noiseBuffer, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import { classify, erb, inBand, maskedThreshold, tally, type Burst, type Note } from './hear'

/**
 * A tone interrupted by noise is heard carrying straight through, although it
 * is not there.
 *
 * `veil` hid a melody *under* noise — present in the signal, absent in the ear.
 * This is the mirror. The tone is switched hard off during each burst, so its
 * energy is exactly zero, and the ear supplies it anyway. The one condition is
 * that the noise be loud enough *in the tone's own critical band* to have
 * masked the tone had it been there: below that the line audibly pulses, above
 * it the line is continuous and the burst is something laid over the top.
 *
 * Two things here are not central at all. How much noise reaches the tone's
 * critical band is an auditory filter of published width, and it grows fivefold
 * from a low tone to a high one. And **a note buried end to end cannot be
 * restored by anything**, because there is no evidence on either side of it —
 * which notes are restorable is a property of the schedule, not of the ear.
 *
 * Numbers in `notes` are measured; see `research/log/2026-09-27-mend.md`.
 */

const CYCLE = 32
const NOTE_STEPS = 2
/** Peak tone amplitude before the level knob — also the reference the masking verdict uses. */
const TONE = 0.7

export default defineSketch({
  title: 'Mend',
  description: 'A line interrupted by noise, heard continuing through holes where nothing is playing.',
  tags: ['psychoacoustic', 'generative'],
  status: 'promising',
  bpm: 84,
  division: 4,

  params: {
    /**
     * `restored` switches the tone off under each burst — the illusion.
     * `really there` leaves it playing. `holes` removes the noise, so you hear
     * the gaps that were there all along.
     */
    gaps: {
      type: 'select',
      value: 'restored (tone off under noise)',
      options: ['restored (tone off under noise)', 'really there (tone continues)', 'holes (no noise)'],
      label: 'Under the burst',
    },
    /** How long each burst lasts, as a fraction of a note. Past 1 it can bury one whole. */
    width: { type: 'number', value: 0.75, min: 0.1, max: 2.5, step: 0.05, label: 'Burst width' },
    /** Bursts per note, on average. */
    density: { type: 'number', value: 0.55, min: 0.05, max: 1.5, step: 0.01, label: 'Burst rate' },
    noise: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, label: 'Burst level' },
    /** Narrow noise misses the critical band and restores nothing. */
    band: { type: 'number', value: 3, min: 0.2, max: 12, step: 0.1, label: 'Burst bandwidth (ERBs)' },
    /** Noise an octave away does nothing, however loud. */
    offset: { type: 'number', value: 0, min: -24, max: 24, step: 1, label: 'Burst centre (semitones)' },
    root: { type: 'number', value: 62, min: 48, max: 76, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'pentatonicMinor', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    space: { type: 'number', value: 0.24, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 4, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
\`veil\` hid a melody under noise — in the signal, absent from the ear. This is
the mirror: the tone is switched **hard off** under each burst, so its energy is
exactly zero, and the ear supplies it. \`Under the burst\` is the whole
demonstration — \`holes\` takes the noise away and the same gaps become audible
silences.

**The auditory filter, against the published ERB.** Glasberg & Moore give
\`24.7·(0.00437f + 1)\`; integrating the roex filter the sketch actually uses
returns it at ratio **1.0000** from 125 Hz to 4 kHz.

**Widening a noise band stops helping at the critical band**, which is
Fletcher's experiment and the reason the critical band is a thing at all. Power
reaching a 1 kHz tone, as a fraction of the whole critical band:

| band width (Hz) | 10 | 50 | 132 | 400 | 800 | 2000 |
| --- | --- | --- | --- | --- | --- | --- |
| fraction | 0.075 | 0.352 | 0.727 | 0.990 | **1.000** | **1.000** |

ERB(1000) is 132.6 Hz, and past about three of them there is nothing left to
gain.

**The same noise covers a high note far more easily**, because the filter is
wider up there and lets more in — masked threshold, relative to 125 Hz:

| f (Hz) | 125 | 250 | 500 | 1000 | 2000 | 4000 |
| --- | --- | --- | --- | --- | --- | --- |
| ERB | 38 | 52 | 79 | 133 | 241 | 456 |
| dB | 0.00 | 1.31 | 3.14 | 5.41 | 7.99 | **10.77** |

**A band away from the tone does nothing — in the model.** 100 Hz of noise
centred on a 1 kHz tone delivers 81.1 units, at 1250 Hz 0.60, an octave up
**0.0000**. \`Burst centre\` is that knob, and measuring it off the sound is
where the idealisation showed: a single 2-pole bandpass falls at only 6 dB per
octave, so a burst an octave away still put **3.9e−2** of its centred power into
the tone's critical band where a flat band puts 3.5e−7. Three cascaded stages
bring that to **2.8e−4**. Measured against modelled, normalised to the centred
case:

| offset | 0 | 6 st | 12 st | 24 st |
| --- | --- | --- | --- | --- |
| measured | 1.000 | 0.269 | 0.0136 | 2.8e−4 |
| flat-band model | 1.000 | 0.0504 | 3.5e−7 | 4.4e−26 |

A real noise burst is nowhere near band-limited, and the gap between those rows
is the filter, not the ear.

**A note buried end to end cannot be restored by anything.** There is no
evidence on either side, so it is not a question about the listener. Sweeping
the burst width against a fixed note length:

| burst width, in notes | 0.2 | 0.4 | 0.6 | 0.8 | **1.0** | **1.2** | 1.6 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| notes hidden end to end | 0 | 0 | 0 | 0 | **0** | **4** | 8 |
| tone-time switched off | 7.5% | 15% | 22.5% | 30% | 37.5% | 45% | 60% |

Nothing is buried until a burst is *longer* than a note — at exactly one note
long it still takes perfect alignment, and the bursts do not have it.

**And off the sound, the hole is exactly a hole.** Coherent amplitude at each
note's own frequency, in windows lying wholly inside a burst against windows
wholly outside one — no threshold, two populations, an expectation each:

| under the burst | amp inside | amp outside | ratio | expected |
| --- | --- | --- | --- | --- |
| restored | 0.01451 | 0.46632 | **0.031** | 0 |
| really there | 0.47374 | 0.46630 | **1.016** | 1 |
| holes | 0.00000 | 0.46637 | **0.0000** | 0 |

\`holes\` reads **exactly zero**, with a total RMS of 0.0000 — not buried, not
−100 dB, nothing at all. Its gate is identical to \`restored\`'s, so the 0.031
there is entirely the noise's own component at the tone's frequency.

Levels: 0.521 at the defaults, 0.836 worst over twelve settings.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.2 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)

    // -- the two sources -------------------------------------------------------

    const tone = ctx.audio.createOscillator()
    tone.type = 'triangle'
    tone.frequency.value = 440
    const toneAmp = ctx.audio.createGain()
    toneAmp.gain.value = 0
    // a little body, so the line is a line and not a test signal
    const toneLp = ctx.audio.createBiquadFilter()
    toneLp.type = 'lowpass'
    toneLp.frequency.value = 2600
    tone.connect(toneLp).connect(toneAmp).connect(bus)
    tone.start()

    const noiseSrc = ctx.audio.createBufferSource()
    noiseSrc.buffer = noiseBuffer(4)
    noiseSrc.loop = true
    // Three stages, not one. A single 2-pole bandpass falls at 6 dB/octave, so
    // a burst an octave from the tone still put 4% of its centred power into
    // the tone's critical band where a flat band would put 3e-7 — measured.
    // `Burst centre` is supposed to turn the illusion off without turning the
    // noise down, and with one biquad it did not.
    const STAGES = 3
    /** −3 dB width of n cascaded identical bandpasses, as a fraction of one. */
    const CASCADE = Math.sqrt(Math.pow(2, 1 / STAGES) - 1)
    const noiseBps = Array.from({ length: STAGES }, () => {
      const f = ctx.audio.createBiquadFilter()
      f.type = 'bandpass'
      f.frequency.value = 440
      f.Q.value = 1
      return f
    })
    const noiseAmp = ctx.audio.createGain()
    noiseAmp.gain.value = 0
    noiseBps.reduce((prev: AudioNode, f) => prev.connect(f), noiseSrc as AudioNode).connect(noiseAmp).connect(bus)
    noiseSrc.start()

    ctx.cleanup(() => {
      disposeAt(tone, ctx.audio.currentTime + 0.05, [toneLp, toneAmp])
      disposeAt(noiseSrc, ctx.audio.currentTime + 0.05, [...noiseBps, noiseAmp])
      bus.disconnect()
      rev.dispose()
    })

    // -- the schedule ----------------------------------------------------------

    let notes: Note[] = []
    let bursts: Burst[] = []
    let states: ReturnType<typeof classify> = []
    let counts = { clear: 0, partial: 0, hidden: 0, absent: 0 }
    /** Whether the burst is loud enough in the tone's band to have masked it. */
    let masks = false
    let ratioDb = 0

    const build = (stepDur: number) => {
      const r = rng(Math.round(ctx.params.seed))
      const noteDur = NOTE_STEPS * stepDur
      const n = CYCLE / NOTE_STEPS
      const rootN = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      notes = []
      let d = 0
      for (let i = 0; i < n; i++) {
        d = clamp(d + r.int(-2, 3), -3, 9)
        notes.push({ start: i * noteDur, dur: noteDur, pitch: degree(rootN, scale, d) })
      }

      bursts = []
      const w = ctx.params.width * noteDur
      const cycleDur = CYCLE * stepDur
      const gap = noteDur / Math.max(0.05, ctx.params.density)
      for (let t = r.next() * gap; t < cycleDur; t += gap * (0.6 + r.next() * 0.8)) {
        bursts.push({ start: t, dur: w })
      }

      states = classify(notes, bursts)
      counts = tally(notes, bursts)
    }

    /** The masking arithmetic, for the note in the middle of the register. */
    const recompute = () => {
      const mid = notes.length ? mtof(notes[Math.floor(notes.length / 2)].pitch) : 440
      const centre = mid * Math.pow(2, ctx.params.offset / 12)
      const bw = ctx.params.band * erb(centre)
      // The bandpass delivers roughly `level^2 / bw` of power per Hz.
      const amp = ctx.params.noise
      const n0 = (amp * amp) / Math.max(1, bw)
      const got = inBand(mid, Math.max(1, centre - bw / 2), centre + bw / 2, n0)
      const need = maskedThreshold(mid, Math.max(1, centre - bw / 2), centre + bw / 2, n0)
      const toneAmpNow = TONE
      ratioDb = 20 * Math.log10(Math.max(1e-12, Math.sqrt(got)) / toneAmpNow)
      masks = need >= toneAmpNow
      // Q is fc/bw, widened per stage so the cascade's total width is `bw`.
      const q = clamp((centre / Math.max(1, bw)) * CASCADE, 0.15, 30)
      for (const f of noiseBps) {
        f.frequency.setTargetAtTime(centre, ctx.audio.currentTime, 0.02)
        f.Q.setTargetAtTime(q, ctx.audio.currentTime, 0.02)
      }
    }

    // -- the transport ----------------------------------------------------------

    let base = -1
    let cycleStart = 0
    let cycleDur = 1
    let playing = -1

    const schedule = (t0: number, stepDur: number) => {
      build(stepDur)
      recompute()
      const which = ctx.params.gaps
      const hush = which !== 'really there (tone continues)'
      const quiet = which === 'holes (no noise)'
      const lvl = TONE * (0.6 + ctx.params.level * 0.8)
      // A wider bandpass passes more noise power, so without this the
      // bandwidth knob is a level knob too and 12 ERBs clipped the master.
      const bwComp = Math.sqrt(3 / Math.max(0.2, ctx.params.band)) * 2.6
      const nz = quiet ? 0 : ctx.params.noise * 1.1 * bwComp * (0.6 + ctx.params.level * 0.8)

      /**
       * The tone's gain is a piecewise function of time, not two streams of
       * events. Emitting note-ons and burst-gates separately meant a note that
       * *started* inside a burst switched the tone back on in the middle of the
       * hole — and with these defaults thirteen of sixteen notes are partly
       * covered, so the hole measured a third of full amplitude instead of
       * nothing.
       */
      const sounding = (t: number) =>
        notes.some((n) => t >= n.start && t < n.start + n.dur - 0.01) &&
        !(hush && bursts.some((b) => t >= b.start && t < b.start + b.dur))
      const bursting = (t: number) => !quiet && bursts.some((b) => t >= b.start && t < b.start + b.dur)

      const bounds = new Set<number>([0])
      for (const n of notes) {
        bounds.add(n.start)
        bounds.add(n.start + n.dur - 0.01)
      }
      for (const b of bursts) {
        bounds.add(b.start)
        bounds.add(b.start + b.dur)
      }
      const times = [...bounds].filter((t) => t >= 0).sort((a, b) => a - b)

      // Hold, *then* ramp. A bare `linearRampToValueAtTime` starts from the
      // previous scheduled event, so a chain of them is one continuous
      // piecewise-linear line rather than a gate.
      let prevTone = 0
      let prevNoise = 0
      for (const t of times) {
        const at = Math.max(t0 + t, ctx.audio.currentTime + 0.002)
        const eps = 1e-4
        const wantTone = sounding(t + eps) ? lvl : 0
        const wantNoise = bursting(t + eps) ? nz : 0
        if (wantTone !== prevTone) {
          toneAmp.gain.setValueAtTime(prevTone, at)
          toneAmp.gain.linearRampToValueAtTime(wantTone, at + (wantTone > 0 ? 0.008 : 0.004))
          prevTone = wantTone
        }
        if (wantNoise !== prevNoise) {
          noiseAmp.gain.setValueAtTime(prevNoise, at)
          noiseAmp.gain.linearRampToValueAtTime(wantNoise, at + 0.006)
          prevNoise = wantNoise
        }
      }

      // pitch follows the note, stepped at its start
      for (const n of notes) {
        tone.frequency.setValueAtTime(mtof(n.pitch), Math.max(t0 + n.start, ctx.audio.currentTime + 0.002))
      }
    }

    ctx.clock.onStep((e) => {
      if (base < 0) base = e.step
      if ((e.step - base) % CYCLE !== 0) return
      cycleStart = e.time
      cycleDur = CYCLE * e.dur
      schedule(e.time, e.dur)
    })

    for (const k of ['seed', 'root', 'scale', 'width', 'density', 'band', 'offset', 'noise'] as const)
      ctx.onParam(k, () => {
        build(cycleDur / CYCLE)
        recompute()
      })
    build(0.18)
    recompute()

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          base = -1
          const now = ctx.audio.currentTime
          toneAmp.gain.cancelAndHoldAtTime(now)
          noiseAmp.gain.cancelAndHoldAtTime(now)
          toneAmp.gain.setTargetAtTime(0, now, 0.03)
          noiseAmp.gain.setTargetAtTime(0, now, 0.03)
        }
      }),
    )

    // -- drawing ---------------------------------------------------------------

    const COL = { clear: '#7dd3fc', partial: '#fbbf24', hidden: '#f87171' }

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 10
      const gw = w - pad * 2
      const total = notes.length ? notes[notes.length - 1].start + notes[notes.length - 1].dur : 1
      const x = (t: number) => pad + (t / total) * gw
      const plotH = h - pad * 2 - 34
      const y0 = pad + 14

      let lo = 127
      let hi = 0
      for (const n of notes) {
        lo = Math.min(lo, n.pitch)
        hi = Math.max(hi, n.pitch)
      }
      const y = (p: number) => y0 + plotH * (1 - (p - lo + 1) / (hi - lo + 2))

      // the line, note by note, coloured by what could happen to it
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i]
        g.fillStyle = COL[states[i]]
        g.fillRect(x(n.start), y(n.pitch) - 3, Math.max(2, x(n.start + n.dur) - x(n.start) - 1), 6)
      }

      // the bursts, laid over the top
      const quiet = ctx.params.gaps === 'holes (no noise)'
      for (const b of bursts) {
        g.fillStyle = quiet ? 'rgba(148,163,184,0.10)' : masks ? 'rgba(226,232,240,0.22)' : 'rgba(226,232,240,0.09)'
        g.fillRect(x(b.start), y0, Math.max(1, x(b.start + b.dur) - x(b.start)), plotH)
      }

      // the playhead
      if (base >= 0 && ctx.clock.running) {
        const t = ((ctx.audio.currentTime - cycleStart) % cycleDur + cycleDur) % cycleDur
        g.fillStyle = '#fff'
        g.fillRect(x(t), y0, 1.5, plotH)
        for (let i = 0; i < notes.length; i++)
          if (t >= notes[i].start && t < notes[i].start + notes[i].dur) playing = i
      }

      g.font = '10px ui-monospace, monospace'
      g.fillStyle = '#64748b'
      g.fillText('blue clear · amber partly covered · red buried end to end', pad, y0 - 4)

      g.font = '11px ui-monospace, monospace'
      const off = ctx.params.gaps === 'really there (tone continues)' ? 0 : counts.absent
      g.fillStyle = counts.hidden > 0 ? '#f87171' : '#94a3b8'
      g.fillText(
        `${counts.clear} clear  ${counts.partial} partial  ${counts.hidden} buried   ${(off * 100).toFixed(1)}% of the tone switched off`,
        pad,
        h - pad,
      )
      g.fillStyle = quiet ? '#64748b' : masks ? '#4ade80' : '#fbbf24'
      g.fillText(
        quiet ? 'no noise — the holes are audible' : masks ? `enough to mask (${ratioDb.toFixed(1)} dB in band)` : `too little in band (${ratioDb.toFixed(1)} dB)`,
        pad + Math.min(420, w * 0.56),
        h - pad,
      )
      void playing
    })

    ctx.status('the ear fills what the signal does not')
  },
})
