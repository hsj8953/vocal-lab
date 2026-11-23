'use client'

import { AudioWaveform, BarChart3, FolderOpen, Timer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { ImportView } from './import-view'
import { LiveHud } from './live-hud'
import { RailAnalysis } from './rail-analysis'
import { RailEdit } from './rail-edit'
import { RailKey } from './rail-key'
import { ResultView } from './result-view'
import { StageCanvas } from './stage-canvas'
import { useStudio } from './studio-provider'
import type { RailTab, View } from './studio-types'
import { Transport } from './transport'
import { Seg } from './ui-bits'

const NAV: { view: View; label: string; icon: typeof FolderOpen }[] = [
  { view: 'import', label: '곡 불러오기', icon: FolderOpen },
  { view: 'studio', label: '스튜디오', icon: AudioWaveform },
  { view: 'result', label: '연습 결과', icon: BarChart3 },
]

export function AppShell() {
  const { s } = useStudio()
  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <Header />
      <main className="flex min-h-0 flex-1 flex-col">
        {s.view === 'import' ? <ImportView /> : null}
        {s.view === 'studio' ? <StudioView /> : null}
        {s.view === 'result' ? <ResultView /> : null}
      </main>
      <Notice />
    </div>
  )
}

function Header() {
  const { s, a } = useStudio()
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-3 sm:px-5">
      <button type="button" onClick={() => a.setView('import')} className="flex items-baseline gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <span className="text-[15px] font-bold tracking-tight">
          VOCAL<span className="text-voice">·</span>LAB
        </span>
      </button>
      <nav aria-label="화면 이동" className="ml-1 flex items-center gap-0.5">
        {NAV.map((n) => {
          const on = s.view === n.view
          return (
            <button
              key={n.view}
              type="button"
              onClick={() => a.setView(n.view)}
              aria-current={on ? 'page' : undefined}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                on ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <n.icon className="size-4" />
              <span className="hidden sm:inline">{n.label}</span>
            </button>
          )
        })}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <p className="hidden max-w-[220px] truncate text-xs text-muted-foreground md:block">
          <span className="font-medium text-foreground">{s.project.title}</span> · {s.project.artist}
        </p>
        <SyncControl />
        <Seg
          label="음 이름 표기"
          size="sm"
          value={s.notation}
          onChange={a.setNotation}
          options={[
            { value: 'scientific', label: 'G4', title: '국제 표기' },
            { value: 'korean', label: '2옥 솔', title: '한글 표기' },
          ]}
        />
      </div>
    </header>
  )
}

function SyncControl() {
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
  return (
    <div ref={box} className="relative">
      <Button variant={s.syncMs !== 0 ? 'secondary' : 'ghost'} size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <Timer />
        <span className="hidden font-mono tabular sm:inline">{s.syncMs > 0 ? `+${s.syncMs}` : s.syncMs}ms</span>
        <span className="sr-only sm:hidden">싱크 보정</span>
      </Button>
      {open ? (
        <div role="dialog" aria-label="싱크 보정" className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-border bg-popover p-4 shadow-xl">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[13px] font-semibold">싱크 보정</h2>
            <span className="font-mono text-sm tabular">{s.syncMs > 0 ? `+${s.syncMs}` : s.syncMs}ms</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">소리보다 화면이 늦으면 +, 빠르면 −로 맞춰 주세요. 블루투스 이어폰은 보통 +100~200ms가 필요해요.</p>
          <Slider className="mt-4" aria-label="싱크 보정(ms)" min={-400} max={400} step={5} value={[s.syncMs]} onValueChange={(v) => a.setSyncMs(Array.isArray(v) ? v[0] : v)} />
          <div className="mt-3 grid grid-cols-5 gap-1.5">
            {[-50, -10, 0, 10, 50].map((n) => (
              <Button key={n} variant="outline" size="xs" onClick={() => a.setSyncMs(n === 0 ? 0 : s.syncMs + n)}>
                {n === 0 ? '초기화' : n > 0 ? `+${n}` : n}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

const TABS: { id: RailTab; label: string }[] = [
  { id: 'key', label: '키 · 음역' },
  { id: 'analysis', label: '분석' },
  { id: 'edit', label: '노트 편집' },
]

function StudioView() {
  const { s, a } = useStudio()
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_368px]">
      <div className="flex min-h-0 flex-col">
        <div className="relative h-[52dvh] min-h-[320px] lg:h-auto lg:flex-1">
          <StageCanvas />
          <LiveHud />
          <MeasureBanner />
        </div>
        <Transport />
      </div>
      <aside className="flex min-h-0 flex-col border-t border-border bg-card/40 lg:border-t-0 lg:border-l" aria-label="설정 패널">
        <div role="tablist" aria-label="패널" className="flex shrink-0 border-b border-border">
          {TABS.map((t) => {
            const on = s.railTab === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => a.setRailTab(t.id)}
                className={cn(
                  'relative h-11 flex-1 text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
                  on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
                {on ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-voice" /> : null}
              </button>
            )
          })}
        </div>
        <div role="tabpanel" className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {s.railTab === 'key' ? <RailKey /> : null}
          {s.railTab === 'analysis' ? <RailAnalysis /> : null}
          {s.railTab === 'edit' ? <RailEdit /> : null}
        </div>
        <div className="shrink-0 border-t border-border p-3">
          <Button variant="secondary" className="w-full" onClick={() => a.setView('result')}>
            <BarChart3 /> 연습 결과 보기
          </Button>
        </div>
      </aside>
    </div>
  )
}

function MeasureBanner() {
  const { s } = useStudio()
  if (s.measure.step === 'idle') return null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4" role="status">
      <p className="rounded-full border border-voice/50 bg-stage/90 px-4 py-2 text-sm font-medium text-voice backdrop-blur">
        {s.measure.step === 'low' ? '가장 낮은 음까지 내려가 보세요' : '가장 높은 음까지 올라가 보세요'} · 오른쪽 패널에서 확정
      </p>
    </div>
  )
}

function Notice() {
  const { s } = useStudio()
  if (!s.notice) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4" role="status" aria-live="polite">
      <p className="rise-in rounded-full border border-border bg-popover px-4 py-2 text-sm shadow-lg">{s.notice}</p>
    </div>
  )
}
