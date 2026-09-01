import {
  blip,
  clamp,
  degree,
  delay,
  keyboard,
  midi as midiHub,
  noteName,
  poly,
  reverb,
  rng,
  SCALE_NAMES,
  type ScaleName,
} from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * An instrument you play ahead of yourself.
 *
 * Notes you press are not sounded. They are *committed* to a looping ring at
 * a position `lead` ahead of the playhead, and you hear them when the
 * playhead gets there — a bar later, by default. So you are always listening
 * to your past self while playing your future one, and to make a phrase land
 * on a downbeat you have to play it a bar early.
 *
 * The ring is a decaying loop: each pass costs a note one life, so material
 * fades unless you refresh it. That turns the instrument into a garden you
 * tend at a one-bar remove rather than a keyboard.
 *
 * Two details do most of the work. Commits are quantised, so the future is
 * always tidier than the playing that produced it. And every commit gets an
 * immediate quiet tick — without acknowledgement the instrument feels broken,
 * because pressing a key makes no sound for a whole bar.
 */

interface Ev {
  /** Position within the loop, in clock steps. */
  pos: number
  midi: number
  vel: number
  /** Passes remaining before this note is forgotten. */
  life: number
  /** Wall-clock seconds it was committed, for the write flash. */
  bornAt: number
}

