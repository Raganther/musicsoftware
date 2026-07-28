/**
 * Jam mode: several sketches mounted at once, every one on the single global
 * transport — which is why they lock together for free.
 *
 * Each channel gets a strip: the sketch's own stage, a level fader, a
 * bipolar DJ filter (left = lowpass closes, right = highpass rises), mute,
 * solo, a meter, and the sketch's parameter panel behind a disclosure.
 *
 * Scenes snapshot the whole rig — every channel's params, level, filter and
 * mute plus bpm and swing — and recall it live. That's the jam element:
 * building a change on a muted channel and bringing it in on a beat.
 */

import { audio } from '@core/audio'
import { clock } from '@core/clock'
import { mountSketch, type MountedSketch } from './host'
import { findSketch, type SketchEntry } from './registry'

const RACK_KEY = 'musiclab:jam:rack'
const SCENES_KEY = 'musiclab:jam:scenes'

interface ChannelPreset {
  level?: number
  filter?: number
  muted?: boolean
}

interface SceneChannel {
  id: string
  level: number
  filter: number
  muted: boolean
  params: Record<string, unknown>
}

interface Scene {
  bpm: number
  swing: number
  channels: SceneChannel[]
}

interface Channel {
  entry: SketchEntry
  strip: HTMLElement
  statusEl: HTMLElement
  meterEl: HTMLCanvasElement
  meterG: CanvasRenderingContext2D
  levelInput: HTMLInputElement
  filterInput: HTMLInputElement
  muteBtn: HTMLButtonElement
  soloBtn: HTMLButtonElement
  mounted: MountedSketch
  filter: BiquadFilterNode
  gain: GainNode
  analyser: AnalyserNode
  meterBuf: Float32Array<ArrayBuffer>
  level: number
  filterVal: number
  muted: boolean
  soloed: boolean
}

export class JamRack {
  private list: HTMLElement
  private hint: HTMLElement
  private channels: Channel[] = []
  private scenes: (Scene | null)[] = [null, null, null, null]
  private raf = 0
  private disposed = false
  /** Fired on add/remove so the shell can update its badge. */
  onChange: (() => void) | null = null

  constructor(root: HTMLElement) {
    root.innerHTML = ''
    root.className = 'rack'
    this.list = document.createElement('div')
    this.list.className = 'rack-list'
    this.hint = document.createElement('p')
    this.hint.className = 'rack-hint'
    this.hint.textContent = 'Click sketches in the sidebar to add them to the jam.'
    root.append(this.list, this.hint)

    try {
      const raw = localStorage.getItem(SCENES_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as (Scene | null)[]
        if (Array.isArray(parsed)) this.scenes = [0, 1, 2, 3].map((i) => parsed[i] ?? null)
      }
    } catch {
      /* fresh scenes are fine */
    }

    this.raf = requestAnimationFrame(this.paintMeters)
  }

  get size(): number {
    return this.channels.length
  }

  has(id: string): boolean {
    return this.channels.some((c) => c.entry.id === id)
  }

