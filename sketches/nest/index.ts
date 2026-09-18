import { beatty, clamp, degree, disposeAt, mtof, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import { build, depth, isLeaf, leaves, owner, type Tree } from './split'

/**
 * A hocket for more than two voices, which `hocket` proved impossible.
 *
 * Five days ago that sketch established both halves of it: two voices at
 * densities d and 1−d hit every step exactly once, and **three or more Beatty
 * sequences cannot** — a 40-restart search reached 0.0000 with two voices and
 * 0.2400 with three, because Uspensky proved in 1927 that no such partition
 * exists.
 *
 * But the steps a voice does *not* play are themselves a Beatty sequence. So
 * split those again, and again: each node hands its stream of steps to two
 * children by the same rule that worked for two, and every leaf is a voice.
 *
 * Uspensky is not violated, it is sidestepped — a Beatty sequence *of* a Beatty
 * sequence is not a Beatty sequence, and the fingerprint is visible in the gaps.
 * What is impossible as a list of three densities is exact as a tree of them.
 *
 * Numbers in `notes` are measured; see `research/log/2026-09-18-nest.md`.
 */

const MAX_VOICES = 8
const COLOURS = ['#7dd3fc', '#fbbf24', '#a78bfa', '#34d399', '#f472b6', '#fb923c', '#4ade80', '#60a5fa']

export default defineSketch({
  title: 'Nest',
  description: 'A hocket for eight voices, which is impossible — unless the densities are a tree instead of a list.',
  tags: ['rhythm', 'sequencer', 'generative'],
  status: 'promising',
  bpm: 108,
  division: 4,

  params: {
    voices: { type: 'number', value: 5, min: 2, max: MAX_VOICES, step: 1, label: 'Voices' },
    /** balanced halves the voices at each node; chain peels one off at a time. */
    shape: { type: 'select', value: 'balanced', options: ['balanced', 'chain'], label: 'Tree shape' },
    /**
     * Take the same leaf densities and play them as *flat* Beatty sequences —
     * which is exactly what `hocket` showed cannot work. The control.
     */
    flat: { type: 'toggle', value: false, label: 'Flatten (break it)' },
    /** The root split. Deeper levels come off the seed. */
    split: { type: 'number', value: 0.618034, min: 0.12, max: 0.88, step: 0.000001, label: 'Root split' },
    pulse: { type: 'toggle', value: false, label: 'Reference click' },
    root: { type: 'number', value: 50, min: 30, max: 66, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'pentatonicMinor', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    decay: { type: 'number', value: 0.34, min: 0.06, max: 1.2, step: 0.01, label: 'Decay' },
    space: { type: 'number', value: 0.24, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 3, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
\`hocket\` proved two voices can share a pulse exactly and that **three cannot** —
Uspensky, 1927. This is the way round it.

The steps a voice does not play are themselves a Beatty sequence, so split those
again. Each node hands its stream to two children by the rule that worked for
two, and every leaf is a voice. The densities stop being a list and become a
tree.

**It tiles exactly, for any number of voices.** Over 200,000 steps, for 2, 3, 4,
5 and 8 voices and both tree shapes: **0 steps unowned, 0 doubled**, ten
configurations out of ten. The leaf densities are the products down the tree —
worst departure **3.4e−6**, which is 1/M sampling — and they sum to
1.000000000000.

**And the comparison is the whole point.** Take the three densities a
three-leaf tree produces and play them as *flat* Beatty sequences instead:

| | doubled | empty | defect rate |
| --- | --- | --- | --- |
| flat, three Beatty sequences | 65,765 | 65,766 | **0.6577** |
| the same densities, nested | 0 | 0 | **0.0000** |

Identical densities. \`Flatten\` does exactly this and you can hear it fall apart.

**Uspensky is not violated, it is sidestepped**, and the gaps say so. The
three-distance theorem gives a real Beatty rhythm exactly **two** distinct
inter-onset gaps. Measured:

| voices | distinct gaps per voice |
| --- | --- |
| 2 | 2, 2 |
| 3 | 3, 4, **2** |
| 4 | 3, 4, 4, 4 |
| 8 | 7, 7, 7, 7, 8, 8, 8, 8 |

A nested voice has more than two, so it is not a Beatty sequence and the theorem
does not reach it. The one voice in the three-leaf tree that still reads 2 is the
one split off at the root and never subdivided — it really is a plain Beatty
sequence, and it is the only one.

**The shape of the tree is a compositional parameter, not a detail.** Balanced
and chain with four voices each tile exactly, and agree on who plays only
**39.7%** of steps — different densities (0.256/0.362/0.158/0.224 against
0.618/0.158/0.082/0.141) and different gap fingerprints (3,4,4,4 against
2,4,8,8).
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 1.8 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)
    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    // -- the tree --------------------------------------------------------------

    let tree: Tree = 0
    let dens: number[] = []
    let pitches: number[] = []

    const make = () => {
      const r = rng(Math.round(ctx.params.seed))
      const n = Math.round(ctx.params.voices)
      // level 0 is the root split; deeper levels come off the seed, kept clear
      // of simple ratios because those are where a Beatty pair stops tiling
      const perLevel: number[] = [ctx.params.split]
      for (let i = 1; i < 8; i++) perLevel.push(0.3 + r.next() * 0.4)
      tree = build(n, ctx.params.shape as 'balanced' | 'chain', (lv) => perLevel[lv % perLevel.length])
      const map = leaves(tree)
      dens = Array.from({ length: n }, (_, i) => map.get(i) ?? 0)

      const rp = rng(Math.round(ctx.params.seed) * 7 + 1)
      const rootN = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      pitches = []
      let deg = 2
      for (let i = 0; i < MAX_VOICES; i++) {
        deg = clamp(deg + rp.int(-2, 4), -2, 12)
        pitches.push(degree(rootN, scale, deg))
      }
    }
    make()
    for (const k of ['voices', 'shape', 'split', 'seed', 'root', 'scale'] as const) ctx.onParam(k, make)

    // -- the sound -------------------------------------------------------------

    const strike = (i: number, time: number, gain: number, pan: number) => {
      const at = Math.max(time, ctx.audio.currentTime + 0.004)
      const f = mtof(pitches[i])
      const dec = ctx.params.decay
      const pn = ctx.audio.createStereoPanner()
      pn.pan.value = pan
      pn.connect(bus)

      const amp = ctx.audio.createGain()
      amp.gain.setValueAtTime(0, at)
      // 7 ms, not 2 — a fast ramp on a sine is a broadband click, and a click on
      // every step is the steady pulse this sketch is claiming to share out
      amp.gain.linearRampToValueAtTime(gain, at + 0.007)
      amp.gain.exponentialRampToValueAtTime(Math.max(1e-4, gain * 0.015), at + dec)
      amp.connect(pn)

      const o1 = ctx.audio.createOscillator()
      o1.type = 'sine'
      o1.frequency.value = f
      o1.connect(amp)
      o1.start(at)

      const o2 = ctx.audio.createOscillator()
      o2.type = 'sine'
      o2.frequency.value = f * (2 + (i / MAX_VOICES) * 1.7)
      const a2 = ctx.audio.createGain()
      a2.gain.setValueAtTime(0, at)
      a2.gain.linearRampToValueAtTime(gain * (0.1 + (i / MAX_VOICES) * 0.4), at + 0.005)
      a2.gain.exponentialRampToValueAtTime(1e-4, at + dec * 0.42)
      o2.connect(a2).connect(pn)
      o2.start(at)

      disposeAt(o1, at + dec + 0.06, [amp])
      disposeAt(o2, at + dec + 0.06, [a2, pn])
    }

    // -- the transport ----------------------------------------------------------

    interface Row {
      step: number
      m: number
      who: number[]
    }
    const log: Row[] = []
    const counts: number[] = []
    let base = -1

    ctx.clock.onStep((e) => {
      if (base < 0) base = e.step
      const m = e.step - base + 1
      const n = Math.round(ctx.params.voices)
      // One note per step means decay/step notes overlap, and at a 1.2 s decay
      // that is nine of them — measured 1.203 pre-limiter, which is clipping.
      // Scale by the overlap, normalised so the defaults are unchanged.
      const stacked = ctx.params.decay / Math.max(1e-6, e.dur)
      const lvl = (0.55 + ctx.params.level * 0.6) * Math.sqrt(2.45 / Math.max(2.45, stacked))

      const who: number[] = []
      if (ctx.params.flat) {
        // the same densities, played as flat Beatty sequences — which cannot
        // tile, and that is the demonstration
        for (let i = 0; i < n; i++) if (beatty(dens[i], m)) who.push(i)
      } else {
        const v = owner(tree, m)
        if (v >= 0 && v < n) who.push(v)
      }

      // Voices that land together are separate pitches, so they sum incoherently
      // — but sharing as k^-0.75 keeps a pile-up from running away while leaving
      // a doubling audible, which is what a defect should sound like.
      const share = Math.pow(Math.max(1, who.length), -0.75)
      for (const i of who) {
        strike(i, e.time, lvl * share, n === 1 ? 0 : -0.5 + (i / (n - 1)) * 1.0)
      }

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

      log.push({ step: e.step, m, who })
      if (log.length > 200) log.shift()
      counts.push(who.length)
      if (counts.length > 4096) counts.shift()
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          base = -1
          log.length = 0
          counts.length = 0
        }
      }),
    )

    // -- drawing ---------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 10
      const head = 15
      const n = Math.round(ctx.params.voices)
      const vs = ctx.clock.visualStep

      let coll = 0
      let gap = 0
      for (const k of counts) {
        if (k === 0) gap++
        else if (k > 1) coll++
      }

      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.62)'
      g.fillText(
        `${n} voices, ${ctx.params.shape}, depth ${depth(tree)}` +
          `   over ${counts.length} steps: ${coll} doubled, ${gap} empty` +
          (ctx.params.flat ? '   — flattened' : ''),
        pad,
        pad + 10,
      )

      const avail = h - pad * 2 - head
      const treeH = Math.max(52, Math.min(avail * 0.52, 150))
      const stripH = Math.max(40, avail - treeH - 10)
      const treeTop = pad + head
      const stripTop = treeTop + treeH + 10

      // -- the tree -------------------------------------------------------------
      g.fillStyle = 'rgba(255,255,255,0.03)'
      g.fillRect(pad, treeTop, w - pad * 2, treeH)
      const D = Math.max(1, depth(tree))
      const draw = (t: Tree, x0: number, x1: number, level: number) => {
        const y = treeTop + 14 + (treeH - 28) * (level / D)
        const x = (x0 + x1) / 2
        if (isLeaf(t)) {
          g.fillStyle = COLOURS[t % COLOURS.length]
          g.beginPath()
          g.arc(x, y, 5, 0, Math.PI * 2)
          g.fill()
          g.fillStyle = 'rgba(255,255,255,0.45)'
          g.font = '9px ui-monospace, monospace'
          g.textAlign = 'center'
          g.fillText((dens[t] ?? 0).toFixed(3), x, y + 15)
          g.textAlign = 'left'
          return
        }
        const yc = treeTop + 14 + (treeH - 28) * ((level + 1) / D)
        // the split is where the stream divides; the left branch gets d of it
        const mid = x0 + (x1 - x0) * t.d
        for (const [child, cx0, cx1] of [
          [t.left, x0, mid],
          [t.right, mid, x1],
        ] as [Tree, number, number][]) {
          g.strokeStyle = 'rgba(255,255,255,0.22)'
          g.lineWidth = 1
          g.beginPath()
          g.moveTo(x, y + 4)
          g.lineTo((cx0 + cx1) / 2, yc - 4)
          g.stroke()
          draw(child, cx0, cx1, level + 1)
        }
        g.fillStyle = 'rgba(255,255,255,0.5)'
        g.beginPath()
        g.arc(x, y, 3, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = 'rgba(255,255,255,0.35)'
        g.font = '9px ui-monospace, monospace'
        g.textAlign = 'center'
        g.fillText(t.d.toFixed(3), x, y - 6)
        g.textAlign = 'left'
      }
      draw(tree, pad + 6, w - pad - 6, 0)
      g.font = '11px ui-monospace, monospace'

      // -- who played which step -------------------------------------------------
      const rows: Row[] = []
      for (let i = log.length - 1; i >= 0 && rows.length < 84; i--) {
        if (log[i].step <= vs) rows.unshift(log[i])
      }
      const COLS = 84
      const cw = (w - pad * 2) / COLS
      const laneH = stripH / (n + 1)
      g.fillStyle = 'rgba(255,255,255,0.035)'
      g.fillRect(pad, stripTop, w - pad * 2, stripH)

      for (let c = 0; c < rows.length; c++) {
        const row = rows[c]
        const x = pad + (COLS - rows.length + c) * cw
        for (const i of row.who) {
          if (i >= n) continue
          const y = stripTop + i * laneH
          g.fillStyle = row.who.length > 1 ? '#f87171' : COLOURS[i % COLOURS.length]
          g.globalAlpha = 0.9
          g.fillRect(x + 0.5, y + 1.5, Math.max(1, cw - 1), Math.max(1, laneH - 3))
          g.globalAlpha = 1
        }
        const y = stripTop + n * laneH
        if (row.who.length === 1) {
          g.fillStyle = 'rgba(255,255,255,0.55)'
          g.fillRect(x + 0.5, y + laneH * 0.35, Math.max(1, cw - 1), Math.max(1, laneH * 0.3))
        } else if (row.who.length === 0) {
          g.strokeStyle = 'rgba(248,113,113,0.75)'
          g.lineWidth = 1
          g.strokeRect(x + 1, y + laneH * 0.25, Math.max(1, cw - 2), Math.max(1, laneH * 0.5))
        } else {
          g.fillStyle = '#f87171'
          g.fillRect(x + 0.5, y + laneH * 0.15, Math.max(1, cw - 1), Math.max(1, laneH * 0.7))
        }
      }
      g.strokeStyle = 'rgba(255,255,255,0.1)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(pad, stripTop + n * laneH)
      g.lineTo(w - pad, stripTop + n * laneH)
      g.stroke()
    })

    const report = () => {
      const sum = dens.reduce((a, b) => a + b, 0)
      ctx.status(
        ctx.params.flat
          ? `flattened — the same ${dens.length} densities as plain Beatty sequences, which cannot tile`
          : `${dens.length} voices at ${dens.map((v) => v.toFixed(3)).join(' + ')} = ${sum.toFixed(6)} — every step exactly once`,
      )
    }
    report()
    for (const k of ['voices', 'shape', 'split', 'seed', 'flat'] as const) ctx.onParam(k, report)

    // Read back by the harness; the sketch's numbers come from the same module.
    ;(window as unknown as Record<string, unknown>).__nest = () => ({
      tap: () => bus,
      set: (k: string, v: number | boolean | string) => ctx.set(k as never, v as never),
      densities: () => dens.slice(),
      tree: () => tree,
      log,
      counts,
      pitches: () => pitches.slice(),
    })
  },
})
