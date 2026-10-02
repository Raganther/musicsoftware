/**
 * Change ringing: composing with permutations instead of pitches.
 *
 * A tower of `n` bells is rung in *rows* — each bell sounds exactly once per
 * row, in some order. A **change** takes one row to the next, and the physical
 * constraint is absolute: a swinging bell takes about two seconds a stroke, so
 * between two rows it can move **at most one place** in the order. A change is
 * therefore a set of swaps of *adjacent* positions, and the swaps must be
 * disjoint.
 *
 * That single rule is what makes the subject interesting. The ringers are
 * walking the Cayley graph of the symmetric group with adjacent transpositions
 * as generators, and the goal — an **extent** — is a Hamiltonian cycle: all
 * `n!` rows, each exactly once, ending back at rounds. On 7 bells that is 5040
 * rows and about three hours without stopping, which is what a peal is.
 *
 * Everything here is counting and search, so it can be checked. No imports:
 * run directly under `node --experimental-strip-types`.
 */

/** A row is a permutation: `row[i]` is which bell is in position `i` (0-based bells). */
export type Row = number[]

/** A change is the list of positions `i` at which bells `i` and `i+1` swap. */
export type Change = number[]

export const rounds = (n: number): Row => Array.from({ length: n }, (_, i) => i)

export const rowKey = (row: Row): string => row.join(',')

/** Apply a change to a row. The swaps are disjoint, so order does not matter. */
export function applyChange(row: Row, change: Change): Row {
  const out = row.slice()
  for (const i of change) {
    const t = out[i]
    out[i] = out[i + 1]
    out[i + 1] = t
  }
  return out
}

/**
 * Every legal change on `n` bells: every set of disjoint adjacent swaps.
 *
 * Choosing a set of non-overlapping dominoes on a row of `n` cells is the
 * Fibonacci recurrence — either position 0 is left alone, or it is paired with
 * position 1 — so there are **F(n+1)** of them, counting the change that moves
 * nothing. That identity is the first thing worth checking.
 */
export function legalChanges(n: number): Change[] {
  const out: Change[] = []
  const walk = (at: number, acc: Change) => {
    if (at >= n - 1) {
      out.push(acc.slice())
      return
    }
    walk(at + 1, acc)
    acc.push(at)
    walk(at + 2, acc)
    acc.pop()
  }
  walk(0, [])
  return out
}

/**
 * The changes a method may actually use: every bell must move, so the swaps
 * have to cover every position. On an even number of bells that is the single
 * change `(12)(34)(56)…`; on an odd number it is impossible, which is why odd
 * towers always leave one bell "making places".
 */
export function fullChanges(n: number): Change[] {
  return legalChanges(n).filter((c) => c.length * 2 === n)
}

/**
 * **Plain hunt**, the first thing a ringer learns. Alternate the two changes
 * `(12)(34)…` and `(23)(45)…`; every bell walks out to the back, turns round,
 * and walks in to the front. It closes after exactly `2n` rows.
 */
export function plainHunt(n: number): Row[] {
  const odd: Change = []
  const even: Change = []
  for (let i = 0; i + 1 < n; i += 2) odd.push(i)
  for (let i = 1; i + 1 < n; i += 2) even.push(i)
  const rows: Row[] = [rounds(n)]
  for (let k = 0; k < 2 * n; k++) rows.push(applyChange(rows[k], k % 2 === 0 ? odd : even))
  rows.pop() // the last row is rounds again
  return rows
}

/**
 * **Plain Bob**: plain hunt, except that at the end of every lead the change
 * `(34)(56)…` is rung instead of `(23)(45)…`, so the treble's cycle stays
 * intact while the other bells shift round by one. The lead is `2n` rows and
 * the plain course is `n - 1` leads.
 *
 * `calls` gives the lead ends at which a **bob** is rung instead — the change
 * `(56)(78)…`, which rotates three bells rather than all of them and is how a
 * course is joined to the next one.
 */
