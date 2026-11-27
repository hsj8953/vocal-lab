'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as engine from '@/lib/engine'
import * as tabSession from '@/lib/tab-session'
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
  /* 원곡 보컬 음 선 — 노트 옥타브에 맞춰 정리 (노트를 고칠 때마다 다시) */
  const origCurve = useMemo(() => {
    if (!s.project.real || s.analysis.status !== 'done') return null
    const c = engine.realOrigCurve()
    return c ? { ...c, midi: engine.foldCurveToNotes(c, s.notes) } : null
  }, [s.project.real, s.analysis.status, s.notes])
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
  L.origCurve = origCurve
  L.origLine = s.showOrigLine && (L.edit || s.origLineAlways)
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
    player.onSpeedProgress((r) => setS((p) => (p.speedBusy === r ? p : { ...p, speedBusy: r })))
    player.onEnded(() => {
      live.current.playing = false
      setS((p) => ({ ...p, playing: false }))
      if (sRef.current.practice.phase === 'running') a.finishPractice()
    })
    const off = engine.onPitch((f) => a.handlePitch(f))
    let raf = 0
    const loop = (now: number) => {
      const l = live.current
      l.playing = player.isPlaying()
      l.time = player.getTime() + (sRef.current.syncMs / 1000) * player.getSpeed()
      const st = sRef.current
      // 녹음 다시 보기: 지금 시각에 녹음 때 그린 음을 HUD와 구슬에 보여 준다
      if (l.replay && l.replayTrace) {
        const tr = l.replayTrace
        let lo = 0
        let hi = tr.length - 1
        while (lo < hi) {
          const m = (lo + hi + 1) >> 1
          if (tr[m].t <= l.time) lo = m
          else hi = m - 1
        }
        const pt = tr[lo]
        if (pt && pt.midi !== null && l.time - pt.t < 0.08 && pt.t <= l.time) {
          l.pitchMidi = pt.midi
          const target = engine.noteAt(l.notes, pt.t)
          l.cmp = target ? engine.compareFrame(target.midi + l.shift, pt.midi) : null
          l.targetNoteId = target?.id ?? null
        } else {
          l.pitchMidi = null
          l.cmp = null
        }
      }
      if (l.playing) {
        // 연습: 마지막 노트가 끝나면 자동으로 결과로
        if (st.practice.phase === 'running' && l.time >= st.practice.t1) a.finishPractice()
        // 소절 반복
        else if (st.loop && st.view === 'studio' && l.time >= st.loop.b + 0.4) a.seek(Math.max(0, st.loop.a - 0.3))
      }
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
  // 반주는 '키'만큼만 옮긴다. 옥타브(±12)는 내가 한 옥타브 낮게/높게 부른다는 뜻이라 노트 표시에만 쓴다
  const isReal = s.project.real
  const total = isReal ? s.keyShift : d.shift
  const songKey = `${s.project.title}|${s.project.duration}|${isReal ? 'real' : 'demo'}`
  // 실제 곡: 키·소스·MR 오프셋이 바뀔 때만 새로 만든다 (노트 편집과는 무관)
  const bufKey = isReal
    ? `${songKey}|${s.source}|${total}|${s.source === 'mr' ? s.align.result?.offsetMs ?? 0 : ''}`
    : s.source === 'original'
      ? `${songKey}|${s.source}|${total}|${s.notesRev}`
      : `${songKey}|${s.source}|${total}`
  useEffect(() => {
    let cancelled = false
    const p = playerRef.current
    if (!p) return
    const delay = !isReal && s.source === 'original' && s.notesRev > 0 ? 300 : 0
    const timer = setTimeout(async () => {
      let buf = isReal ? undefined : bufCache.current.get(bufKey)
      if (!buf) {
        setS((x) => ({ ...x, bufferStatus: 'loading', bufferMsg: null }))
        const st = sRef.current
        if (isReal) {
          const label = total === 0 ? '' : `${total > 0 ? '+' : '−'}${Math.abs(total)}키 변환 중`
          const b = await engine.realTrackBuffer(st.source, total, (pr, eta) => {
            if (!cancelled) setS((x) => ({ ...x, bufferMsg: `${label} ${Math.round(pr * 100)}%${eta}` }))
          })
          if (!b) return
          buf = b
        } else {
          buf = await engine.buildPitchShiftedBuffer({ notes: st.notes, duration: st.project.duration, bpm: st.project.bpm }, st.source, total)
          bufCache.current.set(bufKey, buf)
          if (bufCache.current.size > 8) bufCache.current.delete(bufCache.current.keys().next().value as string)
        }
      }
      if (cancelled) return
      p.load(buf)
      setS((x) => ({ ...x, bufferStatus: 'ready', bufferMsg: null, outputLatencyMs: p.outputLatencyMs() }))
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

  /* ------------------------------------------------------------------
   * 새로고침해도 이 탭의 상태 유지 (탭을 닫으면 사라짐)
   * ------------------------------------------------------------------ */
  const restoring = useRef(true)
  const saveTab = useCallback(() => {
    if (restoring.current) return
    const st = sRef.current
    tabSession.writeTab({
      view: st.replay ? 'studio' : st.view,
      railTab: st.railTab,
      songId: st.project.real ? st.librarySongId : null,
      keyShift: st.keyShift,
      octaveMode: st.octaveMode,
      source: st.source,
      speed: st.speed,
      pos: Math.max(0, live.current.time - (st.syncMs / 1000) * st.speed),
      loop: st.loop,
    })
  }, [])
  useEffect(() => {
    saveTab()
  }, [s.view, s.railTab, s.librarySongId, s.project.real, s.keyShift, s.octaveMode, s.source, s.speed, s.loop, s.playing, saveTab])
  useEffect(() => {
    const id = setInterval(saveTab, 2000)
    window.addEventListener('pagehide', saveTab)
    return () => {
      clearInterval(id)
      window.removeEventListener('pagehide', saveTab)
    }
  }, [saveTab])
  useEffect(() => {
    let alive = true
    const wait = async (ok: () => boolean, ms: number) => {
      const t0 = Date.now()
      while (alive && !ok() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 150))
      return alive && ok()
    }
    void (async () => {
      void tabSession.cleanupPractice()
      const tab = tabSession.readTab()
      try {
        if (!tab) return
        // 설정 복원(위 effect)이 먼저 반영되게 한 박자 쉰다
        await new Promise((r) => setTimeout(r, 0))
        if (tab.songId) {
          a.notify('새로고침 전 화면을 되살리는 중이에요…')
          if (!(await a.openLibrarySong(tab.songId)) || !alive) return
        }
        a.setKey(tab.keyShift)
        a.setOctaveMode(tab.octaveMode as StudioState['octaveMode'])
        a.setSource(tab.source as StudioState['source'])
        a.setRailTab(tab.railTab as StudioState['railTab'])
        // 키를 바꾸면 반주를 다시 만드니 준비될 때까지 기다린 뒤 배속·위치
        await new Promise((r) => setTimeout(r, 50))
        await wait(() => sRef.current.bufferStatus === 'ready', 120000)
        if (!alive) return
        if (tab.speed && tab.speed !== 1) await a.setSpeed(tab.speed)
        const rec = await tabSession.loadPractice()
        if (rec && rec.songId === (tab.songId ?? 'demo')) a.restorePractice(rec)
        if (tab.loop) a.setLoop(tab.loop.a, tab.loop.b, tab.loop.label, false)
        a.seek(tab.pos || 0)
        a.setView(tab.view as StudioState['view'])
      } finally {
        restoring.current = false
        if (alive) saveTab()
      }
    })()
    return () => {
      alive = false
    }
    // 처음 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* AI 분리 설정을 엔진에 */
  useEffect(() => {
    engine.realSetSepOptions({ forceGpu: s.analysis.forceGpu })
  }, [s.analysis.forceGpu])

  /* 내 설정 저장 · 복원 (음역, 싱크, 마이크 지연, 표기, 볼륨, 분석 설정) */
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem('vocallab-next') || 'null')
      if (v)
        setS((p) => ({
          ...p,
          userRange: v.userRange ?? p.userRange,
          syncMs: v.syncMs ?? p.syncMs,
          micLatencyMs: v.micLatencyMs ?? p.micLatencyMs,
          notation: v.notation ?? p.notation,
          volume: v.volume ?? p.volume,
          guideVolume: v.guideVolume ?? p.guideVolume,
          micGain: v.micGain ?? p.micGain,
          micMonitor: v.micMonitor ?? p.micMonitor,
          micMonitorReverb: v.micMonitorReverb ?? p.micMonitorReverb,
          analysis: { ...p.analysis, ...(v.analysis ?? {}) },
          fx: v.fx ? { ...p.fx, ...v.fx } : p.fx,
          showOrigLine: v.showOrigLine ?? p.showOrigLine,
          origLineAlways: v.origLineAlways ?? p.origLineAlways,
          fxPreset: v.fxPreset ?? p.fxPreset,
        }))
    } catch {
      /* 저장소를 못 쓰는 환경 */
    }
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(
        'vocallab-next',
        JSON.stringify({
          userRange: s.userRange,
          syncMs: s.syncMs,
          micLatencyMs: s.micLatencyMs,
          notation: s.notation,
          volume: s.volume,
          guideVolume: s.guideVolume,
          micGain: s.micGain,
          micMonitor: s.micMonitor,
          micMonitorReverb: s.micMonitorReverb,
          analysis: { sensitivity: s.analysis.sensitivity, splitSyllables: s.analysis.splitSyllables, autofill: s.analysis.autofill, pitchModel: s.analysis.pitchModel, crepeModel: s.analysis.crepeModel, separate: s.analysis.separate, forceGpu: s.analysis.forceGpu },
          fx: s.fx,
          fxPreset: s.fxPreset,
          showOrigLine: s.showOrigLine,
          origLineAlways: s.origLineAlways,
        }),
      )
    } catch {
      /* 무시 */
    }
  }, [s.guideVolume, s.micGain, s.micMonitor, s.micMonitorReverb, s.userRange, s.syncMs, s.micLatencyMs, s.notation, s.volume, s.analysis.sensitivity, s.analysis.splitSyllables, s.analysis.autofill, s.analysis.pitchModel, s.analysis.crepeModel, s.analysis.separate, s.fx, s.fxPreset, s.showOrigLine, s.origLineAlways])

  /* 마이크 입력 감도 · 내 목소리 듣기 */
  useEffect(() => engine.setMicGain(s.micGain), [s.micGain])
  useEffect(() => engine.setMicMonitor(s.micMonitorOn ? s.micMonitor : 0, s.micMonitorReverb), [s.micMonitor, s.micMonitorOn, s.micMonitorReverb])

  /* 가이드 보컬: MR 재생 중이고 볼륨이 0보다 클 때만 만든다 */
  const guideOn = isReal && s.source === 'mr' && s.guideAvailable && s.guideVolume > 0
  const guideKey = guideOn ? `${songKey}|guide|${s.keyShift}|${s.analysis.info?.vocOffset ?? 0}|${s.analysis.info?.method}|${s.inputs.vocal?.name ?? (s.analysis.info?.separated ? "sep" : "")}` : ''
  useEffect(() => {
    const p = playerRef.current
    if (!p) return
    p.setGuideVolume(sRef.current.guideVolume)
    if (!guideKey) {
      p.loadGuide(null)
      return
    }
    let cancelled = false
    void (async () => {
      const b = await engine.realTrackBuffer('vocal', sRef.current.keyShift)
      if (!cancelled) p.loadGuide(b)
    })()
    return () => {
      cancelled = true
    }
  }, [guideKey])

  /* 가사는 원곡 파일별로 저장 (보정값 포함) */
  useEffect(() => {
    // 곡 불러오기 화면에서는 아직 이전 곡이 열려 있을 수 있어서 저장하지 않는다
    if (!s.project.real || s.view === 'import' || s.analysis.status === 'running') return
    const id = setTimeout(() => void engine.realSaveLyrics(s.lyrics), 500)
    return () => clearTimeout(id)
  }, [s.lyrics, s.project.real, s.view, s.analysis.status])

  /* 디버깅용: 브라우저 콘솔에서 window.__vocallab.notes 로 현재 노트를 볼 수 있다 */
  useEffect(() => {
    ;(window as unknown as { __vocallab: unknown }).__vocallab = {
      get state() {
        return sRef.current
      },
      get notes() {
        return sRef.current.notes
      },
      get song() {
        return engine.realSong()
      },
      get time() {
        return playerRef.current?.getTime() ?? 0
      },
      get player() {
        return playerRef.current
      },
    }
  }, [])

  useEffect(() => {
    // 결과 화면에서 '반주 끄기'면 내 목소리만 들린다
    const off = s.muted || ((s.view === 'result' || s.replay) && !s.resultMr)
    playerRef.current?.setVolume(off ? 0 : s.volume)
  }, [s.volume, s.muted, s.view, s.resultMr, s.replay])

  /* 녹음을 들을 때(결과 화면·다시 보기)는 녹음한 배속으로 */
  useEffect(() => {
    if ((s.view === 'result' || s.replay) && s.takeAvailable && Math.abs(s.speed - s.takeSpeed) > 1e-3) void a.setSpeed(s.takeSpeed)
  }, [s.view, s.replay, s.takeAvailable, s.speed, s.takeSpeed, a])

  /* 녹음한 내 목소리는 결과 화면에서만 들린다 */
  useEffect(() => {
    playerRef.current?.setTakeVolume(s.view === 'result' || s.replay ? s.takeVolume : 0)
  }, [s.view, s.takeVolume, s.replay])

  /* 화면을 바꾸면 재생을 멈춘다 (결과 ↔ 스튜디오) */
  const prevView = useRef(s.view)
  useEffect(() => {
    if (prevView.current !== s.view && sRef.current.practice.phase === 'idle' && !sRef.current.loop) {
      // 다시 보기 중에 다른 화면으로 가면 다시 보기를 끝낸다 (스튜디오로 들어올 때는 그대로 재생)
      if (live.current.carry) live.current.carry = false
      else if (sRef.current.replay && s.view !== 'studio') a.stopReplay()
      else if (!sRef.current.replay) a.pause()
    }
    prevView.current = s.view
  }, [s.view, a])

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
