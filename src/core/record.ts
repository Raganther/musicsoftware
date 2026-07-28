/**
 * Record the master output — exactly what you hear, tapped after the limiter —
 * to a 16-bit stereo WAV. Works in solo and jam mode alike.
 *
 *   await startRecording()
 *   …perform…
 *   const blob = await stopRecording()   // audio/wav
 */

import { audio, loadWorklet } from './audio'
import captureUrl from './capture.worklet.js?url'

/** Recording hard cap. A jam longer than this should be two takes. */
const MAX_SECONDS = 360

let node: AudioWorkletNode | null = null
let chunksL: Float32Array[] = []
let chunksR: Float32Array[] = []
let samples = 0
let recording = false

async function ensureTap(): Promise<AudioWorkletNode> {
  if (node) return node
  const { ctx, analyser } = audio()
  await loadWorklet(captureUrl)
  node = new AudioWorkletNode(ctx, 'capture-tap', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  })
  // The analyser sits post-limiter, so this records what the ears got.
  analyser.connect(node)
  // A silent path to the destination keeps the node pulled by the graph.
  const pull = ctx.createGain()
  pull.gain.value = 0
  node.connect(pull).connect(ctx.destination)

  node.port.onmessage = (e: MessageEvent<{ l: Float32Array; r: Float32Array }>) => {
    if (!recording) return
    if (samples / ctx.sampleRate >= MAX_SECONDS) return
    chunksL.push(e.data.l)
    chunksR.push(e.data.r)
    samples += e.data.l.length
  }
  return node
}

export function isRecording(): boolean {
  return recording
}

export function recordingSeconds(): number {
  return samples / audio().ctx.sampleRate
}

export async function startRecording(): Promise<void> {
  const tap = await ensureTap()
  chunksL = []
  chunksR = []
  samples = 0
  recording = true
  tap.port.postMessage('start')
}

export async function stopRecording(): Promise<Blob | null> {
  if (!recording) return null
  recording = false
  node?.port.postMessage('stop')
  if (!samples) return null
  const blob = encodeWav(chunksL, chunksR, samples, audio().ctx.sampleRate)
  chunksL = []
  chunksR = []
  return blob
}

function encodeWav(l: Float32Array[], r: Float32Array[], length: number, sampleRate: number): Blob {
  const bytesPerFrame = 4 // stereo 16-bit
  const buf = new ArrayBuffer(44 + length * bytesPerFrame)
  const v = new DataView(buf)

  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + length * bytesPerFrame, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 2, true) // stereo
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * bytesPerFrame, true)
  v.setUint16(32, bytesPerFrame, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, length * bytesPerFrame, true)

  let off = 44
  const write = (x: number) => {
    const s = Math.max(-1, Math.min(1, x))
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    off += 2
  }
  for (let c = 0; c < l.length; c++) {
    const cl = l[c]
    const cr = r[c]
    for (let i = 0; i < cl.length; i++) {
      write(cl[i])
      write(cr[i])
    }
  }
  return new Blob([buf], { type: 'audio/wav' })
}
