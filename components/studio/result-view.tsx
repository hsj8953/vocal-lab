'use client'

import { ArrowLeft, ChevronDown, Download, Eye, Headphones, Loader2, SlidersHorizontal, Wand2, Lightbulb, Mic, Pause, Play, Repeat, RotateCcw, Sparkles, Target, TrendingDown, TrendingUp } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import * as engine from '@/lib/engine'
import { loadHistory, phraseDelta, songKey, type HistoryEntry } from '@/lib/history'
import { buildReport, type Coaching, type Metric, type MetricGroup, type PhraseScore, type RangeCell, type Report, type Status } from '@/lib/report'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { fmtTime, noteName } from '@/lib/music'
import { cn } from '@/lib/utils'
import { FX_PRESETS, type FxParams } from '@/lib/vocal-fx'
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
          <Button variant="outline" size="sm" onClick={a.resetSession}>
            <RotateCcw /> 기록 지우기
          </Button>
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
      ) : !report.enough ? (
        <div className="mt-8 rounded-2xl border border-dashed border-input p-10 text-center">
          <p className="text-sm text-muted-foreground">부른 노트가 {report.notesSung}개라 분석하기엔 짧아요. 한 소절 이상 길게 불러 주세요.</p>
          <Button className="mt-4" onClick={() => void a.startPractice()}>
            <Mic /> 다시 연습하기
          </Button>
        </div>
      ) : (
        <div className="rise-in mt-6 grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.25fr_1fr]">
          <SummaryCard report={report} history={history} prev={prev} isSaved={isSaved} />
          <TakeCard />
          <CoachingSection report={report} />
          <MetricsSection groups={report.groups} prev={prev} />
          <PhraseSection phrases={report.phrases} prev={prev} />
          <RangeSection cells={report.range} />
          <NoteTable report={report} />
        </div>
      )}
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

