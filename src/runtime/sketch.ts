/**
 * The sketch contract.
 *
 * A sketch declares its params and gets a context with audio, transport, a
 * DOM root and live param values. Everything it creates is torn down for it.
 */

import type { Clock } from '@core/clock'
import type { DrawInfo } from '@core/ui/canvas'

// -- params -----------------------------------------------------------------

export interface NumberParam {
  type: 'number'
  value: number
  min?: number
  max?: number
  step?: number
  label?: string
  unit?: string
}

export interface ToggleParam {
  type: 'toggle'
  value: boolean
  label?: string
}

export interface SelectParam {
  type: 'select'
  value: string
  options: readonly string[]
  label?: string
}

/** A momentary action — no value, fires a callback. */
export interface ButtonParam {
  type: 'button'
  label?: string
}

export type ParamSpec = NumberParam | ToggleParam | SelectParam | ButtonParam
export type ParamMap = Record<string, ParamSpec>

export type ParamValues<P extends ParamMap> = {
  -readonly [K in keyof P as P[K] extends ButtonParam ? never : K]: P[K] extends NumberParam
    ? number
    : P[K] extends ToggleParam
      ? boolean
      : P[K] extends SelectParam
        ? string
        : never
}

// -- context ----------------------------------------------------------------

export interface SketchContext<P extends ParamMap = ParamMap> {
  /** The shared AudioContext. */
  audio: AudioContext
  /** This sketch's output bus. Connect everything here; it is disconnected on teardown. */
  out: GainNode
  /** The global transport. Subscriptions are removed on teardown. */
  clock: Clock

  /** Live param values — reading always gives the current value. */
  params: ParamValues<P>
  /** Set a param from code; the panel updates to match. */
  set<K extends keyof ParamValues<P>>(key: K, value: ParamValues<P>[K]): void
  /** React to a param change. */
  onParam<K extends keyof ParamValues<P>>(key: K, fn: (value: ParamValues<P>[K]) => void): void
  /** React to a `button` param being pressed. */
  onPress(key: keyof P & string, fn: () => void): void

  /** DOM element for the sketch's own UI. Emptied on teardown. */
  root: HTMLElement
  /**
   * A canvas with a render loop, stopped on teardown. Fills `root` by default;
   * pass a parent (which must be `position: relative`) to place it yourself.
   */
  canvas(
    draw: (g: CanvasRenderingContext2D, info: DrawInfo) => void,
    parent?: HTMLElement,
  ): CanvasRenderingContext2D

  /** Register any other cleanup. */
  cleanup(fn: () => void): void
  /** Show a short message in the status bar. */
  status(text: string): void
}

// -- definition -------------------------------------------------------------

export interface SketchDefinition<P extends ParamMap = ParamMap> {
  title: string
  /** One line: what this explores. Shown in the gallery. */
  description?: string
  /** Free-form. Used for filtering — e.g. 'sequencer', 'generative', 'dsp'. */
  tags?: readonly string[]
  /** Rough state, so you can tell a spike from something worth developing. */
  status?: 'sketch' | 'promising' | 'parked' | 'graduated'
  params?: P
  /** Suggested tempo. Applied to the transport when the sketch loads. */
  bpm?: number
  /** Steps per beat this sketch wants. 4 = 16ths (default), 6 = triplets. */
  division?: number
  /** Longer notes — findings, references, what to try next. Markdown-ish. */
  notes?: string
  setup(ctx: SketchContext<P>): void | (() => void) | Promise<void | (() => void)>
}

/** Identity function that pins the param types for `ctx.params`. */
export function defineSketch<P extends ParamMap>(def: SketchDefinition<P>): SketchDefinition<P> {
  return def
}
