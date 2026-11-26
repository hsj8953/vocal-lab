import * as engine from '@/lib/engine'
import type { AlignResult, Compare, CrepeModel, Note, OctaveMode, PitchModel, RealInfo, SessionStats, Tier, UserRange } from '@/lib/engine'
import type { Notation } from '@/lib/music'
import { FX_OFF, type FxParams } from '@/lib/vocal-fx'

export type View = 'import' | 'studio' | 'result'
export type RailTab = 'key' | 'analysis' | 'edit'
export type Tool = 'select' | 'add' | 'cut'
export type Source = 'mr' | 'original'
export type InputKind = 'original' | 'mr' | 'vocal' | 'noteFile' | 'lyrics'

export interface InputFile {
  name: string
  size: number
  /** 데모 입력은 null */
  file: File | null
}

export interface ProjectMeta {
  title: string
  artist: string
  duration: number
  bpm: number
  /** 사용자 파일로 만든 곡이면 true (데모는 false) */
  real: boolean
}

export interface AnalysisState {
  status: 'idle' | 'running' | 'done' | 'error'
  stage: string
  ratio: number
  source: 'original' | 'vocal' | 'noteFile'
  warnings: string[]
  error?: string
  sensitivity: number
  splitSyllables: boolean
  /** 노트 파일의 빈 곳을 분석 결과로 채우기 */
  autofill: boolean
  pitchModel: PitchModel
  crepeModel: CrepeModel
  /** 보컬 파일이 없을 때 AI로 보컬·반주 분리 */
  separate: boolean
  info: RealInfo | null
}

export interface LyricWord {
  t: number
  text: string
}
export interface LyricLine {
  t: number
  /** 원래 가사 (예: 일본어) */
  text: string
  /** 한국어 독음 — 있으면 화면 표시와 노트 붙이기에 이걸 쓴다 */
  reading?: string
  /** 단어별 시간 (확장 LRC <mm:ss.xx>) */
  words?: LyricWord[]
}
export interface Lyrics {
  name: string
  lines: LyricLine[]
  /** 표시 시간 보정(초). +면 가사가 늦게 나온다 */
  offset: number
}

export interface MeasureState {
  step: 'idle' | 'low' | 'high'
  low: number | null
  high: number | null
}

export interface StudioState {
  view: View
  railTab: RailTab
  notation: Notation
  notice: string | null

  project: ProjectMeta
  inputs: Partial<Record<InputKind, InputFile>>
  analysis: AnalysisState
  align: { status: 'idle' | 'running' | 'done'; result: AlignResult | null }

  notes: Note[]
  past: Note[][]
  future: Note[][]
  notesRev: number
  selection: string[]
  tool: Tool

  userRange: UserRange
  keyShift: number
  octaveMode: OctaveMode
  measure: MeasureState

  playing: boolean
  source: Source
  volume: number
  muted: boolean
  syncMs: number
  /** MR에 섞어 들을 가이드 보컬 볼륨 0~1 */
  guideVolume: number
  /** 가이드 보컬(분리 보컬 또는 보컬 파일)이 있는지 */
  guideAvailable: boolean
  /** 가사 (.lrc) */
  lyrics: Lyrics | null
  /** 마이크 입력 지연(ms) — 내 목소리 선을 이만큼 앞으로 당긴다 */
  micLatencyMs: number
  bufferStatus: 'loading' | 'ready'
  bufferMsg: string | null
  outputLatencyMs: number
  level: { orig: number; mr: number } | null

  mic: { on: boolean; mode: 'live' | 'demo' | null }
  micPref: 'auto' | 'demo'

  session: SessionStats
  sessionIsSample: boolean

  /** 연습 모드 — 카운트다운 후 곡 끝까지 부르면 결과 화면으로 */
  practice: PracticeState
  /** 마지막 연습 구간 (결과 분석 범위) */
  practiceSpan: { t0: number; t1: number } | null
  /** 마지막 연습에서 녹음한 내 목소리가 있는지 */
  takeAvailable: boolean
  /** 결과 화면에서 들을 내 목소리 볼륨 0~1 */
  takeVolume: number
  /** 결과 화면에서 반주도 같이 들을지 */
  resultMr: boolean
  /** 연습 기록이 저장될 때마다 바뀐다 (결과 화면 기록 다시 읽기용) */
  historyRev: number
  /** 소절 반복 구간 */
  loop: { a: number; b: number; label?: string } | null

