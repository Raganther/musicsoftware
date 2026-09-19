/**
 * Turn-taking on a shared floor, with the speed of sound in it.
 *
 * N improvisers, no pulse. Each waits some while, listens, and if nobody is
 * playing, plays. That is *carrier sense multiple access* — the rule a shared
 * radio channel uses — and it has the same failure mode: sound takes time to
 * cross the room, so two players who start within one travel time of each other
 * cannot possibly have heard each other, and both are already playing before
 * either finds out. **The vulnerable window is the travel time**, and nothing
 * about listening harder closes it.
 *
 * What the model is for: the interesting quantities here have closed forms, and
 * a simulation that cannot reproduce them is wrong. With listening switched off
 * (`deaf`) every player is an alternating renewal process — Exp(patience) idle,
 * a fixed phrase length L busy — and for g = L/patience:
 *
 *   P(a turn is not overlapped) = [e^-g / (1 + g)]^(N-1)
 *   fraction of time exactly one plays = N g / (1 + g)^N
 *
 * both exact for finite N, and the first tends to Abramson's e^-2G for pure
 * ALOHA as N grows with G = Ng held fixed.
 *
 * By relative path, not `@core`: the harness imports this module directly in
 * node, and node cannot resolve a Vite alias.
 */
import { rng, type Rng } from '../../src/core/random.ts'

/** Metres per second, dry air, 20 °C. */
export const C_AIR = 343

/** What a player does when the floor is busy. */
export type Manner = 'patient' | 'pouncing'
/** What a player does after being talked over. */
export type Backoff = 'random' | 'polite' | 'none'

export interface Config {
  n: number
  /** Pairwise travel times in seconds; symmetric, zero on the diagonal. */
  tau: number[][]
  /** Mean idle wait before wanting to play, seconds (exponential). */
  patience: number
  /** Turn length, seconds. Deterministic — the closed forms need it so. */
  phrase: number
  /** Per-player reaction time, seconds. Applies to responding to what is heard. */
  react: number[]
  manner: Manner
  backoff: Backoff
  /** Nobody listens: no carrier sense, no stopping. The ALOHA control. */
  deaf: boolean
  seed: number
}

export interface Note {
  /** Seconds after the turn's start. */
  at: number
  /** Scale degree; the sketch decides what that sounds like. */
  deg: number
}

export interface Turn {
  id: number
  who: number
  start: number
  /** Where the turn was going to end. */
  wanted: number
  /** Where it actually ended — earlier if the player broke off. */
  end: number
  /** Another turn overlapped this one. */
  collided: boolean
  /** How many times this player had been talked over in a row when it started. */
  fails: number
  notes: Note[]
}

const expDraw = (r: Rng, mean: number) => -Math.log(1 - r.next()) * mean

/** The polite pause everybody takes after a clash — identical for everybody. */
export const POLITE_GAP = 0.3
/** Base window for randomised backoff, doubling per successive clash. */
export const BACKOFF_WINDOW = 0.8

/** Players evenly spaced on a circle of the given diameter, in metres. */
export function ringPositions(n: number, diameter: number): Array<[number, number]> {
  const R = diameter / 2
  const out: Array<[number, number]> = []
  for (let i = 0; i < n; i++) {
    // start at the top and go clockwise, so 2 players face each other
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2
    out.push([R * Math.cos(a), R * Math.sin(a)])
  }
  return out
}

export function travelTimes(pos: Array<[number, number]>, c = C_AIR): number[][] {
  const n = pos.length
  const tau: number[][] = []
  for (let i = 0; i < n; i++) {
    tau.push([])
    for (let j = 0; j < n; j++) {
      tau[i].push(Math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1]) / c)
    }
  }
  return tau
}

/** Reaction times spread ±30% around the mean, fixed per player by the seed. */
export function reactionTimes(n: number, mean: number, seed: number): number[] {
  const r = rng(seed * 31 + 7)
  return Array.from({ length: n }, () => mean * (0.7 + r.next() * 0.6))
}

