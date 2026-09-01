/**
 * The harmony behind a modulation, kept separate from the sound so that the
 * verification harness can re-derive every claim from the same primitives
 * without going through the sketch.
 *
 * A modulation has a junction, and the interesting thing about a *pivot*
 * modulation is that the junction is deliberately inaudible: the pivot chord
 * belongs to both keys, so nothing about it says the key has changed. The
 * information arrives later, with the first chord that the old key cannot
 * explain. Which chord that is depends on the direction of travel and is
 * computed here rather than assumed — for a modulation to the dominant it is
 * the new V (a raised fourth degree), but going the other way, to the
 * subdominant, the new key's V *is* the old tonic and gives nothing away.
 */

export type Mode = 'major' | 'minor'

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
/**
 * Harmonic minor, not natural. The raised seventh is what makes a minor key's
 * V a major triad, and a modulation with no functional dominant is not the
 * thing being studied. It also means the key's collection has eight pitch
 * classes rather than seven, which the "can the old key explain this chord"
 * test has to use or it will call an ordinary minor cadence foreign.
 */
const MINOR = [0, 2, 3, 5, 7, 8, 10, 11]

export const pc = (n: number) => ((n % 12) + 12) % 12

/** Every pitch class the key can account for. */
export function keyPcs(tonic: number, mode: Mode): number[] {
  return (mode === 'major' ? MAJOR : MINOR).map((i) => pc(tonic + i))
}

/**
 * The triad on a degree, 0-indexed. Minor uses natural sixth and seventh for
 * its own triads except on V, which is major — the ordinary practice.
 */
export function triadPcs(tonic: number, mode: Mode, deg: number): number[] {
  const steps = mode === 'major' ? MAJOR : [0, 2, 3, 5, 7, 8, 10]
  const at = (d: number) => {
    const oct = Math.floor(d / 7)
    return steps[((d % 7) + 7) % 7] + 12 * oct
  }
  const notes = [0, 2, 4].map((i) => at(deg + i))
  if (mode === 'minor' && (deg === 4 || deg === 6)) {
    // raise the seventh degree wherever it appears in a dominant-function chord
    for (let i = 0; i < notes.length; i++) if (pc(notes[i]) === pc(10)) notes[i] += 1
  }
  return notes.map((n) => pc(tonic + n))
}

const MAJ_ROMAN = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']
const MIN_ROMAN = ['i', 'ii°', 'III', 'iv', 'V', 'VI', 'vii°']
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export const roman = (mode: Mode, deg: number) =>
  (mode === 'major' ? MAJ_ROMAN : MIN_ROMAN)[((deg % 7) + 7) % 7]
export const keyName = (tonic: number, mode: Mode) =>
  `${NAMES[pc(tonic)]}${mode === 'minor' ? 'm' : ''}`

const sameSet = (a: number[], b: number[]) => {
  if (a.length !== b.length) return false
  const s = [...a].sort((x, y) => x - y)
  const t = [...b].sort((x, y) => x - y)
  return s.every((v, i) => v === t[i])
}

/**
 * Chords that belong to both keys, as (degree in A, degree in B) pairs.
 *
 * This is the classical pivot table, computed rather than looked up. Distant
 * keys simply have none — which is why a modulation by a tritone has to be
 * direct, and the sketch says so instead of pretending.
 */
export function pivotsBetween(
  aTonic: number, aMode: Mode, bTonic: number, bMode: Mode,
): { degA: number; degB: number }[] {
  const out: { degA: number; degB: number }[] = []
  for (let da = 0; da < 7; da++) {
    const A = triadPcs(aTonic, aMode, da)
    for (let db = 0; db < 7; db++) {
      if (sameSet(A, triadPcs(bTonic, bMode, db))) out.push({ degA: da, degB: db })
    }
  }
  return out
}

export interface Chord {
  /** Tonic of the key this chord is functioning in. */
  tonic: number
  mode: Mode
  deg: number
  pcs: number[]
  label: string
  /** 'home' before the junction, 'pivot' at it, 'away' after. */
  role: 'home' | 'pivot' | 'away'
  /** Index of the modulation this chord belongs to, for multi-key runs. */
  section: number
}

/** Can the key `tonic`/`mode` account for every note of this chord? */
export const explainedBy = (c: Chord, tonic: number, mode: Mode) => {
  const k = keyPcs(tonic, mode)
  return c.pcs.every((p) => k.includes(p))
}

interface Rng { next(): number; int(lo: number, hi: number): number }

/**
 * A progression that establishes a key, modulates, establishes the next, and
 * keeps going — so one run walks a chain of keys and the measurement gets
 * several modulations rather than one.
 */
