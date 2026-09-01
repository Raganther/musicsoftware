/**
 * The single shared AudioContext, plus a master chain every sketch runs through.
 *
 * Chain: [sketch out] -> masterGain -> limiter -> destination
 *
 * The limiter is deliberate: when you're prototyping DSP you *will* write a
 * feedback loop that explodes. It should be embarrassing, not painful.
 */
import { rng } from './random'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let limiter: DynamicsCompressorNode | null = null
let analyser: AnalyserNode | null = null

export interface AudioGraph {
  ctx: AudioContext
  master: GainNode
  analyser: AnalyserNode
}

/** Create (or return) the AudioContext. Must be called from a user gesture the first time. */
export function audio(): AudioGraph {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' })

    master = ctx.createGain()
    master.gain.value = 0.8

    // Safety net only — it should never engage on a well-behaved sketch. The
    // attack has to be sub-millisecond or note onsets sail straight past it.
    limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -2
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.001
    limiter.release.value = 0.12

    analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.8

    master.connect(limiter)
    limiter.connect(analyser)
    analyser.connect(ctx.destination)
  }
  return { ctx, master: master!, analyser: analyser! }
}

/** True once the context exists and is running. */
export function isRunning(): boolean {
  return ctx?.state === 'running'
}

/** Browsers suspend audio until a gesture. Call this from a click/keydown handler. */
export async function unlock(): Promise<AudioContext> {
  const { ctx } = audio()
  if (ctx.state !== 'running') await ctx.resume()
  return ctx
}

export function setMasterVolume(v: number) {
  const { ctx, master } = audio()
  master.gain.setTargetAtTime(v, ctx.currentTime, 0.01)
}

export function getMasterVolume(): number {
  return master?.gain.value ?? 0.8
}

/** Current output level, 0..1, for meters. */
export function peakLevel(): number {
  if (!analyser) return 0
  const buf = new Float32Array(analyser.fftSize)
  analyser.getFloatTimeDomainData(buf)
  let peak = 0
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i])
    if (a > peak) peak = a
  }
  return Math.min(1, peak)
}

/**
 * Register an AudioWorklet module, once per URL.
 *
 * Re-registering a processor name from a different module throws, and a sketch
 * can be mounted many times per page load, so the promise is cached.
 *
 *   import url from './my.worklet.js?url'
 *   await loadWorklet(url)
 *   const node = new AudioWorkletNode(ctx, 'my-processor')
 *
 * Worklet files must be named `*.worklet.js` (plain JS, no imports) so the
 * build keeps them as real files rather than inlining them as data URIs.
 */
const workletModules = new Map<string, Promise<void>>()
export function loadWorklet(url: string): Promise<void> {
  const { ctx } = audio()
  let pending = workletModules.get(url)
  if (!pending) {
    pending = ctx.audioWorklet.addModule(url).catch((err) => {
      workletModules.delete(url) // let a later mount retry
      throw err
    })
    workletModules.set(url, pending)
  }
  return pending
}

// ---------------------------------------------------------------------------
// Small graph helpers used all over the place
// ---------------------------------------------------------------------------

/**
 * A cached buffer of white noise — regenerating this per-hit is a waste.
 *
 * **Seeded, not `Math.random()`.** Every reverb in the repo builds its impulse
 * response from this, so an unseeded buffer meant a different room on every
 * page load. That is invisible until something has to measure through one, and
 * then it is very hard to see: it moved `inertia`'s fundamental-to-octave ratio
 * between 1.9 and 8.2 across runs whose worklet state was bit-identical, and it
 * destabilised `pivot`'s chroma enough to change which keys its key-finder
 * could tell apart. A fixed seed costs nothing and makes every sketch that uses
 * noise reproducible between loads.
 */
let noiseBuf: AudioBuffer | null = null
export function noiseBuffer(seconds = 2): AudioBuffer {
  const { ctx } = audio()
  if (noiseBuf && noiseBuf.duration >= seconds) return noiseBuf
  const len = Math.ceil(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  const r = rng(20260901)
  for (let i = 0; i < len; i++) d[i] = r.next() * 2 - 1
  noiseBuf = buf
  return buf
}

export function noiseSource(): AudioBufferSourceNode {
  const { ctx } = audio()
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer()
  src.loop = true
  return src
}

/** Exponential ramp that tolerates zero (which the Web Audio API does not). */
export function rampTo(p: AudioParam, value: number, time: number) {
  p.exponentialRampToValueAtTime(Math.max(1e-5, value), time)
}

/** Standard percussive envelope: silence -> peak -> exponential decay. */
export function envelope(
  p: AudioParam,
  time: number,
  { peak = 1, attack = 0.002, decay = 0.2, sustain = 0, hold = 0 } = {},
) {
  p.cancelScheduledValues(time)
  p.setValueAtTime(1e-4, time)
  p.exponentialRampToValueAtTime(Math.max(1e-4, peak), time + attack)
  if (hold > 0) p.setValueAtTime(Math.max(1e-4, peak), time + attack + hold)
  p.exponentialRampToValueAtTime(Math.max(1e-4, sustain || 1e-4), time + attack + hold + decay)
}

/** Free a node graph after it has finished sounding. */
export function disposeAt(node: AudioScheduledSourceNode, time: number, extra?: AudioNode[]) {
  node.stop(time)
  node.onended = () => {
    node.disconnect()
    extra?.forEach((n) => n.disconnect())
  }
}
