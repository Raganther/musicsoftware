#!/usr/bin/env node
/**
 * Audio smoke test:  npm run smoke
 *
 * Typechecking proves nothing about sound, so this drives the real app in a
 * real browser and asserts the things that actually break:
 *
 *   1. every sketch produces audio when provoked
 *   2. nothing clips — pre-limiter peak stays below 1.0
 *   3. leaving a sketch leaves silence (no orphaned oscillators)
 *   4. no console errors
 *
 * Starts its own dev server and shuts it down again. Needs Playwright and a
 * Chromium; both are present in the Claude Code web environment.
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.SMOKE_PORT || 5199)
const BASE = `http://localhost:${PORT}`

// How to provoke each sketch into making sound. Sketches not listed here are
// still loaded and checked for errors, just not asserted to be audible.
const PLAN = {
  'step-sequencer': 'play',
  'euclidean-drift': 'play',
  'worklet-fold': 'play',
  'chord-loom': 'play+drag',
  'poly-synth': 'keys',
  // 'converse' = transport on, play a few notes, release, then wait — for
  // sketches that answer you back rather than sounding while you hold keys.
  'call-response': 'converse',
  'aeolian-harp': 'play+drag',
  'watershed': 'play',
  'cats-cradle': 'play',
  'patina': 'play',
  'attractor': 'play',
  'foreshadow': 'play',
  'convergence': 'play',
  'arc': 'play',
  'earshot': 'play',
  // a reed only sounds while you are blowing it
  'overblow': 'keys',
  'understudy': 'keys',
  'tiling': 'play',
  'tonnetz': 'play',
  'veil': 'play',
  'bow': 'keys',
  'conduct': 'play',
  // sounds on its own; the transport is not involved
  'continuum': 'play',
}

// -- locate playwright -------------------------------------------------------

const require = createRequire(import.meta.url)
async function loadChromium() {
  const candidates = [
    'playwright',
    '/opt/node22/lib/node_modules/playwright/index.mjs',
    '/usr/lib/node_modules/playwright/index.mjs',
  ]
  for (const c of candidates) {
    try {
      return (await import(c)).chromium
    } catch {
      /* try the next one */
    }
  }
  console.error('Playwright not found. Install it, or set SMOKE_SKIP=1 to skip.')
  process.exit(process.env.SMOKE_SKIP ? 0 : 1)
}

function chromiumPath() {
  const explicit = process.env.CHROMIUM_PATH
  if (explicit && existsSync(explicit)) return explicit
  const guesses = [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
  ]
  return guesses.find(existsSync)
}

// -- dev server --------------------------------------------------------------

async function startServer() {
  const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
    detached: false,
  })
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(BASE)
      if (res.ok) return proc
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  proc.kill()
  throw new Error(`dev server did not start on ${PORT}`)
}

// ---------------------------------------------------------------------------

const chromium = await loadChromium()
const server = await startServer()

let browser
const failures = []
const rows = []

