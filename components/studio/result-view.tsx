'use client'

import {
  ArrowLeft,
  Gauge,
  Star,
  Trash2,
  ChevronDown,
  Download,
  Eye,
  Headphones,
  Loader2,
  SlidersHorizontal,
  Wand2,
  Lightbulb,
  Mic,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as engine from '@/lib/engine'
import { loadHistory, phraseDelta, songKey, type HistoryEntry } from '@/lib/history'
import { buildReport, type Coaching, type Metric, type MetricGroup, type PhraseScore, type RangeCell, type Report, type Status } from '@/lib/report'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { fmtSigned, fmtTime, noteName } from '@/lib/music'
import { cn } from '@/lib/utils'
import { FX_PRESETS, levelOfTune, tuneFromLevel, type FxParams } from '@/lib/vocal-fx'
import { listTakes, type TakeMeta } from '@/lib/takes'
import { MASTER_PRESETS, masterInfo, type MasterPreset } from '@/lib/mastering'
import { analyzeRange, mergeStats, type EdgeAdvice } from '@/lib/range-advice'
import { ConfirmButton } from './confirm-button'
import { RangeCompare } from './range-compare'
import { Seg } from './ui-bits'
import { useFrame, useStudio } from './studio-provider'

const STATUS: Record<Status, { text: string; dot: string; chip: string }> = {
  good: { text: '좋음', dot: 'bg-voice', chip: 'bg-voice/15 text-voice' },
  ok: { text: '보통', dot: 'bg-caution', chip: 'bg-caution/15 text-caution' },
  bad: { text: '연습 필요', dot: 'bg-miss', chip: 'bg-miss/15 text-miss' },
  info: { text: '참고', dot: 'bg-muted-foreground/50', chip: 'bg-muted text-muted-foreground' },
}

const scoreColor = (v: number) => (v >= 80 ? 'text-voice' : v >= 60 ? 'text-caution' : 'text-miss')
const scoreBg = (v: number) => (v >= 80 ? 'bg-voice' : v >= 60 ? 'bg-caution' : 'bg-miss')

export function ResultView() {
  const { s, d, a } = useStudio()
  const ss = s.session
  const empty = ss.total === 0

  const report = useMemo(
    () =>
      buildReport({
        session: ss,
        notes: s.notes,
        shift: d.shift,
        userRange: s.userRange,
        origAt: s.project.real ? engine.realOrigPitchAt : undefined,
        span: s.practiceSpan ?? undefined,
        realMic: s.mic.mode === 'live' || (!s.sessionIsSample && s.takeAvailable),
      }),
    // 기록이 바뀔 때만 다시 계산
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ss, s.notes, s.practiceSpan, d.shift],
  )

  const key = songKey(s.project.title, s.project.duration)
  const history = useMemo(
    () => (typeof window === 'undefined' ? [] : loadHistory(key)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, s.historyRev],
  )
  // 방금 저장한 기록이면 그 앞의 기록과 비교
  const last = history.at(-1)
  const isSaved = !!last && last.score === report.score && last.nums.pitch === report.parts.pitch
  const prev = isSaved ? history.at(-2) : last

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <button type="button" onClick={() => a.setView('studio')} className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> 스튜디오로
          </button>
          <h1 className="text-2xl font-bold tracking-tight">연습 결과</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {s.project.title} · 키 {s.keyShift > 0 ? `+${s.keyShift}` : s.keyShift}
            {s.practiceSpan ? ` · ${fmtTime(s.practiceSpan.t0)}–${fmtTime(s.practiceSpan.t1)} 연습` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ConfirmButton
            trigger={
              <Button variant="outline" size="sm">
                <RotateCcw /> 기록 지우기
              </Button>
            }
            title="이번 연습 결과를 지울까요?"
            desc={
              s.currentTakeId
                ? '화면의 결과만 지워져요. 곡에 저장된 녹음은 아래 \'이 곡의 내 녹음\'에 남아 있어서 다시 열 수 있어요.'
                : '지우면 되돌릴 수 없어요. 이 결과와 녹음은 곡에 저장되지 않은 거라 다시 볼 수 없어요.'
            }
            onConfirm={a.resetSession}
          />
          <Button size="sm" onClick={() => void a.startPractice()} className="bg-voice font-semibold text-background hover:bg-voice/90">
            <Mic /> 다시 연습하기
          </Button>
        </div>
      </div>

      {s.sessionIsSample ? (
        <p className="mt-4 rounded-lg border border-caution/40 bg-caution/10 px-3 py-2 text-xs text-caution">
          예시 데이터예요. 스튜디오에서 <b>연습 시작</b>을 눌러 부르면 내 기록으로 바뀌어요.
        </p>
      ) : null}

      {empty ? (
        <div className="mt-8 rounded-2xl border border-dashed border-input p-10 text-center">
          <p className="text-sm text-muted-foreground">아직 기록이 없어요. 스튜디오에서 연습 시작을 누르고 곡을 따라 불러 보세요.</p>
          <Button className="mt-4" onClick={() => void a.startPractice()}>
            <Mic /> 연습 시작
          </Button>
        </div>
      ) : null}
      {empty ? null : !report.enough ? (
        <div className="mt-8 rounded-2xl border border-dashed border-input p-10 text-center">
          <p className="text-sm text-muted-foreground">부른 노트가 {report.notesSung}개라 분석하기엔 짧아요. 한 소절 이상 길게 불러 주세요.</p>
          <Button className="mt-4" onClick={() => void a.startPractice()}>
            <Mic /> 다시 연습하기
          </Button>
        </div>
      ) : (
        <div className="rise-in mt-6 grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.25fr_1fr]">
          <div className="flex flex-col gap-5">
            <SummaryCard report={report} history={history} prev={prev} isSaved={isSaved} />
            <NextStepsCard report={report} history={history} isSaved={isSaved} />
          </div>
          <TakeCard />
          <SongTakes />
          <CoachingSection report={report} />
          <MetricsSection groups={report.groups} prev={prev} />
          <PhraseSection phrases={report.phrases} prev={prev} />
          <RangeAdviceCard report={report} history={history} isSaved={isSaved} />
          <RangeSection cells={report.range} />
          <NoteTable report={report} />
        </div>
      )}
      {empty || !report.enough ? (
        <div className="mt-5">
          <SongTakes />
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 총평                                                                 */
/* ------------------------------------------------------------------ */

function SummaryCard({ report, history, prev, isSaved }: { report: Report; history: HistoryEntry[]; prev?: HistoryEntry; isSaved: boolean }) {
  const delta = prev ? report.score - prev.score : null
  const parts: { label: string; v: number; w: string; help: string }[] = [
    { label: '음정', v: report.parts.pitch, w: '60%', help: '부른 순간들이 목표 음에 얼마나 가까웠는지' },
    { label: '부른 비율', v: report.parts.coverage, w: '25%', help: '노트 길이 중 실제로 소리를 낸 비율' },
    { label: '박자', v: report.parts.timing, w: '15%', help: '소절 첫 음을 제때 시작했는지' },
  ]
  return (
    <section className="rounded-2xl border border-border bg-card p-5 lg:row-span-1">
      <div className="flex flex-wrap items-start gap-6">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground">종합 점수</h2>
          <div className="mt-1 flex items-end gap-2">
            <span className={cn('font-mono text-7xl leading-none font-bold tabular', scoreColor(report.score))}>{report.score}</span>
            <span className="pb-2 text-sm text-muted-foreground">/ 100</span>
          </div>
          <p className="mt-2 text-base font-bold">{report.grade}</p>
          {delta !== null ? (
            <p className={cn('mt-1 inline-flex items-center gap-1 text-xs font-semibold', delta > 0 ? 'text-voice' : delta < 0 ? 'text-miss' : 'text-muted-foreground')}>
              {delta > 0 ? <TrendingUp className="size-3.5" /> : delta < 0 ? <TrendingDown className="size-3.5" /> : null}
              지난번보다 {delta > 0 ? `+${delta}` : delta}점
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">{isSaved ? '이 곡의 첫 기록이에요' : '연습 시작으로 부르면 기록이 저장돼요'}</p>
          )}
        </div>
        <div className="min-w-[200px] flex-1 space-y-2.5 pt-1">
          {parts.map((p) => (
            <div key={p.label} title={p.help}>
              <div className="flex items-baseline justify-between text-xs">
                <span>
                  {p.label} <span className="text-[10px] text-muted-foreground">(비중 {p.w})</span>
                </span>
                <span className={cn('font-mono font-semibold tabular', scoreColor(p.v))}>{p.v}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                <div className={cn('h-full rounded-full', scoreBg(p.v))} style={{ width: `${p.v}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-4 rounded-lg bg-muted/40 px-3 py-2.5 text-sm leading-relaxed">{report.summary}</p>
      {report.strengths.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">잘한 점</span>
          {report.strengths.map((t) => (
            <span key={t} className="rounded-full bg-voice/12 px-2 py-0.5 text-[11px] font-medium text-voice">
              {t}
            </span>
          ))}
        </div>
      ) : null}
      {history.length >= 2 ? <HistoryChart history={history} /> : null}
    </section>
  )
}

const CHART_LINES = [
  { k: 'score', label: '종합', cls: 'stroke-voice', w: 2.5 },
  { k: 'pitch', label: '음정', cls: 'stroke-caution', w: 1.5 },
  { k: 'coverage', label: '부른 비율', cls: 'stroke-foreground/60', w: 1.5 },
  { k: 'timing', label: '박자', cls: 'stroke-miss/70', w: 1.5 },
] as const

function HistoryChart({ history }: { history: HistoryEntry[] }) {
  const [hide, setHide] = useState<Set<string>>(new Set())
  const h = history.slice(-12)
  // 그래프 폭을 칸 폭에 맞춘다 (글자·점이 늘어나지 않게 viewBox를 실제 픽셀로)
  const [W, setW] = useState(360)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(200, Math.round(el.clientWidth))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const H = 128
  const L = 22
  const x = (i: number) => (h.length === 1 ? (W + L) / 2 : L + 6 + (i * (W - L - 14)) / (h.length - 1))
  const y = (v: number) => H - 14 - (Math.max(0, Math.min(100, v)) / 100) * (H - 22)
  const val = (e: HistoryEntry, k: string) => (k === 'score' ? e.score : e.nums[k])
  const best = Math.max(...history.map((e) => e.score))
  const first = h[0]
  const last = h[h.length - 1]
  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold">점수 변화</span>
        <span className="text-muted-foreground">
          {history.length}번 연습 · 최고 <b className="font-mono text-foreground">{best}</b>점
          {h.length >= 2 ? ` · 최근 ${h.length}번 동안 ${last.score - first.score >= 0 ? '+' : ''}${last.score - first.score}점` : ''}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {CHART_LINES.map((l) => {
          const on = !hide.has(l.k)
          return (
            <button
              key={l.k}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setHide((p) => {
                  const n = new Set(p)
                  if (n.has(l.k)) n.delete(l.k)
                  else n.add(l.k)
                  return n
                })
              }
              className={cn('flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]', on ? 'border-border text-foreground' : 'border-transparent text-muted-foreground/50 line-through')}
            >
              <svg width="12" height="4" aria-hidden>
                <line x1="0" x2="12" y1="2" y2="2" className={l.cls} strokeWidth={l.w} />
              </svg>
              {l.label}
            </button>
          )
        })}
      </div>
      <div ref={box} className="mt-2 w-full">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" role="img" aria-label={`최근 점수: ${h.map((e) => e.score).join(', ')}`}>
          {[0, 50, 100].map((g) => (
            <g key={g}>
              <line x1={L} x2={W} y1={y(g)} y2={y(g)} className="stroke-border" strokeWidth="1" />
              <text x={L - 4} y={y(g) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
                {g}
              </text>
            </g>
          ))}
          <line x1={L} x2={W} y1={y(80)} y2={y(80)} className="stroke-voice/30" strokeDasharray="3 3" />
          {CHART_LINES.filter((l) => !hide.has(l.k)).map((l) => {
            const pts = h.map((e, i) => [x(i), val(e, l.k)] as const).filter(([, v]) => Number.isFinite(v))
            if (!pts.length) return null
            return (
              <g key={l.k}>
                <polyline points={pts.map(([px, v]) => `${px},${y(v)}`).join(' ')} fill="none" className={l.cls} strokeWidth={l.w} strokeLinejoin="round" opacity={l.k === 'score' ? 1 : 0.75} />
                {l.k === 'score'
                  ? h.map((e, i) => (
                      <circle key={e.at} cx={x(i)} cy={y(e.score)} r={i === h.length - 1 ? 4 : 2.5} className={i === h.length - 1 ? 'fill-voice' : 'fill-card stroke-voice'} strokeWidth="1.5">
                        <title>{`${new Date(e.at).toLocaleDateString()} · 종합 ${e.score} · 음정 ${e.nums.pitch ?? '-'} · 부른 비율 ${e.nums.coverage ?? '-'} · 박자 ${e.nums.timing ?? '-'} (키 ${e.shift > 0 ? '+' : ''}${e.shift})`}</title>
                      </circle>
                    ))
                  : null}
              </g>
            )
          })}
          {h.length >= 2 ? (
            <>
              <text x={x(0)} y={H - 2} textAnchor="start" className="fill-muted-foreground text-[9px]">
                {new Date(first.at).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
              </text>
              <text x={x(h.length - 1)} y={H - 2} textAnchor="end" className="fill-muted-foreground text-[9px]">
                이번
              </text>
            </>
          ) : null}
        </svg>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 다음 연습 할 일                                                        */
/* ------------------------------------------------------------------ */

function NextStepsCard({ report, history, isSaved }: { report: Report; history: HistoryEntry[]; isSaved: boolean }) {
  const { s, a } = useStudio()
  const { adv, rk } = useRangeAdvice(report, history, isSaved)
  const top = report.coaching[0]
  const weak = [...report.phrases]
    .filter((p) => p.score < 80 && p.notes >= 2)
    .sort((x, y) => x.score - y.score)
    .slice(0, 2)
    .sort((x, y) => x.start - y.start)
  const label = (p: PhraseScore) => {
    if (p.lyric) return p.lyric
    const ly = s.lyrics
    if (!ly) return ''
    const line = [...ly.lines].reverse().find((l) => l.t + ly.offset <= p.start + 0.3)
    return line ? line.reading || line.text : ''
  }
  const keyChange = rk && adv.enough && rk.key !== s.keyShift
  if (!top && !weak.length && !keyChange) return null
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <Target className="size-4 text-voice" /> 다음 연습 할 일
      </h2>
      <ol className="mt-3 space-y-3">
        {top ? (
          <li className="flex gap-3">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-voice/15 font-mono text-[11px] font-bold text-voice">1</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{top.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{top.evidence}</p>
              {top.how[0] ? <p className="mt-1 text-xs leading-relaxed">→ {top.how[0]}</p> : null}
              <button type="button" className="mt-1 text-[11px] text-voice hover:underline" onClick={() => document.getElementById('coaching')?.scrollIntoView({ behavior: 'smooth' })}>
                코칭 자세히 보기
              </button>
            </div>
          </li>
        ) : null}
        {weak.length ? (
          <li className="flex gap-3">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-voice/15 font-mono text-[11px] font-bold text-voice">{top ? 2 : 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">이 소절을 반복 연습해 보세요</p>
              <ul className="mt-1.5 space-y-1.5">
                {weak.map((p) => (
                  <li key={p.start} className="flex items-center gap-2 text-xs">
                    <span className={cn('w-7 shrink-0 font-mono font-semibold tabular', scoreColor(p.score))}>{p.score}</span>
                    <span className="shrink-0 font-mono text-muted-foreground tabular">{fmtTime(p.start)}</span>
                    <span className="min-w-0 flex-1 truncate" title={label(p)}>
                      {label(p) || '(가사 없음)'}
                    </span>
                    <Button size="xs" variant="secondary" onClick={() => a.listenFrom(p.start)}>
                      듣기
                    </Button>
                    <Button size="xs" onClick={() => a.setLoop(p.start, p.end, label(p) || undefined)}>
                      <Repeat /> 반복
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ) : null}
        {keyChange && rk ? (
          <li className="flex gap-3">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-voice/15 font-mono text-[11px] font-bold text-voice">{(top ? 1 : 0) + (weak.length ? 1 : 0) + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                키를 <span className="text-voice">{fmtSigned(rk.key)}</span>로 바꿔 보세요 <span className="text-xs font-normal text-muted-foreground">(지금 {fmtSigned(s.keyShift)})</span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{adv.suggest ? '실제로 부른 음역 기준이에요. 아래 음역 다시 분석에서 근거를 볼 수 있어요.' : '내 음역 기준 추천 키예요.'}</p>
              <Button size="xs" variant="outline" className="mt-1.5" onClick={() => a.setKey(rk.key)}>
                키 {fmtSigned(rk.key)}로 바꾸기
              </Button>
            </div>
          </li>
        ) : null}
      </ol>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* 곡에 저장된 녹음                                                       */
/* ------------------------------------------------------------------ */

function useSongTakes() {
  const { s } = useStudio()
  const [list, setList] = useState<TakeMeta[]>([])
  const id = s.project.real ? s.librarySongId : null
  useEffect(() => {
    let alive = true
    if (!id) {
      setList([])
      return
    }
    void listTakes(id).then((l) => alive && setList(l))
    return () => {
      alive = false
    }
  }, [id, s.takesRev])
  return { list, songId: id }
}

/** 지금 듣는 녹음 보관(⭐) 버튼 */
function TakeStar() {
  const { s, a } = useStudio()
  const { list } = useSongTakes()
  const cur = list.find((m) => m.id === s.currentTakeId)
  if (!cur) return null
  return (
    <Button
      size="xs"
      variant={cur.starred ? 'secondary' : 'outline'}
      className="ml-auto"
      onClick={() => void a.starTake(cur.id, !cur.starred)}
      title={cur.starred ? '보관을 풀면, 가장 최근 녹음이 아닐 때 다음 연습에서 지워져요' : '보관하면 다음에 연습해도 지워지지 않아요'}
    >
      <Star className={cn(cur.starred && 'fill-caution text-caution')} /> {cur.starred ? '보관됨' : '보관하기'}
    </Button>
  )
}

function SongTakes() {
  const { s, a } = useStudio()
  const { list, songId } = useSongTakes()
  if (!s.project.real) return null
  const latestId = list[0]?.id
  const when = (t: number) => {
    const d = new Date(t)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return (
    <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Mic className="size-4 text-voice" /> 이 곡의 내 녹음
        </h2>
        <span className="text-[11px] text-muted-foreground">가장 최근 녹음 1개는 자동으로 남아요. 다른 녹음은 ⭐ 보관해야 다음 연습 때 지워지지 않아요.</span>
      </div>
      {!songId ? (
        <p className="mt-2 text-sm text-muted-foreground">곡 목록에 저장된 곡만 녹음을 남길 수 있어요. 곡 불러오기 화면에서 이 곡을 목록에 저장해 주세요.</p>
      ) : !list.length ? (
        <p className="mt-2 text-sm text-muted-foreground">아직 저장된 녹음이 없어요. 연습 시작으로 부르면 여기 남아요.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
          {list.map((m) => {
            const isCur = m.id === s.currentTakeId
            return (
              <li key={m.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm', isCur && 'bg-voice/8')}>
                <button
                  type="button"
                  onClick={() => void a.starTake(m.id, !m.starred)}
                  aria-label={m.starred ? '보관 풀기' : '보관하기'}
                  aria-pressed={m.starred}
                  className="rounded p-0.5 hover:bg-muted"
                  title={m.starred ? '보관 풀기' : '보관하기'}
                >
                  <Star className={cn('size-4', m.starred ? 'fill-caution text-caution' : 'text-muted-foreground')} />
                </button>
                <span className="font-mono text-xs text-muted-foreground tabular">{when(m.at)}</span>
                <span className={cn('w-10 font-mono font-semibold tabular', scoreColor(m.score))}>{m.score}점</span>
                <span className="text-xs text-muted-foreground">
                  키 {fmtSigned(m.keyShift)}
                  {m.rate !== 1 ? ` · ${m.rate}x` : ''} · {fmtTime(m.dur)}
                  {m.span ? ` · ${fmtTime(m.span.t0)}~${fmtTime(m.span.t1)}` : ''}
                </span>
                {m.id === latestId && !m.starred ? <span className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">최근</span> : null}
                <span className="ml-auto flex items-center gap-1.5">
                  {isCur ? (
                    <span className="text-xs font-medium text-voice">지금 보는 중</span>
                  ) : (
                    <Button size="xs" variant="secondary" onClick={() => void a.openTake(m.id)}>
                      열기
                    </Button>
                  )}
                  <ConfirmButton
                    trigger={
                      <Button size="xs" variant="ghost" aria-label="녹음 지우기">
                        <Trash2 />
                      </Button>
                    }
                    title="이 녹음을 지울까요?"
                    desc={`${when(m.at)} · ${m.score}점 녹음이에요. 지우면 되돌릴 수 없어요.${m.starred ? ' 보관(⭐)한 녹음이에요.' : ''}`}
                    onConfirm={() => void a.removeTake(m.id)}
                  />
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* 내 노래 다시 듣기                                                      */
/* ------------------------------------------------------------------ */

function TakeCard() {
  const { s, a, live } = useStudio()
  const timeEl = useRef<HTMLSpanElement>(null)
  const barEl = useRef<HTMLDivElement>(null)
  const span = s.practiceSpan
  useFrame(() => {
    if (timeEl.current) {
      const v = fmtTime(live.time, 1)
      if (timeEl.current.textContent !== v) timeEl.current.textContent = v
    }
    if (barEl.current && span) {
      const r = Math.max(0, Math.min(1, (live.time - span.t0) / Math.max(1, span.t1 - span.t0)))
      barEl.current.style.width = `${r * 100}%`
    }
  })
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <Headphones className="size-4 text-voice" /> 내 노래 다시 듣기
        {s.takeAvailable && s.takeSpeed !== 1 ? <span className="ml-1 rounded bg-voice/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-voice">{s.takeSpeed}x로 연습</span> : null}
        <TakeStar />
      </h2>
      {s.takeAvailable && span ? (
        <>
          <div className="mt-4 flex items-center gap-3">
            <Button size="icon-lg" className="size-11 rounded-full" onClick={a.togglePlay} aria-label={s.playing ? '일시정지' : '재생'}>
              {s.playing ? <Pause className="size-5" /> : <Play className="size-5 translate-x-px" />}
            </Button>
            <div className="min-w-0 flex-1">
              <div
                className="relative h-2 cursor-pointer overflow-hidden rounded-full bg-muted"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  a.seek(span.t0 + ((e.clientX - r.left) / r.width) * (span.t1 - span.t0))
                }}
                role="slider"
                aria-label="재생 위치"
                aria-valuemin={span.t0}
                aria-valuemax={span.t1}
                aria-valuenow={0}
                tabIndex={0}
              >
                <div ref={barEl} className="h-full bg-voice" style={{ width: 0 }} />
              </div>
              <div className="mt-1 flex justify-between font-mono text-[11px] text-muted-foreground tabular">
                <span ref={timeEl}>0:00.0</span>
                <span>{fmtTime(span.t1)}</span>
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => a.listenFrom(span.t0 + 1)} title="연습 처음부터">
              <RotateCcw /> 처음부터
            </Button>
          </div>
          <div className="mt-4 grid gap-3 text-xs">
            <MixRow label="내 목소리" value={s.takeVolume} onChange={a.setTakeVolume} />
            <MixRow label="반주" value={s.resultMr ? s.volume : 0} onChange={(v) => (v > 0.02 ? (a.setResultMr(true), a.setVolume(v)) : a.setResultMr(false))} />
            {s.guideAvailable ? <MixRow label="가이드 보컬" value={s.guideVolume} onChange={a.setGuideVolume} /> : null}
          </div>
          <Button className="mt-4 w-full" variant="secondary" onClick={() => a.startReplay()}>
            <Eye /> 스튜디오에서 선과 함께 다시 보기
          </Button>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            아래 코칭의 시간 버튼을 누르면 그 부분부터 들려줘요. 반주를 끄고 내 목소리만 들으면 음이 어긋난 곳이 더 잘 들려요. 다시 보기에서는 부를 때 그린 내 음 선이 노트 위에 맞음·어긋남 색으로 다시
            그려져요.
          </p>
          <FxPanel />
        </>
      ) : (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {s.mic.mode === 'demo'
            ? '데모 보컬(시뮬레이션)로 부른 기록이라 녹음이 없어요. 실제 마이크로 연습하면 여기서 내 목소리를 다시 들을 수 있어요.'
            : '스튜디오에서 연습 시작을 눌러 부르면 내 목소리가 녹음돼서, 여기서 반주와 같이 다시 들을 수 있어요.'}
        </p>
      )}
    </section>
  )
}

function MixRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex-1">
        <Slider value={[Math.round(value * 100)]} min={0} max={100} step={1} onValueChange={(v) => onChange((Array.isArray(v) ? v[0] : v) / 100)} aria-label={`${label} 볼륨`} />
      </div>
      <span className="w-9 text-right font-mono tabular">{Math.round(value * 100)}</span>
    </label>
  )
}

/* ------------------------------------------------------------------ */
/* 코칭                                                                 */
/* ------------------------------------------------------------------ */

const CONF: Record<Coaching['confidence'], { text: string; title: string }> = {
  high: { text: '믿을 만해요', title: '여러 노트의 평균이라 순간 오류에 잘 흔들리지 않아요' },
  mid: { text: '대체로 맞아요', title: '창법(꺾기, 바이브레이션)과 헷갈릴 수 있어요. 예시를 들어 보고 판단해 주세요' },
  low: { text: '참고용', title: '싱크나 마이크 지연에 영향을 받아요. 탭으로 싱크를 맞춘 뒤 다시 확인해 보세요' },
}

function CoachingSection({ report }: { report: Report }) {
  const { s, a } = useStudio()
  const phraseOf = (t: number) => report.phrases.find((p) => t >= p.start - 0.05 && t <= p.end + 0.05)
  return (
    <section id="coaching" className="scroll-mt-20 rounded-2xl border border-border bg-card p-5 lg:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Lightbulb className="size-4 text-caution" /> 오늘의 코칭
        </h2>
        <span className="text-[11px] text-muted-foreground">
          노트 {report.notesSung}/{report.notesInRange}개 분석{report.comparedWithOriginal ? ' · 원곡 가수의 창법은 빼고 판단' : ''}
        </span>
      </div>
      {report.coaching.length === 0 ? (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-voice/30 bg-voice/8 p-4">
          <Sparkles className="size-5 shrink-0 text-voice" />
          <p className="text-sm">반복되는 문제가 뚜렷하게 보이지 않아요. 아래 소절별 점수에서 낮은 소절만 골라 다듬어 보세요.</p>
        </div>
      ) : (
        <ol className="mt-4 grid gap-4 md:grid-cols-3">
          {report.coaching.map((c, i) => {
            const ph = c.examples[0] ? phraseOf(c.examples[0].start) : undefined
            return (
              <li key={c.id} className="flex flex-col rounded-xl border border-border bg-background/40 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-miss/15 font-mono text-xs font-bold text-miss">{i + 1}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground" title={CONF[c.confidence].title}>
                    {CONF[c.confidence].text}
                  </span>
                </div>
                <h3 className="mt-2 text-base leading-snug font-bold">{c.title}</h3>
                <p className="mt-1.5 font-mono text-xs leading-relaxed text-caution tabular">{c.evidence}</p>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  <b className="text-foreground">왜? </b>
                  {c.why}
                </p>
                <div className="mt-3">
                  <p className="text-xs font-semibold">이렇게 연습해 보세요</p>
                  <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground marker:text-voice">
                    {c.how.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ol>
                </div>
                <p className="mt-3 inline-flex items-center gap-1.5 self-start rounded-full bg-voice/12 px-2.5 py-1 text-[11px] font-semibold text-voice">
                  <Target className="size-3.5" /> 다음 목표: {c.goal}
                </p>
                <div className="mt-auto pt-3">
                  {c.examples.length ? (
                    <>
                      <p className="text-[11px] text-muted-foreground">이런 곳에서 나왔어요 (누르면 들려줘요)</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {c.examples.map((e) => (
                          <Button key={e.id} size="xs" variant="secondary" onClick={() => a.listenFrom(e.start)} title="그 노트 1초 전부터 듣기">
                            {fmtTime(e.start)} {noteName(e.midi, s.notation)}
                            {e.lyric ? ` ‘${e.lyric}’` : ''}
                            <span className="text-muted-foreground">{e.value}</span>
                          </Button>
                        ))}
                      </div>
                    </>
                  ) : null}
                  {ph ? (
                    <Button size="sm" variant="outline" className="mt-2.5 w-full" onClick={() => a.setLoop(ph.start, ph.end, ph.lyric || undefined)}>
                      <Repeat /> 이 소절 반복 연습 ({fmtTime(ph.start)})
                    </Button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* 세부 수치                                                             */
/* ------------------------------------------------------------------ */

function MetricsSection({ groups, prev }: { groups: MetricGroup[]; prev?: HistoryEntry }) {
  return (
    <section className="lg:col-span-2">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">세부 분석</h2>
        <div className="flex gap-3 text-[11px] text-muted-foreground">
          {(['good', 'ok', 'bad'] as const).map((k) => (
            <span key={k} className="flex items-center gap-1">
              <span className={cn('size-2 rounded-full', STATUS[k].dot)} /> {STATUS[k].text}
            </span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {groups.map((g) => (
          <div key={g.id} className="rounded-2xl border border-border bg-card p-4">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground">{g.title}</h3>
            <ul className="mt-2 divide-y divide-border">
              {g.metrics.map((m) => (
                <MetricRow key={m.id} m={m} prev={prev} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

function MetricRow({ m, prev }: { m: Metric; prev?: HistoryEntry }) {
  const [open, setOpen] = useState(false)
  const st = STATUS[m.status]
  const pv = prev?.nums[m.id]
  let trend: 'up' | 'down' | null = null
  if (pv !== undefined && m.num !== undefined && Number.isFinite(m.num) && m.dir) {
    const diff = (m.num - pv) * m.dir
    const thr = Math.max(1, Math.abs(pv) * 0.08)
    if (diff > thr) trend = 'up'
    else if (diff < -thr) trend = 'down'
  }
  return (
    <li className="py-2.5">
      <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', st.dot)} aria-label={st.text} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-xs">{m.label}</span>
            <ChevronDown className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
          </span>
          <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-sm font-semibold tabular">{m.value}</span>
            {trend ? (
              <span className={cn('inline-flex items-center gap-0.5 text-[10px] font-semibold', trend === 'up' ? 'text-voice' : 'text-miss')} title="지난번과 비교">
                {trend === 'up' ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                {trend === 'up' ? '좋아짐' : '나빠짐'}
              </span>
            ) : null}
          </span>
        </span>
      </button>
      {open ? (
        <p className="mt-1.5 ml-4 text-[11px] leading-relaxed text-muted-foreground">
          {m.help}
          {m.target ? <span className="mt-0.5 block text-foreground/80">좋음 기준: {m.target}</span> : null}
        </p>
      ) : null}
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* 소절별 점수                                                           */
/* ------------------------------------------------------------------ */

function PhraseSection({ phrases, prev }: { phrases: PhraseScore[]; prev?: HistoryEntry }) {
  const { s, a } = useStudio()
  const [sel, setSel] = useState<number | null>(null)
  const label = (p: PhraseScore) => {
    if (p.lyric) return p.lyric
    const ly = s.lyrics
    if (!ly) return ''
    const line = [...ly.lines].reverse().find((l) => l.t + ly.offset <= p.start + 0.3)
    return line ? line.reading || line.text : ''
  }
  const worst = [...phrases]
    .map((p, i) => ({ p, i }))
    .sort((x, y) => x.p.score - y.p.score)
    .slice(0, 4)
  const cur = sel !== null ? phrases[sel] : null
  return (
    <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">소절별 점수</h2>
        <span className="text-[11px] text-muted-foreground">막대를 누르면 그 소절을 듣거나 반복 연습할 수 있어요</span>
      </div>
      <div className="mt-4 flex h-28 items-end gap-1" role="list" aria-label="소절별 점수">
        {phrases.map((p, i) => {
          const dlt = phraseDelta(prev, p.start, p.score)
          return (
            <button
              key={p.start}
              type="button"
              role="listitem"
              onClick={() => setSel(i === sel ? null : i)}
              className={cn(
                'group relative flex h-full min-w-0 flex-1 flex-col justify-end rounded-sm bg-muted/40 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                sel === i && 'ring-2 ring-foreground/60',
              )}
              title={`${fmtTime(p.start)} · ${p.score}점${dlt !== null ? ` (지난번 ${dlt >= 0 ? '+' : ''}${dlt})` : ''}${label(p) ? ` · ${label(p)}` : ''}`}
              aria-label={`${fmtTime(p.start)} 소절 ${p.score}점`}
            >
              <span className={cn('w-full rounded-sm transition-opacity group-hover:opacity-80', scoreBg(p.score))} style={{ height: `${Math.max(4, p.score)}%` }} />
            </button>
          )
        })}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{phrases[0] ? fmtTime(phrases[0].start) : ''}</span>
        <span>{phrases.at(-1) ? fmtTime(phrases.at(-1)!.end) : ''}</span>
      </div>

      {cur ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background/40 p-3">
          <span className={cn('font-mono text-2xl font-bold tabular', scoreColor(cur.score))}>{cur.score}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium break-words">{label(cur) || '(가사 없음)'}</p>
            <p className="font-mono text-[11px] text-muted-foreground tabular">
              {fmtTime(cur.start, 1)}–{fmtTime(cur.end, 1)} · 노트 {cur.notes}개
              {(() => {
                const dl = phraseDelta(prev, cur.start, cur.score)
                return dl !== null ? ` · 지난번보다 ${dl >= 0 ? '+' : ''}${dl}` : ''
              })()}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => a.listenFrom(cur.start)}>
            <Play /> 듣기
          </Button>
          <Button size="sm" onClick={() => a.setLoop(cur.start, cur.end, label(cur) || undefined)}>
            <Repeat /> 반복 연습
          </Button>
        </div>
      ) : null}

      <h3 className="mt-5 text-xs font-semibold text-muted-foreground">점수가 낮은 소절</h3>
      <ul className="mt-1 divide-y divide-border">
        {worst.map(({ p, i }) => (
          <li key={p.start} className="flex items-center gap-3 py-2 text-sm">
            <span className={cn('w-9 font-mono font-bold tabular', scoreColor(p.score))}>{p.score}</span>
            <span className="font-mono text-xs text-muted-foreground tabular">{fmtTime(p.start)}</span>
            <button type="button" className="line-clamp-2 min-w-0 flex-1 text-left break-words hover:underline" onClick={() => setSel(i)} title={label(p) || undefined}>
              {label(p) || '(가사 없음)'}
            </button>
            <Button size="xs" variant="secondary" onClick={() => a.listenFrom(p.start)}>
              듣기
            </Button>
            <Button size="xs" variant="outline" onClick={() => a.setLoop(p.start, p.end, label(p) || undefined)}>
              <Repeat /> 반복
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* 음역별 정확도                                                         */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 실제로 부른 기록으로 음역 다시 분석 + 다음 키 추천                        */
/* ------------------------------------------------------------------ */

/** 실제로 부른 기록(최근 3번)으로 음역을 다시 분석하고 다음 연습 키를 고른다 */
function useRangeAdvice(report: Report, history: HistoryEntry[], isSaved: boolean) {
  const { s, d } = useStudio()
  // 최근 3번의 기록을 합친다 (방금 기록이 아직 저장 전이면 그것 + 지난 2번)
  const past = history.filter((h) => h.pitch?.length)
  const lists = isSaved ? past.slice(-3).map((h) => h.pitch!) : [report.pitchStats, ...past.slice(-2).map((h) => h.pitch!)]
  const measured = s.userRange
  const adv = useMemo(() => analyzeRange(mergeStats(lists), measured, lists.length), [lists.map((l) => l.length).join(','), report, measured.low, measured.high]) // eslint-disable-line react-hooks/exhaustive-deps
  const rk = d.summary ? engine.recommendKey(d.summary, adv.suggest ?? measured, s.octaveMode) : null
  return { adv, rk, measured }
}

function RangeAdviceCard({ report, history, isSaved }: { report: Report; history: HistoryEntry[]; isSaved: boolean }) {
  const { s, a } = useStudio()
  const { adv, rk, measured } = useRangeAdvice(report, history, isSaved)
  const nm = (m: number) => noteName(Math.round(m), s.notation)
  const keyText = (k: number, o: number) => `키 ${fmtSigned(k)}${o ? (o > 0 ? ' · +1옥' : ' · −1옥') : ''}`

  const edgeText = (e: EdgeAdvice | null, which: 'high' | 'low') => {
    if (!e) return null
    const word = which === 'high' ? '위' : '아래'
    const cur = which === 'high' ? measured.high : measured.low
    const b = e.beyond
    if (e.limited)
      return (
        <>
          <b className="text-foreground">{nm(e.okMidi)}</b>까지는 안정적이었고, 그 {word} 노트 {b.notes}개 중 맞은 건 {b.ok}개예요
          {b.sung
            ? ` (평균 ${b.cents > 0 ? '+' : ''}${Math.round(b.cents)}센트${which === 'high' && b.cents < -30 ? ', 덜 올라감' : which === 'low' && b.cents > 30 ? ', 덜 내려감' : ''})`
            : ' (거의 못 냄)'}
          .
        </>
      )
    if ((which === 'high' && e.okMidi > cur + 0.5) || (which === 'low' && e.okMidi < cur - 0.5))
      return (
        <>
          측정한 {which === 'high' ? '최고음' : '최저음'}({nm(cur)})보다 {which === 'high' ? '높은' : '낮은'} <b className="text-voice">{nm(e.okMidi)}</b>까지 안정적으로 냈어요.
        </>
      )
    return (
      <>
        <b className="text-foreground">{nm(e.okMidi)}</b>까지 안정적으로 냈어요.{' '}
        {b.notes ? `그 ${word} 노트는 ${b.notes}개뿐이라 한계는 아직 몰라요.` : `이 곡에는 그보다 ${which === 'high' ? '높은' : '낮은'} 음이 없어서 한계는 아직 몰라요.`}
      </>
    )
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">음역 다시 분석</h2>
        <span className="text-[11px] text-muted-foreground">
          {adv.sessions > 1 ? `이 곡 최근 ${adv.sessions}번 연습을 합쳐서` : '이번 연습 기준'} · 음 높이를 잰 노트 {adv.measured}개
        </span>
      </div>
      {!adv.enough ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {adv.why === 'shaky'
            ? '음정이 전체적으로 흔들려서 높이별로 잘 된 음·안 된 음을 가려내기 어려워요. 싱크와 마이크 지연을 먼저 맞추고 다시 불러 보세요.'
            : '음 높이를 잰 노트가 아직 적어서 분석하기 어려워요. 조금 더 길게 불러 보세요.'}
        </p>
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-[1fr_1fr]">
          <div className="space-y-2.5 text-sm leading-relaxed">
            <p>
              <span className="mr-1.5 text-xs text-muted-foreground">높은 쪽</span>
              {edgeText(adv.high, 'high')}
            </p>
            <p>
              <span className="mr-1.5 text-xs text-muted-foreground">낮은 쪽</span>
              {edgeText(adv.low, 'low')}
            </p>
            <p className="text-[11px] text-muted-foreground">
              '안정적' = 그 음 노트를 2번 이상 불러서 {Math.round(adv.okBar * 100)}% 넘게 맞힌 것{adv.okBar < 0.6 ? ' (전체 정확도에 맞춰 기준을 낮췄어요)' : ''}.{' '}
              {adv.sessions === 1 ? '한 번 기록이라 컨디션에 따라 달라질 수 있어요. 여러 번 연습할수록 더 정확해져요.' : ''}
            </p>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl bg-muted/50 p-3">
              <div className="text-[11px] text-muted-foreground">실제로 부른 음역</div>
              {adv.suggest ? (
                <>
                  <p className="mt-0.5 text-sm">
                    측정값{' '}
                    <span className="font-mono">
                      {nm(measured.low)} ~ {nm(measured.high)}
                    </span>{' '}
                    →{' '}
                    <b className="font-mono text-voice">
                      {nm(adv.suggest.low)} ~ {nm(adv.suggest.high)}
                    </b>
                  </p>
                  <Button size="sm" className="mt-2" onClick={() => a.setUserRange(adv.suggest!)}>
                    내 음역을 이걸로 고치기
                  </Button>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">고치면 다른 곡의 추천 키에도 반영돼요. 키·음역 탭에서 다시 바꿀 수 있어요.</p>
                </>
              ) : (
                <p className="mt-0.5 text-sm">
                  측정한 음역(
                  <span className="font-mono">
                    {nm(measured.low)} ~ {nm(measured.high)}
                  </span>
                  )과 잘 맞아요.
                </p>
              )}
            </div>
            {rk ? (
              <div className="rounded-xl bg-muted/50 p-3">
                <div className="text-[11px] text-muted-foreground">다음 연습 키</div>
                {rk.key === s.keyShift ? (
                  <p className="mt-0.5 text-sm">
                    지금 키(<b>{fmtSigned(s.keyShift)}</b>)가 {adv.suggest ? '실제로 부른 음역에도' : ''} 잘 맞아요.
                  </p>
                ) : (
                  <>
                    <p className="mt-0.5 text-sm">
                      추천: <b className="text-voice">{keyText(rk.key, rk.octave)}</b> <span className="text-muted-foreground">(지금 키 {fmtSigned(s.keyShift)})</span>
                    </p>
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => a.setKey(rk.key)}>
                      키 {fmtSigned(rk.key)}로 바꾸기
                    </Button>
                    {adv.suggest ? <p className="mt-1.5 text-[11px] text-muted-foreground">실제로 부른 음역 기준이에요.</p> : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}

function RangeSection({ cells }: { cells: RangeCell[] }) {
  const { s, d } = useStudio()
  const ss = s.session
  if (!cells.length) return null
  const lo = cells[0].midi
  const hi = cells.at(-1)!.midi
  const keys: number[] = []
  for (let m = lo; m <= hi; m++) keys.push(m)
  const map = new Map(cells.map((c) => [c.midi, c]))
  const black = (m: number) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12)
  const weak = cells.filter((c) => c.notes >= 2 && c.acc < 0.6)
  return (
    <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
      <div className="grid grid-cols-1 gap-6">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">음 높이별 정확도</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">칸 색은 그 음을 맞힌 비율, 아래 숫자는 평균 음 차이(센트)예요.</p>
          <div className="scroll-thin mt-3 overflow-x-auto pb-1">
            <div className="flex gap-0.5" style={{ minWidth: keys.length * 26 }}>
              {keys.map((m) => {
                const c = map.get(m)
                return (
                  <div
                    key={m}
                    className="flex min-w-0 flex-1 flex-col items-center gap-1"
                    title={
                      c
                        ? `${noteName(m, s.notation)} · 노트 ${c.notes}개 · 맞힘 ${Math.round(c.acc * 100)}% · 평균 ${c.cents > 0 ? '+' : ''}${Math.round(c.cents)}센트`
                        : `${noteName(m, s.notation)} · 이 곡에 없음`
                    }
                  >
                    <div
                      className={cn(
                        'flex h-14 w-full items-end justify-center rounded-md border pb-1 font-mono text-[10px] font-bold tabular',
                        !c
                          ? 'border-border bg-muted/20 text-transparent'
                          : c.acc >= 0.75
                            ? 'border-voice/40 bg-voice/25 text-voice'
                            : c.acc >= 0.5
                              ? 'border-caution/40 bg-caution/25 text-caution'
                              : 'border-miss/40 bg-miss/25 text-miss',
                        black(m) && 'opacity-80',
                      )}
                    >
                      {c ? `${Math.round(c.acc * 100)}` : '·'}
                    </div>
                    <span className={cn('font-mono text-[9px] tabular', c ? 'text-foreground' : 'text-muted-foreground/60')}>{noteName(m, s.notation)}</span>
                    <span className="font-mono text-[9px] text-muted-foreground tabular">{c ? `${c.cents > 0 ? '+' : ''}${Math.round(c.cents)}` : ''}</span>
                  </div>
                )
              })}
            </div>
          </div>
          {weak.length ? (
            <p className="mt-2 text-xs text-muted-foreground">
              약한 음: <b className="text-miss">{weak.map((c) => noteName(c.midi, s.notation)).join(', ')}</b>
              {weak.every((c) => c.cents < 0) ? ' — 대부분 낮게 불렀어요' : weak.every((c) => c.cents > 0) ? ' — 대부분 높게 불렀어요' : ''}
            </p>
          ) : (
            <p className="mt-2 text-xs text-voice">특별히 약한 음이 없어요.</p>
          )}
        </div>
        <div className="min-w-0 border-t border-border pt-5 lg:max-w-2xl">
          <h2 className="mb-3 text-sm font-semibold">내 음역 vs 원곡 음역</h2>
          {d.summary && ss.userLow !== null && ss.userHigh !== null ? (
            <RangeCompare
              notation={s.notation}
              spans={[
                {
                  label: '원곡 (현재 키)',
                  low: d.summary.low.midi + d.shift,
                  high: d.summary.high.midi + d.shift,
                  coreLow: d.summary.coreLow + d.shift,
                  coreHigh: d.summary.coreHigh + d.shift,
                  tone: 'ice',
                },
                { label: '이번에 낸 음', low: ss.userLow, high: ss.userHigh, tone: 'voice' },
                { label: '측정한 내 음역', low: s.userRange.low, high: s.userRange.high, tone: 'voice' },
              ]}
              note={
                ss.userHigh < d.summary.high.midi + d.shift - 1
                  ? `원곡 최고음(${noteName(d.summary.high.midi + d.shift, s.notation)})까지는 닿지 못했어요. 키를 낮추면 도전하기 쉬워요.`
                  : '원곡의 높은 음까지 소리를 냈어요.'
              }
            />
          ) : (
            <p className="text-sm text-muted-foreground">음역 비교에 필요한 기록이 아직 부족해요.</p>
          )}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* 노트별 상세                                                           */
/* ------------------------------------------------------------------ */

function NoteTable({ report }: { report: Report }) {
  const { s, a } = useStudio()
  const [all, setAll] = useState(false)
  const rows = all ? report.rows : report.rows.filter((r) => r.tags.length || (r.acc !== null && r.acc < 60))
  return (
    <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">노트별 상세</h2>
        <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs">
          {[
            { v: false, l: `문제 있는 노트 (${report.rows.filter((r) => r.tags.length || (r.acc !== null && r.acc < 60)).length})` },
            { v: true, l: `전체 (${report.rows.length})` },
          ].map((o) => (
            <button key={String(o.v)} type="button" onClick={() => setAll(o.v)} className={cn('rounded-md px-2.5 py-1', all === o.v ? 'bg-card font-semibold shadow-sm' : 'text-muted-foreground')}>
              {o.l}
            </button>
          ))}
        </div>
      </div>
      <div className="scroll-thin mt-3 max-h-[420px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card text-left text-[11px] text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-2 pr-2 font-medium">시간</th>
              <th className="py-2 pr-2 font-medium">음</th>
              <th className="py-2 pr-2 font-medium">가사</th>
              <th className="py-2 pr-2 text-right font-medium">점수</th>
              <th className="py-2 pr-2 text-right font-medium">음 차이</th>
              <th className="py-2 font-medium">문제</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="py-1.5 pr-2">
                  <button type="button" className="font-mono text-xs text-voice tabular hover:underline" onClick={() => a.listenFrom(r.start)} title="1초 전부터 듣기">
                    {fmtTime(r.start, 1)}
                  </button>
                </td>
                <td className="py-1.5 pr-2 font-mono text-xs font-semibold">{noteName(r.midi, s.notation)}</td>
                <td className="max-w-[12rem] py-1.5 pr-2 text-xs break-words text-muted-foreground">{r.lyric ?? ''}</td>
                <td className={cn('py-1.5 pr-2 text-right font-mono text-xs font-semibold tabular', r.acc === null ? 'text-muted-foreground' : scoreColor(r.acc))}>{r.acc ?? '—'}</td>
                <td className="py-1.5 pr-2 text-right font-mono text-xs tabular">{r.cents === null ? '—' : `${r.cents > 0 ? '+' : ''}${r.cents}`}</td>
                <td className="py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {r.tags.map((t) => (
                      <span key={t} className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', t === '안 부름' ? 'bg-muted text-muted-foreground' : 'bg-miss/12 text-miss')}>
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? <p className="py-6 text-center text-sm text-muted-foreground">문제 있는 노트가 없어요!</p> : null}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* 녹음 효과                                                             */
/* ------------------------------------------------------------------ */

function FxPanel() {
  const { s, a } = useStudio()
  const [open, setOpen] = useState(false)
  const fx = s.fx
  const set = (patch: Partial<FxParams>) => a.setFx(patch)
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const db = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}dB`
  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Wand2 className="size-4 text-voice" /> 효과
        </h3>
        {s.fxBusy !== null ? (
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" role="status">
            <Loader2 className="size-3.5 animate-spin" /> 효과 계산 중 {Math.round(s.fxBusy * 100)}%
          </span>
        ) : null}
      </div>
      {(
        [
          ['style', '분위기'],
          ['tone', '음색'],
        ] as const
      ).map(([g, title]) => (
        <div key={g} className="mt-2.5">
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">{title}</p>
          <div className="grid grid-cols-3 gap-1.5">
            {FX_PRESETS.filter((p) => (p.group ?? 'style') === g).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => a.setFxPreset(p.id)}
                title={p.desc}
                aria-pressed={s.fxPreset === p.id}
                className={cn(
                  'rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors',
                  s.fxPreset === p.id ? 'border-voice bg-voice/15 text-voice' : 'border-border bg-background/40 hover:bg-muted',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="mt-1.5 text-[11px] text-muted-foreground">{FX_PRESETS.find((p) => p.id === s.fxPreset)?.desc ?? '직접 조절한 효과'}</p>

      <TuneBlock />

      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-3 flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <SlidersHorizontal className="size-3.5" /> 세부 조절
        <ChevronDown className={cn('ml-auto size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="mt-2 space-y-4 text-xs">
          <FxGroup title="리버브" hint="공간의 울림">
            <Seg
              label="리버브 종류"
              size="sm"
              className="w-full"
              value={fx.reverbType}
              onChange={(v) => set({ reverbType: v })}
              options={[
                { value: 'room', label: '작은 방' },
                { value: 'karaoke', label: '노래방' },
                { value: 'hall', label: '홀' },
              ]}
            />
            <FxSlider label="양" value={fx.reverb} min={0} max={1} step={0.02} fmt={pct} onChange={(v) => set({ reverb: v })} />
          </FxGroup>
          <FxGroup title="에코" hint="소리가 뒤따라 반복돼요">
            <FxSlider label="양" value={fx.echo} min={0} max={1} step={0.02} fmt={pct} onChange={(v) => set({ echo: v })} />
            <FxSlider label="간격" value={fx.echoTime} min={80} max={800} step={10} fmt={(v) => `${v}ms`} onChange={(v) => set({ echoTime: v })} />
            <FxSlider label="반복" value={fx.echoFeedback} min={0} max={0.8} step={0.05} fmt={pct} onChange={(v) => set({ echoFeedback: v })} />
          </FxGroup>
          <FxGroup title="EQ (음색)" hint="저음은 웅웅거림, 중음은 또렷함, 고음은 밝기">
            <FxSlider label="저음" value={fx.low} min={-12} max={12} step={1} fmt={db} onChange={(v) => set({ low: v })} />
            <FxSlider label="중음" value={fx.mid} min={-12} max={12} step={1} fmt={db} onChange={(v) => set({ mid: v })} />
            <FxSlider label="고음" value={fx.high} min={-12} max={12} step={1} fmt={db} onChange={(v) => set({ high: v })} />
          </FxGroup>
          <FxGroup title="컴프레서" hint="작은 소리는 키우고 큰 소리는 눌러서 고르게">
            <FxSlider label="세기" value={fx.comp} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => set({ comp: v })} />
          </FxGroup>
          <FxGroup title="노이즈 게이트" hint="노래 안 하는 구간의 잡음·숨소리 줄이기">
            <FxSlider label="세기" value={fx.gate} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => set({ gate: v })} />
          </FxGroup>
          <FxGroup title="더블링" hint="두 번 녹음해 겹친 것처럼 두껍게">
            <FxSlider label="양" value={fx.double} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => set({ double: v })} />
          </FxGroup>
          <FxGroup title="자동 화음" hint="곡의 조성에 맞는 3도 화음을 만들어요">
            <Seg
              label="화음 종류"
              size="sm"
              className="w-full"
              value={fx.harmony}
              onChange={(v) => set({ harmony: v })}
              options={[
                { value: 'off', label: '끔' },
                { value: 'up3', label: '3도 위' },
                { value: 'down3', label: '3도 아래' },
                { value: 'both', label: '위+아래' },
              ]}
            />
            {fx.harmony !== 'off' ? <FxSlider label="양" value={fx.harmonyMix} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => set({ harmonyMix: v })} /> : null}
          </FxGroup>
        </div>
      ) : null}

      <MasterBlock />

      <Button variant="outline" className="mt-4 w-full" disabled={s.exporting || s.fxBusy !== null || s.master.busy} onClick={() => void a.exportMix()}>
        {s.exporting ? <Loader2 className="animate-spin" /> : <Download />}
        {s.exporting ? '저장하는 중…' : s.master.preset !== 'off' ? '효과·마스터링 넣어 저장 (WAV)' : '효과 넣어 저장 (WAV)'}
      </Button>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        지금 들리는 그대로(내 목소리·반주 볼륨, 튜닝 전/후 포함) 저장돼요.{s.master.preset !== 'off' ? ' 마스터링은 비교 듣기와 상관없이 항상 넣어서 저장해요.' : ''}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 튜닝 — 슬라이더 하나 + 틀린 곳만 · 긴 음 처짐 · 고친 곳 전/후 듣기             */
/* ------------------------------------------------------------------ */

function TuneBlock() {
  const { s, a } = useStudio()
  const fx = s.fx
  const lv = levelOfTune(fx)
  const [showSpots, setShowSpots] = useState(false)
  const noteMode = fx.tune > 0 && fx.tuneMode === 'note'
  const spots = noteMode ? s.tuneSpots : []
  const desc =
    lv === 0
      ? '튜닝 없이 내 음 그대로'
      : lv <= 35
        ? '티 안 나게 살짝 — 어긋난 만큼의 일부만 맞춰요'
        : lv <= 70
          ? '확실하게 — 어긋난 음을 노트 음에 맞춰요. 떨림·꺾기는 그대로'
          : lv < 95
            ? '오토튠 효과 — 순간순간 음에 붙여요'
            : '로봇 소리 — 음이 계단처럼 딱딱 꺾여요'
  return (
    <div className="mt-3 rounded-lg bg-muted/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold">튜닝 (음정 다듬기)</span>
        <span className="text-[11px] text-muted-foreground">{lv === 0 ? '끔' : `${lv}`}</span>
      </div>
      <Slider className="mt-2.5" value={[lv]} min={0} max={100} step={1} aria-label="튜닝 세기" onValueChange={(v) => a.setFx(tuneFromLevel(Array.isArray(v) ? v[0] : (v as number)), s.fxPreset)} />
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>끔</span>
        <span>자연스럽게</span>
        <span>확실하게</span>
        <span>오토튠</span>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{desc}</p>

      {noteMode ? (
        <div className="mt-2.5 space-y-2">
          <label className="flex items-center justify-between gap-3 text-xs">
            <span>
              틀린 곳만 고치기
              <span className="block text-[10px] text-muted-foreground">잘 부른 음(25센트 안쪽)은 손대지 않아서 더 자연스러워요</span>
            </span>
            <Switch checked={fx.tuneOnlyOff} onCheckedChange={(v) => a.setFx({ tuneOnlyOff: !!v }, s.fxPreset)} aria-label="틀린 곳만 고치기" />
          </label>
          <label className="flex items-center justify-between gap-3 text-xs">
            <span>
              긴 음 처짐 펴기
              <span className="block text-[10px] text-muted-foreground">길게 끄는 음 끝이 처지거나 뜨는 걸 평평하게 (떨림은 그대로)</span>
            </span>
            <Switch checked={fx.tuneFlatten} onCheckedChange={(v) => a.setFx({ tuneFlatten: !!v }, s.fxPreset)} aria-label="긴 음 처짐 펴기" />
          </label>
        </div>
      ) : null}

      {fx.tune > 0 ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium">비교</span>
          <Seg
            label="튜닝 비교"
            size="sm"
            value={s.fxCompare}
            onChange={a.setFxCompare}
            options={[
              { value: 'raw', label: '튜닝 전' },
              { value: 'tuned', label: '튜닝 후' },
            ]}
          />
          <span className="w-full text-[11px] text-muted-foreground">재생하면서 번갈아 눌러 보세요.</span>
        </div>
      ) : null}

      {noteMode && s.fxBusy === null ? (
        spots.length ? (
          <div className="mt-2.5">
            <button type="button" onClick={() => setShowSpots((v) => !v)} aria-expanded={showSpots} className="flex w-full items-center gap-1.5 text-xs font-medium hover:text-voice">
              고친 곳 {spots.filter((x) => !x.skipped).length}군데{spots.some((x) => x.skipped) ? ` (안 고침 ${spots.filter((x) => x.skipped).length})` : ''}
              <ChevronDown className={cn('ml-auto size-3.5 transition-transform', showSpots && 'rotate-180')} />
            </button>
            {showSpots ? (
              <ul className="scroll-thin mt-2 max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-background/40">
                {spots.map((sp) => (
                  <li key={sp.key} className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 text-xs', sp.skipped && 'opacity-60')}>
                    <span className="font-mono text-muted-foreground tabular">{fmtTime(sp.t0)}</span>
                    <span className="min-w-0 flex-1" title={`노트보다 ${sp.cents > 0 ? '+' : ''}${sp.cents}센트 (100센트 = 반음)`}>
                      {Math.abs(sp.cents) >= 25 ? `${Math.abs(sp.cents) < 50 ? '살짝' : Math.abs(sp.cents) < 100 ? '꽤' : '반음 넘게'} ${sp.cents > 0 ? '높게' : '낮게'} 부름 → 맞춤` : ''}
                      {sp.flattened ? `${Math.abs(sp.cents) >= 25 ? ' · ' : ''}처짐 폄` : ''}
                    </span>
                    <Button size="xs" variant="ghost" onClick={() => a.listenSpot(sp.t0, sp.t1, 'raw')}>
                      전
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => a.listenSpot(sp.t0, sp.t1, 'tuned')}>
                      후
                    </Button>
                    <Switch size="sm" checked={!sp.skipped} onCheckedChange={() => a.toggleTuneSkip(sp.key)} aria-label={`${fmtTime(sp.t0)} 고치기`} />
                  </li>
                ))}
              </ul>
            ) : null}
            {showSpots ? <p className="mt-1 text-[10px] text-muted-foreground">'전/후'로 그 부분만 들어 보고, 고치지 않는 게 나은 곳은 스위치를 끄세요.</p> : null}
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">크게 어긋난 곳이 없어서 고친 곳이 거의 없어요.</p>
        )
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 마스터링 — 완성본 크기 맞추기 + 같은 크기로 전/후 비교                       */
/* ------------------------------------------------------------------ */

function MasterBlock() {
  const { s, a } = useStudio()
  const m = s.master
  const info = masterInfo(m.preset)
  const r1 = (v: number) => Math.round(v * 10) / 10
  return (
    <div className="mt-4 border-t border-border pt-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Gauge className="size-4 text-voice" /> 마스터링 (완성본 마무리)
        {m.busy ? (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] font-normal text-muted-foreground" role="status">
            <Loader2 className="size-3.5 animate-spin" /> 음량 재는 중
          </span>
        ) : null}
      </h3>
      <div className="mt-2.5 grid grid-cols-4 gap-1.5">
        {([{ id: 'off', label: '끔', desc: '마스터링 없이' }, ...MASTER_PRESETS] as { id: MasterPreset; label: string; desc: string }[]).map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.desc}
            aria-pressed={m.preset === p.id}
            onClick={() => a.setMasterPreset(p.id)}
            className={cn('rounded-lg border px-1.5 py-1.5 text-xs font-medium transition-colors', m.preset === p.id ? 'border-voice bg-voice/15 text-voice' : 'border-border bg-background/40 hover:bg-muted')}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{info ? info.desc : '반주와 섞은 완성본의 크기를 음원 수준으로 맞추고, 찢어지는 소리를 막아요.'}</p>
      {info && m.after !== null && m.before !== null && !m.busy ? (
        <>
          <p className="mt-2 text-xs">
            소리 크기 <span className="font-mono">{r1(m.before)}</span> → <b className="font-mono text-voice">{r1(m.after)}</b> LUFS
            <span className="text-muted-foreground"> (약 {Math.round(m.after - m.before) >= 0 ? '+' : ''}{Math.round(m.after - m.before)}dB)</span>
          </p>
          {info && m.before >= info.target - 0.5 ? <p className="mt-1 text-[11px] text-muted-foreground">반주가 이미 충분히 커서 크기는 거의 그대로 두고, 소리를 묶어 주고 찢어지는 소리만 막았어요.</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-2.5">
            <span className="text-xs font-medium">비교</span>
            <Seg
              label="마스터링 비교"
              size="sm"
              value={m.compare}
              onChange={a.setMasterCompare}
              options={[
                { value: 'before', label: '마스터링 전' },
                { value: 'after', label: '마스터링 후' },
              ]}
            />
            <label className="flex w-full items-center justify-between gap-3 text-xs">
              <span>
                같은 크기로 맞춰 비교
                <span className="block text-[10px] text-muted-foreground">크면 무조건 좋게 들리는 착각을 막아요. 켜 두면 '후'도 '전'과 같은 크기로 들려요.</span>
              </span>
              <Switch checked={m.matched} onCheckedChange={(v) => a.setMasterMatched(!!v)} aria-label="같은 크기로 맞춰 비교" />
            </label>
          </div>
        </>
      ) : null}
    </div>
  )
}

function FxGroup({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-background/30 p-3">
      <p className="font-semibold">
        {title} <span className="font-normal text-muted-foreground">· {hint}</span>
      </p>
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  )
}

function FxSlider({
  label,
  value,
  min,
  max,
  step,
  fmt,
  onChange,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  fmt: (v: number) => string
  onChange: (v: number) => void
  hint?: string
}) {
  return (
    <div title={hint}>
      <label className="flex items-center gap-3">
        <span className="w-10 shrink-0 text-muted-foreground">{label}</span>
        <div className="flex-1">
          <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : (v as number))} aria-label={label} />
        </div>
        <span className="w-12 text-right font-mono tabular">{fmt(value)}</span>
      </label>
    </div>
  )
}
