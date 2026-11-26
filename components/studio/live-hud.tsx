'use client'

import { Mic, MicOff } from 'lucide-react'
import { useRef } from 'react'
import * as engine from '@/lib/engine'
import { clamp, fmtCents, noteName } from '@/lib/music'
import { Button } from '@/components/ui/button'
import { useFrame, useStudio } from './studio-provider'

const TIER_VAR = { great: 'var(--voice)', ok: 'var(--caution)', off: 'var(--miss)' } as const
const TIER_TEXT = { great: '±50¢ 이내 · 정확', ok: '±100¢ 이내 · 조금 어긋남', off: '±100¢ 벗어남' } as const

function setText(el: HTMLElement | null, v: string) {
  if (el && el.textContent !== v) el.textContent = v
}

export function LiveHud() {
  const { s, a, live } = useStudio()
  const targetEl = useRef<HTMLSpanElement>(null)
  const userEl = useRef<HTMLSpanElement>(null)
  const diffEl = useRef<HTMLSpanElement>(null)
  const noteEl = useRef<HTMLSpanElement>(null)
  const tierEl = useRef<HTMLSpanElement>(null)
  const needle = useRef<HTMLDivElement>(null)
  const peakWrap = useRef<HTMLDivElement>(null)
  const peakText = useRef<HTMLSpanElement>(null)

  useFrame(() => {
    const t = live.time
    const target = live.playing ? engine.noteAt(live.notes, t) : null
    const tShown = target ? target.midi + live.shift : null
    const c = live.cmp
    setText(targetEl.current, tShown !== null ? noteName(tShown, live.notation) : '—')
    const on = live.micOn || live.replay
    setText(userEl.current, on && live.pitchMidi !== null ? noteName(live.pitchMidi, live.notation) : '—')

    let msg = live.replay ? '녹음 다시 보기' : live.micOn ? '목소리를 기다리는 중' : '마이크 꺼짐'
    let color = 'var(--muted-foreground)'
    let diff = '—'
    if (c) {
      diff = fmtCents(c.cents)
      color = TIER_VAR[c.tier]
      msg = c.octaveOff !== 0 ? `${c.octaveOff < 0 ? '한 옥타브 낮게' : '한 옥타브 높게'} 부르는 중 · 음이름만 비교` : `${TIER_TEXT[c.tier]}`
    } else if (on && live.playing && !target) msg = '쉬는 구간'
    else if (live.replay && !live.playing) msg = '녹음 다시 보기 · 일시정지'
    else if (live.micOn && !live.playing) msg = '재생하면 비교를 시작해요'
    setText(diffEl.current, diff)
    setText(tierEl.current, msg)
    if (diffEl.current) diffEl.current.style.color = color
    if (tierEl.current) tierEl.current.style.color = color
    if (needle.current) {
      needle.current.style.opacity = c ? '1' : '0.25'
      needle.current.style.left = `${50 + (clamp(c ? c.cents : 0, -150, 150) / 300) * 100}%`
      needle.current.style.background = color
    }
    if (noteEl.current && target) setText(noteEl.current, target.lyric ? `‘${target.lyric}’` : '')
    else setText(noteEl.current, '')

    const peak = engine.upcomingPeak(live.notes, t, 10)
    let show = false
    if (peak && peak.start > t + 0.2 && live.playing) {
      let songHigh = -Infinity
      for (const n of live.notes) songHigh = Math.max(songHigh, n.midi)
      const sh = peak.midi + live.shift
      const over = sh - live.userRange.high
      if (peak.midi >= songHigh - 1.5 || over > -0.5) {
        show = true
        const sec = peak.start - t
        const where = over > 0.5 ? `내 최고음보다 ${Math.round(over)}반음 높아요` : over > -0.5 ? '내 최고음 근처' : '내 음역 안'
        setText(peakText.current, `${sec.toFixed(1)}초 뒤 ${noteName(sh, live.notation)} · ${where}`)
        if (peakWrap.current) peakWrap.current.style.color = over > 0.5 ? 'var(--miss)' : 'var(--caution)'
      }
    }
    if (peakWrap.current) {
      peakWrap.current.style.opacity = show ? '1' : '0'
      peakWrap.current.style.transform = show ? 'translateY(0)' : 'translateY(-6px)'
    }
  })

  return (
    <>
      <div className="pointer-events-none absolute top-2 left-[64px] right-2 z-10 flex flex-wrap items-start gap-2 sm:left-[68px]">
        <div className="pointer-events-auto flex min-w-0 items-stretch gap-3 rounded-xl border border-border bg-stage/85 p-2.5 pr-3 backdrop-blur-md">
          <div className="flex items-end gap-4">
            <Metric label="불러야 할 음" valueRef={targetEl} sub={noteEl} wide />
            <Metric label="내 음" valueRef={userEl} wide={s.notation === 'korean'} />
            <div className="w-[84px] shrink-0">
              <div className="text-[10px] font-medium text-muted-foreground">차이</div>
              <span ref={diffEl} className="block font-mono text-[22px] leading-7 font-semibold whitespace-nowrap tabular" aria-live="off">
                —
              </span>
            </div>
          </div>
          <div className="hidden w-[168px] flex-col justify-end gap-1.5 sm:flex">
            <div className="relative h-2.5 rounded-full bg-muted/70" role="presentation">
              <div className="absolute inset-y-0 left-[16.67%] w-[66.66%] rounded-full bg-foreground/[0.07]" />
              <div className="absolute inset-y-0 left-[33.33%] w-[33.34%] rounded-full bg-voice/25" />
              <div className="absolute inset-y-[-3px] left-1/2 w-px bg-foreground/50" />
              <div ref={needle} className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25 transition-[opacity] duration-150" style={{ left: '50%' }} />
            </div>
            <div className="flex justify-between font-mono text-[9px] text-muted-foreground">
              <span>−150¢</span>
              <span>0</span>
              <span>+150¢</span>
            </div>
          </div>
        </div>
        <div className="pointer-events-auto flex items-center gap-2 self-center">
          <Button
            type="button"
            size="sm"
            variant={s.mic.on ? 'secondary' : 'outline'}
            onClick={a.toggleMic}
            aria-pressed={s.mic.on}
            className={s.mic.on ? 'rec-pulse border-voice/50 text-voice' : ''}
          >
            {s.mic.on ? <Mic /> : <MicOff />}
            {s.mic.on ? (s.mic.mode === 'demo' ? '데모 보컬 켜짐' : '마이크 켜짐') : '마이크 켜기'}
          </Button>
        </div>
      </div>
      <div className="pointer-events-none absolute top-2 left-0 z-10 hidden w-full justify-center xl:flex">
        <span ref={tierEl} className="sr-only" aria-live="polite" />
      </div>
      <div
        ref={peakWrap}
        className="pointer-events-none absolute bottom-3 left-[68px] z-10 flex items-center gap-2 rounded-full border border-current/40 bg-stage/90 px-3 py-1.5 text-xs font-semibold backdrop-blur transition-[opacity,transform] duration-200"
        style={{ opacity: 0 }}
        role="status"
      >
        <span aria-hidden>▲</span>
        <span ref={peakText} />
      </div>
    </>
  )
}

/** 값이 바뀌어도 칸 너비가 변하지 않게 고정 폭으로 그린다 (실시간 갱신 시 HUD가 흔들리지 않도록) */
function Metric({ label, valueRef, sub, wide }: { label: string; valueRef: React.RefObject<HTMLSpanElement | null>; sub?: React.RefObject<HTMLSpanElement | null>; wide?: boolean }) {
  return (
    <div className={`relative shrink-0 ${wide ? 'w-[104px]' : 'w-[72px]'}`}>
      <div className="flex items-baseline gap-1.5 text-[10px] font-medium whitespace-nowrap text-muted-foreground">
        <span className="shrink-0">{label}</span>
        {sub ? <span ref={sub} className="min-w-0 truncate text-[11px] font-semibold text-foreground/80" /> : null}
      </div>
      <span ref={valueRef} className="block overflow-hidden font-mono text-[22px] leading-7 font-semibold whitespace-nowrap tabular">
        —
      </span>
    </div>
  )
}
