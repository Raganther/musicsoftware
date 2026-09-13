/**
 * Beatty sequences, and whether a set of them tiles the pulse.
 *
 * A voice of density d plays the steps { floor(n/d) : n = 1, 2, 3, … } — a
 * Beatty sequence. Its density among the positive integers is d.
 *
 * Rayleigh (1894): two such voices at densities d and 1−d hit every step
 * exactly once, and no step twice, **iff d is irrational**. So a two-part
 * hocket at an irrational density is exact and needs no agreement beyond the
 * one number.
 *
 * Uspensky (1927): there is no such partition into three or more. Whatever
 * three densities you choose, some steps get two notes and some get none.
 */

/**
 * Does a voice of density d play step m?
 *
 * m is in { floor(n/d) } iff some integer n lies in [m·d, (m+1)·d), which is
 * the closed form below. Stateless, so the picture and the sound can be
 * computed from the same call — worth more than it sounds, because a cursor
 * that has to be stepped in order cannot be asked about a step twice.
 */
export function plays(d: number, m: number): boolean {
  if (m < 1 || d <= 0 || d >= 1) return d >= 1 && m >= 1
  return Math.ceil(m * d) < (m + 1) * d
}

/** Steps 1…upto that a voice of density d plays. */
export function hits(d: number, upto: number): Uint8Array {
  const s = new Uint8Array(upto + 1)
  for (let m = 1; m <= upto; m++) if (plays(d, m)) s[m] = 1
  return s
}

export interface Defects {
  /** Steps carrying more than one note. */
  coll: number
  /** Steps carrying none. */
  gap: number
  /** (coll + gap) / steps. Zero exactly when the voices tile the pulse. */
  rate: number
}

/** How badly a set of densities fails to tile steps 1…upto. */
export function defects(ds: number[], upto: number): Defects {
  let coll = 0
  let gap = 0
  for (let m = 1; m <= upto; m++) {
    let k = 0
    for (const d of ds) if (plays(d, m)) k++
    if (k === 0) gap++
    else if (k > 1) coll++
  }
  return { coll, gap, rate: (coll + gap) / upto }
}

/**
 * The densities for n voices: the first takes `split`, the rest divide what is
 * left equally, and `err` is added to the second — which is the only way to
 * hear how tight the agreement has to be, since the complement is otherwise
 * computed rather than played.
 */
export function densities(split: number, n: number, err = 0): number[] {
  const ds = [split]
  const each = (1 - split) / Math.max(1, n - 1)
  for (let i = 1; i < n; i++) ds.push(each + (i === 1 ? err : 0))
  return ds
}
