'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as engine from '@/lib/engine'
import type { FitInfo, Player, RangeSummary } from '@/lib/engine'
import { createActions, type Actions } from './studio-actions'
import { createInitialState, createLive, type Live, type StudioState } from './studio-types'

export interface Derived {
  summary: RangeSummary | null
  octave: -12 | 0 | 12
  /** 키 + 옥타브 합산 반음 이동량 */
  shift: number
  recommended: { key: number; octave: -12 | 0 | 12 }
  fit: FitInfo | null
}

type FrameCb = (now: number) => void

interface Ctx {
  s: StudioState
  d: Derived
  a: Actions
  live: Live
  /** 프레임마다 호출될 콜백 등록 (rAF 하나를 공유) */
  subscribe: (cb: FrameCb) => () => void
}

const StudioContext = createContext<Ctx | null>(null)

export function useStudio() {
  const c = useContext(StudioContext)
  if (!c) throw new Error('StudioProvider 안에서 사용하세요')
  return c
}

/** 매 프레임 실행되는 콜백을 등록한다. 최신 클로저를 쓰려면 ref 안에서 읽을 것 */
export function useFrame(cb: FrameCb) {
  const { subscribe } = useStudio()
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => subscribe((n) => ref.current(n)), [subscribe])
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<StudioState>(createInitialState)
  const sRef = useRef(s)
  sRef.current = s

  const live = useRef<Live>(null as unknown as Live)
  if (!live.current) live.current = createLive()
  const playerRef = useRef<Player | null>(null)
  const recorder = useRef(engine.createRecorder())
  const demoScript = useRef<(() => number | null) | null>(null)
  const pendingPlay = useRef(false)
  const subs = useRef(new Set<FrameCb>())
  const bufCache = useRef(new Map<string, AudioBuffer>())

  const a = useMemo(
    () =>
      createActions({
        sRef,
        setS,
        live: live.current,
        playerRef,
        recorder: recorder.current,
        demoScript,
        pendingPlay,
      }),
    [],
  )

  const summary = useMemo(() => engine.summarizeNotes(s.notes), [s.notes])
  const d = useMemo<Derived>(() => {
    const octave = engine.resolveOctave(summary, s.userRange, s.keyShift, s.octaveMode)
    const shift = s.keyShift + octave
    return {
      summary,
      octave,
      shift,
      recommended: engine.recommendKey(summary, s.userRange, s.octaveMode),
      fit: summary ? engine.evaluateFit(summary, s.userRange, shift) : null,
    }
  }, [summary, s.userRange, s.keyShift, s.octaveMode])

  const L = live.current
  L.notes = s.notes
  L.shift = d.shift
  L.duration = s.project.duration
  L.userRange = s.userRange
  L.selection = new Set(s.selection)
  L.notation = s.notation
  L.edit = s.view === 'studio' && s.railTab === 'edit'
  L.tool = s.tool
  L.micOn = s.mic.on

  const subscribe = useCallback((cb: FrameCb) => {
    subs.current.add(cb)
    return () => {
      subs.current.delete(cb)
    }
  }, [])

  /* 플레이어 · 프레임 루프 · 마이크 구독 */
  useEffect(() => {
    const player = engine.createPlayer()
    playerRef.current = player
    player.setVolume(sRef.current.muted ? 0 : sRef.current.volume)
    player.onEnded(() => {
      live.current.playing = false
      setS((p) => ({ ...p, playing: false }))
    })
    const off = engine.onPitch((f) => a.handlePitch(f))
    let raf = 0
    const loop = (now: number) => {
      const l = live.current
      l.playing = player.isPlaying()
      l.time = player.getTime() + sRef.current.syncMs / 1000
      subs.current.forEach((cb) => cb(now))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      off()
      engine.stopMic()
      player.dispose()
      playerRef.current = null
    }
  }, [a])

  /* 오디오 버퍼: 소스 · 키가 바뀔 때만 합성 */
  const total = d.shift
  const songKey = `${s.project.title}|${s.project.duration}`
  const bufKey = s.source === 'original' ? `${songKey}|${s.source}|${total}|${s.notesRev}` : `${songKey}|${s.source}|${total}`
  useEffect(() => {
    let cancelled = false
    const p = playerRef.current
    if (!p) return
    const delay = s.source === 'original' && s.notesRev > 0 ? 300 : 0
    const timer = setTimeout(async () => {
      let buf = bufCache.current.get(bufKey)
      if (!buf) {
        setS((x) => ({ ...x, bufferStatus: 'loading' }))
        const st = sRef.current
        buf = await engine.buildPitchShiftedBuffer({ notes: st.notes, duration: st.project.duration, bpm: st.project.bpm }, st.source, total)
        bufCache.current.set(bufKey, buf)
        if (bufCache.current.size > 8) bufCache.current.delete(bufCache.current.keys().next().value as string)
      }
      if (cancelled) return
      p.load(buf)
      setS((x) => ({ ...x, bufferStatus: 'ready' }))
      if (pendingPlay.current) {
        pendingPlay.current = false
        void a.play()
      }
    }, delay)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bufKey, a])

  /* 연습 기록 스냅샷 */
  useEffect(() => {
    if (!s.mic.on || !s.playing) return
    const id = setInterval(() => a.flushSession(), 400)
    return () => {
      clearInterval(id)
      a.flushSession()
    }
  }, [s.mic.on, s.playing, a])

  /* 키보드 단축키 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const st = sRef.current
      if (st.view !== 'studio') return
      const mod = e.metaKey || e.ctrlKey
      if (e.code === 'Space' && !(el && el.tagName === 'BUTTON')) {
        e.preventDefault()
        a.togglePlay()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        a.skip(-5)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        a.skip(5)
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) a.redo()
        else a.undo()
      } else if (st.railTab === 'edit') {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          a.deleteSelected()
        } else if (!mod) {
          const k = e.key.toLowerCase()
          if (k === 'v') a.setTool('select')
          else if (k === 'a') a.setTool('add')
          else if (k === 'c') a.setTool('cut')
          else if (k === 'm') a.mergeSelected()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [a])

  const value = useMemo<Ctx>(() => ({ s, d, a, live: live.current, subscribe }), [s, d, a, subscribe])
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
}
