import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import * as engine from '@/lib/engine'
import type { AnalysisOptions, CrepeModel, Note, OctaveMode, PitchFrame, PitchModel, Player, Recorder } from '@/lib/engine'
import { clamp } from '@/lib/music'
import { parseLrc } from '@/lib/lrc'
import { assignMixedReadings, attachLyrics, replaceLineTexts, splitMixedLyrics } from '@/lib/lyric-align'
import { buildReport } from '@/lib/report'
import { saveHistory, songKey } from '@/lib/history'
import * as library from '@/lib/library'
import * as tabSession from '@/lib/tab-session'
import * as takesDb from '@/lib/takes'
import { autoParts, myNotes, partAt, setPartWho, type DuetStyle, type DuetWho } from '@/lib/duet'
import { createMasterChain, masterInfo, measureLufs, type MasterChain, type MasterPreset } from '@/lib/mastering'
import { fillFromCurve } from '@/lib/note-check'
import { FX_PRESETS, createVocalChain, layerGains, pitchCurve, renderKey, renderLayers, encodeWav, type FxParams, type RenderedLayers, type VocalChain } from '@/lib/vocal-fx'
import type { LyricLine, Lyrics } from './studio-types'
import type { Notation } from '@/lib/music'
import {
  DEMO_ABILITY,
  EMPTY_SESSION,
  createInitialState,
  type InputKind,
  type Live,
  type RailTab,
  type Source,
  type StudioState,
  type Tool,
  type View,
} from './studio-types'

export interface ActionEnv {
  sRef: MutableRefObject<StudioState>
  setS: Dispatch<SetStateAction<StudioState>>
  live: Live
  playerRef: MutableRefObject<Player | null>
  recorder: Recorder
  demoScript: MutableRefObject<(() => number | null) | null>
  pendingPlay: MutableRefObject<boolean>
}

const stripExt = (n: string) => n.replace(/\.[^.]+$/, '')

