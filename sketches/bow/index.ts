/**
 * A bowed string, and the diagram of where it will actually speak.
 *
 * Rosin is a stick-slip friction: the string is dragged along by the bow until
 * the restoring force wins, releases, flies back, and is caught again. Done
 * properly the release happens once per period and a corner travels around the
 * string — Helmholtz motion, the thing that makes a violin sound like a violin
 * rather than like a whistle or a scrape.
 *
 * Whether you get it depends on two numbers, and Schelleng worked out the
 * relationship in 1973. Bow too lightly and the string never sticks properly:
 * you get the thin harmonic-ish sound of surface sound. Bow too hard and the
 * release is late and irregular: a crushed, raucous tone. Between them is a
 * wedge, and the wedge narrows sharply as you move toward the bridge, because
 * the minimum force goes as 1/beta^2 where beta is the distance from the bridge
 * as a fraction of the string.
 *
 * That is why playing sul ponticello is hard, and why a beginner near the
 * bridge sounds like a beginner. Here the control surface *is* the diagram:
 * drag left and right for bow position, up and down for force, and you can
 * feel the walls.
 */
import { clamp, loadWorklet, mtof, noteName, quantize, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { keyboard } from '@core/ui/keyboard'
import { defineSketch } from '@runtime/sketch'
import workletUrl from './bow.worklet.js?url'

/** Schelleng's minimum force, up to a constant: F_min ∝ 1/β². */
const minForceCurve = (beta: number) => 0.0016 / (beta * beta)
/** And his maximum, which falls only as 1/β. */
const maxForceCurve = (beta: number) => 0.10 / beta

export default defineSketch({
  title: 'Bow',
  description: 'A bowed string whose control surface is Schelleng\'s playability diagram.',
  tags: ['dsp', 'worklet', 'instrument', 'physical-model'],
  status: 'sketch',
  bpm: 80,

  params: {
    force: { type: 'number', value: 0.25, min: 0.005, max: 1, step: 0.005, label: 'Bow force' },
    beta: { type: 'number', value: 0.12, min: 0.02, max: 0.33, step: 0.005, label: 'Bow position (β)' },
    speed: { type: 'number', value: 0.32, min: 0.05, max: 1, step: 0.01, label: 'Bow speed' },
    bright: { type: 'number', value: 0.5, min: 0.05, max: 0.95, step: 0.01, label: 'String damping' },
    body: { type: 'number', value: 0.45, min: 0, max: 1, label: 'Body' },
    vibrato: { type: 'number', value: 0.12, min: 0, max: 1 },
    root: { type: 'number', value: 55, min: 40, max: 72, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'minor', options: SCALE_NAMES },
    seed: { type: 'number', value: 5, min: 1, max: 999, step: 1 },
  },

  notes: `
A digital waveguide bowed string: two delay lines meeting at the bow, a
friction characteristic at the junction, a lossy inverting reflection at the
bridge and a rigid one at the nut. Everything comes out of that one
nonlinearity in a feedback loop.

**The thing I built it to test is not in it.** Schelleng's law says the minimum
bow force rises as 1/β², so bowing near the bridge needs far more force. I
swept force over 14 values at β = 1/4, 1/8 and 1/16 and looked for the boundary
from the audio. There isn't one: the string is periodic at its own period at
*every* force at *every* position, and the thresholds I did extract were
non-monotonic nonsense (×1.0, ×40, ×0.3 where 1/β² predicts ×1, ×4, ×16).

The reason is a real limitation and worth knowing before building one of these:
**the friction table is memoryless.** It maps instantaneous relative velocity
to a reflection coefficient with no state, so there is no static-versus-dynamic
distinction and nothing to break away from. Schelleng's minimum force comes out
of the hysteresis of rosin — the string sticks and has to be *torn* loose. A
memoryless characteristic reproduces Helmholtz motion happily and the force
boundaries not at all. The wedge is still drawn, labelled as the textbook's,
because it is a useful thing to see; it is not this model's own behaviour.

**What the model does obey is the bow-position comb.** The bow sits on a node
of partial 1/β and removes it, exactly as a tone hole does in \`overblow\`:

| bowing at | partial n, vs its neighbours | every other partial |
| --- | --- | --- |
| 1/3 | **−31.1 dB** | +1.8 dB |
| 1/4 | **−20.1 dB** | +2.3 dB |
| 1/5 | **−21.7 dB** | +0.8 dB |
| 1/6 | **−26.9 dB** | +2.0 dB |
| 1/7 | **−13.9 dB** | +1.1 dB |
| 1/8 | **−13.7 dB** | +0.3 dB |

Six positions, six hits. The notch shallows as n rises because the delay split
is rounded to whole samples, so at 1/8 the bow is not quite on the node. The
right-hand bars are that comb, live.
`,

  async setup(ctx) {
    await loadWorklet(workletUrl)

    const rev = reverb(ctx.out, { mix: 0.24, seconds: 2.0 })
    const node = new AudioWorkletNode(ctx.audio, 'bowed-string', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    })
    const analyser = ctx.audio.createAnalyser()
    analyser.fftSize = 16384
    analyser.smoothingTimeConstant = 0.5
    node.connect(analyser)
    node.connect(rev.input)
    const spec = new Float32Array(analyser.frequencyBinCount)
    ctx.cleanup(() => {
      node.port.postMessage({ type: 'panic' })
      node.disconnect()
      analyser.disconnect()
      rev.dispose()
    })

    let r = rng(Math.round(ctx.params.seed))
    ctx.onParam('seed', (v) => (r = rng(Math.round(v))))

    // -- settings -------------------------------------------------------------

    let heldForce: number | null = null
    let heldBeta: number | null = null

    const send = () => {
      node.port.postMessage({
        force: heldForce ?? ctx.params.force,
        beta: heldBeta ?? ctx.params.beta,
        speed: ctx.params.speed,
        bright: ctx.params.bright,
        body: ctx.params.body,
        vibrato: ctx.params.vibrato,
      })
    }
    send()
    for (const k of ['force', 'beta', 'speed', 'bright', 'body', 'vibrato'] as const) {
      ctx.onParam(k, send)
    }

    // -- playing ---------------------------------------------------------------

    const held: number[] = []
    let sounding = 0
    let bowing = false

    const noteOn = (m: number) => {
      const q = quantize(m, Math.round(ctx.params.root), ctx.params.scale as ScaleName)
      held.push(q)
      sounding = q
      bowing = true
      node.port.postMessage({ freq: mtof(q), bow: true, jitter: r.range(-0.03, 0.03) })
    }
    const noteOff = (m: number) => {
      void m
      held.pop()
      if (held.length) {
        sounding = held[held.length - 1]
        node.port.postMessage({ freq: mtof(sounding) })
      } else {
        bowing = false
        node.port.postMessage({ bow: false })
      }
    }

    const plotWrap = document.createElement('div')
    plotWrap.style.cssText = 'position:relative;height:calc(100% - 118px);min-height:120px;'
    const kbWrap = document.createElement('div')
    kbWrap.style.cssText = 'margin-top:10px;'
    ctx.root.append(plotWrap, kbWrap)
    const kb = keyboard(kbWrap, { low: 48, octaves: 2, onNoteOn: noteOn, onNoteOff: noteOff })
    ctx.cleanup(() => kb.dispose())

    // -- what the worklet reports back ------------------------------------------

    let level = 0
    /** How periodic the string is right now — 1 is clean Helmholtz motion. */
    let regularity = 0
    node.port.onmessage = (e) => {
      level = e.data.peak ?? 0
      regularity = e.data.reg ?? 0
    }
    ctx.cleanup(() => (node.port.onmessage = null))

    // -- the diagram -------------------------------------------------------------

    const B_LO = 0.02
    const B_HI = 0.33
    const F_LO = 0.004
    const F_HI = 1.2

    const g = ctx.canvas((g, { w, h }) => {
      const SPLIT = Math.round(w * 0.56)
      const L = 44
      const R = SPLIT - 26
      const T = 16
      const B = h - 30
      const xOf = (beta: number) =>
        L + (Math.log(clamp(beta, B_LO, B_HI) / B_LO) / Math.log(B_HI / B_LO)) * (R - L)
      const yOf = (f: number) =>
        B - (Math.log(clamp(f, F_LO, F_HI) / F_LO) / Math.log(F_HI / F_LO)) * (B - T)

      // --- the playable wedge --------------------------------------------------
      g.beginPath()
      for (let i = 0; i <= 60; i++) {
        const beta = B_LO * Math.pow(B_HI / B_LO, i / 60)
        const p = { x: xOf(beta), y: yOf(minForceCurve(beta)) }
        i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)
      }
      for (let i = 60; i >= 0; i--) {
        const beta = B_LO * Math.pow(B_HI / B_LO, i / 60)
        g.lineTo(xOf(beta), yOf(maxForceCurve(beta)))
      }
      g.closePath()
      g.fillStyle = 'rgba(125,211,252,0.10)'
      g.fill()
      g.strokeStyle = 'rgba(125,211,252,0.45)'
      g.lineWidth = 1.5
      g.stroke()

      g.font = '9px ui-monospace, monospace'
      g.fillStyle = 'rgba(125,211,252,0.45)'
      g.textAlign = 'left'
      g.fillText("Schelleng's wedge — the textbook,", xOf(0.055), yOf(0.055))
      g.fillText('not this model. See the notes.', xOf(0.055), yOf(0.032))

      // --- axes ------------------------------------------------------------------
      g.strokeStyle = 'rgba(255,255,255,0.1)'
      g.lineWidth = 1
      for (const beta of [0.03, 0.05, 0.08, 0.12, 0.2, 0.33]) {
        g.beginPath()
        g.moveTo(xOf(beta), T)
        g.lineTo(xOf(beta), B)
        g.stroke()
        g.fillStyle = 'rgba(255,255,255,0.28)'
        g.textAlign = 'center'
        g.fillText(`1/${Math.round(1 / beta)}`, xOf(beta), B + 14)
      }
      g.textAlign = 'center'
      g.fillStyle = 'rgba(255,255,255,0.22)'
      g.fillText('β  —  bridge is left, fingerboard is right', (L + R) / 2, B + 26)
      g.save()
      g.translate(12, (T + B) / 2)
      g.rotate(-Math.PI / 2)
      g.fillText('bow force', 0, 0)
      g.restore()

      // --- where the bow is now ----------------------------------------------------
      const bx = xOf(heldBeta ?? ctx.params.beta)
      const by = yOf(heldForce ?? ctx.params.force)
      const lit = clamp(level * 2.2, 0, 1)
      g.beginPath()
      g.arc(bx, by, 6 + lit * 7, 0, Math.PI * 2)
      // green when the string has locked into a period, red when it has not
      const hue = 0 + regularity * 140
      g.fillStyle = `hsla(${hue},70%,60%,${bowing ? 0.35 + lit * 0.5 : 0.18})`
      g.fill()
      g.strokeStyle = `hsla(${hue},75%,68%,${bowing ? 0.95 : 0.35})`
      g.lineWidth = 1.5
      g.stroke()

      // --- the live harmonic comb -------------------------------------------
      // The thing this model actually does: the bow sits on a node of partial
      // 1/β and removes it. Measured at -12 to -34 dB below its neighbours.
      const beta = heldBeta ?? ctx.params.beta
      const force = heldForce ?? ctx.params.force
      const notch = 1 / beta
      analyser.getFloatFrequencyData(spec)
      const binHz = ctx.audio.sampleRate / analyser.fftSize
      const f0 = mtof(sounding || Math.round(ctx.params.root))
      const magAt = (hz: number) => {
        const lo = Math.max(1, Math.floor((hz * 0.97) / binHz))
        const hi = Math.min(spec.length - 1, Math.ceil((hz * 1.03) / binHz))
        let m = -200
        for (let k = lo; k <= hi; k++) if (spec[k] > m) m = spec[k]
        return m
      }
      const HN = 16
      const cl = SPLIT + 16
      const cr = w - 16
      const cw = (cr - cl) / HN
      for (let n = 1; n <= HN; n++) {
        const db = magAt(f0 * n)
        const norm = clamp((db + 96) / 76, 0, 1)
        const bh = norm * (B - T)
        const x = cl + (n - 1) * cw
        const near = Math.abs(n - notch) < 0.5
        g.fillStyle = near
          ? `rgba(248,113,113,${0.3 + norm * 0.6})`
          : `rgba(125,211,252,${0.2 + norm * 0.7})`
        g.fillRect(x + 1.5, B - bh, cw - 3, bh)
        if (n % 2 === 1 || near) {
          g.fillStyle = near ? 'rgba(248,113,113,0.8)' : 'rgba(255,255,255,0.25)'
          g.textAlign = 'center'
          g.font = '9px ui-monospace, monospace'
          g.fillText(String(n), x + cw / 2, B + 14)
        }
      }
      g.textAlign = 'left'
      g.fillStyle = 'rgba(255,255,255,0.28)'
      g.font = '9px ui-monospace, monospace'
      g.fillText('partials — the bow notches out number 1/β', cl, T - 4)

      // --- readout ---------------------------------------------------------------
      g.textAlign = 'left'
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.45)'
      g.fillText(
        bowing
          ? `${noteName(sounding)} · β = 1/${notch.toFixed(1)} · force ${force.toFixed(3)} · ` +
            `periodicity ${regularity.toFixed(2)}`
          : 'hold a key to bow · drag the left pad to move the bow',
        L,
        h - 6,
      )
    }, plotWrap)

    // -- dragging the bow ----------------------------------------------------------

    const at = (e: PointerEvent) => {
      const rect = g.canvas.getBoundingClientRect()
      const L = 44
      const R = rect.width - 18
      const T = 16
      const B = rect.height - 30
      const u = clamp((e.clientX - rect.left - L) / (R - L), 0, 1)
      const v = clamp((B - (e.clientY - rect.top)) / (B - T), 0, 1)
      heldBeta = B_LO * Math.pow(B_HI / B_LO, u)
      heldForce = F_LO * Math.pow(F_HI / F_LO, v)
      send()
    }
    const onDown = (e: PointerEvent) => {
      g.canvas.setPointerCapture(e.pointerId)
      at(e)
    }
    const onMove = (e: PointerEvent) => {
      if (heldBeta !== null) at(e)
    }
    const onUp = () => {
      heldBeta = null
      heldForce = null
      send()
    }
    g.canvas.addEventListener('pointerdown', onDown)
    g.canvas.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    ctx.cleanup(() => window.removeEventListener('pointerup', onUp))

    ctx.status('hold a key to bow · drag the diagram — the dot goes green when the string locks')
  },
})
