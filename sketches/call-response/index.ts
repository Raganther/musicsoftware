import { canvas, clamp, keyboard, midi, noteName, poly, reverb, rng, roundRect } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * The listener dynamic — the one thing nothing else in this repo does.
 *
 * Every other sketch here either executes what you programmed or generates
 * from its own state. This one *listens*: it captures the phrase you play,
 * waits for you to stop, and answers with that phrase transformed. Play again
 * while it's answering and it gets out of your way.
 *
 * The whole question is whether being answered feels like accompaniment or
 * like being interrupted by someone who wasn't really listening.
 */

interface Note {
  midi: number
  /** AudioContext time the note started. */
  at: number
  dur: number
  vel: number
}

type Phase = 'idle' | 'listening' | 'answering'

export default defineSketch({
  title: 'Call & Response',
  description: 'Plays you back. Captures your phrase, waits for a gap, answers it transformed.',
  tags: ['improvisation', 'instrument', 'generative', 'listening'],
  status: 'promising',
  bpm: 92,

  params: {
    mode: { type: 'select', value: 'develop', options: ['echo', 'invert', 'retrograde', 'develop'] },
    gap: { type: 'number', value: 1, min: 0.25, max: 4, step: 0.05, label: 'Answer after', unit: 'beats' },
    quantise: { type: 'toggle', value: true, label: 'Snap to grid' },
    transpose: { type: 'number', value: 0, min: -12, max: 12, step: 1, unit: 'st' },
    variation: { type: 'number', value: 0.4, min: 0, max: 1, step: 0.01 },
    theirLevel: { type: 'number', value: 0.8, min: 0, max: 1.4, step: 0.01, label: 'Its level' },
    interrupt: { type: 'toggle', value: true, label: 'Yield when I play' },
    seed: { type: 'number', value: 5, min: 1, max: 999, step: 1 },
  },

  notes: `
Question: does a machine that answers you feel like a duet partner, or like
someone waiting for their turn to talk?

What actually happens: "echo" is uncanny for about ten seconds and then dull —
it has nothing to add. "invert" is the one that sounds like a musician; an
inverted answer is recognisably *related* to what you played without being a
copy, which is what a call-and-response partner actually does. "retrograde"
reads as a different phrase entirely; the relationship is invisible by ear
even though it is obvious on paper.

The most important parameter turned out to be "Answer after". Below about half
a beat it steps on you and feels deaf. Past ~2 beats the connection to what you
played is gone and it may as well be a generative sketch. The window where it
feels like listening is narrow — roughly 0.75-1.5 beats.

"Yield when I play" matters more than expected. Without it, two voices talk
over each other and it stops being a conversation. With it, you can cut it off
mid-answer, and that alone makes it feel like it is paying attention.

Next: it answers the *notes* and ignores the *shape*. It should detect whether
you went up or down and reply with the opposite contour, and it should match
your density — four fast notes should not get four slow ones back.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: 0.28, seconds: 2.4 })

    // Two distinct timbres so you can always tell who is playing. Yours is
    // bright and forward; its answer is darker and sits behind you.
    const me = poly(rev.input, {
      wave: 'sawtooth',
      gain: 1.1,
      cutoff: 2200,
      resonance: 5,
      attack: 0.006,
      decay: 0.2,
      sustain: 0.5,
      release: 0.3,
      maxVoices: 8,
    })
    const them = poly(rev.input, {
      wave: 'triangle',
      gain: 0.9,
      cutoff: 1300,
      resonance: 3,
      envAmount: 1.2,
      attack: 0.03,
      decay: 0.3,
      sustain: 0.45,
      release: 0.6,
      maxVoices: 8,
    })

    ctx.cleanup(() => {
      me.allNotesOff()
      them.allNotesOff()
      rev.dispose()
    })

    let r = rng(ctx.params.seed)
    ctx.onParam('seed', (v) => (r = rng(v)))

    // -- listening ---------------------------------------------------------

    const held = new Map<number, { at: number; vel: number }>()
    /** The capture buffer — consumed and cleared each time it answers. */
    let phrase: Note[] = []
    /**
     * What you played, kept for drawing only. Separate from `phrase` because
     * clearing the buffer on answer would wipe your call from the timeline at
     * exactly the moment the response appears next to it.
     */
    let history: Note[] = []
    let lastActivity = 0
    let phase: Phase = 'idle'

    /** Notes it is currently playing, for drawing and for cutting short. */
    let answer: Note[] = []
    let answerEnds = 0

    const stopAnswering = () => {
      them.allNotesOff()
      answer = []
      answerEnds = 0
      if (phase === 'answering') phase = 'listening'
    }

    const playerOn = (m: number, v: number) => {
      const now = ctx.audio.currentTime

      // Playing while it answers cuts it off. This is what makes it feel like
      // it is listening rather than taking its turn regardless.
      if (ctx.params.interrupt && phase === 'answering') stopAnswering()

      me.noteOn(m, v)
      held.set(m, { at: now, vel: v })
      lastActivity = now
      phase = 'listening'
    }

    const playerOff = (m: number) => {
      me.noteOff(m)
      const h = held.get(m)
      if (!h) return
      held.delete(m)
      const now = ctx.audio.currentTime
      const note = { midi: m, at: h.at, dur: Math.max(0.06, now - h.at), vel: h.vel }
      phrase.push(note)
      // Keep phrases to a musical length rather than a whole performance.
      if (phrase.length > 24) phrase.shift()
      history.push(note)
      lastActivity = now
    }

    // -- answering ---------------------------------------------------------

    /**
     * Transformations work in semitones rather than snapping to a scale: the
     * player is free, so imposing a key would fight whatever they are implying.
     * Inversion around the first note keeps the answer plausibly related.
     */
    const transform = (input: Note[]): Note[] => {
      const mode = ctx.params.mode
      const variation = ctx.params.variation
      const shift = Math.round(ctx.params.transpose)
      const base = input[0].midi
      let out = input.map((n) => ({ ...n }))

      if (mode === 'invert') {
        out = out.map((n) => ({ ...n, midi: base - (n.midi - base) }))
      } else if (mode === 'retrograde') {
        // Reverse the pitches over the original rhythm. A true retrograde
        // (reversing time as well) is unrecognisable by ear — this at least
        // keeps the phrase's gait.
        const pitches = out.map((n) => n.midi).reverse()
        out = out.map((n, i) => ({ ...n, midi: pitches[i] }))
      } else if (mode === 'develop') {
        const dir = r.chance(0.5) ? 1 : -1
        out = out.map((n, i) => {
          let midiOut = n.midi
          // Displace some notes by an octave, more often at higher variation.
          if (r.chance(variation * 0.35)) midiOut += 12 * dir
          // Occasionally nudge a note a step, so it develops rather than repeats.
          if (i > 0 && r.chance(variation * 0.4)) midiOut += r.pick([-2, -1, 1, 2])
          return { ...n, midi: midiOut }
        })
        // Sometimes answer with only the tail: a fragment reads as a reply, a
        // full copy reads as a parrot.
        if (out.length > 3 && r.chance(variation * 0.5)) {
          out = out.slice(-Math.max(2, Math.floor(out.length / 2)))
        }
      }

      return out.map((n) => ({ ...n, midi: clamp(n.midi + shift, 21, 108) }))
    }

    const answerNow = (startTime: number, stepDur: number) => {
      if (!phrase.length) return
      const notes = transform(phrase)
      const t0 = notes.reduce((min, n) => Math.min(min, n.at), Infinity)
      const level = ctx.params.theirLevel
      const snap = ctx.params.quantise

      answer = []
      let latest = startTime

      for (const n of notes) {
        let offset = n.at - t0
        if (snap) offset = Math.round(offset / stepDur) * stepDur
        const at = startTime + offset
        const dur = Math.max(
          0.08,
          snap ? Math.max(stepDur, Math.round(n.dur / stepDur) * stepDur) : n.dur,
        )

        them.note(n.midi, at, dur, clamp(n.vel * 0.85 * level, 0.05, 1))
        answer.push({ ...n, at, dur })
        latest = Math.max(latest, at + dur)
      }

      answerEnds = latest
      phase = 'answering'
      phrase = []
      ctx.status(`answered ${notes.length} note${notes.length > 1 ? 's' : ''} · ${ctx.params.mode}`)
    }

    ctx.clock.onStep((e) => {
      const now = ctx.audio.currentTime

      if (phase === 'answering' && now > answerEnds) {
        answer = []
        phase = 'idle'
      }

      // Only consider answering on a beat boundary, so the reply lands in time
      // with the transport rather than exactly N seconds after you stop.
      if (e.tick !== 0) return
      if (!phrase.length || held.size > 0 || phase === 'answering') return

      const silence = now - lastActivity
      if (silence < ctx.params.gap * ctx.clock.secondsPerBeat) return

      answerNow(e.time, e.dur)
    })

    ctx.onParam('mode', () => stopAnswering())

    // -- input -------------------------------------------------------------

    const viz = document.createElement('div')
    viz.style.cssText = 'position:relative;height:calc(100% - 130px);min-height:140px;'
    const kbWrap = document.createElement('div')
    kbWrap.style.cssText = 'margin-top:12px;'
    ctx.root.append(viz, kbWrap)

    const kb = keyboard(kbWrap, {
      low: 48,
      octaves: 2,
      onNoteOn: playerOn,
      onNoteOff: playerOff,
    })
    ctx.cleanup(() => kb.dispose())

    ctx.cleanup(midi.onNoteOn((e) => playerOn(e.midi, Math.max(0.2, e.velocity))))
    ctx.cleanup(midi.onNoteOff((e) => playerOff(e.midi)))

    // -- drawing -----------------------------------------------------------

    // A scrolling two-lane timeline: you on top, it underneath. Seeing the
    // answer as a transformation of your own shape is most of the point.
    const WINDOW = 8 // seconds visible

    const scope = canvas(viz, (g, { w, h }) => {
      const now = ctx.audio.currentTime
      const left = now - WINDOW * 0.72
      const xOf = (t: number) => ((t - left) / WINDOW) * w

      const laneH = (h - 34) / 2
      const yTop = 18
      const yBot = yTop + laneH + 6

      // Drop anything that has scrolled off the left edge.
      history = history.filter((n) => n.at + n.dur > left - 1)

      const shown = [...history, ...answer]
      const lo = shown.length ? Math.min(...shown.map((n) => n.midi)) - 3 : 52
      const hi = shown.length ? Math.max(...shown.map((n) => n.midi)) + 3 : 76
      const span = Math.max(12, hi - lo)
      const yOf = (m: number, top: number) => top + laneH - ((m - lo) / span) * laneH

      g.fillStyle = 'rgba(255,255,255,0.022)'
      g.fillRect(0, yTop, w, laneH)
      g.fillRect(0, yBot, w, laneH)

      const nx = xOf(now)
      g.strokeStyle = 'rgba(255,255,255,0.16)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(nx, yTop)
      g.lineTo(nx, yBot + laneH)
      g.stroke()

      const drawNote = (n: Note, top: number, colour: string, alpha: number) => {
        const x = xOf(n.at)
        const width = Math.max(3, (n.dur / WINDOW) * w)
        if (x + width < 0 || x > w) return
        g.globalAlpha = alpha
        g.fillStyle = colour
        roundRect(g, x, yOf(n.midi, top) - 3, width, 6, 3)
        g.fill()
        g.globalAlpha = 1
      }

      // Notes still in the capture buffer are brighter than ones already answered.
      const pending = new Set(phrase)
      for (const n of history) drawNote(n, yTop, '#7dd3fc', pending.has(n) ? 0.95 : 0.4)
      // Held notes have no end yet — draw them growing towards the now-line.
      for (const [m, h] of held) {
        drawNote({ midi: m, at: h.at, dur: Math.max(0.06, now - h.at), vel: h.vel }, yTop, '#ffffff', 0.95)
      }
      for (const n of answer) drawNote(n, yBot, '#fbbf24', n.at > now ? 0.3 : 0.85)

      g.font = '9px ui-monospace, monospace'
      g.textAlign = 'left'
      g.fillStyle = 'rgba(255,255,255,0.3)'
      g.fillText('you', 6, yTop - 5)
      g.fillStyle = 'rgba(251,191,36,0.5)'
      g.fillText('it', 6, yBot - 5)

      const waitFor = ctx.params.gap * ctx.clock.secondsPerBeat - (now - lastActivity)
      const label =
        phase === 'answering'
          ? 'answering'
          : held.size
            ? 'listening'
            : phrase.length
              ? `waiting ${Math.max(0, waitFor).toFixed(1)}s`
              : 'idle'
      g.textAlign = 'right'
      g.fillStyle = phase === 'answering' ? '#fbbf24' : 'rgba(255,255,255,0.4)'
      g.fillText(label, w - 6, 12)

      if (!history.length && !answer.length && !held.size) {
        g.textAlign = 'center'
        g.fillStyle = 'rgba(255,255,255,0.25)'
        g.font = '11px ui-monospace, monospace'
        g.fillText('play a few notes, then stop — it answers', w / 2, h / 2)
      } else {
        g.textAlign = 'left'
        g.fillStyle = 'rgba(255,255,255,0.22)'
        const call = history.slice(-8).map((n) => noteName(n.midi)).join(' ')
        const reply = answer.slice(-8).map((n) => noteName(n.midi)).join(' ')
        // yBot + laneH is h - 10; anything past that clips off the canvas.
        g.fillText(reply ? `${call}   →   ${reply}` : call, 6, h - 4)
      }
    })
    ctx.cleanup(() => scope.stop())

    ctx.status('play with a w s e d f t g y h u j k · stop, and it answers you')
  },
})
