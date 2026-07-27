/**
 * Param state + the control panel that edits it.
 *
 * Values persist per sketch in localStorage, so the settings you liked are
 * still there after a reload. `Reset` puts the declared defaults back.
 */

import type { ParamMap, ParamSpec } from './sketch'

type Listener = (value: never) => void

export class ParamStore {
  readonly specs: ParamMap
  private values: Record<string, unknown> = {}
  private listeners = new Map<string, Set<Listener>>()
  private presses = new Map<string, Set<() => void>>()
  private storageKey: string

  constructor(sketchId: string, specs: ParamMap = {}) {
    this.specs = specs
    this.storageKey = `musiclab:params:${sketchId}`
    for (const [key, spec] of Object.entries(specs)) {
      if (spec.type !== 'button') this.values[key] = spec.value
    }
    this.load()
  }

  get(key: string): unknown {
    return this.values[key]
  }

  set(key: string, value: unknown, { silent = false } = {}) {
    const spec = this.specs[key]
    if (!spec || spec.type === 'button') return
    this.values[key] = value
    this.save()
    if (!silent) this.listeners.get(key)?.forEach((fn) => (fn as (v: unknown) => void)(value))
  }

  press(key: string) {
    this.presses.get(key)?.forEach((fn) => fn())
  }

  onChange(key: string, fn: Listener): () => void {
    const set = this.listeners.get(key) ?? new Set()
    set.add(fn)
    this.listeners.set(key, set)
    return () => set.delete(fn)
  }

  onPress(key: string, fn: () => void): () => void {
    const set = this.presses.get(key) ?? new Set()
    set.add(fn)
    this.presses.set(key, set)
    return () => set.delete(fn)
  }

  /** A live-reading view handed to the sketch as `ctx.params`. */
  view<T extends object>(): T {
    return new Proxy({} as T, {
      get: (_, key: string) => this.values[key],
      set: (_, key: string, value) => {
        this.set(key, value)
        return true
      },
      has: (_, key: string) => key in this.values,
      ownKeys: () => Object.keys(this.values),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    })
  }

  reset() {
    for (const [key, spec] of Object.entries(this.specs)) {
      if (spec.type !== 'button') this.set(key, spec.value)
    }
  }

  private save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.values))
    } catch {
      /* private mode, quota — not worth failing a sketch over */
    }
  }

  private load() {
    try {
      const raw = localStorage.getItem(this.storageKey)
      if (!raw) return
      const saved = JSON.parse(raw) as Record<string, unknown>
      for (const [key, value] of Object.entries(saved)) {
        const spec = this.specs[key]
        if (!spec || spec.type === 'button') continue
        // Ignore stored values that no longer fit the spec.
        if (spec.type === 'number' && typeof value !== 'number') continue
        if (spec.type === 'toggle' && typeof value !== 'boolean') continue
        if (spec.type === 'select' && !spec.options.includes(value as string)) continue
        this.values[key] = value
      }
    } catch {
      /* corrupt entry — defaults are fine */
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderPanel(host: HTMLElement, store: ParamStore): () => void {
  host.innerHTML = ''
  const disposers: Array<() => void> = []
  const entries = Object.entries(store.specs)

  if (!entries.length) {
    const empty = document.createElement('p')
    empty.className = 'panel-empty'
    empty.textContent = 'No parameters.'
    host.appendChild(empty)
    return () => {}
  }

  for (const [key, spec] of entries) {
    host.appendChild(renderControl(key, spec, store, disposers))
  }

  const reset = document.createElement('button')
  reset.className = 'btn btn-ghost panel-reset'
  reset.textContent = 'Reset parameters'
  reset.onclick = () => store.reset()
  host.appendChild(reset)

  return () => disposers.forEach((d) => d())
}

function renderControl(
  key: string,
  spec: ParamSpec,
  store: ParamStore,
  disposers: Array<() => void>,
): HTMLElement {
  const row = document.createElement('div')
  row.className = 'ctrl'
  const label = spec.label ?? humanise(key)

  if (spec.type === 'button') {
    const btn = document.createElement('button')
    btn.className = 'btn ctrl-button'
    btn.textContent = label
    btn.onclick = () => store.press(key)
    row.appendChild(btn)
    return row
  }

  const head = document.createElement('div')
  head.className = 'ctrl-head'
  const name = document.createElement('label')
  name.className = 'ctrl-label'
  name.textContent = label
  head.appendChild(name)

  const readout = document.createElement('span')
  readout.className = 'ctrl-value'
  head.appendChild(readout)
  row.appendChild(head)

  if (spec.type === 'number') {
    const min = spec.min ?? 0
    const max = spec.max ?? 1
    const step = spec.step ?? guessStep(min, max)
    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(store.get(key))

    const show = (v: number) => {
      readout.textContent = `${formatNumber(v, step)}${spec.unit ? ` ${spec.unit}` : ''}`
    }
    show(store.get(key) as number)

    input.oninput = () => store.set(key, Number(input.value))
    disposers.push(
      store.onChange(key, ((v: number) => {
        input.value = String(v)
        show(v)
      }) as never),
    )
    // Double-click a slider to type an exact value — handy for tuning by ear.
    input.ondblclick = () => {
      const entered = prompt(`${label}:`, String(store.get(key)))
      if (entered === null) return
      const n = Number(entered)
      if (Number.isFinite(n)) store.set(key, Math.min(max, Math.max(min, n)))
    }
    row.appendChild(input)
  } else if (spec.type === 'toggle') {
    readout.textContent = ''
    const wrap = document.createElement('button')
    wrap.className = 'switch'
    const paint = (v: boolean) => {
      wrap.classList.toggle('is-on', v)
      wrap.textContent = v ? 'on' : 'off'
      wrap.setAttribute('aria-pressed', String(v))
    }
    paint(store.get(key) as boolean)
    wrap.onclick = () => store.set(key, !store.get(key))
    disposers.push(store.onChange(key, ((v: boolean) => paint(v)) as never))
    row.appendChild(wrap)
  } else {
    readout.textContent = ''
    const select = document.createElement('select')
    select.className = 'select'
    for (const opt of spec.options) {
      const o = document.createElement('option')
      o.value = opt
      o.textContent = opt
      select.appendChild(o)
    }
    select.value = String(store.get(key))
    select.onchange = () => store.set(key, select.value)
    disposers.push(store.onChange(key, ((v: string) => (select.value = v)) as never))
    row.appendChild(select)
  }

  return row
}

function humanise(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}

function guessStep(min: number, max: number): number {
  const span = Math.abs(max - min)
  if (span > 200) return 1
  if (span > 20) return 0.5
  if (span > 2) return 0.01
  return 0.001
}

function formatNumber(v: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3
  return v.toFixed(decimals)
}
