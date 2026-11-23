'use client'

import { Mic2, SlidersHorizontal, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { useStudio } from './studio-provider'

const GUIDE_PRESETS = [
  { v: 0, label: '끔' },
  { v: 0.25, label: '약하게' },
  { v: 0.5, label: '보통' },
  { v: 1, label: '크게' },
]

/** 재생 바의 음량 버튼 — 누르면 전체 볼륨과 가이드 보컬을 한곳에서 조절하는 믹서가 열린다 */
export function Mixer() {
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

  const vol = s.muted ? 0 : Math.round(s.volume * 100)
  const guide = Math.round(s.guideVolume * 100)
  const guideReady = s.project.real && s.guideAvailable
  const guideActive = guideReady && s.source === 'mr' && s.guideVolume > 0
  const VolIcon = vol === 0 ? VolumeX : vol < 50 ? Volume1 : Volume2

  let guideNote: string | null = null
  if (!s.project.real) guideNote = '데모 곡에서는 쓸 수 없어요. 내 곡을 불러오면 쓸 수 있어요.'
  else if (!s.guideAvailable) guideNote = '보컬이 따로 있어야 해요. 분석 탭에서 "AI 보컬 분리"를 켜고 다시 분석하거나, 분리된 보컬 파일을 넣어 주세요.'
  else if (s.source !== 'mr') guideNote = '지금은 원곡을 듣고 있어서 보컬이 이미 들려요. MR로 바꾸면 보컬 크기를 조절할 수 있어요.'

  return (
    <div ref={box} className="relative">
      <Button type="button" variant={open ? 'secondary' : 'outline'} size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog" className="gap-1.5">
        <VolIcon />
        <span className="font-mono text-xs tabular">{vol}%</span>
        {guideActive ? (
          <span className="flex items-center gap-0.5 rounded bg-voice/20 px-1 text-[11px] font-semibold text-voice">
            <Mic2 className="size-3" />
            {guide}%
          </span>
        ) : null}
        <SlidersHorizontal className="text-muted-foreground" />
      </Button>

      {open ? (
        <div role="dialog" aria-label="음량" className="absolute bottom-full left-0 z-50 mb-2 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-popover p-4 shadow-xl">
          {/* 전체 볼륨 */}
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold">전체 볼륨</h3>
            <span className="font-mono text-sm tabular">{vol}%</span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button type="button" variant="ghost" size="icon-sm" onClick={a.toggleMute} aria-label={s.muted ? '음소거 해제' : '음소거'}>
              {s.muted ? <VolumeX /> : <VolIcon />}
            </Button>
            <div className="flex-1">
              <Slider
                aria-label="전체 볼륨"
                min={0}
                max={100}
                value={[vol]}
                onValueChange={(v) => {
                  const n = Array.isArray(v) ? v[0] : v
                  if (s.muted) a.toggleMute()
                  a.setVolume(n / 100)
                }}
              />
            </div>
          </div>
          {s.level ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              원곡과 MR은 같은 크기로 들리게 자동으로 맞춰져 있어요 (원곡 {s.level.orig >= 0 ? '+' : '−'}
              {Math.abs(s.level.orig).toFixed(1)}dB · MR {s.level.mr >= 0 ? '+' : '−'}
              {Math.abs(s.level.mr).toFixed(1)}dB).
            </p>
          ) : null}

          {/* 가이드 보컬 */}
          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Mic2 className="size-4 text-voice" /> 가이드 보컬
              </h3>
              <span className={cn('font-mono text-sm tabular', !guideReady && 'text-muted-foreground')}>{guide}%</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">반주(MR)에 원곡 가수 목소리를 섞어서 들어요. 처음엔 크게 깔고 부르다가, 익숙해지면 줄여 보세요.</p>
            <div className={cn('mt-3', (!guideReady || s.source !== 'mr') && 'pointer-events-none opacity-40')}>
              <Slider aria-label="가이드 보컬 볼륨" min={0} max={100} value={[guide]} onValueChange={(v) => a.setGuideVolume((Array.isArray(v) ? v[0] : v) / 100)} />
              <div className="mt-3 grid grid-cols-4 gap-1.5">
                {GUIDE_PRESETS.map((p) => (
                  <Button key={p.v} type="button" size="xs" variant={Math.abs(s.guideVolume - p.v) < 0.01 ? 'secondary' : 'outline'} onClick={() => a.setGuideVolume(p.v)}>
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
            {guideNote ? (
              <div className="mt-3 rounded-lg bg-muted/60 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                {guideNote}
                {s.project.real && s.guideAvailable && s.source !== 'mr' ? (
                  <Button type="button" size="xs" className="mt-2 w-full" onClick={() => a.setSource('mr')}>
                    MR로 바꾸기
                  </Button>
                ) : null}
                {s.project.real && !s.guideAvailable ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="secondary"
                    className="mt-2 w-full"
                    onClick={() => {
                      setOpen(false)
                      a.setRailTab('analysis')
                    }}
                  >
                    분석 탭 열기
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
