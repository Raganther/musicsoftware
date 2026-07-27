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
import { mountSketch, type MountedSketch } from '@runtime/host'
import { allTags, findSketch, sketches } from '@runtime/registry'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-dot"></span>
      <span>music lab</span>
    </div>
    <input class="search" type="search" placeholder="filter sketches…" aria-label="Filter sketches" />
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
    <div class="beat" id="beat"></div>
    <div class="spacer"></div>
    <div class="field">
      <label for="vol">out</label>
      <input id="vol" type="range" min="0" max="1" step="0.01" />
    </div>
    <canvas class="meter" id="meter" width="120" height="18"></canvas>
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

let mounted: MountedSketch | null = null
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

function route() {
  const id = location.hash.replace(/^#\/?/, '')
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
