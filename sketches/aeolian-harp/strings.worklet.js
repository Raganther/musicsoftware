/**
 * A bank of Karplus-Strong strings — one processor runs the whole harp.
 *
 * This cannot be built from native nodes: a DelayNode inside a feedback cycle
 * is clamped to one render quantum (128 samples), which caps the fundamental
 * of a delay-line string at ~344 Hz. Per-sample feedback needs a worklet.
 *
 * Sympathy note: the first version coupled strings by mixing each with the
 * bank mean inside the loop. Provably stable (spectral radius fb < 1) — and
 * provably wrong: a single pluck is almost all difference-modes, which decay
 * at fb·(1−s), so default sympathy killed a string in ~150 ms. Broadband
 * mean-coupling is damping, not sympathy. Real sympathetic strings exchange
 * energy through SHARED PARTIALS, so v2 spills a quiet copy of each pluck
 * into strings whose frequencies are near-integer ratios (p:q, p,q ≤ 5).
 * Feed-forward, hence unconditionally stable, and frequency-selective.
 *
 * Plain JS, audio thread. No allocation and no logging inside process().
 */

class StringBankProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    /** Longest supported string, ~45 Hz. */
    this.cap = Math.ceil(sampleRate / 45)
    this.strings = []
    /** couplings[i] = [{ j, w }] — strings sharing a partial with i. */
    this.couplings = []
    this.fb = 0.99 // loop feedback (decay)
    this.tone = 0.7 // in-loop one-pole lowpass coefficient (brightness)
    this.symp = 0.35 // 0..1 — how loudly plucks spill into related strings
    // DC blocker state — noise bursts carry offset and high feedback keeps it.
    this.hx = 0
    this.hy = 0
    this.port.onmessage = (e) => this.handle(e.data)
  }

  handle(m) {
    if (m.fb !== undefined) this.fb = m.fb
    if (m.symp !== undefined) this.symp = m.symp
    const toneChanged = m.tone !== undefined && m.tone !== this.tone
    if (m.tone !== undefined) this.tone = m.tone

    if (m.type === 'config') {
      this.strings = m.freqs.map((f, i) => {
        const s = this.strings[i] ?? { buf: new Float32Array(this.cap), w: 0, lp: 0, len: 100, freq: f }
        s.freq = f
        return s
      })
      this.retune()
      this.rebuildCouplings()
    } else if (toneChanged) {
      this.retune()
    }

    if (m.type === 'pluck') this.pluck(m.i, m.vel, m.bright)
  }

  retune() {
    // The in-loop lowpass delays the recirculating wave by roughly (1-c)/c
    // samples, so the line is shortened to compensate. Without this every
    // string plays flat, and the darker the tone the flatter it gets.
    const comp = (1 - this.tone) / Math.max(0.05, this.tone)
    for (const s of this.strings) {
      s.len = Math.min(this.cap - 4, Math.max(2, sampleRate / s.freq - comp))
    }
  }

  rebuildCouplings() {
    const N = this.strings.length
    this.couplings = []
    for (let i = 0; i < N; i++) this.couplings.push([])
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const fi = this.strings[i].freq
        const fj = this.strings[j].freq
        // Two strings are sympathetic if p·fi ≈ q·fj for small integers —
        // i.e. they share a partial. Weight by 1/(p·q): higher partials
        // carry less energy.
        let w = 0
        for (let p = 1; p <= 5; p++) {
          for (let q = 1; q <= 5; q++) {
            if (Math.abs((p * fi) / (q * fj) - 1) < 0.015) w = Math.max(w, 1 / (p * q))
          }
        }
        if (w > 0) {
          this.couplings[i].push({ j, w })
          this.couplings[j].push({ j: i, w })
        }
      }
    }
  }

  /** Add a lowpassed noise burst into the active window of string s. */
  inject(s, vel, bright) {
    const L = Math.min(this.cap - 4, Math.round(s.len))
    const c = 0.12 + 0.88 * bright
    let start = s.w - L
    if (start < 0) start += this.cap
    let lp = 0
    for (let k = 0; k < L; k++) {
      lp += c * (Math.random() * 2 - 1 - lp)
      const idx = start + k >= this.cap ? start + k - this.cap : start + k
      s.buf[idx] += lp * vel
    }
  }

  pluck(i, vel, bright) {
    const s = this.strings[i]
    if (!s) return
    this.inject(s, vel, bright)
    // Sympathetic spill: a whisper of the pluck, darker, into strings that
    // share a partial. Feed-forward only — spills never spill further.
    const spill = this.symp * 0.7 * vel
    if (spill > 0.001) {
      for (const { j, w } of this.couplings[i]) {
        this.inject(this.strings[j], spill * w, bright * 0.6)
      }
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0][0]
    if (!out) return true
    const N = this.strings.length
    if (!N) {
      out.fill(0)
      return true
    }
    const norm = 1 / Math.sqrt(N)

    for (let n = 0; n < out.length; n++) {
      let sum = 0
      for (let i = 0; i < N; i++) {
        const s = this.strings[i]
        let rp = s.w - s.len
        if (rp < 0) rp += this.cap
        const i0 = rp | 0
        let i1 = i0 + 1
        if (i1 >= this.cap) i1 = 0
        const frac = rp - i0
        const raw = s.buf[i0] * (1 - frac) + s.buf[i1] * frac

        s.lp += this.tone * (raw - s.lp)
        s.buf[s.w] = this.fb * s.lp
        s.w = s.w + 1 === this.cap ? 0 : s.w + 1
        sum += s.lp
      }

      // tanh is the harp's "body": it bounds the output to (-1, 1) by
      // construction, so stacked strums can never clip downstream no matter
      // how hard the bank is driven — and a hard strum saturates musically
      // instead of spiking. Gain of 2 puts a full strum around 0.6-0.85.
      const x = Math.tanh(sum * norm * 2)
      const hp = x - this.hx + 0.995 * this.hy
      this.hx = x
      this.hy = hp
      out[n] = hp
    }
    return true
  }
}

registerProcessor('string-bank', StringBankProcessor)