export default defineSketch({
  title: 'Foreshadow',
  description: 'Play a bar into the future. Commits land ahead of the playhead and decay unless refreshed.',
  tags: ['improvisation', 'instrument', 'sequencer', 'strange'],
  status: 'promising',
  bpm: 96,

  params: {
    seed: { type: 'number', value: 12, min: 1, max: 999, step: 1 },
    lead: { type: 'number', value: 1, min: 0, max: 3, step: 0.25, label: 'Lead', unit: 'bars' },
    bars: { type: 'number', value: 2, min: 1, max: 4, step: 1, label: 'Loop' },
    grid: { type: 'select', value: '1/8', options: ['free', '1/16', '1/8', '1/4'], label: 'Commit grid' },
    lives: { type: 'number', value: 5, min: 1, max: 16, step: 1, label: 'Passes before fading' },
    auto: { type: 'toggle', value: true, label: 'Ghost player' },
    density: { type: 'number', value: 0.35, min: 0, max: 1, step: 0.01, label: 'Ghost density' },
    tick: { type: 'toggle', value: true, label: 'Commit tick' },
    root: { type: 'number', value: 52, min: 36, max: 67, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'dorian', options: SCALE_NAMES },
    clear: { type: 'button', label: 'Forget everything' },
  },

  notes: `
Question: what happens to improvising when you cannot hear what you just did?

Measured, because the whole sketch rests on it: a key pressed with Lead at 1
bar sounds 2.40s later against an expected bar of 2.50s at 96bpm — 100ms
early, which is inside the one-eighth-note commit grid it snaps to. At Lead 0
the same press sounds in 0.23s. The delay is real and accurate, not an
approximation of one.

Lead is the whole instrument. At 0 it is an ordinary quantised looper. At 1
bar the only way to place a note where you want it is to play it a bar
before you want it, so everything you hear is a decision you can no longer
influence.

Design reasoning I could NOT verify, since measuring latency is not the same
as playing the thing: I expect this to be easier than it sounds, because the
loop is repeating and you are therefore predicting against a bar you already
know rather than into silence — and I expect that to break down somewhere
past Lead 2 where it becomes real guesswork. Both are hypotheses about the
feel, not findings. Someone should actually play it.

The commit tick is not decoration. Pressing a key produces no sound for two
and a half seconds, which reads as a broken instrument, and the obvious
response is to press again — now you have committed two notes. A quiet high
tick at the instant of commit separates *acknowledgement* from *output*,
which turn out to be different jobs.

A real bug the timing test caught: nearest-grid quantising can round a commit
DOWN, landing it just behind the playhead, where it then waits an entire loop
to sound. Invisible at Lead 1 and fatal at Lead 0, where a keypress could go
silent for two bars. Commits are now never allowed to land in the past.

Honest limitation: the ring shows pitch as radius, which is legible across a
couple of octaves and turns to soup beyond that. A piano-roll ring would be
better and I ran out of appetite for the geometry.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: 0.3, seconds: 2.6 })
    const dly = delay(rev.input, { time: '3/16', feedback: 0.26, mix: 0.18 })
    const synth = poly(dly.input, {
      wave: 'triangle',
      /**
       * 6.0 until 2026-09-01, where it ran too close to the ceiling to be safe.
       * Measured pre-limiter across four smoke runs: 0.65, 0.93, 0.96 and
       * **1.19** — the last one a genuine gate failure. The spread is the
       * sketch's own generativity (how many commits pile onto one bar), so no
       * single run bounds the worst case; this is scaled to put the loudest
       * thing actually observed at 0.89 rather than over 1.
       */
      gain: 4.5,
      cutoff: 2400,
      envAmount: 1.5,
      attack: 0.005,
      decay: 0.18,
      sustain: 0.35,
      release: 0.35,
      velToFilter: 0.5,
      keytrack: 0.3,
      spread: 0.4,
      sub: 0.2,
      maxVoices: 8,
    })
    ctx.cleanup(() => {
      synth.allNotesOff()
      dly.dispose()
      rev.dispose()
    })

    // -- the ring ----------------------------------------------------------

    let events: Ev[] = []
    const loopSteps = () => Math.round(ctx.params.bars) * ctx.clock.stepsPerBar

    const gridSteps = () => {
      const g = ctx.params.grid
      if (g === 'free') return 1
      if (g === '1/16') return 1
      if (g === '1/8') return 2
      return 4
    }

    /** Seed the ring so you arrive to something already playing. */
    const sow = () => {
      const r = rng(Math.round(ctx.params.seed))
      const n = loopSteps()
      events = []
      for (let i = 0; i < n; i += 2) {
        if (!r.chance(0.32)) continue
        events.push({
          pos: i,
          midi: degree(
            Math.round(ctx.params.root),
            ctx.params.scale as ScaleName,
            r.pick([0, 2, 3, 4, 5, 7, -2]),
          ),
          vel: 0.5 + r.next() * 0.3,
          life: Math.round(ctx.params.lives),
          bornAt: -1e9,
        })
      }
    }
    sow()
    ctx.onParam('seed', sow)
    ctx.onParam('bars', sow)
    ctx.onPress('clear', () => {
      events = []
      ctx.status('forgotten — the ring is empty, play to refill it')
    })

    // -- committing --------------------------------------------------------

    let lastCommit = { pos: -1, midi: -1 }

    const commit = (m: number, vel: number) => {
      const n = loopSteps()
      // The AUDIBLE step, not the scheduled one. clock.visualStep is what the
      // player is hearing; using the lookahead step would place commits a
      // scheduling window early and the lead would silently be wrong.
      const heard = ctx.clock.visualStep
      const base = heard < 0 ? 0 : heard
      const leadSteps = ctx.params.lead * ctx.clock.stepsPerBar
      const q = gridSteps()
      // Nearest-grid quantising is what tidies loose playing, but rounding
      // DOWN can land a commit just behind the playhead, where it then waits
      // a whole loop to sound. Most visible at lead 0, where a keypress could
      // go silent for two bars. Never let a commit land in the past.
      const raw = base + leadSteps
      let pos = Math.round(raw / q) * q
      if (pos <= base) pos += q

      pos = ((pos % n) + n) % n
      events.push({
        pos,
        midi: m,
        vel,
        life: Math.round(ctx.params.lives),
        bornAt: performance.now() / 1000,
      })
      lastCommit = { pos, midi: m }

      // Immediate acknowledgement. The note itself will not sound for a whole
      // bar; without this the instrument feels unresponsive and you double-hit.
      if (ctx.params.tick) blip(rev.input, m + 24, ctx.audio.currentTime, 0.05, 'sine')
    }

    // -- playback ----------------------------------------------------------

    const ghost = rng(Math.round(ctx.params.seed) + 4241)

    ctx.clock.onStep((e) => {
      const n = loopSteps()
      const at = ((e.step % n) + n) % n

      if (ctx.params.auto && ctx.params.density > 0) {
        // The ghost plays the instrument the same way you do — by committing
        // ahead — so it is subject to the same rule rather than cheating.
        if (e.step % 4 === 0 && ghost.chance(ctx.params.density)) {
          const m = degree(
            Math.round(ctx.params.root),
            ctx.params.scale as ScaleName,
            ghost.pick([0, 2, 3, 4, 5, 7, 9, -2, -3]),
          )
          commit(m, 0.4 + ghost.next() * 0.3)
        }
      }

      const survivors: Ev[] = []
      for (const ev of events) {
        if (ev.pos === at) {
          synth.note(ev.midi, e.time, e.dur * 2.2, ev.vel)
          ev.life -= 1
          if (ev.life > 0) survivors.push(ev)
        } else {
          survivors.push(ev)
        }
      }
      events = survivors
    })

    // -- hands -------------------------------------------------------------

    const viz = document.createElement('div')
    viz.style.cssText = 'position:relative;height:calc(100% - 130px);min-height:150px;'
    const kbWrap = document.createElement('div')
    kbWrap.style.cssText = 'margin-top:12px;'
    ctx.root.append(viz, kbWrap)

    const kb = keyboard(kbWrap, {
      low: 48,
      octaves: 2,
      onNoteOn: (m, v) => commit(m, v),
      onNoteOff: () => {},
    })
    ctx.cleanup(() => kb.dispose())
    ctx.cleanup(midiHub.onNoteOn((e) => commit(e.midi, Math.max(0.25, e.velocity))))

    // -- drawing -----------------------------------------------------------

    ctx.canvas(
      (g, { w, h }) => {
        const now = performance.now() / 1000
        const n = loopSteps()
        const cx = w / 2
        const cy = h / 2 + 4
        const outer = Math.min(w, h) * 0.42
        const inner = outer * 0.42

        const angle = (pos: number) => (pos / n) * Math.PI * 2 - Math.PI / 2
        const lo = Math.round(ctx.params.root) - 4
        const radius = (m: number) => inner + clamp((m - lo) / 30, 0, 1) * (outer - inner)

        // bar spokes
        const spb = ctx.clock.stepsPerBar
        g.strokeStyle = 'rgba(255,255,255,0.07)'
        g.lineWidth = 1
        for (let s = 0; s < n; s += spb) {
          const a = angle(s)
          g.beginPath()
          g.moveTo(cx + Math.cos(a) * inner * 0.75, cy + Math.sin(a) * inner * 0.75)
          g.lineTo(cx + Math.cos(a) * outer * 1.06, cy + Math.sin(a) * outer * 1.06)
          g.stroke()
        }
        g.strokeStyle = 'rgba(255,255,255,0.05)'
        g.beginPath()
        g.arc(cx, cy, outer, 0, Math.PI * 2)
        g.stroke()
        g.beginPath()
        g.arc(cx, cy, inner, 0, Math.PI * 2)
        g.stroke()

        const step = ctx.clock.running ? ctx.clock.visualStep : -1
        const at = step >= 0 ? ((step % n) + n) % n : -1

        // The wedge between playhead and write head IS the lead: the span of
        // future you have already committed but cannot yet hear.
        if (at >= 0 && ctx.params.lead > 0) {
          const a0 = angle(at)
          const a1 = angle(at + ctx.params.lead * spb)
          g.beginPath()
          g.moveTo(cx, cy)
          g.arc(cx, cy, outer * 1.06, a0, a1)
          g.closePath()
          g.fillStyle = 'rgba(251, 191, 36, 0.07)'
          g.fill()
        }

        for (const ev of events) {
          const a = angle(ev.pos)
          const r = radius(ev.midi)
          const x = cx + Math.cos(a) * r
          const y = cy + Math.sin(a) * r
          const fade = clamp(ev.life / Math.max(1, ctx.params.lives), 0.12, 1)
          const fresh = now - ev.bornAt < 0.4

          g.beginPath()
          g.arc(x, y, fresh ? 6 : 3.5, 0, Math.PI * 2)
          g.fillStyle = fresh
            ? '#fbbf24'
            : `rgba(125, 211, 252, ${fade})`
          g.fill()
        }

        if (at >= 0) {
          // playhead
          const a = angle(at)
          g.strokeStyle = '#ffffff'
          g.lineWidth = 1.6
          g.beginPath()
          g.moveTo(cx + Math.cos(a) * inner * 0.7, cy + Math.sin(a) * inner * 0.7)
          g.lineTo(cx + Math.cos(a) * outer * 1.1, cy + Math.sin(a) * outer * 1.1)
          g.stroke()

          // write head — where your next keypress will land
          const aw = angle(at + ctx.params.lead * spb)
          g.strokeStyle = '#fbbf24'
          g.lineWidth = 1.4
          g.setLineDash([4, 4])
          g.beginPath()
          g.moveTo(cx + Math.cos(aw) * inner * 0.7, cy + Math.sin(aw) * inner * 0.7)
          g.lineTo(cx + Math.cos(aw) * outer * 1.1, cy + Math.sin(aw) * outer * 1.1)
          g.stroke()
          g.setLineDash([])
          g.fillStyle = '#fbbf24'
          g.font = '9px ui-monospace, monospace'
          g.textAlign = 'center'
          g.fillText(
            'you play here',
            cx + Math.cos(aw) * outer * 1.24,
            cy + Math.sin(aw) * outer * 1.24,
          )
          g.fillStyle = 'rgba(255,255,255,0.55)'
          g.fillText(
            'you hear here',
            cx + Math.cos(a) * outer * 1.24,
            cy + Math.sin(a) * outer * 1.24,
          )
        }

        g.textAlign = 'left'
        g.font = '10px ui-monospace, monospace'
        g.fillStyle = 'rgba(255,255,255,0.42)'
        g.fillText(
          `lead ${ctx.params.lead} bar${ctx.params.lead === 1 ? '' : 's'}  ·  ${events.length} notes committed`,
          12,
          16,
        )
        if (lastCommit.midi >= 0) {
          g.fillStyle = 'rgba(251,191,36,0.55)'
          g.textAlign = 'right'
          g.fillText(`last commit ${noteName(lastCommit.midi)}`, w - 12, 16)
        }
        if (!ctx.clock.running) {
          g.textAlign = 'center'
          g.fillStyle = 'rgba(255,255,255,0.3)'
          g.font = '11px ui-monospace, monospace'
          g.fillText('press space — then play a bar earlier than you mean it', cx, cy)
        }
      },
      viz,
    )

    ctx.status('press space · what you play lands a bar later — aim ahead')
  },
})
