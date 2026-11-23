'use client'

import { useEffect, useRef } from 'react'
import { clamp, fmtTime, noteName } from '@/lib/music'
import { PAL, fitCanvas, monoFamily } from './canvas-utils'
import { useFrame, useStudio } from './studio-provider'

const PAD_X = 10
const PAD_Y = 10

export function OverviewCanvas() {
  const { a, live, d } = useStudio()
  const ref = useRef<HTMLCanvasElement>(null)
  const dragging = useRef<{ wasPlaying: boolean } | null>(null)
  const mono = useRef('')
  const summaryRef = useRef(d.summary)
  summaryRef.current = d.summary

  useFrame(() => {
    const canvas = ref.current
    if (!canvas) return
    const box = fitCanvas(canvas)
    if (!box) return
    const { ctx, w, h } = box
    if (!mono.current) mono.current = monoFamily(canvas)
    const dur = live.duration || 1
    const innerW = w - PAD_X * 2
    const shift = live.shift
    const sum = summaryRef.current
    const lo = (sum ? sum.low.midi : 50) + shift - 1
    const hi = (sum ? sum.high.midi : 72) + shift + 1
    const X = (t: number) => PAD_X + (t / dur) * innerW
    const Y = (m: number) => PAD_Y + (1 - (m - lo) / (hi - lo)) * (h - PAD_Y * 2)

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = PAL.stage
    ctx.fillRect(0, 0, w, h)

    const yHi = Y(live.userRange.high)
    const yLo = Y(live.userRange.low)
    ctx.fillStyle = PAL.rangeFill
    ctx.fillRect(PAD_X, clamp(yHi, 0, h), innerW, clamp(yLo, 0, h) - clamp(yHi, 0, h))

    const t = live.time
    for (const n of live.notes) {
      const m = n.midi + shift
      const out = m > live.userRange.high + 0.5 || m < live.userRange.low - 0.5
      const past = n.start + n.dur < t
      ctx.fillStyle = out ? PAL.miss : PAL.ice
      ctx.globalAlpha = past ? 0.32 : 0.85
      ctx.fillRect(X(n.start), Y(m) - 1.5, Math.max(1.5, (n.dur / dur) * innerW), 3)
    }
    ctx.globalAlpha = 1

    if (sum) {
      ctx.font = `600 9px ${mono.current}`
      ctx.textBaseline = 'middle'
      for (const [p, label] of [
        [sum.high, '최고'],
        [sum.low, '최저'],
      ] as const) {
        const px = X(p.time)
        const py = Y(p.midi + shift)
        ctx.strokeStyle = PAL.caution
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(px, py, 4, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = PAL.caution
        ctx.textAlign = px > w - 60 ? 'right' : 'left'
        ctx.fillText(`${label} ${noteName(p.midi + shift, live.notation)}`, px + (px > w - 60 ? -8 : 8), py + (label === '최고' ? -1 : 1))
      }
    }

    const half = live.windowSec / 2
    const vx0 = X(clamp(t - live.windowSec * 0.27, 0, dur))
    const vx1 = X(clamp(t + live.windowSec * 0.73, 0, dur))
    ctx.fillStyle = 'oklch(1 0 0 / 0.07)'
    ctx.fillRect(vx0, 2, vx1 - vx0, h - 4)
    ctx.strokeStyle = 'oklch(1 0 0 / 0.35)'
    ctx.lineWidth = 1
    ctx.strokeRect(vx0 + 0.5, 2.5, vx1 - vx0 - 1, h - 5)
    void half

    ctx.fillStyle = PAL.text
    ctx.fillRect(X(clamp(t, 0, dur)) - 1, 0, 2, h)

    ctx.fillStyle = PAL.textFaint
    ctx.font = `500 9px ${mono.current}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillText(fmtTime(0), PAD_X, h - 1)
    ctx.textAlign = 'right'
    ctx.fillText(fmtTime(dur), w - PAD_X, h - 1)
  })

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const toTime = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      return clamp(((e.clientX - r.left - PAD_X) / (r.width - PAD_X * 2)) * live.duration, 0, live.duration)
    }
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId)
      const wasPlaying = live.playing
      if (wasPlaying) a.pause()
      dragging.current = { wasPlaying }
      a.seek(toTime(e))
    }
    const move = (e: PointerEvent) => {
      if (dragging.current) a.seek(toTime(e))
    }
    const up = () => {
      const d0 = dragging.current
      dragging.current = null
      if (d0?.wasPlaying) void a.play()
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
    }
  }, [a, live])

  return <canvas ref={ref} role="img" aria-label="전체 곡 미리보기. 클릭하거나 드래그해서 재생 위치를 옮깁니다." className="block h-full w-full cursor-pointer touch-none rounded-lg" />
}
