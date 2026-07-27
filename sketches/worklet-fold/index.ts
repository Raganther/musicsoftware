import { degree, delay, loadWorklet, mtof, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import workletUrl from './fold.worklet.js?url'

/**
 * The escape hatch: when the built-in nodes can't make the sound, write the
 * samples yourself in an AudioWorklet. This one is a phase-distortion
 * wavefolder — a timbre you cannot build from oscillator + filter.
 *
 * If a sketch outgrows even this (heavy filters, physical models, FFT work),
 * the next step is Rust compiled to WASM and called from inside the worklet.
 * See research/topics/dsp-in-the-browser.md.
 */

export default defineSketch({
  title: 'Wavefolder (AudioWorklet)',
  description: 'Hand-written DSP on the audio thread. Phase distortion into a wavefolder.',
  tags: ['dsp', 'synth', 'worklet'],
  status: 'sketch',
  bpm: 76,
  params: {
    fold: { type: 'number', value: 2.4, min: 1, max: 8, step: 0.01, label: 'Fold' },
    skew: { type: 'number', value: 0.4, min: 0.02, max: 0.98, step: 0.01, label: 'Phase skew' },
    level: { type: 'number', value: 0.7, min: 0, max: 1, step: 0.01, label: 'Level' },
    glide: { type: 'number', value: 0.06, min: 0, max: 0.6, step: 0.005, unit: 's' },
    root: { type: 'number', value: 38, min: 24, max: 60, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'pentatonicMinor', options: SCALE_NAMES },
    autoplay: { type: 'toggle', value: true, label: 'Auto sequence' },
    motion: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, label: 'Fold motion' },
  },
  notes: `
Fold is the whole instrument. Below ~1.5 it is a sine; past 4 it is metallic
and the harmonics move independently of pitch, which is what makes folding
sound unlike a filter sweep.

Note the DC blocker in the worklet — remove it and the output drifts off
centre, which eats headroom and sounds duller than it should.
  `,

  async setup(ctx) {
    await loadWorklet(workletUrl)

    const rev = reverb(ctx.out, { mix: 0.35, seconds: 2.8 })
    const dly = delay(rev.input, { time: '3/16', feedback: 0.4, mix: 0.28 })

    const node = new AudioWorkletNode(ctx.audio, 'fold-osc', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    })

    const amp = ctx.audio.createGain()
    amp.gain.value = 0
    node.connect(amp).connect(dly.input)

    ctx.cleanup(() => {
      node.disconnect()
      amp.disconnect()
      dly.dispose()
      rev.dispose()
    })

    const pFreq = node.parameters.get('frequency')!
    const pFold = node.parameters.get('fold')!
    const pSkew = node.parameters.get('skew')!
    const pGain = node.parameters.get('gain')!

    pGain.value = 1
    pFold.value = ctx.params.fold
    pSkew.value = ctx.params.skew

    ctx.onParam('fold', (v) => pFold.setTargetAtTime(v, ctx.audio.currentTime, 0.02))
    ctx.onParam('skew', (v) => pSkew.setTargetAtTime(v, ctx.audio.currentTime, 0.02))

    // -- sequencing -------------------------------------------------------

    const r = rng(21)
    let currentNote = Math.round(ctx.params.root)

    const play = (midiNote: number, time: number, dur: number, vel: number) => {
      currentNote = midiNote
      const glide = ctx.params.glide
      const freq = mtof(midiNote)
      if (glide > 0) {
        pFreq.cancelScheduledValues(time)
        pFreq.setTargetAtTime(freq, time, glide / 3)
      } else {
        pFreq.setValueAtTime(freq, time)
      }

      const level = ctx.params.level * vel
      amp.gain.cancelScheduledValues(time)
      amp.gain.setTargetAtTime(level, time, 0.008)
      amp.gain.setTargetAtTime(0, time + dur * 0.8, dur * 0.25)
    }

    ctx.clock.onStep((e) => {
      if (!ctx.params.autoplay) return

      // Fold moves on its own, slowly, so a held pattern keeps developing.
      const motion = ctx.params.motion
      if (motion > 0 && e.step % 4 === 0) {
        const target = ctx.params.fold + (r.next() - 0.5) * motion * 3
        pFold.setTargetAtTime(Math.max(1, Math.min(8, target)), e.time, 0.4)
      }

      if (e.step % 4 !== 0 && !r.chance(0.22)) return

      const deg = r.pick([0, 0, 2, 3, 4, 5, 7, -3])
      const note = degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, deg)
      play(note, e.time, e.dur * r.pick([2, 3, 4, 6]), 0.7 + r.next() * 0.3)
    })

    // Click anywhere to play a note by hand, even with autoplay off.
    const onDown = (e: PointerEvent) => {
      const rect = g.canvas.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width
      const y = 1 - (e.clientY - rect.top) / rect.height
      const note = degree(Math.round(ctx.params.root), ctx.params.scale as ScaleName, Math.round(x * 14) - 3)
      ctx.set('fold', 1 + y * 7)
      play(note, ctx.audio.currentTime, 0.9, 1)
    }

    // -- scope ------------------------------------------------------------

    const analyser = ctx.audio.createAnalyser()
    analyser.fftSize = 4096
    node.connect(analyser)
    const wave = new Float32Array(analyser.fftSize)
    const spectrum = new Uint8Array(analyser.frequencyBinCount)
    ctx.cleanup(() => analyser.disconnect())

    const g = ctx.canvas((g, { w, h }) => {
      analyser.getFloatTimeDomainData(wave)
      analyser.getByteFrequencyData(spectrum)

      // spectrum, log-ish x axis
      const bins = 220
      g.fillStyle = 'rgba(125,211,252,0.14)'
      for (let i = 0; i < bins; i++) {
        const idx = Math.floor(Math.pow(i / bins, 2) * spectrum.length)
        const v = spectrum[idx] / 255
        const bw = w / bins
        g.fillRect(i * bw, h - v * h * 0.75, bw - 0.5, v * h * 0.75)
      }

      // one cycle of the waveform, centred
      const span = Math.min(wave.length, Math.floor((ctx.audio.sampleRate / mtof(currentNote)) * 3))
      g.strokeStyle = '#7dd3fc'
      g.lineWidth = 1.5
      g.beginPath()
      for (let i = 0; i < span; i++) {
        const x = (i / span) * w
        const y = h / 2 - wave[i] * h * 0.32
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
      }
      g.stroke()

      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.font = '10px ui-monospace, monospace'
      g.textAlign = 'left'
      g.fillText(`fold ${pFold.value.toFixed(2)} · skew ${pSkew.value.toFixed(2)}`, 10, 16)
      g.fillText('click the scope: x = pitch, y = fold', 10, 30)
    })

    g.canvas.addEventListener('pointerdown', onDown)

    ctx.status('worklet loaded · click the scope to play by hand')
  },
})
