/**
 * A rhythm stored as relationships rather than as values.
 *
 * `cats-cradle` made pitch relational — intervals are the stored data, so
 * transposition is structural — and `rhyme` made a whole score relational, so
 * the notes you actually chose are its unpinned components. Both are about
 * pitch. `ideas.md` has asked twice, from two different sketches, for the
 * rhythm half: durations as ratios are affine in log time, so augmentation and
 * diminution are single coefficients.
 *
 * The reason it is not simply the same thing again is the bar. Pitch
 * constraints are homogeneous — an interval says nothing about absolute pitch,
 * so a relational score has one free transposition per component and that is
 * that. A rhythm has an extra, inhomogeneous constraint that pitch has no
 * analogue of: **the durations have to add up**. Each voice must fill its bar.
 *
 * So the system is two layers:
 *
 *   1. the stated ratios, which fix every duration inside a component up to one
 *      unknown scale — a linear system in log time
 *   2. the bar constraints, which are linear in the *scales*, one equation per
 *      voice
 *
 * With C components and V voices that is a V × C linear system. Fewer
 * components than voices and it is over-determined: it has a solution only for
 * particular ratios. Which is the surprising part, and the reason to build it —
 * **if you link two voices with a ratio, and both have to fill the same bar,
 * there is exactly one ratio you are allowed to choose.** The bar picks it for
 * you. You can state the relationship or you can state both bars; not both.
 *
 * And a solution has to be *positive*. Consistency is not enough: a scale that
 * comes out negative is arithmetic, not a rhythm.
 */

export interface Ratio {
  /** dur[a] = r · dur[b] */
  a: number
  b: number
  r: number
}

export interface Problem {
  /** Which voice each duration belongs to. */
  voice: number[]
  ratios: Ratio[]
  /** How long each voice's bar is, in seconds. */
  bars: number[]
}

export interface Solution {
  ok: boolean
  reason: string
  /** Realised duration of each note. Empty when the problem has no rhythm. */
  durs: number[]
  /** Which component of the ratio graph each note is in. */
  comp: number[]
  components: number
  /** Rank of the bar system — how many of the voice constraints bite. */
  rank: number
  /** Scales left undetermined once the bars have had their say. */
  free: number
}

/**
 * Union-find carrying a log-offset to the root, so a chain of ratios composes
 * by adding. Path compression has to add the offsets it skips over, which is
 * the only fiddly part.
 */
class Rel {
  parent: number[]
  /** log(dur[i] / dur[root(i)]) */
  off: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
    this.off = new Array(n).fill(0)
  }
  find(i: number): { root: number; off: number } {
    if (this.parent[i] === i) return { root: i, off: 0 }
    const up = this.find(this.parent[i])
    this.parent[i] = up.root
    this.off[i] += up.off
    return { root: up.root, off: this.off[i] }
  }
  /** State log(dur[a]) − log(dur[b]) = d. False if it contradicts what is known. */
  union(a: number, b: number, d: number): boolean {
    const fa = this.find(a)
    const fb = this.find(b)
    if (fa.root === fb.root) return Math.abs(fa.off - fb.off - d) < 1e-9
    // hang a's root under b's root
    this.parent[fa.root] = fb.root
    this.off[fa.root] = fb.off + d - fa.off
    return true
  }
}