export function plainBob(n: number, leads: number, calls: Set<number> = new Set()): Row[] {
  const hunt: Change = []
  const cross: Change = []
  for (let i = 0; i + 1 < n; i += 2) hunt.push(i)
  for (let i = 1; i + 1 < n; i += 2) cross.push(i)
  // Lead end `12`: places 1 and 2 made (and the back place too if n is odd),
  // everything above them hunts.
  const plain: Change = []
  for (let i = 2; i + 1 < n; i += 2) plain.push(i)
  // A bob is `14`: places 1 and 4 made instead, so bells 2-3 swap and the rest
  // carry on. It is one change different from a plain lead and it rotates
  // three bells where a plain lead rotates them all, which is how one course
  // is joined to the next.
  const bob: Change = [1]
  for (let i = 4; i + 1 < n; i += 2) bob.push(i)

  const rows: Row[] = [rounds(n)]
  for (let lead = 0; lead < leads; lead++) {
    for (let k = 0; k < 2 * n; k++) {
      const last = k === 2 * n - 1
      const ch = last ? (calls.has(lead) ? bob : plain) : k % 2 === 0 ? hunt : cross
      rows.push(applyChange(rows[rows.length - 1], ch))
    }
  }
  rows.pop()
  return rows
}

/** True means no row is rung twice. It is the one thing a composition must be. */
export function isTrue(rows: Row[]): boolean {
  const seen = new Set<string>()
  for (const r of rows) {
    const k = rowKey(r)
    if (seen.has(k)) return false
    seen.add(k)
  }
  return true
}

/** Does every change in this sequence move each bell at most one place? */
export function isLegal(rows: Row[]): boolean {
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]
    const b = rows[i]
    for (let bell = 0; bell < a.length; bell++) {
      if (Math.abs(a.indexOf(bell) - b.indexOf(bell)) > 1) return false
    }
  }
  return true
}

/**
 * How often each bell rings in each position. In a true extent every bell must
 * ring in every place exactly `(n-1)!` times, because the rows are all of
 * `S_n` and fixing one bell's place leaves a permutation of the rest.
 */
export function placeCounts(rows: Row[], n: number): number[][] {
  const grid = Array.from({ length: n }, () => new Array(n).fill(0))
  for (const r of rows) for (let pos = 0; pos < n; pos++) grid[r[pos]][pos]++
  return grid
}

/**
 * **The extent that always exists**, by Steinhaus–Johnson–Trotter: generate the
 * permutations so that consecutive ones differ by a single adjacent swap. It is
 * a Hamiltonian cycle in the Cayley graph for every `n ≥ 3`, it is instant, and
 * it is perfectly legal change ringing by the letter of the rule.
 *
 * It is also unringable, and the reason is worth knowing: only **two** bells
 * move per change and the other `n - 2` stand still, where a method wants every
 * bell moving. Legality is a much weaker condition than ringability.
 */
export function sjtExtent(n: number): Row[] {
  const perm = rounds(n)
  const dir = new Array(n).fill(-1)
  const rows: Row[] = [perm.slice()]
  const total = factorial(n)
  while (rows.length < total) {
    // largest mobile element: one whose neighbour in its own direction is smaller
    let pick = -1
    for (let i = 0; i < n; i++) {
      const j = i + dir[i]
      if (j < 0 || j >= n) continue
      if (perm[i] > perm[j] && (pick < 0 || perm[i] > perm[pick])) pick = i
    }
    if (pick < 0) break
    const j = pick + dir[pick]
    const big = perm[pick]
    ;[perm[pick], perm[j]] = [perm[j], perm[pick]]
    ;[dir[pick], dir[j]] = [dir[j], dir[pick]]
    for (let i = 0; i < n; i++) if (perm[i] > big) dir[i] = -dir[i]
    rows.push(perm.slice())
  }
  return rows
}

/**
 * Search for an extent as a Hamiltonian cycle, with seeded restarts and a
 * Warnsdorff-style preference for the next row with fewest unvisited
 * neighbours. Plain depth-first order thrashes past five bells; this finds a
 * fresh one per seed, which is the point — a composition rather than *the*
 * composition.
 *
 * `only` restricts the changes allowed.
 */
