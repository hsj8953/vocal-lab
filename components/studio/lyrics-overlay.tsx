'use client'

import { useRef } from 'react'
import { partAt } from '@/lib/duet'
import { lineAt } from '@/lib/lrc'
import { DUET_COLOR } from './canvas-utils'
import { useFrame, useStudio } from './studio-provider'

/** 피아노 롤 아래쪽에 지금 줄(밝게, 단어별 진행)과 다음 줄(흐리게)을 띄운다 */
export function LyricsOverlay() {
  const { s, live } = useStudio()
  const curEl = useRef<HTMLDivElement>(null)
  const origEl = useRef<HTMLDivElement>(null)
  const nextEl = useRef<HTMLDivElement>(null)
  const whoEl = useRef<HTMLSpanElement>(null)
  const state = useRef({ idx: -2, key: '' })
  const lyrics = s.lyrics
  const duetRef = useRef(s.duet)
  duetRef.current = s.duet

  useFrame(() => {
    const cur = curEl.current
    const nxt = nextEl.current
    if (!cur || !nxt || !lyrics) return
    const t = live.time - lyrics.offset
    const lines = lyrics.lines
    const i = lineAt(lines, t)
    // 빈 줄(간주) 이후 다음 줄이 1.5초 안에 나오면 미리 보여준다
    const next = i + 1 < lines.length ? lines[i + 1] : null
    const blank = i < 0 || !(lines[i].reading || lines[i].text)
    const key = `${lyrics.name}|${lyrics.lines.length}`
    if (i !== state.current.idx || key !== state.current.key) {
      state.current = { idx: i, key }
      cur.replaceChildren()
      const line = i >= 0 ? lines[i] : null
      // 독음이 있으면 독음을 크게, 원문은 위에 작게
      if (origEl.current) origEl.current.textContent = line?.reading ? line.text : ''
      if (line && line.reading) cur.textContent = line.reading
      else if (line && line.text) {
        if (line.words?.length) {
          for (const w of line.words) {
            const sp = document.createElement('span')
            sp.textContent = w.text
            sp.dataset.t = String(w.t)
            cur.appendChild(sp)
          }
        } else cur.textContent = line.text
      }
      nxt.textContent = next ? next.reading || next.text : ''
    }
    // 듀엣: 줄마다 누구 차례인지 색으로 (글자색 + 밑줄)
    const duet = duetRef.current
    const whoAt = (ln: { t: number } | null | undefined) => (duet.on && duet.parts.length && ln ? partAt(duet.parts, ln.t + lyrics.offset + 0.3) : null)
    const wc = whoAt(i >= 0 ? lines[i] : null)
    const wn = whoAt(next)
    const paint = (el: HTMLElement, who: ReturnType<typeof whoAt>) => {
      const c = who ? DUET_COLOR[who] : ''
      if (el.style.color !== c) el.style.color = c
      const sh = who ? `inset 0 -3px 0 ${c}` : ''
      if (el.style.boxShadow !== sh) el.style.boxShadow = sh
    }
    paint(cur, wc)
    const wb = whoEl.current
    if (wb) {
      const label = wc && !blank ? (wc === 'me' ? '나' : wc === 'orig' ? '원곡 가수' : '같이') : ''
      if (wb.textContent !== label) wb.textContent = label
      const bg = wc ? DUET_COLOR[wc] : ''
      if (wb.style.background !== bg) wb.style.background = bg
      wb.style.display = label ? '' : 'none'
    }
    paint(nxt, wn)
    if (origEl.current) paint(origEl.current, wc)
    // 단어별 강조 (듀엣이면 부른 단어를 밝은 흰색으로)
    for (const el of Array.from(cur.children) as HTMLElement[]) {
      const on = Number(el.dataset.t) <= t
      const want = on ? (wc ? 'var(--foreground)' : 'var(--voice)') : ''
      if (el.style.color !== want) el.style.color = want
    }
    const showNextOnly = blank && next && next.t - t < 3
    cur.style.opacity = blank ? '0' : '1'
    if (origEl.current) origEl.current.style.opacity = blank || !origEl.current.textContent ? '0' : '0.7'
    nxt.style.opacity = blank ? (showNextOnly ? '0.85' : '0') : '0.55'
  })

  if (!lyrics) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-14 z-10 flex flex-col items-center gap-1 px-[72px]" aria-live="off">
      <span ref={whoEl} className="rounded-full px-2.5 py-0.5 text-xs font-bold text-background" style={{ display: 'none' }} />
      <div ref={origEl} className="line-clamp-2 max-w-full rounded-md bg-stage/60 px-2 text-center text-balance text-sm text-foreground/80 sm:text-base transition-opacity duration-150" />
      <div ref={curEl} className="line-clamp-2 max-w-full rounded-lg bg-stage/75 text-balance px-4 py-1.5 text-center text-2xl font-bold text-foreground backdrop-blur transition-opacity duration-150 sm:text-3xl" />
      <div ref={nextEl} className="line-clamp-2 max-w-full rounded-md bg-stage/60 px-2.5 text-balance py-0.5 text-center text-lg font-medium text-foreground/90 sm:text-xl transition-opacity duration-150" />
    </div>
  )
}
