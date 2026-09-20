/**
 * A stick that hits a bar over and over, and what happens when it cannot get
 * out of the way in time.
 *
 * `mallet` established that a mallet is a nonlinear spring: two curved elastic
 * bodies obey Hertz's law F = k·c^p, and the time they stay in contact depends
 * on how fast they met,
 *
 *     t_c ∝ v^((1−p)/(1+p))
 *
 * — about 1–3 ms for anything hard. That number is usually a footnote about
 * brightness. It is also a *rate*: it says how often you can strike before the
 * strikes stop being separate events. Below 1/t_c a roll is a train of
 * impacts. Above it the stick never leaves, and a roll is not thirty strikes,
 * it is one continuous contact — a press roll, which no synthesiser models and
 * every drummer can do.
 *
 * The exact contact time is not just a scaling. For m·c̈ = −k·c^p with c(0)=0,
 * ċ(0)=v, energy gives c_max = ((p+1)mv²/2k)^(1/(p+1)) and the quadrature
 * closes in Beta functions:
 *
 *     t_c = (2·c_max / v) · B(1/(p+1), 1/2) / (p+1)
 *
 * so the integrator has an absolute number to hit, not merely an exponent.
 *
 * The numerics here are the same recursion the worklet runs, deliberately, so
 * that agreeing with it means something.
 *
 * By relative path, not `@core`: the harness imports this module directly in
 * node, and node cannot resolve a Vite alias.
 */

/** Compression at which `stiffN` is quoted, so `p` changes shape and not scale. */
export const C_REF = 2.5e-4
/** Modal mass of a bar's fundamental, kg. A marimba bar is a few tens of grams. */
export const MODAL_MASS = 0.045

export interface Mode {
  f: number
  t60: number
  /** Mode shape at the contact point — how hard the force drives it. */
  shape: number
  /** Modal mass in kg — a real number, because the stick's mass is compared to it. */
  mmass: number
}

export interface Config {
  sr: number
  modes: Mode[]
  /** Stick mass, kg. */
  mass: number
  /** Hertz exponent. 1 is a linear spring, 3/2 two curved elastic bodies. */
  p: number
  /** Force in newtons needed to squash the head by C_REF. */
  stiffN: number
  /** Strokes per second the hand drives. 0 is a dead press. */
  rate: number
  /** How far the hand lifts the stick between strokes, metres. */
  lift: number
  /** How hard the hand leans in, newtons. */
  press: number
  /** Grip stiffness, N/m. A hand is soft; a machine is not. */
  grip: number
  /** Grip damping, N·s/m. */
  gripDamp: number
  /** Speed the stick arrives at on the first strike, m/s. */
  drop?: number
}

export interface Contact {
  /** Seconds. */
  start: number
  end: number
  /** Relative closing speed at the moment contact began, m/s. */
  vIn: number
  peakForce: number
}

// -- the closed form ---------------------------------------------------------

/** Lanczos gamma, good to ~1e-13 over the range this needs. */
export function gamma(z: number): number {
  const g = 7
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ]
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z))
  z -= 1
  let x = c[0]
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i)
  const t = z + g + 0.5
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x
}

export const beta = (a: number, b: number) => (gamma(a) * gamma(b)) / gamma(a + b)

/** Peak compression of a free Hertzian impact at speed v. */
export function maxCompression(mass: number, k: number, p: number, v: number): number {
  return Math.pow(((p + 1) * mass * v * v) / (2 * k), 1 / (p + 1))
}

/**
 * How long a free Hertzian impact at speed v stays in contact, in seconds.
 * Exact, by quadrature — not a fit and not a scaling.
 */
export function contactTime(mass: number, k: number, p: number, v: number): number {
  const cm = maxCompression(mass, k, p, v)
  return ((2 * cm) / v) * (beta(1 / (p + 1), 0.5) / (p + 1))
}

/** k in F = k·c^p, from the force quoted at C_REF. */
export const stiffness = (stiffN: number, p: number) => stiffN / Math.pow(C_REF, p)