export function buildProgression(opts: {
  tonic: number
  mode: Mode
  fifths: number
  /** How many chords the pivot area lasts. 0 makes the modulation direct. */
  pivotLen: number
  homeLen: number
  awayLen: number
  sections: number
  r: Rng
}): Chord[] {
  const { r } = opts
  // Functional successions, deliberately conventional: the experiment is about
  // where the ear notices a key change, which needs the harmony to be ordinary
  // enough that the ear has a key to be sure of in the first place.
  const NEXT: Record<number, number[]> = {
    0: [3, 4, 5, 1], 1: [4, 6], 2: [5, 3], 3: [4, 0, 1], 4: [0, 5], 5: [1, 3], 6: [0],
  }
  const out: Chord[] = []
  let tonic = pc(opts.tonic)
  let mode = opts.mode

  for (let s = 0; s < opts.sections; s++) {
    const next = pc(tonic + 7 * opts.fifths)
    const pivots = opts.pivotLen > 0 ? pivotsBetween(tonic, mode, next, mode) : []
    // Prefer a pivot that is not the tonic of either key: a pivot that is
    // literally I or i announces itself, and the point of a pivot is that it
    // does not.
    const quiet = pivots.filter((p) => p.degA !== 0 && p.degB !== 0)
    const chosen = quiet.length ? quiet[r.int(0, quiet.length - 1)]
      : pivots.length ? pivots[r.int(0, pivots.length - 1)] : null

    // establish the key
    let deg = 0
    for (let i = 0; i < opts.homeLen; i++) {
      out.push({
        tonic, mode, deg, pcs: triadPcs(tonic, mode, deg),
        label: roman(mode, deg), role: 'home', section: s,
      })
      const opts2 = NEXT[deg] ?? [0]
      deg = opts2[r.int(0, opts2.length - 1)]
    }

    /**
     * The pivot area, which is `pivotLen` chords long rather than one.
     *
     * Length is the whole point of the experiment: prolonging the pivot moves
     * the *notated* junction earlier and earlier relative to the first foreign
     * chord, while leaving the evidence untouched. If the ear follows the
     * evidence, the measured turn should not move at all. Composers prolong
     * pivots for exactly this reason, so this is ordinary practice rather than
     * a contrivance built to make a graph.
     */
    if (chosen) {
      const alt = quiet.length > 1 ? quiet.filter((q2) => q2 !== chosen) : []
      for (let k = 0; k < opts.pivotLen; k++) {
        const use = k % 2 === 1 && alt.length ? alt[0] : chosen
        out.push({
          tonic, mode, deg: use.degA, pcs: triadPcs(tonic, mode, use.degA),
          // named in both keys at once, which is what a pivot is
          label: `${roman(mode, use.degA)} = ${roman(mode, use.degB)}`,
          role: 'pivot', section: s,
        })
      }
    }

    // the new key, entered through its own ii - V - i
    for (const d of [1, 4, 0]) {
      out.push({
        tonic: next, mode, deg: d, pcs: triadPcs(next, mode, d),
        label: roman(mode, d), role: 'away', section: s,
      })
    }
    deg = 0
    for (let i = 3; i < opts.awayLen; i++) {
      const opts2 = NEXT[deg] ?? [0]
      deg = opts2[r.int(0, opts2.length - 1)]
      out.push({
        tonic: next, mode, deg, pcs: triadPcs(next, mode, deg),
        label: roman(mode, deg), role: 'away', section: s,
      })
    }
    tonic = next
  }
  return out
}

// ---------------------------------------------------------------------------
// Key finding
// ---------------------------------------------------------------------------

/**
 * Krumhansl-Kessler probe-tone profiles. Published numbers, used as published,
 * so the key-finding step is somebody else's algorithm rather than one tuned
 * until it agreed with me.
 */
export const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
export const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

function corr(a: number[], b: number[]): number {
  const n = a.length
  const ma = a.reduce((x, y) => x + y, 0) / n
  const mb = b.reduce((x, y) => x + y, 0) / n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) {
    const u = a[i] - ma
    const v = b[i] - mb
    num += u * v
    da += u * u
    db += v * v
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0
}

/** Correlation of a chroma vector with all 24 keys; index = tonic + 12*minor. */
export function keyScores(chroma: number[]): number[] {
  const out: number[] = []
  for (let mode = 0; mode < 2; mode++) {
    const prof = mode === 0 ? KK_MAJOR : KK_MINOR
    for (let t = 0; t < 12; t++) {
      out[t + 12 * mode] = corr(chroma, prof.map((_, i) => prof[pc(i - t)]))
    }
  }
  return out
}

export const keyIndex = (tonic: number, mode: Mode) => pc(tonic) + (mode === 'minor' ? 12 : 0)
