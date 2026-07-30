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
import { NOTE_NAMES, SCALE_NAMES, type ScaleName } from '@core/theory'
import { mountSketch, type MountedSketch } from './host'
import { findSketch, type SketchEntry } from './registry'

const RACK_KEY = 'musiclab:jam:rack'
const SCENES_KEY = 'musiclab:jam:scenes'

interface ChannelPreset {
  level?: number
  filter?: number
  muted?: boolean
  linked?: boolean
}

interface JamKey {
  pc: number
  scale: ScaleName
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
  key?: JamKey | null
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
  /** Whether this channel follows the global key (only pitched sketches). */
  linked: boolean
  linkBtn: HTMLButtonElement | null
}

/** A channel can follow the key if it exposes the conventional params. */
function hasKeyParams(ch: Channel): boolean {
  const specs = ch.mounted.store.specs
  return specs.root?.type === 'number' && specs.scale?.type === 'select'
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

  /** The global key. Null = every channel keeps its own. */
  private key: JamKey | null = null
  /** A key change waiting for the next bar line. */
  private pendingKey: JamKey | null = null
  private keyOnBar = true
  /** Scene morph length in beats. 0 = hard cut. */
  morphBeats = 4
  private morphRaf = 0
  private offStep: () => void

  private pcBtns: HTMLButtonElement[] = []
  private scaleSel!: HTMLSelectElement
  private onBarBtn!: HTMLButtonElement

  constructor(root: HTMLElement) {
    root.innerHTML = ''
    root.className = 'rack'

    root.appendChild(this.buildBar())

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

    // Key changes land on the bar line, so retunes read as musical decisions.
    this.offStep = clock.onStep((e) => {
      if (this.pendingKey && e.step % clock.stepsPerBar === 0) {
        this.key = this.pendingKey
        this.pendingKey = null
        this.applyKeyNow()
        this.paintKey()
      }
    })

    this.raf = requestAnimationFrame(this.paintMeters)
  }

  // -- global key ----------------------------------------------------------

  private buildBar(): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'rack-bar'

    const keyLabel = document.createElement('span')
    keyLabel.className = 'rack-label'
    keyLabel.textContent = 'key'
    bar.appendChild(keyLabel)

    const pcs = document.createElement('div')
    pcs.className = 'pcs'
    NOTE_NAMES.forEach((name, pc) => {
      const b = document.createElement('button')
      b.className = 'pc'
      b.textContent = name
      b.title = `Sync every linked channel to ${name} — lands on the next bar`
      b.onclick = () => {
        if (this.key?.pc === pc && !this.pendingKey) {
          // Clicking the active key releases the jam from it.
          this.key = null
          this.pendingKey = null
          this.paintKey()
          return
        }
        this.setKey(pc, this.scaleSel.value as ScaleName)
      }
      pcs.appendChild(b)
      this.pcBtns.push(b)
    })
    bar.appendChild(pcs)

    this.scaleSel = document.createElement('select')
    this.scaleSel.className = 'select rack-select'
    for (const s of SCALE_NAMES) {
      const o = document.createElement('option')
      o.value = s
      o.textContent = s
      this.scaleSel.appendChild(o)
    }
    this.scaleSel.value = 'dorian'
    this.scaleSel.onchange = () => {
      const active = this.pendingKey ?? this.key
      if (active) this.setKey(active.pc, this.scaleSel.value as ScaleName)
    }
    bar.appendChild(this.scaleSel)

    this.onBarBtn = document.createElement('button')
    this.onBarBtn.className = 'chipbtn is-on'
    this.onBarBtn.textContent = 'bar'
    this.onBarBtn.title = 'Apply key changes on the next bar line'
    this.onBarBtn.onclick = () => {
      this.keyOnBar = !this.keyOnBar
      this.onBarBtn.classList.toggle('is-on', this.keyOnBar)
    }
    bar.appendChild(this.onBarBtn)

    const morphLabel = document.createElement('span')
    morphLabel.className = 'rack-label'
    morphLabel.textContent = 'morph'
    bar.appendChild(morphLabel)

    const morphSel = document.createElement('select')
    morphSel.className = 'select rack-select'
    for (const [label, beats] of [
      ['cut', 0],
      ['½ bar', 2],
      ['1 bar', 4],
      ['2 bars', 8],
      ['4 bars', 16],
    ] as const) {
      const o = document.createElement('option')
      o.value = String(beats)
      o.textContent = label
      morphSel.appendChild(o)
    }
    morphSel.value = String(this.morphBeats)
    morphSel.title = 'Scene recall glides parameters over this long instead of jumping'
    morphSel.onchange = () => {
      this.morphBeats = Number(morphSel.value)
      this.save()
    }
    bar.appendChild(morphSel)

    return bar
  }

  private setKey(pc: number, scale: ScaleName) {
    const next = { pc, scale }
    if (this.keyOnBar && clock.running) {
      this.pendingKey = next
    } else {
      this.key = next
      this.pendingKey = null
      this.applyKeyNow()
    }
    this.paintKey()
    this.save()
  }

  private applyKeyNow() {
    if (!this.key) return
    for (const ch of this.channels) {
      if (ch.linked && hasKeyParams(ch)) this.applyKeyToChannel(ch)
    }
  }

  /**
   * Retune one channel: same pitch class for everyone, but each instrument
   * keeps its own register — the new root is the octave of the target pitch
   * class nearest the channel's current root, clamped to its param range.
   */
  private applyKeyToChannel(ch: Channel) {
    if (!this.key) return
    const store = ch.mounted.store
    const rootSpec = store.specs.root
    const scaleSpec = store.specs.scale
    if (rootSpec?.type !== 'number' || scaleSpec?.type !== 'select') return

    if ((scaleSpec.options as readonly string[]).includes(this.key.scale)) {
      store.set('scale', this.key.scale)
    }

    const cur = Math.round(Number(store.get('root')))
    const curPc = ((cur % 12) + 12) % 12
    let delta = (this.key.pc - curPc + 12) % 12
    if (delta > 6) delta -= 12
    let target = cur + delta
    const min = rootSpec.min ?? 0
    const max = rootSpec.max ?? 127
    while (target < min) target += 12
    while (target > max) target -= 12
    if (target >= min && target <= max) store.set('root', target)
  }

  private paintKey() {
    const shown = this.pendingKey ?? this.key
    this.pcBtns.forEach((b, pc) => {
      b.classList.toggle('is-key', shown?.pc === pc)
      b.classList.toggle('is-pending', this.pendingKey?.pc === pc)
    })
    if (shown) this.scaleSel.value = shown.scale
    for (const ch of this.channels) this.paintLink(ch)
  }

  private paintLink(ch: Channel) {
    if (!ch.linkBtn) return
    // Not `is-on` — that's the mute's red. Linked reads accent, and dims
    // when no global key is active.
    ch.linkBtn.classList.toggle('is-linked', ch.linked)
    ch.linkBtn.style.opacity = ch.linked && !this.key ? '0.55' : '1'
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
      const saved = JSON.parse(raw) as unknown
      // v1 was a bare array of channels; v2 wraps it with key + morph.
      const channels = Array.isArray(saved)
        ? (saved as Array<{ id: string } & ChannelPreset>)
        : ((saved as { channels?: Array<{ id: string } & ChannelPreset> }).channels ?? [])
      if (!Array.isArray(saved)) {
        const s = saved as { key?: JamKey | null; morphBeats?: number }
        this.key = s.key ?? null
        if (typeof s.morphBeats === 'number') this.morphBeats = s.morphBeats
      }
      for (const c of channels) this.add(c.id, c)
      this.paintKey()
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
    // 0.7 default leaves headroom for stacking — two hot sketches at 0.9
    // each measured 1.15 pre-limiter in coincident transients.
    gain.gain.value = preset.level ?? 0.7
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
          <button class="chipbtn s-link" title="follow the global key">key</button>
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
      level: preset.level ?? 0.7,
      filterVal: preset.filter ?? 0,
      muted: preset.muted ?? false,
      soloed: false,
      linked: preset.linked ?? true,
      linkBtn: q<HTMLButtonElement>('.s-link'),
    }

    if (hasKeyParams(ch)) {
      ch.linkBtn!.onclick = () => {
        ch.linked = !ch.linked
        this.paintLink(ch)
        if (ch.linked) this.applyKeyToChannel(ch)
        this.save()
      }
      // A channel added mid-jam joins the key it walked into.
      if (this.key && ch.linked) this.applyKeyToChannel(ch)
    } else {
      ch.linkBtn!.remove()
      ch.linkBtn = null
    }
    this.paintLink(ch)

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
      key: this.pendingKey ?? this.key,
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
    cancelAnimationFrame(this.morphRaf)

    // The scene's channel params already carry their retuned roots/scales, so
    // recalling them IS the retune — the key here is just UI state.
    if (sc.key !== undefined) {
      this.key = sc.key
      this.pendingKey = null
      this.paintKey()
    }

    // Match stored channels to live ones by sketch id, in order.
    const matched: Array<{ ch: Channel; scc: SceneChannel }> = []
    const pool = [...this.channels]
    for (const scc of sc.channels) {
      const idx = pool.findIndex((c) => c.entry.id === scc.id)
      if (idx < 0) continue
      matched.push({ ch: pool.splice(idx, 1)[0], scc })
    }

    if (this.morphBeats <= 0) {
      clock.bpm = sc.bpm
      clock.swing = sc.swing
      for (const { ch, scc } of matched) {
        ch.level = scc.level
        ch.filterVal = scc.filter
        ch.muted = scc.muted
        ch.levelInput.value = String(ch.level)
        ch.filterInput.value = String(ch.filterVal)
        this.applyFilter(ch)
        for (const [k, v] of Object.entries(scc.params)) ch.mounted.store.set(k, v)
        this.syncStripUi(ch)
      }
      this.applyMix()
      this.save()
      return true
    }

    // -- morph: numbers glide, discrete values snap -------------------------
    const steps: Array<(t: number) => void> = []
    const ends: Array<() => void> = []

    const glide = (from: number, to: number, apply: (v: number) => void, stepSize = 0) => {
      if (from === to) return
      steps.push((t) => {
        let v = from + (to - from) * t
        if (stepSize >= 1) v = Math.round(v / stepSize) * stepSize
        apply(v)
      })
    }

    glide(clock.bpm, sc.bpm, (v) => (clock.bpm = v))
    glide(clock.swing, sc.swing, (v) => (clock.swing = v))

    for (const { ch, scc } of matched) {
      const store = ch.mounted.store
      for (const [k, v] of Object.entries(scc.params)) {
        const spec = store.specs[k]
        if (!spec || spec.type === 'button') continue
        // 'seed' and 'root' are numeric but categorical: gliding a seed
        // re-rolls the piece every frame, gliding a root walks chromatically
        // through nonsense. They snap; everything else glides.
        if (spec.type !== 'number' || k === 'seed' || k === 'root') {
          store.set(k, v)
          continue
        }
        const from = Number(store.get(k))
        const to = Number(v)
        if (Number.isFinite(from) && Number.isFinite(to)) {
          glide(from, to, (x) => store.set(k, x), spec.step ?? 0)
        }
      }

      glide(ch.filterVal, scc.filter, (v) => {
        ch.filterVal = v
        ch.filterInput.value = String(v)
        this.applyFilter(ch)
      })

      // Mutes become fades: in from silence, or out and then latch.
      if (ch.muted && !scc.muted) {
        ch.muted = false
        this.syncStripUi(ch)
        glide(0, scc.level, (v) => {
          ch.level = v
          ch.levelInput.value = String(v)
        })
      } else if (!ch.muted && scc.muted) {
        glide(ch.level, 0, (v) => (ch.level = v))
        ends.push(() => {
          ch.muted = true
          ch.level = scc.level
          ch.levelInput.value = String(scc.level)
          this.syncStripUi(ch)
        })
      } else {
        glide(ch.level, scc.level, (v) => {
          ch.level = v
          ch.levelInput.value = String(v)
        })
      }
    }

    const durMs = Math.max(60, this.morphBeats * clock.secondsPerBeat * 1000)
    const t0 = performance.now()
    const tick = () => {
      const raw = Math.min(1, (performance.now() - t0) / durMs)
      const t = raw * raw * (3 - 2 * raw) // smoothstep: gentle both ends
      for (const s of steps) s(t)
      this.applyMix()
      if (raw < 1) {
        this.morphRaf = requestAnimationFrame(tick)
      } else {
        for (const e of ends) e()
        this.applyMix()
        this.save()
      }
    }
    tick()
    return true
  }

  // ------------------------------------------------------------------------

  private save() {
    try {
      localStorage.setItem(
        RACK_KEY,
        JSON.stringify({
          key: this.key,
          morphBeats: this.morphBeats,
          channels: this.channels.map((c) => ({
            id: c.entry.id,
            level: c.level,
            filter: c.filterVal,
            muted: c.muted,
            linked: c.linked,
          })),
        }),
      )
    } catch {
      /* the rack just won't persist */
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    cancelAnimationFrame(this.morphRaf)
    this.offStep()
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
