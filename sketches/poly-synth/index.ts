import { canvas, delay, keyboard, midi, poly, reverb, type Wave } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * The instrument dynamic: no sequencer, no generation — the machine only makes
 * sound when you touch it. Play with the QWERTY row or connect MIDI.
 */

export default defineSketch({
  title: 'Poly Synth',
  description: 'Playable subtractive synth. QWERTY row or MIDI in. z / x shift octave.',
  tags: ['synth', 'instrument', 'dsp'],
  status: 'sketch',
  params: {
    wave: { type: 'select', value: 'sawtooth', options: ['sawtooth', 'square', 'triangle', 'sine'] },
    cutoff: { type: 'number', value: 1600, min: 120, max: 12000, step: 10, unit: 'Hz' },
    resonance: { type: 'number', value: 7, min: 0.5, max: 24, step: 0.1, label: 'Resonance' },
    envAmount: { type: 'number', value: 2.2, min: 0, max: 5, step: 0.1, label: 'Filter env', unit: 'oct' },
    detune: { type: 'number', value: 9, min: 0, max: 40, step: 0.5, unit: 'cents' },
    attack: { type: 'number', value: 0.01, min: 0.001, max: 1.5, step: 0.001, unit: 's' },
    decay: { type: 'number', value: 0.25, min: 0.01, max: 2, step: 0.01, unit: 's' },
    sustain: { type: 'number', value: 0.55, min: 0, max: 1, step: 0.01 },
    release: { type: 'number', value: 0.35, min: 0.01, max: 4, step: 0.01, unit: 's' },
    delayMix: { type: 'number', value: 0.2, min: 0, max: 0.8, step: 0.01, label: 'Delay' },
    reverbMix: { type: 'number', value: 0.25, min: 0, max: 0.9, step: 0.01, label: 'Reverb' },
  },
  notes: `
The filter envelope is where most of the character lives — try short decay
with high filter env for a pluck, then long attack for a pad.

Next thing worth trying: velocity -> filter cutoff, not just amplitude.
That single mapping is most of why real synths feel responsive.
  `,

  setup(ctx) {
    // Signal path: synth -> delay -> reverb -> out
    const rev = reverb(ctx.out, { mix: ctx.params.reverbMix, seconds: 2.6 })
    const dly = delay(rev.input, { time: '3/16', feedback: 0.32, mix: ctx.params.delayMix })
    const synth = poly(dly.input, { gain: 1.3 })
    ctx.cleanup(() => {
      synth.allNotesOff()
      dly.dispose()
      rev.dispose()
    })

    const apply = () => {
      synth.set({
        wave: ctx.params.wave as Wave,
        cutoff: ctx.params.cutoff,
        resonance: ctx.params.resonance,
        envAmount: ctx.params.envAmount,
        detune: ctx.params.detune,
        attack: ctx.params.attack,
        decay: ctx.params.decay,
        sustain: ctx.params.sustain,
        release: ctx.params.release,
      })
    }
    apply()
    for (const key of ['wave', 'cutoff', 'resonance', 'envAmount', 'detune', 'attack', 'decay', 'sustain', 'release'] as const) {
      ctx.onParam(key, apply)
    }
    ctx.onParam('delayMix', (v) => dly.setMix(v))
    ctx.onParam('reverbMix', (v) => rev.setMix(v))

    // -- layout -----------------------------------------------------------

    const scopeWrap = document.createElement('div')
    scopeWrap.style.cssText = 'position:relative;height:calc(100% - 130px);min-height:120px;'
    const kbWrap = document.createElement('div')
    kbWrap.style.cssText = 'margin-top:12px;'
    ctx.root.append(scopeWrap, kbWrap)

    const active = new Set<number>()

    const kb = keyboard(kbWrap, {
      low: 48,
      octaves: 2,
      onNoteOn: (m, v) => {
        synth.noteOn(m, v)
        active.add(m)
      },
      onNoteOff: (m) => {
        synth.noteOff(m)
        active.delete(m)
      },
    })
    ctx.cleanup(() => kb.dispose())

    // -- MIDI in ----------------------------------------------------------

    ctx.cleanup(
      midi.onNoteOn((e) => {
        synth.noteOn(e.midi, Math.max(0.15, e.velocity))
        active.add(e.midi)
        kb.highlight(e.midi, true)
      }),
    )
    ctx.cleanup(
      midi.onNoteOff((e) => {
        synth.noteOff(e.midi)
        active.delete(e.midi)
        kb.highlight(e.midi, false)
      }),
    )
    // CC1 (mod wheel) -> cutoff, because it's the one control every device has.
    ctx.cleanup(
      midi.onCC((e) => {
        if (e.cc !== 1) return
        ctx.set('cutoff', 200 + e.value * e.value * 10000)
      }),
    )

    // -- oscilloscope -----------------------------------------------------

    const analyser = ctx.audio.createAnalyser()
    analyser.fftSize = 2048
    dly.input.connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    ctx.cleanup(() => analyser.disconnect())

    const scope = canvas(scopeWrap, (g, { w, h }) => {
      analyser.getFloatTimeDomainData(buf)

      g.strokeStyle = 'rgba(255,255,255,0.05)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(0, h / 2)
      g.lineTo(w, h / 2)
      g.stroke()

      g.strokeStyle = active.size ? '#7dd3fc' : 'rgba(125,211,252,0.3)'
      g.lineWidth = 1.5
      g.beginPath()
      for (let i = 0; i < buf.length; i++) {
        const x = (i / buf.length) * w
        const y = h / 2 - buf[i] * h * 0.42
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
      }
      g.stroke()

      g.fillStyle = 'rgba(255,255,255,0.28)'
      g.font = '10px ui-monospace, monospace'
      g.textAlign = 'left'
      g.fillText(active.size ? `${active.size} voice${active.size > 1 ? 's' : ''}` : 'silent', 8, 14)
    })
    ctx.cleanup(() => scope.stop())

    ctx.status(
      midi.enabled
        ? `MIDI: ${midi.inputNames.join(', ') || 'no inputs'}`
        : 'play with a w s e d f t g y h u j k · z / x octave · "midi" in the toolbar for hardware',
    )
  },
})
