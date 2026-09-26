/**
 * Two six-note halves that complete each other — the aggregate, tiled.
 *
 * `tiling`, `hocket`, `nest` and `vuza` all partition *time* exactly: every
 * pulse struck once, no gaps and no collisions. The same question in pitch has
 * a name and a literature. A twelve-tone row splits into two hexachords, and
 * the row is **hexachordally combinatorial** when some transformation of it
 * begins with the six notes the original ends with. Run the two together and
 * every half-row is all twelve pitch classes exactly once: Schoenberg's device,
 * and the reason serial music can be contrapuntal without doubling anything.
 *
 * Combinatoriality is a property of the unordered hexachord, so the *order* of
 * the row is free — which is why it is a composition tool and not a
 * straitjacket.
 *
 * No imports: run directly under `node --experimental-strip-types`.
 */

export type Row = number[]
/** A pitch-class set, sorted ascending. */
export type PCSet = number[]
export type Kind = 'P' | 'I' | 'R' | 'RI'
export const KINDS: Kind[] = ['P', 'I', 'R', 'RI']

const mod12 = (x: number) => ((x % 12) + 12) % 12

/** The eleven successive intervals of a row, as directed steps mod 12. */
export function intervals(row: Row): number[] {
  const out: number[] = []
  for (let i = 1; i < row.length; i++) out.push(mod12(row[i] - row[i - 1]))
  return out
}

/** A row using each of the eleven intervals exactly once. */
export function isAllInterval(row: Row): boolean {
  const seen = new Set(intervals(row))
  return seen.size === 11 && !seen.has(0)
}

/** Counts of each interval class 1..6 among all pairs. */
export function intervalVector(set: PCSet): number[] {
  const v = [0, 0, 0, 0, 0, 0]
  for (let i = 0; i < set.length; i++) {
    for (let j = i + 1; j < set.length; j++) {
      const d = mod12(set[j] - set[i])
      v[(d > 6 ? 12 - d : d) - 1]++
    }
  }
  return v
}

export function complement(set: PCSet): PCSet {
  const has = new Set(set.map(mod12))
  const out: PCSet = []
  for (let i = 0; i < 12; i++) if (!has.has(i)) out.push(i)
  return out
}

export const sameSet = (a: PCSet, b: PCSet): boolean => {
  if (a.length !== b.length) return false
  const s = [...a].sort((p, q) => p - q)
  const t = [...b].sort((p, q) => p - q)
  for (let i = 0; i < s.length; i++) if (s[i] !== t[i]) return false
  return true
}

/**
 * The transformations of a row. `P` is the row itself transposed, `I` inverts
 * about 0, and `R`/`RI` reverse those. Indexed so the form begins on `t` for
 * `P` and `I`.
 */
export function transform(row: Row, kind: Kind, t: number): Row {
  const p = row.map((x) => mod12(x - row[0] + t))
  const i = row.map((x) => mod12(row[0] - x + t))
  if (kind === 'P') return p
  if (kind === 'I') return i
  if (kind === 'R') return [...p].reverse()
  return [...i].reverse()
}

export function hexachords(row: Row): [PCSet, PCSet] {
  const h = row.length / 2
  return [
    [...row.slice(0, h)].sort((a, b) => a - b),
    [...row.slice(h)].sort((a, b) => a - b),
  ]
}

export interface Partner {
  kind: Kind
  t: number
}

/**
 * Every transformation whose first hexachord is exactly the notes this row
 * ends with — so the two run together give the aggregate twice over.
 *
 * Note that `R` at t = 0 always qualifies: the retrograde of a row starts with
 * the notes the row finished with, by definition. Retrograde-combinatoriality
 * is a fact about the word, not about the hexachord, and the content is in `P`,
 * `I` and `RI`.
 */
export function partners(row: Row): Partner[] {
  const [, h1] = hexachords(row)
  const out: Partner[] = []
  for (const kind of KINDS) {
    for (let t = 0; t < 12; t++) {
      const f = transform(row, kind, t)
      if (sameSet(hexachords(f)[0], h1)) out.push({ kind, t })
    }
  }
  return out
}

/** Which of the four kinds this row admits at all. */
export function kindsAvailable(row: Row): Record<Kind, number[]> {
  const out = { P: [] as number[], I: [] as number[], R: [] as number[], RI: [] as number[] }
  for (const p of partners(row)) out[p.kind].push(p.t)
  return out
}

/** A row is all-combinatorial when every one of the four kinds is available. */
export function isAllCombinatorial(row: Row): boolean {
  const k = kindsAvailable(row)
  return KINDS.every((x) => k[x].length > 0)
}

/** Every 6-note subset of the twelve pitch classes: 924 of them. */
export function allHexachords(): PCSet[] {
  const out: PCSet[] = []
  const rec = (start: number, acc: number[]) => {
    if (acc.length === 6) {
      out.push([...acc])
      return
    }
    for (let v = start; v < 12; v++) {
      acc.push(v)
      rec(v + 1, acc)
      acc.pop()
    }
  }
  rec(0, [])
  return out
}

/**
 * The prime form of a pitch-class set: the most compact rotation of it or its
 * inversion, packed to the left. Sets that are the same shape get the same
 * label, and the label is the one the literature uses — plain lexicographic
 * minimum over rotations is also canonical but calls (023457) "(0,1,2,3,5,10)",
 * which is correct and unrecognisable.
 */
export function setClass(set: PCSet): PCSet {
  let best: PCSet | null = null
  const better = (a: PCSet, b: PCSet | null) => {
    if (!b) return true
    const spanA = a[a.length - 1]
    const spanB = b[b.length - 1]
    if (spanA !== spanB) return spanA < spanB
    for (let i = a.length - 2; i > 0; i--) if (a[i] !== b[i]) return a[i] < b[i]
    return false
  }
  const consider = (s: PCSet) => {
    const sorted = [...new Set(s.map(mod12))].sort((a, b) => a - b)
    for (let r = 0; r < sorted.length; r++) {
      const rot = sorted.map((_, i) => mod12(sorted[(r + i) % sorted.length] - sorted[r]))
      if (better(rot, best)) best = rot
    }
  }
  consider(set)
  consider(set.map((x) => mod12(-x)))
  return best ?? []
}

/** Build a row from a hexachord: those six notes, then the other six. */
export function rowFrom(hex: PCSet, order: number[], orderB: number[]): Row {
  const comp = complement(hex)
  return [...order.map((i) => hex[i]), ...orderB.map((i) => comp[i])]
}

export interface Span {
  /** Pitch classes heard across one half-row of both voices. */
  pcs: number[]
  missing: number[]
  doubled: number[]
}

/**
 * The aggregate test: take the two voices half-row by half-row and ask whether
 * each span carries all twelve pitch classes exactly once. This is `nest`'s
 * "0 steps unowned or doubled", moved from time into pitch.
 */
export function aggregate(a: Row, b: Row): Span[] {
  const h = a.length / 2
  const out: Span[] = []
  for (let k = 0; k * h < a.length; k++) {
    const pcs = [...a.slice(k * h, k * h + h), ...b.slice(k * h, k * h + h)].map(mod12)
    const count = new Array(12).fill(0)
    for (const p of pcs) count[p]++
    out.push({
      pcs,
      missing: count.map((c, i) => (c === 0 ? i : -1)).filter((i) => i >= 0),
      doubled: count.map((c, i) => (c > 1 ? i : -1)).filter((i) => i >= 0),
    })
  }
  return out
}
