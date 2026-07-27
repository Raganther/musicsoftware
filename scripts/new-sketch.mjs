#!/usr/bin/env node
/**
 * Scaffold a new sketch:  npm run new my-idea
 *
 * Creates sketches/<name>/index.ts from a template. The gallery picks it up
 * automatically — there is no registry to edit.
 */

import { mkdir, writeFile, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const raw = process.argv[2]
if (!raw) {
  console.error('usage: npm run new <sketch-name>   e.g. npm run new tape-loops')
  process.exit(1)
}

const id = raw
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')

if (!id) {
  console.error(`"${raw}" doesn't reduce to a usable folder name`)
  process.exit(1)
}

const title = id
  .split('-')
  .map((w) => w[0].toUpperCase() + w.slice(1))
  .join(' ')

const dir = join(root, 'sketches', id)
const file = join(dir, 'index.ts')

if (await access(file).then(() => true).catch(() => false)) {
  console.error(`sketches/${id}/index.ts already exists`)
  process.exit(1)
}

const template = `import { blip, degree, rng, SCALE_NAMES, type ScaleName } from '@core'
import { defineSketch } from '@runtime/sketch'

export default defineSketch({
  title: '${title}',
  description: 'TODO: one line on what this is exploring.',
  tags: ['sketch'],
  status: 'sketch',
  bpm: 110,

  params: {
    root: { type: 'number', value: 48, min: 24, max: 72, step: 1, label: 'Root (MIDI)' },
    scale: { type: 'select', value: 'pentatonicMinor', options: SCALE_NAMES },
    density: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.01 },
  },

  notes: \`
What question is this sketch asking?
What did you learn? What would you try next?
\`,

  setup(ctx) {
    const r = rng(1)

    // Called once per step, ahead of time. Schedule against e.time — never
    // ctx.audio.currentTime — or the timing will drift.
    ctx.clock.onStep((e) => {
      if (!r.chance(ctx.params.density)) return
      const note = degree(
        Math.round(ctx.params.root),
        ctx.params.scale as ScaleName,
        r.int(0, 7),
      )
      blip(ctx.out, note, e.time, e.dur * 1.5)
    })

    ctx.canvas((g, { w, h }) => {
      const step = ctx.clock.running ? ctx.clock.visualStep : -1
      const cols = 16
      const cw = w / cols
      for (let i = 0; i < cols; i++) {
        g.fillStyle = i === (step % cols) ? '#7dd3fc' : 'rgba(255,255,255,0.05)'
        g.fillRect(i * cw + 2, h / 2 - 20, cw - 4, 40)
      }
    })

    ctx.status('press space to start the transport')
  },
})
`

await mkdir(dir, { recursive: true })
await writeFile(file, template, 'utf8')

console.log(`created sketches/${id}/index.ts`)
console.log(`open   http://localhost:5173/#/${id}`)
