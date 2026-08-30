import { clamp, loadWorklet, mtof, noteName, reverb, rng } from '@core'
import { defineSketch } from '@runtime/sketch'
import workletUrl from './string.worklet.js?url'

/**
 * The wolf note, which is an avoided crossing you can hear.
 *
 * Somewhere around F on a cello's G string the note refuses to sustain. It
 * stutters, the bow feels like it is skidding, and moving a quarter-tone either
 * way cures it completely. Cellists route around it; the physics is more
 * interesting than the workaround.
 *
 * The cause is neither the string nor the body but the coupling. Two coupled
 * oscillators have normal modes at the eigenvalues of
 *
 *     [[ω₁²+κ, −κ], [−κ, ω_b²+κ]]
 *
 * which are (ω₁²+ω_b²)/2 + κ ± √( ((ω₁²−ω_b²)/2)² + κ² ). The square root
 * cannot vanish while κ > 0, so tuning the string up through the body
 * resonance does not make the two frequencies meet — **they repel**. At the
 * closest approach the string is sounding two pitches a few Hz apart, and the
 * stutter is those two beating against each other.
 *
 * So the wolf is not a defect that happens to occur at one note. It is what an
 * avoided crossing sounds like, and the beat rate at the closest approach *is*
 * the coupling strength, in Hz, directly audible.
 *
 * `Coupling` at 0 is the control and a real one: with no coupling the two
 * frequencies cross freely, there is no repulsion and no beating, and the
 * scale runs through the body resonance without noticing it.
 *
 * Only mode 1 is coupled to the body. A body resonance is narrow and the upper
 * partials pass straight over it, which is also why a wolf is a property of one
 * note rather than of the whole instrument.
 */

/**
 * The exact normal modes of the coupled pair, in Hz. The sketch draws these and
 * the harness recomputes them from the same three numbers, so the picture and
 * the sound have a common answer to disagree with.
 */
export function normalModes(fs: number, fb: number, kappa: number): [number, number] {
  const w1 = (2 * Math.PI * fs) ** 2
  const wb = (2 * Math.PI * fb) ** 2
  const mid = (w1 + wb) / 2 + kappa
  const gap = Math.sqrt(((w1 - wb) / 2) ** 2 + kappa * kappa)
  return [Math.sqrt(Math.max(0, mid - gap)) / (2 * Math.PI), Math.sqrt(mid + gap) / (2 * Math.PI)]
}