  /** 녹음한 내 노래에 거는 효과 */
  fx: FxParams
  /** 효과 프리셋 id (직접 바꾸면 'custom') */
  fxPreset: string
  /** 튜닝 전/후 비교: 지금 들리는 쪽 */
  fxCompare: 'tuned' | 'raw'
  /** 효과 계산 중 (0~1), 아니면 null */
  fxBusy: number | null
  /** 저장 중 */
  exporting: boolean

  /** 지금 열려 있는 곡이 내 곡 목록의 어떤 곡인지 */
  librarySongId: string | null
  /** 내 곡 목록이 바뀔 때마다 증가 */
  libraryRev: number
  /** 목록에서 여는 중인 곡 */
  libraryOpening: string | null
  /** 스튜디오에서 녹음 다시 보기 중 (내 목소리 + 그때 그린 선) */
  replay: boolean
}

export interface PracticeState {
  phase: 'idle' | 'countdown' | 'running'
  count: number
  t0: number
  t1: number
}

export interface TracePoint {
  t: number
  midi: number | null
  tier: Tier | null
}

/** 60fps로 갱신되는 값들 — React 상태가 아니라 캔버스/HUD가 직접 읽는다 */
export interface Live {
  time: number
  playing: boolean
  duration: number
  notes: Note[]
  shift: number
  userRange: UserRange
  selection: Set<string>
  notation: Notation
  edit: boolean
  tool: Tool
  pitchMidi: number | null
  micLevel: number
  micOn: boolean
  cmp: Compare | null
  targetNoteId: string | null
  trace: TracePoint[]
  /** 마지막 연습에서 그린 내 음 선 전체 (녹음 다시 보기용) */
  replayTrace: TracePoint[] | null
  /** 녹음 다시 보기 중 */
  replay: boolean
  noteScore: Map<string, [number, number, number]>
  windowSec: number
}

export const DEMO_ABILITY: UserRange = { low: 47.7, high: 69.2 }

export function createInitialState(): StudioState {
  const demo = engine.getDemoAnalysis()
  const sample = engine.buildSampleSession(demo.notes, 0, DEMO_ABILITY)
  const m = engine.DEMO_META
  return {
    view: 'studio',
    railTab: 'key',
    notation: 'scientific',
    notice: null,
    project: { title: m.title, artist: m.artist, duration: demo.duration, bpm: m.bpm, real: false },
    inputs: {
      original: { name: m.originalName, size: 5_412_000, file: null },
      mr: { name: m.mrName, size: 5_380_000, file: null },
      vocal: { name: m.vocalName, size: 14_900_000, file: null },
    },
    analysis: {
      status: 'done',
      stage: '완료',
      ratio: 1,
      source: 'vocal',
      warnings: [],
      sensitivity: 50,
      splitSyllables: true,
      autofill: true,
      pitchModel: 'classic',
      crepeModel: 'small',
      separate: true,
      info: null,
    },
    align: { status: 'done', result: engine.DEMO_ALIGN },
    notes: demo.notes,
    past: [],
    future: [],
    notesRev: 0,
    selection: [],
    tool: 'select',
    userRange: { low: 48, high: 69 },
    keyShift: 0,
    octaveMode: 'auto',
    measure: { step: 'idle', low: null, high: null },
    playing: false,
    source: 'mr',
    volume: 0.8,
    muted: false,
    syncMs: 0,
    micLatencyMs: 60,
    guideVolume: 0,
    guideAvailable: false,
    lyrics: null,
    bufferStatus: 'loading',
    bufferMsg: null,
    outputLatencyMs: 0,
    level: null,
    mic: { on: false, mode: null },
    micPref: 'auto',
    session: sample,
    sessionIsSample: true,
    practice: { phase: 'idle', count: 0, t0: 0, t1: 0 },
    practiceSpan: null,
    takeAvailable: false,
    takeVolume: 0.9,
    resultMr: true,
    historyRev: 0,
    loop: null,
    fx: FX_OFF,
    fxPreset: 'raw',
    fxCompare: 'tuned',
    fxBusy: null,
    exporting: false,
    librarySongId: null,
    libraryRev: 0,
    libraryOpening: null,
    replay: false,
  }
}

export function createLive(): Live {
  return {
    time: 0,
    playing: false,
    duration: 0,
    notes: [],
    shift: 0,
    userRange: { low: 48, high: 69 },
    selection: new Set(),
    notation: 'scientific',
    edit: false,
    tool: 'select',
    pitchMidi: null,
    micLevel: 0,
    micOn: false,
    cmp: null,
    targetNoteId: null,
    trace: [],
    replayTrace: null,
    replay: false,
    noteScore: new Map(),
    windowSec: 9,
  }
}

export const EMPTY_SESSION: SessionStats = engine.createRecorder().snapshot()
