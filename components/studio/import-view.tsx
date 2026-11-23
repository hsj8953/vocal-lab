'use client'

import { AudioLines, FileMusic, FileText, Loader2, Mic2, Music2, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useStudio } from './studio-provider'
import type { InputKind } from './studio-types'

const SLOTS: { kind: InputKind; title: string; desc: string; accept: string; required?: boolean; icon: typeof Music2 }[] = [
  { kind: 'original', title: '원곡', desc: 'mp3 · wav · m4a · flac', accept: '.mp3,.wav,.m4a,.flac,audio/*', required: true, icon: Music2 },
  { kind: 'mr', title: 'MR (반주)', desc: '있으면 원곡과 시간을 자동으로 맞춰요', accept: '.mp3,.wav,.m4a,.flac,audio/*', icon: AudioLines },
  { kind: 'vocal', title: '분리된 보컬', desc: '있으면 멜로디가 훨씬 정확해져요', accept: '.mp3,.wav,.m4a,.flac,audio/*', icon: Mic2 },
  { kind: 'noteFile', title: '노트 파일', desc: '.mid · Tony .csv — 분석 없이 바로 불러와요', accept: '.mid,.midi,.csv,text/csv,audio/midi', icon: FileMusic },
  { kind: 'lyrics', title: '가사', desc: '.lrc (시간이 붙은 가사) — 노트 위에 가사를 띄워요', accept: '.lrc,.txt,text/plain', icon: FileText },
]

function fmtSize(n: number) {
  return n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)}MB` : `${Math.round(n / 1000)}KB`
}

export function ImportView() {
  const { s, a } = useStudio()
  const running = s.analysis.status === 'running'
  const canStart = !!s.inputs.original?.file || !!s.inputs.noteFile?.file

  return (
    <div className="mx-auto grid w-full max-w-6xl flex-1 gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_minmax(0,520px)] lg:items-center lg:gap-16 lg:py-14">
      <div className="rise-in">
        <p className="font-mono text-xs tracking-[0.2em] text-voice">VOCAL·LAB</p>
        <h1 className="mt-4 text-balance text-4xl leading-[1.15] font-bold tracking-tight sm:text-5xl">
          내 목소리가 닿는 곳에서
          <br />
          노래를 시작하세요
        </h1>
        <p className="mt-5 max-w-md text-pretty text-[15px] leading-relaxed text-muted-foreground">
          원곡에서 멜로디를 뽑아 노트로 보여주고, 내 음역에 맞는 키를 찾아 드려요. 부르는 동안 지금 불러야 할 음과 내 음의 차이를 바로 확인할 수 있어요.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            className="h-11 px-5 text-sm"
            onClick={() => {
              a.resetToDemo()
              a.setView('studio')
            }}
          >
            데모 곡으로 먼저 써보기
          </Button>
          <span className="text-xs text-muted-foreground">‘별빛 아래서’ · 3분 · 파일 없이 모든 기능 체험</span>
        </div>
      </div>

      <div className="rise-in flex flex-col gap-3 [animation-delay:90ms]">
        {SLOTS.map((slot) => (
          <Slot key={slot.kind} slot={slot} />
        ))}
        <div className={`flex items-center gap-3 rounded-2xl border border-input bg-card/40 p-3.5 ${s.inputs.vocal ? 'opacity-60' : ''}`}>
          <div className="min-w-0 flex-1">
            <label htmlFor="sep" className="text-sm font-semibold">
              보컬 파일이 없으면 AI로 분리하기
            </label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {s.inputs.vocal
                ? '분리된 보컬 파일을 넣어서 필요 없어요.'
                : 'UVR5의 Kim_Vocal_2 모델로 원곡에서 보컬과 반주를 나눠요. 처음 한 번 모델 64MB를 받고, 곡마다 몇 분 걸려요. 결과는 저장해 둬요.'}
            </p>
          </div>
          <Switch id="sep" checked={s.analysis.separate && !s.inputs.vocal} disabled={!!s.inputs.vocal} onCheckedChange={(v) => a.setSeparate(!!v)} />
        </div>
        {s.analysis.status === 'error' ? <p className="text-sm text-miss">{s.analysis.error}</p> : null}
        <Button size="lg" className="mt-1 h-12 text-sm" disabled={!canStart || running} onClick={() => void a.analyze(true)}>
          {running ? <Loader2 className="animate-spin" /> : null}
          {running ? `${s.analysis.stage}… ${Math.round(s.analysis.ratio * 100)}%` : s.inputs.noteFile?.file ? '노트 불러와서 시작' : '멜로디 분석하고 시작'}
        </Button>
        {!canStart ? <p className="text-center text-xs text-muted-foreground">원곡 파일을 넣으면 시작할 수 있어요.</p> : null}
      </div>
    </div>
  )
}

function Slot({ slot }: { slot: (typeof SLOTS)[number] }) {
  const { s, a } = useStudio()
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const cur = s.inputs[slot.kind]
  const Icon = slot.icon
  const filled = !!cur?.file

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files[0]
        if (f) a.setInput(slot.kind, f)
      }}
      className={cn(
        'flex items-center gap-3 rounded-2xl border border-dashed p-3.5 transition-colors',
        over ? 'border-voice bg-voice/10' : filled ? 'border-solid border-voice/40 bg-card' : 'border-input bg-card/40 hover:bg-card/70',
      )}
    >
      <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', filled ? 'bg-voice text-voice-foreground' : 'bg-muted text-muted-foreground')}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {slot.title}
          <span className={cn('rounded px-1.5 py-px text-[10px] font-medium', slot.required ? 'bg-voice/20 text-voice' : 'bg-muted text-muted-foreground')}>{slot.required ? '필수' : '선택'}</span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{filled ? `${cur!.name} · ${fmtSize(cur!.size)}` : slot.desc}</p>
      </div>
      <input ref={input} type="file" accept={slot.accept} className="sr-only" aria-label={`${slot.title} 파일 선택`} onChange={(e) => e.target.files?.[0] && a.setInput(slot.kind, e.target.files[0])} />
      {filled ? (
        <Button variant="ghost" size="icon-sm" onClick={() => a.setInput(slot.kind, null)} aria-label={`${slot.title} 파일 제거`}>
          <X />
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
          <Upload /> 선택
        </Button>
      )}
    </div>
  )
}
