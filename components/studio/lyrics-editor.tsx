'use client'

import { Crosshair, Minus, Pause, Play, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { lineAt } from '@/lib/lrc'
import { cn } from '@/lib/utils'
import { useStudio } from './studio-provider'

/** 0:00.00 형식 */
function fmt(t: number) {
  const s = Math.max(0, t)
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`
}
/** "1:23.45", "83.45", "1:23" → 초 */
function parse(v: string): number | null {
  const t = v.trim()
  const m = t.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * 가사 편집기 — 줄마다 시간, 원문, 한국어 독음을 고친다.
 * 재생하면서 지금 줄이 강조되고, 줄의 ▶를 누르면 그 줄 조금 앞부터 들을 수 있다.
 * 📍는 지금 재생 위치를 그 줄의 시작 시간으로 찍는다 (노래를 들으며 박자에 맞춰 누르면 된다).
 */
export function LyricsEditor({ onClose }: { onClose: () => void }) {
  const { s, a, live } = useStudio()
  const ly = s.lyrics
  const [cur, setCur] = useState(-1)
  const [follow, setFollow] = useState(true)
  const [now, setNow] = useState(0)
  const list = useRef<HTMLOListElement>(null)

  // 지금 재생 중인 줄 (0.15초마다 확인 — 매 프레임 다시 그리지 않도록)
  useEffect(() => {
    const id = setInterval(() => {
      if (!ly) return
      const t = live.time - ly.offset
      setNow(live.time)
      setCur(lineAt(ly.lines, t))
    }, 150)
    return () => clearInterval(id)
  }, [ly, live])

  useEffect(() => {
    if (!follow || cur < 0 || !s.playing) return
    const el = list.current?.querySelector<HTMLElement>(`[data-line="${cur}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [cur, follow, s.playing])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  if (!ly) return null
  const off = ly.offset

  // 오른쪽 패널 안에서 잘리지 않게 화면 전체(body)에 띄운다
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-6" role="dialog" aria-modal="true" aria-label="가사 편집">
      <div className="flex h-full max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        {/* 머리 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="mr-auto text-base font-bold">가사 편집</h2>
          <Button size="sm" variant={s.playing ? 'secondary' : 'default'} onClick={a.togglePlay}>
            {s.playing ? <Pause /> : <Play />}
            {s.playing ? '일시정지' : '재생'}
          </Button>
          <span className="font-mono text-sm tabular text-muted-foreground">{fmt(now)}</span>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            재생 줄 따라가기
          </label>
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="닫기">
            <X />
          </Button>
        </div>
        <p className="border-b border-border bg-muted/30 px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
          재생하면서 지금 줄이 초록색으로 표시돼요. 줄의 <b className="text-foreground">▶</b>는 그 줄 조금 앞부터 듣기, <b className="text-foreground">📍</b>는 지금 재생 위치를 그 줄의 시작으로 찍기예요. 독음 칸에 적은 글자가 화면과 노트 붙이기에 쓰여요.
          {off ? ` (전체 타이밍 보정 ${off > 0 ? '+' : ''}${off.toFixed(1)}초가 함께 적용돼요)` : ''}
        </p>

        {/* 줄 목록 */}
        <ol ref={list} className="scroll-thin flex-1 space-y-1.5 overflow-y-auto p-3">
          {ly.lines.map((l, i) => {
            const active = i === cur
            return (
              <li
                key={i}
                data-line={i}
                className={cn('rounded-xl border p-2.5 transition-colors', active ? 'border-voice bg-voice/10' : 'border-border bg-card/40', !l.text && !l.reading && 'opacity-70')}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="w-6 text-right font-mono text-[11px] text-muted-foreground">{i + 1}</span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    title="이 줄 1초 앞부터 듣기"
                    aria-label={`${i + 1}번 줄 듣기`}
                    onClick={() => {
                      a.seek(Math.max(0, l.t + off - 1))
                      if (!s.playing) a.togglePlay()
                    }}
                  >
                    <Play />
                  </Button>
                  <TimeInput value={l.t} onChange={(t) => a.updateLyricLine(i, { t })} />
                  <Button size="icon-sm" variant="outline" title="0.1초 앞으로" aria-label="0.1초 앞으로" onClick={() => a.updateLyricLine(i, { t: Math.max(0, Math.round((l.t - 0.1) * 100) / 100) })}>
                    <Minus />
                  </Button>
                  <Button size="icon-sm" variant="outline" title="0.1초 뒤로" aria-label="0.1초 뒤로" onClick={() => a.updateLyricLine(i, { t: Math.round((l.t + 0.1) * 100) / 100 })}>
                    <Plus />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    title="지금 재생 위치를 이 줄의 시작으로"
                    onClick={() => a.updateLyricLine(i, { t: Math.max(0, Math.round((live.time - off) * 100) / 100) })}
                  >
                    <Crosshair /> 지금
                  </Button>
                  <div className="ml-auto flex items-center gap-1">
                    <Button size="icon-sm" variant="ghost" title="아래에 줄 추가" aria-label="아래에 줄 추가" onClick={() => a.addLyricLine(i)}>
                      <Plus />
                    </Button>
                    <Button size="icon-sm" variant="ghost" title="이 줄 지우기" aria-label="이 줄 지우기" onClick={() => a.removeLyricLine(i)}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 grid gap-1.5 pl-7">
                  <TextInput value={l.text} placeholder="원문 (비워 두면 간주)" onCommit={(v) => a.updateLyricLine(i, { text: v })} className="text-muted-foreground" />
                  <TextInput value={l.reading ?? ''} placeholder="독음 (예: 로스토완노 고오코쿠)" onCommit={(v) => a.updateLyricLine(i, { reading: v || undefined })} className="font-semibold" />
                </div>
              </li>
            )
          })}
        </ol>

        {/* 바닥 */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <span className="text-xs text-muted-foreground">
            {ly.lines.filter((l) => l.text || l.reading).length}줄 · 독음 {ly.lines.filter((l) => l.reading).length}줄 · 자동 저장
          </span>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => a.addLyricLine(ly.lines.length - 1)}>
            <Plus /> 맨 끝에 줄 추가
          </Button>
          <Button
            size="sm"
            onClick={() => {
              a.attachLyricsToNotes()
              onClose()
            }}
          >
            노트에 가사 붙이기
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function TimeInput({ value, onChange }: { value: number; onChange: (t: number) => void }) {
  const [v, setV] = useState(fmt(value))
  useEffect(() => setV(fmt(value)), [value])
  const commit = () => {
    const t = parse(v)
    if (t === null) setV(fmt(value))
    else if (Math.abs(t - value) > 0.001) onChange(Math.round(t * 100) / 100)
  }
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      aria-label="줄 시작 시간"
      className="h-8 w-[78px] rounded-md border border-input bg-background/60 px-2 text-center font-mono text-xs tabular outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  )
}

/** 입력하는 동안은 로컬로 두고, 칸을 벗어나거나 Enter를 누르면 저장 */
function TextInput({ value, placeholder, onCommit, className }: { value: string; placeholder: string; onCommit: (v: string) => void; className?: string }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() !== value && onCommit(v.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      className={cn('h-8 w-full rounded-md border border-input bg-background/60 px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
    />
  )
}
