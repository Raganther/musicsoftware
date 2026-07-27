/**
 * Sketch discovery.
 *
 * Anything at `sketches/<name>/index.ts` with a default export shows up in the
 * gallery. No registration file to edit — that friction is exactly what stops
 * a sandbox from being used.
 *
 * Because modules are imported eagerly for their metadata, sketches must have
 * no side effects at module scope. Do everything inside `setup`.
 */

import type { SketchDefinition, ParamMap } from './sketch'

const modules = import.meta.glob<{ default: SketchDefinition<ParamMap> }>(
  '/sketches/*/index.ts',
  { eager: true },
)

export interface SketchEntry {
  id: string
  def: SketchDefinition<ParamMap>
}

export const sketches: SketchEntry[] = Object.entries(modules)
  .map(([path, mod]) => {
    const id = path.replace(/^\/sketches\//, '').replace(/\/index\.ts$/, '')
    return { id, def: mod?.default }
  })
  .filter((e): e is SketchEntry => {
    if (!e.def || typeof e.def.setup !== 'function') {
      console.warn(`[registry] sketches/${e.id} has no valid default export, skipping`)
      return false
    }
    return true
  })
  .sort((a, b) => a.def.title.localeCompare(b.def.title))

export function findSketch(id: string): SketchEntry | undefined {
  return sketches.find((s) => s.id === id)
}

export const allTags: string[] = [
  ...new Set(sketches.flatMap((s) => s.def.tags ?? [])),
].sort()
