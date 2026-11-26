'use client'

import { AlertTriangle, Download, FileText, Loader2, PencilLine, RefreshCw, Wand2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { METHOD_LABEL, realSeparatedWav } from '@/lib/engine'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { fmtTime, noteName } from '@/lib/music'
import { useStudio } from './studio-provider'
import { LrclibSearch } from './lrclib-search'
import { LyricsEditor } from './lyrics-editor'
import { Section, Seg } from './ui-bits'

export function RailAnalysis() {
  const { s, d, a } = useStudio()
  const sum = d.summary
  const an = s.analysis
  const running = an.status === 'running'
  const al = s.align

  return (
    <div>
      <Section title="분석 결과" hint={an.info ? `${an.info.seconds.toFixed(1)}초 걸림` : an.source === 'vocal' ? '보컬 파일 기준' : an.source === 'noteFile' ? '노트 파일 기준' : '원곡 단독 분석'}>
        {an.info ? <MethodRow /> : null}
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

      <SeparationSection />

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
        {s.project.real && !s.inputs.vocal && !an.info?.separated ? <p className="mt-1 text-[11px] text-muted-foreground">음절 나누기는 분리된 보컬(파일 또는 AI 분리)이 있어야 동작해요.</p> : null}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">음 높이 분석기</span>
            <Seg
              label="음 높이 분석기"
              size="sm"
              value={an.pitchModel}
              onChange={a.setPitchModel}
              options={[
                { value: 'classic', label: '기본', title: '배음 분석 기반 (빠름)' },
                { value: 'crepe', label: 'CREPE AI', title: '노래용으로 학습된 신경망 (분리된 보컬 필요)' },
              ]}
            />
          </div>
          {an.pitchModel === 'crepe' ? (
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">CREPE 모델 크기</span>
              <Seg
                label="CREPE 모델 크기"
                size="sm"
                value={an.crepeModel}
                onChange={a.setCrepeModel}
                options={[
                  { value: 'tiny', label: '2MB', title: '가장 빠름' },
                  { value: 'small', label: '6.5MB', title: '권장' },
                  { value: 'medium', label: '23MB', title: '가장 정밀, 첫 다운로드가 큼' },
                ]}
              />
            </div>
          ) : null}
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            {an.pitchModel === 'crepe'
              ? s.inputs.vocal || an.separate
                ? 'CREPE로 음 높이를 더 촘촘하게 재고, 옥타브는 기본 분석기 판단을 따라요. 곡마다 처음 한 번만 계산하고 저장해 둬요.'
                : 'CREPE는 분리된 보컬 파일이 있을 때만 쓰여요. 지금은 기본 분석기로 분석해요.'
              : '배음 분석과 규칙으로 음 높이를 찾아요. 가장 빠르고 옥타브 판단이 안정적이에요.'}
          </p>
        </div>
        {s.inputs.noteFile ? (
          <div className="mt-3 flex items-center justify-between gap-3">
            <label htmlFor="autofill" className="text-xs">
              <span className="font-medium">노트 파일 빈 곳 자동 채우기</span>
              <span className="block text-[11px] text-muted-foreground">파일에 빠진 음을 분석 결과로 채워요 (보컬 파일이나 MR 필요)</span>
            </label>
            <Switch id="autofill" checked={an.autofill} onCheckedChange={(v) => a.setAutofill(!!v)} />
          </div>
        ) : null}
        <Button className="mt-3 w-full" variant="secondary" disabled={running} onClick={() => void a.analyze(false)}>
          {running ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {running ? '분석 중…' : '이 설정으로 다시 분석'}
        </Button>
        {running ? <p className="mt-2 text-[11px] text-voice">{an.stage}</p> : null}
        {running ? (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(an.ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-voice transition-[width] duration-300" style={{ width: `${an.ratio * 100}%` }} />
          </div>
        ) : null}
        <p className="mt-2 text-[11px] text-muted-foreground">다시 분석하면 직접 편집한 노트는 초기화돼요.</p>
      </Section>

      {an.info?.fileInfo ? <NoteFileSection /> : null}

      <LyricsSection />

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
            {s.project.real ? (
              <>
                <p className="mt-3 text-[11px] text-muted-foreground">MR을 원곡 가이드와 번갈아 들으며 어긋나면 직접 옮길 수 있어요. MR이 늦게 들리면 −, 빨리 들리면 +.</p>
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  {[-0.25, -0.05, 0.05, 0.25].map((d) => (
                    <Button key={d} variant="outline" size="xs" onClick={() => a.nudgeMr(d)}>
                      {d > 0 ? '+' : '−'}
                      {Math.abs(d)}s
                    </Button>
                  ))}
                </div>
              </>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="outline" disabled={al.status === 'running' || running} onClick={() => void a.runAlign()}>
                {al.status === 'running' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {al.status === 'running' ? '정렬 중…' : '자동 정렬'}
              </Button>
              {s.project.real ? (
                <Button variant="secondary" disabled={running} onClick={() => void a.analyze(false)}>
                  보컬만 다시 분석
                </Button>
              ) : null}
            </div>
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

function MethodRow() {
  const { s, a } = useStudio()
  const info = s.analysis.info!
  const good = info.method !== 'original'
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2 text-xs">
        <span className="text-muted-foreground">분석 방식</span>
        <span className={`text-right font-medium ${good ? 'text-voice' : 'text-caution'}`}>{METHOD_LABEL[info.method]}</span>
      </div>
      {info.usingEdits ? (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-voice/40 bg-voice/10 px-3 py-2 text-xs">
          <span className="flex items-center gap-1.5 text-voice">
            <PencilLine className="size-3.5" /> 직접 편집한 노트 표시 중 · 자동 저장됨
          </span>
          <Button variant="ghost" size="xs" onClick={() => void a.discardEdits()}>
            편집 버리기
          </Button>
        </div>
      ) : null}
      {info.separated ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          보컬: AI 분리 ({info.separated.model}){info.separated.cached ? ' · 저장된 결과 사용' : info.separated.seconds ? ` · ${Math.round(info.separated.seconds)}초 걸림 (${info.separated.ep === 'webgpu' ? '그래픽카드' : 'CPU'})` : ''}
        </p>
      ) : null}
      {info.crepeUsed !== null && info.crepeUsed !== undefined ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Wand2 className="size-3" /> CREPE 값 사용 {Math.round(info.crepeUsed * 100)}% 프레임
        </p>
      ) : null}
      {info.quietDropped > 0 ? <p className="mt-1 text-[11px] text-muted-foreground">보컬이 아닌 작은 소리(전주·간주·아우트로에 남은 소리)로 생긴 노트 {info.quietDropped}개를 뺐어요. 빠진 소리가 있으면 감도를 올려 보세요.</p> : null}
      {info.syllableAdded > 0 ? <p className="mt-1 text-[11px] text-muted-foreground">음절 경계에서 노트 {info.syllableAdded}개를 나눴어요.</p> : null}
      {info.vocOffset ? <p className="mt-1 text-[11px] text-muted-foreground">보컬 파일이 원곡과 {info.vocOffset > 0 ? '+' : ''}{info.vocOffset.toFixed(2)}s 어긋나 있어서 맞췄어요.</p> : null}
    </div>
  )
}

function NoteFileSection() {
  const { s, a } = useStudio()
  const f = s.analysis.info!.fileInfo!
  const running = s.analysis.status === 'running'
  const low = f.score !== null && f.score < 0.6
  return (
    <Section title="노트 파일" hint={f.name}>
      <dl className="grid grid-cols-3 gap-2">
        <Stat label="시간 보정" value={`${f.lag >= 0 ? '+' : '−'}${Math.abs(f.lag).toFixed(2)}s`} small />
        <Stat label="보컬과 일치" value={f.score === null ? '—' : `${Math.round(f.score * 100)}%`} small />
        <Stat label="자동 채움" value={f.autofillActive ? `${f.added}개` : '끔'} small />
      </dl>
      {f.oct ? <p className="mt-2 text-[11px] text-muted-foreground">파일이 한 옥타브 {f.oct > 0 ? '낮게' : '높게'} 적혀 있어서 옮겼어요.</p> : null}
      {f.tracks > 1 ? <p className="mt-1 text-[11px] text-muted-foreground">트랙 {f.tracks}개 중 보컬과 가장 잘 맞는 트랙을 골랐어요.</p> : null}
      {low ? <p className="mt-2 text-xs text-caution">일치율이 낮아요. 다른 곡의 파일이거나 시간이 많이 어긋났을 수 있어요.</p> : null}
      <p className="mt-3 text-[11px] text-muted-foreground">노트가 보컬보다 늦으면 −, 빠르면 +로 옮겨요.</p>
      <div className="mt-2 grid grid-cols-5 gap-1.5">
        {[-0.25, -0.05, 0.05, 0.25].map((d) => (
          <Button key={d} variant="outline" size="xs" disabled={running} onClick={() => void a.nudgeNoteFile(d)}>
            {d > 0 ? '+' : '−'}
            {Math.abs(d)}
          </Button>
        ))}
        <Button variant="secondary" size="xs" disabled={running} onClick={() => void a.autoAlignNoteFile()}>
          자동
        </Button>
      </div>
    </Section>
  )
}

function LyricsSection() {
  const { s, a } = useStudio()
  const input = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const ly = s.lyrics
  return (
    <Section title="가사" hint={ly ? ly.name : '.lrc 파일'}>
      {editing && ly ? <LyricsEditor onClose={() => setEditing(false)} /> : null}
      <input ref={input} type="file" accept=".lrc,.txt,text/plain" className="sr-only" aria-label="가사 파일 선택" onChange={(e) => e.target.files?.[0] && a.setInput('lyrics', e.target.files[0])} />
      {ly ? (
        <>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {ly.lines.filter((l) => l.text).length}줄{ly.lines.some((l) => l.words?.length) ? ' · 단어별 강조' : ''}
            </span>
            <Button variant="ghost" size="xs" onClick={() => a.setInput('lyrics', null)}>
              <X /> 빼기
            </Button>
          </div>
          <Button className="mt-2 w-full" variant="secondary" onClick={() => setEditing(true)}>
            가사·독음 편집 ({ly.lines.filter((l) => l.reading).length}/{ly.lines.filter((l) => l.text || l.reading).length}줄 독음)
          </Button>
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="font-medium">전체 타이밍 보정</span>
            <span className="font-mono tabular text-muted-foreground">
              {ly.offset > 0 ? '+' : ly.offset < 0 ? '−' : '±'}
              {Math.abs(ly.offset).toFixed(1)}s
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">가사가 노래보다 빨리 나오면 +, 늦게 나오면 −로 옮겨요.</p>
          <div className="mt-2 grid grid-cols-5 gap-1.5">
            {[-0.5, -0.1, 0.1, 0.5].map((d) => (
              <Button key={d} variant="outline" size="xs" onClick={() => a.setLyricsOffset(ly.offset + d)}>
                {d > 0 ? '+' : '−'}
                {Math.abs(d)}
              </Button>
            ))}
            <Button variant="ghost" size="xs" onClick={() => a.setLyricsOffset(0)}>
              0
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button size="sm" onClick={a.attachLyricsToNotes}>
              노트에 가사 붙이기
            </Button>
            <Button size="sm" variant="outline" disabled={!s.notes.some((n) => n.lyric)} onClick={a.clearNoteLyrics}>
              노트 가사 지우기
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">각 줄의 글자를 그 시간의 노트에 한 음절씩 나눠 붙여요. 한 글자를 여러 노트로 끌면 ~로 표시돼요. 되돌리기(Ctrl+Z)도 돼요.</p>
          <ReadingPaste />
          <details className="mt-3 rounded-lg border border-border p-2.5">
            <summary className="cursor-pointer text-xs font-medium">다른 가사 찾기 (LRCLIB)</summary>
            <div className="mt-2">
              <LrclibSearch />
            </div>
          </details>
        </>
      ) : (
        <>
          <LrclibSearch />
          <div className="my-3 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            또는 파일로
            <span className="h-px flex-1 bg-border" />
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">시간이 붙은 가사 파일(.lrc)을 넣으면 피아노 롤 아래에 지금 부를 줄과 다음 줄이 떠요. 단어별 시간이 있는 확장 LRC면 단어마다 색이 바뀌어요.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => input.current?.click()}>
              <FileText /> 가사 파일 넣기
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                a.newLyrics()
                setEditing(true)
              }}
            >
              직접 입력하기
            </Button>
          </div>
        </>
      )}
    </Section>
  )
}

function SeparationSection() {
  const { s, a } = useStudio()
  const an = s.analysis
  const running = an.status === 'running'
  const sep = an.info?.separated
  const hasVocalFile = !!s.inputs.vocal
  const demo = !s.project.real
  let status: string
  if (demo) status = '데모 곡에서는 쓰지 않아요. 내 곡을 불러오면 쓸 수 있어요.'
  else if (hasVocalFile) status = `직접 넣은 보컬 파일(${s.inputs.vocal!.name})을 쓰고 있어서 AI 분리는 필요 없어요.`
  else if (sep) status = `분리 완료 · 이 보컬로 노트를 찍고, 반주(원곡 − 보컬)를 MR로 쓸 수 있어요.${sep.cached ? ' (저장된 결과)' : sep.seconds ? ` ${Math.round(sep.seconds)}초 걸림 · ${sep.ep === 'webgpu' ? '그래픽카드' : 'CPU'}` : ''}`
  else if (an.separate) status = '켜져 있지만 아직 분리하지 않았어요. 아래 버튼을 누르면 분리한 뒤 다시 분석해요.'
  else status = '꺼져 있어요. 켜고 다시 분석하면 원곡에서 보컬과 반주를 나눠요.'
  return (
    <Section title="AI 보컬 분리" hint="UVR5 · Kim_Vocal_2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="sep2" className="text-xs">
          <span className="font-medium">원곡에서 보컬·반주 나누기</span>
          <span className="block text-[11px] text-muted-foreground">보컬 파일이 없을 때 노트를 정확하게 찍고, 가이드 보컬과 MR을 만들어요</span>
        </label>
        <Switch id="sep2" checked={an.separate && !hasVocalFile && !demo} disabled={hasVocalFile || demo} onCheckedChange={(v) => a.setSeparate(!!v)} />
      </div>
      <p className={`mt-2 rounded-lg p-2.5 text-[11px] leading-relaxed ${sep ? 'bg-voice/10 text-voice' : 'bg-muted/50 text-muted-foreground'}`}>{status}</p>
      {!demo && !hasVocalFile && an.separate && !sep ? (
        <Button className="mt-2 w-full" disabled={running} onClick={() => void a.analyze(false)}>
          {running ? <Loader2 className="animate-spin" /> : null}
          {running ? an.stage : '보컬 분리하고 다시 분석'}
        </Button>
      ) : null}
      {!demo && !hasVocalFile && sep ? <SeparatedDownload title={s.project.title} /> : null}
      {!demo && !hasVocalFile && !sep ? <p className="mt-2 text-[11px] text-muted-foreground">처음 한 번 모델 64MB를 받고, 곡마다 몇 분 걸려요. 결과는 저장해 둬서 같은 곡은 바로 끝나요.</p> : null}
    </Section>
  )
}

/** 분리한 보컬·반주를 WAV로 내려받기 */
function SeparatedDownload({ title }: { title: string }) {
  const { a } = useStudio()
  const [busy, setBusy] = useState<'vocal' | 'inst' | null>(null)
  const save = async (kind: 'vocal' | 'inst') => {
    setBusy(kind)
    try {
      const blob = await realSeparatedWav(kind)
      if (!blob) {
        a.notify('분리 결과가 없어요. 다시 분석해 주세요.')
        return
      }
      const url = URL.createObjectURL(blob)
      const el = document.createElement('a')
      el.href = url
      el.download = `${title || '곡'} (${kind === 'vocal' ? '보컬' : '반주'}).wav`
      document.body.appendChild(el)
      el.click()
      el.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (e) {
      a.notify('파일을 만들지 못했어요: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="mt-2">
      <div className="grid grid-cols-2 gap-2">
        {(['vocal', 'inst'] as const).map((k) => (
          <Button key={k} size="sm" variant="outline" disabled={!!busy} onClick={() => void save(k)}>
            {busy === k ? <Loader2 className="animate-spin" /> : <Download />}
            {k === 'vocal' ? '보컬 받기' : '반주 받기'}
          </Button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">원곡 키 그대로 WAV로 받아요. 곡 하나에 수십 MB예요.</p>
    </div>
  )
}

function ReadingPaste() {
  const { a } = useStudio()
  const [text, setText] = useState('')
  return (
    <details className="mt-3 rounded-lg border border-border p-2.5">
      <summary className="cursor-pointer text-xs font-medium">독음 한꺼번에 붙여넣기</summary>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        독음을 한 줄씩 붙여넣으면 가사가 있는 줄의 독음 칸에 순서대로 들어가요(원문은 그대로). 간주(빈 줄)는 건너뛰어요. 일본어·독음·해석이 섞인 가사를 그대로 붙여넣으면 독음 줄만 골라서 일본어가 같은 줄에 넣어요. 들어간 뒤 '가사·독음 편집'에서 줄마다 확인하고 고칠 수 있어요.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder={'로스토완노 고오코쿠\n...'}
        aria-label="독음 붙여넣기"
        className="mt-2 w-full resize-y rounded-md border border-input bg-background/60 p-2 text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Button
        size="sm"
        className="mt-2 w-full"
        disabled={!text.trim()}
        onClick={() => {
          a.pasteReading(text)
          setText('')
        }}
      >
        독음 넣기
      </Button>
    </details>
  )
}