function HistoryChart({ history }: { history: HistoryEntry[] }) {
  const h = history.slice(-12)
  const W = 320
  const H = 64
  const x = (i: number) => (h.length === 1 ? W / 2 : 8 + (i * (W - 16)) / (h.length - 1))
  const y = (v: number) => H - 6 - (Math.max(0, Math.min(100, v)) / 100) * (H - 14)
  const best = Math.max(...history.map((e) => e.score))
  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold">점수 변화</span>
        <span className="text-muted-foreground">
          {history.length}번 연습 · 최고 <b className="font-mono text-foreground">{best}</b>점
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-16 w-full" role="img" aria-label={`최근 점수: ${h.map((e) => e.score).join(', ')}`}>
        <line x1="0" x2={W} y1={y(80)} y2={y(80)} className="stroke-voice/25" strokeDasharray="3 3" />
        <polyline points={h.map((e, i) => `${x(i)},${y(e.score)}`).join(' ')} fill="none" className="stroke-voice" strokeWidth="2" strokeLinejoin="round" />
        {h.map((e, i) => (
          <circle key={e.at} cx={x(i)} cy={y(e.score)} r={i === h.length - 1 ? 4 : 2.5} className={i === h.length - 1 ? 'fill-voice' : 'fill-card stroke-voice'} strokeWidth="1.5">
            <title>{`${new Date(e.at).toLocaleDateString()} ${e.score}점 (키 ${e.shift > 0 ? '+' : ''}${e.shift})`}</title>
          </circle>
        ))}
      </svg>
    </div>
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
            아래 코칭의 시간 버튼을 누르면 그 부분부터 들려줘요. 반주를 끄고 내 목소리만 들으면 음이 어긋난 곳이 더 잘 들려요. 다시 보기에서는 부를 때 그린 내 음 선이 노트 위에 맞음·어긋남 색으로 다시 그려져요.
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
    <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
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
              className={cn('group relative flex h-full min-w-0 flex-1 flex-col justify-end rounded-sm bg-muted/40 outline-none focus-visible:ring-2 focus-visible:ring-ring', sel === i && 'ring-2 ring-foreground/60')}
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
            <p className="truncate text-sm font-medium">{label(cur) || '(가사 없음)'}</p>
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
            <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setSel(i)}>
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
                  <div key={m} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={c ? `${noteName(m, s.notation)} · 노트 ${c.notes}개 · 맞힘 ${Math.round(c.acc * 100)}% · 평균 ${c.cents > 0 ? '+' : ''}${Math.round(c.cents)}센트` : `${noteName(m, s.notation)} · 이 곡에 없음`}>
                    <div
                      className={cn(
                        'flex h-14 w-full items-end justify-center rounded-md border pb-1 font-mono text-[10px] font-bold tabular',
                        !c ? 'border-border bg-muted/20 text-transparent' : c.acc >= 0.75 ? 'border-voice/40 bg-voice/25 text-voice' : c.acc >= 0.5 ? 'border-caution/40 bg-caution/25 text-caution' : 'border-miss/40 bg-miss/25 text-miss',
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
                { label: '원곡 (현재 키)', low: d.summary.low.midi + d.shift, high: d.summary.high.midi + d.shift, coreLow: d.summary.coreLow + d.shift, coreHigh: d.summary.coreHigh + d.shift, tone: 'ice' },
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
                <td className="max-w-[8rem] truncate py-1.5 pr-2 text-xs text-muted-foreground">{r.lyric ?? ''}</td>
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
      <div className="mt-2.5 grid grid-cols-3 gap-1.5">
        {FX_PRESETS.map((p) => (
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
      <p className="mt-1.5 text-[11px] text-muted-foreground">{FX_PRESETS.find((p) => p.id === s.fxPreset)?.desc ?? '직접 조절한 효과'}</p>

      {fx.tune > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-2.5">
          <span className="text-xs font-medium">튜닝 비교</span>
          <Seg
            label="튜닝 비교"
            size="sm"
            value={s.fxCompare}
            onChange={a.setFxCompare}
            options={[
              { value: 'raw', label: '튜닝 전 (내 음 그대로)' },
              { value: 'tuned', label: '튜닝 후 (맞는 음)' },
            ]}
          />
          <span className="w-full text-[11px] text-muted-foreground">재생하면서 번갈아 눌러 보세요. 튜닝 후에서 달라지는 곳이 음이 어긋난 곳이에요.</span>
        </div>
      ) : null}

      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-3 flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <SlidersHorizontal className="size-3.5" /> 세부 조절
        <ChevronDown className={cn('ml-auto size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="mt-2 space-y-4 text-xs">
          <FxGroup title="오토튠" hint="노트의 음으로 내 음을 맞춰요">
            <Seg
              label="보정 방식"
              size="sm"
              className="w-full"
              value={fx.tuneMode}
              onChange={(v) => set({ tuneMode: v })}
              options={[
                { value: 'note', label: '자연스럽게 (노트 단위)', title: '노트마다 평균적으로 어긋난 만큼만 옮겨요. 바이브레이션·꺾기는 그대로' },
                { value: 'live', label: '오토튠 효과 (실시간)', title: '순간순간 따라가며 맞춰요. 빠르게 하면 로봇 느낌' },
              ]}
            />
            <FxSlider label="세기" value={fx.tune} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => set({ tune: v })} />
            {fx.tuneMode === 'live' ? (
              <FxSlider label="속도" value={fx.tuneSpeed} min={0} max={250} step={10} fmt={(v) => (v <= 10 ? '로봇' : `${v}ms`)} onChange={(v) => set({ tuneSpeed: v })} hint="작을수록 음에 딱 붙어요(로봇 느낌), 클수록 자연스러워요" />
            ) : null}
          </FxGroup>
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

      <Button variant="outline" className="mt-4 w-full" disabled={s.exporting || s.fxBusy !== null} onClick={() => void a.exportMix()}>
        {s.exporting ? <Loader2 className="animate-spin" /> : <Download />}
        {s.exporting ? '저장하는 중…' : '효과 넣어 저장 (WAV)'}
      </Button>
      <p className="mt-1.5 text-[11px] text-muted-foreground">지금 들리는 그대로(내 목소리·반주 볼륨, 튜닝 전/후 포함) 저장돼요.</p>
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

function FxSlider({ label, value, min, max, step, fmt, onChange, hint }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void; hint?: string }) {
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
