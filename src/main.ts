/**
 * The lab shell: a gallery on the left, the running sketch in the middle,
 * its parameters on the right, one transport across the top.
 *
 * The transport is deliberately global. Comparing two rhythmic ideas is much
 * easier when both are on the same clock with the same play button.
 */

import './style.css'
import { audio, getMasterVolume, isRunning, peakLevel, setMasterVolume, unlock } from '@core/audio'
import { clock } from '@core/clock'
import { midi } from '@core/midi'
import { isRecording, recordingSeconds, startRecording, stopRecording } from '@core/record'
import { mountSketch, type MountedSketch } from '@runtime/host'
import { JamRack } from '@runtime/jam'
import { allTags, findSketch, sketches } from '@runtime/registry'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-dot"></span>
      <span>music lab</span>
    </div>
    <input class="search" type="search" placeholder="filter sketches…" aria-label="Filter sketches" />
    <a class="jam-entry" id="jam-entry" href="#/jam">
      <span>⚡ jam</span>
      <span class="jam-count" id="jam-count"></span>
    </a>
    <div class="tags" id="tags"></div>
    <nav class="sketch-list" id="list"></nav>
    <div class="sidebar-foot">
      <span id="count"></span>
      <span class="hint"><kbd>space</kbd> play</span>
    </div>
  </aside>

  <header class="transport">
    <button class="btn btn-play" id="play" aria-label="Play or stop">▶</button>
    <div class="field">
      <label for="bpm">bpm</label>
      <input id="bpm" class="num" type="number" min="20" max="300" step="1" />
    </div>
    <div class="field">
      <label for="swing">swing</label>
      <input id="swing" type="range" min="0" max="0.6" step="0.01" />
    </div>
    <button class="btn btn-ghost" id="tap" title="Tap tempo (b)">tap</button>
    <div class="beat" id="beat"></div>
    <div class="scenes" id="scenes" hidden></div>
    <div class="spacer"></div>
    <div class="field">
      <label for="vol">out</label>
      <input id="vol" type="range" min="0" max="1" step="0.01" />
    </div>
    <canvas class="meter" id="meter" width="120" height="18"></canvas>
    <button class="btn btn-ghost" id="rec" title="Record master output to WAV (shift+R)">●</button>
    <button class="btn btn-ghost" id="midi-btn" title="Enable MIDI input">midi</button>
  </header>

  <main class="stage-wrap">
    <div class="stage" id="stage"></div>
    <div class="status" id="status"></div>
  </main>

  <aside class="panel">
    <div class="panel-head">
      <h2 id="sketch-title">—</h2>
      <p id="sketch-desc"></p>
      <div id="sketch-meta" class="meta"></div>
    </div>
    <div class="panel-body" id="panel"></div>
    <div class="panel-notes" id="notes"></div>
  </aside>