/** Gaussian elimination with partial pivoting; returns rank and a solution. */
function solveLinear(A: number[][], b: number[]): { rank: number; x: number[]; consistent: boolean } {
  const m = A.length
  const n = m ? A[0].length : 0
  const M = A.map((row, i) => [...row, b[i]])
  let rank = 0
  const where = new Array(n).fill(-1)
  for (let col = 0; col < n && rank < m; col++) {
    let piv = rank
    for (let i = rank; i < m; i++) if (Math.abs(M[i][col]) > Math.abs(M[piv][col])) piv = i
    if (Math.abs(M[piv][col]) < 1e-12) continue
    ;[M[rank], M[piv]] = [M[piv], M[rank]]
    for (let i = 0; i < m; i++) {
      if (i === rank) continue
      const f = M[i][col] / M[rank][col]
      for (let j = col; j <= n; j++) M[i][j] -= f * M[rank][j]
    }
    where[col] = rank
    rank++
  }
  let consistent = true
  for (let i = rank; i < m; i++) if (Math.abs(M[i][n]) > 1e-9) consistent = false
  const x = new Array(n).fill(1)
  for (let col = 0; col < n; col++) {
    if (where[col] >= 0) x[col] = M[where[col]][n] / M[where[col]][col]
  }
  return { rank, x, consistent }
}

/**
 * Realise a rhythm from its relationships.
 *
 * Free scales — components no bar constraint reaches — are set to 1, which is
 * a choice and is flagged as `free` rather than hidden.
 */
export function solve(p: Problem): Solution {
  const n = p.voice.length
  const V = p.bars.length
  const rel = new Rel(n)
  for (const { a, b, r } of p.ratios) {
    if (!(r > 0)) return bad('a ratio has to be positive', n)
    if (!rel.union(a, b, Math.log(r))) {
      return bad('these ratios contradict each other around a cycle', n)
    }
  }

  const rootOf = new Array(n).fill(0)
  const offOf = new Array(n).fill(0)
  const roots: number[] = []
  for (let i = 0; i < n; i++) {
    const f = rel.find(i)
    rootOf[i] = f.root
    offOf[i] = f.off
    if (!roots.includes(f.root)) roots.push(f.root)
  }
  const comp = rootOf.map((r) => roots.indexOf(r))
  const C = roots.length

  // Each voice: Σ_c S_c · (Σ_{i in voice, comp i = c} exp(off_i)) = bar
  const A: number[][] = []
  const rhs: number[] = []
  for (let v = 0; v < V; v++) {
    const row = new Array(C).fill(0)
    for (let i = 0; i < n; i++) if (p.voice[i] === v) row[comp[i]] += Math.exp(offOf[i])
    A.push(row)
    rhs.push(p.bars[v])
  }
  const { rank, x, consistent } = solveLinear(A, rhs)
  if (!consistent) {
    return {
      ok: false,
      reason: 'no scale makes every voice fill its bar — the voices are linked, so the bar has already chosen their ratio',
      durs: [],
      comp,
      components: C,
      rank,
      free: C - rank,
    }
  }
  for (let c = 0; c < C; c++) {
    if (!(x[c] > 0)) {
      return { ok: false, reason: 'the only solution runs backwards in time', durs: [], comp, components: C, rank, free: C - rank }
    }
  }
  const durs = new Array(n)
  for (let i = 0; i < n; i++) durs[i] = x[comp[i]] * Math.exp(offOf[i])
  return { ok: true, reason: '', durs, comp, components: C, rank, free: C - rank }

  function bad(reason: string, len: number): Solution {
    return { ok: false, reason, durs: [], comp: new Array(len).fill(0), components: 0, rank: 0, free: 0 }
  }
}

/**
 * The one cross-voice ratio the bars will allow.
 *
 * Given both voices' internal ratios and both bar lengths, linking note `a` in
 * one voice to note `b` in another leaves no freedom: realise each voice on its
 * own and read the ratio off. Anything else makes the system inconsistent, and
 * `solve` refuses it.
 */
export function forcedRatio(p: Problem, a: number, b: number): number | null {
  if (p.voice[a] === p.voice[b]) return null
  // Drop every cross-voice ratio and realise each voice on its own bar. What
  // is left is not a choice: read the ratio off the durations that result.
  const alone = solve({ ...p, ratios: p.ratios.filter((r) => p.voice[r.a] === p.voice[r.b]) })
  if (!alone.ok) return null
  return alone.durs[a] / alone.durs[b]
}
