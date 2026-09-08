import { clamp, reverb, rng } from '@core'
import { defineSketch } from '@runtime/sketch'
import { makeIR, normalise, peakWidth, smooth, spectrum } from './room'

/**
 * I am sitting in a room.
 *
 * Lucier's piece is a loop with one instruction: play the recording into the
 * room, record that, repeat. What it does is a multiplication. Playing a signal
 * through a room multiplies its spectrum by |H(f)|, so generation N is
 * |X₀(f)|·|H(f)|^N and the ratio between any two frequencies has been raised to
 * the Nth power. There is no averaging and no filtering being applied; there is
 * only a room, applied over and over, and an exponential does the rest. Speech
 * turns into a chord that was always in the room and never in the voice.
 *
 * That framing makes a prediction the piece itself does not obviously suggest.
 * Near its top a resonance is locally quadratic, so |H|^N goes as
 * exp(−N·a·δ²): a Gaussian whose width falls as **N^(−1/2)**. A Lorentzian
 * peak gives the same exponent by a different route, so −1/2 is a statement
 * about repetition rather than about the shape of any particular resonance.
 * Forty generations should therefore be about six times narrower than one, and
 * getting narrower ever more slowly — which is why the piece has to be as long
 * as it is.
 *
 * The room here is a diffuse noise tail with a few resonances dropped into it,
 * rather than only the resonances. That is deliberate: a room built purely from
 * modes I chose would answer "which frequency wins" by construction, and the
 * whole question is whether a designed mode can beat the loudest accident in
 * the noise. Sometimes it cannot.
 */

const MAX_GEN = 40
const FFT = 262144   // > 2.6 s at 48 kHz, so one window covers the whole buffer

