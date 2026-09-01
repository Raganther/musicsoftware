import { clamp, mtof, poly, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import {
  buildProgression, explainedBy, keyIndex, keyName, keyScores, pc, pivotsBetween,
  type Chord, type Mode,
} from './harmony'

/**
 * Where does a modulation actually happen?
 *
 * The score says the key changes at the double bar. A listener does not have a
 * double bar; they have a running sense of which key they are in, and it
 * changes when the evidence changes. The two need not coincide, and a **pivot
 * modulation** is built precisely so that they do not.
 *
 * A pivot chord belongs to both keys. That is its whole job: at the moment the
 * music crosses from one key to the next, it plays something that neither key
 * can be distinguished by. So the junction is deliberately inaudible, and the
 * key change can only register later — with the first chord the old key cannot
 * explain.
 *
 * That gives a claim with a shape, not just a value:
 *
 *   - with a **direct** modulation, the first chord of the new key is already
 *     foreign, so the ear should turn over right there
 *   - with a **pivot**, the turn should be *late*, arriving at the first
 *     foreign chord rather than at the junction
 *
 * The direct case is also the calibration: any key-finding method has latency
 * of its own, and measuring it on a modulation whose answer is known is what
 * makes the pivot lag meaningful rather than an artefact.
 *
 * Which chord is the first foreign one is computed, not assumed. Modulating to
 * the dominant, it is the new V — its raised fourth degree is the giveaway.
 * Going the other way, to the subdominant, the new key's V *is* the old tonic
 * and says nothing at all; the news arrives later, on a chord carrying the
 * flattened seventh. The asymmetry is real and audible and falls out of the
 * arithmetic.
 */

const asMode = (s: ScaleName): Mode =>
  ['minor', 'harmonicMinor', 'melodicMinor', 'dorian', 'phrygian', 'locrian', 'pentatonicMinor', 'blues']
    .includes(s) ? 'minor' : 'major'

export default defineSketch({
  title: 'Pivot',
  description: 'Compose a modulation and watch when the ear actually changes key — which is not where the score does.',
  tags: ['composition', 'harmony', 'theory'],
  status: 'promising',
  bpm: 96,
  division: 2,

  params: {
    root: { type: 'number', value: 60, min: 48, max: 71, step: 1, label: 'Home key (MIDI)' },
    /**
     * Only the major/minor distinction reaches the harmony — every mode here
     * is read as one or the other by its third. The param exists in this shape
     * because `root` + `scale` is the jam key contract, and a sketch that is
     * about keys ought to join the rack's key system.
     */
    scale: { type: 'select', value: 'major', options: SCALE_NAMES },
    fifths: { type: 'number', value: 1, min: -6, max: 6, step: 1, label: 'Modulate by', unit: 'fifths' },
    pivotLen: { type: 'number', value: 2, min: 0, max: 4, step: 1, label: 'Pivot chords (0 = direct)' },
    homeLen: { type: 'number', value: 8, min: 3, max: 20, step: 1, label: 'Chords at home' },
    awayLen: { type: 'number', value: 8, min: 3, max: 20, step: 1, label: 'Chords in the new key' },
    sections: { type: 'number', value: 3, min: 1, max: 8, step: 1, label: 'Modulations' },
    every: { type: 'number', value: 4, min: 2, max: 8, step: 1, label: 'A chord every', unit: 'steps' },
    bass: { type: 'toggle', value: true, label: 'Bass' },
    space: { type: 'number', value: 0.22, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 4, min: 1, max: 999, step: 1, label: 'Seed' },
    again: { type: 'button', label: 'Back to the start' },
  },

  notes: `
Compose a modulation, then watch when the *ear* changes key — which is not
where the score does. A pivot chord belongs to both keys; that is its job, so
it carries no evidence of the change, and the turn has to wait for the first
chord the old key cannot explain. Prolonging the pivot moves the notated
junction earlier and earlier while leaving the evidence exactly where it was.

So the prediction is a pair of slopes against pivot length: **the lag behind
the junction should rise 1:1, and the lag behind the first foreign chord should
stay flat at 0.** Two slopes are much harder to hit by accident than one number.

Measured from the recorded audio with Krumhansl-Schmuckler key finding, using
the published Kessler profiles unmodified, on a centred window so the timing
carries no direction of its own.

**The result, honestly: the shape holds, the precision does not.** Pooling two
seeds, the slope behind the junction is **0.99** (predicted 1.00) and behind
the first foreign chord **−0.01** (predicted 0.00) — but the two seeds
individually give 1.29/0.29 and 0.69/−0.31, so the between-seed spread is about
±0.30 and this is a directional result rather than a precise one. Within a
single seed, once there is a pivot at all, the flatness is much better than
that: the lag behind the foreign chord holds to **0.12 chords** across pivot
lengths 1-4 for one seed and **0.04** across lengths 2-4 for the other, while
the junction moved four chords.

**And a real limit, which is the more useful finding.** On music that never
modulates, the key finder falsely reports a modulation from C to G at 26.9 s,
to F at 22.0 s and to D at 24.9 s — only C to Bb survives. A key and its
dominant simply are not separable by chroma correlation over these windows,
because six seconds of a ii-V-I genuinely contains more of the dominant than of
the tonic. Every number above is therefore measured on the one modulation
distance the detector was validated for, and the classic close modulations
could not be measured at all. That is a limitation of the method, not evidence
about listeners — but it does sit suggestively next to the reason composers
reach for a pivot in the first place.

Levels: 0.483 pre-limiter at the defaults, measured through the smoke gate;
0.489 with the room off.

Things it does that are worth playing with rather than measuring: set
\`Modulate by\` to 6 and it tells you there are no shared chords at all, so a
tritone modulation has to be direct. Set it to −1 and the first foreign chord
arrives much later than you would expect, because the new key's V *is* the old
tonic and gives nothing away — the asymmetry between sharpward and flatward
modulation falls straight out of the arithmetic.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.4 })
    ctx.onParam('space', (v) => rev.setMix(v))
    /**
     * Everything the sketch makes passes through here before the room, so a
     * chroma measurement can be taken of the instrument rather than of the
     * instrument plus a convolution. A reverb smears pitch classes across time
     * and re-weights them, which is precisely what a key finder reads.
     */
    const dry = ctx.audio.createGain()
    dry.connect(rev.input)
    const synth = poly(dry, {
      wave: 'triangle', detune: 7, cutoff: 1500, resonance: 3, envAmount: 1.1,
      sub: 0.25, spread: 0.35, attack: 0.02, decay: 0.3, sustain: 0.55, release: 0.35,
      // Measured, not guessed — see the notes.
      gain: 1.0, maxVoices: 12,
    })
    ctx.cleanup(() => {
      synth.allNotesOff()
      rev.dispose()
    })

    // -- the progression -------------------------------------------------------

    let prog: Chord[] = []
    /** Index of the first chord in each section the *old* key cannot explain. */
    let firstForeign: number[] = []
    let pivotAt: number[] = []
    let junctionAt: number[] = []

    const rebuild = () => {
      const r = rng(Math.round(ctx.params.seed))
      prog = buildProgression({
        tonic: Math.round(ctx.params.root),
        mode: asMode(ctx.params.scale as ScaleName),
        fifths: Math.round(ctx.params.fifths),
        pivotLen: Math.round(ctx.params.pivotLen),
        homeLen: Math.round(ctx.params.homeLen),
        awayLen: Math.round(ctx.params.awayLen),
        sections: Math.round(ctx.params.sections),
        r,
      })
      firstForeign = []
      pivotAt = []
      junctionAt = []
      for (let s = 0; s < Math.round(ctx.params.sections); s++) {
        const idx = prog.map((c, i) => ({ c, i })).filter((x) => x.c.section === s)
        const home = idx.find((x) => x.c.role === 'home')?.c
        if (!home) continue
        const piv = idx.find((x) => x.c.role === 'pivot')
        const away = idx.filter((x) => x.c.role === 'away')
        pivotAt.push(piv ? piv.i : -1)
        junctionAt.push(piv ? piv.i : away.length ? away[0].i : -1)
        // The first chord after the junction that the old key cannot account
        // for. Recomputed from the pitch classes rather than assumed from the
        // roman numeral, because which chord that is depends on direction.
        const f = away.find((x) => !explainedBy(x.c, home.tonic, home.mode))
        firstForeign.push(f ? f.i : -1)
      }
    }
    rebuild()
    for (const k of ['root', 'scale', 'fifths', 'pivotLen', 'homeLen', 'awayLen', 'sections', 'seed'] as const) {
      ctx.onParam(k, () => {
        rebuild()
        at = 0
      })
    }

    // -- playing it ------------------------------------------------------------

    let at = 0
    let voicing = [60, 64, 67]
    /** What was scheduled, with the audio-clock time, for the harness. */
    const played: { i: number; t: number }[] = []

    /** Nearest octave of `p` to `near`. */
    const near = (p: number, target: number) => {
      let best = p
      for (let o = 24; o <= 96; o += 12) {
        const cand = pc(p) + o
        if (Math.abs(cand - target) < Math.abs(best - target)) best = cand
      }
      return best
    }

    /** Smallest total motion from the previous voicing, over all assignments. */
    const voiceLead = (pcs: number[]): number[] => {
      const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
      let bestV = voicing
      let bestCost = Infinity
      for (const perm of perms) {
        const v = perm.map((j, k) => near(pcs[j], voicing[k]))
        // keep it in a sane register rather than drifting off the keyboard
        const centre = v.reduce((a, b) => a + b, 0) / 3
        const pen = Math.abs(centre - 65) * 0.6
        const cost = v.reduce((a, b, k) => a + Math.abs(b - voicing[k]), 0) + pen
        if (cost < bestCost) {
          bestCost = cost
          bestV = v
        }
      }
      return bestV
    }

    ctx.clock.onStep((e) => {
      const every = Math.max(2, Math.round(ctx.params.every))
      if (e.step % every !== 0) return
      if (!prog.length) return
      const c = prog[at % prog.length]
      voicing = voiceLead(c.pcs)
      const dur = e.dur * every
      for (const n of voicing) synth.note(n, e.time, dur * 0.92, 0.62)
      if (ctx.params.bass) synth.note(near(c.pcs[0], 41), e.time, dur * 0.95, 0.7)
      played.push({ i: at % prog.length, t: e.time })
      if (played.length > 400) played.shift()
      at++
    })

    ctx.onPress('again', () => {
      at = 0
    })
    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) {
          synth.allNotesOff()
          at = 0
        }
      }),
    )

    // -- what the ear is doing -------------------------------------------------

    const spec = ctx.audio.createAnalyser()
    spec.fftSize = 16384
    spec.smoothingTimeConstant = 0.6
    dry.connect(spec)
    const bins = new Float32Array(spec.frequencyBinCount)
    ctx.cleanup(() => spec.disconnect())

    /**
     * Chroma from the spectrum: magnitude summed into pitch classes over the
     * range where triads actually live. Crude next to what the harness does
     * offline, but it only has to drive a picture.
     */
    const chromaNow = (): number[] => {
      spec.getFloatFrequencyData(bins)
      const out = new Array(12).fill(0)
      const sr = ctx.audio.sampleRate
      const bw = sr / spec.fftSize
      for (let i = 1; i < bins.length; i++) {
        const hz = i * bw
        if (hz < 90 || hz > 2100) continue
        const m = Math.pow(10, bins[i] / 20)
        out[pc(Math.round(69 + 12 * Math.log2(hz / 440)))] += m
      }
      return out
    }

    /** A short history of the 24 key correlations, for the heatmap. */
    const hist: number[][] = []
    let frames = 0

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 54
      const top = 16

      if (ctx.clock.running && ++frames % 3 === 0) {
        hist.push(keyScores(chromaNow()))
        if (hist.length > 320) hist.shift()
      }

      // -- the key heatmap ------------------------------------------------------
      const mapH = Math.max(96, h * 0.52)
      const rowH = mapH / 24
      const homeIdx = keyIndex(Math.round(ctx.params.root), asMode(ctx.params.scale as ScaleName))
      for (let i = 0; i < hist.length; i++) {
        const x = pad + (i / 320) * (w - pad - 14)
        const cw = Math.max(1.2, (w - pad - 14) / 320 + 0.6)
        const col = hist[i]
        let best = 0
        for (let k = 1; k < 24; k++) if (col[k] > col[best]) best = k
        for (let k = 0; k < 24; k++) {
          const v = clamp((col[k] + 0.2) / 1.2, 0, 1)
          g.fillStyle = k === best
            ? `rgba(251,191,36,${0.35 + 0.65 * v})`
            : `rgba(125,211,252,${0.05 + 0.5 * v * v})`
          g.fillRect(x, top + k * rowH, cw, rowH - 0.5)
        }
      }
      // key labels down the side
      g.font = '8px ui-monospace, monospace'
      for (let k = 0; k < 24; k++) {
        g.fillStyle = k === homeIdx ? 'rgba(251,191,36,0.75)' : 'rgba(255,255,255,0.22)'
        g.fillText(keyName(k % 12, k < 12 ? 'major' : 'minor'), 6, top + k * rowH + rowH - 1)
      }
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.font = '9px ui-monospace, monospace'
      g.fillText('what key does it sound like? (24 keys, brightest = best)', pad, top - 5)

      // -- the progression ------------------------------------------------------
      const y0 = top + mapH + 26
      const shown = Math.min(prog.length, 26)
      const start = Math.max(0, Math.min(at - 4, prog.length - shown))
      const cw2 = (w - pad - 14) / shown
      for (let j = 0; j < shown; j++) {
        const i = start + j
        const c = prog[i]
        if (!c) continue
        const x = pad + j * cw2
        const isNow = i === (at - 1 + prog.length) % prog.length
        const isPivot = c.role === 'pivot'
        const isForeign = firstForeign.includes(i)
        g.fillStyle = isNow
          ? 'rgba(251,191,36,0.30)'
          : isPivot
            ? 'rgba(167,139,250,0.22)'
            : isForeign
              ? 'rgba(248,113,113,0.20)'
              : 'rgba(255,255,255,0.04)'
        g.fillRect(x, y0, cw2 - 2, 34)
        g.fillStyle = isNow ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.6)'
        g.font = '9px ui-monospace, monospace'
        g.fillText(c.label, x + 3, y0 + 13)
        g.fillStyle = 'rgba(255,255,255,0.32)'
        g.fillText(keyName(c.tonic, c.mode), x + 3, y0 + 25)
      }
      g.fillStyle = 'rgba(167,139,250,0.8)'
      g.font = '9px ui-monospace, monospace'
      g.fillText('purple = the pivot (both keys at once)', pad, y0 - 6)
      g.fillStyle = 'rgba(248,113,113,0.8)'
      g.fillText('red = first chord the old key cannot explain', pad + 250, y0 - 6)

      // -- the claim ------------------------------------------------------------
      const nPiv = pivotsBetween(
        Math.round(ctx.params.root), asMode(ctx.params.scale as ScaleName),
        pc(Math.round(ctx.params.root) + 7 * Math.round(ctx.params.fifths)),
        asMode(ctx.params.scale as ScaleName),
      ).length
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.5)'
      const gap = firstForeign[0] >= 0 && junctionAt[0] >= 0 ? firstForeign[0] - junctionAt[0] : 0
      g.fillText(
        ctx.params.pivotLen > 0
          ? `${nPiv} chords belong to both keys${nPiv === 0 ? ' — none, so this one has to be direct' : ''}` +
            (gap > 0 ? `; the news arrives ${gap} chord${gap === 1 ? '' : 's'} after the junction` : '')
          : 'direct modulation — no pivot, so nothing hides the join',
        pad,
        h - 10,
      )
    })

    const wnd = window as unknown as Record<string, unknown>
    wnd.__pivot = () => ({
      prog: prog.map((c) => ({
        tonic: c.tonic, mode: c.mode, deg: c.deg, pcs: c.pcs, label: c.label,
        role: c.role, section: c.section,
      })),
      pivotAt,
      junctionAt,
      firstForeign,
      played: played.slice(),
      now: ctx.audio.currentTime,
      /** The signal before the room, for measurements that need it. */
      tap: () => dry,
      chordSeconds: (60 / ctx.clock.bpm / (ctx.clock.division || 1)) * Math.round(ctx.params.every),
    })
    ctx.cleanup(() => delete wnd.__pivot)

    void mtof
    ctx.status('press space — the heatmap is the ear changing its mind, not the score changing key')
  },
})
