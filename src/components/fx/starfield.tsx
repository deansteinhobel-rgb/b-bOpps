"use client"

import { useEffect, useRef } from "react"

/**
 * A faint field of lime and white specks behind the app, like the website hero. Very low contrast,
 * slow twinkle and a slight drift with the cursor. Static when reduced motion is on.
 */
export function Starfield({ count = 70 }: { count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let w = 0
    let h = 0
    let raf = 0
    let last = 0
    const shift = { x: 0, y: 0, tx: 0, ty: 0 }
    const stars = Array.from({ length: count }, () => ({ x: Math.random(), y: Math.random(), r: 0.4 + Math.random() * 1.1, a: 0.08 + Math.random() * 0.25, lime: Math.random() < 0.6, depth: 0.3 + Math.random(), seed: Math.random() * 1000 }))

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const draw = (t: number) => {
      shift.x += (shift.tx - shift.x) * 0.04
      shift.y += (shift.ty - shift.y) * 0.04
      ctx.clearRect(0, 0, w, h)
      for (const s of stars) {
        const tw = reduced ? 1 : 0.55 + 0.45 * Math.sin(t / 1400 + s.seed)
        ctx.globalAlpha = s.a * tw
        ctx.fillStyle = s.lime ? "#e4ff1a" : "#ffffff"
        ctx.beginPath()
        ctx.arc(s.x * w + shift.x * s.depth, s.y * h + shift.y * s.depth, s.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    const loop = (t: number) => {
      // ~30fps is plenty for a background
      if (t - last > 33) {
        draw(t)
        last = t
      }
      if (!document.hidden) raf = requestAnimationFrame(loop)
    }
    const onMove = (e: PointerEvent) => {
      shift.tx = (e.clientX / w - 0.5) * -14
      shift.ty = (e.clientY / h - 0.5) * -14
    }
    const onVis = () => {
      if (!document.hidden && !reduced) raf = requestAnimationFrame(loop)
    }

    resize()
    if (reduced) draw(0)
    else raf = requestAnimationFrame(loop)
    window.addEventListener("resize", resize)
    if (!reduced) window.addEventListener("pointermove", onMove)
    document.addEventListener("visibilitychange", onVis)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
      window.removeEventListener("pointermove", onMove)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [count])

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />
}
