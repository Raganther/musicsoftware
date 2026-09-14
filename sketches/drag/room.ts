/**
 * An ensemble correcting toward what it hears, across a room.
 *
 * Sound travels at 343 m/s, so a player ten metres away is heard 29 ms late.
 * That single fact has a consequence nobody in the room can argue with: when
 * everyone is perfectly together, **everyone still hears everyone else as
 * late**, because the sound they are hearing left before now.
 *
 * A player who corrects toward what they hear therefore waits. All of them
 * wait. The ensemble slows down — not once, but every beat, and against nobody's
 * intention. It is why a large ensemble without a conductor drags, and it is
 * arithmetic rather than a failure of anyone's playing.
 *
 * What stops it is each player's own memory of the tempo they meant, pulling
 * back at γ. That balance lands the ensemble at a settled tempo slower than any
 * of them intends, by (β/γ)·τ. Set γ = 0 and there is no balance to find.
 *
 * `entrain` asked how *fast* an ensemble agrees — the rate is the listening
 * graph's algebraic connectivity. This asks what it agrees *on*.
 */

/** Speed of sound in air, m/s. */
export const C = 343

export type Layout = 'ring' | 'line' | 'clump' | 'scatter'
export const LAYOUTS: Layout[] = ['ring', 'line', 'clump', 'scatter']

export interface Pt {
  x: number
  y: number
}

/** Where the players stand, in metres, centred on the origin. */
export function positions(layout: Layout, n: number, spread: number, seed: number): Pt[] {
  const r = spread / 2
  const out: Pt[] = []
  // A deterministic hash, so a position depends on the seed and its own index
  // only — dragging one player must not move the others.
  const rand = (i: number, k: number) => {
    let h = (seed * 73856093) ^ (i * 19349663) ^ (k * 83492791)
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / n
    switch (layout) {
      case 'ring':
        out.push({ x: r * Math.cos(2 * Math.PI * t), y: r * Math.sin(2 * Math.PI * t) })
        break
      case 'line':
        out.push({ x: -r + (n === 1 ? r : (2 * r * i) / (n - 1)), y: 0 })
        break
      case 'clump':
        // Everyone close except one player stranded at the far edge. The
        // asymmetric case — and the one that shows the drag rate is the
        // ensemble's rather than anyone's own.
        out.push(
          i === n - 1
            ? { x: r, y: 0 }
            : { x: -r + r * 0.18 * rand(i, 1), y: r * 0.18 * (rand(i, 2) - 0.5) },
        )
        break
      default:
        out.push({ x: r * (2 * rand(i, 1) - 1), y: r * (2 * rand(i, 2) - 1) })
    }
  }
  return out
}

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

/** How much of player j player i attends to. Falls off with distance. */
export function weight(d: number, earshot: number): number {
  return 1 / (1 + (d / Math.max(0.01, earshot)) ** 2)
}

/** The delay player i perceives on average: weighted mean travel time to the rest. */
export function meanDelay(pos: Pt[], i: number, earshot: number): number {
  let num = 0
  let den = 0
  for (let j = 0; j < pos.length; j++) {
    if (j === i) continue
    const d = dist(pos[i], pos[j])
    const w = weight(d, earshot)
    num += w * (d / C)
    den += w
  }
  return den > 0 ? num / den : 0
}

/**
 * The delay that sets the ensemble's drag: each player's mean delay, weighted
 * by how much the ensemble attends to that player.
 *
 * Not the individual's — measured, the players all drag at one rate however far
 * apart their own mean delays are. A player stranded at the back of the room
 * hears everyone 86 ms late where the huddle hears each other at 19, and all six
 * drag at exactly the same rate. You cannot improve your own drag by standing
 * closer to someone.
 *
 * But it is not the plain average either, and I had it as one. The weight is the
 * stationary distribution of the row-normalised listening matrix — how much each
 * player is *listened to*. With uniform earshot everyone is attended to equally,
 * the two are identical to 0.0000%, and that is every case the plain version was
 * checked against. Narrow the earshot and they part company: the huddle stops
 * hearing the stranded player while still being heard by them, so the huddle's
 * own short delays count for more than their share. Plain: 20.67 ms and
 * 111.26 bpm. Weighted: 5.69 ms and 117.46. Heard in the recording: 117.457.
 *
 * Which says something worth having: the tempo is set by the delays of the
 * players everybody listens to. The one nobody can hear does not drag the room.
 */
