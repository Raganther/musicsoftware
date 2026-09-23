/**
 * Rhythmic canons that tile a cycle, and the question of whether one of the
 * two halves is secretly a loop.
 *
 * A tiling canon on n pulses is a pair of sets: an inner rhythm `a` (the
 * subject every voice plays) and a set of entries `b` (where the voices come
 * in), such that `a ⊕ b = Z_n` — every pulse struck exactly once, no gaps and
 * no collisions. `sketches/tiling` searches for `b` given `a`.
 *
 * A set is *periodic* when some nonzero shift maps it to itself, which for a
 * rhythm means it is a shorter pattern repeated. Hajós asked whether every
 * factorisation of a cyclic group has a periodic factor; the answer is yes for
 * most n and no for a known list of "bad" orders starting at **72**. A canon
 * where neither half is periodic is a Vuza canon.
 *
 * No imports: this file is run directly under `node --experimental-strip-types`
 * to produce the numbers in the notes.
 */

export interface Canon {
  n: number
  /** The subject: offsets, in pulses, of the notes one voice plays. */
  a: number[]
  /** The entries: offsets, in pulses, at which the voices start. */
  b: number[]
}

const mod = (x: number, n: number) => ((x % n) + n) % n

// -- the exact predicates ---------------------------------------------------

/** How many times each pulse is struck. A tiling is all ones. */
export function coverCounts(n: number, a: number[], b: number[]): Int32Array {
  const c = new Int32Array(n)
  for (const x of a) for (const y of b) c[mod(x + y, n)]++
  return c
}

/** `a ⊕ b = Z_n`: every pulse exactly once. */
export function tiles(n: number, a: number[], b: number[]): boolean {
  if (a.length * b.length !== n) return false
  const c = coverCounts(n, a, b)
  for (let i = 0; i < n; i++) if (c[i] !== 1) return false
  return true
}

/**
 * Every nonzero shift `d` with `s + d = s`. Non-empty means the set is a
 * shorter pattern repeated, and the smallest such `d` is that pattern's length.
 */
export function periods(n: number, s: number[]): number[] {
  const inS = new Uint8Array(n)
  for (const x of s) inS[mod(x, n)] = 1
  const out: number[] = []
  for (let d = 1; d < n; d++) {
    let ok = true
    for (const x of s) {
      if (!inS[mod(x + d, n)]) {
        ok = false
        break
      }
    }
    if (ok) out.push(d)
  }
  return out
}

const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y))

/**
 * The only shifts that can be a period of a `k`-element subset of `Z_n`.
 *
 * A periodic set is a union of cosets of `⟨d⟩`, so `|⟨d⟩| = n/gcd(d,n)` has to
 * divide `k`. For `k = 6` in `Z_72` that is five shifts out of seventy-one,
 * which is most of the cost of the search.
 */
export function candidatePeriods(n: number, k: number): number[] {
  const out: number[] = []
  for (let d = 1; d < n; d++) if (k % (n / gcd(d, n)) === 0) out.push(d)
  return out
}

/** A membership buffer reused across calls, stamped rather than cleared. */
let stampBuf = new Int32Array(0)
let stamp = 0

export function isAperiodic(n: number, s: number[], cands?: number[]): boolean {
  if (stampBuf.length < n) stampBuf = new Int32Array(n)
  const inS = stampBuf
  const mark = ++stamp
  for (const x of s) inS[mod(x, n)] = mark
  const ds = cands ?? candidatePeriods(n, s.length)
  for (const d of ds) {
    let ok = true
    for (const x of s) {
      let y = x + d
      if (y >= n) y -= n
      if (inS[y] !== mark) {
        ok = false
        break
      }
    }
    if (ok) return false
  }
  return true
}

/** Which voice owns each pulse: an index into `b`, or −1 if the canon is broken. */
export function ownership(n: number, a: number[], b: number[]): Int32Array {
  const own = new Int32Array(n)
  own.fill(-1)
  for (let j = 0; j < b.length; j++) for (const x of a) own[mod(x + b[j], n)] = j
  return own
}

// -- the search -------------------------------------------------------------

/**
 * Every `b` with `a ⊕ b = Z_n`, by backtracking on the smallest pulse nobody
 * plays: it has to be covered by *some* note of the subject, and each choice
 * names one entry. The branching factor is `|a|`; it prunes hard.
 */
export function complements(n: number, a: number[], cap = Infinity): number[][] {
  const out: number[][] = []
  if (n % a.length !== 0) return out
  const cov = new Uint8Array(n)
  const b: number[] = []
  let covered = 0
  let next = 0

  const rec = (): void => {
    if (covered === n) {
      out.push(b.slice())
      return
    }
    const save = next
    while (next < n && cov[next]) next++
    const r = next
    for (const ai of a) {
      const bi = r >= ai ? r - ai : r - ai + n
      let ok = true
      for (const aj of a) {
        const y = aj + bi
        if (cov[y < n ? y : y - n]) {
          ok = false
          break
        }
      }
      if (!ok) continue
      for (const aj of a) {
        const y = aj + bi
        cov[y < n ? y : y - n] = 1
      }
      covered += a.length
      b.push(bi)
      rec()
      b.pop()
      covered -= a.length
      for (const aj of a) {
        const y = aj + bi
        cov[y < n ? y : y - n] = 0
      }
      if (out.length >= cap) break
    }
    next = save
  }

  rec()
  return out
}

/**
 * The lexicographically smallest translate of `s` that contains 0. Shifting a
 * canon's subject shifts the whole canon, so this is the one representative
 * worth searching.
 */
