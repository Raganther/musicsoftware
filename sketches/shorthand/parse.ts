/**
 * What is the shortest way to write this tune down?
 *
 * `rhyme` took a list of rhymes — "bar 5 is bar 2, up a third" — and solved for
 * the notes. It was told the structure. This asks the other question: given the
 * notes, *find* the structure, by looking for the description that takes the
 * fewest bits.
 *
 * Written as a coding problem it is Lempel–Ziv, with one change that makes it
 * music. LZ77 parses a string left to right into literals and back-references;
 * a back-reference here may also be transposed, inverted, or reversed, which is
 * exactly a composer's vocabulary. And because the parse is left to right, the
 * *position* of each token is implicit — so the whole thing is a shortest path
 * over note positions and the optimum is a dynamic program, not a search.
 *
 * Description length is only a meaningful number if the code is written down,
 * so it is, in `bits` below. Everything is in scale degrees: intervals rather
 * than pitches, so "transposed" is an integer offset.
 *
 * By relative path, not `@core`: the harness imports this module directly in
 * node, and node cannot resolve a Vite alias.
 */
import { rng, type Rng } from '../../src/core/random.ts'

/** How a span is derived from an earlier one. */
export interface Transform {
  /** +1 is a transposition, −1 an inversion about the anchor. */
  a: 1 | -1
  /** Degrees added after the inversion. Fixed by the first note — see `fit`. */
  b: number
  /** Read the source backwards. */
  retro: boolean
}

export interface FreeToken {
  kind: 'free'
  at: number
  /** Always 1: a literal is one note, so the parse can stop anywhere. */
  len: 1
  deg: number
}

export interface RhymeToken {
  kind: 'rhyme'
  at: number
  len: number
  /** Where the source span starts. Always before `at`. */
  from: number
  t: Transform
  /** Notes the transform got wrong, which have to be written out anyway. */
  fixes: Array<{ i: number; deg: number }>
}

export type Token = FreeToken | RhymeToken

/** Degrees the alphabet holds, which is what a literal costs to name. */
export const LO = -4
export const HI = 11
export const ALPHABET = HI - LO + 1

/**
 * The code, stated.
 *
 * Every token starts with one bit saying which kind it is. A literal then names
 * a degree. A back-reference names where to look, how far to read, whether to
 * invert and whether to reverse, the offset, and then the exceptions: how many,
 * and for each one where it is and what it should have been.
 *
 * None of these are entropy-coded, so the numbers are an upper bound on the
 * true description length. What matters is that the same code prices every
 * parse, so comparing two parses is fair.
 */
export const bits = {
  tag: 1,
  literal: Math.log2(ALPHABET),
  offset: Math.log2(ALPHABET),
  flags: 2,
  pos: (n: number) => Math.log2(Math.max(2, n)),
  len: (maxLen: number) => Math.log2(Math.max(2, maxLen)),
  fixCount: (maxLen: number) => Math.log2(Math.max(2, maxLen)),
  fix: (len: number) => Math.log2(Math.max(2, len)) + Math.log2(ALPHABET),
}

export function tokenCost(tok: Token, n: number, maxLen: number): number {
  if (tok.kind === 'free') return bits.tag + bits.literal
  return (
    bits.tag +
    bits.pos(n) +
    bits.len(maxLen) +
    bits.flags +
    bits.offset +
    bits.fixCount(maxLen) +
    tok.fixes.length * bits.fix(tok.len)
  )
}

export const totalCost = (toks: Token[], n: number, maxLen: number) =>
  toks.reduce((s, t) => s + tokenCost(t, n, maxLen), 0)

/** What the same tune costs with no structure at all: every note a literal. */
export const flatCost = (n: number) => n * (bits.tag + bits.literal)

// -- matching ----------------------------------------------------------------

/**
 * Try one back-reference and report how many notes it gets wrong.
 *
 * The offset is read off the first note, which is what "that phrase, up a
 * third" means — a rhyme is anchored where it starts. Choosing the offset that
 * minimises errors instead would fit better and mean less.
 */
export function fit(
  d: number[],
  at: number,
  from: number,
  len: number,
  a: 1 | -1,
  retro: boolean,
  tol: number,
): { b: number; fixes: Array<{ i: number; deg: number }> } | null {
  if (from < 0 || at + len > d.length || from + len > at) return null
  const src = (i: number) => d[from + (retro ? len - 1 - i : i)]
  const b = d[at] - a * src(0)
  const fixes: Array<{ i: number; deg: number }> = []
  for (let i = 0; i < len; i++) {
    const want = a * src(i) + b
    if (Math.abs(d[at + i] - want) > tol) fixes.push({ i, deg: d[at + i] })
  }
  return { b, fixes }
}

export interface Options {
  minLen: number
  maxLen: number
  /** How far a note may be from what the transform predicts and still pass. */
  tol: number
  invert: boolean
  retro: boolean
}

/**
 * The cheapest description of `d`, exactly.
 *
 * `best[i]` is the fewest bits that describe the first i notes; a token ending
 * at i extends some `best[j]`. Every token is tried, so this is an optimum and
 * not a greedy parse — the point of doing it as a shortest path.
 */