// -- the simulation ----------------------------------------------------------

interface Slot {
  playing: boolean
  /** When this player next wants to try, if idle. */
  nextAt: number
  fails: number
  /** The last few turns, kept because sound from an old one may still be in the air. */
  recent: Turn[]
}

/**
 * A next-event simulation of the floor. `advance(t)` runs it forward; turns
 * appear in `turns` as they start and their `end` may be pulled in afterwards,
 * which is what being talked over means.
 */
export class Floor {
  readonly cfg: Config
  /** One stream per player, so their timing is genuinely independent. */
  private rt: Rng[]
  /** A separate stream for the notes, so changing the tune cannot move a start. */
  private rg: Rng
  private slot: Slot[]
  private nextId = 0
  /** Simulation clock, seconds since the floor opened. */
  now = 0
  /** Turns in start order. Trim it yourself if you are running for a long time. */
  turns: Turn[] = []
  /** Attempts to take the floor, including the ones that found it busy. */
  attempts = 0
  /** Attempts that found it busy. */
  deferred = 0

  constructor(cfg: Config) {
    this.cfg = cfg
    // A single shared stream would couple the players through how many draws
    // each one happens to take, and the closed forms below assume independence.
    this.rt = Array.from({ length: cfg.n }, (_, i) => rng(cfg.seed * 1009 + i * 7919 + 1))
    this.rg = rng(cfg.seed * 65537 + 13)
    this.slot = Array.from({ length: cfg.n }, () => ({
      playing: false,
      nextAt: 0,
      fails: 0,
      recent: [] as Turn[],
    }))
    // stagger the first attempts so the opening is not a mass collision
    for (let i = 0; i < cfg.n; i++) this.slot[i].nextAt = expDraw(this.rt[i], cfg.patience)
  }

  /** The turn a player is in the middle of, or null. */
  private current(i: number): Turn | null {
    const s = this.slot[i]
    return s.playing ? s.recent[s.recent.length - 1] : null
  }

  /** Is anybody else's sound arriving at i right now? */
  private heardBusy(i: number, t: number): boolean {
    for (let j = 0; j < this.cfg.n; j++) {
      if (j === i) continue
      const d = this.cfg.tau[i][j]
      for (const tn of this.slot[j].recent) {
        if (tn.start + d <= t && t < tn.end + d) return true
      }
    }
    return false
  }

  /** The last moment sound currently in the air stops arriving at i. */
  private clearsAt(i: number, t: number): number {
    let clear = t
    for (let j = 0; j < this.cfg.n; j++) {
      if (j === i) continue
      const d = this.cfg.tau[i][j]
      for (const tn of this.slot[j].recent) {
        const off = tn.end + d
        if (off > clear) clear = off
      }
    }
    return clear
  }

  /** A gesture to fill a turn of length `len`. */
  private gesture(len: number): Note[] {
    const out: Note[] = []
    const g = this.rg
    const rate = 0.13 + g.next() * 0.22
    let deg = g.int(-2, 9)
    let at = 0
    // a contour rather than a walk — improvisers go somewhere and come back
    const dir = g.chance(0.5) ? 1 : -1
    let k = 0
    while (at < len - 0.01 && out.length < 24) {
      out.push({ at, deg })
      const turn = k > 2 && g.chance(0.45) ? -dir : dir
      deg += turn * g.int(1, 3)
      if (deg > 13) deg -= 7
      if (deg < -4) deg += 7
      at += rate * (g.chance(0.22) ? 2 : 1)
      k++
    }
    return out
  }