export function canonical(n: number, s: number[]): number[] {
  let best: number[] | null = null
  for (const x of s) {
    const t = s.map((y) => mod(y - x, n)).sort((p, q) => p - q)
    if (!best) {
      best = t
      continue
    }
    for (let i = 0; i < t.length; i++) {
      if (t[i] !== best[i]) {
        if (t[i] < best[i]) best = t
        break
      }
    }
  }
  return best ?? []
}

/**
 * Is a *sorted* set starting at 0 the lexicographically smallest of its
 * translates? Sorting a translate only rotates it, so this needs no sort and no
 * allocation: entry `j` of the translate by `−s[i]` is
 * `s[(i+j) mod k] − s[i]`, wrapped.
 */
export function isCanonical(n: number, s: number[]): boolean {
  const k = s.length
  for (let i = 1; i < k; i++) {
    for (let j = 1; j < k; j++) {
      const p = i + j
      const v = s[p < k ? p : p - k] - s[i] + (p < k ? 0 : n)
      if (v !== s[j]) {
        if (v < s[j]) return false
        break
      }
    }
  }
  return true
}

/** Subsets of `{0..n-1}` of size `k` containing 0, in lexicographic order. */
export function eachSubset(n: number, k: number, fn: (s: number[]) => void): void {
  const s = new Array<number>(k)
  s[0] = 0
  const rec = (i: number, from: number) => {
    if (i === k) {
      fn(s)
      return
    }
    for (let v = from; v <= n - (k - i); v++) {
      s[i] = v
      rec(i + 1, v + 1)
    }
  }
  if (k === 0) return
  rec(1, 1)
}

export interface Survey {
  n: number
  /** Split sizes `[|a|, |b|]` that were enumerated completely. */
  splits: [number, number][]
  /** Canonical subjects tried. */
  tried: number
  /** Canonical subjects that tile at all. */
  tilers: number
  /** `(canonical subject, entry set)` pairs that tile. Only counted when `full`. */
  canons: number
  /** Of the canonical subjects, how many are aperiodic *and* tile. */
  aperiodicA: number
  /** Pairs with both halves aperiodic — the Vuza canons. */
  vuza: number
  /** Up to a handful of the Vuza canons found. */
  examples: Canon[]
  /** Splits skipped because the subject was too large to enumerate. */
  skipped: [number, number][]
}

export interface SurveyOptions {
  /** Largest subject to enumerate. Splits whose smaller half exceeds it are skipped. */
  maxSubject?: number
  /**
   * Also count canons with a *periodic* subject. Those cannot be Vuza canons,
   * so the search skips them by default — at n = 48 that is 79 million entry
   * sets enumerated for nothing.
   */
  full?: boolean
  keep?: number
}

/**
 * Enumerate every tiling canon on `n` pulses whose smaller half has at most
 * `maxSubject` notes, and count how many have both halves aperiodic.
 *
 * Both halves of a canon play the same role — `a ⊕ b = b ⊕ a` — so enumerating
 * subjects up to `maxSubject` covers every split whose *smaller* side fits.
 */
export function survey(n: number, opts: SurveyOptions = {}): Survey {
  const maxSubject = opts.maxSubject ?? 6
  const keep = opts.keep ?? 8
  const full = opts.full ?? false
  const out: Survey = {
    n,
    splits: [],
    tried: 0,
    tilers: 0,
    canons: 0,
    aperiodicA: 0,
    vuza: 0,
    examples: [],
    skipped: [],
  }
  for (let k = 2; k * k <= n; k++) {
    if (n % k !== 0) continue
    const other = n / k
    if (k > maxSubject) {
      out.skipped.push([k, other])
      continue
    }
    out.splits.push([k, other])
    const dsA = candidatePeriods(n, k)
    const dsB = candidatePeriods(n, other)
    eachSubset(n, k, (s) => {
      out.tried++
      if (!isCanonical(n, s)) return
      const apA = isAperiodic(n, s, dsA)
      if (!apA && !full) return
      const bs = complements(n, s)
      if (!bs.length) return
      out.tilers++
      out.canons += bs.length
      if (!apA) return
      out.aperiodicA++
      for (const b of bs) {
        if (!isAperiodic(n, b, dsB)) continue
        out.vuza++
        if (out.examples.length < keep) out.examples.push({ n, a: s.slice(), b: b.slice() })
      }
    })
  }
  return out
}

// -- the canons the sketch plays --------------------------------------------

/**
 * A canon on 72 pulses with neither half periodic, found by `survey(72)` and
 * re-checked at load. Six notes in the subject, twelve entries.
 */
export const VUZA_72: Canon[] = [
  { n: 72, a: [0, 8, 16, 18, 26, 34], b: [0, 1, 5, 6, 12, 25, 29, 36, 42, 48, 49, 53] },
  { n: 72, a: [0, 8, 16, 18, 26, 34], b: [0, 1, 5, 6, 12, 29, 25, 36, 42, 48, 49, 53] },
]

/** The subject is a shorter pattern repeated: six notes every twelve pulses. */
export function rhythmLoop(n: number, k: number): Canon {
  const a: number[] = []
  for (let i = 0; i < k; i++) a.push((i * n) / k)
  const b: number[] = []
  for (let j = 0; j < n / k; j++) b.push(j)
  return { n, a, b }
}

/** The entries are a shorter pattern repeated: a block of notes every k pulses. */
export function entryLoop(n: number, k: number): Canon {
  const a: number[] = []
  for (let i = 0; i < k; i++) a.push(i)
  const b: number[] = []
  for (let j = 0; j < n / k; j++) b.push(j * k)
  return { n, a, b }
}
