'use client'

import { Settings2, Users } from 'lucide-react'
import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DUET_STYLES, WHO_LABEL, myShare, type DuetWho } from '@/lib/duet'
import { cn } from '@/lib/utils'
import { DUET_COLOR } from './canvas-utils'
import { useFrame, useStudio } from './studio-provider'

/** 듀엣 모드 켜기/끄기 버튼 (재생 줄) */
export function DuetToggle() {
  const { s, a } = useStudio()
  if (!s.project.real) return null
  return (
    <Button
      type="button"
      size="sm"
      variant={s.duet.on ? 'default' : 'outline'}
      aria-pressed={s.duet.on}
      disabled={s.practice.phase !== 'idle'}
      onClick={() => a.toggleDuet(!s.duet.on)}
      title="원곡 가수와 파트를 나눠 불러요"
      className={cn(s.duet.on && 'bg-[oklch(0.72_0.16_300)] text-background hover:bg-[oklch(0.72_0.16_300)]/90')}
    >
      <Users /> 듀엣{s.duet.on ? ' 켜짐' : ''}
    </Button>
  )
}

const Dot = ({ who }: { who: DuetWho }) => <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: DUET_COLOR[who] }} />

/** 무대 오른쪽 위: 지금 누구 차례인지 + 다음 차례 + 파트 설정 */
export function DuetPanel() {
  const { s, a, live } = useStudio()
  const nowEl = useRef<HTMLSpanElement>(null)
  const nowBox = useRef<HTMLDivElement>(null)
  const nextEl = useRef<HTMLSpanElement>(null)
  const last = useRef('')
  const d = s.duet
  useFrame(() => {
    if (!d.on || !d.parts.length) return
    const t = live.time
    const i = d.parts.findIndex((p) => t >= p.t0 && t < p.t1)
    const cur = i >= 0 ? d.parts[i] : null
    // 다음에 차례가 바뀌는 곳
    let j = i + 1
    while (j > 0 && j < d.parts.length && cur && d.parts[j].who === cur.who) j++
    const nx = j > 0 && j < d.parts.length ? d.parts[j] : null
    const key = `${cur?.who}|${nx?.who}|${nx ? Math.ceil(nx.t0 - t) : ''}`
    if (key === last.current) return
    last.current = key
    if (nowEl.current) nowEl.current.textContent = cur ? (cur.who === 'me' ? '내 차례' : cur.who === 'orig' ? '원곡 가수 차례' : '같이 불러요') : ''
    if (nowBox.current && cur) {
      nowBox.current.style.background = DUET_COLOR[cur.who]
    }
    if (nextEl.current) {
      const sec = nx ? Math.max(0, nx.t0 - t) : 0
      nextEl.current.textContent = nx ? `다음 ${WHO_LABEL[nx.who]}${sec < 10 ? ` · ${Math.ceil(sec)}초 뒤` : ''}` : ''
    }
  })
  if (!d.on) return null
  const share = Math.round(myShare(d.parts, s.notes) * 100)
  return (
    <div className="absolute top-3 right-3 z-20 flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <div ref={nowBox} className="rounded-full px-3.5 py-1.5 text-sm font-bold text-background shadow-lg" style={{ background: DUET_COLOR.orig }} role="status" aria-live="polite">
          <span ref={nowEl}>원곡 가수 차례</span>
        </div>
        <Popover>
          <PopoverTrigger render={<Button size="icon-sm" variant="secondary" aria-label="듀엣 파트 설정" title="파트 나누기 설정" />}>
            <Settings2 />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <p className="text-sm font-semibold">파트 나누기</p>
            <div className="grid gap-1.5">
              {DUET_STYLES.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  aria-pressed={d.style === st.id}
                  onClick={() => a.setDuetStyle(st.id)}
                  disabled={s.practice.phase !== 'idle'}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors',
                    d.style === st.id ? 'border-voice bg-voice/10' : 'border-border hover:bg-muted',
                  )}
                >
                  <span className="font-semibold">{st.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{st.desc}</span>
                </button>
              ))}
            </div>
            <p className="text-xs">
              내 파트 <b className="font-mono">{share}%</b> <span className="text-muted-foreground">(같이 부르는 곳은 절반으로 셈)</span>
            </p>
            <div className="flex flex-wrap gap-3 text-[11px]">
              {(['me', 'orig', 'both'] as DuetWho[]).map((w) => (
                <span key={w} className="flex items-center gap-1.5">
                  <Dot who={w} /> {WHO_LABEL[w]}
                </span>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              피아노 롤 맨 아래 색 띠를 누르면 그 소절이 나 → 원곡 가수 → 같이 순서로 바뀌어요. 방식을 다시 고르면 자동으로 다시 나눠요. 나눈 파트는 곡에 저장돼요.
            </p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">원곡 가수 파트는 분리한 원곡 보컬이 나오고, 채점은 내 파트와 같이 부르는 파트만 해요.</p>
          </PopoverContent>
        </Popover>
      </div>
      <span ref={nextEl} className="rounded-md bg-stage/70 px-2 py-0.5 text-[11px] text-foreground/90" />
    </div>
  )
}