`

const $ = <T extends HTMLElement>(sel: string) => app.querySelector<T>(sel)!

const listEl = $<HTMLElement>('#list')
const tagsEl = $<HTMLElement>('#tags')
const searchEl = $<HTMLInputElement>('.search')
const stageEl = $<HTMLElement>('#stage')
const panelEl = $<HTMLElement>('#panel')
const statusEl = $<HTMLElement>('#status')
const playEl = $<HTMLButtonElement>('#play')
const bpmEl = $<HTMLInputElement>('#bpm')
const swingEl = $<HTMLInputElement>('#swing')
const volEl = $<HTMLInputElement>('#vol')
const beatEl = $<HTMLElement>('#beat')
const meterEl = $<HTMLCanvasElement>('#meter')
const titleEl = $<HTMLElement>('#sketch-title')
const descEl = $<HTMLElement>('#sketch-desc')
const metaEl = $<HTMLElement>('#sketch-meta')
const notesEl = $<HTMLElement>('#notes')
const countEl = $<HTMLElement>('#count')
const midiBtn = $<HTMLButtonElement>('#midi-btn')
const tapEl = $<HTMLButtonElement>('#tap')
const recEl = $<HTMLButtonElement>('#rec')
const scenesEl = $<HTMLElement>('#scenes')
const jamEntryEl = $<HTMLAnchorElement>('#jam-entry')
const jamCountEl = $<HTMLElement>('#jam-count')

let mounted: MountedSketch | null = null
let jam: JamRack | null = null
let filterText = ''
let activeTag: string | null = null

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

function renderTags() {
  tagsEl.innerHTML = ''
  for (const tag of allTags) {
    const b = document.createElement('button')
    b.className = 'tag'
    b.textContent = tag
    b.classList.toggle('is-active', activeTag === tag)
    b.onclick = () => {
      activeTag = activeTag === tag ? null : tag
      renderTags()
      renderList()
    }
    tagsEl.appendChild(b)
  }
}

function renderList() {
  const q = filterText.trim().toLowerCase()
  const visible = sketches.filter((s) => {
    if (activeTag && !(s.def.tags ?? []).includes(activeTag)) return false
    if (!q) return true
    const hay = `${s.def.title} ${s.id} ${s.def.description ?? ''} ${(s.def.tags ?? []).join(' ')}`
    return hay.toLowerCase().includes(q)
  })

  listEl.innerHTML = ''
  for (const s of visible) {
    const a = document.createElement('a')
    a.className = 'item'
    a.href = `#/${s.id}`
    a.classList.toggle('is-active', mounted?.entry.id === s.id)

    const title = document.createElement('span')
    title.className = 'item-title'
    title.textContent = s.def.title
    a.appendChild(title)

    // In jam mode the gallery becomes the palette: clicking adds a channel.
    a.onclick = (e) => {
      if (!jam) return
      e.preventDefault()
      jam.add(s.id)
    }

    if (s.def.status && s.def.status !== 'sketch') {
      const dot = document.createElement('span')
      dot.className = `status-dot status-${s.def.status}`
      dot.title = s.def.status
      a.appendChild(dot)
    }
    listEl.appendChild(a)
  }

  if (!visible.length) {
    const p = document.createElement('p')
    p.className = 'panel-empty'
    p.textContent = sketches.length ? 'Nothing matches.' : 'No sketches yet — run npm run new <name>.'
    listEl.appendChild(p)
  }

  countEl.textContent = `${visible.length}/${sketches.length}`
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function setStatus(text: string) {
  statusEl.textContent = text
  if (text) {
    window.clearTimeout(setStatus.timer)
    setStatus.timer = window.setTimeout(() => (statusEl.textContent = ''), 4000)
  }
}
setStatus.timer = 0

function updateJamBadge() {
  jamCountEl.textContent = jam && jam.size ? String(jam.size) : ''
  jamEntryEl.classList.toggle('is-active', !!jam)
}

function enterJam() {
  if (jam) return
  mounted?.unmount()
  mounted = null

  document.title = 'jam — music lab'
  titleEl.textContent = 'Jam'
  descEl.textContent = 'Every channel runs on the one transport, so everything locks by construction.'
  metaEl.innerHTML = ''
  const chip = document.createElement('span')
  chip.className = 'chip chip-promising'
  chip.textContent = 'live'
  metaEl.appendChild(chip)

  notesEl.innerHTML = ''
  const h = document.createElement('h3')
  h.textContent = 'Performing'
  const p = document.createElement('pre')
  p.textContent = [
    'sidebar        click a sketch to add it',
    '··· on a strip that sketch’s parameters',
    'filter knob    left = lowpass, right = highpass,',
    '               double-click to reset',
    '1-4            recall scene',
    'shift+1-4      store scene (params, mix, bpm)',
    'b              tap tempo    shift+R  record wav',
    '',
    'QWERTY keys play every listening channel at',
    'once — mute the ones you don’t want layered.',
  ].join('\n')
  notesEl.append(h, p)

  panelEl.innerHTML = ''
  stageEl.innerHTML = ''
  const rackRoot = document.createElement('div')
  stageEl.appendChild(rackRoot)

  clock.division = 4
  jam = new JamRack(rackRoot)
  jam.onChange = updateJamBadge
  jam.restore()

  scenesEl.hidden = false
  paintScenes()
  updateJamBadge()
  renderList()
  syncTransport()
}

function exitJam() {
  if (!jam) return
  jam.dispose()
  jam = null
  scenesEl.hidden = true
  updateJamBadge()
}

