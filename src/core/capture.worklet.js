/**
 * Master-bus capture tap for recording. Copies its input to the main thread
 * in 128-sample blocks while armed; record.ts assembles them into a WAV.
 *
 * Plain JS, audio thread. The per-block Float32Array copies are the one
 * exception to the no-allocation rule — postMessage needs transferable
 * buffers, recording is temporary, and 2×128 floats per block is mild.
 */

class CaptureTapProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.armed = false
    this.port.onmessage = (e) => {
      if (e.data === 'start') this.armed = true
      if (e.data === 'stop') this.armed = false
    }
  }

  process(inputs) {
    const input = inputs[0]
    if (this.armed && input && input.length) {
      const l = new Float32Array(input[0])
      const r = new Float32Array(input[1] ?? input[0])
      this.port.postMessage({ l, r }, [l.buffer, r.buffer])
    }
    return true
  }
}

registerProcessor('capture-tap', CaptureTapProcessor)
