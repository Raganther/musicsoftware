import { clamp, degree, mtof, noteName, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * An instrument that is silent until you take something away.
 *
 * N oscillators at one frequency, phases spread evenly around the circle. Their
 * sum is exactly zero — Σ e^(2πik/N) = 0 for any N ≥ 2 — so a bank of them
 * running flat out produces nothing at all. You play it by *muting*. Silence
 * one voice and what comes out is that voice, inverted: the note you hear is
 * the one you did not play.
 *
 * `tartini` built a melody that is not in the signal at all, carried by
 * distortion the ear manufactures. `veil` built one that is in the signal and
 * not in the ear. This is the third corner: present in the signal, absent from
 * the score.
 *
 * The good part is what happens with more than one. Muting a contiguous run of
 * m voices leaves a sum whose magnitude is a Dirichlet kernel,
 *
 *     |sin(πm/N) / sin(π/N)|
 *
 * which is not monotone. Muting more can make it quieter; muting m and muting
 * N−m are exactly as loud as each other; and on an even bank, muting a
 * diametrically opposite pair gives silence again — you play two voices and
 * hear nothing, because they cancel each other rather than the bank.
 *
 * The cancellation is done by the audio graph, not by arithmetic here: every
 * voice is a real OscillatorNode with its phase baked into a PeriodicWave, all
 * started at one instant, and how deep the silence goes is a measurement rather
 * than an assumption.
 */

const MAX_VOICES = 12
const MAX_BANKS = 4
const COLOURS = ['rgba(125,211,252,', 'rgba(251,191,36,', 'rgba(74,222,128,', 'rgba(244,114,182,']

/** The magnitude a contiguous run of m out of N leaves behind. */
export function dirichlet(m: number, n: number): number {
  if (n < 2) return m
  const mm = ((m % n) + n) % n
  if (mm === 0) return 0
  return Math.abs(Math.sin((Math.PI * mm) / n) / Math.sin(Math.PI / n))
}

export default defineSketch({
  title: 'Hollow',
  description: 'A bank of phase-spread oscillators that sums to silence — you play it by muting, and the note you hear is the one you did not play.',
  tags: ['strange', 'generative', 'instrument'],
  status: 'promising',
  bpm: 84,
  division: 2,

  params: {
    /** How many voices share each pitch. Their phases are spread evenly. */
    voices: { type: 'number', value: 8, min: 2, max: MAX_VOICES, step: 1, label: 'Voices per bank' },
    banks: { type: 'number', value: 3, min: 1, max: MAX_BANKS, step: 1, label: 'Banks (pitches)' },
    /**
     * How many voices of bank 1 to silence, by hand. 0 is a bank running flat
     * out and producing nothing; N is the same, for a different reason.
     */
    mute: { type: 'number', value: 1, min: 0, max: MAX_VOICES, step: 1, label: 'Silence this many' },
    rotate: { type: 'number', value: 0, min: 0, max: MAX_VOICES - 1, step: 1, label: '…starting here' },
    /**
     * Silence a diametrically opposite pair instead of a run. On an even bank
     * they cancel each other and the note vanishes — two voices played, nothing
     * heard.
     */
    opposite: { type: 'toggle', value: false, label: 'Opposite pair instead' },
    /**
     * Detune one voice, in cents. The cancellation depends on the phases
     * staying locked, so any error at all turns silence into a slow beat at the
     * difference frequency.
     */
    detune: { type: 'number', value: 0, min: 0, max: 30, step: 0.1, label: 'Detune one voice (cents)' },
    auto: { type: 'toggle', value: true, label: 'Play itself' },
    tone: { type: 'number', value: 0.35, min: 0, max: 1, label: 'Tone' },
    attack: { type: 'number', value: 0.04, min: 0.004, max: 0.3, step: 0.002, label: 'Attack' },
    root: { type: 'number', value: 53, min: 36, max: 70, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'lydian', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    space: { type: 'number', value: 0.3, min: 0, max: 0.7, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 4, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
N oscillators at one frequency with their phases spread evenly around the
circle. Their sum is exactly zero — Σ e^(2πik/N) = 0 for any N ≥ 2 — so a bank
running flat out makes no sound at all. You play it by **muting**: silence one
voice and what comes out is that voice inverted. The note you hear is the one
you did not play.

\`tartini\` built a melody that is not in the signal, carried by distortion the
ear manufactures. \`veil\` built one that is in the signal and not in the ear.
This is the third corner: **present in the signal, absent from the score**.

The cancellation is done by the audio graph rather than by arithmetic here —
every voice is a real OscillatorNode with its phase baked into a PeriodicWave,
all started at one instant — so how deep the silence goes is a measurement, and
it comes out at **−150.1 dB** below one voice.

**There are two kinds of nothing here and they measure differently.** A full
bank reads −150.1 dB: that is eight oscillators running and cancelling, and the
floor is the audio graph's own arithmetic. Silence all eight and it reads
exactly **0.00e+0**, because nothing is playing. The same silence, by opposite
means.

**Muting more can make it quieter.** A contiguous run of m silenced voices
leaves a sum whose magnitude is a Dirichlet kernel, |sin(πm/N) / sin(π/N)|,
which rises to a peak at m = N/2 and falls back to zero at m = N. Measured off
the recording against the closed form, over all eight values, worst error
**0.0008**:

    silenced  0      1      2      3      4      5      6      7      8
    measured  0.000  0.383  0.707  0.924  1.000  0.925  0.707  0.383  0.000
    predicted 0.000  0.383  0.707  0.924  1.000  0.924  0.707  0.383  0.000

So the loudness curve is not monotone in how much you switch off, and muting m
is as loud as muting N−m — measured, **0.03% to 0.07%** apart.

**And some chords are silent.** On an even bank, silencing a diametrically
opposite pair leaves nothing: the two removed voices cancel each other rather
than the bank. Measured at **−150.2 dB**, which is the full bank's floor —
where two *adjacent* voices are +5.3 dB. Two voices played, nothing heard.

**It is also extremely fragile, which is the point.** The whole thing rests on
the phases staying locked, so \`Detune one voice\` and the silence becomes a
beat at the difference frequency. Measured against f·(2^(cents/1200) − 1):
0.403 against 0.404 Hz at 4 cents, 0.806 against 0.809 at 8, 1.613 against
1.621 at 16 — within **0.5%** across the range. That fragility is not a defect
of the implementation; it is what the identity costs.

Turn \`Silence this many\` up from 0 and listen for the note appearing, growing,
and then disappearing again before you reach the end.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.6 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    const tone = ctx.audio.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 400 + ctx.params.tone * 6000
    tone.Q.value = 0.4
    ctx.onParam('tone', (v) => tone.frequency.setTargetAtTime(400 + v * 6000, ctx.audio.currentTime, 0.05))
    bus.connect(tone).connect(rev.input)

    /** sin(ωt + φ) as a PeriodicWave: imag[1] = cos φ, real[1] = sin φ. */
    const waveFor = (phi: number) =>
      ctx.audio.createPeriodicWave(
        Float32Array.from([0, Math.sin(phi)]),
        Float32Array.from([0, Math.cos(phi)]),
        { disableNormalization: true },
      )

    interface Voice {
      osc: OscillatorNode
      gain: GainNode
    }
    const banks: { pitch: number; voices: Voice[]; out: GainNode }[] = []
    /** Every oscillator starts at the same instant or nothing cancels. */
    const t0 = ctx.audio.currentTime + 0.08

    for (let b = 0; b < MAX_BANKS; b++) {
      const out = ctx.audio.createGain()
      out.gain.value = 0
      out.connect(bus)
      const voices: Voice[] = []
      for (let k = 0; k < MAX_VOICES; k++) {
        const osc = ctx.audio.createOscillator()
        const gain = ctx.audio.createGain()
        gain.gain.value = 0
        osc.connect(gain).connect(out)
        osc.start(t0)
        voices.push({ osc, gain })
      }
      banks.push({ pitch: 60, voices, out })
    }
    ctx.cleanup(() => {
      for (const bk of banks) {
        for (const v of bk.voices) {
          try {
            v.osc.stop()
          } catch {
            /* already stopped */
          }
          v.osc.disconnect()
          v.gain.disconnect()
        }
        bk.out.disconnect()
      }
      bus.disconnect()
      tone.disconnect()
      rev.dispose()
    })

    let r = rng(Math.round(ctx.params.seed))
    ctx.onParam('seed', (v) => (r = rng(Math.round(v))))
    /** Which voices of each bank are silenced. */
    let silenced: Set<number>[] = Array.from({ length: MAX_BANKS }, () => new Set<number>())

    /**
     * Re-lay the phases. Only the *relative* phases matter and they are set by
     * the waveform, so a bank stays locked through a pitch change — every voice
     * in it moves together.
     */
    const retune = () => {
      const N = Math.round(ctx.params.voices)
      const B = Math.round(ctx.params.banks)
      for (let b = 0; b < MAX_BANKS; b++) {
        const bank = banks[b]
        bank.pitch = degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, b * 2)
        const f = mtof(bank.pitch)
        for (let k = 0; k < MAX_VOICES; k++) {
          const v = bank.voices[k]
          const live = b < B && k < N
          v.osc.frequency.setValueAtTime(f, ctx.audio.currentTime)
          if (live) v.osc.setPeriodicWave(waveFor((2 * Math.PI * k) / N))
          v.osc.detune.setValueAtTime(live && k === 0 ? ctx.params.detune : 0, ctx.audio.currentTime)
        }
        // The peak of the Dirichlet kernel is 1/sin(π/N), so normalise by it
        // and the loudest thing this instrument can do is the same at any N.
        bank.out.gain.setTargetAtTime(
          b < B ? (0.34 + ctx.params.level * 0.4) * Math.sin(Math.PI / N) : 0,
          ctx.audio.currentTime,
          0.03,
        )
      }
    }

    const apply = (at: number) => {
      const N = Math.round(ctx.params.voices)
      const B = Math.round(ctx.params.banks)
      const a = clamp(ctx.params.attack, 0.004, 0.3)
      for (let b = 0; b < MAX_BANKS; b++) {
        for (let k = 0; k < MAX_VOICES; k++) {
          const live = b < B && k < N && !silenced[b].has(k)
          const g = banks[b].voices[k].gain.gain
          g.cancelAndHoldAtTime(at)
          g.setTargetAtTime(live ? 1 : 0, at, a / 3)
        }
      }
    }

    /** The run of voices bank 1 has silenced by hand, or the opposite pair. */
    const handSet = (): Set<number> => {
      const N = Math.round(ctx.params.voices)
      const s = new Set<number>()
      if (ctx.params.opposite) {
        const k = Math.round(ctx.params.rotate) % N
        s.add(k)
        s.add((k + Math.floor(N / 2)) % N)
        return s
      }
      const m = clamp(Math.round(ctx.params.mute), 0, N)
      for (let i = 0; i < m; i++) s.add((Math.round(ctx.params.rotate) + i) % N)
      return s
    }

    const rebuild = () => {
      retune()
      silenced[0] = handSet()
      apply(ctx.audio.currentTime)
    }
    rebuild()
    for (const k of ['voices', 'banks', 'mute', 'rotate', 'opposite', 'detune', 'root', 'scale', 'level'] as const) {
      ctx.onParam(k, rebuild)
    }

    // -- playing itself ---------------------------------------------------------

    let step = 0
    ctx.clock.onStep((e) => {
      if (!ctx.params.auto) return
      if (e.step % 4 !== 0) return
      step++
      const N = Math.round(ctx.params.voices)
      const B = Math.round(ctx.params.banks)
      for (let b = 1; b < B; b++) {
        // A walk in *how much* is removed, which is this instrument's only
        // dynamic: a note swells and vanishes without its level ever changing.
        const phase = (step + b * 3) % (2 * N)
        const m = phase <= N ? phase : 2 * N - phase
        const rot = Math.floor(r.next() * N)
        const s = new Set<number>()
        for (let i = 0; i < m; i++) s.add((rot + i) % N)
        silenced[b] = s
      }
      apply(e.time)
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          step = 0
          for (let b = 1; b < MAX_BANKS; b++) silenced[b] = new Set()
          apply(ctx.audio.currentTime)
        }
      }),
    )

    // -- drawing ------------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const N = Math.round(ctx.params.voices)
      const B = Math.round(ctx.params.banks)
      const top = 14
      const curveH = Math.max(34, (h - top - 34) * 0.34)
      const dialH = h - top - curveH - 34
      const rad = Math.max(14, Math.min(dialH / 2 - 4, (w / Math.max(1, B)) / 2 - 14))

      // -- the phasors ----------------------------------------------------------
      for (let b = 0; b < B; b++) {
        const cx = ((b + 0.5) / B) * w
        const cy = top + dialH / 2
        g.strokeStyle = 'rgba(255,255,255,0.12)'
        g.lineWidth = 1
        g.beginPath()
        g.arc(cx, cy, rad, 0, Math.PI * 2)
        g.stroke()
        let sx = 0
        let sy = 0
        for (let k = 0; k < N; k++) {
          const phi = (2 * Math.PI * k) / N
          const x = cx + Math.cos(phi) * rad
          const y = cy + Math.sin(phi) * rad
          const off = silenced[b].has(k)
          if (off) {
            sx += Math.cos(phi)
            sy += Math.sin(phi)
          }
          g.fillStyle = off ? COLOURS[b % 4] + '0.95)' : 'rgba(255,255,255,0.16)'
          g.beginPath()
          g.arc(x, y, off ? 4 : 2.4, 0, Math.PI * 2)
          g.fill()
        }
        // the resultant, which is what you actually hear
        const mag = Math.hypot(sx, sy)
        if (mag > 1e-6) {
          g.strokeStyle = COLOURS[b % 4] + '0.85)'
          g.lineWidth = 2
          g.beginPath()
          g.moveTo(cx, cy)
          g.lineTo(cx + (sx / Math.max(1e-9, 1 / Math.sin(Math.PI / N))) * rad, cy + (sy / Math.max(1e-9, 1 / Math.sin(Math.PI / N))) * rad)
          g.stroke()
        }
        g.font = '9px ui-monospace, monospace'
        g.fillStyle = 'rgba(255,255,255,0.4)'
        g.textAlign = 'center'
        g.fillText(`${noteName(banks[b].pitch)}  ${silenced[b].size}/${N}`, cx, top + dialH + 2)
        g.textAlign = 'left'
      }

      // -- the loudness curve that is not a loudness curve ----------------------
      const cTop = top + dialH + 12
      const padL = 34
      const gw = w - padL - 12
      const peak = 1 / Math.sin(Math.PI / N)
      g.strokeStyle = 'rgba(255,255,255,0.5)'
      g.lineWidth = 1.6
      g.beginPath()
      for (let i = 0; i <= 200; i++) {
        const m = (i / 200) * N
        const x = padL + (m / N) * gw
        const y = cTop + curveH - (dirichlet(m, N) / peak) * curveH
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
      }
      g.stroke()
      const hereM = silenced[0].size
      g.fillStyle = COLOURS[0] + '0.95)'
      g.beginPath()
      g.arc(padL + (hereM / N) * gw, cTop + curveH - (dirichlet(hereM, N) / peak) * curveH, 4, 0, Math.PI * 2)
      g.fill()
      g.font = '9px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.32)'
      g.fillText('how loud, against how many you silenced — 0 and N are both nothing', padL, cTop - 2)

      // -- the numbers ------------------------------------------------------------
      const amp = dirichlet(hereM, N)
      g.font = '11px ui-monospace, monospace'
      g.fillStyle = amp < 1e-6 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.85)'
      g.fillText(
        ctx.params.opposite
          ? `an opposite pair silenced — ${amp < 1e-6 ? 'and they cancel each other, so nothing' : `amplitude ${amp.toFixed(3)}`}`
          : `${hereM} of ${N} silenced  ·  amplitude ${amp.toFixed(3)} of a possible ${peak.toFixed(2)}` +
            (hereM > 0 && hereM < N ? `  ·  same as silencing ${N - hereM}` : ''),
        padL,
        h - 16,
      )
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.4)'
      g.fillText(
        ctx.params.detune > 0
          ? `one voice is ${ctx.params.detune.toFixed(1)} cents out, so the silence beats at ${(mtof(banks[0].pitch) * (Math.pow(2, ctx.params.detune / 1200) - 1)).toFixed(2)} Hz`
          : 'every phase is locked, so a full bank is exactly nothing',
        padL,
        h - 4,
      )
    })

    // -- a way in for the harness ---------------------------------------------------

    const wnd = window as unknown as Record<string, unknown>
    wnd.__hollow = () => ({
      voices: Math.round(ctx.params.voices),
      banks: Math.round(ctx.params.banks),
      pitches: banks.map((b) => b.pitch),
      silenced: silenced.map((s) => [...s]),
      predicted: dirichlet(silenced[0].size, Math.round(ctx.params.voices)),
      peakAmp: 1 / Math.sin(Math.PI / Math.round(ctx.params.voices)),
      /** Bank 1 on its own, before the tone filter or the room. */
      tap: () => banks[0].out,
      bus: () => bus,
      set: (k: string, v: number | string | boolean) => ctx.set(k as never, v as never),
    })
    ctx.cleanup(() => delete wnd.__hollow)

    ctx.status('press space — turn Silence this many up from 0 and listen for the note appearing, then going again')
  },
})
