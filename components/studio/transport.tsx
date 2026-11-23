'use client'

import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react'
import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { fmtTime, noteName } from '@/lib/music'
import { Mixer } from './mixer'
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

  const hasMr = !!s.inputs.mr || (s.project.real && !!s.analysis.info?.separated)
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
            { value: 'mr', label: 'MR', title: s.inputs.mr ? '반주만 재생' : hasMr ? 'AI로 분리한 반주 (원곡 − 보컬)' : 'MR 파일이 없어요' },
            { value: 'original', label: '원곡 가이드', title: '원곡 멜로디를 같이 들려줘요' },
          ].filter((o) => hasMr || o.value !== 'mr') as { value: 'mr' | 'original'; label: string }[]}
        />

        <Mixer />

        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {loading ? <span role="status">{s.bufferMsg ?? '음원 준비 중…'}</span> : null}
          <span className="tabular">
            키 <b className="font-mono text-foreground">{s.keyShift > 0 ? `+${s.keyShift}` : s.keyShift}</b>
            {d.octave ? <b className="ml-1 rounded bg-muted px-1 font-mono text-[11px] text-foreground" title={d.octave < 0 ? '원곡보다 한 옥타브 낮게 불러요' : '원곡보다 한 옥타브 높게 불러요'}>{d.octave < 0 ? '8vb' : '8va'}</b> : null}
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
