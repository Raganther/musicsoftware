/**
 * Pitch, scales, chords. Everything speaks MIDI note numbers (60 = middle C).
 */

export const A4 = 440
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

/** MIDI note number -> frequency in Hz. */
export function mtof(midi: number, a4 = A4): number {
  return a4 * Math.pow(2, (midi - 69) / 12)
}

/** Frequency in Hz -> (fractional) MIDI note number. */
export function ftom(freq: number, a4 = A4): number {
  return 69 + 12 * Math.log2(freq / a4)
}

export function noteName(midi: number): string {
  const n = Math.round(midi)
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`
}

/** "C4", "F#3", "Bb5" -> MIDI note number. */
export function parseNote(name: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim())
  if (!m) throw new Error(`bad note name: ${name}`)
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()]!
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
  return (Number(m[3]) + 1) * 12 + base + acc
}

// ---------------------------------------------------------------------------
// Scales — intervals in semitones from the root
// ---------------------------------------------------------------------------

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
  octatonic: [0, 2, 3, 5, 6, 8, 9, 11],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
} as const

export type ScaleName = keyof typeof SCALES
export const SCALE_NAMES = Object.keys(SCALES) as ScaleName[]

/** Ascending note numbers for a scale, spanning `octaves` from `root`. */
export function scaleNotes(root: number, scale: ScaleName, octaves = 2): number[] {
  const steps = SCALES[scale]
  const out: number[] = []
  for (let o = 0; o < octaves; o++) {
    for (const s of steps) out.push(root + o * 12 + s)
  }
  out.push(root + octaves * 12)
  return out
}

/** Snap any note to the nearest member of a scale. */
export function quantize(midi: number, root: number, scale: ScaleName): number {
  const steps = SCALES[scale]
  const rel = midi - root
  const oct = Math.floor(rel / 12)
  const pc = ((rel % 12) + 12) % 12
  let best: number = steps[0]
  let dist = Infinity
  for (const s of steps) {
    const d = Math.abs(s - pc)
    if (d < dist) {
      dist = d
      best = s
    }
  }
  return root + oct * 12 + best
}

/**
 * Degree-based lookup that wraps into octaves — the workhorse for generative
 * lines. degree 0 = root, 7 = root an octave up, -1 = the note below.
 */
export function degree(root: number, scale: ScaleName, deg: number): number {
  const steps = SCALES[scale]
  const n = steps.length
  const oct = Math.floor(deg / n)
  const idx = ((deg % n) + n) % n
  return root + oct * 12 + steps[idx]
}

// ---------------------------------------------------------------------------
// Chords
// ---------------------------------------------------------------------------

export const CHORDS = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  min7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  maj9: [0, 4, 7, 11, 14],
  min9: [0, 3, 7, 10, 14],
  add9: [0, 4, 7, 14],
  six9: [0, 4, 7, 9, 14],
} as const

export type ChordName = keyof typeof CHORDS
export const CHORD_NAMES = Object.keys(CHORDS) as ChordName[]

export function chord(root: number, name: ChordName, inversion = 0): number[] {
  const notes = CHORDS[name].map((i) => root + i)
  for (let i = 0; i < inversion; i++) notes.push(notes.shift()! + 12)
  return notes
}

/** Triad built on a scale degree, using only notes from that scale. */
export function diatonicTriad(root: number, scale: ScaleName, deg: number): number[] {
  return [0, 2, 4].map((i) => degree(root, scale, deg + i))
}

// ---------------------------------------------------------------------------
// Rhythm
// ---------------------------------------------------------------------------

/**
 * Euclidean rhythm — distribute `pulses` as evenly as possible over `steps`.
 * E(3,8) = the tresillo, E(5,8) = the cinquillo. Endlessly useful.
 */
export function euclid(pulses: number, steps: number, rotate = 0): boolean[] {
  if (pulses <= 0 || steps <= 0) return new Array(Math.max(0, steps)).fill(false)
  if (pulses >= steps) return new Array(steps).fill(true)

  const pattern: boolean[] = []
  let bucket = 0
  for (let i = 0; i < steps; i++) {
    bucket += pulses
    if (bucket >= steps) {
      bucket -= steps
      pattern.push(true)
    } else {
      pattern.push(false)
    }
  }

  const r = ((rotate % steps) + steps) % steps
  return r ? [...pattern.slice(r), ...pattern.slice(0, r)] : pattern
}

/** Velocity curve helper: 0..1 -> 0..1 with a bend. gamma > 1 = softer. */
export function curve(x: number, gamma = 2): number {
  return Math.pow(Math.max(0, Math.min(1, x)), gamma)
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
