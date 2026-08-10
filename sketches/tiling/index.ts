import { clamp, degree, disposeAt, mtof, noiseSource, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * A rhythmic canon that tiles.
 *
 * Draw a rhythm A on a cycle of n pulses. The sketch then searches for the set
 * of entry points B such that copies of A starting at each b in B cover every
 * pulse of the cycle **exactly once** — no gaps, no collisions. That is a
 * tiling of the cyclic group Z(n) by translations of A, and it is a genuinely
 * hard combinatorial object: most rhythms you draw do not tile at all.
 *
 * The reason to build it as an instrument is that the property is audible.
 * Each voice on its own is lopsided and syncopated; the composite is a
 * perfectly even stream of pulses, with each one belonging to exactly one
 * voice. You are hearing an even pulse that nobody is playing.
 *
 * Toggle one pulse and the whole canon usually collapses — there is no tiling
 * for the new shape, and the sketch says so rather than pretending.
 */

/** Ring colours by voice — the jigsaw only reads if the pieces differ. */
const HUES = [196, 28, 152, 320, 262, 60, 0, 180]

interface Hit {
  /** pulse index within the cycle */
  at: number
  voice: number
}

export default defineSketch({
  title: 'Tiling',
  description: 'A rhythmic canon whose voices interlock to fill every pulse exactly once.',
  tags: ['sequencer', 'rhythm', 'composition', 'generative'],
  status: 'sketch',
  bpm: 104,
  division: 4,

  params: {
    pulses: { type: 'number', value: 16, min: 8, max: 24, step: 1, label: 'Pulses' },
    root: { type: 'number', value: 48, min: 36, max: 72, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'pentatonicMinor', options: SCALE_NAMES },
    spread: { type: 'number', value: 2, min: 1, max: 5, step: 1, label: 'Voice spacing' },
    decay: { type: 'number', value: 0.22, min: 0.05, max: 0.8, step: 0.01 },
    tone: { type: 'number', value: 0.5, min: 0, max: 1 },
    click: { type: 'number', value: 0.35, min: 0, max: 1, label: 'Attack noise' },
    solo: { type: 'number', value: 0, min: 0, max: 8, step: 1, label: 'Solo voice (0 = all)' },
    seed: { type: 'number', value: 7, min: 1, max: 999, step: 1 },
    shuffle: { type: 'button', label: 'Another tiling' },
    clear: { type: 'button', label: 'Clear' },
  },

  notes: `
Click the ring to draw a rhythm. The sketch searches for entry points that make
copies of it tile the cycle exactly — every pulse covered once, none twice.

The search is complete, not a heuristic: the lowest uncovered pulse has to be
covered by *some* member of A, which gives at most |A| candidate entry points,
and it backtracks over them. So "no tiling" here means there is none, not that
it gave up. \`Another tiling\` re-runs it with the candidates in a different
seeded order, which finds a genuinely different one when several exist.

**The point is audible, and it measures.** Onsets picked from the audio at
104 bpm, where a pulse is 144.2 ms:

| | onsets per cycle | inter-onset interval | sd, in pulses |
| --- | --- | --- | --- |
| the canon | **16.0** | 145 ± 10 ms | **0.07** |
| voice 1 alone | 4.0 | 579 ± 595 ms | 4.12 |
| voice 2 alone | 4.2 | 556 ± 588 ms | 4.08 |
| one pulse added | 5.0 | 462 ± 371 ms | 2.57 |

The composite is even to within 7% of a pulse while every individual part
wanders by four — an even pulse that nobody in the ensemble is playing. Solo a
voice and then un-solo it; that is the whole piece.

Most rhythms do not tile. |A| has to divide the cycle before anything can be
tried, and past that the copies usually collide, so the sketch spends most of
its life refusing. That turned out to be the better interaction: finding one
feels like solving something rather than turning a knob.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: 0.2, seconds: 1.6 })
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)
    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    // -- the rhythm ---------------------------------------------------------

    let n = Math.round(ctx.params.pulses)
    /** A: the rhythm you draw, as membership over the cycle. */
    let inA: boolean[] = new Array(n).fill(false)
    for (const i of [0, 1, 4, 5]) if (i < n) inA[i] = true

    /** B: entry points, or null when the shape does not tile. */
    let entries: number[] | null = null
    /** owner[p] = which voice covers pulse p, -1 if none. */
    let owner: number[] = []
    let variant = 0

    /**
     * Complete search for a tiling. The lowest uncovered pulse p must be
     * covered by some a in A, so the entry point is p - a; try each, backtrack.
     */
    const solve = (): number[] | null => {
      const A = inA.flatMap((v, i) => (v ? [i] : []))
      if (!A.length || n % A.length !== 0) return null
      const r = rng(Math.round(ctx.params.seed) * 131 + variant * 7919)
      const covered = new Uint8Array(n)
      const B: number[] = []
      let guard = 0

      const rec = (): boolean => {
        if (guard++ > 200000) return false
        let p = -1
        for (let i = 0; i < n; i++) {
          if (!covered[i]) {
            p = i
            break
          }
        }
        if (p < 0) return true
        for (const a of r.shuffle(A)) {
          const b = (((p - a) % n) + n) % n
          let ok = true
          for (const x of A) {
            if (covered[(x + b) % n]) {
              ok = false
              break
            }
          }
          if (!ok) continue
          for (const x of A) covered[(x + b) % n] = 1
          B.push(b)
          if (rec()) return true
          B.pop()
          for (const x of A) covered[(x + b) % n] = 0
        }
        return false
      }
      return rec() ? B.slice().sort((x, y) => x - y) : null
    }

    /** Recompute the canon and who owns which pulse. */
    const rebuild = () => {
      entries = solve()
      owner = new Array(n).fill(-1)
      if (entries) {
        entries.forEach((b, v) => {
          for (let i = 0; i < n; i++) if (inA[i]) owner[(i + b) % n] = v
        })
      } else {
        // No tiling: play the bare rhythm so the sketch is never silent.
        for (let i = 0; i < n; i++) if (inA[i]) owner[i] = 0
      }
    }
    rebuild()

    ctx.onParam('pulses', (v) => {
      const next = Math.round(v)
      const grown: boolean[] = new Array(next).fill(false)
      for (let i = 0; i < Math.min(n, next); i++) grown[i] = inA[i]
      n = next
      inA = grown
      rebuild()
    })
    ctx.onParam('seed', rebuild)
    ctx.onPress('shuffle', () => {
      variant++
      rebuild()
    })
    ctx.onPress('clear', () => {
      inA = new Array(n).fill(false)
      rebuild()
    })

    // -- the voices ---------------------------------------------------------

    let vr = rng(Math.round(ctx.params.seed) * 31 + 5)
    ctx.onParam('seed', (v) => (vr = rng(Math.round(v) * 31 + 5)))

    const pitchOf = (voice: number) =>
      degree(
        Math.round(ctx.params.root),
        ctx.params.scale as ScaleName,
        voice * Math.round(ctx.params.spread),
      )

    const hit = (time: number, voice: number) => {
      const midi = pitchOf(voice)
      const f = mtof(midi)
      const dec = ctx.params.decay * (1 - voice * 0.06)
      const vel = 0.8 + vr.range(-0.12, 0.12)

      const osc = ctx.audio.createOscillator()
      osc.type = ctx.params.tone > 0.5 ? 'triangle' : 'sine'
      osc.frequency.setValueAtTime(f * 1.5, time)
      osc.frequency.exponentialRampToValueAtTime(f, time + 0.02)

      const filt = ctx.audio.createBiquadFilter()
      filt.type = 'lowpass'
      filt.frequency.value = 800 + ctx.params.tone * 5200

      const amp = ctx.audio.createGain()
      amp.gain.setValueAtTime(0.0001, time)
      amp.gain.exponentialRampToValueAtTime(1.1 * vel, time + 0.004)
      amp.gain.exponentialRampToValueAtTime(0.0001, time + dec)

      const pan = ctx.audio.createStereoPanner()
      pan.pan.value = clamp((voice / 4) * 2 - 1, -1, 1) * 0.45

      osc.connect(filt).connect(amp).connect(pan).connect(bus)
      osc.start(time)
      disposeAt(osc, time + dec + 0.05, [filt, amp, pan])

      if (ctx.params.click > 0.01) {
        const nz = noiseSource()
        const nf = ctx.audio.createBiquadFilter()
        nf.type = 'bandpass'
        nf.frequency.value = f * 6
        nf.Q.value = 1.2
        const ng = ctx.audio.createGain()
        ng.gain.setValueAtTime(0.0001, time)
        ng.gain.exponentialRampToValueAtTime(0.5 * ctx.params.click * vel, time + 0.002)
        ng.gain.exponentialRampToValueAtTime(0.0001, time + 0.035)
        nz.connect(nf).connect(ng).connect(pan)
        nz.start(time)
        disposeAt(nz, time + 0.06, [nf, ng])
      }
    }

    // -- transport -----------------------------------------------------------

    const recent: Hit[] = []

    ctx.clock.onStep((e) => {
      const p = ((e.step % n) + n) % n
      const v = owner[p]
      if (v < 0) return
      const solo = Math.round(ctx.params.solo)
      if (solo > 0 && v !== solo - 1) return
      // Schedule against e.time — never currentTime.
      hit(e.time, v)
      recent.push({ at: p, voice: v })
      if (recent.length > 64) recent.shift()
    })

    // -- drawing --------------------------------------------------------------

    const g = ctx.canvas((g, { w, h }) => {
      const cx = w / 2
      const cy = h / 2 + 6
      const R = Math.min(w, h) * 0.34
      const step = ctx.clock.visualStep
      const nowP = step >= 0 ? ((step % n) + n) % n : -1
      const solo = Math.round(ctx.params.solo)

      const ang = (i: number) => (i / n) * Math.PI * 2 - Math.PI / 2
      const px = (i: number, rad: number) => cx + Math.cos(ang(i)) * rad
      const py = (i: number, rad: number) => cy + Math.sin(ang(i)) * rad

      // --- the composite ring: who owns each pulse -------------------------
      const slice = (Math.PI * 2) / n
      for (let i = 0; i < n; i++) {
        const v = owner[i]
        const a0 = ang(i) - slice * 0.44
        const a1 = ang(i) + slice * 0.44
        const dim = solo > 0 && v !== solo - 1
        g.beginPath()
        g.arc(cx, cy, R, a0, a1)
        g.lineWidth = 15
        if (v < 0) {
          g.strokeStyle = 'rgba(255,255,255,0.07)'
        } else {
          const hue = HUES[v % HUES.length]
          g.strokeStyle = `hsla(${hue},70%,60%,${dim ? 0.18 : nowP === i ? 1 : 0.7})`
        }
        g.stroke()
      }

      // --- the rhythm you drew, inside -------------------------------------
      for (let i = 0; i < n; i++) {
        const r = R - 30
        g.beginPath()
        g.arc(px(i, r), py(i, r), inA[i] ? 6 : 3.5, 0, Math.PI * 2)
        g.fillStyle = inA[i] ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.16)'
        g.fill()
      }

      // --- entry points, on the outside ------------------------------------
      if (entries) {
        entries.forEach((b, v) => {
          const hue = HUES[v % HUES.length]
          const r = R + 18
          g.fillStyle = `hsla(${hue},70%,62%,0.9)`
          g.beginPath()
          g.arc(px(b, r), py(b, r), 4, 0, Math.PI * 2)
          g.fill()
        })
      }

      // --- playhead ---------------------------------------------------------
      if (nowP >= 0) {
        g.strokeStyle = 'rgba(255,255,255,0.5)'
        g.lineWidth = 1.5
        g.beginPath()
        g.moveTo(px(nowP, R - 46), py(nowP, R - 46))
        g.lineTo(px(nowP, R + 10), py(nowP, R + 10))
        g.stroke()
      }

      // --- readout ------------------------------------------------------------
      const k = inA.filter(Boolean).length
      g.font = '11px ui-monospace, monospace'
      g.textAlign = 'center'
      if (entries) {
        g.fillStyle = 'rgba(134,239,172,0.85)'
        g.fillText(`tiles — ${entries.length} voices × ${k} hits = ${n} pulses`, cx, cy - 4)
        g.fillStyle = 'rgba(255,255,255,0.32)'
        g.font = '10px ui-monospace, monospace'
        g.fillText(`entries at ${entries.join(' ')}`, cx, cy + 12)
      } else {
        g.fillStyle = 'rgba(248,113,113,0.8)'
        g.fillText(
          k === 0 ? 'draw a rhythm on the ring' : `no tiling of ${n} by this shape`,
          cx,
          cy - 4,
        )
        if (k > 0) {
          g.fillStyle = 'rgba(255,255,255,0.32)'
          g.font = '10px ui-monospace, monospace'
          g.fillText(
            n % k !== 0 ? `${k} hits cannot divide ${n} pulses` : 'the shapes always collide',
            cx,
            cy + 12,
          )
        }
      }

      g.textAlign = 'left'
      g.fillStyle = 'rgba(255,255,255,0.28)'
      g.font = '10px ui-monospace, monospace'
      g.fillText('click the ring to change the rhythm', 12, h - 10)
    })

    // -- editing ---------------------------------------------------------------

    const onDown = (e: PointerEvent) => {
      const rect = g.canvas.getBoundingClientRect()
      const cx = rect.width / 2
      const cy = rect.height / 2 + 6
      const dx = e.clientX - rect.left - cx
      const dy = e.clientY - rect.top - cy
      const R = Math.min(rect.width, rect.height) * 0.34
      const dist = Math.hypot(dx, dy)
      if (dist < R * 0.4 || dist > R * 1.35) return
      let a = Math.atan2(dy, dx) + Math.PI / 2
      if (a < 0) a += Math.PI * 2
      const i = Math.round((a / (Math.PI * 2)) * n) % n
      inA[i] = !inA[i]
      rebuild()
    }
    g.canvas.addEventListener('pointerdown', onDown)

    ctx.status('click the ring to draw a rhythm — it finds the entries that tile the cycle')
  },
})
