/**
 * A hocket for more than two voices, by nesting.
 *
 * `hocket` established both halves of Rayleigh and Uspensky: two voices at
 * densities d and 1−d hit every step exactly once — 0 collisions and 0 gaps
 * over 200,000 steps — and **three or more Beatty sequences cannot do it at
 * all**, whatever densities you pick. A 40-restart search reached 0.0000 with
 * two voices and 0.2400 with three.
 *
 * But the steps a voice does *not* play are themselves a Beatty sequence. So
 * split those again. And again. The result is a binary tree: each node hands
 * its stream of steps to two children by the same rule that worked for two, and
 * every leaf is a voice.
 *
 * Uspensky is not violated, it is sidestepped. A nested voice is a Beatty
 * sequence *of a Beatty sequence*, which is not a Beatty sequence — the
 * fingerprint is the gap structure, since three-distance gives a real Beatty
 * rhythm exactly two distinct inter-onset gaps and a nested one has more.
 *
 * What was impossible as a list of three densities is exact as a tree of them.
 */

// By relative path, not `@core`: the harness imports this module directly in
// node, and node cannot resolve a Vite alias.
import { beatty, beattyCount } from '../../src/core/theory.ts'

export interface Node {
  /** Density given to the left child. The right child gets 1 − d. */
  d: number
  left: Node | number
  right: Node | number
}

export type Tree = Node | number

export const isLeaf = (t: Tree): t is number => typeof t === 'number'

/**
 * Which voice owns step m.
 *
 * Walks down the tree carrying m's *index within the current node's stream*,
 * which is the whole trick: membership alone is not enough to nest, you have to
 * know where in the subsequence you landed.
 */
export function owner(t: Tree, m: number): number {
  let node = t
  let k = m
  while (!isLeaf(node)) {
    if (beatty(node.d, k)) {
      k = beattyCount(node.d, k)
      node = node.left
    } else {
      k = k - beattyCount(node.d, k)
      node = node.right
    }
  }
  return node
}

/** How many leaves, and what density each ends up with. */
export function leaves(t: Tree, acc = 1, out: Map<number, number> = new Map()): Map<number, number> {
  if (isLeaf(t)) {
    out.set(t, (out.get(t) ?? 0) + acc)
    return out
  }
  leaves(t.left, acc * t.d, out)
  leaves(t.right, acc * (1 - t.d), out)
  return out
}

export function depth(t: Tree): number {
  return isLeaf(t) ? 0 : 1 + Math.max(depth(t.left), depth(t.right))
}

/**
 * Build a tree with `n` leaves.
 *
 * 'balanced' halves the voices at each node; 'chain' peels one voice off at a
 * time, which is the shape a person would write down. Same leaf count, and —
 * measured — different rhythms with the same exactness.
 */
export function build(
  n: number,
  shape: 'balanced' | 'chain',
  dens: (level: number, index: number) => number,
): Tree {
  let next = 0
  const rec = (count: number, level: number): Tree => {
    if (count <= 1) return next++
    const d = dens(level, next)
    if (shape === 'chain') {
      return { d, left: next++, right: rec(count - 1, level + 1) }
    }
    const half = Math.ceil(count / 2)
    const left = rec(half, level + 1)
    const right = rec(count - half, level + 1)
    return { d, left, right }
  }
  return rec(Math.max(1, Math.round(n)), 0)
}

export interface Report {
  /** Steps owned by each voice. */
  counts: number[]
  /** Steps owned by nobody, or by more than one — zero by construction here. */
  gaps: number
  /** Distinct inter-onset gaps per voice; a Beatty rhythm has exactly two. */
  distinct: number[][]
}

/** Walk `upto` steps and report who played what. */
export function run(t: Tree, upto: number, nVoices: number): Report {
  const counts = new Array<number>(nVoices).fill(0)
  const last = new Array<number>(nVoices).fill(0)
  const seen: Set<number>[] = Array.from({ length: nVoices }, () => new Set())
  let gaps = 0
  for (let m = 1; m <= upto; m++) {
    const v = owner(t, m)
    if (v < 0 || v >= nVoices) {
      gaps++
      continue
    }
    counts[v]++
    if (last[v] > 0) seen[v].add(m - last[v])
    last[v] = m
  }
  return { counts, gaps, distinct: seen.map((s) => [...s].sort((a, b) => a - b)) }
}
