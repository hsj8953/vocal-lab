'use client'

import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { fmtTime, noteName } from '@/lib/music'
import { useStudio } from './studio-provider'
import { Section } from './ui-bits'

export function RailAnalysis() {
  const { s, d, a } = useStudio()
  const sum = d.summary
  const an = s.analysis
  const running = an.status === 'running'
  const al = s.align

  return (
    <div>
      <Section title="분석 결과" hint={an.source === 'vocal' ? '보컬 파일 기준' : an.source === 'noteFile' ? '노트 파일 기준' : '원곡 단독 분석'}>
        {sum ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <PosStat label="최저음" midi={sum.low.midi} time={sum.low.time} onJump={() => a.seek(Math.max(0, sum.low.time - 1.5))} />
              <PosStat label="최고음" midi={sum.high.midi} time={sum.high.time} onJump={() => a.seek(Math.max(0, sum.high.time - 1.5))} />
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2">
              <Stat label="음역 폭" value={`${sum.span}반음`} />
              <Stat label="주 음역" value={`${noteName(sum.coreLow, s.notation)}–${noteName(sum.coreHigh, s.notation)}`} small />
              <Stat label="노트 수" value={`${sum.noteCount}개`} />
            </dl>
            <Histogram />
            <p className="mt-2 text-[11px] text-muted-foreground">위 값은 원곡 키 기준이에요. 시간을 누르면 그 위치 1.5초 전으로 이동해요.</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">아직 분석된 노트가 없어요.</p>
        )}
        {an.warnings.map((w) => (
          <p key={w} className="mt-2 flex gap-2 rounded-lg bg-caution/10 p-2.5 text-xs leading-relaxed text-caution">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {w}
          </p>
        ))}
      </Section>

      <Section title="감지 설정">
        <div className="flex items-center justify-between text-xs">
          <label htmlFor="sens" className="font-medium">
            보컬 감지 감도
          </label>
          <span className="font-mono tabular text-muted-foreground">{an.sensitivity}</span>
        </div>
        <Slider
          id="sens"
          aria-label="보컬 감지 감도"
          className="mt-2"
          min={0}
          max={100}
          value={[an.sensitivity]}
          onValueChange={(v) => a.setSensitivity(Array.isArray(v) ? v[0] : v)}
        />
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>0 · 확실한 것만</span>
          <span>100 · 모두 잡기</span>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <label htmlFor="split" className="text-xs">
            <span className="font-medium">가사 음절마다 노트 나누기</span>
            <span className="block text-[11px] text-muted-foreground">끄면 같은 음이 이어지는 노트를 합쳐요</span>
          </label>
          <Switch id="split" checked={an.splitSyllables} onCheckedChange={(v) => a.setSplit(!!v)} />
        </div>
        <Button className="mt-3 w-full" variant="secondary" disabled={running} onClick={() => void a.analyze(false)}>
          {running ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {running ? `${an.stage}…` : '이 설정으로 다시 분석'}
        </Button>
        {running ? (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(an.ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-voice transition-[width] duration-300" style={{ width: `${an.ratio * 100}%` }} />
          </div>
        ) : null}
        <p className="mt-2 text-[11px] text-muted-foreground">다시 분석하면 직접 편집한 노트는 초기화돼요.</p>
      </Section>

      <Section title="MR 시간 정렬">
        {s.inputs.mr ? (
          <>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[11px] text-muted-foreground">오프셋</div>
                <div className="font-mono text-2xl font-semibold tabular">{al.result ? `${al.result.offsetMs > 0 ? '+' : ''}${al.result.offsetMs}ms` : '—'}</div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-muted-foreground">신뢰도</div>
                <div className="font-mono text-2xl font-semibold tabular">{al.result ? `${Math.round(al.result.confidence * 100)}%` : '—'}</div>
              </div>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${al.result && al.result.confidence < 0.7 ? 'bg-caution' : 'bg-voice'}`}
                style={{ width: `${(al.result?.confidence ?? 0) * 100}%` }}
              />
            </div>
            {al.result && al.result.confidence < 0.7 ? <p className="mt-2 text-xs text-caution">신뢰도가 낮아요. 다시 정렬하거나 상단의 싱크 보정으로 직접 맞춰 주세요.</p> : null}
            <Button className="mt-3 w-full" variant="outline" disabled={al.status === 'running'} onClick={() => void a.runAlign()}>
              {al.status === 'running' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {al.status === 'running' ? '정렬 중…' : '다시 정렬'}
            </Button>
          </>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">MR 파일을 넣으면 원곡과의 시간차를 자동으로 맞춰 줘요. ‘곡 불러오기’에서 추가할 수 있어요.</p>
        )}
      </Section>
    </div>
  )
}

function PosStat({ label, midi, time, onJump }: { label: string; midi: number; time: number; onJump: () => void }) {
  const { s } = useStudio()
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-mono text-2xl font-semibold tabular">{noteName(midi, s.notation)}</div>
      <button
        type="button"
        onClick={onJump}
        className="mt-1 rounded-md bg-muted/70 px-2 py-0.5 font-mono text-[11px] text-voice transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={`${label} 위치 ${fmtTime(time)}로 이동`}
      >
        ▶ {fmtTime(time)}
      </button>
    </div>
  )
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-xl bg-muted/50 p-2.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 font-mono font-semibold tabular ${small ? 'text-[13px] leading-6' : 'text-base'}`}>{value}</dd>
    </div>
  )
}

function Histogram() {
  const { d, s } = useStudio()
  const sum = d.summary!
  const max = Math.max(...sum.histogram.map((h) => h.sec))
  return (
    <div className="mt-3">
      <div className="mb-1 text-[11px] text-muted-foreground">음높이별 사용 시간</div>
      <div className="flex h-14 items-end gap-px" role="img" aria-label="음높이별 사용 시간 분포">
        {sum.histogram.map((h) => {
          const core = h.midi >= sum.coreLow && h.midi <= sum.coreHigh
          return <div key={h.midi} className={`flex-1 rounded-t-sm ${core ? 'bg-foreground/80' : 'bg-foreground/25'}`} style={{ height: `${Math.max(6, (h.sec / max) * 100)}%` }} title={`${noteName(h.midi, s.notation)} · ${h.sec.toFixed(1)}초`} />
        })}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{noteName(sum.histogram[0].midi, s.notation)}</span>
        <span>{noteName(sum.histogram[sum.histogram.length - 1].midi, s.notation)}</span>
      </div>
    </div>
  )
}
