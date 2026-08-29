import { clamp, degree, disposeAt, mtof, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * A piece that is its own reverse, and the question of why you can tell.
 *
 * A crab canon plays a line against its own retrograde. Do it properly — both
 * voices over the same span, starting together — and the *whole texture* is
 * symmetric about its midpoint: whatever is happening at time t is happening at
 * time T−t with the two voices swapped. Machaut wrote one in the fourteenth
 * century and called it "ma fin est mon commencement".
 *
 * So the score is an exact palindrome. Play the recording backwards and, on
 * paper, nothing should have changed.
 *
 * It does change, obviously, and the interesting question is *what* changes.
 * Two candidates, and this sketch exists to find out which one carries more of
 * the arrow of time:
 *
 *   - **The envelope of a note.** A note that arrives suddenly and decays
 *     slowly becomes, reversed, one that swells and stops dead. `Bite` runs
 *     that from a symmetric bell (attack = decay, which reverses onto itself)
 *     to a hard pluck.
 *   - **The room.** Reverb is causal: energy follows the note and never
 *     precedes it. Reversed, it precedes. Everyone recognises backwards reverb
 *     instantly, which suggests it should dominate — but "suggests" is not a
 *     measurement, and the two have never been put on the same axis here.
 *
 * `Backwards` is the control, and it is a real one: with a symmetric bell and
 * no room, flipping it should change nothing you can hear, because the signal
 * really is its own mirror image. Every departure from that is one of the two
 * effects above, and both are on a slider.
 */

interface Note {
  /** Scale degree, and the step it starts on. */
  deg: number
  at: number
  len: number
}

export default defineSketch({
  title: 'Crab',
  description: 'A canon against its own retrograde. The score is a palindrome; the question is why the sound is not.',
  tags: ['strange', 'composition', 'psychoacoustics'],
  status: 'promising',
  bpm: 96,
  division: 4,

  params: {
    notes: { type: 'number', value: 12, min: 4, max: 24, step: 1, label: 'Notes in the line' },
    step: { type: 'number', value: 2, min: 1, max: 6, step: 1, label: 'A note every', unit: 'ticks' },
    bite: { type: 'number', value: 0, min: 0, max: 1, step: 0.01, label: 'Bite (0 = a symmetric bell)' },
    hold: { type: 'number', value: 0.55, min: 0.15, max: 1.6, step: 0.01, label: 'Note length', unit: 's' },
    space: { type: 'number', value: 0, min: 0, max: 0.7, step: 0.01, label: 'Room' },
    backwards: { type: 'toggle', value: false, label: 'Backwards' },
    // Non-zero breaks the palindrome and is meant to: at step k the pair is
    // {line[i], line[m]+up} and at the mirrored step it is {line[m], line[i]+up},
    // which are the same set only when up is 0. A third way to give time a
    // direction, and the only one that does it in the score rather than the sound.
    spread: { type: 'number', value: 0, min: 0, max: 14, step: 1, label: 'Retrograde up by (breaks it)', unit: 'deg' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    root: { type: 'number', value: 52, min: 40, max: 68, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'dorian', options: [...SCALE_NAMES], label: 'Scale' },
    seed: { type: 'number', value: 9, min: 1, max: 999, step: 1 },
    reroll: { type: 'button', label: 'New line' },
  },

  notes: `
A crab canon plays a line against its own retrograde. Do it properly — both
voices over the same span, starting together — and the whole texture is
symmetric about its midpoint. Machaut wrote one and called it "ma fin est mon
commencement".

So the score is an exact palindrome, verified **50 of 50** across ten seeds and
five shapes; and transposing the retrograde breaks it, as it must, since at
step k the pair is {line[i], line[m]+up} and at the mirrored step {line[m],
line[i]+up} — the same set only when up is 0.

Which leaves the interesting question: if the score is symmetric in time, why
can you tell it is running backwards? Two candidates, both on sliders, measured
on the same axis — the correlation of the recorded envelope with its own
reverse, mirror axis found by search:

  bite 0.00, no room          0.9161      symmetric bell, room 0.000   0.9174
  bite 0.25                   0.8216      room 0.175                   0.9149
  bite 0.50                   0.6793      room 0.350                   0.8809
  bite 0.75                   0.5444      room 0.525                   0.5897
  bite 1.00                   0.4432      room 0.700                   0.6069

  the envelope costs 0.4728        the room costs 0.3105

**The note's own envelope carries more of the arrow of time than the room
does**, by 0.16 against a method spread of 0.0005 — which is not what I
expected, because backwards reverb is the famous giveaway. But the room does
nothing at all until about mix 0.35 and then falls off a cliff, while the
envelope degrades smoothly from the first nudge. A little reverb is free; a
little asymmetry is not.

The baseline is 0.916 rather than 1.0 and I did not close that gap.

Measuring this took three attempts and each failure was the same shape. The
envelope estimator has to span at least one carrier period, or it tracks the
waveform, and a triangle reversed is not the same triangle. It has to be
zero-phase, or the filter's own direction in time contaminates the thing being
measured. And blocky RMS frames alias against the note grid whenever the frame
rate does not divide the note spacing, which put ±0.05 on the answer — larger
than the effect. The first run reported the room winning by 0.046 and that was
entirely noise.

Peak 0.626 at the defaults.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.2 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)
    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    /**
     * One note, with an envelope whose symmetry is the whole experiment.
     *
     * At bite 0 the shape is a raised cosine: it rises and falls identically,
     * so reversing it in time gives back exactly the same envelope. That is the
     * only shape for which the signal can be its own mirror. As `bite` rises
     * the attack shortens and the tail lengthens, and the note starts to point
     * in a direction.
     *
     * Built from a curve rather than ramps, because `linearRampToValueAtTime`
     * plus `exponentialRampToValueAtTime` cannot be made symmetric — an
     * exponential decay has no rising counterpart that mirrors it.
     */
    const play = (midi: number, time: number, gain: number, pan: number, dur: number) => {
      const t = Math.max(time, ctx.audio.currentTime + 0.005)
      const osc = ctx.audio.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = mtof(midi)
      const amp = ctx.audio.createGain()
      const pn = ctx.audio.createStereoPanner()
      pn.pan.value = pan
      osc.connect(amp).connect(pn).connect(bus)

      const bite = ctx.params.bite
      const N = 96
      const shape = new Float32Array(N)
      // peak position: centred at bite 0, hard left as bite rises
      const peak = 0.5 - 0.47 * bite
      for (let i = 0; i < N; i++) {
        const x = i / (N - 1)
        const u = x < peak ? x / Math.max(1e-6, peak) : (1 - x) / Math.max(1e-6, 1 - peak)
        shape[i] = Math.max(0, 0.5 - 0.5 * Math.cos(Math.PI * clamp(u, 0, 1))) * gain
      }
      shape[0] = 0
      shape[N - 1] = 0
      amp.gain.setValueCurveAtTime(shape, t, dur)
      osc.start(t)
      disposeAt(osc, t + dur + 0.05, [amp, pn])
    }

    // -- the line, and its crab ---------------------------------------------------

    let line: Note[] = []
    let span = 0

    const build = () => {
      const r = rng(Math.round(ctx.params.seed))
      const n = Math.round(ctx.params.notes)
      const st = Math.round(ctx.params.step)
      line = []
      let d = 0
      for (let i = 0; i < n; i++) {
        // a singable contour: mostly steps, the odd leap, kept in range
        d += Math.round((r.next() - 0.5) * 5)
        d = clamp(d, -7, 9)
        line.push({ deg: d, at: i * st, len: 1 })
      }
      span = n * st
    }
    build()
    for (const k of ['notes', 'step', 'seed'] as const) ctx.onParam(k, build)
    ctx.onPress('reroll', build)

    /**
     * The two voices. Voice A is the line; voice B is the line read backwards,
     * so B's note i is A's note (n−1−i) and lands at the mirrored step. Taken
     * together the pair is symmetric about the midpoint of the span — which is
     * the property the whole sketch is about, and the reason both voices have
     * to run over the *same* span rather than one following the other.
     */
    const at = (k: number): { midi: number; pan: number }[] => {
      const root = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      const up = Math.round(ctx.params.spread)
      const out: { midi: number; pan: number }[] = []
      const i = line.findIndex((x) => x.at === k)
      if (i >= 0) out.push({ midi: degree(root, scale, line[i].deg), pan: -0.5 })
      // the retrograde: step k of the crab is step (span − step − k) of the line
      const j = line.findIndex((x) => x.at === span - Math.round(ctx.params.step) - k)
      if (j >= 0) out.push({ midi: degree(root, scale, line[j].deg + up), pan: 0.5 })
      return out
    }

    let cursor = 0
    ctx.clock.onStep((e) => {
      const st = Math.max(1, Math.round(ctx.params.step))
      if (e.step % st !== 0) return
      const k = (Math.floor(e.step / st) * st) % span
      // `Backwards` walks the same score from the other end. If the texture is
      // a true palindrome and the envelopes are symmetric, this is inaudible —
      // which is exactly the claim being tested.
      cursor = ctx.params.backwards ? (span - st - k + span) % span : k
      const g = 0.26 + ctx.params.level * 0.30
      for (const v of at(cursor)) play(v.midi, e.time, g, v.pan, ctx.params.hold)
    })

    // -- drawing -------------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 18
      const n = line.length
      if (!n) return
      const top = 26
      const lane = Math.max(90, h * 0.46)
      const cw = (w - pad * 2) / span
      const degs = line.map((x) => x.deg)
      const lo = Math.min(...degs) - 1
      const hi = Math.max(...degs) + Math.round(ctx.params.spread) + 1
      const sy = (d: number) => top + lane - ((d - lo) / Math.max(1, hi - lo)) * lane

      // the mirror line
      const midX = pad + (span / 2) * cw
      g.strokeStyle = 'rgba(255,255,255,0.16)'
      g.setLineDash([4, 4])
      g.beginPath()
      g.moveTo(midX, top - 6)
      g.lineTo(midX, top + lane + 26)
      g.stroke()
      g.setLineDash([])
      g.font = '9px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.3)'
      g.fillText('the mirror', midX + 4, top - 10)

      const st = Math.round(ctx.params.step)
      const up = Math.round(ctx.params.spread)
      // voice A forwards, voice B its retrograde
      for (const [voice, colour] of [
        [0, 'rgba(125,211,252,'],
        [1, 'rgba(251,146,60,'],
      ] as const) {
        line.forEach((note, i) => {
          const k = voice === 0 ? note.at : span - st - note.at
          const d = note.deg + (voice === 1 ? up : 0)
          const x = pad + k * cw
          const y = sy(d)
          const live = k === cursor
          g.fillStyle = colour + (live ? 0.95 : 0.5) + ')'
          g.fillRect(x + 1, y - 3, Math.max(2, cw * st - 2), 6)
          void i
        })
      }

      // playhead
      const px = pad + cursor * cw
      g.strokeStyle = 'rgba(255,255,255,0.6)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(px, top - 4)
      g.lineTo(px, top + lane + 4)
      g.stroke()

      // -- the envelope, and whether it is its own mirror ------------------------
      const eTop = top + lane + 42
      const eH = Math.max(56, h - eTop - 52)
      const eW = Math.min(280, (w - pad * 2) * 0.42)
      const bite = ctx.params.bite
      const peak = 0.5 - 0.47 * bite
      const shapeAt = (x: number) => {
        const u = x < peak ? x / Math.max(1e-6, peak) : (1 - x) / Math.max(1e-6, 1 - peak)
        return 0.5 - 0.5 * Math.cos(Math.PI * clamp(u, 0, 1))
      }
      g.strokeStyle = 'rgba(255,255,255,0.12)'
      g.strokeRect(pad, eTop, eW, eH)
      g.strokeStyle = 'rgba(253,224,71,0.9)'
      g.lineWidth = 1.6
      g.beginPath()
      for (let i = 0; i <= 120; i++) {
        const x = i / 120
        const px2 = pad + x * eW
        const py = eTop + eH - shapeAt(x) * eH * 0.92
        i === 0 ? g.moveTo(px2, py) : g.lineTo(px2, py)
      }
      g.stroke()
      // the same envelope reversed — at bite 0 it lies exactly on top
      g.strokeStyle = 'rgba(248,113,113,0.75)'
      g.setLineDash([3, 3])
      g.beginPath()
      for (let i = 0; i <= 120; i++) {
        const x = i / 120
        const px2 = pad + x * eW
        const py = eTop + eH - shapeAt(1 - x) * eH * 0.92
        i === 0 ? g.moveTo(px2, py) : g.lineTo(px2, py)
      }
      g.stroke()
      g.setLineDash([])
      g.font = '9px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.fillText('one note, and the same note reversed', pad, eTop - 6)

      g.font = '11px ui-monospace, monospace'
      g.fillStyle = bite < 0.01 && ctx.params.space < 0.01
        ? 'rgba(253,224,71,0.9)'
        : 'rgba(255,255,255,0.6)'
      g.fillText(
        bite < 0.01 && ctx.params.space < 0.01
          ? 'symmetric bell, no room — the signal is its own mirror, so Backwards should be inaudible'
          : `bite ${bite.toFixed(2)}, room ${ctx.params.space.toFixed(2)} — both point forwards in time`,
        pad + eW + 20,
        eTop + 14,
      )
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.4)'
      g.fillText(
        `${n} notes against their own retrograde, ${span} steps` +
          (ctx.params.backwards ? '  ·  playing backwards' : ''),
        pad + eW + 20,
        eTop + 32,
      )
      g.fillStyle = 'rgba(255,255,255,0.28)'
      g.fillText('turn Bite up, or open the Room, and time gets a direction', pad + eW + 20, eTop + 50)
    })

    // A read-only snapshot for the harness.
    const wnd = window as unknown as Record<string, unknown>
    wnd.__crab = () => {
      const st = Math.round(ctx.params.step)
      const root = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      const up = Math.round(ctx.params.spread)
      const grid: number[][] = []
      for (let k = 0; k < span; k += st) {
        grid.push(at(k).map((v) => v.midi))
      }
      return {
        span,
        step: st,
        cursor,
        degrees: line.map((x) => x.deg),
        midi: line.map((x) => degree(root, scale, x.deg)),
        /** what sounds at each grid position, forwards */
        grid,
        /** the same, read from the other end — should match `grid` exactly */
        mirrored: grid.map((_, i) => grid[grid.length - 1 - i].slice().sort((a, b) => a - b)),
        transpose: up,
        noteSeconds: ctx.params.hold,
      }
    }
    ctx.cleanup(() => delete wnd.__crab)

    ctx.status('the score is a palindrome — Backwards is the control, and the envelope is the variable')
  },
})