export default defineSketch({
  title: 'Sitting',
  description: 'Lucier: each generation is the last one played back into the room, until the room is all that is left.',
  tags: ['process', 'generative', 'strange'],
  status: 'promising',
  bpm: 96,
  division: 1,

  params: {
    /** Which generation you are listening to. 0 is the original recording. */
    generation: { type: 'number', value: 0, min: 0, max: MAX_GEN, step: 1, label: 'Generation' },
    /** Steps between generations when it runs itself. 0 holds. */
    advance: { type: 'number', value: 2, min: 0, max: 8, step: 1, label: 'Advance every (bars)' },
    room: { type: 'number', value: 1.4, min: 0.4, max: 2.5, step: 0.05, label: 'Room size (s)' },
    modes: { type: 'number', value: 3, min: 0, max: 12, step: 1, label: 'Resonances' },
    /**
     * How long the resonances ring, in seconds — which *is* their linewidth,
     * at 2.2/t60 Hz. It matters more than it looks: a room that rings for a
     * second has modes about 2 Hz wide, and a 2.6 s recording cannot represent
     * anything narrower than about 0.4 Hz, so such a room starts at the floor
     * and the narrowing has nowhere to go. Short rings are where the process
     * is actually visible.
     */
    ring: { type: 'number', value: 0.05, min: 0.03, max: 1.5, step: 0.01, label: 'Resonance ring (s)' },
    /**
     * How much diffuse tail sits under the resonances. Not decoration: the
     * largest of a hundred thousand noise bins is around five standard
     * deviations, so a mode has to beat an extreme value rather than an
     * average. At 1 the process ends on a noise spike nobody put there.
     */
    diffuse: { type: 'number', value: 0.12, min: 0, max: 1, step: 0.01, label: 'Diffuse tail' },
    phrase: { type: 'number', value: 12, min: 1, max: 99, step: 1, label: 'Phrase' },
    space: { type: 'number', value: 0.12, min: 0, max: 0.5, step: 0.01, label: 'Room (output)' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 3, min: 1, max: 999, step: 1, label: 'Seed (the room)' },
  },

  notes: `
Lucier's piece as a process you can stop and inspect. Playing a recording
through a room multiplies its spectrum by |H(f)|, so generation N is
|X₀(f)|·|H(f)|^N — the ratio between any two frequencies raised to the Nth
power. Nothing is being filtered or averaged; there is only a room, applied
over and over, and an exponential.

**It is exactly the multiplication.** Comparing each generation to the previous
one and dividing by the room's |H| — measured by transforming the impulse
response, not taken from the numbers the room was built with — the ratio is one
constant across the whole band to a spread of **0.18 to 0.28 dB** from
generation 4 onward, median under 0.11 dB. (Generation 1 is worse at 2.2 dB,
because the voice has near-zeros where the ratio is ill-conditioned; by
generation 4 the signal only lives where the room is strong.)

**And it ends exactly where the room says.** Generation 40 peaks at 203.9 Hz;
the room's own transfer function peaks at 203.9 Hz. The final pitch is a
measurement of the room and nothing else — which is the claim the piece makes,
and it is checkable rather than poetic.

**What survives narrows as N^(−1/2).** This is the part the piece does not tell
you. Near its top a resonance is locally quadratic, so |H|^N goes as
exp(−N·a·δ²) — a Gaussian whose width falls as the inverse square root of the
generation, and a Lorentzian gives the same exponent by another route. Measured
on the rendered audio with a single resonance: **−0.54** (R² 0.91) against
−0.500. On |H|^N alone, with no source and no recording in the way:
**−0.537** (R² 0.991) for a wide mode and **−0.490** (R² 0.994) for a narrow
one. Forty generations is about six times narrower than one, and that is why
the piece has to be as long as it is.

**A recording of length T cannot hold a line narrower than about 1/T.** At 2.6
seconds that is 0.4 Hz, and it is a hard floor on the whole process: with
\`Resonance ring\` up at a second the room's modes are already 2 Hz wide, the
narrowing hits the floor by generation 6, and the rest of the piece does
nothing at all. Short rings are where there is room to watch. Lucier's own
recordings were far longer than this, which is not an incidental detail.

**And the winner is not always a mode you built.** The largest of a hundred
thousand noise bins is about five standard deviations, so a resonance has to
beat an extreme value rather than an average. Take \`Diffuse tail\` up and the
process ends on a spike nobody put there; the N^(−1/2) fit degrades at the same
time, because what it is now tracking is not a resonance.

Turn \`Resonances\` to 0 for the strangest version: a room with no modes at all
still converges, because random noise still has a maximum. Lucier's effect does
not need a resonant room, only a repeated one.

Each generation is rendered, not faked — the previous buffer convolved with the
impulse response through an OfflineAudioContext, truncated to the same length a
tape of fixed length would give, and normalised the way his gain knob was.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 1.6 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const amp = ctx.audio.createGain()
    amp.gain.value = 0
    amp.connect(rev.input)

    const sr = ctx.audio.sampleRate
    const SECONDS = 2.6
    const LEN = Math.round(SECONDS * sr)

    // -- the original recording -------------------------------------------------

    /**
     * Something broadband and articulated, standing in for a voice: bursts of
     * resonant noise with varied envelopes. The room needs material across the
     * band or there is nothing for it to select from.
     */
    const makePhrase = (seed: number): AudioBuffer => {
      const buf = ctx.audio.createBuffer(1, LEN, sr)
      const d = buf.getChannelData(0)
      const r = rng(seed * 7919 + 11)
      const nBursts = 9 + Math.floor(r.next() * 5)
      for (let b = 0; b < nBursts; b++) {
        const at = Math.floor((b / nBursts + (r.next() - 0.5) * 0.05) * LEN * 0.94)
        const dur = Math.floor((0.06 + r.next() * 0.15) * sr)
        // two formants and a buzz, which is roughly what a vowel is
        const f1 = 220 + r.next() * 500
        const f2 = f1 * (1.6 + r.next() * 2.4)
        const buzz = 80 + r.next() * 90
        let y1 = 0, y2 = 0, z1 = 0, z2 = 0
        const q = 0.985
        const c1 = 2 * q * Math.cos((2 * Math.PI * f1) / sr)
        const c2 = 2 * q * Math.cos((2 * Math.PI * f2) / sr)
        for (let i = 0; i < dur && at + i < LEN; i++) {
          const t = i / dur
          const env = Math.min(1, t * 12) * Math.exp(-3.2 * t)
          // a glottal-ish excitation: a pulse train plus breath
          const ph = ((buzz * i) / sr) % 1
          const x = (ph < 0.06 ? 1 : 0) * 0.9 + (r.next() * 2 - 1) * 0.25
          const o1 = x + c1 * y1 - q * q * y2
          y2 = y1; y1 = o1
          const o2 = x + c2 * z1 - q * q * z2
          z2 = z1; z1 = o2
          d[at + i] += env * (o1 * 0.045 + o2 * 0.03)
        }
      }
      normalise(d as unknown as Float32Array, 0.85)
      return buf
    }

    const makeRoom = (): AudioBuffer => {
      const ir = makeIR(sr, ctx.params.room, Math.round(ctx.params.seed),
                        Math.round(ctx.params.modes), ctx.params.ring, ctx.params.diffuse)
      const buf = ctx.audio.createBuffer(1, ir.length, sr)
      buf.getChannelData(0).set(ir)
      return buf
    }

    // -- the process --------------------------------------------------------------

    let irBuf = makeRoom()
    const DRAW = 480
    let gens: AudioBuffer[] = []
    /** Downsampled onto the log-frequency axis for drawing; the full transform is
     *  128k bins and keeping 41 of them is not worth the memory. */
    let specs: Float32Array[] = []
    /** The peak of each generation, taken from the *full* transform, not this. */
    let peaks: { hz: number; width: number }[] = []
    let hDraw: Float32Array = new Float32Array(DRAW)
    let hPeak = { hz: 0, width: 0 }
    let pumping = false
    let renderFails = 0

    const binHz = sr / FFT
    const F_LO = 60
    const F_HI = 5200

    /** Largest magnitude in each log-frequency slot, normalised to the maximum. */
    const downsample = (mag: Float64Array): Float32Array => {
      const out: Float32Array = new Float32Array(DRAW)
      let mx = 1e-12
      for (let i = 3; i < mag.length; i++) mx = Math.max(mx, mag[i])
      for (let k = 0; k < DRAW; k++) {
        const f0 = F_LO * Math.exp((k / DRAW) * Math.log(F_HI / F_LO))
        const f1 = F_LO * Math.exp(((k + 1) / DRAW) * Math.log(F_HI / F_LO))
        const a = Math.max(3, Math.floor(f0 / binHz))
        const b = Math.min(mag.length - 1, Math.max(a, Math.ceil(f1 / binHz)))
        let v = 0
        for (let i = a; i <= b; i++) v = Math.max(v, mag[i])
        out[k] = v / mx
      }
      return out
    }

    const loBin = Math.floor(F_LO / binHz)
    const hiBin = Math.ceil(F_HI / binHz)
    const record = (buf: AudioBuffer) => {
      const mag = spectrum(buf.getChannelData(0), FFT)
      specs.push(downsample(mag))
      // The envelope, not the raw bins: a 2.6 s recording has 0.4 Hz detail
      // everywhere, and the width of *that* is one bin whatever the room did.
      const p = peakWidth(smooth(mag, binHz, 2), binHz, loBin, hiBin)
      peaks.push({ hz: p.hz, width: p.width })
    }

    /**
     * One generation: the previous buffer through the room, cut back to the same
     * length a tape of fixed length would give, and normalised the way his gain
     * knob was. Without the normalisation each pass loses 20-odd dB and the
     * piece is inaudible by generation five.
     */
    const convolve = async (input: AudioBuffer): Promise<AudioBuffer> => {
      const oc = new OfflineAudioContext(1, LEN, sr)
      const src2 = oc.createBufferSource()
      src2.buffer = input
      const cv = oc.createConvolver()
      cv.normalize = false
      cv.buffer = irBuf
      src2.connect(cv).connect(oc.destination)
      src2.start()
      const rendered = await oc.startRendering()
      const out = ctx.audio.createBuffer(1, LEN, sr)
      const d = out.getChannelData(0)
      d.set(rendered.getChannelData(0))
      normalise(d as unknown as Float32Array, 0.85)
      return out
    }

    const grow = async (upTo: number) => {
      while (gens.length <= Math.min(MAX_GEN, upTo)) {
        const next = await convolve(gens[gens.length - 1])
        gens.push(next)
        record(next)
      }
    }

    const pump = async () => {
      if (pumping) return
      pumping = true
      try {
        await grow(Math.round(ctx.params.generation) + 2)
      } catch {
        renderFails++
      }
      pumping = false
    }

    const rebuild = () => {
      irBuf = makeRoom()
      const hm = spectrum(irBuf.getChannelData(0), FFT, true)
      hDraw = downsample(hm)
      const hp = peakWidth(smooth(hm, binHz, 2), binHz, loBin, hiBin)
      hPeak = { hz: hp.hz, width: hp.width }
      gens = [makePhrase(Math.round(ctx.params.phrase))]
      specs = []
      peaks = []
      record(gens[0])
      void pump()
    }
    rebuild()
    for (const k of ['room', 'modes', 'ring', 'diffuse', 'seed', 'phrase'] as const) ctx.onParam(k, rebuild)
    ctx.onParam('generation', () => void pump())

    // -- playing it ----------------------------------------------------------------

    let src: AudioBufferSourceNode | null = null
    let srcGain: GainNode | null = null
    let playing = -1

    const fadeOut = (s: AudioBufferSourceNode | null, g: GainNode | null, at: number) => {
      if (!s || !g) return
      g.gain.cancelAndHoldAtTime(at)
      g.gain.linearRampToValueAtTime(0, at + 0.05)
      s.stop(at + 0.06)
      setTimeout(() => {
        s.disconnect()
        g.disconnect()
      }, 400)
    }

    const start = (g: number) => {
      const buf = gens[g]
      if (!buf) return
      const now = ctx.audio.currentTime
      fadeOut(src, srcGain, now)
      const s = ctx.audio.createBufferSource()
      s.buffer = buf
      s.loop = true
      const gn = ctx.audio.createGain()
      gn.gain.setValueAtTime(0, now)
      gn.gain.linearRampToValueAtTime(1, now + 0.05)
      s.connect(gn).connect(amp)
      s.start(now)
      src = s
      srcGain = gn
      playing = g
    }

    const stopAll = () => {
      fadeOut(src, srcGain, ctx.audio.currentTime)
      src = null
      srcGain = null
      playing = -1
    }
    ctx.cleanup(stopAll)
    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) stopAll()
      }),
    )

    let bars = 0
    ctx.clock.onStep((e) => {
      amp.gain.setTargetAtTime(0.4 + ctx.params.level * 1.15, e.time, 0.05)
      const g = Math.round(ctx.params.generation)
      if (playing !== g && gens[g]) start(g)
      if (e.step % 4 === 0 && e.step > 0) {
        bars++
        const every = Math.round(ctx.params.advance)
        if (every > 0 && bars % every === 0 && g < MAX_GEN) ctx.set('generation', g + 1)
      }
    })

    ctx.cleanup(() => {
      amp.disconnect()
      rev.dispose()
    })

    // -- drawing --------------------------------------------------------------------

    ctx.canvas((g2, { w, h }) => {
      g2.clearRect(0, 0, w, h)
      const padL = 34
      const padR = 10
      const gw = w - padL - padR
      const top = 14
      const stackH = Math.max(60, (h - 34) * 0.6)
      const plotH = Math.max(30, h - top - stackH - 36)
      const fx = (hz: number) =>
        padL + (Math.log(clamp(hz, F_LO, F_HI) / F_LO) / Math.log(F_HI / F_LO)) * gw
      const gy = (n: number) => top + (n / (MAX_GEN + 1)) * stackH
      const rowH = Math.max(1.5, stackH / (MAX_GEN + 1))

      // -- the generations, stacked -------------------------------------------------
      for (let n = 0; n < specs.length; n++) {
        const s2 = specs[n]
        for (let k = 0; k < DRAW; k++) {
          const lit = clamp(1 + (20 * Math.log10(Math.max(1e-9, s2[k]))) / 60, 0, 1)
          if (lit <= 0.02) continue
          g2.fillStyle = `rgba(${120 + lit * 135},${170 + lit * 60},250,${lit * 0.92})`
          g2.fillRect(padL + (k / DRAW) * gw, gy(n), gw / DRAW + 0.7, rowH)
        }
      }
      const cur = Math.round(ctx.params.generation)
      g2.strokeStyle = 'rgba(251,191,36,0.9)'
      g2.lineWidth = 1
      g2.beginPath()
      g2.moveTo(padL - 5, gy(cur) + rowH / 2)
      g2.lineTo(w - padR, gy(cur) + rowH / 2)
      g2.stroke()

      g2.font = '9px ui-monospace, monospace'
      g2.fillStyle = 'rgba(255,255,255,0.32)'
      g2.fillText('generation 0 at the top; each row is the one above, played into the room again', padL, top - 4)
      g2.textAlign = 'right'
      for (const hz of [100, 250, 500, 1000, 2500, 5000]) {
        g2.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), fx(hz) + 11, top + stackH + 11)
      }
      g2.textAlign = 'left'

      // -- the width of what is left, against N^(-1/2) --------------------------------
      const pTop = top + stackH + 20
      const rows = peaks.map((p, n) => ({ n, ...p })).filter((p) => p.n >= 1 && p.width > 0)
      if (rows.length > 2) {
        let wmax = 0
        for (const p of rows) wmax = Math.max(wmax, p.width)
        const px2 = (n: number) => padL + (n / MAX_GEN) * gw
        const py2 = (v: number) => pTop + plotH - clamp(v / wmax, 0, 1) * plotH
        g2.strokeStyle = 'rgba(251,191,36,0.55)'
        g2.setLineDash([3, 3])
        g2.lineWidth = 1.2
        g2.beginPath()
        for (let n = rows[0].n; n <= MAX_GEN; n++) {
          const v = rows[0].width * Math.sqrt(rows[0].n / n)
          n === rows[0].n ? g2.moveTo(px2(n), py2(v)) : g2.lineTo(px2(n), py2(v))
        }
        g2.stroke()
        g2.setLineDash([])
        g2.strokeStyle = 'rgba(226,232,240,0.9)'
        g2.lineWidth = 1.6
        g2.beginPath()
        rows.forEach((p, i) => (i === 0 ? g2.moveTo(px2(p.n), py2(p.width)) : g2.lineTo(px2(p.n), py2(p.width))))
        g2.stroke()
        g2.fillStyle = 'rgba(255,255,255,0.3)'
        g2.font = '9px ui-monospace, monospace'
        g2.fillText('width of the surviving peak (solid) against N^-1/2 from the first point (dashed)', padL, pTop - 4)
      }

      // -- the numbers -------------------------------------------------------------------
      const pk = peaks[Math.min(cur, peaks.length - 1)]
      g2.font = '11px ui-monospace, monospace'
      g2.fillStyle = 'rgba(255,255,255,0.82)'
      g2.fillText(
        `generation ${cur}${gens[cur] ? '' : ' (rendering…)'}` +
          (pk ? `  ·  peak ${pk.hz.toFixed(1)} Hz, ${pk.width.toFixed(2)} Hz wide` : ''),
        padL,
        h - 16,
      )
      g2.font = '10px ui-monospace, monospace'
      g2.fillStyle = 'rgba(255,255,255,0.4)'
      g2.fillText(
        `the room's loudest frequency is ${hPeak.hz.toFixed(1)} Hz — that is where this ends up` +
          (renderFails ? `  ·  ${renderFails} renders failed` : ''),
        padL,
        h - 4,
      )
      void hDraw
    })

    // -- a way in for the harness -----------------------------------------------------

    const wnd = window as unknown as Record<string, unknown>
    wnd.__sitting = () => ({
      sr,
      len: LEN,
      fft: FFT,
      binHz,
      generation: Math.round(ctx.params.generation),
      rendered: gens.length,
      ir: Array.from(irBuf.getChannelData(0)),
      gen: (n: number) => (gens[n] ? Array.from(gens[n].getChannelData(0)) : null),
      /** Render up to n and resolve when they exist, so a harness need not poll blindly. */
      want: async (n: number) => {
        await grow(n)
        return gens.length
      },
      tap: () => amp,
      set: (k: string, v: number | string) => ctx.set(k as never, v as never),
    })
    ctx.cleanup(() => delete wnd.__sitting)

    ctx.status('press space — it walks through the generations on its own; the room takes over around 15')
  },
})