/**
 * What a stuck-on stick does to a bar mode's pitch.
 *
 * In continuous contact the stick is no longer an impactor, it is an attached
 * mass on a spring — a second oscillator. Linearising the contact at working
 * compression c0 gives k_eff = p·k·c0^(p−1), and the two-degree-of-freedom
 * system has the usual pair of roots. The lower one is the bar's mode, pulled
 * flat: that is the press roll's detune, and it has a closed form.
 */
export function loadedModes(f0: number, mmass: number, mass: number, kEff: number) {
  const w0 = 2 * Math.PI * f0
  // bar: modal mass mmass, stiffness mmass·w0²; stick: mass, joined by kEff
  const a = mmass * mass
  const b = -(mmass * kEff + mass * (mmass * w0 * w0 + kEff))
  const c = mmass * w0 * w0 * kEff
  const disc = Math.sqrt(Math.max(0, b * b - 4 * a * c))
  const w2lo = (-b - disc) / (2 * a)
  const w2hi = (-b + disc) / (2 * a)
  return { lo: Math.sqrt(Math.max(0, w2lo)) / (2 * Math.PI), hi: Math.sqrt(Math.max(0, w2hi)) / (2 * Math.PI) }
}

// -- the integrator ----------------------------------------------------------

export interface Trace {
  contacts: Contact[]
  /** Seconds simulated. */
  seconds: number
  /** True if contact was unbroken for the whole second half of the run. */
  merged: boolean
  /** Fraction of the time the stick was touching the bar. */
  duty: number
  /** Peak of the modal sum, metres. */
  peak: number
  /** Samples of the modal sum, if asked for. */
  signal?: Float32Array
}

/**
 * Run the stick against the bar.
 *
 * The hand is a position source through a grip spring, not a prescribed stick
 * position: the stick has to be free to be pushed back, or there is no contact
 * physics left to measure. `rate` is what the hand does. What the *stick* does
 * is measured, which is the only honest way round given a real grip cannot
 * follow a 300 Hz shoulder.
 */
export function run(cfg: Config, seconds: number, keepSignal = false): Trace {
  const sr = cfg.sr
  const n = cfg.modes.length
  const dt = 1 / sr
  const k = stiffness(cfg.stiffN, cfg.p)

  const a1 = new Float64Array(n)
  const a2 = new Float64Array(n)
  const y1 = new Float64Array(n)
  const y2 = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const md = cfg.modes[i]
    const w = (2 * Math.PI * Math.min(md.f, sr * 0.45)) / sr
    const r = Math.pow(10, -3 / (Math.max(0.0004, md.t60) * sr))
    a1[i] = 2 * r * Math.cos(w)
    a2[i] = -r * r
  }

  // Start clear of the bar so the first contact is a real arrival, moving at
  // the drop speed. The worklet does exactly this, and an initial condition of
  // rest instead of 0.9 m/s was why the two disagreed by up to 3.7x.
  let x = -4e-4
  let v = cfg.drop ?? 0
  const total = Math.round(seconds * sr)
  const signal = keepSignal ? new Float32Array(total) : undefined

  const contacts: Contact[] = []
  let inContact = false
  let cStart = 0
  let cPeak = 0
  let cVin = 0
  let touching = 0
  let peak = 0
  const w = 2 * Math.PI * cfg.rate

  for (let s = 0; s < total; s++) {
    const t = s * dt
    let y = 0
    for (let i = 0; i < n; i++) y += cfg.modes[i].shape * y1[i]

    // the hand: a shoulder that lifts and falls, plus a steady lean
    const shoulder = -cfg.lift * (1 - Math.cos(w * t)) * 0.5
    const Fg = cfg.press + cfg.grip * (shoulder - x) - cfg.gripDamp * v

    const c = x - y
    let F = 0
    if (c > 0) {
      F = k * Math.pow(c, cfg.p)
      if (!inContact) {
        inContact = true
        cStart = t
        cPeak = 0
        cVin = v // closing speed at the instant of arrival
      }
      if (F > cPeak) cPeak = F
      touching++
    } else if (inContact) {
      inContact = false
      contacts.push({ start: cStart, end: t, vIn: cVin, peakForce: cPeak })
    }

    v += ((Fg - F) / cfg.mass) * dt
    x += v * dt

    for (let i = 0; i < n; i++) {
      const md = cfg.modes[i]
      const drive = (F * md.shape) / md.mmass
      const o = a1[i] * y1[i] + a2[i] * y2[i] + drive * dt * dt
      y2[i] = y1[i]
      y1[i] = o
    }
    let mix = 0
    for (let i = 0; i < n; i++) mix += y1[i]
    const am = mix < 0 ? -mix : mix
    if (am > peak) peak = am
    if (signal) signal[s] = mix
  }
  if (inContact) contacts.push({ start: cStart, end: seconds, vIn: cVin, peakForce: cPeak })

  // merged means contact never broke in the back half — a transient at the
  // start is not a press roll
  const half = seconds / 2
  const late = contacts.filter((c) => c.end > half)
  const merged = late.length === 1 && late[0].start <= half && late[0].end >= seconds - 2 / sr

  return { contacts, seconds, merged, duty: touching / total, peak, signal }
}