function route() {
  const id = location.hash.replace(/^#\/?/, '')

  if (id === 'jam') {
    enterJam()
    return
  }
  exitJam()

  const entry = id ? findSketch(id) : sketches[0]

  mounted?.unmount()
  mounted = null

  if (!entry) {
    titleEl.textContent = sketches.length ? 'Not found' : 'No sketches yet'
    descEl.textContent = sketches.length
      ? `No sketch called "${id}".`
      : 'Create one with: npm run new my-idea'
    metaEl.innerHTML = ''
    notesEl.innerHTML = ''
    stageEl.innerHTML = ''
    panelEl.innerHTML = ''
    renderList()
    return
  }

  document.title = `${entry.def.title} — music lab`
  titleEl.textContent = entry.def.title
  descEl.textContent = entry.def.description ?? ''

  metaEl.innerHTML = ''
  for (const tag of entry.def.tags ?? []) {
    const t = document.createElement('span')
    t.className = 'chip'
    t.textContent = tag
    metaEl.appendChild(t)
  }
  if (entry.def.status) {
    const s = document.createElement('span')
    s.className = `chip chip-${entry.def.status}`
    s.textContent = entry.def.status
    metaEl.appendChild(s)
  }

  notesEl.innerHTML = ''
  if (entry.def.notes) {
    const h = document.createElement('h3')
    h.textContent = 'Notes'
    const p = document.createElement('pre')
    p.textContent = entry.def.notes.trim()
    notesEl.append(h, p)
  }

  try {
    mounted = mountSketch(entry, { stage: stageEl, panel: panelEl, status: setStatus })
  } catch (err) {
    console.error(err)
    setStatus(`failed to mount: ${err instanceof Error ? err.message : String(err)}`)
  }

  syncTransport()
  renderList()
}

window.addEventListener('hashchange', route)

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

function syncTransport() {
  bpmEl.value = String(Math.round(clock.bpm))
  swingEl.value = String(clock.swing)
  volEl.value = String(getMasterVolume())
  playEl.textContent = clock.running ? '■' : '▶'
  playEl.classList.toggle('is-playing', clock.running)
}

async function togglePlay() {
  await unlock()
  clock.toggle()
  syncTransport()
}

playEl.onclick = togglePlay
bpmEl.oninput = () => {
  const v = Number(bpmEl.value)
  if (Number.isFinite(v) && v >= 20 && v <= 300) clock.bpm = v
}
swingEl.oninput = () => (clock.swing = Number(swingEl.value))
volEl.oninput = () => setMasterVolume(Number(volEl.value))
clock.onStateChange(syncTransport)

searchEl.oninput = () => {
  filterText = searchEl.value
  renderList()
}

// -- scenes ------------------------------------------------------------------

const sceneBtns: HTMLButtonElement[] = []
for (let i = 0; i < 4; i++) {
  const b = document.createElement('button')
  b.className = 'scene'
  b.textContent = String(i + 1)
  b.title = `Scene ${i + 1} — click to recall, shift+click to store`
  b.onclick = (e) => (e.shiftKey ? storeScene(i) : recallScene(i))
  scenesEl.appendChild(b)
  sceneBtns.push(b)
}

function paintScenes() {
  sceneBtns.forEach((b, i) => b.classList.toggle('is-filled', !!jam?.sceneFilled(i)))
}

function storeScene(i: number) {
  if (!jam) return
  jam.storeScene(i)
  paintScenes()
  setStatus(`scene ${i + 1} stored`)
}

function recallScene(i: number) {
  if (!jam) return
  // An empty slot stores on plain click — makes the first save discoverable.
  if (!jam.sceneFilled(i)) {
    storeScene(i)
    return
  }
  jam.recallScene(i)
  syncTransport()
  setStatus(`scene ${i + 1}`)
}

// -- tap tempo ---------------------------------------------------------------

let taps: number[] = []
function tapTempo() {
  const now = performance.now()
  if (taps.length && now - taps[taps.length - 1] > 2000) taps = []
  taps.push(now)
  if (taps.length < 2) return
  const recent = taps.slice(-5)
  const interval = (recent[recent.length - 1] - recent[0]) / (recent.length - 1)
  const bpm = Math.round(Math.min(300, Math.max(20, 60000 / interval)))
  clock.bpm = bpm
  syncTransport()
  setStatus(`tap: ${bpm} bpm`)
}
tapEl.onclick = tapTempo

// -- record ------------------------------------------------------------------

async function toggleRecord() {
  if (isRecording()) {
    const blob = await stopRecording()
    recEl.classList.remove('is-rec')
    recEl.textContent = '●'
    if (blob) {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
      a.download = `musiclab-${stamp}.wav`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      setStatus(`saved ${a.download}`)
    }
  } else {
    await unlock()
    await startRecording()
    recEl.classList.add('is-rec')
    setStatus('recording — everything you hear goes to the file')
  }
}
recEl.onclick = () => void toggleRecord()

midiBtn.onclick = async () => {
  const ok = await midi.enable()
  midiBtn.classList.toggle('is-on', ok)
  setStatus(
    ok
      ? midi.inputNames.length
        ? `MIDI: ${midi.inputNames.join(', ')}`
        : 'MIDI enabled — no inputs connected'
      : `MIDI unavailable: ${midi.error}`,
  )
}

window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

  if (e.code === 'Space') {
    e.preventDefault()
    void togglePlay()
  } else if (jam && /^Digit[1-4]$/.test(e.code) && !e.metaKey && !e.ctrlKey) {
    const i = Number(e.code.slice(5)) - 1
    e.shiftKey ? storeScene(i) : recallScene(i)
  } else if (e.key === 'b' && !e.metaKey && !e.ctrlKey) {
    // 'b' for beat — 't' belongs to the QWERTY note row.
    tapTempo()
  } else if (e.key === 'R' && e.shiftKey && !e.metaKey && !e.ctrlKey) {
    // Shift guards the take: a stray key must not stop a recording.
    void toggleRecord()
  } else if (e.key === '/') {
    e.preventDefault()
    searchEl.focus()
  } else if (e.key === '[' || e.key === ']') {
    const i = sketches.findIndex((s) => s.id === mounted?.entry.id)
    if (i < 0) return
    const next = (i + (e.key === ']' ? 1 : -1) + sketches.length) % sketches.length
    location.hash = `#/${sketches[next].id}`
  }
})