export function findExtent(n: number, seed = 1, only?: Change[], restarts = 400): Row[] | null {
  const changes = only ?? legalChanges(n).filter((c) => c.length > 0)
  const target = factorial(n)
  const start = rounds(n)
  const startKey = rowKey(start)
  let state = (seed * 2654435761) % 4294967296 || 1
  const rand = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296)

  for (let attempt = 0; attempt < restarts; attempt++) {
    const seen = new Set<string>([startKey])
    const path: Row[] = [start]
    let stuck = false
    while (path.length < target && !stuck) {
      const here = path[path.length - 1]
      const options: { row: Row; key: string; score: number }[] = []
      for (const c of changes) {
        const row = applyChange(here, c)
        const key = rowKey(row)
        if (seen.has(key)) continue
        let onward = 0
        for (const d of changes) if (!seen.has(rowKey(applyChange(row, d)))) onward++
        options.push({ row, key, score: onward + rand() * 0.5 })
      }
      if (!options.length) {
        stuck = true
        break
      }
      options.sort((a, b) => a.score - b.score)
      const take = options[0]
      seen.add(take.key)
      path.push(take.row)
    }
    if (path.length === target) {
      const last = path[path.length - 1]
      if (changes.some((c) => rowKey(applyChange(last, c)) === startKey)) return path
    }
  }
  return null
}

/**
 * Which patterns of calls turn `leads` leads of Plain Bob into a true extent.
 * On five bells the plain course is 40 rows and the extent is 120, so three
 * courses have to be joined — and only some call patterns do it without
 * repeating a row. Enumerated rather than quoted.
 */
export function callPatterns(n: number, leads: number): number[][] {
  const out: number[][] = []
  const target = factorial(n)
  if (2 * n * leads !== target) return out
  for (let mask = 0; mask < 1 << leads; mask++) {
    const calls = new Set<number>()
    for (let i = 0; i < leads; i++) if (mask & (1 << i)) calls.add(i)
    const rows = plainBob(n, leads, calls)
    if (rows.length === target && isTrue(rows) && rowKey(rows[0]) === rowKey(rounds(n))) {
      out.push([...calls])
    }
  }
  return out
}

export function factorial(n: number): number {
  let out = 1
  for (let i = 2; i <= n; i++) out *= i
  return out
}

export function fibonacci(k: number): number {
  let a = 0
  let b = 1
  for (let i = 0; i < k; i++) {
    const t = a + b
    a = b
    b = t
  }
  return a
}

/** The path of one bell through a block of rows: its position in each row. */
export function blueLine(rows: Row[], bell: number): number[] {
  return rows.map((r) => r.indexOf(bell))
}

/**
 * The partials of a tuned bell, as ratios to the **prime**. A bell is not a
 * string: its modes are set by founders who tune them by shaving metal off the
 * inside, and the traditional target puts a **minor third** at 1.2 — exactly
 * 6:5 — which is why a peal of bells sounds minor whatever the tune is. Major
 * third bells, with the tierce at 1.25, were only achieved in the twentieth
 * century.
 *
 * The pitch you *hear* is the strike note, an octave below the nominal, which
 * is not where most of the energy is.
 */
export function bellPartials(tierce: number): { ratio: number; gain: number; decay: number }[] {
  return [
    { ratio: 0.5, gain: 0.55, decay: 1.0 }, // hum, rings longest
    { ratio: 1.0, gain: 0.85, decay: 0.62 }, // prime
    { ratio: tierce, gain: 0.7, decay: 0.5 }, // tierce — minor at 1.2
    { ratio: 1.5, gain: 0.45, decay: 0.38 }, // quint
    { ratio: 2.0, gain: 1.0, decay: 0.3 }, // nominal, the loudest
    { ratio: 3.0, gain: 0.3, decay: 0.16 }, // twelfth
    { ratio: 4.0, gain: 0.22, decay: 0.1 }, // octave nominal
  ]
}

/** Cents between two frequency ratios. */
export const cents = (a: number, b: number) => 1200 * Math.log2(a / b)