  private begin(i: number, t: number) {
    const cfg = this.cfg
    const turn: Turn = {
      id: this.nextId++,
      who: i,
      start: t,
      wanted: t + cfg.phrase,
      end: t + cfg.phrase,
      collided: false,
      fails: this.slot[i].fails,
      notes: [],
    }
    turn.notes = this.gesture(cfg.phrase)

    for (let j = 0; j < cfg.n; j++) {
      if (j === i) continue
      const other = this.current(j)
      if (!other) continue
      // they overlap in the room from this instant, whatever either of them
      // knows about it — that is the definition a spoiled ALOHA frame uses
      other.collided = true
      turn.collided = true
      if (cfg.deaf) continue
      // j hears i start one travel time later and takes react[j] to stop
      const jStops = t + cfg.tau[j][i] + cfg.react[j]
      if (jStops < other.end) other.end = jStops
      // and i, which evidently did not hear j, hears j's turn begin later still
      const iHears = other.start + cfg.tau[i][j]
      if (iHears > t) {
        const iStops = iHears + cfg.react[i]
        if (iStops < turn.end) turn.end = iStops
      }
    }

    const s = this.slot[i]
    s.playing = true
    s.recent.push(turn)
    if (s.recent.length > 4) s.recent.shift()
    this.turns.push(turn)
  }

  private finish(i: number, t: number) {
    const cfg = this.cfg
    const s = this.slot[i]
    const turn = s.recent[s.recent.length - 1]
    s.playing = false
    if (cfg.deaf) {
      // no listening means no backoff: a clean alternating renewal process,
      // which is what makes the closed forms above exact
      s.nextAt = t + expDraw(this.rt[i], cfg.patience)
      return
    }
    if (!turn.collided) {
      s.fails = 0
      s.nextAt = t + expDraw(this.rt[i], cfg.patience)
      return
    }
    s.fails++
    const floorClear = Math.max(this.clearsAt(i, t), t)
    const react = cfg.react[i]
    if (cfg.backoff === 'none') {
      s.nextAt = floorClear + react
    } else if (cfg.backoff === 'polite') {
      s.nextAt = floorClear + react + POLITE_GAP
    } else {
      const w = BACKOFF_WINDOW * Math.pow(2, Math.min(s.fails - 1, 5))
      s.nextAt = floorClear + react + this.rt[i].next() * w
    }
  }

  private attempt(i: number, t: number) {
    const cfg = this.cfg
    this.attempts++
    if (!cfg.deaf && this.heardBusy(i, t)) {
      this.deferred++
      const s = this.slot[i]
      if (cfg.manner === 'pouncing') {
        // wait for the gap and go — which is how everybody ends up going at once
        s.nextAt = this.clearsAt(i, t) + cfg.react[i] * (0.8 + this.rt[i].next() * 0.4)
      } else {
        s.nextAt = t + expDraw(this.rt[i], cfg.patience)
      }
      if (s.nextAt <= t) s.nextAt = t + 1e-4
      return
    }
    this.begin(i, t)
  }

  /** Run one event. Returns false if there is nothing left to do. */
  private step(): boolean {
    let bi = -1
    let bt = Infinity
    let bPlaying = false
    for (let i = 0; i < this.cfg.n; i++) {
      const s = this.slot[i]
      const t = s.playing ? s.recent[s.recent.length - 1].end : s.nextAt
      if (t < bt) {
        bt = t
        bi = i
        bPlaying = s.playing
      }
    }
    if (bi < 0 || !isFinite(bt)) return false
    this.now = bt
    if (bPlaying) this.finish(bi, bt)
    else this.attempt(bi, bt)
    return true
  }

  /** Run until the clock passes `until`. */
  advance(until: number) {
    let guard = 0
    while (this.now < until && guard++ < 2_000_000) {
      // peek: stop before consuming an event past the horizon
      let bt = Infinity
      for (let i = 0; i < this.cfg.n; i++) {
        const s = this.slot[i]
        const t = s.playing ? s.recent[s.recent.length - 1].end : s.nextAt
        if (t < bt) bt = t
      }
      if (bt > until) {
        this.now = until
        return
      }
      if (!this.step()) return
    }
  }

  /** Drop turns that ended before `before`, keeping each player's recent few. */
  trim(before: number) {
    let k = 0
    while (k < this.turns.length && this.turns[k].end < before) k++
    if (k > 0) this.turns.splice(0, k)
  }
}

// -- what came of it ---------------------------------------------------------

