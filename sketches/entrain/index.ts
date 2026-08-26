import { clamp, degree, disposeAt, mtof, reverb, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'

/**
 * An ensemble with no conductor, agreeing on a tempo by ear alone.
 *
 * `conduct` gave the players a leader and measured how far behind they ran.
 * This takes the leader away. Every player starts at its own tempo, hears an
 * onset from some of the others, and nudges itself — and the only question
 * that matters is *who can hear whom*.
 *
 * That question has a sharp answer, which is why this is worth building rather
 * than asserting. Near agreement the ensemble is a linear consensus system on
 * the listening graph, so the disagreement in tempo decays at a rate set by the
 * graph's **algebraic connectivity** λ₂ — the second-smallest eigenvalue of its
 * Laplacian. Same players, same ears, same correction strength: only the wiring
 * changes, and the wiring alone should predict the convergence rate.
 *
 * The four shapes here have textbook λ₂ and at 8 players they span 70×:
 *
 *     line   2(1−cos(π/n))    0.152     a chain — each hears its neighbours
 *     ring   2(1−cos(2π/n))   0.586     the chain closed up
 *     star   1                1.000     everyone hears one player, who hears all
 *     all    n                8.000     everyone hears everyone
 *
 * so a ring of eight musicians listening only sideways should take roughly
 * seventy times as long to agree as eight musicians all listening to each
 * other. That is a claim about drum circles, and it is measurable.
 *
 * Two corrections, deliberately separate. Hearing a beat from someone I listen
 * to, I move my *next* beat toward theirs (phase) and I adjust my *period* by
 * how much they have drifted since I last heard them (tempo). The second one is
 * exactly T_i += β(T_j − T_i), which is consensus and nothing else — writing it
 * as a drift rather than as an offset is what keeps it working when the players
 * are deliberately out of phase.
 *
 * Because `Phase pull` can go negative. At zero it repels: each player pushes
 * its beat *away* from everyone it can hear, and eight of them settle evenly
 * spread around the bar. Nobody chose that rhythm and nobody is playing it —
 * it is what is left when a group agrees on a tempo and refuses to agree on a
 * downbeat.
 */

interface Player {
  /** Current period in seconds — the thing they are trying to agree on. */
  period: number
  natural: number
  /** Absolute audio time of the next onset. */
  next: number
  midi: number
  pan: number
  beats: number
}

/** Eigenvalues of a small symmetric matrix, ascending. Cyclic Jacobi. */
function eigenvalues(m: number[][]): number[] {
  const n = m.length
  const a = m.map((r) => r.slice())
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q]
    if (off < 1e-20) break
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-16) continue
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = (theta < 0 ? -1 : 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const kp = a[k][p]
          const kq = a[k][q]
          a[k][p] = c * kp - s * kq
          a[k][q] = s * kp + c * kq
        }
        for (let k = 0; k < n; k++) {
          const pk = a[p][k]
          const qk = a[q][k]
          a[p][k] = c * pk - s * qk
          a[q][k] = s * pk + c * qk
        }
      }
    }
  }
  return a.map((r, i) => r[i]).sort((x, y) => x - y)
}

const GRAPHS = ['ring', 'line', 'star', 'all', 'random'] as const
type GraphName = (typeof GRAPHS)[number]