try {
  browser = await chromium.launch({
    executablePath: chromiumPath(),
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  })

  const page = await browser.newPage({ viewport: { width: 1400, height: 820 } })
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(BASE, { waitUntil: 'networkidle' })

  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('.sketch-list .item')].map((a) => a.getAttribute('href').slice(2)),
  )
  if (!ids.length) throw new Error('no sketches discovered')

  /**
   * Vite serves invalidated modules with a ?t= query, so importing by bare
   * path can hand back a SECOND copy of the module — with its own
   * AudioContext, which reads as silence. Always import the URL the app used.
   */
  const moduleUrls = () =>
    page.evaluate(() => {
      const names = performance.getEntriesByType('resource').map((e) => e.name)
      const pick = (p) => names.filter((n) => n.split('?')[0].endsWith(p)).pop() || p
      return { audio: pick('/src/core/audio.ts'), clock: pick('/src/core/clock.ts') }
    })

  // Tap the master bus *before* the limiter: we want what the sketch produces,
  // not what the safety limiter allows through.
  const installTap = (u) =>
    page.evaluate(async (u) => {
      if (window.__tap) return
      const { ctx, master } = (await import(u.audio)).audio()
      const a = ctx.createAnalyser()
      a.fftSize = 2048
      master.connect(a)
      window.__tap = a
      window.__tapBuf = new Float32Array(a.fftSize)
    }, u)

  const peak = () =>
    page.evaluate(() => {
      if (!window.__tap) return 0
      window.__tap.getFloatTimeDomainData(window.__tapBuf)
      let m = 0
      for (const v of window.__tapBuf) m = Math.max(m, Math.abs(v))
      return m
    })

  const sample = async (ms = 2400) => {
    let max = 0
    for (let i = 0; i < ms / 100; i++) {
      await page.waitForTimeout(100)
      max = Math.max(max, await peak())
    }
    return max
  }

  for (const id of ids) {
    const act = PLAN[id] ?? 'play'
    await page.goto(`${BASE}/#/${id}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(350)
    const urls = await moduleUrls()

    // Hash navigation doesn't reload, so the transport may still be running.
    if ((await page.textContent('#play')) === '■') await page.click('#play')
    if (act !== 'keys') await page.click('#play')

    if (act === 'play+drag') {
      const box = await page.locator('canvas.sketch-canvas').first().boundingBox()
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.35, { steps: 12 })
    }
    if (act === 'keys') {
      await page.click('#play') // a gesture, to wake the audio context
      await page.click('#play') // this sketch doesn't need the transport
      for (const k of ['a', 'e', 'g']) await page.keyboard.down(k)
    }
    if (act === 'converse') {
      // Play a short phrase and let go — the response comes after the silence.
      for (const k of ['a', 'e', 'g']) {
        await page.keyboard.down(k)
        await page.waitForTimeout(160)
        await page.keyboard.up(k)
      }
    }

    await installTap(urls)
    const max = await sample()

    if (act === 'keys') for (const k of ['a', 'e', 'g']) await page.keyboard.up(k)
    if (act === 'play+drag') await page.mouse.up()

    rows.push({ id, peak: Number(max.toFixed(3)) })
    if (PLAN[id] && max < 0.001) failures.push(`${id}: silent`)
    if (max > 1) failures.push(`${id}: clipping into the limiter (${max.toFixed(2)})`)
  }

  // Teardown: leaving a sketch must not leave anything sounding.
  const urls = await moduleUrls()
  await page.goto(`${BASE}/#/${ids[0]}`, { waitUntil: 'networkidle' })
  if ((await page.textContent('#play')) !== '■') await page.click('#play')
  await page.waitForTimeout(600)
  await page.evaluate((next) => (location.hash = `#/${next}`), ids[1] ?? ids[0])
  await page.waitForTimeout(300)
  await page.evaluate(async (u) => (await import(u.clock)).clock.stop(), urls)
  // Long enough for a legitimate tail to die: the slowest sketch here has
  // ~1.4s notes into a 2.8s reverb. Anything still sounding after this with
  // the transport stopped is genuinely stuck, not decaying.
  await page.waitForTimeout(3200)
  const residual = await sample(800)
  if (residual > 0.02) failures.push(`audio still sounding after unmount (${residual.toFixed(3)})`)

  // Jam mode: two channels on the one transport must sound together, and
  // leaving the jam must leave silence.
  await page.evaluate(() => (location.hash = '#/jam'))
  await page.waitForTimeout(400)
  await page.click('.sketch-list .item[href="#/step-sequencer"]')
  await page.click('.sketch-list .item[href="#/euclidean-drift"]')
  await page.waitForTimeout(300)
  const jamChannels = await page.evaluate(() => document.querySelectorAll('.strip').length)
  if ((await page.textContent('#play')) !== '■') await page.click('#play')
  const jamPeak = await sample(2000)

  await page.evaluate(() => (location.hash = '#/call-response'))
  await page.waitForTimeout(300)
  await page.evaluate(async (u) => (await import(u.clock)).clock.stop(), urls)
  await page.waitForTimeout(900)
  const jamResidual = await sample(800)

  if (jamChannels !== 2) failures.push(`jam: expected 2 channels, got ${jamChannels}`)
  if (jamPeak < 0.02) failures.push(`jam: near-silent with two channels (${jamPeak.toFixed(3)})`)
  if (jamPeak > 1) failures.push(`jam: clipping into the limiter (${jamPeak.toFixed(2)})`)
  if (jamResidual > 0.02) failures.push(`jam: still sounding after leaving (${jamResidual.toFixed(3)})`)

  if (errors.length) failures.push(`console errors:\n  ${errors.join('\n  ')}`)

  for (const r of rows) console.log(`  ${r.id.padEnd(24)} peak ${r.peak}`)
  console.log(`  ${'(residual after unmount)'.padEnd(24)} peak ${residual.toFixed(3)}`)
  console.log(`  ${'(jam: 2 channels)'.padEnd(24)} peak ${jamPeak.toFixed(3)}`)
  console.log(`  ${'(jam residual)'.padEnd(24)} peak ${jamResidual.toFixed(3)}`)
} finally {
  await browser?.close()
  server.kill('SIGTERM')
}

if (failures.length) {
  console.error('\nFAILED:\n- ' + failures.join('\n- '))
  process.exit(1)
}
console.log(`\nok — ${rows.length} sketches, no clipping, clean teardown`)
