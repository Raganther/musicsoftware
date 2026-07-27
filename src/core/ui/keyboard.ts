/**
 * A playable keyboard: on-screen piano + QWERTY mapping.
 *
 * Home row layout (starting at the current octave):
 *   a w s e d f t g y h u j k  ->  C C# D D# E F F# G G# A A# B C
 *   z / x                      ->  octave down / up
 */

const WHITE = [0, 2, 4, 5, 7, 9, 11]
const KEY_MAP: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6,
  g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15,
}

export interface KeyboardOptions {
  /** Lowest MIDI note shown. Defaults to C3. */
  low?: number
  /** Number of octaves shown. */
  octaves?: number
  onNoteOn: (midi: number, velocity: number) => void
  onNoteOff: (midi: number) => void
}

export interface KeyboardHandle {
  el: HTMLElement
  /** Light a key from outside (e.g. incoming MIDI or a sequencer). */
  highlight(midi: number, on: boolean): void
  dispose(): void
}

export function keyboard(parent: HTMLElement, opts: KeyboardOptions): KeyboardHandle {
  const low = opts.low ?? 48
  const octaves = opts.octaves ?? 2
  let baseOctave = Math.floor(low / 12)

  const el = document.createElement('div')
  el.className = 'kb'
  parent.appendChild(el)

  const keyEls = new Map<number, HTMLElement>()
  const down = new Set<number>()

  const build = () => {
    el.innerHTML = ''
    keyEls.clear()
    const total = octaves * 12
    const whiteCount = octaves * 7
    for (let i = 0; i < total; i++) {
      const midi = low + i
      const pc = midi % 12
      const isWhite = WHITE.includes(pc)
      const k = document.createElement('div')
      k.className = isWhite ? 'kb-key kb-white' : 'kb-key kb-black'
      k.dataset.midi = String(midi)

      if (isWhite) {
        const idx = whiteIndexOf(low, midi)
        k.style.left = `${(idx / whiteCount) * 100}%`
        k.style.width = `${(1 / whiteCount) * 100}%`
      } else {
        const idx = whiteIndexOf(low, midi - 1)
        k.style.left = `${((idx + 0.68) / whiteCount) * 100}%`
        k.style.width = `${(0.64 / whiteCount) * 100}%`
      }
      el.appendChild(k)
      keyEls.set(midi, k)
    }
  }
  build()

  const press = (midi: number, vel = 0.85) => {
    if (down.has(midi)) return
    down.add(midi)
    keyEls.get(midi)?.classList.add('is-down')
    opts.onNoteOn(midi, vel)
  }

  const release = (midi: number) => {
    if (!down.has(midi)) return
    down.delete(midi)
    keyEls.get(midi)?.classList.remove('is-down')
    opts.onNoteOff(midi)
  }

  // -- pointer ------------------------------------------------------------
  const midiFromEvent = (e: PointerEvent): number | null => {
    const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    const raw = target?.dataset?.midi
    return raw ? Number(raw) : null
  }

  let pointerDown = false
  let lastPointerMidi: number | null = null

  const onPointerDown = (e: PointerEvent) => {
    const m = midiFromEvent(e)
    if (m === null) return
    pointerDown = true
    lastPointerMidi = m
    el.setPointerCapture(e.pointerId)
    // Vertical position gives velocity — closer to the bottom is louder.
    const rect = el.getBoundingClientRect()
    press(m, 0.4 + 0.6 * ((e.clientY - rect.top) / rect.height))
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!pointerDown) return
    const m = midiFromEvent(e)
    if (m === lastPointerMidi) return
    if (lastPointerMidi !== null) release(lastPointerMidi)
    lastPointerMidi = m
    if (m !== null) press(m)
  }

  const onPointerUp = () => {
    pointerDown = false
    if (lastPointerMidi !== null) release(lastPointerMidi)
    lastPointerMidi = null
  }

  el.addEventListener('pointerdown', onPointerDown)
  el.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)

  // -- computer keyboard ---------------------------------------------------
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.ctrlKey) return
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

    if (e.key === 'z') {
      baseOctave = Math.max(0, baseOctave - 1)
      return
    }
    if (e.key === 'x') {
      baseOctave = Math.min(8, baseOctave + 1)
      return
    }
    const offset = KEY_MAP[e.key]
    if (offset === undefined) return
    e.preventDefault()
    press(baseOctave * 12 + offset)
  }

  const onKeyUp = (e: KeyboardEvent) => {
    const offset = KEY_MAP[e.key]
    if (offset === undefined) return
    release(baseOctave * 12 + offset)
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  return {
    el,
    highlight(midi, on) {
      keyEls.get(midi)?.classList.toggle('is-lit', on)
    },
    dispose() {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      down.forEach((m) => opts.onNoteOff(m))
      el.remove()
    },
  }
}

function whiteIndexOf(low: number, midi: number): number {
  let count = 0
  for (let m = low; m < midi; m++) {
    if (WHITE.includes(m % 12)) count++
  }
  return count
}
