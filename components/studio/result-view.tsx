'use client'

import { ArrowLeft, Lightbulb, RotateCcw } from 'lucide-react'
import { useMemo } from 'react'
import * as engine from '@/lib/engine'
import { analyzeHabits, type Habit } from '@/lib/habits'
import { Button } from '@/components/ui/button'
import { fmtTime, noteName } from '@/lib/music'
import { RangeCompare } from './range-compare'
import { useStudio } from './studio-provider'

export function ResultView() {
  const { s, d, a } = useStudio()
  const ss = s.session
  const total = Math.max(1, ss.total)
  const pct = (n: number) => Math.round((n / total) * 100)
  const empty = ss.total === 0

  const worst = [...ss.perNote]
    .map((n) => ({ ...n, n: n.great + n.ok + n.off }))
    .filter((n) => n.n >= 4)
    .map((n) => ({ ...n, miss: n.off / n.n }))
    .sort((x, y) => y.miss - x.miss)
    .slice(0, 5)

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <button type="button" onClick={() => a.setView('studio')} className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> 스튜디오로
          </button>
          <h1 className="text-2xl font-bold tracking-tight">연습 결과</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {s.project.title} · 키 {d.shift > 0 ? `+${d.shift}` : d.shift}
            {s.sessionIsSample ? ' · 예시 데이터예요. 마이크를 켜고 부르면 내 기록으로 바뀌어요.' : ''}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={a.resetSession}>
          <RotateCcw /> 기록 초기화
        </Button>
      </div>

      {empty ? (
        <div className="mt-8 rounded-2xl border border-dashed border-input p-10 text-center">
          <p className="text-sm text-muted-foreground">아직 기록이 없어요. 스튜디오에서 마이크를 켜고 곡을 불러 보세요.</p>
          <Button className="mt-4" onClick={() => a.setView('studio')}>
            스튜디오로 가기
          </Button>
        </div>
      ) : (
        <div className="rise-in mt-8 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold">이번 연습 정확도</h2>
            <div className="mt-4 flex items-end gap-3">
              <span className="font-mono text-6xl leading-none font-bold text-voice tabular">{pct(ss.great)}</span>
              <span className="pb-1 text-sm text-muted-foreground">% 가 ±50¢ 이내</span>
            </div>
            <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`정확 ${pct(ss.great)}%, 조금 어긋남 ${pct(ss.ok)}%, 벗어남 ${pct(ss.off)}%`}>
              <div className="bg-voice" style={{ width: `${(ss.great / total) * 100}%` }} />
              <div className="bg-caution" style={{ width: `${(ss.ok / total) * 100}%` }} />
              <div className="bg-miss" style={{ width: `${(ss.off / total) * 100}%` }} />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <Legend color="bg-voice" label="±50¢ 이내" v={pct(ss.great)} />
              <Legend color="bg-caution" label="±100¢ 이내" v={pct(ss.ok)} />
              <Legend color="bg-miss" label="벗어남" v={pct(ss.off)} />
            </dl>
            <dl className="mt-5 grid grid-cols-2 gap-2 border-t border-border pt-4">
              <Fact label="평균 오차" value={`${Math.round(ss.meanAbsCents)}¢`} />
              <Fact label="경향" value={Math.abs(ss.biasCents) < 8 ? '고른 편' : ss.biasCents > 0 ? `높게 (+${Math.round(ss.biasCents)}¢)` : `낮게 (${Math.round(ss.biasCents)}¢)`} />
            </dl>
            {ss.octaveFrames > 0 ? <p className="mt-3 text-xs text-muted-foreground">옥타브 차이로 부른 구간이 {Math.round((ss.octaveFrames / total) * 100)}% 있었어요. 키/옥타브 모드를 바꿔 보세요.</p> : null}
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold">내 음역 vs 원곡 음역</h2>
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
          </section>

          <HabitSection />

          <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
            <h2 className="text-sm font-semibold">구간별 정확도</h2>
            <div className="mt-4 flex h-20 items-end gap-0.5" role="img" aria-label="2초 단위 구간별 정확도">
              {ss.timeline.map((b) => {
                const n = Math.max(1, b.great + b.ok + b.off)
                return (
                  <div key={b.start} className="flex h-full min-w-0 flex-1 flex-col-reverse overflow-hidden rounded-sm bg-muted/40" title={`${fmtTime(b.start)} · 정확 ${Math.round((b.great / n) * 100)}%`}>
                    <div className="bg-voice" style={{ height: `${(b.great / n) * 100}%` }} />
                    <div className="bg-caution" style={{ height: `${(b.ok / n) * 100}%` }} />
                    <div className="bg-miss" style={{ height: `${(b.off / n) * 100}%` }} />
                  </div>
                )
              })}
            </div>
            <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
              <span>0:00</span>
              <span>{fmtTime(s.project.duration)}</span>
            </div>
          </section>

          {worst.length ? (
            <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
              <h2 className="text-sm font-semibold">다시 연습하면 좋은 곳</h2>
              <ul className="mt-3 divide-y divide-border">
                {worst.map((n) => (
                  <li key={n.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="flex items-baseline gap-3">
                      <span className="font-mono text-xs text-muted-foreground tabular">{fmtTime(n.start, 1)}</span>
                      <span className="font-mono font-semibold">{noteName(n.midi, s.notation)}</span>
                      {n.lyric ? <span className="text-muted-foreground">‘{n.lyric}’</span> : null}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-xs text-miss tabular">벗어남 {Math.round(n.miss * 100)}%</span>
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => {
                          a.setView('studio')
                          a.seek(Math.max(0, n.start - 2))
                        }}
                      >
                        여기부터
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  )
}

function Legend({ color, label, v }: { color: string; label: string; v: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`size-2 rounded-full ${color}`} />
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="ml-auto font-mono font-semibold tabular">{v}%</dd>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="font-mono text-base font-semibold tabular">{value}</dd>
    </div>
  )
}

const CONF_LABEL: Record<Habit['confidence'], { text: string; cls: string; title: string }> = {
  high: { text: '믿을 만해요', cls: 'bg-voice/15 text-voice', title: '여러 노트의 평균이라 순간 오류에 잘 흔들리지 않아요' },
  mid: { text: '대체로 맞아요', cls: 'bg-caution/15 text-caution', title: '창법(꺾기, 바이브레이션)과 헷갈릴 수 있어요. 예시를 들어 보고 판단해 주세요' },
  low: { text: '참고용', cls: 'bg-muted text-muted-foreground', title: '싱크나 마이크 지연에 영향을 받아요. 탭으로 싱크를 맞춘 뒤 다시 확인해 보세요' },
}

function HabitSection() {
  const { s, a } = useStudio()
  const ss = s.session
  const report = useMemo(
    () => analyzeHabits(ss, s.notes, s.project.real ? engine.realOrigPitchAt : undefined),
    // 연습 기록이 바뀔 때만 다시 계산
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ss.total, s.notes, s.project.real],
  )
  const top = report.habits.slice(0, 3)
  return (
    <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Lightbulb className="size-4 text-caution" /> 이번 연습에서 고칠 점
        </h2>
        <span className="text-[11px] text-muted-foreground">
          노트 {report.notesUsed}개 분석{report.comparedWithOriginal ? ' · 원곡 가수의 창법은 빼고 판단' : ''}
        </span>
      </div>
      {report.notesUsed < 8 ? (
        <p className="mt-3 text-sm text-muted-foreground">습관을 찾기엔 기록이 아직 적어요. 한 소절 이상 길게 불러 주세요.</p>
      ) : top.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">반복되는 습관이 뚜렷하게 보이지 않아요. 지금처럼 부르면 돼요!</p>
      ) : (
        <ol className="mt-4 grid gap-3 md:grid-cols-3">
          {top.map((h, i) => {
            const c = CONF_LABEL[h.confidence]
            return (
              <li key={h.id} className="flex flex-col rounded-xl border border-border bg-background/40 p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${c.cls}`} title={c.title}>
                    {c.text}
                  </span>
                </div>
                <h3 className="mt-1 text-[15px] leading-snug font-bold">{h.title}</h3>
                <p className="mt-1 font-mono text-xs text-voice tabular">{h.stat}</p>
                <p className="mt-2 flex-1 text-xs leading-relaxed text-muted-foreground">{h.tip}</p>
                {h.examples.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {h.examples.map((e) => (
                      <Button
                        key={e.id}
                        size="xs"
                        variant="secondary"
                        title="그 노트 2초 전부터 들어 보기"
                        onClick={() => {
                          a.setView('studio')
                          a.seek(Math.max(0, e.start - 2))
                        }}
                      >
                        {fmtTime(e.start)} {noteName(e.midi, s.notation)}
                        {e.lyric ? ` ‘${e.lyric}’` : ''}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
