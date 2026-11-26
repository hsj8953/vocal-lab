'use client'

import { Check, Loader2, Search } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { guessQuery, rankRecords, searchLrclib, type LrclibRecord } from '@/lib/lrclib'
import { fmtTime } from '@/lib/music'
import { cn } from '@/lib/utils'
import { useStudio } from './studio-provider'

/** LRCLIB에서 싱크 가사 검색 → 골라서 바로 불러오기 */
export function LrclibSearch() {
  const { s, a } = useStudio()
  const [q, setQ] = useState(() => guessQuery(s.inputs.original?.name ?? s.project.title))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [list, setList] = useState<LrclibRecord[] | null>(null)
  const dur = s.project.real ? s.project.duration : undefined

  const run = async () => {
    if (!q.trim()) return
    setBusy(true)
    setErr(null)
    try {
      setList(rankRecords(await searchLrclib({ q: q.trim() }), dur))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'LRCLIB에 연결하지 못했어요.')
      setList(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="가수 제목 (예: ロストワンの号哭 Neru)"
          aria-label="LRCLIB 검색어"
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background/60 px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={busy || !q.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Search />}
          찾기
        </Button>
      </form>
      <p className="mt-1 text-[10px] text-muted-foreground">
        가사 출처:{' '}
        <a href="https://lrclib.net" target="_blank" rel="noreferrer" className="underline underline-offset-2">
          LRCLIB
        </a>{' '}
        (사용자들이 올린 공개 싱크 가사)
      </p>
      {err ? <p className="mt-2 text-xs text-caution">{err}</p> : null}
      {list ? (
        list.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">찾은 가사가 없어요. 원래 제목(일본어 등)이나 가수 이름으로 검색해 보세요.</p>
        ) : (
          <ul className="scroll-thin mt-2 max-h-64 space-y-1 overflow-y-auto">
            {list.slice(0, 12).map((r) => {
              const diff = dur ? r.duration - dur : null
              const close = diff !== null && Math.abs(diff) <= 3
              const usable = !!r.syncedLyrics && !r.instrumental
              const chosen = s.lyrics?.name === `LRCLIB · ${r.artistName} - ${r.trackName}`
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={!usable}
                    onClick={() => a.setLyricsText(`LRCLIB · ${r.artistName} - ${r.trackName}`, r.syncedLyrics!)}
                    className={cn(
                      'w-full rounded-lg border px-2.5 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                      chosen ? 'border-voice bg-voice/10' : 'border-border hover:bg-accent',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="line-clamp-2 font-semibold break-words">{r.trackName}</span>
                      {chosen ? <Check className="size-3.5 shrink-0 text-voice" /> : null}
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="line-clamp-2 break-words">
                        {r.artistName}
                        {r.albumName ? ` · ${r.albumName}` : ''}
                      </span>
                      <span className={cn('shrink-0 font-mono tabular', close && 'text-voice')}>
                        {fmtTime(r.duration)}
                        {diff !== null ? ` (${diff > 0 ? '+' : ''}${Math.round(diff)}s)` : ''}
                      </span>
                    </div>
                    {!usable ? <div className="mt-0.5 text-[10px]">{r.instrumental ? '연주곡' : '싱크 없는 가사라 쓸 수 없어요'}</div> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )
      ) : null}
      {list && dur ? <p className="mt-1.5 text-[10px] text-muted-foreground">곡 길이가 내 파일과 3초 안으로 비슷한 것(초록 시간)이 타이밍이 맞을 가능성이 높아요.</p> : null}
    </div>
  )
}