export function createActions(env: ActionEnv) {
  const { sRef, setS, live, playerRef, recorder, demoScript, pendingPlay } = env
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  let measureHist: number[] = []

  const set = (patch: Partial<StudioState> | ((p: StudioState) => Partial<StudioState>)) =>
    setS((p) => ({ ...p, ...(typeof patch === 'function' ? patch(p) : patch) }))

  const notify = (msg: string) => {
    set({ notice: msg })
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => set({ notice: null }), 5200)
  }

  // 싱크·마이크 지연은 실제 시간이라 배속만큼 곡 시간으로 바꾼다
  const spd = () => playerRef.current?.getSpeed() ?? 1
  const syncSec = () => (sRef.current.syncMs / 1000) * spd()

  /* ------------------------------ 재생 ------------------------------ */

  const seek = (t: number) => {
    const dur = sRef.current.project.duration
    const next = clamp(t, 0, dur)
    if (next < live.time - 0.05) live.trace = live.trace.filter((p) => p.t < next)
    playerRef.current?.seek(next)
    live.time = next + syncSec()
  }

  /* 연습 녹음: 재생 중인 동안만 마이크 소리를 모은다 */
  let takeSegs: engine.TakeSegment[] = []
  let taking = false
  const takeTime = () => (playerRef.current?.getTime() ?? 0) + syncSec() - (sRef.current.micLatencyMs / 1000) * spd()
  let takeDone: Promise<void> = Promise.resolve()
  /** 이번 연습을 한 배속 */
  let takeRate = 1
  const beginTake = () => {
    if (taking) return
    taking = true
    void engine.startTake(takeTime, playerRef.current?.getSpeed() ?? 1).then((ok) => {
      if (!ok) taking = false
    })
  }
  const endTake = () => {
    if (!taking) return
    taking = false
    takeDone = engine.stopTake().then((seg) => {
      if (seg) takeSegs.push(seg)
    })
  }

  const play = async () => {
    const p = playerRef.current
    if (!p) return
    if (sRef.current.bufferStatus !== 'ready') {
      pendingPlay.current = true
      return
    }
    if (sRef.current.measure.step !== 'idle') return
    const pr = sRef.current.practice
    // 연습 중에 사용자가 일시정지했다가 다시 재생: 3초 세고 멈춘 자리에서 이어 부르기
    // (재생 위치를 끌어서 옮길 때처럼 잠깐 멈췄다 바로 이어지는 건 카운트다운 없이)
    if (pr.phase === 'running' && practiceHeld) return resumeCountdown()
    if (pr.phase === 'countdown') return
    await p.play()
    live.playing = true
    set({ playing: true })
    if (sRef.current.practice.phase === 'running') beginTake()
  }
  /** 연습 중 사용자가 직접 일시정지했는가 */
  let practiceHeld = false
  const resumeCountdown = () => {
    const pr = { ...sRef.current.practice, phase: 'countdown' as const, count: 3, resume: true }
    sRef.current = { ...sRef.current, practice: pr }
    set({ practice: pr })
    clearInterval(countTimer)
    countTimer = setInterval(() => {
      const cur = sRef.current.practice
      if (cur.phase !== 'countdown' || !cur.resume) return clearInterval(countTimer)
      if (cur.count > 1) {
        const nx = { ...cur, count: cur.count - 1 }
        sRef.current = { ...sRef.current, practice: nx }
        return set({ practice: nx })
      }
      clearInterval(countTimer)
      const run = { ...cur, phase: 'running' as const, count: 0, resume: false }
      sRef.current = { ...sRef.current, practice: run }
      set({ practice: run })
      practiceHeld = false
      void play()
    }, 1000)
  }
  const pause = () => {
    endTake()
    playerRef.current?.pause()
    live.playing = false
    set({ playing: false })
  }
  const togglePlay = () => {
    if (sRef.current.playing) {
      if (sRef.current.practice.phase === 'running') practiceHeld = true
      pause()
    } else void play()
  }
  const skip = (d: number) => seek((playerRef.current?.getTime() ?? 0) + d)

  /* ------------------------------ 마이크 ------------------------------ */

  const startMicNow = async (): Promise<boolean> => {
    const st = sRef.current
    try {
      const res = await engine.startMic({
        mode: st.micPref === 'demo' ? 'demo' : st.project.real ? 'live' : 'auto',
        demo: {
          ability: DEMO_ABILITY,
          getTargetMidi: () => {
            if (demoScript.current) return demoScript.current()
            if (!live.playing) return null
            const n = engine.noteAt(live.notes, live.time)
            return n ? n.midi + live.shift : null
          },
        },
      })
      live.micOn = true
      set({ mic: { on: true, mode: res.mode } })
      if (res.fellBack) notify('마이크를 사용할 수 없어 데모 보컬(시뮬레이션)로 전환했어요.')
      return true
    } catch (e) {
      notify(e instanceof Error ? e.message : '마이크를 켤 수 없어요. 브라우저의 마이크 권한을 확인해 주세요.')
      return false
    }
  }
  const stopMicNow = () => {
    engine.stopMic()
    live.micOn = false
    live.pitchMidi = null
    live.cmp = null
    live.micLevel = 0
    set({ mic: { on: false, mode: null } })
  }
  const toggleMic = () => (sRef.current.mic.on ? stopMicNow() : void startMicNow())

  const handlePitch = (frame: PitchFrame) => {
    // 녹음 다시 보기 중에는 마이크를 쓰지 않는다 (선은 녹음 때 그린 걸 보여 줌)
    if (live.replay) return
    const st = sRef.current
    live.pitchMidi = frame.midi
    live.micLevel = frame.level

    if (st.measure.step !== 'idle') {
      if (frame.midi !== null && frame.clarity > 0.8) {
        measureHist.push(frame.midi)
        if (measureHist.length > 10) measureHist.shift()
        if (measureHist.length === 10) {
          const mn = Math.min(...measureHist)
          const mx = Math.max(...measureHist)
          if (mx - mn < 0.7) {
            const med = [...measureHist].sort((a, b) => a - b)[5]
            const m = st.measure
            if (m.step === 'low' && (m.low === null || med < m.low - 0.04)) set({ measure: { ...m, low: med } })
            if (m.step === 'high' && (m.high === null || med > m.high + 0.04)) set({ measure: { ...m, high: med } })
          }
        }
      } else measureHist = []
      return
    }

    if (!live.playing) {
      live.cmp = null
      return
    }
    // 마이크로 들어온 소리는 micLatency 만큼 늦게 도착한다 → 그만큼 앞 시간의 노트와 비교
    const t = live.time - (st.micLatencyMs / 1000) * spd()
    const target0 = engine.noteAt(live.notes, t)
    // 듀엣에서 원곡 가수 차례인 노트는 비교·채점하지 않는다
    const target = target0 && myTurn(t) ? target0 : null
    if (frame.midi === null) {
      const last = live.trace[live.trace.length - 1]
      if (last && last.midi !== null) live.trace.push({ t, midi: null, tier: null })
      live.cmp = null
      live.targetNoteId = target?.id ?? null
      return
    }
    // 결과 화면에서 녹음을 다시 들을 때는 기록하지 않는다 (스피커 소리가 마이크로 들어가므로)
    const recording = st.view === 'studio'
    if (recording) recorder.pushUser(frame.midi)
    if (target) {
      const shown = target.midi + live.shift
      const cmp = engine.compareFrame(shown, frame.midi)
      live.cmp = cmp
      live.targetNoteId = target.id
      if (recording) recorder.push(target, shown, cmp, t, frame.level)
      const sc = live.noteScore.get(target.id) ?? [0, 0, 0]
      sc[cmp.tier === 'great' ? 0 : cmp.tier === 'ok' ? 1 : 2]++
      live.noteScore.set(target.id, sc)
      live.trace.push({ t, midi: frame.midi, tier: cmp.tier })
    } else {
      live.cmp = null
      live.targetNoteId = null
      live.trace.push({ t, midi: frame.midi, tier: null })
    }
    if (live.trace.length > 24000) live.trace.splice(0, 4000)
  }

  const flushSession = () => set({ session: recorder.snapshot(), sessionIsSample: false })

  const resetSession = () => {
    void tabSession.clearPractice()
    recorder.reset()
    live.trace = []
    live.noteScore.clear()
    set({ session: EMPTY_SESSION, sessionIsSample: false })
  }

  /* ------------------------------ 연습 모드 ------------------------------ */

  let countTimer: ReturnType<typeof setInterval> | undefined
  const practiceRange = () => {
    const st = sRef.current
    const ns = st.notes
    const dur = st.project.duration
    if (!ns.length) return { t0: 0, t1: dur }
    const first = Math.min(...ns.map((n) => n.start))
    const last = Math.max(...ns.map((n) => n.start + n.dur))
    // 전주가 길면 첫 노트 4초 전부터, 마지막 노트 2.5초 뒤에 끝낸다
    return { t0: first > 6 ? first - 4 : 0, t1: Math.min(dur, last + 2.5) }
  }

  const startPractice = async () => {
    const st = sRef.current
    if (st.analysis.status === 'running') return notify('곡을 분석하는 중이에요. 끝나면 시작할 수 있어요.')
    if (st.bufferStatus !== 'ready') return notify('음원을 준비하는 중이에요. 잠시 후 다시 눌러 주세요.')
    if (st.measure.step !== 'idle') return
    if (!st.notes.length) return notify('노트가 없어서 연습을 시작할 수 없어요.')
    pause()
    practiceHeld = false
    if (st.view !== 'studio') set({ view: 'studio' })
    if (live.replay) stopReplay()
    if (!sRef.current.mic.on && !(await startMicNow())) return
    await engine.prepareTake()
    resetSession()
    takeSegs = []
    takeRate = playerRef.current?.getSpeed() ?? 1
    take = null
    rendered = null
    playerRef.current?.loadTakeLayers(null)
    const { t0, t1 } = practiceRange()
    seek(t0)
    // 시작할 땐 카운트다운 없이 바로 (첫 노트 4초 전부터 반주가 나온다). 카운트다운은 멈췄다 이어 부를 때만
    const run = { phase: 'running' as const, count: 0, t0, t1 }
    sRef.current = { ...sRef.current, loop: null, practice: run }
    set({ loop: null, takeAvailable: false, practice: run })
    clearInterval(countTimer)
    void play()
  }

  const cancelPractice = () => {
    clearInterval(countTimer)
    const pr = sRef.current.practice
    // 이어 부르기 카운트다운이면 연습은 그대로 두고 멈춘 상태로 돌아간다
    if (pr.phase === 'countdown' && pr.resume) {
      const back = { ...pr, phase: 'running' as const, count: 0, resume: false }
      sRef.current = { ...sRef.current, practice: back }
      return set({ practice: back })
    }
    set({ practice: { phase: 'idle', count: 0, t0: 0, t1: 0 } })
  }

  /** 연습 끝 — 리포트를 만들고 기록을 저장한 뒤 결과 화면으로 */
  const finishPractice = async () => {
    const st = sRef.current
    if (st.practice.phase === 'idle') return
    if (st.practice.phase === 'countdown' && !st.practice.resume) return cancelPractice()
    clearInterval(countTimer)
    practiceHeld = false
    // 화면 갱신 전에 다시 불려도 한 번만 처리되도록 바로 표시
    sRef.current = { ...st, practice: { phase: 'idle', count: 0, t0: 0, t1: 0 } }
    pause()
    const end = Math.max(st.practice.t0, (playerRef.current?.getTime() ?? st.practice.t1) + syncSec())
    const span = { t0: st.practice.t0, t1: Math.min(st.practice.t1, end) }
    const session = recorder.snapshot()
    const report = buildReport({
      session,
      notes: myNotes(st.notes, st.duet),
      shift: live.shift,
      userRange: st.userRange,
      origAt: st.project.real ? engine.realOrigPitchAt : undefined,
      span,
      realMic: st.mic.mode === 'live',
    })
    if (report.enough) saveHistory(songKey(st.project.title, st.project.duration), st.keyShift, report)
    // 이번 연습에서 그린 선을 통째로 보관 (녹음 다시 보기)
    live.replayTrace = live.trace.filter((pt) => pt.t >= span.t0 - 0.5 && pt.t <= span.t1 + 0.5)
    await takeDone
    const segs = takeSegs
    takeSegs = []
    take = null
    rendered = null
    takeSession = session
    // 새로고침해도 이 연습을 다시 볼 수 있게 탭 저장소에 (녹음은 합치고 줄인 뒤)
    const songId = st.project.real ? st.librarySongId : 'demo'
    const trace = live.replayTrace
    const saveRec = () => {
      // 곡 목록에 있는 곡이면 이 녹음을 곡에 저장 (보관 안 한 옛 녹음은 지워짐)
      const tk = take
      const libId = st.project.real ? st.librarySongId : null
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      void tabSession.savePractice({ songId, session, span, take: take ? { ...take } : null, trace: trace ? trace.map((p) => ({ ...p })) : null, takeId: libId && tk && report.enough ? id : null })
      // 너무 짧게 부른 연습(분석 불가)은 곡에 남기지 않는다 — 실수로 눌러도 예전 녹음이 지워지지 않게
      if (!libId || !tk || !report.enough) return set({ currentTakeId: null })
      void takesDb
        .saveLatest(
          { id, songId: libId, at: Date.now(), starred: false, score: report.score, keyShift: st.keyShift, rate: tk.rate, span, dur: tk.data.length / tk.sr },
          { id, session, take: { t0: tk.t0, sr: tk.sr, rate: tk.rate, pcm: takesDb.toPcm(tk.data) }, trace: trace ? trace.map((p) => ({ ...p })) : null },
        )
        .then((ok) => {
          if (ok) set((p) => ({ currentTakeId: id, takesRev: p.takesRev + 1 }))
          else notify('저장 공간이 부족해서 녹음을 곡에 남기지 못했어요. 안 쓰는 곡이나 보관한 녹음을 지워 주세요.')
        })
    }
    if (segs.length) void prepareTake(segs).then(saveRec)
    else saveRec()
    set((p) => ({
      practice: { phase: 'idle', count: 0, t0: 0, t1: 0 },
      practiceSpan: span,
      session,
      sessionIsSample: false,
      takeAvailable: segs.length > 0,
      takeSpeed: takeRate,
      historyRev: p.historyRev + 1,
      view: 'result',
    }))
    if (!report.enough) notify('부른 부분이 짧아서 기록에는 저장하지 않았어요.')
  }

  /* ------------------------------ 녹음 효과 ------------------------------ */

  let take: { t0: number; data: Float32Array; sr: number; rate: number } | null = null
  let takeSession: engine.SessionStats | null = null
  let rendered: { key: string; layers: RenderedLayers } | null = null
  let chainObj: VocalChain | null = null
  let renderTok = 0
  let fxTimer: ReturnType<typeof setTimeout> | undefined

  /** 녹음 구간들을 하나로 합치고 32kHz로 낮춘다 (메모리 절약) */
  const prepareTake = async (segs: engine.TakeSegment[]) => {
    const sr0 = segs[0].sr
    const t0 = Math.min(...segs.map((g) => g.t0))
    // 녹음은 배속으로 부른 그대로라, 곡 시간 차이를 배속으로 나눠야 녹음 속 위치가 된다
    const r = takeRate || 1
    const t1 = Math.max(...segs.map((g) => g.t0 + (g.data.length / g.sr) * r))
    const merged = new Float32Array(Math.ceil(((t1 - t0) / r) * sr0))
    for (const g of segs) {
      const at = Math.max(0, Math.round(((g.t0 - t0) / r) * sr0))
      merged.set(g.data.subarray(0, Math.max(0, merged.length - at)), at)
    }
    let data: Float32Array = merged
    let sr = sr0
    if (sr0 > 32000) {
      try {
        const len = Math.ceil((merged.length * 32000) / sr0)
        const oc = new OfflineAudioContext(1, len, 32000)
        const b = oc.createBuffer(1, merged.length, sr0)
        b.copyToChannel(merged, 0)
        const src = oc.createBufferSource()
        src.buffer = b
        src.connect(oc.destination)
        src.start()
        data = (await oc.startRendering()).getChannelData(0)
        sr = 32000
      } catch {
        /* 낮추지 못하면 원래대로 */
      }
    }
    take = { t0, data, sr, rate: takeRate }
    clearTuneSkip()
    await applyFx(sRef.current.fx, true)
  }

  /** '고치지 않을 곳'은 녹음마다 다르니 새 녹음에서는 비운다 */
  const clearTuneSkip = () => {
    if (!sRef.current.fx.tuneSkip?.length) return
    const fx = { ...sRef.current.fx, tuneSkip: [] }
    sRef.current = { ...sRef.current, fx }
    set({ fx })
  }

  /** 효과 적용 — 바로 바뀌는 값은 즉시, 다시 계산할 값은 바뀌었을 때만 */
  const applyFx = async (fx: FxParams, force = false) => {
    const p = playerRef.current
    if (!take || !takeSession || !p) return
    const ctx = p.audioContext()
    if (!chainObj) {
      chainObj = createVocalChain(ctx, fx)
      p.setTakeChain(chainObj)
    } else chainObj.update(fx)
    const key = renderKey(fx)
    if (force || !rendered || rendered.key !== key) {
      const tok = ++renderTok
      set({ fxBusy: 0 })
      const tk = take
      const curve = pitchCurve(takeSession, tk.t0, tk.data.length / tk.sr, tk.rate)
      const layers = await renderLayers(tk, curve, sRef.current.notes, live.shift, fx, (r) => tok === renderTok && set({ fxBusy: r }))
      if (tok !== renderTok || take !== tk) return
      rendered = { key, layers }
      set({ tuneSpots: layers.spots.map((sp) => ({ ...sp, t0: tk.t0 + sp.t0 * tk.rate, t1: tk.t0 + sp.t1 * tk.rate })) })
      const mk = (id: string, chans: Float32Array[]) => {
        const b = ctx.createBuffer(chans.length, chans[0].length, tk.sr)
        chans.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i))
        return { id, t0: tk.t0, buf: b, gain: 0, rate: tk.rate }
      }
      const L = [mk('raw', [layers.raw])]
      if (layers.tuned) L.push(mk('tuned', [layers.tuned]))
      if (layers.harmony) L.push(mk('harmony', [layers.harmony]))
      if (layers.double) L.push(mk('double', layers.double))
      p.loadTakeLayers(L)
      set({ fxBusy: null, takeAvailable: true })
    }
    setGains(fx, sRef.current.fxCompare)
  }

  const setGains = (fx: FxParams, compare: 'tuned' | 'raw') => {
    const p = playerRef.current
    if (!p || !rendered) return
    const l = rendered.layers
    const g = layerGains(fx, { tuned: !!l.tuned, harmony: !!l.harmony, double: !!l.double }, compare)
    for (const [id, v] of Object.entries(g)) p.setLayerGain(id, v)
  }

  const setFx = (patch: Partial<FxParams>, preset = 'custom') => {
    const fx = { ...sRef.current.fx, ...patch }
    sRef.current = { ...sRef.current, fx }
    set({ fx, fxPreset: preset })
    // 바로 바뀌는 값
    chainObj?.update(fx)
    if (rendered && rendered.key === renderKey(fx)) setGains(fx, sRef.current.fxCompare)
    // 다시 계산할 값은 손을 뗀 뒤에
    clearTimeout(fxTimer)
    fxTimer = setTimeout(() => void applyFx(sRef.current.fx), 350)
  }

  const setFxPreset = (id: string) => {
    const pr = FX_PRESETS.find((x) => x.id === id)
    if (pr) setFx({ ...pr.fx }, id)
  }

  const setFxCompare = (fxCompare: 'tuned' | 'raw') => {
    sRef.current = { ...sRef.current, fxCompare }
    set({ fxCompare })
    setGains(sRef.current.fx, fxCompare)
  }

  /** 효과 넣은 내 노래 + 반주를 WAV로 저장 */
  /** 반주 + 효과 넣은 내 목소리를 지금 들리는 그대로 섞는다 (master를 주면 마스터링까지) */
  const renderMix = async (master: { preset: MasterPreset; gainDb: number } | null): Promise<AudioBuffer | null> => {
    const st = sRef.current
    const p = playerRef.current
    if (!take || !rendered || !p) return null
    {
      const span = st.practiceSpan ?? { t0: take.t0, t1: take.t0 + (take.data.length / take.sr) * take.rate }
      const a0 = Math.max(0, span.t0 - 0.3)
      const a1 = span.t1 + 2
      const sr = 44100
      // 저장은 연습한 배속 그대로 (지금 재생 배속)
      const pb = await p.getPlayback()
      const sp = pb.speed
      const oc = new OfflineAudioContext(2, Math.ceil(((a1 - a0) / sp) * sr), sr)
      const lim = oc.createDynamicsCompressor()
      lim.threshold.value = -2
      lim.knee.value = 0
      lim.ratio.value = 20
      lim.attack.value = 0.002
      lim.release.value = 0.1
      const info = master ? masterInfo(master.preset) : null
      if (info) {
        // 마스터링은 기본 리미터 대신 들어간다
        const mc = createMasterChain(oc, info, master!.gainDb)
        mc.output.connect(oc.destination)
        lim.disconnect()
        lim.connect(mc.input)
        lim.threshold.value = 0
        lim.ratio.value = 1
      } else lim.connect(oc.destination)
      const mr = pb.buf
      if (mr && st.resultMr && !st.muted) {
        const g = oc.createGain()
        g.gain.value = st.volume * st.volume
        const src = oc.createBufferSource()
        src.buffer = mr
        src.playbackRate.value = sp
        src.connect(g).connect(lim)
        src.start(0, Math.min(a0, mr.duration))
      }
      const chain = createVocalChain(oc, st.fx)
      const vg = oc.createGain()
      vg.gain.value = st.takeVolume * st.takeVolume
      chain.output.connect(vg).connect(lim)
      // 듀엣: 원곡 보컬은 원곡 가수·같이 파트에서만, 내 목소리는 나·같이 파트에서만
      if (st.duet.on && st.duet.parts.length) {
        const env = (param: AudioParam, on: number, mine: boolean) => {
          param.setValueAtTime(0, 0)
          for (const pt of st.duet.parts) {
            const at = Math.max(0, (pt.t0 - a0) / sp)
            const v = (mine ? pt.who !== 'orig' : pt.who !== 'me') ? on : 0
            param.setTargetAtTime(v, at, 0.03)
          }
        }
        env(vg.gain, st.takeVolume * st.takeVolume, true)
        const gb = await p.getGuidePlayback()
        if (gb) {
          const gv = st.guideVolume > 0 ? st.guideVolume : 0.85
          const gg = oc.createGain()
          env(gg.gain, gv * gv, false)
          const gs = oc.createBufferSource()
          gs.buffer = gb
          gs.playbackRate.value = sp
          gs.connect(gg).connect(lim)
          gs.start(0, Math.min(a0, gb.duration))
        }
      }
      const l = rendered.layers
      const gains = layerGains(st.fx, { tuned: !!l.tuned, harmony: !!l.harmony, double: !!l.double }, st.fxCompare)
      const add = (chans: Float32Array[] | null, gain: number) => {
        if (!chans || gain <= 0) return
        const b = oc.createBuffer(chans.length, chans[0].length, take!.sr)
        chans.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i))
        const src = oc.createBufferSource()
        src.buffer = b
        src.playbackRate.value = sp / take!.rate
        const g = oc.createGain()
        g.gain.value = gain
        src.connect(g).connect(chain.input)
        src.start(Math.max(0, (take!.t0 - a0) / sp), Math.max(0, (a0 - take!.t0) / take!.rate))
      }
      add([l.raw], gains.raw)
      add(l.tuned ? [l.tuned] : null, gains.tuned)
      add(l.harmony ? [l.harmony] : null, gains.harmony)
      add(l.double, gains.double)
      return await oc.startRendering()
    }
  }

  const exportMix = async () => {
    const st = sRef.current
    if (!take || !rendered || !playerRef.current) return notify('저장할 녹음이 없어요.')
    if (st.fxBusy !== null) return notify('효과를 계산하는 중이에요. 잠시 후 다시 눌러 주세요.')
    if (st.master.busy) return notify('마스터링을 계산하는 중이에요. 잠시 후 다시 눌러 주세요.')
    set({ exporting: true })
    try {
      const m = st.master.preset !== 'off' && st.master.after !== null ? { preset: st.master.preset, gainDb: st.master.gainDb } : null
      const out = await renderMix(m)
      if (!out) return notify('저장할 녹음이 없어요.')
      const url = URL.createObjectURL(encodeWav(out))
      const el = document.createElement('a')
      el.href = url
      el.download = `${st.project.title || '내 노래'} (내 노래${m ? ' · 마스터링' : ''}).wav`
      document.body.appendChild(el)
      el.click()
      el.remove()
      setTimeout(() => URL.revokeObjectURL(url), 15000)
      notify(m ? '효과와 마스터링을 넣은 내 노래를 저장했어요.' : '효과를 넣은 내 노래를 저장했어요.')
    } catch (e) {
      notify('저장하지 못했어요: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      set({ exporting: false })
    }
  }

  /* 마스터링 — 전·후 음량을 재서 목표 크기에 맞는 올림 양을 정한다 */
  let masterObj: MasterChain | null = null
  let masterTok = 0
  const applyMasterRouting = () => {
    const p = playerRef.current
    const m = sRef.current.master
    if (!p) return
    if (m.preset === 'off' || !masterObj || m.after === null || m.compare === 'before') {
      p.setMaster(null)
      return
    }
    masterObj.setTrim(m.matched && m.before !== null ? Math.min(0, m.before - m.after) : 0)
    p.setMaster(masterObj)
  }
  const setMasterState = (patch: Partial<StudioState['master']>) => {
    const master = { ...sRef.current.master, ...patch }
    sRef.current = { ...sRef.current, master }
    set({ master })
  }
  const refreshMaster = async () => {
    const preset = sRef.current.master.preset
    const info = masterInfo(preset)
    const tok = ++masterTok
    if (!info) {
      masterObj = null
      setMasterState({ busy: false, before: null, after: null, gainDb: 0 })
      return applyMasterRouting()
    }
    if (!take || !rendered) return
    setMasterState({ busy: true })
    try {
      const mix0 = await renderMix(null)
      if (!mix0 || tok !== masterTok) return
      const before = measureLufs(mix0)
      // 이미 목표보다 크면 줄이지 않고 원래 크기를 지킨다 (마스터링이 소리를 작게 만들면 이상하니까)
      const goal = Math.max(info.target, before)
      let g = Math.max(-6, Math.min(24, goal - before))
      // 리미터·컴프레서 때문에 정확히 안 맞으니 한 번 더 재서 보정
      const mix1 = await renderMix({ preset, gainDb: g })
      if (!mix1 || tok !== masterTok) return
      const l1 = measureLufs(mix1)
      g = Math.max(-6, Math.min(24, g + (goal - l1)))
      const mix2 = await renderMix({ preset, gainDb: g })
      if (!mix2 || tok !== masterTok) return
      const after = measureLufs(mix2)
      const ctx = playerRef.current!.audioContext()
      masterObj = createMasterChain(ctx, info, g)
      setMasterState({ busy: false, before, after, gainDb: g })
      applyMasterRouting()
    } catch (e) {
      if (tok === masterTok) {
        setMasterState({ busy: false })
        notify('마스터링을 계산하지 못했어요: ' + (e instanceof Error ? e.message : String(e)))
      }
    }
  }
  const setMasterPreset = (preset: MasterPreset) => {
    setMasterState({ preset, compare: 'after' })
    void refreshMaster()
  }
  const setMasterCompare = (compare: 'after' | 'before') => {
    setMasterState({ compare })
    applyMasterRouting()
  }
  const setMasterMatched = (matched: boolean) => {
    setMasterState({ matched })
    applyMasterRouting()
  }

  /** 튜닝이 고친 한 곳을 전/후로 들어 보기 */
  let spotTimer: ReturnType<typeof setTimeout> | undefined
  const listenSpot = (t0: number, t1: number, which: 'raw' | 'tuned') => {
    clearTimeout(spotTimer)
    setFxCompare(which)
    pause()
    const a0 = Math.max(0, t0 - 0.6)
    seek(a0)
    void play()
    const sp = playerRef.current?.getSpeed() ?? 1
    spotTimer = setTimeout(() => pause(), ((t1 + 0.4 - a0) / sp) * 1000)
  }
  const toggleTuneSkip = (key: number) => {
    const cur = sRef.current.fx.tuneSkip ?? []
    setFx({ tuneSkip: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] }, sRef.current.fxPreset)
  }

  /* 녹음 다시 보기: 스튜디오 화면에서 내 목소리를 들으며 그때 그린 선을 다시 본다 */
  const startReplay = (from?: number) => {
    const st = sRef.current
    if (!st.takeAvailable || !live.replayTrace?.length) return notify('다시 볼 녹음이 없어요. 연습 시작으로 먼저 불러 주세요.')
    // 결과 화면에서 듣던 곳이 연습 구간 안이면 거기서 이어서
    const span = st.practiceSpan
    const cur = live.time
    const inSpan = !!span && cur > span.t0 + 0.2 && cur < span.t1 - 0.3
    const keep = from === undefined && inSpan && st.playing
    if (!keep) pause()
    live.replay = true
    live.pitchMidi = null
    live.cmp = null
    live.carry = keep
    sRef.current = { ...st, replay: true, view: 'studio' }
    set({ replay: true, view: 'studio', loop: null })
    if (keep) return
    seek(Math.max(0, from ?? (inSpan ? cur : (span?.t0 ?? 0))))
    void play()
  }
  /** back: 결과 화면으로 — 재생 중이면 끊지 않고 그대로 이어서 듣는다 */
  const stopReplay = (back = false) => {
    if (back && sRef.current.playing) live.carry = true
    else pause()
    live.replay = false
    live.pitchMidi = null
    live.cmp = null
    sRef.current = { ...sRef.current, replay: false }
    set(back ? { replay: false, view: 'result' } : { replay: false })
  }

  /* 소절 반복 */
  const setLoop = (a: number, b: number, label?: string, start = true) => {
    set(start ? { loop: { a, b, label }, view: 'studio' } : { loop: { a, b, label } })
    if (!start) return
    seek(Math.max(0, a - 0.3))
    void play()
  }

  /**
   * 새로고침 전 연습 되살리기. 노트 id는 불러올 때마다 새로 만들어지므로
   * 시작 시간과 음으로 지금 노트에 다시 이어 붙인다.
   */
  const restorePractice = (rec: Pick<tabSession.PracticeRecord, 'session' | 'span' | 'take' | 'trace' | 'takeId'>) => {
    const notes = sRef.current.notes
    const idOf = new Map<string, string>()
    for (const nr of rec.session.perNote) {
      const m = notes.find((n) => Math.abs(n.start - nr.start) < 0.03 && Math.abs(n.midi - nr.orig) < 0.5)
      if (m) idOf.set(nr.id, m.id)
    }
    const perNote = rec.session.perNote.filter((nr) => idOf.has(nr.id)).map((nr) => ({ ...nr, id: idOf.get(nr.id)! }))
    const session = { ...rec.session, perNote }
    takeSession = session
    live.replayTrace = (rec.trace as typeof live.trace | null) ?? null
    if (rec.take) {
      take = { ...rec.take }
      takeRate = rec.take.rate
      rendered = null
    }
    set({
      session,
      sessionIsSample: false,
      practiceSpan: rec.span,
      takeAvailable: !!rec.take,
      takeSpeed: rec.take?.rate ?? 1,
      currentTakeId: rec.takeId ?? null,
    })
    if (rec.take) {
      clearTuneSkip()
      void applyFx(sRef.current.fx, true)
    }
  }
  const clearLoop = () => set({ loop: null })

  /** 결과 화면에서 t 조금 앞부터 듣기 */
  const listenFrom = (t: number) => {
    pause()
    seek(Math.max(0, t - 1))
    void play()
  }

  /* ------------------------------ 음역 측정 ------------------------------ */

  const scriptFor = (step: 'low' | 'high') => {
    const t0 = performance.now()
    demoScript.current = () => {
      const e = (performance.now() - t0) / 1000
      if (e < 0.7) return null
      return step === 'low' ? Math.max(40, 57.5 - (e - 0.7) * 1.7) : Math.min(82, 61.5 + (e - 0.7) * 1.9)
    }
  }

  const startMeasure = async () => {
    pause()
    measureHist = []
    set({ measure: { step: 'low', low: null, high: null }, railTab: 'key' })
    if (!sRef.current.mic.on) await startMicNow()
    scriptFor('low')
  }
  const confirmMeasure = () => {
    const m = sRef.current.measure
    measureHist = []
    if (m.step === 'low') {
      set({ measure: { ...m, step: 'high' } })
      scriptFor('high')
      return
    }
    demoScript.current = null
    const cur = sRef.current.userRange
    let low = m.low ?? cur.low
    let high = m.high ?? cur.high
    low = Math.round(low * 10) / 10
    high = Math.round(high * 10) / 10
    if (high - low < 5) high = low + 5
    set({ userRange: { low, high }, measure: { step: 'idle', low: null, high: null } })
    stopMicNow()
    notify('측정한 음역을 적용했어요. 아래에서 미세 조정할 수 있어요.')
  }
  const cancelMeasure = () => {
    demoScript.current = null
    measureHist = []
    set({ measure: { step: 'idle', low: null, high: null } })
    stopMicNow()
  }
  const nudgeRange = (which: 'low' | 'high', delta: number) =>
    set((p) => {
      const r = { ...p.userRange }
      r[which] = Math.round((r[which] + delta) * 100) / 100
      if (r.high - r.low < 2) r[which === 'low' ? 'low' : 'high'] = p.userRange[which]
      return { userRange: r }
    })

  /* ------------------------------ 분석 ------------------------------ */

  const analyze = async (goStudio: boolean, opt: { useEdits?: boolean } = {}): Promise<boolean> => {
    const st = sRef.current
    const { inputs, analysis } = st
    if (!inputs.original && !inputs.noteFile && !inputs.mr) {
      notify('먼저 원곡 파일을 넣어 주세요.')
      return false
    }
    pause()
    set({ analysis: { ...analysis, status: 'running', stage: '준비 중', ratio: 0.02, error: undefined } })
    const prog = (stage: string, ratio: number) => set((p) => ({ analysis: { ...p.analysis, stage, ratio } }))
    const isReal = !!(inputs.original?.file || inputs.mr?.file)
    try {
      if (isReal) {
        const res = await engine.analyzeReal(
          { original: inputs.original?.file, mr: inputs.mr?.file, vocal: inputs.vocal?.file, noteFile: inputs.noteFile?.file },
          {
            sensitivity: analysis.sensitivity,
            splitSyllables: analysis.splitSyllables,
            autofill: analysis.autofill,
            pitchModel: analysis.pitchModel,
            crepeModel: analysis.crepeModel,
            useEdits: opt.useEdits ?? goStudio,
            separate: analysis.separate,
          },
          prog,
        )
        const isNew = goStudio || !st.project.real
        // 새 곡이면 이 곡에 저장해 둔 가사로 바꾼다.
        // 가사 파일을 같이 넣었으면: 같은 파일을 고쳐 둔 가사가 있으면 그걸, 아니면 넣은 파일을 쓴다
        let savedLyrics: Lyrics | null | undefined = undefined
        if (isNew) {
          const sv = (await engine.realLoadLyrics()) as Lyrics | null
          if (!inputs.lyrics) savedLyrics = sv
          else if (sv && sv.name === inputs.lyrics.name && sv.lines?.length) savedLyrics = sv
        }
        playerRef.current?.seek(0)
        live.time = 0
        live.trace = []
        const al = res.info.align
        set((p) => ({
          notes: res.notes,
          past: [],
          future: [],
          selection: [],
          notesRev: p.notesRev + 1,
          project: {
            ...p.project,
            duration: res.duration,
            bpm: 0,
            real: true,
            title: isNew ? stripExt((inputs.original ?? inputs.mr)!.name) : p.project.title,
            artist: isNew ? '내 파일' : p.project.artist,
          },
          analysis: {
            ...p.analysis,
            status: 'done',
            stage: '완료',
            ratio: 1,
            source: res.info.method === 'midi' || res.info.method === 'tony' || res.info.method === 'noteFile' ? 'noteFile' : inputs.vocal || res.info.separated ? 'vocal' : 'original',
            warnings: res.warnings,
            info: res.info,
          },
          align: { status: al ? 'done' : 'idle', result: al ? { offsetMs: Math.round(al.offset * 1000), confidence: al.conf } : null },
          level: engine.realLevelInfo(),
          ...(savedLyrics !== undefined ? { lyrics: savedLyrics && savedLyrics.lines?.length ? savedLyrics : null } : {}),
          guideAvailable: engine.realHasGuideVocal(),
          source: inputs.mr || res.info.separated ? (isNew ? 'mr' : p.source) : 'original',
          view: goStudio ? 'studio' : p.view,
          railTab: goStudio ? 'analysis' : p.railTab,
          ...(isNew ? { session: EMPTY_SESSION, sessionIsSample: false } : {}),
        }))
        if (isNew) {
          recorder.reset()
          live.noteScore.clear()
        }
        if (goStudio) void saveToLibrary(res.duration)
        return true
      }

      // 데모 곡 (목업 엔진)
      const opts: AnalysisOptions = { sensitivity: analysis.sensitivity, splitSyllables: analysis.splitSyllables }
      let notes: Note[]
      let duration = st.project.duration
      let bpm = st.project.bpm
      let source: 'original' | 'vocal' | 'noteFile'
      let warnings: string[] = []
      if (inputs.noteFile?.file) {
        prog('노트 파일 읽는 중', 0.4)
        notes = await engine.parseNoteFile(inputs.noteFile.file)
        duration = Math.max(duration, (notes[notes.length - 1]?.start ?? 0) + 4)
        source = 'noteFile'
      } else {
        const res = inputs.vocal?.file
          ? await engine.analyzeWithVocal(null, inputs.vocal.file, opts, prog)
          : await engine.analyzeOriginal(null, opts, prog)
        notes = res.notes
        duration = res.duration
        bpm = res.bpm
        warnings = res.warnings
        source = res.source
      }
      playerRef.current?.seek(0)
      live.time = 0
      live.trace = []
      set((p) => ({
        notes,
        past: [],
        future: [],
        selection: [],
        notesRev: p.notesRev + 1,
        project: { ...p.project, duration, bpm, real: false },
        analysis: { ...p.analysis, status: 'done', stage: '완료', ratio: 1, source, warnings, info: null },
        view: goStudio ? 'studio' : p.view,
        railTab: goStudio ? 'analysis' : p.railTab,
      }))
      return true
    } catch (e) {
      console.error(e)
      set((p) => ({ analysis: { ...p.analysis, status: 'error', stage: '오류', error: e instanceof Error ? e.message : '분석에 실패했어요.' } }))
      notify(e instanceof Error ? e.message : '분석에 실패했어요.')
      return false
    }
  }

  const runAlign = async () => {
    const st = sRef.current
    if (!st.inputs.mr) return
    set({ align: { status: 'running', result: st.align.result } })
    if (st.project.real) {
      await engine.realAlignMr()
      await analyze(false, { useEdits: false })
      return
    }
    const res = await engine.alignMr(null, st.inputs.mr.file)
    set({ align: { status: 'done', result: res } })
  }

  const nudgeMr = (sec: number) => {
    const r = engine.realNudgeMr(sec)
    if (r) {
      set({ align: { status: 'done', result: r } })
      const id = sRef.current.librarySongId
      if (id) void library.patchSong(id, (x) => ({ ...x, settings: { ...x.settings, mrOffsetMs: r.offsetMs } }))
    }
  }

  /* ------------------------------ 내 곡 목록 ------------------------------ */

  /** 곡을 불러와 분석이 끝나면 목록에 저장 (같은 원곡이면 덮어씀) */
  const saveToLibrary = async (duration: number) => {
    const st = sRef.current
    const main = st.inputs.original ?? st.inputs.noteFile ?? st.inputs.mr
    if (!main?.file) return
    const id = library.songIdOf(main)
    const files: library.LibSong['files'] = {}
    let bytes = 0
    for (const k of ['original', 'mr', 'vocal', 'noteFile', 'lyrics'] as const) {
      const f = st.inputs[k]?.file
      if (f) {
        files[k] = library.toLibFile(f)
        bytes += f.size
      }
    }
    const prev = await library.getSong(id)
    const now = Date.now()
    try {
      await library.putSong({
        id,
        title: prev?.title ?? stripExt(main.name),
        projTitle: stripExt((st.inputs.original ?? st.inputs.mr ?? main).name),
        duration,
        created: prev?.created ?? now,
        updated: now,
        opened: now,
        bytes,
        files,
        settings: prev?.settings ?? { keyShift: st.keyShift },
      })
      set((p) => ({ librarySongId: id, libraryRev: p.libraryRev + 1 }))
      if (!prev) {
        notify('내 곡 목록에 저장했어요. 다음엔 곡 불러오기 화면에서 바로 열 수 있어요.')
        void library.requestPersist()
      }
    } catch {
      notify('저장 공간이 부족해서 내 곡 목록에 저장하지 못했어요.')
    }
  }

  /** 목록의 곡 열기 — 파일을 넣고 분석(저장된 결과를 다시 씀)한 뒤 키·MR 위치를 되돌린다 */
  const openLibrarySong = async (id: string): Promise<boolean> => {
    if (sRef.current.analysis.status === 'running') return false
    const song = await library.getSong(id)
    if (!song) {
      notify('곡을 찾을 수 없어요.')
      return false
    }
    set({ libraryOpening: id })
    try {
      pause()
      const inputs: StudioState['inputs'] = {}
      for (const [k, f] of Object.entries(song.files) as [InputKind, library.LibFile][]) {
        const file = library.fromLibFile(f)
        inputs[k] = { name: file.name, size: file.size, file }
      }
      sRef.current = { ...sRef.current, inputs }
      set({ inputs, lyrics: null })
      if (inputs.lyrics?.file) await loadLyrics(inputs.lyrics.file, true)
      if (!(await analyze(true))) return false
      set({ keyShift: clamp(song.settings.keyShift ?? 0, -7, 7), librarySongId: id, duet: { on: false, style: song.settings.duet?.style ?? 'section', parts: song.settings.duet?.parts ?? [] } })
      sRef.current = { ...sRef.current, librarySongId: id }
      const want = song.settings.mrOffsetMs
      // 화면 상태는 아직 갱신 전일 수 있어서 엔진에서 직접 읽는다
      const al = (engine.realSong() as { mrAlign?: { offset: number } | null }).mrAlign
      const cur = al ? Math.round(al.offset * 1000) : undefined
      if (want !== undefined && cur !== undefined && Math.abs(want - cur) >= 1) nudgeMr((want - cur) / 1000)
      void library.patchSong(id, (x) => ({ ...x, opened: Date.now() }))
      // 이 곡의 가장 최근 녹음을 불러와 둔다 (연습 결과에서 바로 들을 수 있게) — 녹음한 키와 같을 때만
      const latest = (await takesDb.listTakes(id))[0]
      if (latest && latest.keyShift === clamp(song.settings.keyShift ?? 0, -7, 7)) {
        const r = await takesDb.loadTake(latest.id)
        if (r) restorePractice({ session: r.data.session, span: r.meta.span, take: { t0: r.data.take.t0, sr: r.data.take.sr, rate: r.data.take.rate, data: takesDb.fromPcm(r.data.take.pcm) }, trace: r.data.trace, takeId: latest.id })
      }
      return true
    } finally {
      set((p) => ({ libraryOpening: null, libraryRev: p.libraryRev + 1 }))
    }
  }

  const renameLibrarySong = async (id: string, title: string) => {
    const t = title.trim()
    if (!t) return
    await library.patchSong(id, (x) => ({ ...x, title: t }))
    set((p) => ({ libraryRev: p.libraryRev + 1 }))
  }

  const setKey = (keyShift: number) => {
    const k = clamp(keyShift, -7, 7)
    set({ keyShift: k })
    const id = sRef.current.librarySongId
    if (id && sRef.current.project.real) void library.patchSong(id, (x) => ({ ...x, settings: { ...x.settings, keyShift: k } }))
  }

  /* ------------------------------ 듀엣 ------------------------------ */
  const saveDuet = (d: StudioState['duet']) => {
    const id = sRef.current.librarySongId
    if (id && sRef.current.project.real) void library.patchSong(id, (x) => ({ ...x, settings: { ...x.settings, duet: { style: d.style, parts: d.parts } } }))
  }
  const setDuet = (d: StudioState['duet']) => {
    sRef.current = { ...sRef.current, duet: d }
    set({ duet: d })
  }
  const toggleDuet = (on: boolean) => {
    const st = sRef.current
    if (on && !st.guideAvailable) return notify('듀엣 모드는 원곡 보컬이 필요해요. 보컬 파일을 넣거나 AI 분리를 켜고 분석해 주세요.')
    if (on && st.practice.phase !== 'idle') return notify('연습 중에는 듀엣 모드를 바꿀 수 없어요.')
    let parts = st.duet.parts
    if (on && !parts.length) parts = autoParts(st.notes, st.lyrics, st.project.duration, st.duet.style)
    const d = { ...st.duet, on, parts }
    setDuet(d)
    if (on) {
      // 듀엣은 MR 위에 원곡 보컬을 파트대로 튼다
      if (st.source !== 'mr') set({ source: 'mr' })
      saveDuet(d)
    }
  }
  const setDuetStyle = (style: DuetStyle) => {
    const st = sRef.current
    const d = { ...st.duet, style, parts: autoParts(st.notes, st.lyrics, st.project.duration, style) }
    setDuet(d)
    saveDuet(d)
  }
  const setDuetPart = (idx: number, who: DuetWho) => {
    const d = { ...sRef.current.duet, parts: setPartWho(sRef.current.duet.parts, idx, who) }
    setDuet(d)
    saveDuet(d)
  }
  /** 지금 시각이 내가 부를 차례인가 (듀엣이 아니면 항상) */
  const myTurn = (t: number) => {
    const d = sRef.current.duet
    if (!d.on) return true
    const w = partAt(d.parts, t)
    return w !== 'orig'
  }

  /* 곡에 저장된 녹음 */
  const openTake = async (id: string) => {
    const r = await takesDb.loadTake(id)
    if (!r) return notify('녹음을 찾을 수 없어요.')
    pause()
    if (sRef.current.keyShift !== r.meta.keyShift) setKey(r.meta.keyShift)
    const rec = { session: r.data.session, span: r.meta.span, take: { t0: r.data.take.t0, sr: r.data.take.sr, rate: r.data.take.rate, data: takesDb.fromPcm(r.data.take.pcm) }, trace: r.data.trace }
    restorePractice(rec)
    set({ currentTakeId: id, view: 'result' })
    void tabSession.savePractice({ songId: sRef.current.librarySongId, ...rec, takeId: id })
  }
  const starTake = async (id: string, starred: boolean) => {
    await takesDb.setStar(id, starred)
    set((p) => ({ takesRev: p.takesRev + 1 }))
    notify(starred ? '이 녹음을 보관했어요. 다음 연습 때도 지워지지 않아요.' : '보관을 풀었어요. 가장 최근 녹음이 아니면 다음 연습 때 지워져요.')
  }
  const removeTake = async (id: string) => {
    await takesDb.deleteTake(id)
    set((p) => ({ takesRev: p.takesRev + 1, currentTakeId: p.currentTakeId === id ? null : p.currentTakeId }))
  }

  const deleteLibrarySong = async (id: string) => {
    await library.deleteSong(id)
    void takesDb.deleteSongTakes(id)
    set((p) => ({ libraryRev: p.libraryRev + 1, librarySongId: p.librarySongId === id ? null : p.librarySongId }))
    notify('목록에서 지웠어요. 편집한 노트와 가사 기록은 남아 있어서, 같은 파일을 다시 넣으면 돌아와요.')
  }

  /* 가사 (.lrc) */
  const setLyricsText = (name: string, text: string) => {
    const lines = parseLrc(text)
    if (!lines.length) {
      notify('시간 정보가 있는 가사가 아니에요.')
      return false
    }
    set({ lyrics: { name, lines, offset: 0 } })
    notify(`가사 ${lines.filter((l) => l.text).length}줄을 불러왔어요.`)
    return true
  }
  const loadLyrics = async (file: File, quiet = false) => {
    try {
      const lines = parseLrc(await file.text())
      if (!lines.length) throw new Error('시간 정보([mm:ss.xx])가 있는 LRC 가사가 아니에요.')
      set({ lyrics: { name: file.name, lines, offset: 0 } })
      if (!quiet) notify(`가사 ${lines.filter((l) => l.text).length}줄을 불러왔어요.`)
    } catch (e) {
      set((p) => {
        const inputs = { ...p.inputs }
        delete inputs.lyrics
        return { inputs, lyrics: null }
      })
      notify(e instanceof Error ? e.message : '가사 파일을 읽지 못했어요.')
    }
  }

  /* 직접 편집한 노트는 원곡 파일별로 자동 저장 */
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleSave = () => {
    if (!sRef.current.project.real) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void engine.realSaveEdits(sRef.current.notes)
      set((p) => (p.analysis.info && !p.analysis.info.usingEdits ? { analysis: { ...p.analysis, info: { ...p.analysis.info, usingEdits: true, method: 'edits' } } } : {}))
    }, 600)
  }

  /* ------------------------------ 노트 편집 ------------------------------ */

  const pushHistory = (p: StudioState) => ({ past: [...p.past.slice(-49), p.notes], future: [] as Note[][] })

  const commitNotes = (notes: Note[], selection?: string[]) => {
    set((p) => ({ ...pushHistory(p), notes, notesRev: p.notesRev + 1, ...(selection ? { selection } : {}) }))
    scheduleSave()
  }

  const sorted = (n: Note[]) => [...n].sort((a, b) => a.start - b.start)

  const selectedNotes = () => {
    const st = sRef.current
    const ids = new Set(st.selection)
    return st.notes.filter((n) => ids.has(n.id))
  }

  return {
    set,
    notify,
    syncSec,
    setView: (view: View) => set({ view }),
    setRailTab: (railTab: RailTab) => set({ railTab }),
    setNotation: (notation: Notation) => set({ notation }),
    setTool: (tool: Tool) => set({ tool }),

    /* 입력 파일 */
    setInput: (kind: InputKind, file: File | null) => {
      set((p) => {
        const inputs = { ...p.inputs }
        // 데모 곡의 자리 표시 파일(file 없음)은 내 파일을 처음 넣는 순간 모두 비운다
        if (file) for (const k of Object.keys(inputs) as InputKind[]) if (!inputs[k]?.file) delete inputs[k]
        if (file) inputs[kind] = { name: file.name, size: file.size, file }
        else delete inputs[kind]
        return { inputs, ...(kind === 'lyrics' && !file ? { lyrics: null } : {}) }
      })
      if (kind === 'lyrics' && file) void loadLyrics(file)
    },
    setLyricsText,
    /* 가사 편집기 */
    updateLyricLine: (i: number, patch: Partial<LyricLine>) =>
      set((p) => {
        if (!p.lyrics) return {}
        const lines = p.lyrics.lines.map((l, k) => (k === i ? { ...l, ...patch, ...(patch.text !== undefined ? { words: undefined } : {}) } : l))
        // 시간을 바꿨으면 시간순으로 다시 정렬
        if (patch.t !== undefined) lines.sort((x, y) => x.t - y.t)
        return { lyrics: { ...p.lyrics, lines } }
      }),
    addLyricLine: (after: number) =>
      set((p) => {
        if (!p.lyrics) return {}
        const lines = [...p.lyrics.lines]
        const prev = lines[after]
        const next = lines[after + 1]
        const t = prev ? (next ? (prev.t + next.t) / 2 : prev.t + 2) : 0
        lines.splice(after + 1, 0, { t: Math.round(t * 100) / 100, text: '' })
        return { lyrics: { ...p.lyrics, lines } }
      }),
    removeLyricLine: (i: number) =>
      set((p) => (p.lyrics ? { lyrics: { ...p.lyrics, lines: p.lyrics.lines.filter((_, k) => k !== i) } } : {})),
    newLyrics: () => set({ lyrics: { name: '직접 입력한 가사', lines: [{ t: 0, text: '' }], offset: 0 } }),
    pasteReading: (text: string, from = 0) => {
      if (!from && /\[\d{1,3}:\d{1,2}/.test(text)) {
        setLyricsText('붙여넣은 가사', text)
        return
      }
      const cur = sRef.current.lyrics
      if (!cur) {
        notify('먼저 시간이 있는 가사(LRCLIB 등)를 불러와 주세요. 독음은 그 줄 시간에 맞춰 들어가요.')
        return
      }
      // 일본어·독음·해석이 섞인 가사면 독음만 골라서 맞는 줄에
      const pairs = splitMixedLyrics(text)
      if (pairs) {
        const m = assignMixedReadings(cur.lines, pairs, from)
        if (!m.placed) {
          notify(`일본어 ${pairs.length}줄은 찾았는데 독음 줄을 못 찾았어요. 일본어 다음 줄에 독음이 있는 가사인지 확인해 주세요.`)
          return
        }
        set({ lyrics: { ...cur, lines: m.lines } })
        const extra = [m.noReading ? `독음이 없는 일본어 ${m.noReading}줄` : '', m.unmatched ? `가사에서 같은 줄을 못 찾은 ${m.unmatched}줄` : ''].filter(Boolean).join(', ')
        notify(
          m.mode === 'text'
            ? `섞인 가사에서 독음 ${m.placed}줄을 골라 일본어가 같은 줄에 넣었어요.${extra ? ` (${extra}은 건너뜀)` : ''}`
            : `섞인 가사에서 독음을 골라 앞에서부터 순서대로 넣었어요. 일본어가 가사 줄과 달라서 순서로 맞췄으니 어긋난 곳을 확인해 주세요.${extra ? ` (${extra})` : ''}`,
        )
        return
      }
      const r = replaceLineTexts(cur.lines, text, from)
      if (!r.given) return
      set({ lyrics: { ...cur, lines: r.lines } })
      notify(r.given === r.timed ? `독음 ${r.given}줄을 줄 시간에 맞춰 넣었어요.` : `가사 줄은 ${r.timed}줄, 붙여넣은 독음은 ${r.given}줄이에요. 앞에서부터 순서대로 넣었으니 어긋난 곳을 확인해 주세요.`)
    },
    attachLyricsToNotes: () => {
      const st = sRef.current
      if (!st.lyrics) return
      const r = attachLyrics(st.notes, st.lyrics.lines, st.lyrics.offset)
      commitNotes(r.notes)
      notify(`가사 ${r.linesUsed}줄을 노트에 붙였어요.${r.shaky.length ? ` 음절과 노트 수가 많이 다른 줄이 ${r.shaky.length}개 있어요.` : ''} 틀린 곳은 노트 편집에서 고칠 수 있어요.`)
    },
    clearNoteLyrics: () => commitNotes(sRef.current.notes.map((n) => ({ ...n, lyric: undefined }))),
    setNoteLyric: (id: string, lyric: string) => commitNotes(sRef.current.notes.map((n) => (n.id === id ? { ...n, lyric: lyric || undefined } : n))),
    setLyricsOffset: (sec: number) => set((p) => (p.lyrics ? { lyrics: { ...p.lyrics, offset: Math.round(sec * 100) / 100 } } : {})),
    setSensitivity: (v: number) => set((p) => ({ analysis: { ...p.analysis, sensitivity: v } })),
    setSplit: (v: boolean) => set((p) => ({ analysis: { ...p.analysis, splitSyllables: v } })),
    analyze,
    runAlign,
    nudgeMr,
    setAutofill: (v: boolean) => set((p) => ({ analysis: { ...p.analysis, autofill: v } })),
    setSeparate: (v: boolean) => set((p) => ({ analysis: { ...p.analysis, separate: v } })),
    setForceGpu: (v: boolean) => {
      engine.realSetSepOptions({ forceGpu: v })
      set((p) => ({ analysis: { ...p.analysis, forceGpu: v } }))
    },
    setPitchModel: (v: PitchModel) => set((p) => ({ analysis: { ...p.analysis, pitchModel: v } })),
    setCrepeModel: (v: CrepeModel) => set((p) => ({ analysis: { ...p.analysis, crepeModel: v } })),
    nudgeNoteFile: async (sec: number) => {
      engine.realNudgeNoteFile(sec)
      await analyze(false, { useEdits: false })
    },
    autoAlignNoteFile: async () => {
      engine.realAutoAlignNoteFile()
      await analyze(false, { useEdits: false })
    },
    discardEdits: async () => {
      await engine.realDiscardEdits()
      await analyze(false, { useEdits: false })
      notify('직접 편집한 노트를 지우고 자동 분석 결과로 되돌렸어요.')
    },
    resetToDemo: () => {
      pause()
      recorder.reset()
      live.trace = []
      live.noteScore.clear()
      live.time = 0
      playerRef.current?.seek(0)
      const init = createInitialState()
      set({ ...init, bufferStatus: 'loading', notation: sRef.current.notation, syncMs: sRef.current.syncMs, volume: sRef.current.volume })
    },

    /* 재생 */
    seek,
    play,
    pause,
    togglePlay,
    skip,
    setSource: (source: Source) => {
      if (source === 'original' && sRef.current.duet.on) return notify('듀엣 모드에서는 MR에 원곡 보컬을 파트대로 틀어요. 원곡으로 들으려면 듀엣 모드를 꺼 주세요.')
      set({ source })
    },
    setVolume: (volume: number) => {
      playerRef.current?.setVolume(sRef.current.muted ? 0 : volume)
      set({ volume })
    },
    toggleMute: () => {
      const muted = !sRef.current.muted
      playerRef.current?.setVolume(muted ? 0 : sRef.current.volume)
      set({ muted })
    },
    setSyncMs: (ms: number) => set({ syncMs: clamp(Math.round(ms), -800, 800) }),
    setMicLatency: (ms: number) => set({ micLatencyMs: clamp(Math.round(ms), 0, 300) }),
    setMicGain: (micGain: number) => set({ micGain: Math.max(0.25, Math.min(4, micGain)) }),
    setMicMonitor: (micMonitor: number) => set({ micMonitor: Math.max(0, Math.min(1, micMonitor)) }),
    setMicMonitorOn: (micMonitorOn: boolean) => set({ micMonitorOn }),
    setMicMonitorReverb: (micMonitorReverb: boolean) => set({ micMonitorReverb }),
    setGuideVolume: (v: number) => {
      playerRef.current?.setGuideVolume(sRef.current.duet.on && v <= 0 ? 0.85 : clamp(v, 0, 1))
      set({ guideVolume: clamp(v, 0, 1) })
    },

    /* 키 · 음역 */
    setKey,
    openLibrarySong,
    renameLibrarySong,
    deleteLibrarySong,
    setOctaveMode: (octaveMode: OctaveMode) => set({ octaveMode }),
    setMicPref: (micPref: 'auto' | 'demo') => set({ micPref }),
    nudgeRange,
    setUserRange: (r: { low: number; high: number }) => set({ userRange: { low: r.low, high: r.high } }),
    startMeasure,
    confirmMeasure,
    cancelMeasure,

    /* 마이크 · 세션 */
    toggleMic,
    handlePitch,
    flushSession,
    resetSession,
    startPractice,
    cancelPractice,
    finishPractice,
    setLoop,
    clearLoop,
    listenFrom,
    setTakeVolume: (v: number) => set({ takeVolume: clamp(v, 0, 1) }),
    startReplay,
    stopReplay,
    setSpeed: async (speed: number) => {
      const st = sRef.current
      if (st.practice.phase !== 'idle') return notify('연습 중에는 배속을 바꿀 수 없어요.')
      if (live.replay && Math.abs(speed - st.takeSpeed) > 1e-3) return notify(`녹음 다시 보기는 녹음한 배속(${st.takeSpeed}x)으로만 들을 수 있어요.`)
      set({ speed })
      await playerRef.current?.setSpeed(speed)
    },
    setShowOrigLine: (showOrigLine: boolean) => set({ showOrigLine }),
    setOrigLineAlways: (origLineAlways: boolean) => set({ origLineAlways }),
    restorePractice,
    openTake,
    starTake,
    removeTake,
    setFx,
    setFxPreset,
    setFxCompare,
    exportMix,
    refreshMaster,
    setMasterPreset,
    setMasterCompare,
    setMasterMatched,
    listenSpot,
    toggleTuneSkip,
    setResultMr: (resultMr: boolean) => set({ resultMr }),

    /* 편집 */
    setSelection: (ids: string[]) => set({ selection: ids }),
    toggleDuet,
    setDuetStyle,
    setDuetPart,
    /** 노트 점검: 구간들을 원곡 보컬 음 선을 따라 노트로 채움 */
    fillGaps: (gaps: { start: number; end: number }[]) => {
      const st = sRef.current
      const c = engine.realOrigCurve()
      if (!c) return notify('원곡 보컬 음 선이 없어서 채울 수 없어요.')
      const curve = { ...c, midi: engine.foldCurveToNotes(c, st.notes) }
      let notes = st.notes
      const added: Note[] = []
      for (const g of gaps) {
        const made = fillFromCurve(curve, g.start - 0.02, g.end + 0.02, notes).map((n) => ({ id: engine.uid(), start: n.start, dur: n.dur, midi: n.midi }))
        added.push(...made)
        notes = [...notes, ...made]
      }
      if (!added.length) return notify('채울 노트를 찾지 못했어요. 선이 너무 짧거나 이미 노트가 있어요.')
      commitNotes(sorted(notes), added.map((n) => n.id))
      notify(`노트 ${added.length}개를 만들었어요. 마음에 안 들면 되돌리기(Ctrl+Z)로 취소할 수 있어요.`)
    },
    deleteNotes: (ids: string[]) => {
      const del = new Set(ids)
      const st = sRef.current
      const left = st.notes.filter((n) => !del.has(n.id))
      if (left.length === st.notes.length) return
      commitNotes(left, [])
      notify(`노트 ${st.notes.length - left.length}개를 지웠어요. 되돌리기(Ctrl+Z)로 취소할 수 있어요.`)
    },
    setNotePitches: (changes: { id: string; midi: number }[]) => {
      const m = new Map(changes.map((c) => [c.id, c.midi]))
      commitNotes(
        sRef.current.notes.map((n) => (m.has(n.id) ? { ...n, midi: m.get(n.id)! } : n)),
        changes.map((c) => c.id),
      )
    },
    beginDrag: () => set((p) => pushHistory(p)),
    dragNotes: (notes: Note[]) => set({ notes }),
    endDrag: () => {
      set((p) => ({ notesRev: p.notesRev + 1 }))
      scheduleSave()
    },
    commitNotes,
    deleteSelected: () => {
      const ids = new Set(sRef.current.selection)
      if (!ids.size) return
      commitNotes(
        sRef.current.notes.filter((n) => !ids.has(n.id)),
        [],
      )
    },
    mergeSelected: () => {
      const sel = selectedNotes()
      if (sel.length < 2) {
        notify('합치려면 노트를 2개 이상 선택하세요. (Shift+클릭)')
        return
      }
      const merged = engine.mergeNotes(sel)
      const ids = new Set(sel.map((n) => n.id))
      commitNotes(sorted([...sRef.current.notes.filter((n) => !ids.has(n.id)), merged]), [merged.id])
    },
    splitAt: (id: string, t: number) => {
      const n = sRef.current.notes.find((x) => x.id === id)
      if (!n) return
      const parts = engine.splitNote(n, t)
      if (!parts) {
        notify('노트 가장자리에서는 자를 수 없어요.')
        return
      }
      commitNotes(sorted([...sRef.current.notes.filter((x) => x.id !== id), ...parts]), [parts[1].id])
    },
    splitAtPlayhead: () => {
      const t = live.time - syncSec()
      const sel = selectedNotes()
      const target = sel.find((n) => t > n.start && t < n.start + n.dur) ?? engine.noteAt(sRef.current.notes, t)
      if (!target) {
        notify('재생 위치에 노트가 없어요.')
        return
      }
      const parts = engine.splitNote(target, t)
      if (!parts) {
        notify('노트 가장자리에서는 자를 수 없어요.')
        return
      }
      commitNotes(sorted([...sRef.current.notes.filter((x) => x.id !== target.id), ...parts]), [parts[1].id])
    },
    addNote: (n: Note) => commitNotes(sorted([...sRef.current.notes, n]), [n.id]),
    nudgeSelected: (d: { pitch?: number; time?: number; dur?: number }) => {
      const ids = new Set(sRef.current.selection)
      if (!ids.size) return
      commitNotes(
        sRef.current.notes.map((n) =>
          ids.has(n.id)
            ? {
                ...n,
                midi: n.midi + (d.pitch ?? 0),
                start: Math.max(0, n.start + (d.time ?? 0)),
                dur: Math.max(0.06, n.dur + (d.dur ?? 0)),
              }
            : n,
        ),
      )
    },
    undo: () => {
      set((p) => {
        if (!p.past.length) return {}
        const prev = p.past[p.past.length - 1]
        return { notes: prev, past: p.past.slice(0, -1), future: [p.notes, ...p.future], notesRev: p.notesRev + 1, selection: [] }
      })
      scheduleSave()
    },
    redo: () => {
      set((p) => {
        if (!p.future.length) return {}
        const next = p.future[0]
        return { notes: next, future: p.future.slice(1), past: [...p.past, p.notes], notesRev: p.notesRev + 1, selection: [] }
      })
      scheduleSave()
    },
    exportCsv: () => {
      const csv = engine.notesToCsv(sRef.current.notes)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${sRef.current.project.title || 'notes'}_notes.csv`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      notify('노트를 CSV로 저장했어요.')
    },
  }
}

export type Actions = ReturnType<typeof createActions>
