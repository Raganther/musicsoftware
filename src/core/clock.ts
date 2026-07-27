/**
 * Transport + lookahead scheduler.
 *
 * Timing rule for the whole repo: **never sequence with setInterval alone.**
 * A JS timer wakes us up periodically; we then schedule notes into the future
 * using AudioContext time, which is sample-accurate. The timer only has to be
 * roughly on time. (Chris Wilson, "A Tale of Two Clocks".)
 *
 * There is one global transport shared by every sketch, so play/stop and BPM
 * behave the same everywhere and sketches are directly comparable.
 */

import { audio } from './audio'

export interface StepEvent {
  /** Monotonic step index since start. */
  step: number
  /** AudioContext time this step should sound. Schedule against this, not currentTime. */
  time: number
  /** Bar number, 0-based (assumes 4/4 by default). */
  bar: number
  /** Beat within the bar, 0-based. */
  beat: number
  /** Step within the beat, 0-based. */
  tick: number
  /** Seconds per step at the moment it was scheduled. */
  dur: number
}

type StepHandler = (e: StepEvent) => void

export class Clock {
  /** Beats per minute. */
  bpm = 110
  /** Steps per beat. 4 = sixteenth notes, 6 = sixteenth triplets, 1 = quarters. */
  division = 4
  /** Beats per bar. */
  beatsPerBar = 4
  /** 0 = straight, 0.5 = hard swing. Delays every other step. */
  swing = 0

  /** How far ahead we schedule, in seconds. */
  scheduleAhead = 0.12
  /** How often the JS timer wakes up, in ms. */
  private interval = 25

  private timer: ReturnType<typeof setInterval> | null = null
  private handlers = new Set<StepHandler>()
  private nextTime = 0
  private step = 0
  private queue: Array<{ step: number; time: number }> = []
  private drawnStep = -1

  get running(): boolean {
    return this.timer !== null
  }

  get secondsPerBeat(): number {
    return 60 / this.bpm
  }

  get stepDur(): number {
    return this.secondsPerBeat / this.division
  }

  /** Steps in one bar at the current division. */
  get stepsPerBar(): number {
    return this.division * this.beatsPerBar
  }

  start() {
    if (this.running) return
    const { ctx } = audio()
    // Small offset so the first step isn't scheduled in the past.
    this.nextTime = ctx.currentTime + 0.06
    this.timer = setInterval(this.tick, this.interval)
    this.tick()
    this.emitState()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.queue.length = 0
    this.drawnStep = -1
    this.emitState()
  }

  /** Stop and rewind to step 0. */
  reset() {
    this.stop()
    this.step = 0
  }

  toggle() {
    this.running ? this.stop() : this.start()
  }

  /** Subscribe to scheduled steps. Returns an unsubscribe function. */
  onStep(fn: StepHandler): () => void {
    this.handlers.add(fn)
    return () => this.handlers.delete(fn)
  }

  /**
   * The step currently being *heard*, for drawing. Scheduling runs ahead of
   * the audible present; use this in render loops so visuals line up with ears.
   */
  get visualStep(): number {
    const { ctx } = audio()
    const now = ctx.currentTime
    while (this.queue.length && this.queue[0].time <= now) {
      this.drawnStep = this.queue.shift()!.step
    }
    return this.drawnStep
  }

  // -- transport state changes, for the UI ---------------------------------

  private stateHandlers = new Set<() => void>()
  onStateChange(fn: () => void): () => void {
    this.stateHandlers.add(fn)
    return () => this.stateHandlers.delete(fn)
  }
  private emitState() {
    this.stateHandlers.forEach((f) => f())
  }

  // -----------------------------------------------------------------------

  private tick = () => {
    const { ctx } = audio()
    const horizon = ctx.currentTime + this.scheduleAhead

    while (this.nextTime < horizon) {
      const dur = this.stepDur
      // Swing pushes odd steps later without moving the underlying grid.
      const swung = this.step % 2 === 1 ? this.nextTime + this.swing * dur : this.nextTime

      const spb = this.stepsPerBar
      const e: StepEvent = {
        step: this.step,
        time: swung,
        bar: Math.floor(this.step / spb),
        beat: Math.floor((this.step % spb) / this.division),
        tick: this.step % this.division,
        dur,
      }

      this.handlers.forEach((h) => {
        try {
          h(e)
        } catch (err) {
          console.error('[clock] handler threw', err)
        }
      })

      this.queue.push({ step: this.step, time: swung })
      this.nextTime += dur
      this.step++
    }
  }
}

/** The one global transport. */
export const clock = new Clock()
