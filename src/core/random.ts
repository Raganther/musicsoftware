/**
 * Seeded randomness.
 *
 * Generative sketches are useless if you can't get the good one back. Always
 * take an rng from here rather than calling Math.random directly, and put the
 * seed in a param so a happy accident is reproducible.
 */

export interface Rng {
  /** Float in [0, 1). */
  next(): number
  /** Float in [lo, hi). */
  range(lo: number, hi: number): number
  /** Integer in [lo, hi]. */
  int(lo: number, hi: number): number
  /** True with probability p. */
  chance(p: number): boolean
  /** Uniform choice. */
  pick<T>(items: readonly T[]): T
  /** Choice with relative weights. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T
  /** New array, shuffled (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[]
  /** Roughly normal, mean 0, sd 1. */
  gauss(): number
  /** Reset to the original seed. */
  reset(): void
}

/** mulberry32 — small, fast, good enough for music. */
export function rng(seed = 1): Rng {
  const initial = seed >>> 0
  let a = initial

  const next = () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    int: (lo, hi) => Math.floor(lo + next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    weighted(items, weights) {
      const total = weights.reduce((s, w) => s + w, 0)
      let t = next() * total
      for (let i = 0; i < items.length; i++) {
        t -= weights[i]
        if (t <= 0) return items[i]
      }
      return items[items.length - 1]
    },
    shuffle(items) {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      return out
    },
    gauss() {
      // Box-Muller
      const u = Math.max(1e-9, next())
      const v = next()
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    },
    reset() {
      a = initial
    },
  }
}

/**
 * A random walk that stays inside bounds by reflecting off them. Good for
 * slowly-drifting parameters that shouldn't wander off and die.
 */
export function walker(r: Rng, opts: { value?: number; step?: number; lo?: number; hi?: number } = {}) {
  let value = opts.value ?? 0
  const step = opts.step ?? 0.1
  const lo = opts.lo ?? 0
  const hi = opts.hi ?? 1
  return {
    get value() {
      return value
    },
    next() {
      value += r.gauss() * step
      if (value < lo) value = lo + (lo - value)
      if (value > hi) value = hi - (value - hi)
      value = Math.min(hi, Math.max(lo, value))
      return value
    },
  }
}

/**
 * First-order Markov chain over any token type. Feed it a corpus, ask for
 * continuations. Surprisingly musical for pitch and rhythm alike.
 */
export function markov<T extends string | number>(r: Rng) {
  const table = new Map<T, T[]>()
  return {
    train(seq: readonly T[]) {
      for (let i = 0; i < seq.length - 1; i++) {
        const list = table.get(seq[i]) ?? []
        list.push(seq[i + 1])
        table.set(seq[i], list)
      }
      return this
    },
    next(from: T): T {
      const list = table.get(from)
      if (!list || !list.length) return r.pick([...table.keys()])
      return r.pick(list)
    },
  }
}