export function dragDelay(pos: Pt[], earshot: number): number {
  const n = pos.length
  if (n < 2) return 0

  // row-normalised: how much of player i's attention goes to player j
  const W: number[][] = []
  for (let i = 0; i < n; i++) {
    const row: number[] = []
    let s = 0
    for (let j = 0; j < n; j++) {
      const w = i === j ? 0 : weight(dist(pos[i], pos[j]), earshot)
      row.push(w)
      s += w
    }
    W.push(s > 0 ? row.map((v) => v / s) : row.map(() => 1 / Math.max(1, n - 1)))
  }

  // left eigenvector by power iteration — how much each player is attended to
  let p = new Array<number>(n).fill(1 / n)
  for (let it = 0; it < 400; it++) {
    const q = new Array<number>(n).fill(0)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) q[j] += p[i] * W[i][j]
    const s = q.reduce((a, b) => a + b, 0)
    if (s <= 0) break
    let moved = 0
    for (let i = 0; i < n; i++) {
      const v = q[i] / s
      moved += Math.abs(v - p[i])
      p[i] = v
    }
    if (moved < 1e-14) break
  }

  let out = 0
  for (let i = 0; i < n; i++) out += p[i] * meanDelay(pos, i, earshot)
  return out
}

/**
 * The beat the room actually settles on, in seconds — slower than the tempo
 * any of the players intends.
 *
 * Two separate terms, and I had only one of them at first:
 *
 *   - period correction pushes the period up by β·τ every beat and the memory
 *     of the intended tempo pulls back by γ of the error, balancing the
 *     *period* at T + (β/γ)·τ;
 *   - phase correction then adds a further α·τ to every beat, because a player
 *     who hears the others late waits that much before playing, every time.
 *
 * The heard gap is what is measurable, so both count. Predicting only the
 * period was 6.4% out at 40 m and 0.8% at 5 m — an error that grows with the
 * room, which is how a missing term proportional to τ announces itself.
 *
 * Only the *ratio* β/γ matters, not either alone: β 0.05 with γ 0.10 and β 0.15
 * with γ 0.30 settle on the same tempo to six figures.
 */
export function settled(T: number, alpha: number, beta: number, gamma: number, tau: number): number {
  return gamma <= 0 ? Infinity : T + (alpha + beta / gamma) * tau
}

export interface Run {
  /** onset[i][n] — when player i played its n-th beat, in seconds. */
  onset: number[][]
  /** period[i][n] — the period player i intended for that beat. */
  period: number[][]
}

export interface Opts {
  pos: Pt[]
  /** Nominal period, seconds per beat. */
  T: number
  /** Phase correction: how much of the heard asynchrony lands on this beat. */
  alpha: number
  /** Period correction: how much of it lands on the tempo, and stays. */
  beta: number
  /** How strongly each player's memory of the intended tempo pulls back. */
  gamma: number
  /** 0 = listen only to the others, 1 = watch only the conductor. */
  conductor: number
  earshot: number
  /** Longest period allowed, as a multiple of T, so a runaway stays playable. */
  cap?: number
}

/**
 * Run the ensemble for `beats` beats.
 *
 * Each player corrects toward the weighted mean of the asynchronies it
 * perceives — and a perceived asynchrony carries the travel time, which is the
 * term that never goes away. A conductor is *seen*, so it contributes no delay,
 * which is the entire reason conductors exist.
 */
export function simulate(o: Opts, beats: number): Run {
  const n = o.pos.length
  const cap = (o.cap ?? 4) * o.T
  const tau: number[][] = []
  const w: number[][] = []
  for (let i = 0; i < n; i++) {
    tau.push([])
    w.push([])
    for (let j = 0; j < n; j++) {
      const d = dist(o.pos[i], o.pos[j])
      tau[i].push(d / C)
      w[i].push(i === j ? 0 : weight(d, o.earshot))
    }
  }

  const onset: number[][] = Array.from({ length: n }, () => [0])
  const period: number[][] = Array.from({ length: n }, () => [o.T])
  let t = Array(n).fill(0)
  let T = Array(n).fill(o.T)
  let baton = 0

  for (let b = 0; b < beats; b++) {
    const nt = Array(n).fill(0)
    const nT = Array(n).fill(0)
    for (let i = 0; i < n; i++) {
      let num = 0
      let den = 0
      for (let j = 0; j < n; j++) {
        if (j === i) continue
        // what player i HEARS: j's onset, arriving tau later
        num += w[i][j] * (t[j] + tau[i][j] - t[i])
        den += w[i][j]
      }
      const heard = den > 0 ? num / den : 0
      const seen = baton - t[i]
      const e = (1 - o.conductor) * heard + o.conductor * seen
      nt[i] = t[i] + T[i] + o.alpha * e
      nT[i] = Math.min(cap, Math.max(0.05 * o.T, T[i] + o.beta * e - o.gamma * (T[i] - o.T)))
    }
    t = nt
    T = nT
    baton += o.T
    for (let i = 0; i < n; i++) {
      onset[i].push(t[i])
      period[i].push(T[i])
    }
  }
  return { onset, period }
}

/** Least-squares slope of y against its index — seconds of period per beat. */
export function slope(y: number[], from = 0): number {
  const n = y.length - from
  if (n < 3) return 0
  let sx = 0
  let sy = 0
  let sxy = 0
  let sxx = 0
  for (let k = 0; k < n; k++) {
    const x = k
    sx += x
    sy += y[from + k]
    sxy += x * y[from + k]
    sxx += x * x
  }
  return (n * sxy - sx * sy) / (n * sxx - sx * sx)
}