export function parse(d: number[], o: Options): { toks: Token[]; cost: number } {
  const n = d.length
  const best = new Float64Array(n + 1).fill(Infinity)
  const back: Array<Token | null> = new Array(n + 1).fill(null)
  best[0] = 0

  const signs: Array<1 | -1> = o.invert ? [1, -1] : [1]
  const retros = o.retro ? [false, true] : [false]

  for (let i = 0; i < n; i++) {
    if (!isFinite(best[i])) continue
    // a literal always works
    const lit: FreeToken = { kind: 'free', at: i, len: 1, deg: d[i] }
    const c = best[i] + tokenCost(lit, n, o.maxLen)
    if (c < best[i + 1]) {
      best[i + 1] = c
      back[i + 1] = lit
    }
    // and every back-reference that fits
    const maxHere = Math.min(o.maxLen, n - i, i)
    for (let len = o.minLen; len <= maxHere; len++) {
      for (let from = 0; from + len <= i; from++) {
        for (const a of signs) {
          for (const retro of retros) {
            const f = fit(d, i, from, len, a, retro, o.tol)
            if (!f) continue
            const tok: RhymeToken = {
              kind: 'rhyme',
              at: i,
              len,
              from,
              t: { a, b: f.b, retro },
              fixes: f.fixes,
            }
            const cc = best[i] + tokenCost(tok, n, o.maxLen)
            if (cc < best[i + len]) {
              best[i + len] = cc
              back[i + len] = tok
            }
          }
        }
      }
    }
  }

  const toks: Token[] = []
  let at = n
  while (at > 0) {
    const t = back[at]
    if (!t) break
    toks.push(t)
    at -= t.kind === 'free' ? 1 : t.len
  }
  toks.reverse()
  return { toks, cost: best[n] }
}

/** Rebuild the tune from its description — the check that the code is lossless. */
export function realise(toks: Token[], n: number): number[] {
  const d = new Array<number>(n).fill(0)
  for (const t of toks) {
    if (t.kind === 'free') {
      d[t.at] = t.deg
      continue
    }
    for (let i = 0; i < t.len; i++) {
      const j = t.from + (t.t.retro ? t.len - 1 - i : i)
      d[t.at + i] = t.t.a * d[j] + t.t.b
    }
    for (const f of t.fixes) d[t.at + f.i] = f.deg
  }
  return d
}

/** Which notes had to be written out: the skeleton you would hand somebody. */
export function freeMask(toks: Token[], n: number): boolean[] {
  const free = new Array<boolean>(n).fill(false)
  for (const t of toks) {
    if (t.kind === 'free') free[t.at] = true
    else for (const f of t.fixes) free[t.at + f.i] = true
  }
  return free
}

// -- making tunes to look at --------------------------------------------------

export interface Planted {
  degrees: number[]
  /** The parse the generator used, so a found parse has something to be judged against. */
  toks: Token[]
}

/**
 * Build a tune *by* writing a description and realising it, so the structure is
 * known rather than hoped for. `structure` is how often the generator reaches
 * for a rhyme rather than a new note.
 */
export function compose(n: number, seed: number, structure: number, o: Options): Planted {
  const r: Rng = rng(seed)
  const d: number[] = []
  const toks: Token[] = []
  let deg = 0
  while (d.length < n) {
    const i = d.length
    const maxHere = Math.min(o.maxLen, n - i, i)
    if (maxHere >= o.minLen && r.chance(structure)) {
      const len = r.int(o.minLen, maxHere)
      const from = r.int(0, i - len)
      const a: 1 | -1 = o.invert && r.chance(0.25) ? -1 : 1
      const retro = o.retro && r.chance(0.2)
      const b = r.int(-3, 3)
      const tok: RhymeToken = { kind: 'rhyme', at: i, len, from, t: { a, b, retro }, fixes: [] }
      for (let k = 0; k < len; k++) {
        const j = from + (retro ? len - 1 - k : k)
        const v = a * d[j] + b
        d.push(Math.max(LO, Math.min(HI, v)))
        // the clamp is a change, so it has to be recorded as one or the
        // generator's own description would not rebuild its own tune
        if (d[i + k] !== v) tok.fixes.push({ i: k, deg: d[i + k] })
      }
      toks.push(tok)
      deg = d[d.length - 1]
    } else {
      deg = Math.max(LO, Math.min(HI, deg + r.int(-3, 3)))
      d.push(deg)
      toks.push({ kind: 'free', at: i, len: 1, deg })
    }
  }
  return { degrees: d, toks }
}

/** A tune with no structure to find: an unconstrained walk. */
export function walk(n: number, seed: number): number[] {
  const r = rng(seed)
  const d: number[] = []
  let deg = 0
  for (let i = 0; i < n; i++) {
    deg = Math.max(LO, Math.min(HI, deg + r.int(-3, 3)))
    d.push(deg)
  }
  return d
}

/** Degrees drawn with no memory at all — the incompressible control. */
export function noise(n: number, seed: number): number[] {
  const r = rng(seed)
  return Array.from({ length: n }, () => r.int(LO, HI))
}

// -- judging a parse against a known one --------------------------------------

/**
 * How much of a planted structure a parse recovered.
 *
 * A rhyme counts as found if some token covers the same notes by the same
 * transform from the same place. Being stricter than that would punish a parse
 * for finding an equally good description that happens to differ, which is not
 * a failure — so the cost comparison is the real test and this is the readable
 * one.
 */
export function recovered(found: Token[], planted: Token[]): { hit: number; total: number } {
  const key = (t: Token) =>
    t.kind === 'free' ? `f${t.at}` : `r${t.at}:${t.len}:${t.from}:${t.t.a}:${t.t.b}:${t.t.retro}`
  const have = new Set(found.map(key))
  const want = planted.filter((t) => t.kind === 'rhyme')
  return { hit: want.filter((t) => have.has(key(t))).length, total: want.length }
}