/**
 * Contact time of a single free strike at speed v, measured not predicted.
 *
 * `rigid` holds the bar still, which is the case the closed form describes —
 * a real bar recoils under the force and takes some of the time with it, so
 * the two are different numbers and only one of them has an exact answer.
 */
export function measureSingle(cfg: Config, v: number, rigid = false, seconds = 0.06): number {
  const solo: Config = { ...cfg, rate: 0, lift: 0, press: 0, grip: 0, gripDamp: 0 }
  const sr = cfg.sr
  const n = cfg.modes.length
  const dt = 1 / sr
  const k = stiffness(cfg.stiffN, cfg.p)
  const a1 = new Float64Array(n)
  const a2 = new Float64Array(n)
  const y1 = new Float64Array(n)
  const y2 = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const md = solo.modes[i]
    const w = (2 * Math.PI * Math.min(md.f, sr * 0.45)) / sr
    const r = Math.pow(10, -3 / (Math.max(0.0004, md.t60) * sr))
    a1[i] = 2 * r * Math.cos(w)
    a2[i] = -r * r
  }
  let x = -1e-6
  let vel = v
  let started = -1
  for (let s = 0; s < Math.round(seconds * sr); s++) {
    let y = 0
    if (!rigid) for (let i = 0; i < n; i++) y += solo.modes[i].shape * y1[i]
    const c = x - y
    let F = 0
    if (c > 0) {
      F = k * Math.pow(c, solo.p)
      if (started < 0) started = s
    } else if (started >= 0) {
      return (s - started) / sr
    }
    vel -= (F / solo.mass) * dt
    x += vel * dt
    for (let i = 0; i < n; i++) {
      const md = solo.modes[i]
      const o = a1[i] * y1[i] + a2[i] * y2[i] + ((F * md.shape) / md.mmass) * dt * dt
      y2[i] = y1[i]
      y1[i] = o
    }
  }
  return NaN
}

/**
 * Coefficient of restitution of one free bounce: what fraction of its closing
 * speed the stick gets back. Everything the bar keeps is sound.
 */
export function restitution(cfg: Config, v: number): number {
  const sr = cfg.sr
  const n = cfg.modes.length
  const dt = 1 / sr
  const k = stiffness(cfg.stiffN, cfg.p)
  const a1 = new Float64Array(n)
  const a2 = new Float64Array(n)
  const y1 = new Float64Array(n)
  const y2 = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const md = cfg.modes[i]
    const w = (2 * Math.PI * Math.min(md.f, sr * 0.45)) / sr
    const r = Math.pow(10, -3 / (Math.max(0.0004, md.t60) * sr))
    a1[i] = 2 * r * Math.cos(w)
    a2[i] = -r * r
  }
  let x = -1e-6
  let vel = v
  let started = false
  for (let s = 0; s < Math.round(0.06 * sr); s++) {
    let y = 0
    for (let i = 0; i < n; i++) y += cfg.modes[i].shape * y1[i]
    const c = x - y
    let F = 0
    if (c > 0) {
      F = k * Math.pow(c, cfg.p)
      started = true
    } else if (started) {
      return -vel / v
    }
    vel -= (F / cfg.mass) * dt
    x += vel * dt
    for (let i = 0; i < n; i++) {
      const md = cfg.modes[i]
      const o = a1[i] * y1[i] + a2[i] * y2[i] + ((F * md.shape) / md.mmass) * dt * dt
      y2[i] = y1[i]
      y1[i] = o
    }
  }
  return NaN
}

