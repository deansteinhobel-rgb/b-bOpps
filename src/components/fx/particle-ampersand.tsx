"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

type P = { hx: number; hy: number; x: number; y: number; vx: number; vy: number; r: number; a: number; seed: number }

/**
 * The B&B homepage "&": lime dots that form an ampersand, scatter away from the cursor and drift
 * back. Pauses when off screen or the tab is hidden; a still image for reduced motion.
 */
export function ParticleAmpersand({ className, density = 1, glyph = "&" }: { className?: string; density?: number; glyph?: string }) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const box = wrap.current
    if (!canvas || !box) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let particles: P[] = []
    let w = 0
    let h = 0
    let raf = 0
    let visible = true
    const mouse = { x: -9999, y: -9999 }

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = box.clientWidth
      h = box.clientHeight
      particles = []
      // Hidden or not laid out yet (e.g. display:none on small screens): nothing to draw.
      if (w === 0 || h === 0) return
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // Draw the glyph off screen and sample its pixels as particle homes.
      const off = document.createElement("canvas")
      off.width = w
      off.height = h
      const o = off.getContext("2d")!
      const size = Math.min(h * 0.95, w * 1.05)
      o.fillStyle = "#fff"
      o.textAlign = "center"
      o.textBaseline = "middle"
      o.font = `700 ${size}px Georgia, "Times New Roman", serif`
      o.fillText(glyph, w / 2, h / 2 + size * 0.04)
      const data = o.getImageData(0, 0, w, h).data
      // Dense, like the website's ampersand: roughly 5-9k dots at hero size.
      const gap = Math.max(2, Math.round(Math.sqrt((w * h) / (11000 * density))))
      particles = []
      for (let y = 0; y < h; y += gap) {
        for (let x = 0; x < w; x += gap) {
          if (data[(y * w + x) * 4 + 3] > 128) {
            const hx = x + (Math.random() - 0.5) * gap
            const hy = y + (Math.random() - 0.5) * gap
            particles.push({ hx, hy, x: hx + (Math.random() - 0.5) * 40, y: hy + (Math.random() - 0.5) * 40, vx: 0, vy: 0, r: 0.4 + Math.random() * 1.5, a: 0.3 + Math.random() * 0.7, seed: Math.random() * 1000 })
          }
        }
      }
    }

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h)
      for (const p of particles) {
        if (!reduced) {
          const dx = p.x - mouse.x
          const dy = p.y - mouse.y
          const d2 = dx * dx + dy * dy
          const R = 90
          if (d2 < R * R) {
            const d = Math.sqrt(d2) || 1
            const f = (1 - d / R) * 3.2
            p.vx += (dx / d) * f
            p.vy += (dy / d) * f
          }
          p.vx += (p.hx + Math.sin(t / 900 + p.seed) * 1.2 - p.x) * 0.035
          p.vy += (p.hy + Math.cos(t / 1100 + p.seed) * 1.2 - p.y) * 0.035
          p.vx *= 0.86
          p.vy *= 0.86
          p.x += p.vx
          p.y += p.vy
        }
        const twinkle = reduced ? 1 : 0.75 + 0.25 * Math.sin(t / 400 + p.seed)
        ctx.globalAlpha = p.a * twinkle
        ctx.fillStyle = "#e4ff1a"
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    const loop = (t: number) => {
      draw(t)
      if (visible && !document.hidden) raf = requestAnimationFrame(loop)
    }
    const start = () => {
      cancelAnimationFrame(raf)
      if (reduced) {
        for (const p of particles) {
          p.x = p.hx
          p.y = p.hy
        }
        draw(0)
      } else raf = requestAnimationFrame(loop)
    }

    build()
    start()
    const ro = new ResizeObserver(() => {
      build()
      start()
    })
    ro.observe(box)
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      if (visible) start()
    })
    io.observe(box)
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      mouse.x = e.clientX - r.left
      mouse.y = e.clientY - r.top
    }
    const onLeave = () => {
      mouse.x = -9999
      mouse.y = -9999
    }
    const onVis = () => !document.hidden && start()
    window.addEventListener("pointermove", onMove)
    box.addEventListener("pointerleave", onLeave)
    document.addEventListener("visibilitychange", onVis)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      window.removeEventListener("pointermove", onMove)
      box.removeEventListener("pointerleave", onLeave)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [density, glyph])

  return (
    <div ref={wrap} className={cn("relative", className)} aria-hidden>
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  )
}
