/**
 * An ensemble that competes for loudness, and the arithmetic that says whether
 * it ever stops.
 *
 * Every player wants to be some number of decibels above what it can hear of
 * everyone else. That is the Lombard reflex, and it is why restaurants and rock
 * bands get louder and never quieter. The question is whether the group settles
 * or runs away, and it has an exact answer that has nothing to do with how loud
 * anyone starts.
 *
 * Write it out. Player i hears the others at
 *
 *     M_i = 10·log10( Σ_{j≠i} w_ij · 10^(L_j/10) )
 *
 * where w_ij is how much of j's sound falls in i's band, and wants
 * L_i = M_i + t_i. A sum of powers in dB is very nearly the *largest* of them —
 * log-sum-exp is a soft maximum — so to first order
 *
 *     L_i ← max_j ( L_j + 10·log10(w_ij) + t_i )
 *
 * which is a linear system in the max-plus algebra, where "add" is max and
 * "multiply" is plus. Such a system grows at its max-plus eigenvalue, and that
 * eigenvalue is the **maximum cycle mean** of the graph whose edge j → i carries
 * t_i + 10·log10(w_ij). Two players each needing 3 dB over the other is a cycle
 * of mean 3: the room gets 3 dB louder every round, forever, and no starting
 * level changes that. Make one of them content to sit 1 dB *under* and the cycle
 * mean is 1, so it still runs away but takes three times as long. Make the mean
 * negative and the ensemble balances.
 *
 * The soft maximum is the interesting correction. Summing two equal neighbours
 * gives 3 dB more than taking the larger, so a player with several comparable
 * rivals climbs faster than max-plus predicts — by about 10·log10(how many
 * rivals are comparable). The prediction is a floor, not an estimate, and the
 * gap is a measure of how crowded the band is.
 */

export interface Player {
  /** Centre of the band this player occupies and listens in, in Hz. */
  f: number
  /** Half-width in octaves — how much of the spectrum it takes up. */
  oct: number
  /** How many dB above what it hears this player wants to be. */
  target: number
}

/**
 * w[i][j] — how much of j's output lands in i's band, from the overlap of two
 * Gaussians in log-frequency. 1 when they sit on top of each other, ~0 when
 * they are far apart, which is why players in different registers do not
 * compete and players in the same one do.
 */
export function overlap(ps: Player[]): number[][] {
  const n = ps.length
  const w: number[][] = []
  for (let i = 0; i < n; i++) {
    w.push([])
    for (let j = 0; j < n; j++) {
      const d = Math.log2(ps[i].f / ps[j].f)
      const s2 = ps[i].oct * ps[i].oct + ps[j].oct * ps[j].oct
      w[i].push(Math.exp((-d * d) / (2 * s2)))
    }
  }
  return w
}

/** A[i][j] — the dB that edge j → i adds: what i needs over j to be content. */
export function edges(ps: Player[], w: number[][]): number[][] {
  const n = ps.length
  const A: number[][] = []
  for (let i = 0; i < n; i++) {
    A.push([])
    for (let j = 0; j < n; j++) {
      A[i].push(i === j ? -Infinity : ps[i].target + 10 * Math.log10(Math.max(1e-12, w[i][j])))
    }
  }
  return A
}

/**
 * The maximum cycle mean of A, by Karp's algorithm — the max-plus eigenvalue,
 * and so the dB per round the ensemble grows at once the transient is gone.
 *
 * D[k][v] is the heaviest walk of exactly k edges from a fixed source to v.
 * Karp's identity is that the answer is
 *   max over v of  min over k<n of  (D[n][v] − D[k][v]) / (n − k)
 * which is exact rather than a search, and needs no cycle enumeration.
 */
export function maxCycleMean(A: number[][]): number {
  const n = A.length
  if (n === 0) return -Infinity
  const D: number[][] = []
  for (let k = 0; k <= n; k++) D.push(new Array(n).fill(-Infinity))
  D[0][0] = 0
  for (let k = 1; k <= n; k++) {
    for (let v = 0; v < n; v++) {
      let best = -Infinity
      for (let u = 0; u < n; u++) {
        if (D[k - 1][u] === -Infinity || A[v][u] === -Infinity) continue
        best = Math.max(best, D[k - 1][u] + A[v][u])
      }
      D[k][v] = best
    }
  }
  let lambda = -Infinity
  for (let v = 0; v < n; v++) {
    if (D[n][v] === -Infinity) continue
    let worst = Infinity
    for (let k = 0; k < n; k++) {
      if (D[k][v] === -Infinity) continue
      worst = Math.min(worst, (D[n][v] - D[k][v]) / (n - k))
    }
    lambda = Math.max(lambda, worst)
  }
  return lambda
}

/**
 * What player i hears of everyone else, in dB. The true sum, not the maximum.
 *
 * Computed by factoring out the largest term, which is not fussiness: summing
 * the powers directly underflows once levels get far below zero — a quiet
 * ensemble reaches −1400 dB in a couple of hundred rounds — and every term
 * becomes exactly 0, so this returns −Infinity and the model appears to
 * collapse. It looks like the ensemble dying and it is the arithmetic dying.
 */
export function heard(L: number[], w: number[][], i: number): number {
  let mx = -Infinity
  for (let j = 0; j < L.length; j++) {
    if (j === i || w[i][j] <= 0) continue
    mx = Math.max(mx, L[j] + 10 * Math.log10(w[i][j]))
  }
  if (mx === -Infinity) return -Infinity
  let s = 0
  for (let j = 0; j < L.length; j++) {
    if (j === i || w[i][j] <= 0) continue
    s += Math.pow(10, (L[j] + 10 * Math.log10(w[i][j]) - mx) / 10)
  }
  return mx + 10 * Math.log10(s)
}

/**
 * One round. `rate` is how far each player moves toward contentment; at 1 this
 * is the max-plus iteration exactly, and below 1 the whole thing simply runs
 * slower — the growth rate should come out as rate × the cycle mean.
 *
 * `held` pins a player at a level you are choosing yourself, which is the only
 * way to play this: you cannot win, but you can set the pace.
 */
export function round(
  L: number[],
  ps: Player[],
  w: number[][],
  rate: number,
  floor = -60,
  ceiling = 0,
  held: number | null = null,
  heldLevel = 0,
): number[] {
  const out = L.slice()
  for (let i = 0; i < L.length; i++) {
    if (i === held) {
      out[i] = Math.min(ceiling, Math.max(floor, heldLevel))
      continue
    }
    const m = heard(L, w, i)
    const want = m === -Infinity ? floor : m + ps[i].target
    out[i] = Math.min(ceiling, Math.max(floor, L[i] + rate * (want - L[i])))
  }
  return out
}

/** dB per round, measured by running the model with no ceiling in the way. */
export function growthRate(
  ps: Player[],
  w: number[][],
  rate: number,
  rounds = 400,
  settle = 200,
): number {
  let L = ps.map(() => 0)
  for (let t = 0; t < settle; t++) L = round(L, ps, w, rate, -1e9, 1e9)
  const before = Math.max(...L)
  for (let t = 0; t < rounds; t++) L = round(L, ps, w, rate, -1e9, 1e9)
  return (Math.max(...L) - before) / rounds
}