/**
 * When the bounces ran out.
 *
 * A stick dropped on a bar does what a ball dropped on a table does: the gaps
 * shrink geometrically by the restitution and the whole infinite sequence
 * finishes in finite time — inelastic collapse. That is a buzz roll, and it is
 * why a buzz *accelerates*.
 *
 * `at` is where the worklet would declare it: `hold` seconds after the final
 * contact began, because in real time you cannot know a contact is the last one
 * until it has lasted a while. The two must use the same rule or they cannot be
 * compared.
 */
export function collapse(t: Trace, hold = 0.04): { at: number; bounces: number; lastGap: number } | null {
  const c = t.contacts
  if (c.length < 3) return null
  const last = c[c.length - 1]
  if (last.end < t.seconds - 2 / 48000) return null
  if (last.end - last.start < hold) return null
  return {
    at: last.start + hold,
    bounces: c.length - 1,
    lastGap: last.start - c[c.length - 2].end,
  }
}

/**
 * The lowest hand rate at which contact stops breaking, by bisection on a
 * monotone-enough predicate. Returns NaN if it never merges in range.
 */
export function mergeRate(cfg: Config, lo: number, hi: number, seconds = 0.5): number {
  if (run({ ...cfg, rate: hi }, seconds).merged === false) return NaN
  if (run({ ...cfg, rate: lo }, seconds).merged === true) return lo
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2
    if (run({ ...cfg, rate: mid }, seconds).merged) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}

/** Roots of cos(x)·cosh(x) = 1 — the free-free beam eigenvalues. */
export function beamRoots(count: number): number[] {
  // cosh overflows fast, so work with f(x) = cos(x) − 1/cosh(x), same roots.
  const f = (x: number) => Math.cos(x) - 1 / Math.cosh(x)
  const out: number[] = []
  let x = 3.0
  const step = 0.05
  let prev = f(x)
  while (out.length < count && x < 200) {
    x += step
    const cur = f(x)
    if (prev === 0 || (prev < 0) !== (cur < 0)) {
      let a = x - step
      let b = x
      for (let i = 0; i < 80; i++) {
        const mid = (a + b) / 2
        if ((f(a) < 0) !== (f(mid) < 0)) b = mid
        else a = mid
      }
      out.push((a + b) / 2)
    }
    prev = cur
  }
  return out
}

/** A free-free bar's modes at the given fundamental, struck a quarter along. */
export function barModes(f0: number, count: number, decay: number, hit = 0.25): Mode[] {
  const roots = beamRoots(count)
  const out: Mode[] = []
  for (let i = 0; i < count; i++) {
    const ratio = (roots[i] * roots[i]) / (roots[0] * roots[0])
    const f = f0 * ratio
    // shape at the strike point, normalised; higher modes wiggle faster
    const shape = Math.abs(Math.cos(roots[i] * hit) + Math.cosh(roots[i] * hit) > 1e12
      ? Math.cos(roots[i] * hit)
      : Math.cos(roots[i] * hit))
    out.push({
      f,
      t60: Math.max(0.05, decay / (1 + i * 0.55)),
      shape: 0.35 + 0.65 * shape,
      // Kilograms, not a weighting. A bar mode carries tens of grams, and
      // whether a stick loads it depends on that ratio — with the dimensionless
      // 1.0 `mallet` uses, an 8 g stick detunes a bar by 0.4% and the press
      // roll's flattening is invisible.
      mmass: MODAL_MASS * (1 + i * 0.6),
    })
  }
  return out
}