export default defineSketch({
  title: 'Entrain',
  description: 'An ensemble with no conductor. How fast they agree is decided by who can hear whom.',
  tags: ['improvisation', 'rhythm', 'generative'],
  status: 'promising',
  bpm: 96,
  division: 4,

  params: {
    players: { type: 'number', value: 8, min: 3, max: 12, step: 1, label: 'Players' },
    graph: { type: 'select', value: 'ring', options: [...GRAPHS], label: 'Who hears whom' },
    phase: { type: 'number', value: 0.18, min: -0.4, max: 0.6, step: 0.01, label: 'Phase pull (− pushes apart)' },
    tempo: { type: 'number', value: 0.15, min: 0, max: 0.4, step: 0.005, label: 'Tempo pull' },
    spread: { type: 'number', value: 18, min: 0, max: 40, step: 1, label: 'Starting disagreement', unit: '%' },
    base: { type: 'number', value: 96, min: 40, max: 240, step: 1, label: 'Middle tempo', unit: 'bpm' },
    decay: { type: 'number', value: 0.26, min: 0.05, max: 1, step: 0.01, label: 'Ping length', unit: 's' },
    space: { type: 'number', value: 0.22, min: 0, max: 0.6, step: 0.01, label: 'Room' },
    level: { type: 'number', value: 0.5, min: 0, max: 1 },
    root: { type: 'number', value: 57, min: 40, max: 72, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'major', options: [...SCALE_NAMES], label: 'Scale' },
    seed: { type: 'number', value: 3, min: 1, max: 999, step: 1 },
    again: { type: 'button', label: 'Scatter them again' },
  },

  notes: `
TODO:measure
`,

  setup(ctx) {
    const rev = reverb(ctx.out, { mix: ctx.params.space, seconds: 2.0 })
    ctx.onParam('space', (v) => rev.setMix(v))
    const bus = ctx.audio.createGain()
    bus.gain.value = 1
    bus.connect(rev.input)
    ctx.cleanup(() => {
      bus.disconnect()
      rev.dispose()
    })

    /**
     * A pure sine per player. No harmonics means each player owns a band of
     * the spectrum outright, which is what lets an analyser say whose beat is
     * whose — otherwise "they converged" is a claim about a picture I drew.
     * 8 ms of attack, not 3: a fast ramp on a sine is a broadband click and
     * the splatter lands in everyone else's band at the same instant.
     */
    const ping = (p: Player, time: number, gain: number) => {
      const osc = ctx.audio.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = mtof(p.midi)
      const amp = ctx.audio.createGain()
      amp.gain.value = 0
      const pan = ctx.audio.createStereoPanner()
      pan.pan.value = p.pan
      osc.connect(amp).connect(pan).connect(bus)
      const d = ctx.params.decay
      amp.gain.setValueAtTime(0, time)
      amp.gain.linearRampToValueAtTime(gain, time + 0.008)
      amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.02), time + d)
      osc.start(time)
      disposeAt(osc, time + d + 0.05, [amp, pan])
    }

    // -- the ensemble ----------------------------------------------------------

    let players: Player[] = []
    /** listens[i] — the players i can hear. Undirected, so it is symmetric. */
    let listens: number[][] = []
    let lambda2 = 0
    /** prevErr[i * N + j], and whether i has heard j at all yet. */
    let prevErr = new Float64Array(0)
    let heard = new Uint8Array(0)
    let origin = -1
    /** Times when a phase correction had to be clipped to avoid time travel. */
    let clips = 0
    /** Smoothed Kuramoto order, used to keep the level steady as they gather. */
    let coh = 0
    /** Every onset the model scheduled: the known-answer channel. */
    let log: { t: number; i: number }[] = []
    /**
     * Every player's period, sampled with a timestamp. Time, not beats — the
     * first version sampled once per beat of player 0, which makes the x axis
     * depend on how far player 0 happens to be from the mean and biased every
     * decay rate by that much.
     */
    let trace: { t: number; p: number[] }[] = []

    const buildGraph = (n: number, name: GraphName, r: ReturnType<typeof rng>) => {
      const adj: number[][] = Array.from({ length: n }, () => [])
      const link = (a: number, b: number) => {
        if (a === b || adj[a].includes(b)) return
        adj[a].push(b)
        adj[b].push(a)
      }
      if (name === 'line') for (let i = 0; i + 1 < n; i++) link(i, i + 1)
      else if (name === 'ring') for (let i = 0; i < n; i++) link(i, (i + 1) % n)
      else if (name === 'star') for (let i = 1; i < n; i++) link(0, i)
      else if (name === 'all') for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) link(i, j)
      else {
        // A random spanning tree first, so it is always connected — a
        // disconnected ensemble has λ₂ = 0 and simply never agrees.
        for (let i = 1; i < n; i++) link(i, Math.floor(r.next() * i))
        for (let k = 0; k < n; k++) link(Math.floor(r.next() * n), Math.floor(r.next() * n))
      }
      return adj
    }

    const build = () => {
      const n = Math.round(ctx.params.players)
      const r = rng(Math.round(ctx.params.seed))
      const mid = 60 / ctx.params.base
      const sp = ctx.params.spread / 100
      const root = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      players = []
      for (let i = 0; i < n; i++) {
        // Spread across three octaves of the scale whatever the headcount, so
        // no two players are closer than about a fourth. That is a voicing
        // choice and also a measurement one: pure sines a fourth apart sit in
        // bands an analyser can separate, and "they converged" has to be
        // readable from the sound rather than from the picture I drew.
        const midi = degree(root, scale, Math.round((i * 21) / Math.max(1, n - 1)))
        const period = mid * (1 + (r.next() - 0.5) * 2 * sp)
        players.push({
          period,
          natural: period,
          next: 0,
          midi,
          pan: n === 1 ? 0 : (i / (n - 1) - 0.5) * 1.4,
          beats: 0,
        })
      }
      listens = buildGraph(n, ctx.params.graph as GraphName, r)
      const lap = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => (i === j ? listens[i].length : listens[i].includes(j) ? -1 : 0)),
      )
      lambda2 = eigenvalues(lap)[1]
      prevErr = new Float64Array(n * n)
      heard = new Uint8Array(n * n)
      origin = -1
      clips = 0
      log = []
      trace = []
    }
    /** Repitch without restarting. A jam broadcasts the key into `root` and
     *  `scale`, and throwing away thirty seconds of convergence because someone
     *  changed key would be the wrong response to it. */
    const retune = () => {
      const n = players.length
      const root = Math.round(ctx.params.root)
      const scale = ctx.params.scale as ScaleName
      players.forEach((p, i) => {
        p.midi = degree(root, scale, Math.round((i * 21) / Math.max(1, n - 1)))
      })
    }
    build()
    for (const k of ['graph', 'spread', 'base', 'seed'] as const) ctx.onParam(k, build)
    for (const k of ['root', 'scale'] as const) ctx.onParam(k, retune)
    // Scene morph glides numeric params, so `players` would otherwise rebuild
    // the ensemble on every frame of a recall. Only a real change counts.
    ctx.onParam('players', (v) => {
      if (Math.round(v) !== players.length) build()
    })
    ctx.onPress('again', build)
    ctx.cleanup(ctx.clock.onStateChange(() => !ctx.clock.running && build()))

    /**
     * Player i has just heard j strike at time t.
     *
     * Phase: move my next beat toward theirs. Positive pulls together, negative
     * pushes apart.
     *
     * Tempo: adjust my period by how far j has *drifted* since I last heard
     * them, which is exactly T_j − T_i and so is exactly consensus. Using the
     * drift rather than the offset is what makes this work at any phase
     * relationship — with `phase` negative the players sit half a bar apart on
     * purpose, and an offset-based rule would read that as a tempo error and
     * run away. The phase correction moves my beat too, so its shift is taken
     * back out of the stored error before the next comparison.
     */
    const hear = (i: number, j: number, t: number) => {
      const p = players[i]
      const T = p.period
      let err = t - p.next
      err -= T * Math.round(err / T)

      const k = i * players.length + j
      if (heard[k]) {
        let d = err - prevErr[k]
        d -= T * Math.round(d / T)
        p.period = clamp(p.period + ctx.params.tempo * d, 0.12, 4)
      }
      prevErr[k] = err
      heard[k] = 1

      const shift = ctx.params.phase * err
      p.next += shift
      for (let q = 0; q < players.length; q++) prevErr[i * players.length + q] -= shift
      // A correction must never move a beat into the past, or the event loop
      // walks backwards. The algebra says it cannot: next ≥ t before the shift,
      // and next + φ(t − next) = (1−φ)·next + φ·t ≥ t for any φ ≤ 1. So this is
      // an assertion, and it is counted — the first version clamped to t + 0.1 ms
      // instead of t, which fired on every pair that happened to land on the
      // same instant and quietly walked every beat later.
      if (p.next < t) {
        p.next = t
        clips++
      }
    }

    ctx.clock.onStep((e) => {
      if (origin < 0) {
        origin = e.time + 0.1
        // Scattered starts as well as scattered tempi — otherwise a ring is
        // already in phase and only the tempo has anything to agree about.
        const r = rng(Math.round(ctx.params.seed) * 31 + 7)
        for (const p of players) p.next = origin + r.next() * p.period
        for (const p of players) p.beats = 0
      }
      const n = players.length
      const horizon = e.time + e.dur * 2
      /**
       * Neither n nor sqrt(n) works here, because the sketch deliberately moves
       * between the two regimes. Scattered, n pings land at n different instants
       * and the peak is one ping; agreed, they land together and the peak is n
       * pings. Dividing by sqrt(n) put the master at 2.3, dividing by n put it
       * at 0.08, and both were right about one half of the piece.
       *
       * So divide by how coherent they actually are. At r = 0 that is 1 and each
       * ping is full size; at r = 1 it is n and the stack is full size. The peak
       * stays put while the texture changes, which is the point — an ensemble
       * should not get six times louder for agreeing with itself. Smoothed,
       * because the instantaneous order parameter jitters and would pump.
       */
      coh += (order().r - coh) * 0.04
      const gain = (0.28 + ctx.params.level * 0.36) / (1 + (n - 1) * coh)

      for (let guard = 0; guard < 512; guard++) {
        let j = 0
        for (let i = 1; i < n; i++) if (players[i].next < players[j].next) j = i
        const t = players[j].next
        if (t > horizon) break

        ping(players[j], Math.max(t, ctx.audio.currentTime + 0.005), gain)
        log.push({ t, i: j })
        if (log.length > 4000) log.shift()
        players[j].beats++
        if (j === 0 && trace.length < 4000) trace.push({ t, p: players.map((q) => q.period) })

        for (const i of listens[j]) hear(i, j, t)
        players[j].next = t + players[j].period
      }
    })

    // -- what the ensemble currently looks like --------------------------------

    /** Kuramoto order: 1 when everyone is on the same beat, 0 when scattered. */
    const order = () => {
      let x = 0
      let y = 0
      for (const p of players) {
        // Phase measured backwards from the next beat, so it does not depend on
        // when the last one happened to be.
        const ph = 1 - ((p.next - ctx.audio.currentTime) / p.period) % 1
        x += Math.cos(2 * Math.PI * ph)
        y += Math.sin(2 * Math.PI * ph)
      }
      return { r: Math.hypot(x, y) / players.length, a: Math.atan2(y, x) }
    }

    /** Standard deviation of the periods — the thing that should decay. */
    const spreadNow = () => {
      const m = players.reduce((a, p) => a + p.period, 0) / players.length
      return Math.sqrt(players.reduce((a, p) => a + (p.period - m) ** 2, 0) / players.length)
    }

    // -- drawing ---------------------------------------------------------------

    const hist: number[] = []
    ctx.canvas((g, { w, h }) => {
      g.clearRect(0, 0, w, h)
      const n = players.length
      const pad = 14
      const top = 16
      const circleH = Math.max(120, Math.min(h * 0.52, w * 0.4))
      const cx = pad + circleH / 2
      const cy = top + circleH / 2
      const rad = circleH / 2 - 18

      const hue = (i: number) => `hsl(${(i * 360) / n + 195}, 72%, 62%)`
      const phaseOf = (p: Player) => {
        const v = 1 - ((p.next - ctx.audio.currentTime) / p.period) % 1
        return (v % 1) * Math.PI * 2 - Math.PI / 2
      }

      // the listening graph, drawn where the players actually are
      g.strokeStyle = 'rgba(255,255,255,0.13)'
      g.lineWidth = 1
      for (let i = 0; i < n; i++) {
        for (const j of listens[i]) {
          if (j < i) continue
          const a = phaseOf(players[i])
          const b = phaseOf(players[j])
          g.beginPath()
          g.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad)
          g.lineTo(cx + Math.cos(b) * rad, cy + Math.sin(b) * rad)
          g.stroke()
        }
      }
      g.strokeStyle = 'rgba(255,255,255,0.16)'
      g.beginPath()
      g.arc(cx, cy, rad, 0, Math.PI * 2)
      g.stroke()

      players.forEach((p, i) => {
        const a = phaseOf(p)
        const x = cx + Math.cos(a) * rad
        const y = cy + Math.sin(a) * rad
        // size tracks how far this player still is from the ensemble's tempo
        const mean = players.reduce((s, q) => s + q.period, 0) / n
        const off = Math.min(1, Math.abs(p.period - mean) / (mean * 0.08))
        g.fillStyle = hue(i)
        g.beginPath()
        g.arc(x, y, 3.5 + off * 5, 0, Math.PI * 2)
        g.fill()
      })

      // the order vector — its length is r, and it is the thing that goes to 1
      const o = order()
      g.strokeStyle = 'rgba(255,255,255,0.75)'
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(cx, cy)
      g.lineTo(cx + Math.cos(o.a - Math.PI / 2) * rad * o.r, cy + Math.sin(o.a - Math.PI / 2) * rad * o.r)
      g.stroke()
      g.font = '10px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.34)'
      g.fillText(`order ${o.r.toFixed(3)}`, cx - 26, cy + rad + 14)

      // -- the tempos, converging (or not) --------------------------------------
      const gx = pad + circleH + 24
      const gw = w - gx - pad
      const gy = top
      const gh = circleH
      const s = spreadNow()
      hist.push(s)
      if (hist.length > 900) hist.shift()

      g.fillStyle = 'rgba(255,255,255,0.03)'
      g.fillRect(gx, gy, gw, gh)
      if (gw > 40) {
        // log scale: consensus decays exponentially, so the claim is a straight
        // line here and a curve is a different claim
        const top10 = 1e-1
        const bot10 = 1e-6
        const sy = (v: number) =>
          gy + gh - (Math.log10(Math.max(bot10, v) / bot10) / Math.log10(top10 / bot10)) * gh
        for (const dec of [-1, -2, -3, -4, -5]) {
          const y = sy(Math.pow(10, dec))
          g.strokeStyle = 'rgba(255,255,255,0.07)'
          g.beginPath()
          g.moveTo(gx, y)
          g.lineTo(gx + gw, y)
          g.stroke()
          g.fillStyle = 'rgba(255,255,255,0.22)'
          g.fillText(`1e${dec}`, gx + 3, y - 2)
        }
        g.strokeStyle = 'rgba(125,211,252,0.9)'
        g.lineWidth = 1.5
        g.beginPath()
        hist.forEach((v, i) => {
          const x = gx + (i / Math.max(1, hist.length - 1)) * gw
          const y = sy(v)
          i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
        })
        g.stroke()
        g.fillStyle = 'rgba(255,255,255,0.34)'
        g.fillText('tempo disagreement, seconds (log)', gx + 3, gy - 4)
      }

      // -- the claim, in numbers ------------------------------------------------
      const mean = players.reduce((a, p) => a + p.period, 0) / n
      const natural = players.reduce((a, p) => a + p.natural, 0) / n
      const y0 = top + circleH + 26
      g.font = '11px ui-monospace, monospace'
      g.fillStyle = 'rgba(255,255,255,0.75)'
      g.fillText(
        `${ctx.params.graph} · ${n} players · λ₂ = ${lambda2.toFixed(3)}` +
          `   ·   predicted decay ${(-Math.log(Math.abs(1 - ctx.params.tempo * lambda2) || 1e-9)).toFixed(3)} per beat`,
        pad,
        y0,
      )
      g.fillStyle = 'rgba(255,255,255,0.5)'
      g.fillText(
        `now ${(60 / mean).toFixed(2)} bpm · they started at a mean of ${(60 / natural).toFixed(2)}` +
          `   ·   disagreement ${s.toExponential(2)} s`,
        pad,
        y0 + 15,
      )
      g.fillStyle = 'rgba(255,255,255,0.32)'
      g.font = '10px ui-monospace, monospace'
      g.fillText(
        ctx.params.phase < 0
          ? 'phase pull is negative — they agree on the tempo and refuse to agree on the downbeat'
          : 'phase pull is positive — they are trying to land together',
        pad,
        y0 + 31,
      )
      if (clips > 0) {
        g.fillStyle = 'rgba(248,113,113,0.6)'
        g.fillText(`${clips} corrections clipped`, pad, y0 + 46)
      }
    })

    // A read-only snapshot for the harness.
    const wnd = window as unknown as Record<string, unknown>
    wnd.__entrain = () => ({
      periods: players.map((p) => p.period),
      naturals: players.map((p) => p.natural),
      beats: players.map((p) => p.beats),
      freqs: players.map((p) => mtof(p.midi)),
      listens: listens.map((l) => l.slice()),
      lambda2,
      spread: spreadNow(),
      order: order().r,
      clips,
      /** every onset the model scheduled, as {t, i} — the known answer */
      log: log.slice(),
      /** every player's period against audio time */
      trace: trace.map((r) => ({ t: r.t, p: r.p.slice() })),
    })
    ctx.cleanup(() => delete wnd.__entrain)

    ctx.status('no conductor — who can hear whom is the only thing that decides how fast they agree')
  },
})
