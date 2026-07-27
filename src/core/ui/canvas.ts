/**
 * A DPI-correct canvas with a render loop that cleans itself up.
 * Handles the resize + devicePixelRatio dance so sketches don't have to.
 */

export interface DrawInfo {
  /** Logical width in CSS pixels. */
  w: number
  /** Logical height in CSS pixels. */
  h: number
  /** Seconds since the loop started. */
  t: number
  /** Seconds since the previous frame. */
  dt: number
  frame: number
}

export interface CanvasHandle {
  el: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  stop(): void
}

export function canvas(
  parent: HTMLElement,
  draw: (g: CanvasRenderingContext2D, info: DrawInfo) => void,
): CanvasHandle {
  const el = document.createElement('canvas')
  el.className = 'sketch-canvas'
  parent.appendChild(el)

  const g = el.getContext('2d')!
  let w = 0
  let h = 0
  let raf = 0
  let frame = 0
  const start = performance.now()
  let last = start

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const rect = parent.getBoundingClientRect()
    w = Math.max(1, Math.floor(rect.width))
    h = Math.max(1, Math.floor(rect.height))
    el.width = Math.floor(w * dpr)
    el.height = Math.floor(h * dpr)
    el.style.width = `${w}px`
    el.style.height = `${h}px`
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  const ro = new ResizeObserver(resize)
  ro.observe(parent)
  resize()

  const loop = (now: number) => {
    raf = requestAnimationFrame(loop)
    const dt = (now - last) / 1000
    last = now
    g.clearRect(0, 0, w, h)
    try {
      draw(g, { w, h, t: (now - start) / 1000, dt, frame: frame++ })
    } catch (err) {
      cancelAnimationFrame(raf)
      console.error('[canvas] draw threw, loop stopped', err)
    }
  }
  raf = requestAnimationFrame(loop)

  return {
    el,
    ctx: g,
    stop() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      el.remove()
    },
  }
}

// -- small drawing helpers ---------------------------------------------------

/** Read a CSS custom property from :root, e.g. cssVar('--accent'). */
export function cssVar(name: string, fallback = '#fff'): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2)
  g.beginPath()
  g.moveTo(x + radius, y)
  g.arcTo(x + w, y, x + w, y + h, radius)
  g.arcTo(x + w, y + h, x, y + h, radius)
  g.arcTo(x, y + h, x, y, radius)
  g.arcTo(x, y, x + w, y, radius)
  g.closePath()
}