export interface Stats {
  seconds: number
  turns: number
  clean: number
  /** Fraction of turns that were overlapped by another. */
  collisionRate: number
  /** Fraction of the time exactly one player sounds. */
  solo: number
  /** Fraction of the time two or more sound. */
  over: number
  silence: number
  /** Turn starts per player per second. */
  startRate: number
  attempts: number
  deferred: number
  /** Mean fraction of a turn actually played before breaking off. */
  played: number
}

/** Fractions of a window in which 0, exactly 1, and 2+ intervals are active. */
export function coverage(turns: Turn[], from: number, to: number) {
  const edges: Array<[number, number]> = []
  for (const t of turns) {
    const a = Math.max(t.start, from)
    const b = Math.min(t.end, to)
    if (b > a) {
      edges.push([a, 1])
      edges.push([b, -1])
    }
  }
  edges.sort((x, y) => x[0] - y[0] || x[1] - y[1])
  let k = 0
  let prev = from
  let solo = 0
  let over = 0
  for (const [t, d] of edges) {
    if (t > prev) {
      if (k === 1) solo += t - prev
      else if (k > 1) over += t - prev
      prev = t
    }
    k += d
  }
  const span = Math.max(1e-9, to - from)
  return { solo: solo / span, over: over / span, silence: 1 - (solo + over) / span }
}

/** Run a floor for `seconds` and report. A warm-up is discarded. */
export function run(cfg: Config, seconds: number, warmup = 20): Stats {
  const f = new Floor(cfg)
  f.advance(seconds + warmup)
  const turns = f.turns.filter((t) => t.start >= warmup && t.end <= seconds + warmup)
  const clean = turns.filter((t) => !t.collided).length
  const cov = coverage(f.turns, warmup, seconds + warmup)
  let played = 0
  for (const t of turns) played += (t.end - t.start) / Math.max(1e-9, t.wanted - t.start)
  return {
    seconds,
    turns: turns.length,
    clean,
    collisionRate: turns.length ? 1 - clean / turns.length : 0,
    solo: cov.solo,
    over: cov.over,
    silence: cov.silence,
    startRate: turns.length / seconds / cfg.n,
    attempts: f.attempts,
    deferred: f.deferred,
    played: turns.length ? played / turns.length : 1,
  }
}

// -- the closed forms --------------------------------------------------------

/**
 * With nobody listening, each player is an alternating renewal process:
 * Exp(patience) idle, then a fixed phrase. For g = phrase/patience the chance
 * that one other player neither is sounding when your turn starts nor starts
 * during it is e^-g/(1+g), and they are independent.
 */
export function deafClean(n: number, g: number): number {
  return Math.pow(Math.exp(-g) / (1 + g), n - 1)
}

/** Each player sounds a fraction g/(1+g) of the time, independently. */
export function deafSolo(n: number, g: number): number {
  return (n * g) / Math.pow(1 + g, n)
}

/** Clean turns per phrase-length — Abramson's throughput, exact for finite n. */
export function deafThroughput(n: number, g: number): number {
  return n * g * deafClean(n, g)
}

/** Pure ALOHA, the n → ∞ limit of `deafThroughput` at fixed G = n·g. */
export function aloha(G: number): number {
  return G * Math.exp(-2 * G)
}

/**
 * With everybody listening, a turn is spoiled only by somebody who started
 * within one travel time of it — earlier and you would have heard them, later
 * and they would have heard you. If the others' starts were Poisson at `rate`
 * each, the chance of getting away with it is the empty-window probability over
 * the two-sided window, per pair.
 */
export function senseClean(tau: number[][], rate: number, i: number): number {
  let s = 0
  for (let j = 0; j < tau.length; j++) if (j !== i) s += tau[i][j]
  return Math.exp(-2 * rate * s)
}

export function senseCleanMean(tau: number[][], rate: number): number {
  let s = 0
  for (let i = 0; i < tau.length; i++) s += senseClean(tau, rate, i)
  return s / tau.length
}