// The very first gesture anywhere wakes the audio context.
const wake = () => void unlock().then(syncTransport)
window.addEventListener('pointerdown', wake, { once: true })
window.addEventListener('keydown', wake, { once: true })

// ---------------------------------------------------------------------------
// Meters
// ---------------------------------------------------------------------------

const meterCtx = meterEl.getContext('2d')!
function paintMeters() {
  requestAnimationFrame(paintMeters)

  if (isRecording()) {
    const s = Math.floor(recordingSeconds())
    recEl.textContent = `● ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  // beat indicator
  if (clock.running) {
    const step = clock.visualStep
    const beat = step >= 0 ? Math.floor((step % clock.stepsPerBar) / clock.division) : -1
    beatEl.textContent = step >= 0 ? `${Math.floor(step / clock.stepsPerBar) + 1}.${beat + 1}` : '—'
    beatEl.classList.toggle('is-hit', step >= 0 && step % clock.division === 0)
  } else {
    beatEl.textContent = '—'
    beatEl.classList.remove('is-hit')
  }

  const w = meterEl.width
  const h = meterEl.height
  meterCtx.clearRect(0, 0, w, h)
  if (!isRunning()) return

  const level = peakLevel()
  meterCtx.fillStyle = 'rgba(255,255,255,0.07)'
  meterCtx.fillRect(0, 0, w, h)
  const lit = Math.round(level * w)
  meterCtx.fillStyle = level > 0.95 ? '#ff5f56' : level > 0.7 ? '#ffbd2e' : '#4ade80'
  meterCtx.fillRect(0, 0, lit, h)
}
requestAnimationFrame(paintMeters)

// ---------------------------------------------------------------------------

renderTags()
renderList()
route()
syncTransport()

// Keep the audio graph alive across hot reloads instead of stacking contexts.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    mounted?.unmount()
    clock.stop()
    void audio().ctx.suspend()
  })
}
