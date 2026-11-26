'use client'

import { Gauge, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useStudio } from './studio-provider'

const SPEEDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.2]

/** 재생 바의 배속 버튼 — 음 높이는 그대로 두고 빠르기만 바꾼다 */
export function SpeedControl() {
  const { s, a } = useStudio()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  const busy = s.speedBusy !== null
  const locked = s.practice.phase !== 'idle' || s.replay
  const fmt = (v: number) => `${v}x`
  return (
    <div ref={box} className="relative">
      <Button
        type="button"
        variant={open ? 'secondary' : s.speed !== 1 ? 'secondary' : 'outline'}
        size="sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`배속 ${fmt(s.speed)}`}
        className={cn('gap-1.5', s.speed !== 1 && 'text-voice')}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Gauge />}
        <span className="font-mono text-xs tabular">{busy ? `${Math.round((s.speedBusy ?? 0) * 100)}%` : fmt(s.speed)}</span>
      </Button>
      {open ? (
        <div role="dialog" aria-label="배속" className="absolute bottom-full left-0 z-50 mb-2 w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-popover p-4 shadow-xl">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold">배속</h3>
            <span className="font-mono text-sm tabular">{fmt(s.speed)}</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="배속 선택">
            {SPEEDS.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={s.speed === v}
                disabled={busy || locked}
                onClick={() => void a.setSpeed(v)}
                className={cn(
                  'rounded-md border px-2 py-1.5 font-mono text-xs tabular transition-colors disabled:opacity-50',
                  s.speed === v ? 'border-voice bg-voice/15 font-semibold text-voice' : 'border-border hover:bg-muted',
                )}
              >
                {fmt(v)}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            {s.replay
              ? `녹음 다시 보기는 녹음한 배속(${s.takeSpeed}x)으로만 들을 수 있어요.`
              : s.practice.phase !== 'idle'
                ? '연습 중에는 바꿀 수 없어요. 연습을 끝낸 뒤 바꿔 주세요.'
                : '음 높이(키)는 그대로 두고 빠르기만 바꿔요. 처음 바꿀 때 몇 초 걸려요. 느리게 연습하고, 결과 화면에서는 연습한 배속 그대로 들려줘요.'}
          </p>
          {busy ? (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-voice" role="status">
              <Loader2 className="size-3 animate-spin" /> 배속 맞추는 중 {Math.round((s.speedBusy ?? 0) * 100)}%
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
