'use client'

import { Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from 'lucide-react'
import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { fmtTime, noteName } from '@/lib/music'
import { OverviewCanvas } from './overview-canvas'
import { useFrame, useStudio } from './studio-provider'
import { Seg } from './ui-bits'

export function Transport() {
  const { s, d, a, live } = useStudio()
  const timeEl = useRef<HTMLSpanElement>(null)

  useFrame(() => {
    const el = timeEl.current
    if (!el) return
    const v = `${fmtTime(live.time, 1)}`
    if (el.textContent !== v) el.textContent = v
  })

  const hasMr = !!s.inputs.mr
  const loading = s.bufferStatus !== 'ready'

  return (
    <div className="flex flex-col gap-2 border-t border-border bg-card/60 px-3 pt-2.5 pb-3 sm:px-4">
      <div className="h-[68px]">
        <OverviewCanvas />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" onClick={() => a.skip(-5)} aria-label="5초 뒤로" title="5초 뒤로 (←)">
            <RotateCcw />
          </Button>
          <Button
            type="button"
            size="icon-lg"
            onClick={a.togglePlay}
            aria-label={s.playing ? '일시정지' : '재생'}
            title="재생/일시정지 (Space)"
            className="size-11 rounded-full"
          >
            {s.playing ? <Pause className="size-5" /> : <Play className="size-5 translate-x-px" />}
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => a.skip(5)} aria-label="5초 앞으로" title="5초 앞으로 (→)">
            <RotateCw />
          </Button>
        </div>

        <div className="font-mono text-[13px] tabular">
          <span ref={timeEl} className="text-foreground">
            0:00.0
          </span>
          <span className="text-muted-foreground"> / {fmtTime(s.project.duration)}</span>
        </div>

        <Seg
          label="재생 음원"
          value={s.source}
          onChange={(v) => a.setSource(v)}
          options={[
            { value: 'mr', label: 'MR', title: hasMr ? '반주만 재생' : 'MR 파일이 없어요' },
            { value: 'original', label: '원곡 가이드', title: '원곡 멜로디를 같이 들려줘요' },
          ].filter((o) => hasMr || o.value !== 'mr') as { value: 'mr' | 'original'; label: string }[]}
        />

        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon-sm" onClick={a.toggleMute} aria-label={s.muted ? '음소거 해제' : '음소거'}>
            {s.muted || s.volume === 0 ? <VolumeX /> : <Volume2 />}
          </Button>
          <Slider
            aria-label="볼륨"
            className="w-24"
            min={0}
            max={100}
            value={[s.muted ? 0 : Math.round(s.volume * 100)]}
            onValueChange={(v) => {
              const n = Array.isArray(v) ? v[0] : v
              if (s.muted) a.toggleMute()
              a.setVolume(n / 100)
            }}
          />
        </div>

        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {loading ? <span role="status">음원 준비 중…</span> : null}
          <span className="tabular">
            키 <b className="font-mono text-foreground">{d.shift > 0 ? `+${d.shift}` : d.shift}</b>
            {d.summary ? (
              <span className="hidden md:inline">
                {' '}
                · 최고 {noteName(d.summary.high.midi + d.shift, s.notation)}
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  )
}
