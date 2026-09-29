/**
 * Three voices sharing every pulse exactly once, which `hocket` proved
 * impossible.
 *
 * `hocket` (2026-09-13) established both halves of Beatty's theorem: two
 * voices at densities d and 1−d hit every step exactly once, and three or more
 * **cannot** — Uspensky, 1927. `nest` sidestepped that with a tree of two-way
 * splits. This is the other way round it, and it is much smaller: Uspensky's
 * theorem is about *homogeneous* sequences, `⌊n·α⌋`. Give each voice a head
 * start — `⌊n·α + γ⌋` — and three-part partitions exist.
 *
 * Which ones is Fraenkel's conjecture, open since 1973 for six parts and up:
 * the claim is that for three or more voices with **distinct** densities there
 * is exactly one partition, at densities `2^i/(2^m − 1)`. For three voices that
 * is 1/7, 2/7 and 4/7 and nothing else.
 *
 * So the search here is not for *a* partition, it is for all of them.
 *
 * No imports: run directly under `node --experimental-strip-types`.
 */

/**
 * The steps one voice plays inside a period of `n`, for a voice of density
 * `a/n` with head start `gamma`: `⌊k·n/a + γ⌋ mod n` for k = 0..a−1.
 */
export function beattySet(n: number, a: number, gamma: number): number[] {
  const out = new Set<number>()
  const alpha = n / a
  for (let k = 0; k < a; k++) out.add((((Math.floor(k * alpha + gamma) % n) + n) % n))
  return [...out].sort((x, y) => x - y)
}

const key = (s: number[]) => s.join(',')

/**
 * Every distinct pattern a voice of density `a/n` can play, over all head
 * starts. The set only changes when `γ` crosses a point where some
 * `⌊k·α + γ⌋` steps up, so a grid finer than the smallest such gap finds all
 * of them; `a·n` samples per period is comfortably finer.
 */
export function patterns(n: number, a: number): number[][] {
  const seen = new Map<string, number[]>()
  const steps = Math.max(64, a * n * 4)
  for (let i = 0; i < steps; i++) {
    const g = (i / steps) * n
    const s = beattySet(n, a, g)
    if (s.length === a) seen.set(key(s), s)
  }
  return [...seen.values()]
}

export interface Partition {
  n: number
  /** Numerators of the densities, ascending. */
  dens: number[]
  /** The steps each voice plays inside one period, in the same order. */
  voices: number[][]
}

/** All the ways to write `n` as `m` distinct positive parts, ascending. */
export function compositions(n: number, m: number): number[][] {
  const out: number[][] = []
  const rec = (left: number, k: number, min: number, acc: number[]) => {
    if (k === 0) {
      if (left === 0) out.push([...acc])
      return
    }
    for (let v = min; v * k <= left; v++) {
      // strictly increasing, so the densities are distinct
      acc.push(v)
      rec(left - v, k - 1, v + 1, acc)
      acc.pop()
    }
  }
  rec(n, m, 1, [])
  return out
}

/**
 * Every partition of a period of `n` steps into `m` voices with distinct
 * densities, each voice a Beatty sequence with a head start.
 *
 * Exhaustive: the densities must sum to 1, the pattern of a rational-modulus
 * Beatty sequence repeats with period `n`, and the head start only takes
 * finitely many meaningfully different values. So this is a complete answer
 * for each `n`, not a sample.
 */
export function search(n: number, m: number): Partition[] {
  const found: Partition[] = []
  for (const dens of compositions(n, m)) {
    const pats = dens.map((a) => patterns(n, a))
    const chosen: number[][] = []
    const used = new Array<boolean>(n).fill(false)
    const rec = (i: number) => {
      if (i === m) {
        found.push({ n, dens: [...dens], voices: chosen.map((v) => [...v]) })
        return
      }
      for (const p of pats[i]) {
        let ok = true
        for (const s of p) {
          if (used[s]) {
            ok = false
            break
          }
        }
        if (!ok) continue
        for (const s of p) used[s] = true
        chosen.push(p)
        rec(i + 1)
        chosen.pop()
        for (const s of p) used[s] = false
      }
    }
    rec(0)
  }
  return found
}

/** Fraenkel's densities for `m` voices: `2^i / (2^m − 1)`. */
export function fraenkelDensities(m: number): { n: number; dens: number[] } {
  const n = Math.pow(2, m) - 1
  return { n, dens: Array.from({ length: m }, (_, i) => Math.pow(2, i)) }
}