  /** Re-add whatever the last jam session had in the rack. */
  restore() {
    try {
      const raw = localStorage.getItem(RACK_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as Array<{ id: string } & ChannelPreset>
      for (const c of saved) this.add(c.id, c)
    } catch {
      /* empty rack is fine */
    }
  }

  add(id: string, preset: ChannelPreset = {}) {
    if (this.disposed) return
    const entry = findSketch(id)
    if (!entry) return
    if (this.has(id)) {
      const existing = this.channels.find((c) => c.entry.id === id)!
      existing.strip.classList.remove('strip-flash')
      void existing.strip.offsetWidth // restart the animation
      existing.strip.classList.add('strip-flash')
      return
    }

    const { ctx, master } = audio()

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 20000
    filter.Q.value = 0.8
    const gain = ctx.createGain()
    gain.gain.value = preset.level ?? 0.9
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    filter.connect(gain).connect(master)
    gain.connect(analyser)

    const strip = document.createElement('section')
    strip.className = 'strip'
    strip.innerHTML = `
      <div class="strip-head">
        <span class="strip-title"></span>
        <canvas class="strip-meter" width="60" height="8"></canvas>
        <div class="strip-tools">
          <label>vol</label><input class="s-level" type="range" min="0" max="1.2" step="0.01" />
          <label>filter</label><input class="s-filter" type="range" min="-1" max="1" step="0.01" />
          <button class="chipbtn s-mute" title="mute">M</button>
          <button class="chipbtn s-solo" title="solo">S</button>
          <button class="chipbtn s-params" title="parameters">···</button>
          <button class="chipbtn s-remove" title="remove from jam">✕</button>
        </div>
      </div>
      <div class="strip-stage"></div>
      <div class="strip-panel" hidden></div>
      <div class="strip-status"></div>`
    strip.querySelector('.strip-title')!.textContent = entry.def.title
    this.list.appendChild(strip)

    const q = <T extends HTMLElement>(sel: string) => strip.querySelector<T>(sel)!
    const stage = q<HTMLElement>('.strip-stage')
    const panel = q<HTMLElement>('.strip-panel')
    const statusEl = q<HTMLElement>('.strip-status')
    const meterEl = q<HTMLCanvasElement>('.strip-meter')

    const mounted = mountSketch(
      entry,
      { stage, panel, status: (t) => (statusEl.textContent = t) },
      { dest: filter, applyTransport: false },
    )

    const ch: Channel = {
      entry,
      strip,
      statusEl,
      meterEl,
      meterG: meterEl.getContext('2d')!,
      levelInput: q<HTMLInputElement>('.s-level'),
      filterInput: q<HTMLInputElement>('.s-filter'),
      muteBtn: q<HTMLButtonElement>('.s-mute'),
      soloBtn: q<HTMLButtonElement>('.s-solo'),
      mounted,
      filter,
      gain,
      analyser,
      meterBuf: new Float32Array(analyser.fftSize),
      level: preset.level ?? 0.9,
      filterVal: preset.filter ?? 0,
      muted: preset.muted ?? false,
      soloed: false,
    }

    ch.levelInput.value = String(ch.level)
    ch.filterInput.value = String(ch.filterVal)
    this.applyFilter(ch)
    this.syncStripUi(ch)

    ch.levelInput.oninput = () => {
      ch.level = Number(ch.levelInput.value)
      this.applyMix()
    }
    ch.levelInput.onchange = () => this.save()
    ch.filterInput.oninput = () => {
      ch.filterVal = Number(ch.filterInput.value)
      this.applyFilter(ch)
    }
    ch.filterInput.onchange = () => this.save()
    ch.filterInput.ondblclick = () => {
      ch.filterVal = 0
      ch.filterInput.value = '0'
      this.applyFilter(ch)
      this.save()
    }
    ch.muteBtn.onclick = () => {
      ch.muted = !ch.muted
      this.applyMix()
      this.syncStripUi(ch)
      this.save()
    }
    ch.soloBtn.onclick = () => {
      ch.soloed = !ch.soloed
      this.applyMix()
      this.channels.forEach((c) => this.syncStripUi(c))
    }
    q<HTMLButtonElement>('.s-params').onclick = () => {
      panel.hidden = !panel.hidden
    }
    q<HTMLButtonElement>('.s-remove').onclick = () => this.remove(ch)

    this.channels.push(ch)
    this.applyMix()
    this.hint.hidden = true
    this.save()
    this.onChange?.()
  }

  private remove(ch: Channel) {
    const i = this.channels.indexOf(ch)
    if (i < 0) return
    this.channels.splice(i, 1)
    ch.mounted.unmount()
    // The mounted bus fades over ~120 ms; drop the chain after it.
    setTimeout(() => {
      ch.filter.disconnect()
      ch.gain.disconnect()
      ch.analyser.disconnect()
    }, 250)
    ch.strip.remove()
    this.applyMix()
    this.hint.hidden = this.channels.length > 0
    this.save()
    this.onChange?.()
  }

  /** Bipolar DJ filter: centre transparent, left LP sweeps down, right HP up. */
  private applyFilter(ch: Channel) {
    const { ctx } = audio()
    const v = ch.filterVal
    if (v < -0.05) {
      ch.filter.type = 'lowpass'
      ch.filter.frequency.setTargetAtTime(20000 * Math.pow(140 / 20000, -v), ctx.currentTime, 0.03)
    } else if (v > 0.05) {
      ch.filter.type = 'highpass'
      ch.filter.frequency.setTargetAtTime(25 * Math.pow(5000 / 25, v), ctx.currentTime, 0.03)
    } else {
      ch.filter.type = 'lowpass'
      ch.filter.frequency.setTargetAtTime(20000, ctx.currentTime, 0.03)
    }
  }

  private applyMix() {
    const { ctx } = audio()
    const anySolo = this.channels.some((c) => c.soloed)
    for (const c of this.channels) {
      const silenced = c.muted || (anySolo && !c.soloed)
      c.gain.gain.setTargetAtTime(silenced ? 0 : c.level, ctx.currentTime, 0.012)
    }
  }

  private syncStripUi(ch: Channel) {
    ch.muteBtn.classList.toggle('is-on', ch.muted)
    ch.soloBtn.classList.toggle('is-solo', ch.soloed)
    const anySolo = this.channels.some((c) => c.soloed)
    ch.strip.classList.toggle('is-silent', ch.muted || (anySolo && !ch.soloed))
  }

  private paintMeters = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.paintMeters)
    for (const c of this.channels) {
      c.analyser.getFloatTimeDomainData(c.meterBuf)
      let peak = 0
      for (let i = 0; i < c.meterBuf.length; i++) {
        const a = Math.abs(c.meterBuf[i])
        if (a > peak) peak = a
      }
      const g = c.meterG
      const w = c.meterEl.width
      const h = c.meterEl.height
      g.clearRect(0, 0, w, h)
      g.fillStyle = 'rgba(255,255,255,0.07)'
      g.fillRect(0, 0, w, h)
      g.fillStyle = peak > 0.95 ? '#ff5f56' : peak > 0.7 ? '#ffbd2e' : '#4ade80'
      g.fillRect(0, 0, Math.min(1, peak) * w, h)
    }
  }

  // -- scenes --------------------------------------------------------------

  sceneFilled(i: number): boolean {
    return !!this.scenes[i]
  }

  storeScene(i: number) {
    this.scenes[i] = {
      bpm: clock.bpm,
      swing: clock.swing,
      channels: this.channels.map((c) => ({
        id: c.entry.id,
        level: c.level,
        filter: c.filterVal,
        muted: c.muted,
        params: Object.fromEntries(
          Object.entries(c.mounted.store.specs)
            .filter(([, spec]) => spec.type !== 'button')
            .map(([k]) => [k, c.mounted.store.get(k)]),
        ),
      })),
    }
    try {
      localStorage.setItem(SCENES_KEY, JSON.stringify(this.scenes))
    } catch {
      /* scene lives for the session anyway */
    }
  }

  recallScene(i: number): boolean {
    const sc = this.scenes[i]
    if (!sc) return false
    clock.bpm = sc.bpm
    clock.swing = sc.swing

    // Match stored channels to live ones by sketch id, in order.
    const pool = [...this.channels]
    for (const scc of sc.channels) {
      const idx = pool.findIndex((c) => c.entry.id === scc.id)
      if (idx < 0) continue
      const ch = pool.splice(idx, 1)[0]
      ch.level = scc.level
      ch.filterVal = scc.filter
      ch.muted = scc.muted
      ch.levelInput.value = String(ch.level)
      ch.filterInput.value = String(ch.filterVal)
      this.applyFilter(ch)
      for (const [k, v] of Object.entries(scc.params)) {
        ch.mounted.store.set(k, v)
      }
      this.syncStripUi(ch)
    }
    this.applyMix()
    this.save()
    return true
  }

  // ------------------------------------------------------------------------

  private save() {
    try {
      localStorage.setItem(
        RACK_KEY,
        JSON.stringify(
          this.channels.map((c) => ({
            id: c.entry.id,
            level: c.level,
            filter: c.filterVal,
            muted: c.muted,
          })),
        ),
      )
    } catch {
      /* the rack just won't persist */
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.save()
    for (const ch of [...this.channels]) {
      ch.mounted.unmount()
      setTimeout(() => {
        ch.filter.disconnect()
        ch.gain.disconnect()
        ch.analyser.disconnect()
      }, 250)
    }
    this.channels = []
  }
}
