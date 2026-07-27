/**
 * Web MIDI, wrapped so sketches don't each re-do permission handling.
 * Degrades quietly: if the browser has no Web MIDI (Safari, non-HTTPS), every
 * subscribe still works, it just never fires.
 */

export interface MidiNoteEvent {
  midi: number
  /** 0..1 */
  velocity: number
  channel: number
  port: string
}

export interface MidiCCEvent {
  cc: number
  /** 0..1 */
  value: number
  raw: number
  channel: number
  port: string
}

type Unsub = () => void

// Minimal structural types — avoids depending on a particular lib.dom version.
interface MidiPortLike {
  id: string
  name: string | null
  type: string
  onmidimessage: ((e: { data: Uint8Array }) => void) | null
  send?: (data: number[], at?: number) => void
}
interface MidiAccessLike {
  inputs: Map<string, MidiPortLike>
  outputs: Map<string, MidiPortLike>
  onstatechange: ((e: unknown) => void) | null
}

class MidiHub {
  private access: MidiAccessLike | null = null
  private noteOnHandlers = new Set<(e: MidiNoteEvent) => void>()
  private noteOffHandlers = new Set<(e: MidiNoteEvent) => void>()
  private ccHandlers = new Set<(e: MidiCCEvent) => void>()
  private changeHandlers = new Set<() => void>()

  supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator
  enabled = false
  error: string | null = null

  /** Ask for MIDI access. Safe to call repeatedly. */
  async enable(): Promise<boolean> {
    if (this.enabled) return true
    if (!this.supported) {
      this.error = 'Web MIDI is not available in this browser'
      return false
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.access = (await (navigator as any).requestMIDIAccess({ sysex: false })) as MidiAccessLike
      this.enabled = true
      this.error = null
      this.bindInputs()
      this.access.onstatechange = () => {
        this.bindInputs()
        this.changeHandlers.forEach((f) => f())
      }
      this.changeHandlers.forEach((f) => f())
      return true
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  private bindInputs() {
    if (!this.access) return
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (e) => this.handle(e.data, input.name ?? input.id)
    }
  }

  private handle(data: Uint8Array, port: string) {
    const status = data[0] & 0xf0
    const channel = data[0] & 0x0f

    if (status === 0x90 && data[2] > 0) {
      const e: MidiNoteEvent = { midi: data[1], velocity: data[2] / 127, channel, port }
      this.noteOnHandlers.forEach((f) => f(e))
    } else if (status === 0x80 || (status === 0x90 && data[2] === 0)) {
      const e: MidiNoteEvent = { midi: data[1], velocity: 0, channel, port }
      this.noteOffHandlers.forEach((f) => f(e))
    } else if (status === 0xb0) {
      const e: MidiCCEvent = { cc: data[1], value: data[2] / 127, raw: data[2], channel, port }
      this.ccHandlers.forEach((f) => f(e))
    }
  }

  onNoteOn(fn: (e: MidiNoteEvent) => void): Unsub {
    this.noteOnHandlers.add(fn)
    return () => this.noteOnHandlers.delete(fn)
  }

  onNoteOff(fn: (e: MidiNoteEvent) => void): Unsub {
    this.noteOffHandlers.add(fn)
    return () => this.noteOffHandlers.delete(fn)
  }

  onCC(fn: (e: MidiCCEvent) => void): Unsub {
    this.ccHandlers.add(fn)
    return () => this.ccHandlers.delete(fn)
  }

  onPortsChanged(fn: () => void): Unsub {
    this.changeHandlers.add(fn)
    return () => this.changeHandlers.delete(fn)
  }

  get inputNames(): string[] {
    if (!this.access) return []
    return [...this.access.inputs.values()].map((p) => p.name ?? p.id)
  }

  get outputNames(): string[] {
    if (!this.access) return []
    return [...this.access.outputs.values()].map((p) => p.name ?? p.id)
  }

  /** Send a note to every connected output (or one matching `portName`). */
  sendNote(midi: number, velocity = 100, durationMs = 200, channel = 0, portName?: string) {
    if (!this.access) return
    for (const out of this.access.outputs.values()) {
      if (portName && (out.name ?? out.id) !== portName) continue
      out.send?.([0x90 | channel, midi, velocity])
      out.send?.([0x80 | channel, midi, 0], performance.now() + durationMs)
    }
  }

  sendCC(cc: number, value: number, channel = 0, portName?: string) {
    if (!this.access) return
    const raw = Math.round(Math.max(0, Math.min(1, value)) * 127)
    for (const out of this.access.outputs.values()) {
      if (portName && (out.name ?? out.id) !== portName) continue
      out.send?.([0xb0 | channel, cc, raw])
    }
  }
}

export const midi = new MidiHub()
