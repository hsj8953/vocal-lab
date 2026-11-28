'use client'

import { ArrowDown, ArrowUp, Download, Headphones, ListChecks, Square, Merge, MousePointer2, Plus, Redo2, Scissors, Trash2, Undo2, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { checkNotes, type CheckItem, type CheckKind } from '@/lib/note-check'
import { fmtTime, noteName } from '@/lib/music'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { compareListen, foldCurveToNotes, realOrigCurve, realVocalEnvelope } from '@/lib/engine'
import { useStudio } from './studio-provider'
import { Kbd, Section, Seg } from './ui-bits'

export function RailEdit() {
  const { s, a } = useStudio()
  const n = s.selection.length

  return (
    <div>
      <Section title="도구">
        <Seg
          label="편집 도구"
          className="w-full"
          value={s.tool}
          onChange={(v) => a.setTool(v)}
          options={[
            {
              value: 'select',
              label: <Tool icon={<MousePointer2 />} text="선택" k="V" />,
            },
            { value: 'add', label: <Tool icon={<Plus />} text="추가" k="A" /> },
            {
              value: 'cut',
              label: <Tool icon={<Scissors />} text="자르기" k="C" />,
            },
          ]}
        />
        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
          {s.tool === 'select' && '노트를 눌러 선택하고 끌어서 옮겨요. 양 끝을 끌면 길이가 바뀌어요. 빈 곳을 끌면 상자 안 노트가 한꺼번에 선택돼요(Shift를 누르고 끌면 더하기). 재생 위치는 Alt+끌기나 아래 전체 막대로 옮겨요.'}
          {s.tool === 'add' && '빈 곳을 끌어서 새 노트를 그려요. 클릭만 하면 0.4초 노트가 만들어져요.'}
          {s.tool === 'cut' && '자를 노트 위를 클릭하세요. 클릭한 지점에서 둘로 나뉘어요.'}
        </p>
      </Section>

      <OrigLineSection />

      <NoteCheckSection />

      <Section title="선택한 노트" hint={n ? `${n}개 선택됨` : '선택 없음'}>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" disabled={!n} onClick={() => a.nudgeSelected({ pitch: 1 })}>
            <ArrowUp /> 반음 올리기
          </Button>
          <Button variant="outline" size="sm" disabled={!n} onClick={() => a.nudgeSelected({ pitch: -1 })}>
            <ArrowDown /> 반음 내리기
          </Button>
          <Button variant="outline" size="sm" disabled={!n} onClick={() => a.nudgeSelected({ dur: 0.1 })}>
            길이 +0.1초
          </Button>
          <Button variant="outline" size="sm" disabled={!n} onClick={() => a.nudgeSelected({ dur: -0.1 })}>
            길이 −0.1초
          </Button>
          <Button variant="outline" size="sm" disabled={n < 2} onClick={a.mergeSelected}>
            <Merge /> 합치기 <Kbd>M</Kbd>
          </Button>
          <Button variant="outline" size="sm" onClick={a.splitAtPlayhead}>
            <Scissors /> 재생 위치에서 자르기
          </Button>
        </div>
        {n === 1 ? <LyricInput key={s.selection[0]} /> : null}
        <Button variant="destructive" size="sm" className="mt-2 w-full" disabled={!n} onClick={a.deleteSelected}>
          <Trash2 /> 삭제 <Kbd>Del</Kbd>
        </Button>
      </Section>

      <Section title="기록">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="sm" disabled={!s.past.length} onClick={a.undo}>
            <Undo2 /> 되돌리기
          </Button>
          <Button variant="secondary" size="sm" disabled={!s.future.length} onClick={a.redo}>
            <Redo2 /> 다시 실행
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          <Kbd>Ctrl</Kbd> + <Kbd>Z</Kbd> / <Kbd>Shift</Kbd> + <Kbd>Z</Kbd> · 변경 {s.past.length}회
        </p>
      </Section>

      <Section title="저장">
        <Button className="w-full" onClick={a.exportCsv}>
          <Download /> 노트 CSV로 저장
        </Button>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Tony 형식(시작초, 주파수Hz, 길이초, 가사)이라 다시 불러오거나 다른 도구에서 열 수 있어요.</p>
      </Section>
    </div>
  )
}

function Tool({ icon, text, k }: { icon: ReactNode; text: string; k: string }) {
  return (
    <span className="flex items-center justify-center gap-1.5 [&_svg]:size-3.5">
      {icon}
      {text}
      <span className="hidden font-mono text-[9px] opacity-60 sm:inline">{k}</span>
    </span>
  )
}

/** 선택한 노트 하나의 가사 고치기 */
function LyricInput() {
  const { s, a } = useStudio()
  const note = s.notes.find((x) => x.id === s.selection[0])
  const [v, setV] = useState(note?.lyric ?? '')
  if (!note) return null
  return (
    <form
      className="mt-2 flex gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        a.setNoteLyric(note.id, v.trim())
      }}
    >
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v.trim() !== (note.lyric ?? '') && a.setNoteLyric(note.id, v.trim())}
        placeholder="이 노트의 가사 (예: 로, ~)"
        aria-label="노트 가사"
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background/60 px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Button type="submit" size="sm" variant="secondary">
        가사 저장
      </Button>
    </form>
  )
}