/**
 * The partition at Fraenkel's densities, without searching the other splits.
 *
 * Places the *densest* voice first. Ascending order is what `search` uses and
 * it prunes almost nothing — the one-step voice fits anywhere — so at six
 * voices the backtracking has 63 choices at every level. Densest-first fills
 * half the period on the first move and the rest is forced almost immediately.
 */
export function fraenkelPartition(m: number): Partition | null {
  const { n, dens } = fraenkelDensities(m)
  const order = dens.map((_, i) => i).sort((a, b) => dens[b] - dens[a])
  const pats = order.map((i) => patterns(n, dens[i]))
  const chosen: number[][] = []
  const used = new Array<boolean>(n).fill(false)
  let result: Partition | null = null
  const rec = (i: number): boolean => {
    if (i === m) {
      const voices: number[][] = []
      order.forEach((orig, slot) => (voices[orig] = chosen[slot]))
      result = { n, dens: [...dens], voices }
      return true
    }
    for (const p of pats[i]) {
      let ok = true
      for (const s of p) {
        if (used[s]) {
          ok = false
          break
        }
      }
      if (!ok) continue
      for (const s of p) used[s] = true
      chosen.push(p)
      if (rec(i + 1)) return true
      chosen.pop()
      for (const s of p) used[s] = false
    }
    return false
  }
  rec(0)
  return result
}

// -- what the sketch plays ----------------------------------------------------

export interface Canon {
  n: number
  /** Which voice owns each step of the period, or −1. */
  owner: Int32Array
  dens: number[]
}

/** Turn a partition into a per-step owner table. */
export function ownerOf(p: Partition): Canon {
  const owner = new Int32Array(p.n)
  owner.fill(-1)
  for (let i = 0; i < p.voices.length; i++) for (const s of p.voices[i]) owner[s] = i
  return { n: p.n, owner, dens: p.dens }
}

export interface Defects {
  unowned: number
  doubled: number
}

/**
 * Homogeneous Beatty sequences at arbitrary real densities, counted over
 * `steps` pulses.
 *
 * This is the control that matters, and the rational one above is not it.
 * Rayleigh's theorem needs the densities **irrational**: `⌊3n⌋` and `⌊1.5n⌋`
 * fail for the same reason any two rationals do, which has nothing to do with
 * how many voices there are. Two irrational densities summing to 1 partition
 * exactly; three cannot, and that is Uspensky.
 */
export function flatReal(dens: number[], steps: number): Defects {
  let unowned = 0
  let doubled = 0
  for (let k = 1; k <= steps; k++) {
    let c = 0
    for (const d of dens) if (Math.floor(k * d) > Math.floor((k - 1) * d)) c++
    if (c === 0) unowned++
    else if (c > 1) doubled++
  }
  return { unowned, doubled }
}

/**
 * Homogeneous Beatty at the *rational* densities the staggered partition uses.
 * Fails for every voice count, rationality included, so it is only half a
 * control — `flatReal` is the other half.
 */
export function flatDefects(n: number, dens: number[], steps: number): Defects {
  let unowned = 0
  let doubled = 0
  for (let k = 1; k <= steps; k++) {
    let c = 0
    for (const a of dens) {
      const alpha = n / a
      // k is in ⌊j·α⌋ for some j iff ⌊k/α⌋ > ⌊(k−1)/α⌋
      if (Math.floor(k / alpha) > Math.floor((k - 1) / alpha)) c++
    }
    if (c === 0) unowned++
    else if (c > 1) doubled++
  }
  return { unowned, doubled }
}

/** The same count for a staggered partition, which should be zero and zero. */
export function defects(c: Canon, steps: number): Defects {
  let unowned = 0
  for (let k = 0; k < steps; k++) if (c.owner[k % c.n] < 0) unowned++
  return { unowned, doubled: 0 }
}

/** Distinct inter-onset gaps of one voice — the three-distance fingerprint. */
export function gaps(c: Canon, voice: number): number[] {
  const at: number[] = []
  for (let k = 0; k < c.n * 3; k++) if (c.owner[k % c.n] === voice) at.push(k)
  const g = new Set<number>()
  for (let i = 1; i < at.length; i++) g.add(at[i] - at[i - 1])
  return [...g].sort((a, b) => a - b)
}
