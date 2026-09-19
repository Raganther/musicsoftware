import { clamp, degree, disposeAt, mtof, reverb, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'
import {
  C_AIR,
  Floor,
  ringPositions,
  reactionTimes,
  senseCleanMean,
  travelTimes,
  type Backoff,
  type Config,
  type Manner,
  type Turn,
} from './floor'

/**
 * Free improvisation is a network protocol, and it has the protocol's bug.
 *
 * Players with no pulse between them take turns the only way anybody can:
 * wait a bit, listen, and if nobody is playing, play. That is *carrier sense
 * multiple access*, the rule a shared radio channel uses, and it fails the same
 * way. Sound takes 1/343 of a second per metre, so two players who start within
 * one travel time of each other **cannot have heard each other** — both are
 * already playing before either finds out. Listening harder does not help; the
 * window is the room.
 *
 * So the amount two improvisers talk over each other is set by how far apart
 * they are standing, and `Room` is the demonstration: at half a metre they
 * trade cleanly, at forty they are on top of each other.
 *
 * The best thing in it is what happens *after* a clash. Both break off, both
 * wait, both go again — and the gap between their two start times is exactly
 * conserved, by any response they both make. Being polite in the same way is
 * not politeness. `Backoff` at `polite` deadlocks two players for as long as
 * you leave it; only `random` gets them out.
 *
 * Numbers in `notes` are measured; see `research/log/2026-09-19-afteryou.md`.
 */

const MAX_PLAYERS = 6
const COLOURS = ['#7dd3fc', '#fbbf24', '#a78bfa', '#34d399', '#f472b6', '#fb923c']
const WAVES: OscillatorType[] = ['sawtooth', 'triangle', 'sawtooth', 'square', 'triangle', 'sawtooth']

/** How far the simulation runs ahead of the sound, seconds. */
const LEAD = 0.3
/**
 * A turn's end is not final until everybody's sound has arrived and they have
 * had time to react, so nothing is scheduled until the simulation is this far
 * past its start: the worst case of max travel time plus max reaction.
 */
const SETTLE = 40 / C_AIR + 0.5 * 1.3 + 0.05
/** Sound crosses a room faster than a frame; the drawn wavefronts are slowed. */
const SLOW = 12

export default defineSketch({
  title: 'After you',
  description: 'Improvisers taking turns by ear, where the room is the reason they talk over each other.',
  tags: ['generative', 'interaction', 'ensemble'],
  status: 'promising',
  bpm: 96,

  params: {
    players: { type: 'number', value: 4, min: 2, max: MAX_PLAYERS, step: 1, label: 'Players' },
    /** Diameter of the circle they stand on. Sets every travel time. */
    room: { type: 'number', value: 12, min: 0.5, max: 40, step: 0.5, label: 'Room', unit: 'm' },
    patience: { type: 'number', value: 2, min: 0.4, max: 12, step: 0.1, label: 'Patience', unit: 's' },
    phrase: { type: 'number', value: 1.2, min: 0.3, max: 4, step: 0.05, label: 'Phrase', unit: 's' },
    react: { type: 'number', value: 0.18, min: 0.05, max: 0.5, step: 0.01, label: 'Reaction', unit: 's' },
    /** patient re-draws its wait; pouncing waits for the gap and goes. */
    manner: { type: 'select', value: 'patient', options: ['patient', 'pouncing'], label: 'On a busy floor' },
    /** polite is the trap: everybody waiting the same amount waits forever. */
    backoff: { type: 'select', value: 'random', options: ['random', 'polite', 'none'], label: 'After a clash' },
    /** Nobody listens at all — the control, and where the closed forms are exact. */
    deaf: { type: 'toggle', value: false, label: 'Nobody listens' },
    root: { type: 'number', value: 47, min: 30, max: 66, step: 1, label: 'Root' },
    scale: { type: 'select', value: 'dorian', options: SCALE_NAMES as unknown as string[], label: 'Scale' },
    space: { type: 'number', value: 0.26, min: 0, max: 0.6, step: 0.01, label: 'Space' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    seed: { type: 'number', value: 7, min: 1, max: 999, step: 1, label: 'Seed' },
  },

  notes: `
No pulse, no leader. Each player waits a while, listens, and if nobody is
playing, plays. That is **carrier sense multiple access**, and it fails the way
a shared radio channel fails: sound crosses a room at 343 m/s, so two players
who start within one travel time of each other cannot have heard each other.
Both are committed before either finds out. **The vulnerable window is the
room**, and listening harder does not narrow it.

**The law.** A player can only start when the floor sounds clear, so what
matters is not starts per second but starts per second *of silence*. With that,
the chance of getting a turn to yourself is exp(−2 r Στ) over the other players'
travel times — and across six room sizes from 0.5 m to 40 m the measurement
lands within **0.40%** of it, and across five patience settings within 0.42%.
Measured collision rate goes **0.35% → 24.95%** from half a metre to forty.
Using the raw start rate instead of the silence-corrected one is 17% out at the
far end, which is the whole correction visible in one number.

| room | predicted clean | measured |
| --- | --- | --- |
| 0.5 m | 99.65% | 99.65% |
| 6 m | 95.86% | 95.92% |
| 12 m | 91.81% | 91.79% |
| 40 m | 74.75% | 75.05% |

**Nobody listens** is the control and the known answer. With no carrier sense
every player is an alternating renewal process, so P(a turn is not overlapped)
= [e^−g/(1+g)]^(N−1) and the time exactly one plays is N g/(1+g)^N, for
g = phrase/patience. Twelve configurations: worst departure **1.08%** on the
second and **4.08%** on the first over the cells with enough clean turns to say
anything. And the first tends to Abramson's e^−2G — pure ALOHA, peaking at
1/(2e) = 0.1839.

**The room is the whole mechanism:** set the travel times to zero and collisions
are **exactly 0**, in six configurations of player count and manner, over 72,927
turns.

**The best result is the deadlock.** After a clash both players break off, both
wait, both go again — and the gap between their two start times is *exactly
conserved*, by any response they both make, whatever their separate reaction
times. \`After a clash → polite\` gives everybody the same considerate pause and
two players never escape: **10,474 consecutive turns collided** out of 10,479,
with the offset frozen at −0.027425399 s and never moving again. Retrying with
no pause at all is the same trap (17,297 turns, 99.97%). Only \`random\` breaks
it (3.85%). Being polite in the same way is not politeness; the only thing that
resolves a clash is disagreeing about how long to wait — **or a third player**,
whose independent entries break the symmetry and take \`polite\` from 99.95% to
19.98%.

**Waiting for the gap is what makes you collide.** \`pouncing\` — sit out the busy
floor and enter the moment it clears — runs **1.3–3.1×** over the law, because
everybody's entry is now timed off the same event. At half a metre it collides
**9× more often** than \`patient\` in the same room. Patience is not a
personality, it is a decorrelator.

**From the sound**, aligned to the schedule the floor hands over rather than by
detecting onsets. Stretches the model calls clear are **137×** quieter than the
rest at four players and **30×** at two — and frame by frame, every clear
stretch is under the threshold: **152 of 152, 122 of 122, 462 of 464**. With six
players in a two-metre room there is no clear frame at all in 24 seconds, which
is its own result: the room has no silence left to take a turn in.

And the deadlock is audible at the length the conservation argument predicts.
The envelope's autocorrelation, asked without consulting the schedule:

| after a clash | predicted cycle | strongest lag | strength |
| --- | --- | --- | --- |
| polite | 0.8502 s | **0.8500 s** | 0.803 |
| none | 0.5502 s | **0.5500 s** | 0.765 |
| random | 0.5502 s | 0.5550 s | **0.133** |

Both locked cases land inside one 5 ms frame, which is the resolution.

Levels: 0.345 at the defaults, 0.861 at the loudest setting the panel reaches.
The quiet end is deliberate — see the comment on \`norm\`. Dense settings get
denser rather than louder, because nothing here may clip.
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.2 })
    ctx.onParam('space', (v) => rev.setMix(v))
    /**
     * Keeps the level honest when the density changes.
     *
     * A gain fixed on each note at the moment it is scheduled cannot answer a
     * surge, because the notes are already booked: flipping `Nobody listens`
     * while six players hold four-second phrases spiked to 0.993 pre-limiter
     * with a trailing average. A gain *node* can, and the lookahead scheduler
     * makes it predictive — the floor runs ~0.8 s ahead of the sound, so this
     * is set from a window that is mostly still in the future and starts moving
     * before the surge is audible.
     */
    const norm = ctx.audio.createGain()
    norm.gain.value = 1
    norm.connect(rev.input)
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(norm)
    ctx.cleanup(() => {
      bus.disconnect()
      norm.disconnect()
      rev.dispose()
    })

    // -- the room --------------------------------------------------------------

    let n = Math.round(ctx.params.players)
    let pos = ringPositions(n, ctx.params.room)
    let cfg: Config = {
      n,
      tau: travelTimes(pos),
      patience: ctx.params.patience,
      phrase: ctx.params.phrase,
      react: reactionTimes(n, ctx.params.react, Math.round(ctx.params.seed)),
      manner: ctx.params.manner as Manner,
      backoff: ctx.params.backoff as Backoff,
      deaf: ctx.params.deaf,
      seed: Math.round(ctx.params.seed),
    }
    let floor = new Floor(cfg)
    /** Audio time of simulation time zero. Set on the first pump. */
    let base = -1
    let lastFlushed = -1
    let late = 0
    /** Mean notes ringing at once, over the last ten seconds. Sets the level. */
    let overlap = 1

    const rebuild = () => {
      n = Math.round(ctx.params.players)
      pos = ringPositions(n, ctx.params.room)
      cfg = {
        ...cfg,
        n,
        tau: travelTimes(pos),
        react: reactionTimes(n, ctx.params.react, Math.round(ctx.params.seed)),
        seed: Math.round(ctx.params.seed),
      }
      floor = new Floor(cfg)
      base = -1
      lastFlushed = -1
    }
    // players and seed change the room itself; everything else the floor reads
    // live, so you can flip `polite` on and watch the same players deadlock
    ctx.onParam('players', rebuild)
    ctx.onParam('seed', rebuild)
    ctx.onParam('room', () => {
      pos = ringPositions(n, ctx.params.room)
      cfg.tau = travelTimes(pos)
    })
    ctx.onParam('react', () => {
      cfg.react = reactionTimes(n, ctx.params.react, Math.round(ctx.params.seed))
    })
    ctx.onParam('patience', (v) => (cfg.patience = v))
    ctx.onParam('phrase', (v) => (cfg.phrase = v))
    ctx.onParam('manner', (v) => (cfg.manner = v as Manner))
    ctx.onParam('backoff', (v) => (cfg.backoff = v as Backoff))
    ctx.onParam('deaf', (v) => (cfg.deaf = v))

    // -- the sound -------------------------------------------------------------

    const voice = (who: number, pitch: number, at: number, len: number, gain: number, pan: number) => {
      const t = Math.max(at, ctx.audio.currentTime + 0.004)
      if (at < ctx.audio.currentTime) late++
      const f = mtof(pitch)
      const dec = Math.max(0.06, Math.min(len, 0.55))

      const pn = ctx.audio.createStereoPanner()
      pn.pan.value = pan
      pn.connect(bus)

      const lp = ctx.audio.createBiquadFilter()
      lp.type = 'lowpass'
      lp.Q.value = 1 + (who % 3) * 2
      // opens on the attack and closes again — the shape of a blown note, and
      // the reason a broken-off phrase reads as broken off rather than quiet
      lp.frequency.setValueAtTime(f * 1.4, t)
      lp.frequency.linearRampToValueAtTime(f * (5 + (who % 4)), t + 0.05)
      lp.frequency.exponentialRampToValueAtTime(Math.max(120, f * 1.6), t + dec)
      lp.connect(pn)

      const amp = ctx.audio.createGain()
      amp.gain.setValueAtTime(0, t)
      // 18 ms: players do not click, and a click on every note would read as a
      // pulse, which is the one thing this sketch must not have
      amp.gain.linearRampToValueAtTime(gain, t + 0.018)
      amp.gain.exponentialRampToValueAtTime(Math.max(1e-4, gain * 0.012), t + dec)
      amp.connect(lp)

      const o1 = ctx.audio.createOscillator()
      o1.type = WAVES[who % WAVES.length]
      o1.frequency.value = f
      o1.connect(amp)
      o1.start(t)
      disposeAt(o1, t + dec + 0.05)

      const o2 = ctx.audio.createOscillator()
      o2.type = 'triangle'
      o2.frequency.value = f
      o2.detune.value = 7 - (who % 5) * 3
      const a2 = ctx.audio.createGain()
      a2.gain.value = 0.5
      o2.connect(a2).connect(amp)
      o2.start(t)

      disposeAt(o2, t + dec + 0.05, [a2, amp, lp, pn])
    }

    /** Scale degrees each player sits on, so you can tell them apart. */
    const register = (i: number) => Math.round((i - (n - 1) / 2) * 2.4)

    /**
     * How long note `k` of a turn rings.
     *
     * A player is one instrument. Letting every note decay for 0.55 s over a
     * 0.24 s spacing had each player ringing four notes at once — a player
     * playing chords with themselves, which is not the premise, and which made
     * the pre-limiter peak a matter of how ten oscillators happened to line up.
     * That measured 1.178, 1.700 and 1.199 on three runs of the *same* setting.
     * Ending a note at the next one (plus a little, for legato) bounds what is
     * sounding by the number of players, and the level stops being a lottery.
     */
    const span = (turn: Turn, k: number) => {
      const len = turn.end - turn.start
      const next = k + 1 < turn.notes.length ? Math.min(turn.notes[k + 1].at, len) : len
      return Math.max(0.05, next - turn.notes[k].at)
    }
    const ring = (turn: Turn, k: number) => Math.max(0.06, Math.min(span(turn, k) + 0.08, 0.55))

    const play = (turn: Turn) => {
      const i = turn.who
      const scale = ctx.params.scale as ScaleName
      const root = Math.round(ctx.params.root)
      const len = turn.end - turn.start
      // What sums is notes, not players: a 4 s phrase rings four at once where
      // a 1.2 s one rings two, and counting players left that setting at 1.199
      // pre-limiter, which is clipping.
      //
      // Flat — `norm` does the normalising, and it can move after the fact.
      const gain = 0.46 + ctx.params.level * 0.39
      const x = pos[i]?.[0] ?? 0
      const half = Math.max(0.5, ctx.params.room / 2)
      const pan = clamp(x / half, -1, 1) * 0.75
      for (let k = 0; k < turn.notes.length; k++) {
        const note = turn.notes[k]
        if (note.at >= len - 0.02) break
        voice(i, degree(root, scale, note.deg + register(i)), turn.start + note.at + base, ring(turn, k), gain, pan)
      }
    }

    // -- the transport is only a pump -----------------------------------------
    // There is no pulse here. The clock wakes us up; the floor keeps its own
    // time, and every note is scheduled at an absolute audio time from it. That
    // is also why this is safe in a jam, where bpm belongs to somebody else.

    ctx.clock.onStep((e) => {
      if (base < 0) {
        base = e.time + LEAD
        floor.now = 0
      }
      // Must reach past the *next* step or the gap between two slow steps never
      // gets scheduled and every note in it lands behind the playhead. A jam
      // sets the tempo, not this sketch, so `e.dur` can be anything.
      const horizon = e.time + Math.max(0.25, e.dur * 1.5)
      floor.advance(horizon - base + SETTLE)
      for (const turn of floor.turns) {
        if (turn.id <= lastFlushed) continue
        if (turn.start + SETTLE > floor.now) break
        lastFlushed = turn.id
        play(turn)
      }
      // Mean *notes* ringing at once over the last 3 s of simulation time —
      // total ringing time over the window, which is exactly that. Because the
      // floor leads the sound, most of that window has not been heard yet.
      const win = 3
      const from = floor.now - win
      let sum = 0
      for (const t of floor.turns) {
        const len = t.end - t.start
        for (let k = 0; k < t.notes.length; k++) {
          if (t.notes[k].at >= len - 0.02) break
          const a = Math.max(t.start + t.notes[k].at, from)
          const b = Math.min(t.start + t.notes[k].at + ring(t, k), floor.now)
          if (b > a) sum += b - a
        }
      }
      overlap = sum / win
      // The exponent is 0.75, not the 0.5 an incoherent sum would want, and it
      // is empirical. A peak is not an RMS: a dozen oscillators phase-align
      // when they feel like it, and the densest setting measured 5.77 and 7.66
      // in raw terms on two runs of the *same* config, so it has to cover the
      // spread rather than the average. The consequence is a mixing decision
      // worth stating: a crowded room gets denser, not louder.
      norm.gain.setTargetAtTime(
        1 / Math.pow(Math.max(1, overlap), 0.75),
        Math.max(e.time, ctx.audio.currentTime),
        0.18,
      )
      floor.trim(floor.now - 26)
    })

    ctx.cleanup(
      ctx.clock.onStateChange(() => {
        if (!ctx.clock.running) rebuild()
      }),
    )

    // -- drawing ---------------------------------------------------------------

    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const pad = 9
      const head = 14
      const simNow = base < 0 ? 0 : ctx.audio.currentTime - base

      // -- what it came to ------------------------------------------------------
      const from = Math.max(0, simNow - 20)
      let solo = 0
      let over = 0
      let starts = 0
      let clashed = 0
      let seen = 0
      const edges: Array<[number, number]> = []
      for (const t of floor.turns) {
        if (t.start >= from && t.end <= simNow) {
          seen++
          if (t.collided) clashed++
        }
        if (t.start >= from) starts++
        const a = Math.max(t.start, from)
        const b = Math.min(t.end, simNow)
        if (b > a) {
          edges.push([a, 1], [b, -1])
        }
      }
      edges.sort((p, q) => p[0] - q[0] || p[1] - q[1])
      let k = 0
      let prev = from
      for (const [t, d] of edges) {
        if (t > prev) {
          if (k === 1) solo += t - prev
          else if (k > 1) over += t - prev
          prev = t
        }
        k += d
      }
      const span = Math.max(1e-6, simNow - from)
      const silence = 1 - (solo + over) / span
      const rate = starts / span / n
      const predicted = cfg.deaf ? NaN : 1 - senseCleanMean(cfg.tau, rate / Math.max(0.02, silence))

      let meanTau = 0
      let pairs = 0
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i !== j) {
            meanTau += cfg.tau[i][j]
            pairs++
          }
        }
      }
      meanTau = pairs ? meanTau / pairs : 0

      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.62)'
      g.fillText(
        `${n} players, ${ctx.params.room.toFixed(1)} m — ${(meanTau * 1000).toFixed(1)} ms across` +
          `   silence ${(silence * 100).toFixed(0)}%  one ${((solo / span) * 100).toFixed(0)}%  over ${((over / span) * 100).toFixed(0)}%` +
          (cfg.deaf ? '   — nobody listening' : `   clash ${seen ? ((clashed / seen) * 100).toFixed(1) : '—'}% vs ${(predicted * 100).toFixed(1)}% predicted`),
        pad,
        pad + 10,
      )

      const top = pad + head
      const roomW = Math.min(Math.max(96, h - top - pad), (w - pad * 3) * 0.32)
      const laneX = pad + roomW + 12
      const laneW = w - laneX - pad
      const roomH = Math.min(roomW, h - top - pad)

      // -- the room, with the sound in it ---------------------------------------
      const cx = pad + roomW / 2
      const cy = top + roomH / 2
      const R = Math.min(roomW, roomH) / 2 - 12
      const metres = Math.max(1, ctx.params.room) / 2
      g.strokeStyle = 'rgba(255,255,255,0.08)'
      g.beginPath()
      g.arc(cx, cy, R, 0, Math.PI * 2)
      g.stroke()

      // Wavefronts: each turn's sound, spreading out from whoever started it.
      // A player knows nothing of a turn whose circle has not reached them yet,
      // which is the entire mechanism — but at 343 m/s a twelve-metre room is
      // crossed in 35 ms, which is two frames and invisible. So this runs at
      // 1/SLOW speed and says so. It is the one thing here not in real time.
      for (const t of floor.turns) {
        const age = (simNow - t.start) * (1 / SLOW)
        if (age < 0 || age > (metres * 2) / C_AIR) continue
        const rad = ((age * C_AIR) / metres) * R
        const p = pos[t.who]
        if (!p) continue
        const fade = 1 - rad / (R * 2)
        g.strokeStyle = COLOURS[t.who % COLOURS.length]
        g.globalAlpha = Math.max(0, fade) * (t.collided ? 0.7 : 0.4)
        g.lineWidth = t.collided ? 2 : 1
        g.beginPath()
        g.arc(cx + (p[0] / metres) * R, cy + (p[1] / metres) * R, rad, 0, Math.PI * 2)
        g.stroke()
        g.globalAlpha = 1
      }
      g.fillStyle = 'rgba(255,255,255,0.3)'
      g.font = '9px ui-monospace, monospace'
      g.fillText(`sound, ${SLOW}× slower`, pad + 2, top + roomH - 2)
      g.font = '11px ui-monospace, monospace'

      for (let i = 0; i < n; i++) {
        const p = pos[i]
        const px = cx + (p[0] / metres) * R
        const py = cy + (p[1] / metres) * R
        const cur = floor.turns.find((t) => t.who === i && t.start <= simNow && simNow < t.end)
        g.fillStyle = cur ? COLOURS[i % COLOURS.length] : 'rgba(255,255,255,0.22)'
        g.beginPath()
        g.arc(px, py, cur ? 6 : 3.5, 0, Math.PI * 2)
        g.fill()
      }

      // -- who had the floor ----------------------------------------------------
      const laneH = (h - top - pad) / n
      const window = 16
      const xOf = (t: number) => laneX + ((t - (simNow - window)) / window) * laneW
      for (let i = 0; i < n; i++) {
        const y = top + i * laneH
        g.fillStyle = 'rgba(255,255,255,0.03)'
        g.fillRect(laneX, y + 2, laneW, laneH - 4)
      }
      // A bar the full height of a lane is a wall of colour at two players, so
      // cap it and centre it — the lane is the axis, the bar is the event.
      const hh = Math.max(5, Math.min(laneH - 8, 30))
      const lo = laneX
      const hi = laneX + laneW
      for (const t of floor.turns) {
        const y = top + t.who * laneH + (laneH - hh) / 2
        const a = xOf(t.start)
        const b = xOf(Math.min(t.end, simNow))
        if (b <= lo || a >= hi) continue
        // what they meant to play, as an outline — clipped to the lane, or it
        // draws over the room
        if (t.end < t.wanted) {
          const wl = Math.max(a, lo)
          const wr = Math.min(xOf(t.wanted), hi)
          if (wr > wl) {
            g.strokeStyle = 'rgba(255,255,255,0.18)'
            g.lineWidth = 1
            g.strokeRect(wl, y + 0.5, Math.max(1, wr - wl), hh - 1)
          }
        }
        g.fillStyle = t.collided ? '#ef4444' : COLOURS[t.who % COLOURS.length]
        g.globalAlpha = t.collided ? 0.9 : 0.78
        g.fillRect(Math.max(a, lo), y, Math.max(1.5, Math.min(b, hi) - Math.max(a, lo)), hh)
        g.globalAlpha = 1
      }
      // the vulnerable window, to scale, against the lanes
      const vw = (meanTau / window) * laneW
      g.fillStyle = 'rgba(239,68,68,0.5)'
      g.fillRect(laneX + laneW - 2, top, 2, h - top - pad)
      g.fillStyle = 'rgba(239,68,68,0.16)'
      g.fillRect(laneX + laneW - 2 - vw * 2, top, vw * 2, h - top - pad)
      if (late > 0) {
        g.fillStyle = 'rgba(239,68,68,0.9)'
        g.fillText(`${late} late`, laneX, h - pad)
      }
    })

    // -- for the harness --------------------------------------------------------
    const api = {
      set: (k: string, v: unknown) => ctx.set(k as never, v as never),
      /** Everything the floor has decided, so the audio can be checked against it. */
      turns: () => floor.turns.map((t) => ({ ...t, audio: t.start + base })),
      cfg: () => ({ ...cfg, base }),
      pitches: () => {
        const scale = ctx.params.scale as ScaleName
        const root = Math.round(ctx.params.root)
        return Array.from({ length: n }, (_, i) => degree(root, scale, register(i)))
      },
      late: () => late,
      overlap: () => overlap,
      /** After the normaliser — tapping `bus` would miss the thing under test. */
      tap: () => norm,
    }
    ;(window as unknown as Record<string, unknown>).__afteryou = () => api
    ctx.cleanup(() => delete (window as unknown as Record<string, unknown>).__afteryou)
  },
})
