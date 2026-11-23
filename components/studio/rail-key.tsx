'use client'

import { Check, Minus, Mic, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { fmtSigned, noteName } from '@/lib/music'
import { RangeCompare } from './range-compare'
import { useStudio } from './studio-provider'
import { Section, Seg } from './ui-bits'

const KEYS = Array.from({ length: 15 }, (_, i) => i - 7)

export function RailKey() {
  const { s, d, a } = useStudio()
  const { userRange: r, measure: m, notation } = s
  const measuring = m.step !== 'idle'
  const rec = d.recommended
  const recShift = rec.key + rec.octave
  const isRec = s.keyShift === rec.key && (s.octaveMode !== 'auto' || true)

  return (
    <div>
      <Section title="내 음역" hint={`${Math.round(r.high - r.low)}반음`}>
        {measuring ? (
          <div className="rounded-xl border border-voice/40 bg-voice/10 p-3">
            <p className="text-sm font-semibold text-foreground">
              {m.step === 'low' ? '1/2 · 가장 낮은 음까지 편하게 내려가 보세요' : '2/2 · 가장 높은 음까지 올라가 보세요'}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {m.step === 'low' ? '“아—” 소리를 길게 내면서 음을 내려요. 안정적으로 낸 가장 낮은 음이 기록돼요.' : '목에 힘을 빼고 올라가요. 소리가 갈라지기 직전의 음이 기록돼요.'}
            </p>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <div className="text-[10px] text-muted-foreground">{m.step === 'low' ? '기록된 최저음' : '기록된 최고음'}</div>
                <div className="font-mono text-3xl font-semibold text-voice tabular">
                  {(m.step === 'low' ? m.low : m.high) !== null ? noteName((m.step === 'low' ? m.low : m.high) as number, notation) : '—'}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={a.cancelMeasure}>
                  <X /> 취소
                </Button>
                <Button size="sm" onClick={a.confirmMeasure} disabled={(m.step === 'low' ? m.low : m.high) === null}>
                  <Check /> {m.step === 'low' ? '다음' : '확정'}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <RangeAdjust label="최저음" value={r.low} notation={notation} onNudge={(dv) => a.nudgeRange('low', dv)} />
              <RangeAdjust label="최고음" value={r.high} notation={notation} onNudge={(dv) => a.nudgeRange('high', dv)} />
            </div>
            <Button variant="outline" className="mt-3 w-full" onClick={() => void a.startMeasure()}>
              <Mic /> 마이크로 내 음역 측정
            </Button>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">측정값은 ±1반음 / ±10센트 단위로 직접 고칠 수 있어요.</p>
          </>
        )}
      </Section>

      <Section title="추천 키">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-3">
          <div>
            <div className="text-[11px] text-muted-foreground">내 음역 기준</div>
            <div className="font-mono text-2xl font-semibold tabular">
              {fmtSigned(rec.key)}
              {rec.octave !== 0 ? <span className="ml-1.5 text-sm font-medium text-muted-foreground">{rec.octave > 0 ? '+1옥' : '−1옥'}</span> : null}
            </div>
          </div>
          <Button size="sm" variant={s.keyShift === rec.key ? 'secondary' : 'default'} onClick={() => a.setKey(rec.key)} disabled={s.keyShift === rec.key}>
            {s.keyShift === rec.key ? '적용됨' : '추천 키로 변경'}
          </Button>
        </div>
        {d.fit ? <FitMessage /> : null}
      </Section>

      <Section title="키" hint="−7 ~ +7 반음">
        <div role="radiogroup" aria-label="키 선택" className="grid grid-cols-5 gap-1.5">
          {KEYS.map((k) => {
            const on = k === s.keyShift
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => a.setKey(k)}
                className={cn(
                  'relative h-9 rounded-lg border font-mono text-[13px] font-medium tabular transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  on ? 'border-foreground bg-foreground text-background' : 'border-border bg-card hover:bg-muted',
                )}
              >
                {fmtSigned(k)}
                {k === rec.key ? <span className={cn('absolute top-1 right-1 size-1.5 rounded-full', on ? 'bg-voice-foreground' : 'bg-voice')} aria-label="추천" /> : null}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">옥타브</span>
          <Seg
            label="옥타브 모드"
            size="sm"
            value={s.octaveMode}
            onChange={(v) => a.setOctaveMode(v)}
            options={[
              { value: 'auto', label: `자동${s.octaveMode === 'auto' && d.octave !== 0 ? ` (${d.octave > 0 ? '+' : '−'}12)` : ''}` },
              { value: -12, label: '−12' },
              { value: 0, label: '0' },
              { value: 12, label: '+12' },
            ]}
          />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          총 이동 {fmtSigned(d.shift)}반음 {recShift !== d.shift ? `· 추천은 ${fmtSigned(recShift)}` : ''}
        </p>
      </Section>

      {d.summary ? (
        <Section title="원곡 vs 내 음역" hint="현재 키 적용">
          <RangeCompare
            notation={notation}
            spans={[
              { label: '이 곡 (현재 키)', low: d.summary.low.midi + d.shift, high: d.summary.high.midi + d.shift, coreLow: d.summary.coreLow + d.shift, coreHigh: d.summary.coreHigh + d.shift, tone: 'ice' },
              { label: '내 음역', low: r.low, high: r.high, tone: 'voice' },
            ]}
            note="진한 구간은 곡에서 가장 자주 쓰이는 주 음역이에요."
          />
        </Section>
      ) : null}
      <span className="hidden">{String(isRec)}</span>
    </div>
  )
}

function FitMessage() {
  const { d, s } = useStudio()
  const f = d.fit!
  const hi = Math.round(f.highDelta * 10) / 10
  const lo = Math.round(f.lowDelta * 10) / 10
  let text: string
  let tone = 'text-voice'
  if (f.inRange) text = '이 키에서는 곡 전체가 내 음역 안에 들어와요.'
  else {
    tone = f.outRatio > 0.12 ? 'text-miss' : 'text-caution'
    const parts: string[] = []
    if (f.highDelta > 0.5) parts.push(`최고음이 내 최고음보다 ${Math.abs(hi)}반음 높아요`)
    if (f.lowDelta < -0.5) parts.push(`최저음이 내 최저음보다 ${Math.abs(lo)}반음 낮아요`)
    text = `${parts.join(', ')}. 음역을 벗어나는 구간은 약 ${Math.round(f.outRatio * 100)}%예요.`
  }
  return (
    <p className={cn('mt-2.5 text-xs leading-relaxed', tone)}>
      {text}
      {s.keyShift !== d.recommended.key ? '' : ''}
    </p>
  )
}

function RangeAdjust({ label, value, notation, onNudge }: { label: string; value: number; notation: 'scientific' | 'korean'; onNudge: (d: number) => void }) {
  const cents = Math.round((value - Math.round(value)) * 100)
  return (
    <div className="rounded-xl border border-border bg-card p-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="font-mono text-xl font-semibold tabular">{noteName(Math.round(value), notation)}</span>
        <span className="font-mono text-[10px] text-muted-foreground tabular">{cents === 0 ? '' : `${cents > 0 ? '+' : ''}${cents}¢`}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-1">
        <Stepper onClick={() => onNudge(-1)} label={`${label} 1반음 내리기`} icon={<Minus />} text="1" />
        <Stepper onClick={() => onNudge(-0.1)} label={`${label} 10센트 내리기`} icon={<Minus />} text=".1" />
        <Stepper onClick={() => onNudge(0.1)} label={`${label} 10센트 올리기`} icon={<Plus />} text=".1" />
        <Stepper onClick={() => onNudge(1)} label={`${label} 1반음 올리기`} icon={<Plus />} text="1" />
      </div>
    </div>
  )
}

function Stepper({ onClick, label, icon, text }: { onClick: () => void; label: string; icon: React.ReactNode; text: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-7 flex-1 items-center justify-center gap-0.5 rounded-md bg-muted/70 text-[10px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-2.5"
    >
      {icon}
      {text}
    </button>
  )
}