/** 원곡 보컬 음 선 켜고 끄기 */
function OrigLineSection() {
  const { s, a } = useStudio()
  const available = s.project.real && s.analysis.status === 'done' && !!realOrigCurve()
  const fromVocal = !!s.inputs.vocal || !!s.analysis.info?.separated
  return (
    <Section title="원곡 보컬 음 선">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="origline" className="text-sm">
          노트 뒤에 원곡 가수가 부른 음 그리기
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="inline-block h-0.5 w-5 rounded bg-[oklch(0.97_0.01_90/0.6)]" /> 흰 선
          </span>
        </label>
        <Switch id="origline" checked={s.showOrigLine} disabled={!available} onCheckedChange={(v) => a.setShowOrigLine(!!v)} />
      </div>
      {available ? (
        <>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            선만 있고 노트가 없는 곳이 빠진 노트예요. <b className="text-foreground">추가</b> 도구로 선이 지나가는 높이에 그리면 돼요. 반대로 선이 없는데 노트만 있으면 쓸모없는 노트일 가능성이 커요.
          </p>
          {!fromVocal ? <p className="mt-1.5 text-[11px] text-caution">보컬 파일이나 AI 분리 없이 원곡에서 잰 선이라 반주 소리가 섞일 수 있어요.</p> : null}
          <label className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground" htmlFor="origalways">
            연습할 때도 보기
            <Switch id="origalways" checked={s.origLineAlways} disabled={!s.showOrigLine} onCheckedChange={(v) => a.setOrigLineAlways(!!v)} />
          </label>
        </>
      ) : (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">원곡 파일을 넣고 분석한 곡에서만 볼 수 있어요. (데모 곡, MR과 노트 파일만 넣은 곡은 원곡 보컬 음이 없어요)</p>
      )}
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* 노트 점검                                                             */
/* ------------------------------------------------------------------ */

const KIND: Record<CheckKind, { label: string; color: string; help: string }> = {
  missing: {
    label: '빠진 곳',
    color: 'text-caution',
    help: '원곡 보컬은 부르는데 노트가 없어요',
  },
  pitch: {
    label: '음 다름',
    color: 'text-miss',
    help: "노트 음이 원곡 보컬과 1반음 넘게 달라요. '거의 확실'은 선이 노트 내내 다른 음에 있는 곳이라 고칠 가능성이 높고, '애매'는 꺾기·비브라토·화음일 수 있어요. '비교 듣기'로 들어 보고 고치세요.",
  },
  novoice: {
    label: '소리 없음',
    color: 'text-muted-foreground',
    help: '그 시간에 원곡 보컬 소리가 거의 없어요 (숨소리·잡음·코러스일 가능성)',
  },
  short: {
    label: '너무 짧음',
    color: 'text-muted-foreground',
    help: '0.07초보다 짧은 조각 노트예요',
  },
}

function NoteCheckSection() {
  const { s, d, a, live } = useStudio()
  const [filter, setFilter] = useState<CheckKind | 'all'>('all')
  const curve = s.project.real && s.analysis.status === 'done' ? realOrigCurve() : null
  const items = useMemo(() => {
    if (!curve) return []
    return checkNotes({ ...curve, midi: foldCurveToNotes(curve, s.notes) }, s.notes, realVocalEnvelope())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.notes, s.project.real, s.analysis.status])
  // 피아노 롤에 표시
  useEffect(() => {
    live.checkGaps = items.filter((i) => i.kind === 'missing').map((i) => [i.start, i.end, i.suggest ?? 60])
    live.checkIds = new Set(items.filter((i) => i.noteId).map((i) => i.noteId!))
    return () => {
      live.checkGaps = []
      live.checkIds = new Set()
    }
  }, [items, live])

  if (!curve) return null
  const count = (k: CheckKind) => items.filter((i) => i.kind === k).length
  const shown = filter === 'all' ? items : items.filter((i) => i.kind === filter)
  const go = (it: CheckItem) => {
    a.seek(Math.max(0, it.start - 1))
    if (it.noteId) a.setSelection([it.noteId])
  }
  const sh = d.shift
  const nm = (m: number) => noteName(m + sh, s.notation)
  const missing = items.filter((i) => i.kind === 'missing')
  const fromVocal = !!s.inputs.vocal || !!s.analysis.info?.separated
  // 비교 듣기: 어느 항목을 듣는 중인지, 지금 단계 (0 원곡 보컬, 1 지금 노트, 2 제안 음)
  const [cmp, setCmp] = useState<{ key: string; step: number } | null>(null)
  const stopRef = useRef<(() => void) | null>(null)
  useEffect(() => () => stopRef.current?.(), [])
  const listen = (it: CheckItem, key: string) => {
    stopRef.current?.()
    if (cmp?.key === key) return
    a.pause()
    stopRef.current = compareListen(it.start, it.end, it.midi!, it.suggest!, (step) => {
      if (step < 0) {
        setCmp((c) => (c?.key === key ? null : c))
        if (stopRef.current) stopRef.current = null
      } else setCmp({ key, step })
    })
    setCmp({ key, step: 0 })
  }
  const pitchHigh = items.filter((i) => i.kind === 'pitch' && i.conf === 'high').length
  return (
    <Section title="노트 점검" hint={items.length ? `${items.length}곳` : '문제 없음'}>
      <p className="text-xs leading-relaxed text-muted-foreground">
        흰 선(원곡 보컬)과 노트를 비교해서 틀렸을 가능성이 높은 곳을 찾아요. 피아노 롤에는 빠진 곳이 <span className="text-caution">주황 상자</span>, 의심 노트가{' '}
        <span className="text-caution">점선 테두리</span>로 보여요.
      </p>
      <div className="mt-2.5 flex flex-wrap gap-1">
        {(['all', 'missing', 'pitch', 'novoice', 'short'] as const).map((k) => {
          const n = k === 'all' ? items.length : count(k)
          return (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              aria-pressed={filter === k}
              className={`rounded-md border px-2 py-1 text-[11px] ${filter === k ? 'border-voice bg-voice/15 font-semibold text-voice' : 'border-border text-muted-foreground hover:bg-muted'}`}
            >
              {k === 'all' ? '전체' : KIND[k].label} {n}
            </button>
          )
        })}
      </div>
      {filter !== 'all' ? <p className="mt-1.5 text-[11px] text-muted-foreground">{KIND[filter].help}</p> : null}
      {count('pitch') ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          음 다름 {count('pitch')}개 중 <b className="text-miss">거의 확실 {pitchHigh}개</b>부터 확인해 보세요.
        </p>
      ) : null}

      {!fromVocal ? (
        <p className="mt-2.5 rounded-lg bg-caution/10 p-2.5 text-[11px] leading-relaxed text-caution">
          보컬 파일이나 AI 분리 없이 원곡에서 잰 선이라 반주 소리 때문에 <b>맞는 노트도 틀렸다고 나오는 경우가 많아요</b> (시험해 보니 의심 노트의 70~80%가 사실 맞았어요). 보컬 파일을 넣거나 AI 분리를
          켜고 다시 분석한 뒤 점검하는 걸 추천해요. 아래 목록은 참고만 하세요.
        </p>
      ) : null}
      {fromVocal && missing.length > 1 ? (
        <Button size="xs" variant="outline" className="mt-2.5 w-full" onClick={() => a.fillGaps(missing)}>
          <Wand2 /> 빠진 곳 {missing.length}군데 모두 채우기
        </Button>
      ) : null}

      {shown.length ? (
        <ul className="scroll-thin mt-2.5 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {shown.map((it, idx) => {
            const key = `${it.kind}-${it.start}-${idx}`
            const playing = cmp?.key === key ? cmp.step : -1
            return (
              <li key={key} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 text-xs">
                <button type="button" onClick={() => go(it)} className="font-mono text-voice tabular hover:underline" title="그 위치로 이동">
                  {fmtTime(it.start, 1)}
                </button>
                <span className={`shrink-0 font-medium ${KIND[it.kind].color}`}>{KIND[it.kind].label}</span>
                {it.kind === 'pitch' ? (
                  <span
                    className={`shrink-0 rounded px-1 py-px text-[10px] font-semibold ${it.conf === 'high' ? 'bg-miss/15 text-miss' : 'bg-muted text-muted-foreground'}`}
                    title={it.conf === 'high' ? '선이 노트 내내 다른 음에 평평하게 있어요. 노트가 틀렸을 가능성이 높아요.' : '선이 잠깐 휘거나 흔들려요. 꺾기·비브라토·화음일 수 있어요.'}
                  >
                    {it.conf === 'high' ? '거의 확실' : '애매'}
                  </span>
                ) : null}
                <span className="flex-1 whitespace-nowrap text-muted-foreground">
                  {it.kind === 'missing' ? `${(it.end - it.start).toFixed(1)}초 · ${nm(it.suggest!)} 근처` : it.kind === 'pitch' ? `${nm(it.midi!)} → ${nm(it.suggest!)}` : nm(it.midi!)}
                </span>
                <div className="ml-auto flex shrink-0 gap-1">
                  {it.kind === 'pitch' ? (
                    <Button size="xs" variant={playing >= 0 ? 'default' : 'outline'} onClick={() => listen(it, key)} aria-label={playing >= 0 ? '비교 듣기 멈춤' : '비교 듣기'}>
                      {playing >= 0 ? <Square /> : <Headphones />} {playing >= 0 ? '멈춤' : '비교 듣기'}
                    </Button>
                  ) : null}
                  {it.kind === 'missing' ? (
                    <Button size="xs" variant="secondary" onClick={() => a.fillGaps([it])}>
                      채우기
                    </Button>
                  ) : it.kind === 'pitch' ? (
                    <Button size="xs" variant="secondary" onClick={() => a.setNotePitches([{ id: it.noteId!, midi: it.suggest! }])}>
                      음 고치기
                    </Button>
                  ) : (
                    <Button size="xs" variant="ghost" onClick={() => a.deleteNotes([it.noteId!])} aria-label="지우기">
                      <Trash2 />
                    </Button>
                  )}
                </div>
                {playing >= 0 ? (
                  <p className="w-full text-[11px] text-muted-foreground" aria-live="polite">
                    {(['원곡 보컬', `지금 노트 ${nm(it.midi!)}`, `제안 음 ${nm(it.suggest!)}`] as const).map((lb, i) => (
                      <span key={lb}>
                        {i ? ' → ' : ''}
                        <span className={i === playing ? 'font-semibold text-voice' : ''}>{lb}</span>
                      </span>
                    ))}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-2.5 flex items-center gap-1.5 text-xs text-voice">
          <ListChecks className="size-4" /> {filter === 'all' ? '틀린 곳을 찾지 못했어요.' : '이 종류는 없어요.'}
        </p>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        시간을 누르면 그 위치로 가요. 고친 건 되돌리기(Ctrl+Z)로 취소할 수 있어요. 흰 선이 틀린 곳(코러스·애드리브를 잡은 곳)도 있으니 들어 보고 고쳐 주세요. 곡 전체가 살짝 높게/낮게 불린 만큼은 틀린
        걸로 치지 않아요.
      </p>
    </Section>
  )
}
