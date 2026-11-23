'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { audioContext } from '@/lib/engine'
import { cn } from '@/lib/utils'
import { useStudio } from './studio-provider'

/**
 * 탭으로 싱크 맞추기
 * 메트로놈 소리를 들으며 박자에 맞춰 버튼(또는 스페이스바)을 누르면,
 * "소리를 예약한 시각 → 실제로 귀에 들린 시각"의 차이(A)를 잰다.
 * 화면 시간 = 재생 위치 − 출력 지연(브라우저 보고값) + 싱크 이므로, 싱크 = 보고값 − A.
 */

const BPM = 90
const BEATS = 20
const WARMUP = 4

type Phase = 'idle' | 'running' | 'done'

export function SyncCalibrate({ onClose }: { onClose: () => void }) {
  const { s, a } = useStudio()
  const [phase, setPhase] = useState<Phase>('idle')
  const [count, setCount] = useState(0)
  const [beatNo, setBeatNo] = useState(0)
  const [result, setResult] = useState<{ heardMs: number; reportedMs: number; syncMs: number; spreadMs: number; n: number } | null>(null)
  const beats = useRef<number[]>([])
  const taps = useRef<number[]>([])
  const ctxRef = useRef<AudioContext | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }
  useEffect(() => stop, [])

  const start = async () => {
    a.pause()
    const ctx = audioContext()
    await ctx.resume().catch(() => {})
    ctxRef.current = ctx
    const iv = 60 / BPM
    const t0 = ctx.currentTime + 0.8
    beats.current = []
    taps.current = []
    for (let i = 0; i < BEATS; i++) {
      const t = t0 + i * iv
      beats.current.push(t)
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = i % 4 === 0 ? 1500 : 1000
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.5, t + 0.002)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.06)
      o.connect(g).connect(ctx.destination)
      o.start(t)
      o.stop(t + 0.08)
    }
    setCount(0)
    setBeatNo(0)
    setResult(null)
    setPhase('running')
    stop()
    timer.current = setInterval(() => {
      const now = ctx.currentTime
      const n = beats.current.filter((b) => b <= now).length
      setBeatNo(n)
      if (now > beats.current[BEATS - 1] + 0.5) {
        stop()
        finish()
      }
    }, 50)
  }

  const tap = (eventTimeStamp: number) => {
    const ctx = ctxRef.current
    if (!ctx || phase !== 'running') return
    // 이벤트가 발생한 순간의 오디오 시계 시각
    const t = ctx.currentTime - Math.max(0, performance.now() - eventTimeStamp) / 1000
    taps.current.push(t)
    setCount((c) => c + 1)
  }

  const finish = () => {
    const ctx = ctxRef.current!
    const iv = 60 / BPM
    const d: number[] = []
    for (const t of taps.current) {
      let best = Infinity
      let bi = -1
      beats.current.forEach((b, i) => {
        if (Math.abs(t - b) < Math.abs(best)) {
          best = t - b
          bi = i
        }
      })
      if (bi >= WARMUP && Math.abs(best) < iv * 0.45) d.push(best)
    }
    if (d.length < 6) {
      setResult(null)
      setPhase('done')
      return
    }
    d.sort((x, y) => x - y)
    const med = d[d.length >> 1]
    const dev = d.map((x) => Math.abs(x - med)).sort((x, y) => x - y)
    const spread = dev[dev.length >> 1]
    const reported = ((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000
    const heard = med * 1000
    setResult({ heardMs: Math.round(heard), reportedMs: Math.round(reported), syncMs: Math.round((reported - heard) / 5) * 5, spreadMs: Math.round(spread * 1000), n: d.length })
    setPhase('done')
  }

  useEffect(() => {
    if (phase !== 'running') return
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) tap(e.timeStamp)
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  return (
    <div className="mt-3 rounded-lg border border-border bg-background/50 p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold">탭으로 싱크 맞추기</h3>
        <button type="button" onClick={onClose} className="text-[11px] text-muted-foreground hover:text-foreground">
          닫기
        </button>
      </div>
      {phase === 'idle' ? (
        <>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            이어폰·스피커로 메트로놈이 {BEATS}번 울려요. 처음 {WARMUP}번은 듣기만 하고, 그다음부터 <b className="text-foreground">소리에 맞춰</b> 아래 버튼이나 스페이스바를 눌러 주세요. 화면은 보지 말고 귀로만 맞추세요.
          </p>
          <Button className="mt-3 w-full" onClick={() => void start()}>
            시작
          </Button>
        </>
      ) : null}
      {phase === 'running' ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            {beatNo <= WARMUP ? `듣기만 하세요 · ${Math.max(0, WARMUP - beatNo)}박 뒤 시작` : '소리에 맞춰 누르세요'} · 누른 횟수 {count}
          </p>
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault()
              tap(e.timeStamp)
            }}
            className={cn(
              'mt-3 h-20 w-full touch-manipulation rounded-xl border-2 text-sm font-semibold select-none transition-colors',
              beatNo > WARMUP ? 'border-voice bg-voice/15 text-voice active:bg-voice/30' : 'border-border text-muted-foreground',
            )}
          >
            여기를 탭 (또는 스페이스바)
          </button>
        </>
      ) : null}
      {phase === 'done' ? (
        result ? (
          <>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">실제로 들린 지연</dt>
              <dd className="text-right font-mono tabular">{result.heardMs}ms</dd>
              <dt className="text-muted-foreground">브라우저가 알려준 지연</dt>
              <dd className="text-right font-mono tabular">{result.reportedMs}ms</dd>
              <dt className="text-muted-foreground">탭 흔들림</dt>
              <dd className={cn('text-right font-mono tabular', result.spreadMs > 50 && 'text-caution')}>±{result.spreadMs}ms</dd>
            </dl>
            {result.spreadMs > 50 ? <p className="mt-2 text-[11px] text-caution">탭 간격이 고르지 않았어요. 한 번 더 해 보면 더 정확해져요.</p> : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => void start()}>
                다시 하기
              </Button>
              <Button
                onClick={() => {
                  a.setSyncMs(result.syncMs)
                  a.notify(`싱크를 ${result.syncMs > 0 ? '+' : ''}${result.syncMs}ms로 맞췄어요.`)
                  onClose()
                }}
              >
                {result.syncMs > 0 ? '+' : ''}
                {result.syncMs}ms 적용
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">현재 {s.syncMs > 0 ? '+' : ''}{s.syncMs}ms · 적용 후 노래와 노트가 아직 어긋나면 위 슬라이더로 조금씩 다듬어 주세요.</p>
          </>
        ) : (
          <>
            <p className="mt-1 text-xs text-caution">탭이 너무 적었어요. 4박 뒤부터 소리에 맞춰 6번 이상 눌러 주세요.</p>
            <Button className="mt-3 w-full" onClick={() => void start()}>
              다시 하기
            </Button>
          </>
        )
      ) : null}
    </div>
  )
}