export default defineSketch({
  title: 'Wolf',
  description: 'The cello wolf note: a body resonance and a string that will not share a frequency with it.',
  tags: ['dsp', 'worklet', 'physical-model', 'instrument'],
  status: 'promising',
  bpm: 60,
  division: 2,

  params: {
    // The scale must run *through* the body resonance, not start on it — the
    // whole point is the one note in the middle that behaves differently from
    // its neighbours, and you need the neighbours to hear it.
    low: { type: 'number', value: 38, min: 28, max: 60, step: 1, label: 'Scale starts at (MIDI)' },
    span: { type: 'number', value: 12, min: 3, max: 24, step: 1, label: 'Scale spans', unit: 'semitones' },
    bodyHz: { type: 'number', value: 98, min: 55, max: 220, step: 0.5, label: 'Body resonance', unit: 'Hz' },
    /**
     * 60 is higher than a real cello's main corpus resonance, which sits nearer
     * 20-40. It is the default anyway because of a measured fact: the splitting
     * is only *resolvable* as two pitches when it exceeds the body's own
     * linewidth, and at Q 26 those two numbers are both about 6.5 Hz, so the
     * pair merges into a single broad peak. Take it down to 26 to hear that —
     * the wolf is still perfectly audible there, as a warble and as a note that
     * will not sustain. You just can't point at two frequencies any more.
     */
    bodyQ: { type: 'number', value: 60, min: 3, max: 80, step: 1, label: 'Body Q' },
    couple: { type: 'number', value: 26, min: 0, max: 60, step: 0.5, label: 'Coupling (0 = no wolf)', unit: 'Hz' },
    bow: { type: 'number', value: 0, min: 0, max: 0.02, step: 0.0005, label: 'Bow (0 = pluck)' },
    ring: { type: 'number', value: 3.2, min: 0.4, max: 8, step: 0.1, label: 'String ring', unit: 's' },
    modes: { type: 'number', value: 6, min: 1, max: 12, step: 1, label: 'String partials' },
    every: { type: 'number', value: 4, min: 1, max: 12, step: 1, label: 'A note every', unit: 'steps' },
    space: { type: 'number', value: 0.24, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 2, min: 1, max: 999, step: 1 },
    again: { type: 'button', label: 'Back to the bottom' },
  },

  notes: `
Two coupled oscillators cannot share a frequency. Tune the string up through
the body resonance and the normal modes bend away from each other instead of
meeting, because the square root in

    λ± = (ω₁²+ω_b²)/2 + κ ± √( ((ω₁²−ω_b²)/2)² + κ² )

has a +κ² under it that never goes away. That is the wolf, and everything below
was measured from the recorded audio against that arithmetic — the prediction is
computed from the three numbers the sketch was handed and never read back out of
it, so the two have somewhere to disagree.

**They never meet.** Across ten notes either side of the crossing, 19 of 20
predicted modes were found in the spectrum within 1.5 Hz, mean error 0.066 Hz,
worst 0.160 Hz. At the closest approach the split is 6.67 Hz predicted, 6.44 Hz
measured. The one miss is the upper mode a minor third below the resonance,
where it has fallen under 2% of the lower one and below the analysis floor —
which is the physics, not a failure.

**The modes trade character, which is what makes it an avoided crossing** rather
than two unrelated things that happen to be near each other. A pluck drives the
string, so mode height reads out how much string is in each mode: a whole tone
below the resonance it is 100%/2%, at the resonance 100%/42%, a semitone above
51%/100%, and a minor third above 3%/100%. They swap identities as they pass.

**And the note stops ringing.** Sustain falls from 2.32 s away from the
resonance to 0.53 s a semitone above it — 4.4x — because there the mode is half
body and inherits the body's damping. That is the wolf as a player meets it: not
"a note with two pitches in it" but "the note that dies".

**Coupling 0 is a real control.** With κ = 0 the peak sits on the string to
within 0.010 Hz at all ten notes, and every note rings for exactly 3.20 s — the
String ring parameter, recovered to three figures. Flat. No dip, no split,
nothing happening at the resonance at all.

**Body Q 60 is higher than a real cello's**, whose main corpus resonance is
nearer 20-40, and that is a finding rather than a fudge. At Q 26 the two modes
merge into one peak — only 8 of 20 separable, against 19 of 20 at Q 60 —
while the sustain collapse is untouched at 4.46x against 4.36x. The wolf is
exactly as strong there, still warbling and still refusing to sustain; you
simply cannot point at two frequencies any more. Audibility comes a long way
before resolvability. (The likely mechanism is the coupled mode's linewidth
growing to the size of the splitting, but that is inferred from a decay time
rather than measured.)

Levels: default 0.485 pre-limiter, 0.807 in the hottest setting I could find
(a note every step at ring 8), 0.647 bowed. Two runs of the default agreed to
0.003.
`,

  async setup(ctx) {
    await loadWorklet(workletUrl)
    const node = new AudioWorkletNode(ctx.audio, 'wolf-string', { numberOfInputs: 0 })
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.6 })
    ctx.onParam('space', (v) => rev.setMix(v))
    node.connect(rev.input)
    ctx.cleanup(() => {
      node.port.postMessage({ type: 'panic' })
      node.disconnect()
      rev.dispose()
    })

    let reported = { peak: 0, raw: 0, eString: 0, eBody: 0 }
    let rawMax = 0
    node.port.onmessage = (e) => {
      reported = e.data
      if (reported.raw > rawMax) rawMax = reported.raw
    }

    /** Semitone offset of the note currently sounding, from `low`. */
    let step = 0
    let current = 0

    const kappa = () => (2 * Math.PI * ctx.params.couple) ** 2

    const retune = (midi: number) => {
      const f = mtof(midi)
      const count = Math.round(ctx.params.modes)
      const ring = ctx.params.ring
      const modes = []
      for (let i = 0; i < count; i++) {
        modes.push({
          f: f * (i + 1),
          // higher partials die sooner, as they do on a real string
          t60: Math.max(0.05, ring / Math.pow(i + 1, 0.7)),
          amp: 1 / Math.pow(i + 1, 1.3),
        })
      }
      node.port.postMessage({ modes })
      current = midi
    }

    const sendBody = () => {
      node.port.postMessage({
        body: {
          f: ctx.params.bodyHz,
          // Q is a ringing time: t60 ≈ Q / (π·f) · ln(1000)/ln(e) — near enough
          t60: Math.max(0.05, (ctx.params.bodyQ * 2.2) / (Math.PI * ctx.params.bodyHz)),
        },
        kappa: kappa(),
        bow: ctx.params.bow,
        // Measured, not guessed: 0.485 pre-limiter at the default level, 0.807
        // in the hottest configuration I could find, 0.647 bowed.
        gain: 0.34 + ctx.params.level * 0.28,
      })
    }
    sendBody()
    for (const k of ['bodyHz', 'bodyQ', 'couple', 'bow', 'level'] as const) ctx.onParam(k, sendBody)
    for (const k of ['modes', 'ring'] as const) ctx.onParam(k, () => retune(current))

    const restart = () => {
      step = 0
      node.port.postMessage({ type: 'panic' })
    }
    ctx.onPress('again', restart)
    ctx.cleanup(ctx.clock.onStateChange(() => !ctx.clock.running && restart()))

    // Re-seeded on change rather than read once at setup, so the param does
    // what it says without a remount. It varies pluck strength only — the
    // sketch is otherwise deterministic, which is what makes the frequency
    // measurements reproduce to the digit.
    let r = rng(Math.round(ctx.params.seed))
    ctx.onParam('seed', (v) => (r = rng(Math.round(v))))
    retune(Math.round(ctx.params.low))

    ctx.clock.onStep((e) => {
      const every = Math.max(1, Math.round(ctx.params.every))
      if (e.step % every !== 0) return
      const span = Math.round(ctx.params.span)
      const midi = Math.round(ctx.params.low) + (step % (span + 1))
      step++
      retune(midi)
      const wait = Math.max(0, (e.time - ctx.audio.currentTime) * 1000)
      const t = setTimeout(() => {
        node.port.postMessage({ pluck: 0.55 + r.next() * 0.15 })
      }, wait)
      ctx.cleanup(() => clearTimeout(t))
    })

    // -- what the ear is up against -------------------------------------------

    const spec = ctx.audio.createAnalyser()
    spec.fftSize = 16384
    spec.smoothingTimeConstant = 0.5
    node.connect(spec)
    const bins = new Float32Array(spec.frequencyBinCount)
    ctx.cleanup(() => spec.disconnect())

    const trail: { s: number; b: number }[] = []

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 42
      const top = 20
      const fb = ctx.params.bodyHz
      const k = kappa()
      const lo = Math.round(ctx.params.low)
      const span = Math.round(ctx.params.span)

      // -- the avoided crossing, drawn across the scale -------------------------
      const plotH = Math.max(120, h * 0.5)
      const fLo = mtof(lo) * 0.82
      const fHi = mtof(lo + span) * 1.18
      const sx = (i: number) => pad + (i / span) * (w - pad - 18)
      const sy = (f: number) =>
        top + plotH - ((Math.log(clamp(f, fLo, fHi)) - Math.log(fLo)) / Math.log(fHi / fLo)) * plotH

      // the body resonance, flat across the plot
      g.strokeStyle = 'rgba(248,113,113,0.5)'
      g.setLineDash([4, 4])
      g.beginPath()
      g.moveTo(pad, sy(fb))
      g.lineTo(w - 18, sy(fb))
      g.stroke()
      g.setLineDash([])
      g.font = '9px ui-monospace, monospace'
      g.fillStyle = 'rgba(248,113,113,0.7)'
      g.fillText(`body ${fb.toFixed(1)} Hz`, pad + 3, sy(fb) - 4)

      // the uncoupled string — the line the note would follow with no body
      g.strokeStyle = 'rgba(255,255,255,0.18)'
      g.setLineDash([2, 3])
      g.beginPath()
      for (let i = 0; i <= span; i++) {
        const f = mtof(lo + i)
        i === 0 ? g.moveTo(sx(i), sy(f)) : g.lineTo(sx(i), sy(f))
      }
      g.stroke()
      g.setLineDash([])

      // the two normal modes — they bend away from each other
      for (const which of [0, 1] as const) {
        g.strokeStyle = which === 0 ? 'rgba(125,211,252,0.95)' : 'rgba(251,191,36,0.95)'
        g.lineWidth = 1.8
        g.beginPath()
        for (let i = 0; i <= span * 4; i++) {
          const midi = lo + i / 4
          const f = normalModes(mtof(midi), fb, k)[which]
          const x = sx(i / 4)
          const y = sy(f)
          i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
        }
        g.stroke()
      }

      // where we are now
      const here = current - lo
      g.strokeStyle = 'rgba(255,255,255,0.5)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(sx(here), top)
      g.lineTo(sx(here), top + plotH)
      g.stroke()
      const [f1, f2] = normalModes(mtof(current), fb, k)
      for (const [f, col] of [
        [f1, 'rgba(125,211,252,1)'],
        [f2, 'rgba(251,191,36,1)'],
      ] as const) {
        g.fillStyle = col
        g.beginPath()
        g.arc(sx(here), sy(f), 4, 0, Math.PI * 2)
        g.fill()
      }
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.font = '9px ui-monospace, monospace'
      g.fillText('the two normal modes — they bend apart rather than cross', pad, top - 6)

      // -- the sloshing ---------------------------------------------------------
      const eTop = top + plotH + 30
      const eH = Math.max(50, h - eTop - 62)
      trail.push({ s: reported.eString, b: reported.eBody * 4.8 })
      if (trail.length > 420) trail.shift()
      g.fillStyle = 'rgba(255,255,255,0.03)'
      g.fillRect(pad, eTop, w - pad - 18, eH)
      const mx = Math.max(1e-12, ...trail.map((t) => t.s + t.b))
      for (const [key, col] of [
        ['s', 'rgba(125,211,252,0.8)'],
        ['b', 'rgba(248,113,113,0.8)'],
      ] as const) {
        g.strokeStyle = col
        g.lineWidth = 1.3
        g.beginPath()
        trail.forEach((t, i) => {
          const x = pad + (i / Math.max(1, trail.length - 1)) * (w - pad - 18)
          const y = eTop + eH - (t[key] / mx) * eH * 0.94
          i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
        })
        g.stroke()
      }
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.font = '9px ui-monospace, monospace'
      g.fillText('energy: string (blue) against body (red) — at the wolf it sloshes', pad, eTop - 5)

      // -- the numbers ----------------------------------------------------------
      const beat = Math.abs(f2 - f1)
      const detune = Math.abs(mtof(current) - fb)
      const atWolf = detune < mtof(current) * 0.03
      g.font = '11px ui-monospace, monospace'
      g.fillStyle = atWolf && ctx.params.couple > 0 ? 'rgba(251,191,36,0.95)' : 'rgba(255,255,255,0.7)'
      g.fillText(
        `${noteName(current)} ${mtof(current).toFixed(1)} Hz  ·  normal modes ` +
          `${f1.toFixed(2)} and ${f2.toFixed(2)}  ·  ${beat.toFixed(2)} Hz apart` +
          (atWolf && ctx.params.couple > 0 ? '   ← the wolf' : ''),
        pad,
        h - 26,
      )
      // The closest the two modes ever come, which is at the resonance itself
      // and is a property of the coupling alone — not of the note being played.
      // The line used to print the *current* separation and call it the closest
      // approach, which is only true at one note out of thirteen.
      const wb = (2 * Math.PI * fb) ** 2
      const floor = (Math.sqrt(wb + 2 * k) - Math.sqrt(wb)) / (2 * Math.PI)
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.4)'
      g.fillText(
        ctx.params.couple > 0
          ? `they never meet: ${beat.toFixed(2)} Hz apart here, and they close no further than ` +
            `${floor.toFixed(2)} Hz at the resonance — that gap is the beat you hear`
          : 'coupling 0 — the modes cross freely and there is no wolf at all',
        pad,
        h - 12,
      )

      // spectrum strip along the bottom
      spec.getFloatFrequencyData(bins)
      const sr = ctx.audio.sampleRate
      const bw = sr / spec.fftSize
      g.strokeStyle = 'rgba(255,255,255,0.22)'
      g.lineWidth = 1
      g.beginPath()
      for (let i = 1; i < bins.length; i++) {
        const hz = i * bw
        if (hz > fHi * 1.6) break
        const x = pad + (Math.log(Math.max(hz, fLo)) - Math.log(fLo)) / Math.log((fHi * 1.6) / fLo) * (w - pad - 18)
        const y = h - 2 - clamp((bins[i] + 96) / 96, 0, 1) * 26
        i === 1 ? g.moveTo(x, y) : g.lineTo(x, y)
      }
      g.stroke()
    })

    const wnd = window as unknown as Record<string, unknown>
    wnd.__wolf = () => ({
      midi: current,
      stringHz: mtof(current),
      bodyHz: ctx.params.bodyHz,
      kappa: kappa(),
      couple: ctx.params.couple,
      predicted: normalModes(mtof(current), ctx.params.bodyHz, kappa()),
      eString: reported.eString,
      eBody: reported.eBody,
      raw: reported.raw,
      rawMax,
      resetRaw: () => (rawMax = 0),
      setNote: (midi: number) => retune(midi),
      pluck: () => node.port.postMessage({ pluck: 0.6 }),
    })
    ctx.cleanup(() => delete wnd.__wolf)

    ctx.status('the wolf is an avoided crossing — coupling 0 is the control, and it cures it')
  },
})
