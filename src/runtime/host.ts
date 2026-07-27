/**
 * Mounts one sketch and guarantees it goes away cleanly.
 *
 * Every sketch gets its own output bus, so teardown is a single disconnect —
 * no orphaned oscillators droning under the next sketch you open.
 */

import { audio } from '@core/audio'
import { clock } from '@core/clock'
import { canvas as makeCanvas } from '@core/ui/canvas'
import type { DrawInfo } from '@core/ui/canvas'
import { ParamStore, renderPanel } from './params'
import type { SketchEntry } from './registry'
import type { ParamMap, SketchContext } from './sketch'

export interface MountTargets {
  stage: HTMLElement
  panel: HTMLElement
  status: (text: string) => void
}

export interface MountedSketch {
  entry: SketchEntry
  store: ParamStore
  unmount(): void
}

export function mountSketch(entry: SketchEntry, targets: MountTargets): MountedSketch {
  const { ctx, master } = audio()
  const def = entry.def

  const out = ctx.createGain()
  out.gain.value = 1
  out.connect(master)

  const store = new ParamStore(entry.id, def.params ?? {})
  const disposers: Array<() => void> = []
  let disposed = false

  targets.stage.innerHTML = ''
  const disposePanel = renderPanel(targets.panel, store)

  if (def.bpm) clock.bpm = def.bpm
  clock.division = def.division ?? 4

  const sketchCtx: SketchContext<ParamMap> = {
    audio: ctx,
    out,
    clock,
    params: store.view(),
    set: (key, value) => store.set(key as string, value),
    onParam: (key, fn) => disposers.push(store.onChange(key as string, fn as never)),
    onPress: (key, fn) => disposers.push(store.onPress(key, fn)),
    root: targets.stage,
    canvas(draw: (g: CanvasRenderingContext2D, info: DrawInfo) => void, parent?: HTMLElement) {
      const handle = makeCanvas(parent ?? targets.stage, draw)
      disposers.push(() => handle.stop())
      return handle.ctx
    },
    cleanup: (fn) => disposers.push(fn),
    status: targets.status,
  }

  // Wrap clock.onStep so a sketch can never leak a transport subscription.
  const originalOnStep = clock.onStep.bind(clock)
  sketchCtx.clock = new Proxy(clock, {
    get(target, prop, receiver) {
      if (prop === 'onStep') {
        return (fn: Parameters<typeof originalOnStep>[0]) => {
          const off = originalOnStep(fn)
          disposers.push(off)
          return off
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value)
    },
  }) as typeof clock

  const result = def.setup(sketchCtx)

  const finish = (teardown: void | (() => void)) => {
    if (disposed) {
      // Sketch was swapped out before its async setup resolved.
      teardown?.()
      return
    }
    if (teardown) disposers.push(teardown)
  }

  if (result instanceof Promise) {
    result.then(finish).catch((err) => {
      console.error(`[host] ${entry.id} setup failed`, err)
      targets.status(`setup failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  } else {
    finish(result)
  }

  return {
    entry,
    store,
    unmount() {
      if (disposed) return
      disposed = true
      for (const d of disposers.reverse()) {
        try {
          d()
        } catch (err) {
          console.error(`[host] cleanup threw in ${entry.id}`, err)
        }
      }
      disposePanel()
      // Short fade avoids a click when a voice is still ringing.
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.01)
      setTimeout(() => out.disconnect(), 120)
      targets.stage.innerHTML = ''
      targets.panel.innerHTML = ''
    },
  }
}
