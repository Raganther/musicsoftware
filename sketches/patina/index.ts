import {
  clamp,
  degree,
  disposeAt,
  envelope,
  keyboard,
  midi as midiHub,
  noiseSource,
  noteName,
  poly,
  reverb,
  rng,
  SCALE_NAMES,
  type ScaleName,
} from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * An instrument with an arrow of time.
 *
 * Every note you play wears that note out a little: it drifts out of tune,
 * dulls, softens, and starts to rattle. Rested notes recover, slowly. The
 * wear is *per pitch*, so the instrument ends up shaped by what you played on
 * it, and the wear map is a portrait of the performance.
 *
 * This inverts the usual bargain. Normally practice makes an instrument
 * yours; here overuse spends it. Hammering a tonic kills the tonic. The only
 * way to stay in good voice is to keep moving — husbandry as technique.
 *
 * Each seed is a different physical instrument: notes get seeded
 * manufacturing defects (a little initial weakness) and a seeded direction of
 * pitch drift, so one instrument goes sour differently from another.
 *
 * Temper restores it, and is the only undo. Pressing it erases the history.
 */

const LOW = 48
const RANGE = 25

export default defineSketch({
  title: 'Patina',
  description: 'An instrument that wears out where you play it. Rested notes recover; the wear map is the performance.',
  tags: ['strange', 'instrument', 'dsp', 'improvisation'],
  status: 'promising',
  bpm: 92,

  params: {
    seed: { type: 'number', value: 31, min: 1, max: 999, step: 1 },
    wear: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, label: 'Wear rate' },
    heal: { type: 'number', value: 0.35, min: 0, max: 1, step: 0.01, label: 'Recovery' },
    sour: { type: 'number', value: 0.6, min: 0, max: 1, step: 0.01, label: 'Detune with wear' },
    dull: { type: 'number', value: 0.6, min: 0, max: 1, step: 0.01, label: 'Dulling' },
    rattle: { type: 'number', value: 0.45, min: 0, max: 1, step: 0.01, label: 'Rattle' },
    auto: { type: 'toggle', value: true, label: 'Play itself' },
    density: { type: 'number', value: 0.55, min: 0.05, max: 1, step: 0.01, label: 'Density' },
    obsession: { type: 'number', value: 0.55, min: 0, max: 1, step: 0.01, label: 'Obsession' },
    root: { type: 'number', value: 50, min: 40, max: 62, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'dorian', options: SCALE_NAMES },
    temper: { type: 'button', label: 'Temper (restore)' },
  },

  notes: `
Question: what happens to playing when the instrument has an arrow of time?

Obsession is the parameter that makes the point. It biases the auto-player
toward repeating the note it just used. Turn it up and you can hear the
instrument eat itself: the tonic goes sour first, then dull, then starts
rattling, and the piece is forced off it — the melody wanders not because
anything told it to but because home stopped being playable. Turn Obsession
down and the wear spreads thin and nothing interesting happens. The
degradation is only musical when it is *uneven*.

What I did not expect: this makes a strong case for wide melodies. Playing
across the range keeps everything fresh, so the instrument rewards exactly
the writing a lot of teachers push you toward anyway. A constraint invented
to be perverse turned out to encode ordinary good advice.

Recovery around 0.3-0.4 is the sweet spot. At 0 the instrument is
consumable and a long session ends in mud. Past ~0.7 nothing wears enough to
matter and you have an ordinary synth back.

Honest failure, found by measuring rather than assuming: two of the four wear
channels were cancelling each other out. The rattle was a bandpass burst at
1.2-3.8kHz, so as a note got more worn the rattle ADDED high-frequency
energy — precisely undoing the filter's dulling. Measured on a note hammered
to ~72% wear, spectral centroid fell only 7.6% (1923 -> 1777 Hz): the note
was quieter and slower to speak but barely darker. Moving the rattle down to
240-860Hz, so a tired key clunks instead of hissing, more than doubled it to
16.4% (1928 -> 1613 Hz). Level drop across the same test is 47%
(0.653 -> 0.347).

Worth generalising: wear reaching the ear through several channels at once
does not mean those channels add up. They have to be checked against each
other, and "more degradation parameters" is not the same as "more audible
degradation".

Temper is the only undo, and pressing it deletes the instrument's memory of
what you played. It felt surprisingly bad to press.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: 0.28, seconds: 2.4 })
    const synth = poly(rev.input, {
      wave: 'sawtooth',
      gain: 2.9,
      cutoff: 2600,
      resonance: 4,
      envAmount: 1.6,
      velToFilter: 0.45,
      keytrack: 0.25,
      spread: 0.35,
      sustain: 0.4,
      release: 0.35,
      maxVoices: 8,
    })
    ctx.cleanup(() => {
      synth.allNotesOff()
      rev.dispose()
    })

    // -- the instrument's condition ----------------------------------------

    /** Per-pitch wear, 0 = fresh, 1 = ruined. Indexed by MIDI note. */
    const fatigue = new Float32Array(128)
    /** Seeded manufacturing character: initial weakness and drift direction. */
    let defect = new Float32Array(128)
    let driftDir = new Float32Array(128)
    /** Wall-clock seconds each note last sounded, for the visual flash. */
    const litAt = new Float32Array(128)

    const forge = () => {
      const r0 = rng(Math.round(ctx.params.seed))
      defect = new Float32Array(128)
      driftDir = new Float32Array(128)
      for (let m = 0; m < 128; m++) {
        // A real instrument is never uniform: a few notes are weak from new.
        defect[m] = Math.max(0, r0.gauss() * 0.06)
        driftDir[m] = r0.chance(0.5) ? 1 : -1
      }
      fatigue.fill(0)
    }
    forge()
    ctx.onPress('temper', () => {
      fatigue.fill(0)
      ctx.status('tempered — the instrument no longer remembers')
    })

    /** Total wear on a note: what it was born with plus what you did to it. */
    const condition = (m: number) => clamp(fatigue[m] + defect[m], 0, 1)

    // -- sounding a worn note ----------------------------------------------

    const strike = (m: number, time: number, dur: number, vel: number) => {
      const w = condition(m)

      // Wear reaches the ear through four channels at once. Detune alone was
      // nearly inaudible; attack softening and rattle are what sell it.
      synth.set({
        detune: 6 + w * ctx.params.sour * 55 * (driftDir[m] > 0 ? 1 : 0.45),
        cutoff: 2600 * (1 - w * ctx.params.dull * 0.88),
        attack: 0.005 + w * 0.075,
        release: 0.35 + w * 0.25,
      })
      synth.note(m, time, dur, vel * (1 - w * 0.3))

      // Rattle: a short filtered noise burst that grows with wear — the
      // mechanical complaint of a tired key.
      const amount = w * ctx.params.rattle
      if (amount > 0.02) {
        const noise = noiseSource()
        const bp = ctx.audio.createBiquadFilter()
        bp.type = 'bandpass'
        // Low-mid, deliberately: an early version put the rattle at
        // 1.2-3.8kHz, where it ADDED brightness and cancelled out the
        // filter's dulling — the two wear channels fought each other and the
        // measured spectral centroid barely moved. A tired key clunks.
        bp.frequency.value = 240 + w * 620
        bp.Q.value = 1.1
        const g = ctx.audio.createGain()
        envelope(g.gain, time, { peak: amount * 0.3, attack: 0.002, decay: 0.06 + w * 0.11 })
        noise.connect(bp).connect(g).connect(rev.input)
        noise.start(time)
        disposeAt(noise, time + 0.3, [bp, g])
      }

      fatigue[m] = clamp(fatigue[m] + ctx.params.wear * 0.055, 0, 1)
      litAt[m] = performance.now() / 1000
    }

    // -- playing ------------------------------------------------------------

    let r = rng(Math.round(ctx.params.seed) + 977)
    ctx.onParam('seed', () => {
      forge()
      r = rng(Math.round(ctx.params.seed) + 977)
    })

    let lastDeg = 0

    ctx.clock.onStep((e) => {
      // Recovery runs whether or not anything is playing — rest is the
      // mechanic that makes husbandry possible.
      const rest = ctx.params.heal * 0.0016
      if (rest > 0) {
        for (let m = LOW; m < LOW + RANGE; m++) {
          if (fatigue[m] > 0) fatigue[m] = Math.max(0, fatigue[m] - rest)
        }
      }

      if (!ctx.params.auto) return
      if (e.step % 2 !== 0) return
      if (!r.chance(ctx.params.density)) return

      // Obsession biases toward reusing the note just played, which is what
      // concentrates wear and makes the degradation audible.
      const deg = r.chance(ctx.params.obsession)
        ? lastDeg
        : clamp(lastDeg + r.pick([-4, -3, -2, -1, 1, 2, 3, 4]), -4, 12)
      lastDeg = deg

      const m = clamp(
        degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, deg),
        LOW,
        LOW + RANGE - 1,
      )
      strike(m, e.time, e.dur * r.pick([2, 3, 4, 6]), 0.55 + r.next() * 0.35)
    })

    // -- hands --------------------------------------------------------------

    const viz = document.createElement('div')
    viz.style.cssText = 'position:relative;height:calc(100% - 130px);min-height:150px;'
    const kbWrap = document.createElement('div')
    kbWrap.style.cssText = 'margin-top:12px;'
    ctx.root.append(viz, kbWrap)

    const kb = keyboard(kbWrap, {
      low: LOW,
      octaves: 2,
      onNoteOn: (m, v) => strike(m, ctx.audio.currentTime, 0.5, v),
      onNoteOff: () => {},
    })
    ctx.cleanup(() => kb.dispose())
    ctx.cleanup(
      midiHub.onNoteOn((e) =>
        strike(e.midi, ctx.audio.currentTime, 0.5, Math.max(0.25, e.velocity)),
      ),
    )

    // -- drawing ------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      const now = performance.now() / 1000
      const pad = 12
      const bw = (w - pad * 2) / RANGE
      const floor = h - 34
      const top = 26

      let worst = 0
      let worstNote = LOW
      let total = 0

      for (let i = 0; i < RANGE; i++) {
        const m = LOW + i
        const c = condition(m)
        total += c
        if (c > worst) {
          worst = c
          worstNote = m
        }

        const x = pad + i * bw
        const bh = Math.max(2, c * (floor - top))

        // Track behind each bar, so a fresh instrument still reads as a
        // chart rather than an empty screen.
        g.fillStyle = 'rgba(255,255,255,0.035)'
        g.fillRect(x + 1, top, bw - 2, floor - top)

        // Fresh reads cool, ruined reads hot. The bar IS the note's history.
        const hue = 190 - c * 185
        g.fillStyle = `hsl(${hue} ${45 + c * 40}% ${38 + c * 12}%)`
        g.fillRect(x + 1, floor - bh, bw - 2, bh)

        const age = now - litAt[m]
        if (age < 0.35) {
          g.globalAlpha = 1 - age / 0.35
          g.fillStyle = '#ffffff'
          g.fillRect(x + 1, floor - bh - 3, bw - 2, 3)
          g.globalAlpha = 1
        }

        if (i % 2 === 0) {
          g.fillStyle = 'rgba(255,255,255,0.28)'
          g.font = '8px ui-monospace, monospace'
          g.textAlign = 'center'
          g.fillText(noteName(m), x + bw / 2, h - 20)
        }
      }

      const mean = total / RANGE
      g.textAlign = 'left'
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.45)'
      g.fillText(
        `condition ${((1 - mean) * 100).toFixed(0)}%   ·   worst ${noteName(worstNote)} ${(worst * 100).toFixed(0)}% worn`,
        pad,
        16,
      )
      g.fillStyle = 'rgba(255,255,255,0.22)'
      g.textAlign = 'right'
      g.fillText('play it, and watch what you use wear out', w - pad, 16)
    }, viz)

    ctx.status('press space · it plays itself and slowly ruins itself — or play along')
  },
})
