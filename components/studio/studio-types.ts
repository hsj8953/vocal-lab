import * as engine from '@/lib/engine'
import type { AlignResult, Compare, Note, OctaveMode, SessionStats, Tier, UserRange } from '@/lib/engine'
import type { Notation } from '@/lib/music'

export type View = 'import' | 'studio' | 'result'
export type RailTab = 'key' | 'analysis' | 'edit'
export type Tool = 'select' | 'add' | 'cut'
export type Source = 'mr' | 'original'
export type InputKind = 'original' | 'mr' | 'vocal' | 'noteFile'

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
  bufferStatus: 'loading' | 'ready'

  mic: { on: boolean; mode: 'live' | 'demo' | null }
  micPref: 'auto' | 'demo'

  session: SessionStats
  sessionIsSample: boolean
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
    project: { title: m.title, artist: m.artist, duration: demo.duration, bpm: m.bpm },
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
      sensitivity: 60,
      splitSyllables: true,
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
    bufferStatus: 'loading',
    mic: { on: false, mode: null },
    micPref: 'auto',
    session: sample,
    sessionIsSample: true,
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
    noteScore: new Map(),
    windowSec: 9,
  }
}

export const EMPTY_SESSION: SessionStats = engine.createRecorder().snapshot()
