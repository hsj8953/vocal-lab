'use client'

import { useEffect, useRef } from 'react'
import * as engine from '@/lib/engine'
import type { Note, Tier } from '@/lib/engine'
import { clamp, isBlackKey, laneLabel, noteName } from '@/lib/music'
import { PAL, SANS, TIER_COLOR, fitCanvas, monoFamily, pill } from './canvas-utils'
import { useFrame, useStudio } from './studio-provider'

const GUTTER = 56
const TOP = 30
const BOTTOM = 16
const HEAD_RATIO = 0.27
const SNAP = 50

interface Geo {
  w: number
  h: number
  headX: number
  pxs: number
  rowH: number
  hiV: number
  noteH: number
}

type Drag =
  | { type: 'scrub'; x0: number; t0: number; wasPlaying: boolean; moved: boolean }
  | { type: 'move'; x0: number; y0: number; orig: Note[]; ids: Set<string>; started: boolean }
  | { type: 'resize'; edge: 'l' | 'r'; orig: Note; started: boolean }
  | { type: 'add'; t0: number; midi: number; t1: number }

export function StageCanvas() {
  const { s, a, live } = useStudio()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bpmRef = useRef(s.project.bpm)
  bpmRef.current = s.project.bpm
  const measureRef = useRef(s.measure.step)
  measureRef.current = s.measure.step

  const view = useRef({ windowSec: 9, lo: 44, hi: 74, ready: false, lock: false, mono: '' })
  const geo = useRef<Geo>({ w: 0, h: 0, headX: 0, pxs: 100, rowH: 12, hiV: 74.5, noteH: 10 })
  const drag = useRef<Drag | null>(null)
  const hover = useRef<{ x: number; y: number } | null>(null)

  useFrame(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const box = fitCanvas(canvas)
    if (!box) return
    const { ctx, w, h } = box
    const v = view.current
    if (!v.mono) v.mono = monoFamily(canvas)
    const mono = v.mono
    const t = live.time
    const shift = live.shift
    const notes = live.notes
    const user = live.userRange
    canvas.style.touchAction = live.edit ? 'none' : 'pan-y'
    live.windowSec = v.windowSec

    /* 세로 범위 (곡 + 내 음역) — 키를 바꾸면 부드럽게 이동 */
    if (!v.lock) {
      let mn = Infinity
      let mx = -Infinity
      for (const n of notes) {
        const m = n.midi + shift
        if (m < mn) mn = m
        if (m > mx) mx = m
      }
      if (!notes.length) {
        mn = 55
        mx = 72
      }
      let lo = Math.floor(Math.min(mn, user.low) - 2.5)
      let hi = Math.ceil(Math.max(mx, user.high) + 2.5)
      if (hi - lo < 16) {
        const c = (hi + lo) / 2
        lo = Math.floor(c - 8)
        hi = Math.ceil(c + 8)
      }
      if (!v.ready) {
        v.lo = lo
        v.hi = hi
        v.ready = true
      } else {
        v.lo += (lo - v.lo) * 0.16
        v.hi += (hi - v.hi) * 0.16
      }
    }

    const rows = v.hi - v.lo + 1
    const rowH = (h - TOP - BOTTOM) / rows
    const headX = GUTTER + (w - GUTTER) * HEAD_RATIO
    const pxs = (w - GUTTER) / v.windowSec
    const noteH = clamp(rowH * 0.76, 7, 24)
    const g: Geo = { w, h, headX, pxs, rowH, hiV: v.hi + 0.5, noteH }
    geo.current = g
    const y = (m: number) => TOP + (g.hiV - m) * rowH
    const x = (tt: number) => headX + (tt - t) * pxs

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = PAL.stage
    ctx.fillRect(0, 0, w, h)

    /* 레인 */
    const mLo = Math.ceil(v.lo - 0.5)
    const mHi = Math.floor(v.hi + 0.5)
    for (let m = mLo; m <= mHi; m++) {
      const yc = y(m)
      if (isBlackKey(m)) {
        ctx.fillStyle = PAL.laneBlack
        ctx.fillRect(GUTTER, yc - rowH / 2, w - GUTTER, rowH)
      }
      ctx.fillStyle = m % 12 === 0 ? PAL.laneC : PAL.laneLine
      ctx.fillRect(GUTTER, yc + rowH / 2 - 0.5, w - GUTTER, 1)
    }

    /* 내 음역 밴드 */
    const yHi = y(user.high)
    const yLo = y(user.low)
    ctx.fillStyle = PAL.outFill
    ctx.fillRect(GUTTER, TOP - 6, w - GUTTER, Math.max(0, yHi - (TOP - 6)))
    ctx.fillRect(GUTTER, yLo, w - GUTTER, Math.max(0, h - BOTTOM + 6 - yLo))
    ctx.fillStyle = PAL.rangeFill
    ctx.fillRect(GUTTER, yHi, w - GUTTER, yLo - yHi)
    ctx.save()
    ctx.setLineDash([5, 5])
    ctx.strokeStyle = 'oklch(0.82 0.125 205 / 0.55)'
    ctx.lineWidth = 1
    for (const yy of [yHi, yLo]) {
      ctx.beginPath()
      ctx.moveTo(GUTTER, yy)
      ctx.lineTo(w, yy)
      ctx.stroke()
    }
    ctx.restore()
    ctx.font = `600 10px ${mono}`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = PAL.voice
    ctx.fillText(`내 최고음 ${noteName(user.high, live.notation)}`, w - 10, yHi - 4)
    ctx.textBaseline = 'top'
    ctx.fillText(`내 최저음 ${noteName(user.low, live.notation)}`, w - 10, yLo + 4)

    /* 작업 영역 클립 */
    ctx.save()
    ctx.beginPath()
    ctx.rect(GUTTER, 0, w - GUTTER, h)
    ctx.clip()

    /* 마디선 */
    const barSec = 240 / bpmRef.current
    const tL = t - (headX - GUTTER) / pxs
    const tR = t + (w - headX) / pxs
    ctx.fillStyle = PAL.barLine
    for (let b = Math.ceil(tL / barSec); b * barSec < tR; b++) {
      if (b < 0) continue
      ctx.fillRect(x(b * barSec), TOP - 8, 1, h - TOP - BOTTOM + 8)
    }

    /* 곡 최고음 / 곧 나올 최고음 */
    let songHigh = -Infinity
    for (const n of notes) songHigh = Math.max(songHigh, n.midi + shift)
    const peak = engine.upcomingPeak(notes, t, v.windowSec * (1 - HEAD_RATIO))
    const peakShown = peak ? peak.midi + shift : -Infinity
    const peakWorthy = !!peak && peak.start > t && (peakShown >= songHigh - 1.5 || peakShown > user.high - 0.5)

    /* 노트 */
    ctx.font = `700 12px ${SANS}`
    ctx.textBaseline = 'middle'
    for (const n of notes) {
      const x1 = x(n.start)
      const nw = n.dur * pxs
      if (x1 > w + 4 || x1 + nw < GUTTER - 4) continue
      const shown = n.midi + shift
      const yc = y(shown)
      const isPast = n.start + n.dur < t
      const isNow = n.start <= t && t < n.start + n.dur
      const outside = shown > user.high + 0.5 || shown < user.low - 0.5
      const selected = live.selection.has(n.id)
      const sc = live.noteScore.get(n.id)

      let fill: string = outside ? PAL.missTint : PAL.ice
      if (isPast) {
        if (sc) {
          const tier: Tier = sc[0] >= sc[1] + sc[2] ? 'great' : sc[2] > sc[1] ? 'off' : 'ok'
          fill = TIER_COLOR[tier]
        } else fill = PAL.iceDim
      }
      ctx.save()
      if (isNow) {
        ctx.shadowColor = outside ? PAL.miss : 'oklch(0.93 0.02 235 / 0.9)'
        ctx.shadowBlur = 16
      }
      ctx.globalAlpha = isPast ? (sc ? 0.7 : 1) : 1
      ctx.fillStyle = fill
      pill(ctx, x1, yc - noteH / 2, Math.max(nw, 4), noteH)
      ctx.fill()
      ctx.restore()

      if (selected) {
        ctx.strokeStyle = PAL.text
        ctx.lineWidth = 2
        pill(ctx, x1 - 1, yc - noteH / 2 - 1, Math.max(nw, 4) + 2, noteH + 2)
        ctx.stroke()
      }
      if (live.edit && nw > 14) {
        ctx.fillStyle = selected ? PAL.text : 'oklch(0.2 0.03 252 / 0.35)'
        ctx.fillRect(x1 + 2, yc - noteH / 4, 2, noteH / 2)
        ctx.fillRect(x1 + nw - 4, yc - noteH / 4, 2, noteH / 2)
      }

      if (n.lyric) {
        ctx.textAlign = 'center'
        const tw = ctx.measureText(n.lyric).width
        if (nw >= tw + 10 && noteH >= 14) {
          ctx.fillStyle = isPast && !sc ? PAL.textDim : PAL.ink
          ctx.fillText(n.lyric, x1 + nw / 2, yc + 0.5)
        } else {
          ctx.fillStyle = isNow ? PAL.text : isPast ? PAL.textFaint : PAL.textDim
          ctx.textAlign = 'left'
          ctx.fillText(n.lyric, x1, yc + noteH / 2 + 10)
        }
      }

      if (peakWorthy && n.id === peak!.id) {
        const over = shown > user.high + 0.5
        ctx.strokeStyle = over ? PAL.miss : PAL.caution
        ctx.lineWidth = 2
        ctx.setLineDash([])
        pill(ctx, x1 - 5, yc - noteH / 2 - 5, Math.max(nw, 4) + 10, noteH + 10)
        ctx.stroke()
        ctx.font = `600 11px ${mono}`
        ctx.textAlign = 'left'
        ctx.fillStyle = over ? PAL.miss : PAL.caution
        ctx.fillText(`▲ ${noteName(shown, live.notation)}`, x1, yc - noteH / 2 - 14)
        ctx.font = `700 12px ${SANS}`
      }
    }

    /* 추가 도구 미리보기 */
    const dg = drag.current
    if (dg?.type === 'add') {
      const a0 = Math.min(dg.t0, dg.t1)
      const a1 = Math.max(dg.t0, dg.t1)
      ctx.globalAlpha = 0.6
      ctx.fillStyle = PAL.voice
      pill(ctx, x(a0), y(dg.midi) - noteH / 2, Math.max((a1 - a0) * pxs, 6), noteH)
      ctx.fill()
      ctx.globalAlpha = 1
    }
    if (live.edit && live.tool === 'cut' && hover.current && !dg) {
      ctx.fillStyle = PAL.caution
      ctx.fillRect(hover.current.x - 0.5, TOP - 8, 1, h - TOP - BOTTOM + 8)
    }

    /* 내 목소리 궤적 */
    const tr = live.trace
    ctx.lineWidth = 3.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    let seg: { tier: Tier | null; pts: [number, number][] } | null = null
    const flush = () => {
      if (!seg || seg.pts.length === 0) return
      const col = seg.tier ? TIER_COLOR[seg.tier] : 'oklch(0.82 0.125 205 / 0.55)'
      ctx.strokeStyle = col
      ctx.shadowColor = col
      ctx.shadowBlur = seg.tier ? 10 : 0
      ctx.beginPath()
      seg.pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)))
      if (seg.pts.length === 1) ctx.lineTo(seg.pts[0][0] + 0.1, seg.pts[0][1])
      ctx.stroke()
      ctx.shadowBlur = 0
    }
    let prev: { t: number; midi: number | null } | null = null
    for (let i = Math.max(0, tr.length - 2400); i < tr.length; i++) {
      const p = tr[i]
      if (p.t < tL - 0.2) continue
      if (p.t > t + 0.3) break
      if (p.midi === null) {
        flush()
        seg = null
        prev = null
        continue
      }
      const pt: [number, number] = [x(p.t), y(p.midi)]
      const broken = !prev || p.t - prev.t > 0.18 || !seg || seg.tier !== p.tier
      if (broken) {
        const joinFrom: [number, number] | null = seg && prev && p.t - prev.t <= 0.18 ? seg.pts[seg.pts.length - 1] : null
        flush()
        seg = { tier: p.tier, pts: joinFrom ? [joinFrom, pt] : [pt] }
      } else seg!.pts.push(pt)
      prev = { t: p.t, midi: p.midi }
    }
    flush()

    ctx.restore()

    /* 재생 헤드 */
    ctx.fillStyle = 'oklch(0.955 0.012 240 / 0.55)'
    ctx.fillRect(headX - 0.5, TOP - 12, 1, h - TOP - BOTTOM + 12)
    ctx.beginPath()
    ctx.moveTo(headX - 5, TOP - 14)
    ctx.lineTo(headX + 5, TOP - 14)
    ctx.lineTo(headX, TOP - 7)
    ctx.closePath()
    ctx.fillStyle = PAL.text
    ctx.fill()

    /* 내 음 (헤드 위의 구슬) */
    if (live.micOn && live.pitchMidi !== null) {
      const pm = live.pitchMidi
      const py = clamp(y(pm), TOP, h - BOTTOM)
      const col = live.cmp ? TIER_COLOR[live.cmp.tier] : PAL.voice
      ctx.shadowColor = col
      ctx.shadowBlur = 18
      ctx.fillStyle = col
      ctx.beginPath()
      ctx.arc(headX, py, 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.strokeStyle = PAL.stage
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.font = `600 11px ${mono}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = col
      ctx.fillText(noteName(pm, live.notation), headX + 14, py)
    }

    /* 건반 거터 */
    ctx.fillStyle = PAL.gutter
    ctx.fillRect(0, 0, GUTTER, h)
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let m = mLo; m <= mHi; m++) {
      const yc = y(m)
      const black = isBlackKey(m)
      ctx.fillStyle = black ? 'oklch(0.12 0.03 254)' : 'oklch(0.93 0.02 235 / 0.1)'
      ctx.fillRect(GUTTER - 7, yc - rowH / 2 + 0.5, 7, rowH - 1)
      const lb = laneLabel(m, live.notation)
      if (lb && (rowH >= 11 || m % 12 === 0)) {
        ctx.font = `${m % 12 === 0 ? 600 : 500} 10px ${live.notation === 'korean' ? SANS : mono}`
        ctx.fillStyle = m % 12 === 0 ? PAL.text : PAL.textFaint
        ctx.fillText(lb, GUTTER - 12, yc)
      }
    }
    ctx.fillStyle = 'oklch(1 0 0 / 0.08)'
    ctx.fillRect(GUTTER - 0.5, 0, 1, h)

    /* 빈 상태 */
    if (!notes.length) {
      ctx.textAlign = 'center'
      ctx.fillStyle = PAL.textDim
      ctx.font = `600 14px ${SANS}`
      ctx.fillText('감지된 노트가 없어요. 감도를 올려 다시 분석해 보세요.', GUTTER + (w - GUTTER) / 2, h / 2)
    }
  })

  /* ---------- 포인터 ---------- */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const tAt = (px: number) => live.time + (px - geo.current.headX) / geo.current.pxs
    const midiAt = (py: number) => Math.round(geo.current.hiV - (py - TOP) / geo.current.rowH)
    const snap = (tt: number) => Math.round(tt * SNAP) / SNAP

    const hit = (px: number, py: number): { note: Note; part: 'body' | 'l' | 'r' } | null => {
      const gg = geo.current
      if (px < GUTTER) return null
      for (let i = live.notes.length - 1; i >= 0; i--) {
        const n = live.notes[i]
        const x1 = gg.headX + (n.start - live.time) * gg.pxs
        const nw = Math.max(n.dur * gg.pxs, 4)
        const yc = TOP + (gg.hiV - (n.midi + live.shift)) * gg.rowH
        const half = Math.max(gg.noteH / 2, 8)
        if (px >= x1 - 4 && px <= x1 + nw + 4 && Math.abs(py - yc) <= half) {
          const edge = Math.min(8, nw / 3)
          if (px <= x1 + edge) return { note: n, part: 'l' }
          if (px >= x1 + nw - edge) return { note: n, part: 'r' }
          return { note: n, part: 'body' }
        }
      }
      return null
    }

    const onDown = (e: PointerEvent) => {
      const p = local(e)
      if (p.x < GUTTER) return
      canvas.setPointerCapture(e.pointerId)
      const edit = live.edit
      const h = edit ? hit(p.x, p.y) : null

      if (edit && live.tool === 'cut') {
        if (h) a.splitAt(h.note.id, snap(tAt(p.x)))
        return
      }
      if (edit && live.tool === 'add' && !h) {
        const tt = snap(tAt(p.x))
        view.current.lock = true
        drag.current = { type: 'add', t0: tt, midi: midiAt(p.y), t1: tt }
        return
      }
      if (h) {
        const already = live.selection.has(h.note.id)
        if (e.shiftKey) {
          const ids = new Set(live.selection)
          if (already) ids.delete(h.note.id)
          else ids.add(h.note.id)
          a.setSelection([...ids])
          if (already) return
        } else if (!already) a.setSelection([h.note.id])
        view.current.lock = true
        if (h.part === 'body' || e.shiftKey) {
          const ids = new Set(e.shiftKey ? [...live.selection, h.note.id] : already ? live.selection : [h.note.id])
          drag.current = { type: 'move', x0: p.x, y0: p.y, orig: live.notes.map((n) => ({ ...n })), ids, started: false }
        } else {
          drag.current = { type: 'resize', edge: h.part, orig: { ...h.note }, started: false }
        }
        return
      }
      if (edit && live.selection.size) a.setSelection([])
      const wasPlaying = live.playing
      if (wasPlaying) a.pause()
      drag.current = { type: 'scrub', x0: p.x, t0: live.time - a.syncSec(), wasPlaying, moved: false }
      canvas.style.cursor = 'grabbing'
    }

    const onMove = (e: PointerEvent) => {
      const p = local(e)
      hover.current = { x: p.x, y: p.y }
      const d = drag.current
      if (!d) {
        if (!live.edit) canvas.style.cursor = 'grab'
        else if (live.tool === 'cut') canvas.style.cursor = 'col-resize'
        else {
          const h = hit(p.x, p.y)
          canvas.style.cursor = h ? (h.part === 'body' ? 'grab' : 'ew-resize') : live.tool === 'add' ? 'crosshair' : 'default'
        }
        return
      }
      const gg = geo.current
      if (d.type === 'scrub') {
        const dx = p.x - d.x0
        if (Math.abs(dx) > 2) d.moved = true
        a.seek(d.t0 - dx / gg.pxs)
      } else if (d.type === 'move') {
        const dx = p.x - d.x0
        const dy = p.y - d.y0
        if (!d.started) {
          if (Math.hypot(dx, dy) < 4) return
          d.started = true
          a.beginDrag()
        }
        const dt = Math.round(dx / gg.pxs * SNAP) / SNAP
        const dm = -Math.round(dy / gg.rowH)
        a.dragNotes(d.orig.map((n) => (d.ids.has(n.id) ? { ...n, start: Math.max(0, n.start + dt), midi: n.midi + dm } : n)))
      } else if (d.type === 'resize') {
        if (!d.started) {
          d.started = true
          a.beginDrag()
        }
        const tt = snap(tAt(p.x))
        const o = d.orig
        a.dragNotes(
          live.notes.map((n) => {
            if (n.id !== o.id) return n
            if (d.edge === 'r') return { ...n, dur: Math.max(0.06, tt - o.start) }
            const ns = Math.min(tt, o.start + o.dur - 0.06)
            return { ...n, start: Math.max(0, ns), dur: o.start + o.dur - Math.max(0, ns) }
          }),
        )
      } else if (d.type === 'add') {
        d.t1 = snap(tAt(p.x))
      }
    }

    const onUp = (e: PointerEvent) => {
      const d = drag.current
      drag.current = null
      view.current.lock = false
      canvas.style.cursor = live.edit ? 'default' : 'grab'
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
        /* noop */
      }
      if (!d) return
      if (d.type === 'scrub') {
        if (d.wasPlaying) void a.play()
      } else if (d.type === 'move' || d.type === 'resize') {
        if (d.started) a.endDrag()
      } else if (d.type === 'add') {
        const s0 = Math.min(d.t0, d.t1)
        const dur = Math.abs(d.t1 - d.t0) >= 0.1 ? Math.abs(d.t1 - d.t0) : 0.4
        a.addNote({ id: engine.uid(), start: Math.max(0, s0), dur, midi: d.midi - live.shift })
      }
    }
    const onLeave = () => {
      hover.current = null
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = view.current
      if (e.ctrlKey || e.metaKey) {
        v.windowSec = clamp(v.windowSec * (e.deltaY > 0 ? 1.12 : 0.89), 4, 24)
      } else if (!live.playing) {
        a.seek(live.time - a.syncSec() + (e.deltaX || e.deltaY) * 0.012 * v.windowSec)
      }
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [a, live])

  return (
    <canvas
      ref={canvasRef}
      aria-label="음정 스테이지: 위쪽이 높은 음, 가로는 시간입니다. 흰 막대가 불러야 할 노트, 청록 선이 내 목소리입니다."
      role="img"
      className="absolute inset-0 size-full select-none"
    />
  )
}
