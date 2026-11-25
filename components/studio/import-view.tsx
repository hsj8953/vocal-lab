'use client'

import { AudioLines, Check, FileMusic, FileText, Library, Loader2, Mic2, Music2, Pencil, Play, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { loadHistory, songKey } from '@/lib/history'
import { listSongs, storageUsage, type LibSong } from '@/lib/library'
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
  { kind: 'lyrics', title: '가사', desc: '.lrc 파일 — 없으면 스튜디오 분석 탭에서 LRCLIB로 바로 찾을 수 있어요', accept: '.lrc,.txt,text/plain', icon: FileText },
]

function fmtSize(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}GB`
  return n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)}MB` : `${Math.round(n / 1000)}KB`
}

export function ImportView() {
  const { s, a } = useStudio()
  const running = s.analysis.status === 'running'
  const canStart = !!s.inputs.original?.file || !!s.inputs.noteFile?.file

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
    <LibraryList />
    <div className="grid w-full gap-10 lg:grid-cols-[1fr_minmax(0,520px)] lg:items-center lg:gap-16 lg:py-6">
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
        <p className="text-center text-[11px] text-muted-foreground">분석이 끝나면 내 곡 목록에 자동으로 저장돼요.</p>
      </div>
    </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 내 곡 목록                                                            */
/* ------------------------------------------------------------------ */

const KIND_LABEL: Record<string, string> = { original: '원곡', mr: 'MR', vocal: '보컬', noteFile: '노트', lyrics: '가사' }

function ago(t: number) {
  const d = (Date.now() - t) / 1000
  if (d < 60) return '방금'
  if (d < 3600) return `${Math.floor(d / 60)}분 전`
  if (d < 86400) return `${Math.floor(d / 3600)}시간 전`
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}일 전`
  return new Date(t).toLocaleDateString()
}

function LibraryList() {
  const { s } = useStudio()
  const [songs, setSongs] = useState<LibSong[] | null>(null)
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null)
  useEffect(() => {
    let alive = true
    void listSongs().then((l) => alive && setSongs(l))
    void storageUsage().then((u) => alive && setUsage(u))
    return () => {
      alive = false
    }
  }, [s.libraryRev])
  if (!songs || !songs.length) return null
  return (
    <section className="rise-in mb-10" aria-labelledby="lib-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="lib-title" className="flex items-center gap-2 text-lg font-bold">
          <Library className="size-5 text-voice" /> 내 곡 <span className="font-mono text-sm font-normal text-muted-foreground">{songs.length}</span>
        </h2>
        {usage ? (
          <span className="text-[11px] text-muted-foreground">
            이 브라우저에 저장 · {fmtSize(usage.used)} 사용{usage.quota ? ` / 약 ${fmtSize(usage.quota)}` : ''}
          </span>
        ) : null}
      </div>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {songs.map((x) => (
          <SongCard key={x.id} song={x} />
        ))}
      </ul>
    </section>
  )
}

function SongCard({ song }: { song: LibSong }) {
  const { s, a } = useStudio()
  const [mode, setMode] = useState<'view' | 'rename' | 'delete'>('view')
  const [name, setName] = useState(song.title)
  const hist = typeof window === 'undefined' ? [] : loadHistory(songKey(song.projTitle, song.duration))
  const best = hist.length ? Math.max(...hist.map((h) => h.score)) : null
  const lastAt = hist.length ? hist[hist.length - 1].at : null
  const opening = s.libraryOpening === song.id
  const busy = s.analysis.status === 'running' || !!s.libraryOpening
  const current = s.librarySongId === song.id && s.project.real
  const key = song.settings.keyShift ?? 0
  return (
    <li className={cn('flex flex-col rounded-2xl border bg-card p-4', current ? 'border-voice/50' : 'border-border')}>
      {mode === 'rename' ? (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            void a.renameLibrarySong(song.id, name)
            setMode('view')
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="곡 이름"
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background/60 px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" size="icon-sm" aria-label="이름 저장">
            <Check />
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="취소" onClick={() => setMode('view')}>
            <X />
          </Button>
        </form>
      ) : (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold" title={song.title}>
              {song.title}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {Math.floor(song.duration / 60)}:{String(Math.round(song.duration % 60)).padStart(2, '0')} · 키 {key > 0 ? `+${key}` : key} · {fmtSize(song.bytes)}
            </p>
          </div>
          {current ? <span className="shrink-0 rounded bg-voice/15 px-1.5 py-0.5 text-[10px] font-semibold text-voice">열려 있음</span> : null}
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap gap-1">
        {(['original', 'mr', 'vocal', 'noteFile', 'lyrics'] as const).map((k) =>
          song.files[k] ? (
            <span key={k} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" title={song.files[k]!.name}>
              {KIND_LABEL[k]}
            </span>
          ) : null,
        )}
      </div>
      <p className="mt-2.5 text-xs text-muted-foreground">
        {lastAt ? (
          <>
            마지막 연습 {ago(lastAt)} · 최고 <b className="font-mono text-foreground">{best}</b>점 · {hist.length}번
          </>
        ) : (
          <>아직 연습 기록이 없어요 · 열어 본 지 {ago(song.opened)}</>
        )}
      </p>
      {mode === 'delete' ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-miss/10 p-2 text-xs">
          <span className="flex-1 text-miss">목록에서 지울까요?</span>
          <Button
            size="xs"
            variant="destructive"
            onClick={() => {
              void a.deleteLibrarySong(song.id)
              setMode('view')
            }}
          >
            지우기
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setMode('view')}>
            취소
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-1.5">
          <Button size="sm" className="flex-1" disabled={busy} onClick={() => void a.openLibrarySong(song.id)}>
            {opening ? <Loader2 className="animate-spin" /> : <Play />}
            {opening ? `${s.analysis.stage || '여는 중'}… ${Math.round(s.analysis.ratio * 100)}%` : '열기'}
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={`${song.title} 이름 바꾸기`} onClick={() => setMode('rename')} disabled={busy}>
            <Pencil />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={`${song.title} 지우기`} onClick={() => setMode('delete')} disabled={busy}>
            <Trash2 />
          </Button>
        </div>
      )}
    </li>
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
