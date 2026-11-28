/**
 * VOCAL·LAB — 목업 엔진
 *
 * UI는 이 파일의 공개 인터페이스만 사용한다. 실제 엔진(보컬 분석 / 정렬 / 피치 시프트 / 마이크 피치 검출)으로
 * 교체할 때는 같은 시그니처를 유지하면 된다.
 *
 *  분석     analyzeOriginal · analyzeWithVocal · alignMr · parseNoteFile
 *  오디오   buildPitchShiftedBuffer · createPlayer
 *  마이크   startMic · stopMic · onPitch
 *  순수 로직 summarizeNotes · recommendKey · compareFrame · createRecorder · 노트 편집 헬퍼
 */

import { hzToMidi, midiToHz } from './music'
import * as realMod from './real/song'
import { loadSignalsmithStretch, type StretchNode } from './vendor/signalsmith-stretch'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const real = realMod as any

/* ------------------------------------------------------------------ */
/* 타입                                                                 */
/* ------------------------------------------------------------------ */

export interface Note {
  id: string
  /** 시작(초) */
  start: number
  /** 길이(초) */
  dur: number
  /** MIDI 번호 (소수 허용, 원곡 키 기준) */
  midi: number
  lyric?: string
}

export interface AnalysisOptions {
  /** 보컬 감지 감도 0~100 */
  sensitivity: number
  /** 가사 음절마다 노트를 나눌지 */
  splitSyllables: boolean
}

export type ProgressFn = (stage: string, ratio: number) => void

export interface AnalysisResult {
  notes: Note[]
  duration: number
  bpm: number
  source: 'original' | 'vocal' | 'noteFile'
  warnings: string[]
}

export interface AlignResult {
  /** MR이 원곡보다 늦게 시작하면 +, 단위 ms */
  offsetMs: number
  /** 0~1 */
  confidence: number
}

export interface PitchPoint {
  midi: number
  time: number
  id: string
}

export interface RangeSummary {
  low: PitchPoint
  high: PitchPoint
  span: number
  coreLow: number
  coreHigh: number
  noteCount: number
  totalSec: number
  histogram: { midi: number; sec: number }[]
}

export type Tier = 'great' | 'ok' | 'off'
export const TIER_CENTS = { great: 50, ok: 100 } as const

export interface Compare {
  target: number
  user: number
  /** 옥타브를 접은 뒤의 차이(센트). +면 높게 부름 */
  cents: number
  tier: Tier
  /** 한 옥타브 이상 다르게 부르는 경우 (−1: 한 옥타브 낮게) */
  octaveOff: number
}

export interface PitchFrame {
  time: number
  hz: number | null
  midi: number | null
  clarity: number
  level: number
  /** 가장 큰 순간 값 0~1 (1에 가까우면 소리가 찢어짐) */
  peak?: number
}

export interface DemoSinger {
  /** 지금 불러야 할 음 (없으면 쉬는 구간) */
  getTargetMidi: () => number | null
  /** 시뮬레이션 가수의 실제 음역 */
  ability?: { low: number; high: number }
}

export interface MicOptions {
  mode?: 'auto' | 'live' | 'demo'
  demo?: DemoSinger
}

export interface MicResult {
  mode: 'live' | 'demo'
  fellBack: boolean
  reason?: string
}

/* ------------------------------------------------------------------ */
/* 데모 곡 (목업 데이터)                                                   */
/* ------------------------------------------------------------------ */

export const DEMO_META = {
  title: '별빛 아래서',
  artist: 'VOCAL·LAB 데모 트랙',
  originalName: 'starlight_demo.mp3',
  mrName: 'starlight_demo_MR.mp3',
  vocalName: 'starlight_demo_vocal.wav',
  bpm: 92,
}

const BEAT = 60 / DEMO_META.bpm

type Tok = [dur: number, midi: number, syl?: string]

const fit = (toks: Tok[], total = 8): Tok[] => {
  const sum = toks.reduce((a, t) => a + t[0], 0)
  if (Math.abs(sum - total) < 1e-6) return toks
  if (sum > total) return toks.map((t) => [t[0] * (total / sum), t[1], t[2]] as Tok)
  return [...toks, [total - sum, 0] as Tok]
}

const SECTIONS: Tok[][] = [
  [[8, 0]],
  // verse A
  [[0.5, 0], [0.5, 60, '조'], [0.5, 60, '용'], [1, 62, '한'], [0.5, 60, '밤'], [0.5, 57, '하'], [1, 60, '늘'], [1, 64, '에'], [1.5, 62, '별'], [1, 60, '이']],
  [[0.5, 0], [0.5, 60, '내'], [1, 64, '어'], [0.5, 62, '깨'], [0.5, 60, '위'], [1, 62, '로'], [0.5, 64, '쏟'], [0.5, 64, '아'], [1, 65, '져'], [2, 64, '와']],
  [[0.5, 0], [0.5, 57, '숨'], [0.5, 57, '죽'], [1, 55, '인'], [0.5, 57, '거'], [0.5, 60, '리'], [1, 59, '에'], [0.5, 57, '혼'], [0.5, 55, '자'], [2.5, 52, '서']],
  [[0.5, 0], [0.5, 55, '걸'], [0.5, 57, '음'], [1, 60, '을'], [0.5, 60, '멈'], [0.5, 60, '추'], [1, 62, '고'], [0.5, 64, '너'], [0.5, 62, '를'], [1, 60, '불'], [1.5, 60, '러']],
  // pre-chorus
  [[0.5, 0], [0.5, 62, '한'], [0.5, 64, '걸'], [1, 65, '음'], [0.5, 67, '더'], [0.5, 65, '가'], [1, 64, '까'], [1, 62, '이'], [1, 64, '와'], [1.5, 65, '줘']],
  [[0.5, 0], [0.5, 64, '닿'], [0.5, 65, '을'], [1, 67, '듯'], [0.5, 65, '말'], [0.5, 67, '듯'], [1, 69, '한'], [0.5, 67, '그'], [0.5, 69, '순'], [2.5, 67, '간']],
  // chorus
  [[0.5, 0], [0.5, 67, '별'], [0.5, 67, '빛'], [1, 69, '아'], [0.5, 67, '래'], [0.5, 65, '서'], [1, 67, '우'], [0.5, 64, '린'], [0.5, 65, '하'], [1, 67, '나'], [1.5, 64, '가']],
  [[0.5, 0], [0.5, 69, '눈'], [0.5, 69, '부'], [1, 69, '신'], [0.5, 67, '이'], [0.5, 65, '밤'], [1, 67, '을'], [0.5, 69, '노'], [0.5, 67, '래'], [2.5, 64, '해']],
  [[0.5, 0], [0.5, 65, '잡'], [0.5, 67, '은'], [1, 69, '손'], [0.5, 69, '놓'], [0.5, 69, '지'], [1, 67, '않'], [0.5, 65, '을'], [3, 67, '게']],
  [[0.5, 0], [0.5, 67, '영'], [0.5, 69, '원'], [1.5, 69, '히'], [0.5, 67, '빛'], [0.5, 69, '나'], [1, 69, '는'], [0.5, 67, '순'], [2.5, 65, '간']],
  // interlude
  [[8, 0]],
  // bridge
  [[0.5, 0], [0.5, 57, '차'], [0.5, 60, '가'], [1, 62, '운'], [0.5, 64, '바'], [0.5, 62, '람'], [1, 60, '이'], [0.5, 60, '불'], [0.5, 60, '어'], [1, 57, '와'], [1.5, 55, '도']],
  [[0.5, 0], [0.5, 60, '네'], [0.5, 62, '가'], [1, 64, '있'], [0.5, 65, '어'], [0.5, 67, '서'], [1, 65, '괜'], [0.5, 64, '찮'], [0.5, 62, '아'], [2.5, 64, '요']],
  // last chorus — 최고음
  [[0.5, 0], [0.5, 67, '별'], [0.5, 67, '빛'], [1, 69, '아'], [0.5, 69, '래'], [0.5, 67, '서'], [1, 69, '우'], [0.5, 71, '린'], [0.5, 69, '하'], [2.5, 71, '나']],
  [[0.5, 0], [0.5, 69, '영'], [0.5, 69, '원'], [1, 67, '히'], [0.5, 65, '함'], [0.5, 64, '께'], [1, 65, '할'], [0.5, 67, '게'], [3, 64, '요']],
  [[4, 0]],
]

const FIT_EXEMPT = new Set([0, 11, 16])

interface RawNote {
  start: number
  dur: number
  midi: number
  lyric: string
  conf: number
  ghost?: boolean
  octaveError?: boolean
}

/** [beat, durBeats, midi, conf] — 반주 잔향·숨소리·화음이 보컬로 잘못 잡힌 후보 */
const GHOSTS: [number, number, number, number][] = [
  [2, 0.6, 62, 0.22],
  [5.5, 0.5, 67, 0.16],
  [16, 0.4, 57, 0.31],
  [32.2, 0.4, 60, 0.27],
  [90, 0.8, 69, 0.2],
  [91.5, 0.5, 79, 0.15],
  [93.5, 0.6, 60, 0.12],
  [128.5, 0.5, 71, 0.24],
]

const hash = (i: number) => {
  const x = Math.sin(i * 91.7 + 3.1) * 43758.5453
  return x - Math.floor(x)
}

let rawCache: { notes: RawNote[]; duration: number } | null = null

function buildRaw() {
  if (rawCache) return rawCache
  const notes: RawNote[] = []
  let beat = 0
  let idx = 0
  SECTIONS.forEach((sec, si) => {
    const toks = FIT_EXEMPT.has(si) ? sec : fit(sec)
    for (const [d, m, syl] of toks) {
      if (m > 0) {
        const lyric = syl ?? ''
        notes.push({
          start: beat * BEAT,
          dur: Math.max(0.08, d * BEAT - 0.025),
          midi: m,
          lyric,
          conf: 0.5 + 0.49 * hash(idx++),
          octaveError: (lyric === '인' && m === 55) || (lyric === '혼' && m === 57),
        })
      }
      beat += d
    }
  })
  for (const [b, d, m, c] of GHOSTS) {
    notes.push({ start: b * BEAT, dur: d * BEAT, midi: m, lyric: '', conf: c, ghost: true })
  }
  notes.sort((a, b) => a.start - b.start)
  rawCache = { notes, duration: beat * BEAT }
  return rawCache
}

let uidCounter = 0
export const uid = () => `n${(++uidCounter).toString(36)}`

function materialize(mode: 'original' | 'vocal', opts: AnalysisOptions): AnalysisResult {
  const { notes: raw, duration } = buildRaw()
  const thr = 0.97 * (1 - opts.sensitivity / 100) + 0.02
  const warnings: string[] = []

  let picked = raw
    .map((n) => {
      const c = mode === 'vocal' ? (n.ghost ? n.conf * 0.35 : Math.min(1, n.conf * 1.15 + 0.05)) : n.conf
      return { n, c }
    })
    .filter(({ c }) => c >= thr)
    .map(({ n }) => ({
      id: uid(),
      start: n.start,
      dur: n.dur,
      midi: mode === 'original' && n.octaveError ? n.midi + 12 : n.midi,
      lyric: n.lyric,
    })) as Note[]

  if (!opts.splitSyllables) {
    const merged: Note[] = []
    for (const n of picked) {
      const prev = merged[merged.length - 1]
      if (prev && Math.round(prev.midi) === Math.round(n.midi) && n.start - (prev.start + prev.dur) < 0.1) {
        prev.dur = n.start + n.dur - prev.start
        prev.lyric = (prev.lyric ?? '') + (n.lyric ?? '')
      } else merged.push({ ...n })
    }
    picked = merged
  }

  if (mode === 'original') {
    const errs = raw.filter((n) => n.octaveError).length
    warnings.push(`원곡 단독 분석은 반주 간섭으로 옥타브가 튀는 구간이 있을 수 있어요(의심 ${errs}곳). 보컬 분리 파일을 함께 넣으면 정확도가 올라갑니다.`)
  }
  if (opts.sensitivity >= 85) warnings.push('감도가 높아 반주·숨소리가 노트로 잡힐 수 있어요. 최고음이 비정상적으로 높다면 감도를 낮춰 보세요.')
  if (picked.length === 0) warnings.push('감지된 노트가 없습니다. 감도를 올려 다시 분석해 보세요.')

  return { notes: picked, duration, bpm: DEMO_META.bpm, source: mode, warnings }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function runStages(stages: [string, number][], onProgress?: ProgressFn) {
  for (const [label, ratio] of stages) {
    onProgress?.(label, ratio)
    await sleep(380)
  }
}

/* ------------------------------------------------------------------ */
/* 분석 API                                                              */
/* ------------------------------------------------------------------ */

export async function analyzeOriginal(_original: File | null, opts: AnalysisOptions, onProgress?: ProgressFn): Promise<AnalysisResult> {
  await runStages(
    [
      ['오디오 디코딩', 0.12],
      ['보컬 구간 감지', 0.38],
      ['피치 트래킹', 0.66],
      ['노트 분할', 0.9],
    ],
    onProgress,
  )
  onProgress?.('완료', 1)
  return materialize('original', opts)
}

export async function analyzeWithVocal(_original: File | null, _vocal: File, opts: AnalysisOptions, onProgress?: ProgressFn): Promise<AnalysisResult> {
  await runStages(
    [
      ['보컬 파일 디코딩', 0.18],
      ['피치 트래킹', 0.55],
      ['노트 분할', 0.88],
    ],
    onProgress,
  )
  onProgress?.('완료', 1)
  return materialize('vocal', opts)
}

let alignAttempt = 0
export async function alignMr(_original: File | null, _mr: File | null, onProgress?: ProgressFn): Promise<AlignResult> {
  onProgress?.('MR 시간 정렬', 0.3)
  await sleep(700)
  const a = alignAttempt++
  return {
    offsetMs: Math.round(124 + 14 * Math.sin(a * 1.7)),
    confidence: Math.round((0.84 + 0.09 * Math.cos(a * 2.3)) * 100) / 100,
  }
}

export const DEMO_ALIGN: AlignResult = { offsetMs: 124, confidence: 0.88 }

export function getDemoAnalysis(): AnalysisResult {
  return materialize('vocal', { sensitivity: 60, splitSyllables: true })
}

/* ------------------------------------------------------------------ */
/* 노트 파일 파서 (.mid / Tony .csv)                                      */
/* ------------------------------------------------------------------ */

export async function parseNoteFile(file: File): Promise<Note[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.mid') || name.endsWith('.midi')) return parseMidi(await file.arrayBuffer())
  return parseCsv(await file.text())
}

function parseCsv(text: string): Note[] {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.match(/("([^"]*)"|[^,]+)/g)?.map((c) => c.replace(/^"|"$/g, '').trim()) ?? [])
  const data = rows.filter((r) => r.length >= 3 && r.slice(0, 3).every((c) => c !== '' && !Number.isNaN(Number(c))))
  if (!data.length) throw new Error('노트를 읽을 수 없어요. (start, freq, duration) 형식의 CSV인지 확인해 주세요.')
  const med = (i: number) => {
    const v = data.map((r) => Number(r[i])).sort((a, b) => a - b)
    return v[Math.floor(v.length / 2)]
  }
  const freqCol = med(1) > med(2) ? 1 : 2
  const durCol = freqCol === 1 ? 2 : 1
  return data
    .map((r) => {
      const f = Number(r[freqCol])
      return {
        id: uid(),
        start: Number(r[0]),
        dur: Number(r[durCol]),
        midi: f > 127 ? hzToMidi(f) : f,
        lyric: r[3] && Number.isNaN(Number(r[3])) ? r[3] : undefined,
      } as Note
    })
    .filter((n) => n.dur > 0 && Number.isFinite(n.midi))
    .sort((a, b) => a.start - b.start)
}

function parseMidi(buf: ArrayBuffer): Note[] {
  const v = new DataView(buf)
  let p = 0
  const str = (n: number) => {
    let s = ''
    for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint8(p++))
    return s
  }
  if (str(4) !== 'MThd') throw new Error('올바른 MIDI 파일이 아니에요.')
  const hdrLen = v.getUint32(p)
  p += 4
  const ntrks = v.getUint16(p + 2)
  const div = v.getUint16(p + 4)
  p += hdrLen
  if (div & 0x8000) throw new Error('SMPTE 타임코드 MIDI는 지원하지 않아요.')

  const tempos: { tick: number; us: number }[] = [{ tick: 0, us: 500000 }]
  const tracks: { on: Map<number, number>; notes: { s: number; e: number; m: number }[] }[] = []

  for (let t = 0; t < ntrks && p < v.byteLength; t++) {
    if (str(4) !== 'MTrk') break
    const len = v.getUint32(p)
    p += 4
    const end = p + len
    let tick = 0
    let running = 0
    const tr = { on: new Map<number, number>(), notes: [] as { s: number; e: number; m: number }[] }
    const varLen = () => {
      let r = 0
      let b: number
      do {
        b = v.getUint8(p++)
        r = (r << 7) | (b & 0x7f)
      } while (b & 0x80)
      return r
    }
    while (p < end) {
      tick += varLen()
      let st = v.getUint8(p)
      if (st < 0x80) st = running
      else {
        p++
        if (st < 0xf0) running = st
      }
      if (st === 0xff) {
        const type = v.getUint8(p++)
        const l = varLen()
        if (type === 0x51 && l === 3) tempos.push({ tick, us: (v.getUint8(p) << 16) | (v.getUint8(p + 1) << 8) | v.getUint8(p + 2) })
        p += l
      } else if (st === 0xf0 || st === 0xf7) {
        p += varLen()
      } else {
        const hi = st & 0xf0
        const d1 = v.getUint8(p++)
        const d2 = hi === 0xc0 || hi === 0xd0 ? 0 : v.getUint8(p++)
        if (hi === 0x90 && d2 > 0) tr.on.set(d1, tick)
        else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) {
          const s = tr.on.get(d1)
          if (s !== undefined) {
            tr.notes.push({ s, e: tick, m: d1 })
            tr.on.delete(d1)
          }
        }
      }
    }
    p = end
    tracks.push(tr)
  }

  tempos.sort((a, b) => a.tick - b.tick)
  const toSec = (tick: number) => {
    let sec = 0
    let last = 0
    let us = tempos[0].us
    for (const tp of tempos) {
      if (tp.tick > tick) break
      sec += ((tp.tick - last) * us) / 1e6 / div
      last = tp.tick
      us = tp.us
    }
    return sec + ((tick - last) * us) / 1e6 / div
  }
  const melody = tracks.sort((a, b) => b.notes.length - a.notes.length)[0]
  if (!melody || !melody.notes.length) throw new Error('MIDI에서 노트를 찾지 못했어요.')
  return melody.notes
    .map((n) => ({ id: uid(), start: toSec(n.s), dur: Math.max(0.05, toSec(n.e) - toSec(n.s)), midi: n.m }))
    .sort((a, b) => a.start - b.start)
}

export function notesToCsv(notes: Note[]): string {
  return (
    [...notes]
      .sort((a, b) => a.start - b.start)
      .map((n) => [n.start.toFixed(4), midiToHz(n.midi).toFixed(3), n.dur.toFixed(4), n.lyric ? `"${n.lyric}"` : ''].join(','))
      .join('\n') + '\n'
  )
}

/* ------------------------------------------------------------------ */
/* 음역 요약 · 추천 키                                                    */
/* ------------------------------------------------------------------ */

export function summarizeNotes(notes: Note[]): RangeSummary | null {
  if (!notes.length) return null
  let low = notes[0]
  let high = notes[0]
  const hist = new Map<number, number>()
  let total = 0
  for (const n of notes) {
    if (n.midi < low.midi) low = n
    if (n.midi > high.midi) high = n
    const k = Math.round(n.midi)
    hist.set(k, (hist.get(k) ?? 0) + n.dur)
    total += n.dur
  }
  const histogram = [...hist.entries()].map(([midi, sec]) => ({ midi, sec })).sort((a, b) => a.midi - b.midi)
  const pct = (q: number) => {
    let acc = 0
    for (const h of histogram) {
      acc += h.sec
      if (acc >= total * q) return h.midi
    }
    return histogram[histogram.length - 1].midi
  }
  return {
    low: { midi: low.midi, time: low.start, id: low.id },
    high: { midi: high.midi, time: high.start, id: high.id },
    span: Math.round(high.midi - low.midi),
    coreLow: pct(0.1),
    coreHigh: pct(0.9),
    noteCount: notes.length,
    totalSec: total,
    histogram,
  }
}

export interface UserRange {
  low: number
  high: number
}

export interface FitInfo {
  /** 곡 최저음 − 내 최저음 (음수면 내 음역보다 낮음) */
  lowDelta: number
  /** 곡 최고음 − 내 최고음 (양수면 내 음역보다 높음) */
  highDelta: number
  outRatio: number
  inRange: boolean
}

export function evaluateFit(summary: RangeSummary, range: UserRange, shift: number): FitInfo {
  const lowDelta = summary.low.midi + shift - range.low
  const highDelta = summary.high.midi + shift - range.high
  let out = 0
  for (const h of summary.histogram) {
    const m = h.midi + shift
    if (m < range.low - 0.5 || m > range.high + 0.5) out += h.sec
  }
  return { lowDelta, highDelta, outRatio: out / summary.totalSec, inRange: lowDelta >= -0.5 && highDelta <= 0.5 }
}

function fitCost(summary: RangeSummary, range: UserRange, shift: number) {
  let c = 0
  for (const h of summary.histogram) {
    const m = h.midi + shift
    const d = m < range.low - 0.5 ? range.low - m : m > range.high + 0.5 ? m - range.high : 0
    if (d > 0) c += h.sec * Math.pow(d, 1.3)
  }
  return c / summary.totalSec
}

export type OctaveMode = 'auto' | -12 | 0 | 12

/** 키(−7~+7)가 정해졌을 때 내 음역에 가장 잘 맞는 옥타브 */
export function resolveOctave(summary: RangeSummary | null, range: UserRange, key: number, mode: OctaveMode): -12 | 0 | 12 {
  if (mode !== 'auto') return mode
  if (!summary) return 0
  let best: -12 | 0 | 12 = 0
  let bestCost = Infinity
  for (const o of [0, -12, 12] as const) {
    const c = fitCost(summary, range, key + o) + (o ? 0.2 : 0)
    if (c < bestCost) {
      bestCost = c
      best = o
    }
  }
  return best
}

export function recommendKey(summary: RangeSummary | null, range: UserRange, mode: OctaveMode): { key: number; octave: -12 | 0 | 12 } {
  if (!summary) return { key: 0, octave: 0 }
  let best = { key: 0, octave: 0 as -12 | 0 | 12 }
  let bestCost = Infinity
  for (let key = -7; key <= 7; key++) {
    const o = resolveOctave(summary, range, key, mode)
    const c = fitCost(summary, range, key + o) + 0.04 * Math.abs(key) + (o ? 0.2 : 0)
    if (c < bestCost - 1e-9) {
      bestCost = c
      best = { key, octave: o }
    }
  }
  return best
}

/* ------------------------------------------------------------------ */
/* 노트 편집 헬퍼                                                         */
/* ------------------------------------------------------------------ */

export function noteAt(notes: Note[], t: number): Note | null {
  let found: Note | null = null
  for (const n of notes) {
    if (n.start > t) continue
    if (t < n.start + n.dur && (!found || n.start > found.start)) found = n
  }
  return found
}

/** t 이후 horizon 초 안에서 가장 높은 음 */
export function upcomingPeak(notes: Note[], t: number, horizon: number): Note | null {
  let peak: Note | null = null
  for (const n of notes) {
    if (n.start + n.dur < t) continue
    if (n.start > t + horizon) continue
    if (!peak || n.midi > peak.midi) peak = n
  }
  return peak
}

export function splitNote(n: Note, t: number): [Note, Note] | null {
  const min = 0.06
  if (t < n.start + min || t > n.start + n.dur - min) return null
  const lyric = n.lyric ?? ''
  const cut = lyric.length >= 2 ? Math.ceil(lyric.length / 2) : lyric.length
  return [
    { ...n, dur: t - n.start, lyric: lyric.slice(0, cut) || undefined },
    { ...n, id: uid(), start: t, dur: n.start + n.dur - t, lyric: lyric.slice(cut) || undefined },
  ]
}

export function mergeNotes(ns: Note[]): Note {
  const s = [...ns].sort((a, b) => a.start - b.start)
  const start = s[0].start
  const end = Math.max(...s.map((n) => n.start + n.dur))
  const w = s.reduce((a, n) => a + n.dur, 0)
  const midi = Math.round(s.reduce((a, n) => a + n.midi * n.dur, 0) / w)
  return { id: s[0].id, start, dur: end - start, midi, lyric: s.map((n) => n.lyric ?? '').join('') || undefined }
}

/* ------------------------------------------------------------------ */
/* 실시간 비교 · 연습 기록                                                 */
/* ------------------------------------------------------------------ */

export function compareFrame(target: number, user: number): Compare {
  const diff = user - target
  const oct = Math.max(-2, Math.min(2, Math.round(diff / 12)))
  const folded = diff - 12 * oct
  const cents = folded * 100
  const a = Math.abs(cents)
  return { target, user, cents, tier: a <= TIER_CENTS.great ? 'great' : a <= TIER_CENTS.ok ? 'ok' : 'off', octaveOff: oct }
}

export interface NoteResult {
  id: string
  start: number
  dur: number
  midi: number
  lyric?: string
  great: number
  ok: number
  off: number
  meanCents: number
  /** 원곡 키 기준 음 (습관 분석에서 원곡 음정 곡선과 비교할 때) */
  orig: number
  /** [노트 시작부터의 시간(초), 센트 차이] — 습관 분석용 */
  samples: [number, number][]
  /** samples와 같은 순서의 마이크 소리 크기 (RMS, 상대값) */
  levels?: number[]
}

export interface SessionStats {
  total: number
  great: number
  ok: number
  off: number
  meanAbsCents: number
  biasCents: number
  octaveFrames: number
  userLow: number | null
  userHigh: number | null
  perNote: NoteResult[]
  /** 2초 단위 구간 정확도 */
  timeline: { start: number; great: number; ok: number; off: number }[]
}

export interface Recorder {
  push: (note: Note, shownMidi: number, cmp: Compare, t: number, level?: number) => void
  pushUser: (midi: number) => void
  snapshot: () => SessionStats
  reset: () => void
}

export function createRecorder(): Recorder {
  let acc = fresh()
  function fresh() {
    return {
      total: 0,
      great: 0,
      ok: 0,
      off: 0,
      absSum: 0,
      sum: 0,
      oct: 0,
      low: null as number | null,
      high: null as number | null,
      notes: new Map<string, NoteResult & { sum: number; n: number }>(),
      buckets: new Map<number, { start: number; great: number; ok: number; off: number }>(),
    }
  }
  return {
    push(note, shownMidi, cmp, t, level) {
      acc.total++
      acc[cmp.tier]++
      acc.absSum += Math.abs(cmp.cents)
      acc.sum += cmp.cents
      if (cmp.octaveOff !== 0) acc.oct++
      let nr = acc.notes.get(note.id)
      if (!nr) {
        nr = { id: note.id, start: note.start, dur: note.dur, midi: shownMidi, lyric: note.lyric, great: 0, ok: 0, off: 0, meanCents: 0, orig: note.midi, samples: [], levels: [], sum: 0, n: 0 }
        acc.notes.set(note.id, nr)
      }
      nr[cmp.tier]++
      nr.sum += cmp.cents
      nr.n++
      if (cmp.octaveOff === 0 && nr.samples.length < 2000) {
        nr.samples.push([t - note.start, cmp.cents])
        nr.levels!.push(level ?? 0)
      }
      const bk = Math.floor(t / 2)
      let b = acc.buckets.get(bk)
      if (!b) {
        b = { start: bk * 2, great: 0, ok: 0, off: 0 }
        acc.buckets.set(bk, b)
      }
      b[cmp.tier]++
    },
    pushUser(midi) {
      acc.low = acc.low === null ? midi : Math.min(acc.low, midi)
      acc.high = acc.high === null ? midi : Math.max(acc.high, midi)
    },
    snapshot() {
      return {
        total: acc.total,
        great: acc.great,
        ok: acc.ok,
        off: acc.off,
        meanAbsCents: acc.total ? acc.absSum / acc.total : 0,
        biasCents: acc.total ? acc.sum / acc.total : 0,
        octaveFrames: acc.oct,
        userLow: acc.low,
        userHigh: acc.high,
        perNote: [...acc.notes.values()].map((n) => ({ ...n, samples: [...n.samples], levels: [...(n.levels ?? [])], meanCents: n.n ? n.sum / n.n : 0 })).sort((a, b) => a.start - b.start),
        timeline: [...acc.buckets.values()].sort((a, b) => a.start - b.start),
      }
    },
    reset() {
      acc = fresh()
    },
  }
}

const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

/** 첫 화면에서 연습 결과 화면이 비어 보이지 않도록 만든 샘플 연습 기록 */
export function buildSampleSession(notes: Note[], shift: number, ability: UserRange): SessionStats {
  const rec = createRecorder()
  const r = rng(7)
  const gauss = () => (r() + r() + r() + r() - 2) * 1.2
  for (const n of notes) {
    const shown = n.midi + shift
    const bias = gauss() * 0.22 + (r() < 0.1 ? (r() < 0.5 ? -1 : 1) * 0.8 : 0)
    const over = Math.max(0, shown - ability.high)
    const under = Math.max(0, ability.low - shown)
    const frames = Math.max(2, Math.floor(n.dur * 20))
    for (let i = 0; i < frames; i++) {
      const t = n.start + (i / frames) * n.dur
      const user = shown + bias + gauss() * 0.14 - over * 0.65 - under * 0.4 + (i < 3 ? -0.35 : 0)
      rec.push(n, shown, compareFrame(shown, user), t, 0.1 * (1 - (0.35 * i) / frames))
      rec.pushUser(user)
    }
  }
  return rec.snapshot()
}

/* ------------------------------------------------------------------ */
/* 오디오 합성 (피치 시프트된 MR / 원곡 가이드)                              */
/* ------------------------------------------------------------------ */

const CHORDS: { pad: number[]; root: number }[] = [
  { pad: [57, 60, 64], root: 45 },
  { pad: [57, 60, 65], root: 41 },
  { pad: [55, 60, 64], root: 48 },
  { pad: [55, 59, 62], root: 43 },
]

const wrapSemis = (s: number) => ((((s + 6) % 12) + 12) % 12) - 6

export interface SongAudioSource {
  notes: Note[]
  duration: number
  bpm?: number
}

/**
 * 목업: 실제 곡 대신 노트 데이터로 MR(코드·베이스·드럼)과 가이드 멜로디를 합성해 돌려준다.
 * 실제 엔진에서는 원본 오디오를 피치 시프트한 AudioBuffer를 반환하면 된다.
 */
export async function buildPitchShiftedBuffer(song: SongAudioSource, track: 'mr' | 'original', semitones: number): Promise<AudioBuffer> {
  const sr = 32000
  const beat = 60 / (song.bpm ?? DEMO_META.bpm)
  const ctx = new OfflineAudioContext(1, Math.ceil((song.duration + 1.5) * sr), sr)
  const master = ctx.createGain()
  master.gain.value = 0.8
  master.connect(ctx.destination)

  const noise = ctx.createBuffer(1, sr, sr)
  const nd = noise.getChannelData(0)
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1

  const padBus = ctx.createBiquadFilter()
  padBus.type = 'lowpass'
  padBus.frequency.value = 1500
  padBus.connect(master)

  const env = (g: GainNode, t0: number, dur: number, peak: number, atk: number, rel: number) => {
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(peak, t0 + atk)
    g.gain.setValueAtTime(peak, t0 + Math.max(atk, dur - rel))
    g.gain.linearRampToValueAtTime(0, t0 + dur)
  }
  const tone = (type: OscillatorType, f: number, t0: number, dur: number, peak: number, atk: number, rel: number, dest: AudioNode, detune = 0) => {
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = f
    o.detune.value = detune
    const g = ctx.createGain()
    env(g, t0, dur, peak, atk, rel)
    o.connect(g).connect(dest)
    o.start(t0)
    o.stop(t0 + dur + 0.05)
  }
  const burst = (t0: number, dur: number, peak: number, filter: BiquadFilterType, freq: number) => {
    const s = ctx.createBufferSource()
    s.buffer = noise
    const f = ctx.createBiquadFilter()
    f.type = filter
    f.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(peak, t0)
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur)
    s.connect(f).connect(g).connect(master)
    s.start(t0)
    s.stop(t0 + dur + 0.02)
  }

  const hs = wrapSemis(semitones)
  const bars = Math.ceil(song.duration / (beat * 4))
  for (let b = 0; b < bars; b++) {
    const t0 = b * 4 * beat
    const ch = CHORDS[b % 4]
    for (const m of ch.pad) {
      tone('triangle', midiToHz(m + hs), t0, beat * 4, 0.05, 0.12, 0.35, padBus)
      tone('sine', midiToHz(m + hs + 12), t0, beat * 4, 0.012, 0.2, 0.35, padBus, 6)
    }
    const root = midiToHz(ch.root + hs)
    tone('sine', root, t0, beat * 1.4, 0.2, 0.01, 0.2, master)
    tone('sine', root, t0 + beat * 2, beat * 0.9, 0.17, 0.01, 0.15, master)
    tone('sine', root * 1.5, t0 + beat * 3.5, beat * 0.45, 0.1, 0.01, 0.1, master)
    if (b >= 2) {
      for (const k of [0, 2]) {
        const kt = t0 + k * beat
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.frequency.setValueAtTime(130, kt)
        o.frequency.exponentialRampToValueAtTime(42, kt + 0.14)
        g.gain.setValueAtTime(0.55, kt)
        g.gain.exponentialRampToValueAtTime(0.001, kt + 0.28)
        o.connect(g).connect(master)
        o.start(kt)
        o.stop(kt + 0.3)
      }
      for (const k of [1, 3]) burst(t0 + k * beat, 0.14, 0.2, 'bandpass', 1800)
      for (let k = 0; k < 8; k++) burst(t0 + k * beat * 0.5, 0.04, 0.05, 'highpass', 7500)
    }
  }

  if (track === 'original') {
    const vox = ctx.createBiquadFilter()
    vox.type = 'lowpass'
    vox.frequency.value = 3000
    const vg = ctx.createGain()
    vg.gain.value = 0.22
    vox.connect(vg).connect(master)
    for (const n of song.notes) {
      const f = midiToHz(n.midi + semitones)
      const t0 = Math.max(0, n.start)
      const dur = Math.max(0.08, n.dur)
      tone('sawtooth', f, t0, dur, 0.35, 0.035, 0.08, vox)
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = f
      const g = ctx.createGain()
      env(g, t0, dur, 0.7, 0.03, 0.08)
      if (dur > 0.6) {
        const lfo = ctx.createOscillator()
        lfo.frequency.value = 5.6
        const lg = ctx.createGain()
        lg.gain.setValueAtTime(0, t0)
        lg.gain.linearRampToValueAtTime(14, t0 + Math.min(0.5, dur * 0.6))
        lfo.connect(lg).connect(o.detune)
        lfo.start(t0)
        lfo.stop(t0 + dur + 0.05)
      }
      o.connect(g).connect(vox)
      o.start(t0)
      o.stop(t0 + dur + 0.05)
    }
  }

  return ctx.startRendering()
}

/* ------------------------------------------------------------------ */
/* 플레이어                                                              */
/* ------------------------------------------------------------------ */

export interface Player {
  load: (buf: AudioBuffer) => void
  play: () => Promise<void>
  pause: () => void
  seek: (t: number) => void
  /** 실제로 들리는 위치(초). 출력 지연 반영 */
  getTime: () => number
  isPlaying: () => boolean
  setVolume: (v: number) => void
  onEnded: (cb: () => void) => void
  /** 출력 장치 지연(ms) */
  outputLatencyMs: () => number
  /** 반주와 함께 재생할 가이드 보컬 (같은 시간축). null이면 끔 */
  loadGuide: (buf: AudioBuffer | null) => void
  /** 가이드 보컬 볼륨 0~1 */
  setGuideVolume: (v: number) => void
  /** 오디오 컨텍스트 (싱크 측정용) */
  audioContext: () => AudioContext
  /** 녹음한 내 목소리 레이어들 (원래 목소리, 튜닝, 화음, 더블링 …). null이면 끔 */
  loadTakeLayers: (layers: TakeLayer[] | null) => void
  /** 레이어 볼륨 (0~1, 제곱하지 않은 그대로) */
  setLayerGain: (id: string, g: number) => void
  /** 내 목소리 전체 볼륨 0~1 */
  setTakeVolume: (v: number) => void
  /** 내 목소리에 걸 효과 체인. null이면 효과 없음 */
  setTakeChain: (chain: { input: AudioNode; output: AudioNode } | null) => void
  /** 마스터링: 반주+내 목소리를 다 섞은 뒤에 거는 처리 (null이면 기본 리미터만) */
  setMaster: (chain: { input: AudioNode; output: AudioNode } | null) => void
  /** 지금 재생 중인 반주 버퍼 (저장용) */
  getBuffer: () => AudioBuffer | null
  /** 배속을 반영한 재생 버퍼(음 높이 보정)와 배속 (저장용 — 처음엔 계산에 시간이 걸림) */
  getPlayback: () => Promise<{ buf: AudioBuffer | null; speed: number }>
  /** 배속 (음 높이는 그대로, 재생하면서 바로 처리) */
  setSpeed: (speed: number) => Promise<void>
  getSpeed: () => number
  onSpeedProgress: (cb: (r: number | null) => void) => void
  dispose: () => void
}

/** 내 목소리 레이어 — 같은 시간축(t0)에서 함께 재생 */
export interface TakeLayer {
  id: string
  t0: number
  buf: AudioBuffer
  gain: number
  /** 녹음할 때의 배속 (곡 1초가 녹음 1/rate초) */
  rate?: number
}

/** 녹음한 내 목소리 한 구간 — t0: 곡에서 시작하는 시간(초) */
export interface TakeSegment {
  t0: number
  sr: number
  data: Float32Array
}

export function createPlayer(): Player {
  let ctx: AudioContext | null = null
  let gain: GainNode | null = null
  let buffer: AudioBuffer | null = null
  let src: AudioBufferSourceNode | null = null
  let offset = 0
  let startedAt = 0
  let playing = false
  let token = 0
  let volume = 0.8
  let endedCb: (() => void) | null = null
  let guideBuf: AudioBuffer | null = null
  let guideSrc: AudioBufferSourceNode | null = null
  let guideGain: GainNode | null = null
  let guideVol = 0
  let layers: { id: string; t0: number; buf: AudioBuffer; g: GainNode; rate: number }[] = []
  /* 배속: 버퍼를 speed배로 재생하고(음이 같이 변함) 실시간 피치 보정 노드로 음 높이만 되돌린다.
     미리 계산하지 않으니 바로 바뀐다. 보정 노드는 1배가 아닐 때만 거친다 (지연 latency()초) */
  let speed = 1
  let baseBuffer: AudioBuffer | null = null
  let mainIn: GainNode | null = null
  let stretch: StretchNode | null = null
  let stretchReady: Promise<StretchNode | null> | null = null
  let stretched = false
  let stretchLatSec = 0.12
  const stretchLat = () => (stretched && stretch ? stretchLatSec : 0)
  const route = () => {
    if (!mainIn || !gain) return
    mainIn.disconnect()
    stretch?.disconnect()
    stretched = Math.abs(speed - 1) > 1e-3 && !!stretch
    if (stretched && stretch) {
      mainIn.connect(stretch)
      stretch.connect(gain)
      stretch.schedule({ active: true, semitones: -12 * Math.log2(speed) })
    } else {
      mainIn.connect(gain)
      stretch?.schedule({ active: false })
    }
  }
  const compCache = new WeakMap<AudioBuffer, Map<number, AudioBuffer>>()
  let speedProg: ((r: number | null) => void) | null = null
  let speedTok = 0
  const compensate = async (b: AudioBuffer, s: number): Promise<AudioBuffer> => {
    if (Math.abs(s - 1) < 1e-3) return b
    let m = compCache.get(b)
    if (!m) compCache.set(b, (m = new Map()))
    const hit = m.get(s)
    if (hit) return hit
    const out = (await real.speedCompensated(b, s, (p: number) => speedProg?.(p))) as AudioBuffer
    m.set(s, out)
    return out
  }
  let takeSrcs: AudioBufferSourceNode[] = []
  let takeBus: GainNode | null = null
  /* 반주와 내 목소리가 모이는 곳 → (마스터링) → 리미터 → 스피커 */
  let mixBus: GainNode | null = null
  let baseLim: DynamicsCompressorNode | null = null
  let master: { input: AudioNode; output: AudioNode } | null = null
  const wireMaster = () => {
    if (!mixBus || !baseLim || !ctx) return
    mixBus.disconnect()
    if (master) {
      mixBus.connect(master.input)
      master.output.disconnect()
      master.output.connect(ctx.destination)
    } else mixBus.connect(baseLim)
  }
  let takeGain: GainNode | null = null
  let takeVol = 0
  let chain: { input: AudioNode; output: AudioNode } | null = null
  const wireChain = () => {
    if (!takeBus || !takeGain) return
    takeBus.disconnect()
    if (chain) {
      takeBus.connect(chain.input)
      chain.output.disconnect()
      chain.output.connect(takeGain)
    } else takeBus.connect(takeGain)
  }

  const ensure = () => {
    if (!ctx) {
      ctx = real.audioCtx() as AudioContext
      gain = ctx.createGain()
      gain.gain.value = volume * volume
      // 원곡/MR 음량을 맞추느라 올린 소리가 찢어지지 않게 리미터를 건다
      const lim = ctx.createDynamicsCompressor()
      lim.threshold.value = -2
      lim.knee.value = 0
      lim.ratio.value = 20
      lim.attack.value = 0.002
      lim.release.value = 0.1
      mixBus = ctx.createGain()
      baseLim = lim
      gain.connect(mixBus)
      lim.connect(ctx.destination)
      wireMaster()
      mainIn = ctx.createGain()
      mainIn.connect(gain)
      guideGain = ctx.createGain()
      guideGain.gain.value = guideVol * guideVol
      guideGain.connect(mainIn)
      const c0 = ctx
      stretchReady = Promise.race([
        loadSignalsmithStretch().then((SignalsmithStretch) => SignalsmithStretch(c0, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('시간 초과')), 8000)),
      ])
        .then(async (n) => {
          if (ctx !== c0) return null
          const l = Number(await n.latency())
          if (Number.isFinite(l) && l >= 0 && l < 1) stretchLatSec = l
          stretch = n
          route()
          return n
        })
        .catch((e) => {
          console.warn('배속 처리 노드를 못 만들었어요', e)
          return null
        })
      // 내 목소리는 반주 볼륨과 따로 조절한다
      takeGain = ctx.createGain()
      takeGain.gain.value = takeVol * takeVol
      takeGain.connect(mixBus)
      takeBus = ctx.createGain()
      wireChain()
    }
    return ctx
  }
  const stopTake = () => {
    for (const t of takeSrcs) {
      try {
        t.stop()
      } catch {
        /* already stopped */
      }
      t.disconnect()
    }
    takeSrcs = []
  }
  const startTake = (when: number, at: number) => {
    stopTake()
    if (!ctx || !takeBus || !layers.length) return
    for (const L of layers) {
      // 녹음은 rate 배속으로 부른 것: 곡 시간 T ↔ 녹음 (T − t0)/rate 초
      if (L.t0 + L.buf.duration * L.rate <= at) continue
      const g = ctx.createBufferSource()
      g.buffer = L.buf
      g.playbackRate.value = speed / L.rate
      g.connect(L.g)
      g.start(when + stretchLat() + Math.max(0, (L.t0 - at) / speed), Math.max(0, (at - L.t0) / L.rate))
      takeSrcs.push(g)
    }
  }
  const stopGuide = () => {
    if (guideSrc) {
      try {
        guideSrc.stop()
      } catch {
        /* already stopped */
      }
      guideSrc.disconnect()
      guideSrc = null
    }
  }
  const startGuide = (when: number, at: number) => {
    stopGuide()
    if (!guideBuf || !ctx || !guideGain || at >= guideBuf.duration) return
    const g = ctx.createBufferSource()
    g.buffer = guideBuf
    g.playbackRate.value = speed
    g.connect(guideGain)
    g.start(when, at)
    guideSrc = g
  }
  const rawPos = () => (playing && ctx ? offset + (ctx.currentTime - startedAt) * speed : offset)
  const stopSrc = () => {
    token++
    if (src) {
      try {
        src.stop()
      } catch {
        /* already stopped */
      }
      src.disconnect()
      src = null
    }
    stopGuide()
    stopTake()
  }
  const startSrc = () => {
    if (!buffer) return
    const c = ensure()
    void c.resume()
    if (offset >= buffer.duration - 0.02) offset = 0
    const s = c.createBufferSource()
    s.buffer = buffer
    s.playbackRate.value = speed
    s.connect(mainIn!)
    const my = ++token
    s.onended = () => {
      if (my !== token) return
      playing = false
      offset = buffer ? buffer.duration : 0
      src = null
      endedCb?.()
    }
    // 반주와 가이드 보컬이 같은 순간에 시작하도록 아주 약간 뒤로 예약한다
    const when = c.currentTime + 0.03
    s.start(when, offset)
    startGuide(when, offset)
    startTake(when, offset)
    src = s
    startedAt = when
    playing = true
  }

  return {
    load(buf) {
      baseBuffer = buf
      const apply = (b: AudioBuffer) => {
        const was = playing
        const pos = rawPos()
        stopSrc()
        playing = false
        buffer = b
        offset = Math.min(pos, b.duration)
        if (was) startSrc()
      }
      apply(buf)
    },
    async play() {
      if (playing) return
      ensure()
      // 배속 중인데 보정 노드가 아직 준비 전이면 잠깐 기다린다 (처음 한 번, 아주 짧게)
      if (Math.abs(speed - 1) > 1e-3 && !stretch) {
        await stretchReady
        route()
        if (playing) return
      }
      startSrc()
    },
    pause() {
      if (!playing) return
      offset = rawPos()
      stopSrc()
      playing = false
    },
    seek(t) {
      const max = buffer ? buffer.duration : t
      const was = playing
      stopSrc()
      playing = false
      offset = Math.max(0, Math.min(t, max))
      if (was) startSrc()
    },
    getTime() {
      const lat = ctx ? ((ctx.outputLatency || 0) + (ctx.baseLatency || 0) + stretchLat()) * speed : 0
      const t = playing ? rawPos() - lat : offset
      return Math.max(0, buffer ? Math.min(t, buffer.duration) : t)
    },
    isPlaying: () => playing,
    setVolume(v) {
      volume = v
      if (gain) gain.gain.value = v * v
    },
    onEnded(cb) {
      endedCb = cb
    },
    loadGuide(buf) {
      guideBuf = buf
      if (playing && ctx) startGuide(ctx.currentTime + 0.02, rawPos() + 0.02 * speed)
      else if (!buf) stopGuide()
    },
    setGuideVolume(v) {
      guideVol = v
      if (guideGain) guideGain.gain.value = v * v
    },
    audioContext: () => ensure(),
    loadTakeLayers(next) {
      ensure()
      stopTake()
      for (const L of layers) L.g.disconnect()
      layers = (next ?? []).map((L) => {
        const g = ctx!.createGain()
        g.gain.value = L.gain
        g.connect(takeBus!)
        return { id: L.id, t0: L.t0, buf: L.buf, g, rate: L.rate ?? 1 }
      })
      if (playing && ctx) startTake(ctx.currentTime + 0.02, rawPos() + 0.02)
    },
    setLayerGain(id, v) {
      const L = layers.find((x) => x.id === id)
      if (L && ctx) L.g.gain.setTargetAtTime(v, ctx.currentTime, 0.015)
    },
    setMaster(c) {
      ensure()
      if (master && master !== c) master.output.disconnect()
      master = c
      wireMaster()
    },
    setTakeChain(c) {
      ensure()
      if (chain && chain !== c) chain.output.disconnect()
      chain = c
      wireChain()
    },
    getBuffer: () => baseBuffer ?? buffer,
    async getPlayback() {
      const sp = speed
      const b = baseBuffer ?? buffer
      return { buf: b ? await compensate(b, sp) : null, speed: sp }
    },
    getSpeed: () => speed,
    onSpeedProgress(cb) {
      speedProg = cb
    },
    async setSpeed(s) {
      s = Math.max(0.25, Math.min(2, s))
      if (Math.abs(s - speed) < 1e-3) return
      const c = ensure()
      const tok = ++speedTok
      if (Math.abs(s - 1) > 1e-3 && !stretch) await stretchReady
      if (tok !== speedTok) return
      const wasOn = stretched
      const on = Math.abs(s - 1) > 1e-3 && !!stretch
      if (!playing) {
        speed = s
        route()
        return
      }
      if (wasOn && on) {
        // 재생 중 배속끼리 바꾸기: 끊지 않고 그 자리에서 속도·보정만 바꾼다
        const pos = rawPos()
        const now = c.currentTime
        offset = pos
        startedAt = now
        speed = s
        src?.playbackRate.setValueAtTime(s, now)
        guideSrc?.playbackRate.setValueAtTime(s, now)
        stretch!.schedule({ active: true, semitones: -12 * Math.log2(s) })
        startTake(now, pos)
        return
      }
      // 1배 ↔ 배속: 보정 노드를 넣고 빼야 해서 그 자리에서 다시 시작
      const pos = rawPos()
      stopSrc()
      playing = false
      speed = s
      route()
      offset = buffer ? Math.min(pos, buffer.duration) : pos
      startSrc()
    },
    setTakeVolume(v) {
      takeVol = v
      if (takeGain) takeGain.gain.value = v * v
    },
    outputLatencyMs() {
      const c = ensure()
      return Math.round(((c.outputLatency || 0) + (c.baseLatency || 0)) * 1000)
    },
    dispose() {
      stopSrc()
      gain?.disconnect()
      stretch?.disconnect()
      stretch = null
      ctx = null
    },
  }
}

/* ------------------------------------------------------------------ */
/* 마이크 / 피치 검출                                                     */
/* ------------------------------------------------------------------ */

const listeners = new Set<(f: PitchFrame) => void>()
const emit = (f: PitchFrame) => listeners.forEach((l) => l(f))

export function onPitch(cb: (f: PitchFrame) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

interface MicRuntime {
  stream?: MediaStream
  ctx?: AudioContext
  /** 입력 감도를 거친 마이크 소리 (음 높이 분석·녹음·모니터링이 모두 여기서 나간다) */
  node?: AudioNode
  inGain?: GainNode
  mon?: GainNode
  monRev?: GainNode
  timer: ReturnType<typeof setInterval>
}
let mic: MicRuntime | null = null

/* 마이크 설정: 입력 감도(배율), 내 목소리 듣기 음량(0~1), 듣기에 울림 넣기 */
const micCfg = { gain: 1, monitor: 0, reverb: true }
function applyMicCfg() {
  if (!mic?.ctx) return
  const t = mic.ctx.currentTime
  mic.inGain?.gain.setTargetAtTime(micCfg.gain, t, 0.02)
  const v = micCfg.monitor * micCfg.monitor
  mic.mon?.gain.setTargetAtTime(v, t, 0.02)
  mic.monRev?.gain.setTargetAtTime(micCfg.reverb ? v * 0.45 : 0, t, 0.02)
}
/** 마이크 입력 감도 (0.25~4배, 1 = 그대로) */
export function setMicGain(g: number) {
  micCfg.gain = Math.max(0.1, Math.min(8, g))
  applyMicCfg()
}
/** 내 목소리 듣기 (이어폰 모니터링) 음량 0~1, 울림 */
export function setMicMonitor(vol: number, reverb: boolean) {
  micCfg.monitor = Math.max(0, Math.min(1, vol))
  micCfg.reverb = reverb
  applyMicCfg()
}

/** 모니터링용 짧은 울림 (노래방 느낌) */
function monitorIR(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate
  const len = Math.round(sr * 1.4)
  const ir = ctx.createBuffer(2, len, sr)
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < sr * 0.012 ? i / (sr * 0.012) : 1)
  }
  return ir
}

export function detectPitch(buf: Float32Array, sr: number): { hz: number; clarity: number; level: number } {
  const n = 1024
  let e = 0
  for (let i = 0; i < n; i++) e += buf[i] * buf[i]
  const level = Math.sqrt(e / n)
  if (level < 0.012) return { hz: 0, clarity: 0, level }
  const minLag = Math.floor(sr / 1000)
  const maxLag = Math.min(Math.floor(sr / 75), buf.length - n - 1)
  const nsdf = new Float32Array(maxLag + 1)
  let max = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    let ac = 0
    let m = 0
    for (let i = 0; i < n; i++) {
      const a = buf[i]
      const b = buf[i + lag]
      ac += a * b
      m += a * a + b * b
    }
    const v = m > 0 ? (2 * ac) / m : 0
    nsdf[lag] = v
    if (v > max) max = v
  }
  if (max < 0.6) return { hz: 0, clarity: max, level }
  let best = -1
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (nsdf[lag] > 0.9 * max && nsdf[lag] >= nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1] && nsdf[lag] > 0.3) {
      best = lag
      break
    }
  }
  if (best < 0) return { hz: 0, clarity: max, level }
  const a = nsdf[best - 1]
  const b = nsdf[best]
  const c = nsdf[best + 1]
  const denom = a - 2 * b + c
  const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0
  return { hz: sr / (best + shift), clarity: b, level }
}

function startDemoSinger(demo: DemoSinger) {
  const ability = demo.ability ?? { low: 47.7, high: 69.2 }
  const r = rng(Date.now() & 0xffff)
  const gauss = () => (r() + r() + r() - 1.5) * 1.6
  let cur: number | null = null
  let lastTarget: number | null = null
  let bias = 0
  const t0 = performance.now()
  const timer = setInterval(() => {
    const now = (performance.now() - t0) / 1000
    const target = demo.getTargetMidi()
    let midi: number | null = null
    if (target !== null) {
      if (lastTarget === null || Math.abs(target - lastTarget) > 0.4) {
        bias = gauss() * 0.2 + (r() < 0.12 ? (r() < 0.5 ? -1 : 1) * 0.75 : 0)
      }
      let want = target + bias
      if (want > ability.high) want = ability.high - (want - ability.high) * 0.7 + gauss() * 0.3
      if (want < ability.low - 0.2) {
        cur = null
        want = NaN
      }
      if (!Number.isNaN(want)) {
        cur = cur === null ? want - 0.5 : cur + (want - cur) * 0.22
        midi = cur + Math.sin(now * 2 * Math.PI * 5.6) * 0.13 + gauss() * 0.03
      }
    } else cur = null
    lastTarget = target
    emit({
      time: performance.now() / 1000,
      hz: midi === null ? null : midiToHz(midi),
      midi,
      clarity: midi === null ? 0 : 0.95,
      level: midi === null ? 0.002 : 0.12 + r() * 0.06,
    })
  }, 16)
  mic = { timer }
}

export async function startMic(opts: MicOptions = {}): Promise<MicResult> {
  stopMic()
  const mode = opts.mode ?? 'auto'
  let reason: string | undefined
  if (mode !== 'demo') {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('이 브라우저에서는 마이크를 사용할 수 없어요.')
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        })
      } catch (e1) {
        const n = (e1 as { name?: string })?.name
        if (n === 'NotAllowedError' || n === 'NotFoundError') throw e1
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      }
      // 내 목소리 듣기가 늦게 들리지 않게 짧은 지연으로
      const ctx = new AudioContext({ latencyHint: 'interactive' })
      await ctx.resume().catch(() => {})
      const src = ctx.createMediaStreamSource(stream)
      const inGain = ctx.createGain()
      inGain.gain.value = micCfg.gain
      src.connect(inGain)
      const an = ctx.createAnalyser()
      an.fftSize = 2048
      inGain.connect(an)
      // 내 목소리 듣기: 그대로 + 울림
      const mon = ctx.createGain()
      mon.gain.value = 0
      inGain.connect(mon).connect(ctx.destination)
      const conv = ctx.createConvolver()
      conv.buffer = monitorIR(ctx)
      const monRev = ctx.createGain()
      monRev.gain.value = 0
      inGain.connect(conv).connect(monRev).connect(ctx.destination)
      const buf = new Float32Array(an.fftSize)
      const spike = makeSpikeFilter()
      const timer = setInterval(() => {
        an.getFloatTimeDomainData(buf)
        let peak = 0
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]))
        const { hz, clarity, level } = detectPitch(buf, ctx.sampleRate)
        const midi = spike(hz > 0 ? hzToMidi(hz) : null)
        emit({ time: performance.now() / 1000, hz: midi === null ? null : midiToHz(midi), midi, clarity, level, peak })
      }, 20)
      mic = { stream, ctx, node: inGain, inGain, mon, monRev, timer }
      applyMicCfg()
      return { mode: 'live', fellBack: false }
    } catch (e) {
      reason = micErrorMessage(e)
      if (mode === 'live') throw new Error(reason)
    }
  }
  startDemoSinger(opts.demo ?? { getTargetMidi: () => null })
  return { mode: 'demo', fellBack: mode === 'auto', reason }
}

/**
 * 마이크 음 높이에서 순간적으로 튀는 값을 걸러낸다 (20ms 프레임 기준).
 * - 바로 앞 음과 2.5반음 넘게 차이 나는 값은 바로 쓰지 않고 보류한다.
 *   보류한 값이 3프레임(약 60ms) 연속으로 1반음 안에서 비슷하면 진짜 음 이동으로 받아들이고,
 *   아니면 버린다 (자음·숨소리·배음 착각으로 한두 프레임만 튀는 경우).
 * - 소리가 막 시작될 때도 2프레임이 비슷해야 받아들인다.
 * - 받아들인 값은 최근 3개의 중앙값으로 살짝 다듬는다.
 */
export function makeSpikeFilter(jump = 2.5) {
  let prev: number | null = null
  let pend: number[] = []
  let recent: number[] = []
  const accept = (m: number) => {
    prev = m
    pend = []
    recent.push(m)
    if (recent.length > 3) recent.shift()
    return [...recent].sort((a, b) => a - b)[Math.floor(recent.length / 2)]
  }
  return (m: number | null): number | null => {
    if (m === null) {
      prev = null
      pend = []
      recent = []
      return null
    }
    if (prev !== null && Math.abs(m - prev) <= jump) return accept(m)
    pend.push(m)
    if (pend.length > 4) pend.shift()
    const need = prev === null ? 2 : 3
    const tail = pend.slice(-need)
    if (tail.length === need && Math.max(...tail) - Math.min(...tail) <= 1) {
      recent = []
      return accept(m)
    }
    return null
  }
}

export function micErrorMessage(e: unknown): string {
  const n = (e as { name?: string })?.name ?? ''
  if (typeof window !== 'undefined' && window.self !== window.top) return '미리보기 화면 안에서는 마이크가 막혀 있어요. 사이트 주소를 새 탭에서 열어 주세요.'
  if (n === 'NotFoundError') return '마이크 장치를 찾지 못했어요. 연결을 확인해 주세요.'
  if (n === 'NotReadableError') return '윈도우가 마이크를 열지 못했어요. 마이크를 쓰는 다른 프로그램을 끄고 크롬을 재시작해 보세요. (NotReadableError)'
  if (n === 'NotAllowedError') return '마이크 권한이 막혀 있어요. 주소창 왼쪽 아이콘 → 마이크 허용, 윈도우 설정 → 개인정보 → 마이크도 확인해 주세요.'
  if (n === 'SecurityError') return 'https 주소에서만 마이크를 쓸 수 있어요.'
  return e instanceof Error ? e.message : '마이크 권한을 얻지 못했어요.'
}

/* 연습 녹음 — 마이크 소리를 그대로 모은다 (곡 시간축에 맞춰 다시 들려주기용)
 *
 * 조각마다 "마이크 오디오의 몇 번째 샘플인지"를 같이 받아서 그 자리에 놓는다.
 * 예전처럼 도착한 순서대로 이어 붙이면, 화면이 바쁠 때 조각이 하나 빠질 때마다
 * 그 뒤가 전부 앞당겨져 뒤로 갈수록 목소리가 빨라졌다.
 * 녹음은 오디오 스레드(AudioWorklet)에서 해서 화면이 바빠도 빠지지 않게 하고,
 * 못 쓰는 브라우저에서는 ScriptProcessor + 재생 시각으로 자리를 잡는다.
 */
interface TakeState {
  chunks: { f: number; d: Float32Array }[]
  /** (마이크 오디오 시각, 곡 시각) 짝 — 둘의 차이로 샘플 위치를 곡 시간으로 바꾼다 */
  offs: number[]
  sr: number
  /** 배속: 녹음 1초 = 곡 rate초 */
  rate: number
  getT: () => number
  stop: () => void
}
let take: TakeState | null = null
const workletReady = new WeakMap<AudioContext, Promise<boolean>>()

const REC_WORKLET = `class VLRec extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(4096); this.n = 0; this.f0 = 0; this.on = true;
    this.port.onmessage = (e) => { if (e.data === 'stop') { this.flush(); this.on = false } } }
  flush() { if (this.n > 0) { this.port.postMessage({ f: this.f0, d: this.buf.slice(0, this.n) }); this.n = 0 } }
  process(inputs) {
    if (!this.on) return false
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    if (this.n === 0) this.f0 = currentFrame
    // 오디오가 끊겨 프레임이 건너뛰면 지금까지를 먼저 보낸다
    else if (currentFrame !== this.f0 + this.n) { this.flush(); this.f0 = currentFrame }
    this.buf.set(ch, this.n); this.n += ch.length
    if (this.n + 128 > this.buf.length) this.flush()
    return true
  }
}
registerProcessor('vl-rec', VLRec)`

function ensureWorklet(ctx: AudioContext): Promise<boolean> {
  let p = workletReady.get(ctx)
  if (!p) {
    p = (async () => {
      try {
        if (!ctx.audioWorklet) return false
        const url = URL.createObjectURL(new Blob([REC_WORKLET], { type: 'text/javascript' }))
        await ctx.audioWorklet.addModule(url)
        URL.revokeObjectURL(url)
        return true
      } catch {
        return false
      }
    })()
    workletReady.set(ctx, p)
  }
  return p
}

/** 마이크를 켜 둔 상태면 녹음 준비 (연습 시작 전에 불러 두면 첫 조각을 놓치지 않는다) */
export function prepareTake(): Promise<boolean> {
  return mic?.ctx ? ensureWorklet(mic.ctx) : Promise.resolve(false)
}

/** 마이크 녹음 시작. getSongTime: 지금 마이크에 들어오는 소리가 곡의 몇 초인지 */
export async function startTake(getSongTime: () => number, rate = 1): Promise<boolean> {
  stopTake()
  if (!mic?.ctx || !mic.node) return false
  const ctx = mic.ctx
  const node = mic.node
  const tk: TakeState = { chunks: [], offs: [], sr: ctx.sampleRate, rate, getT: getSongTime, stop: () => {} }
  const stamp = () => tk.offs.push(tk.getT() - tk.rate * ctx.currentTime)
  take = tk
  if (await ensureWorklet(ctx)) {
    if (take !== tk) return false
    const wn = new AudioWorkletNode(ctx, 'vl-rec', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' })
    wn.port.onmessage = (e: MessageEvent<{ f: number; d: Float32Array }>) => {
      tk.chunks.push(e.data)
      stamp()
    }
    node.connect(wn)
    stamp()
    tk.stop = () => {
      try {
        node.disconnect(wn)
      } catch {
        /* already */
      }
      wn.port.postMessage('stop')
    }
    return true
  }
  // 예전 방식: 재생 시각(playbackTime)으로 자리를 잡는다
  const sp = ctx.createScriptProcessor(4096, 1, 1)
  const mute = ctx.createGain()
  mute.gain.value = 0
  sp.onaudioprocess = (e) => {
    const d = e.inputBuffer.getChannelData(0)
    const f = Math.round(e.playbackTime * tk.sr) - d.length
    tk.chunks.push({ f, d: new Float32Array(d) })
    stamp()
  }
  node.connect(sp)
  sp.connect(mute)
  mute.connect(ctx.destination)
  stamp()
  tk.stop = () => {
    try {
      node.disconnect(sp)
    } catch {
      /* already */
    }
    sp.disconnect()
    mute.disconnect()
    sp.onaudioprocess = null
  }
  return true
}

/** 마이크 녹음 끝 — 녹음한 구간을 돌려준다 (AudioWorklet의 마지막 조각을 받으려고 잠깐 기다린다) */
export async function stopTake(): Promise<TakeSegment | null> {
  const tk = take
  take = null
  if (!tk) return null
  tk.stop()
  await new Promise((r) => setTimeout(r, 60))
  if (!tk.chunks.length || !tk.offs.length) return null
  const f0 = Math.min(...tk.chunks.map((c) => c.f))
  const f1 = Math.max(...tk.chunks.map((c) => c.f + c.d.length))
  const data = new Float32Array(f1 - f0)
  for (const c of tk.chunks) data.set(c.d, c.f - f0)
  // 곡 시각 − 마이크 오디오 시각: 화면이 바빠 늦게 잰 값이 섞여도 흔들리지 않게 중앙값
  const offs = [...tk.offs].sort((a, b) => a - b)
  const off = offs[offs.length >> 1]
  return { t0: off + (tk.rate * f0) / tk.sr, sr: tk.sr, data }
}

export function stopMic(): void {
  void stopTake()
  if (!mic) return
  clearInterval(mic.timer)
  mic.stream?.getTracks().forEach((t) => t.stop())
  void mic.ctx?.close()
  mic = null
}

/* ------------------------------------------------------------------ */
/* 실제 엔진 (사용자 파일)                                                */
/* ------------------------------------------------------------------ */


export type PitchModel = 'crepe' | 'classic'
export type CrepeModel = 'tiny' | 'small' | 'medium'

export interface RealInputs {
  original?: File | null
  mr?: File | null
  vocal?: File | null
  noteFile?: File | null
}

export interface RealOptions extends AnalysisOptions {
  autofill: boolean
  pitchModel: PitchModel
  crepeModel: CrepeModel
  /** 저장해 둔 직접 편집 노트가 있으면 그걸 쓸지 */
  useEdits: boolean
  /** 보컬 파일이 없으면 AI(UVR5 Kim_Vocal_2)로 보컬을 분리할지 */
  separate: boolean
}

export type AnalysisMethod = 'edits' | 'midi' | 'tony' | 'vocal+crepe+ai' | 'vocal+ai' | 'vocal' | 'mr' | 'original' | 'noteFile'

export interface RealInfo {
  method: AnalysisMethod
  seconds: number
  fileInfo: { name: string; lag: number; oct: number; score: number | null; tracks: number; added: number; autofillActive: boolean } | null
  syllableAdded: number
  /** 작게 섞여 든 소리라서 뺀 노트 수 */
  quietDropped: number
  crepeUsed: number | null
  vocOffset: number | null
  align: { offset: number; conf: number; manual: boolean } | null
  usingEdits: boolean
  separated: { model: string; ep?: string; seconds?: number; cached?: boolean } | null
}

export interface RealResult {
  notes: (Note & { fill?: boolean })[]
  duration: number
  warnings: string[]
  info: RealInfo
}

export const METHOD_LABEL: Record<AnalysisMethod, string> = {
  edits: '직접 편집한 노트',
  midi: 'MIDI 노트 파일',
  tony: 'Tony 노트 파일',
  'vocal+crepe+ai': '분리된 보컬 + CREPE + AI 노트',
  'vocal+ai': '분리된 보컬 + AI 노트',
  vocal: '분리된 보컬',
  mr: 'MR 비교 · 보컬 구간만',
  original: '원곡만 · 반주 섞일 수 있음',
  noteFile: '노트 파일',
}

export async function analyzeReal(inputs: RealInputs, opts: RealOptions, onProgress?: ProgressFn): Promise<RealResult> {
  return real.analyzeSong(inputs, opts, onProgress) as Promise<RealResult>
}

export async function realAlignMr(): Promise<AlignResult | null> {
  const r = await real.alignMrReal(true)
  return r ? { offsetMs: Math.round(r.offset * 1000), confidence: r.conf } : null
}
export function realNudgeMr(sec: number): AlignResult | null {
  const r = real.nudgeMrOffset(sec)
  return r ? { offsetMs: Math.round(r.offset * 1000), confidence: r.conf } : null
}
export const realNudgeNoteFile = (sec: number) => real.nudgeNoteFile(sec)
export const realAutoAlignNoteFile = () => real.autoAlignNoteFile()
export const realSaveEdits = (notes: Note[]) => real.saveEdits(notes)
export const realDiscardEdits = () => real.discardEdits()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const realSaveLyrics = (l: any) => real.saveLyrics(l)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const realLoadLyrics = (): Promise<any> => real.loadLyrics()
/** 디버깅용: 현재 곡의 내부 상태 */
export const realSong = () => real.SONG
/** 원곡 보컬의 음 높이(원곡 키, MIDI) — 없으면 NaN */
export const realOrigPitchAt = (t: number): number => real.origPitchAt(t)
/**
 * 원곡 보컬 음 곡선을 노트에 맞춰 옥타브 정리.
 * 음 높이 추적이 가끔 한 옥타브 위·아래를 잡으므로, 끊기지 않고 이어진 구간마다
 * 겹치는(없으면 가까운) 노트의 음과 가장 가까운 옥타브로 통째로 옮긴다. 모양(꺾기·떨림)은 그대로.
 */
export function foldCurveToNotes(curve: { t0: number; hop: number; midi: Float32Array }, notes: Note[]): Float32Array {
  const src = curve.midi
  const out = new Float32Array(src.length).fill(NaN)
  const sorted = [...notes].sort((a, b) => a.start - b.start)
  if (!sorted.length) return Float32Array.from(src)
  // 순간마다 기준 음: 그 시간을 덮는 노트, 없으면 1.5초 안의 가장 가까운 노트 (이어진 구간은 앞의 기준을 이어 씀)
  let j = 0
  let lastRef = NaN
  for (let i = 0; i < src.length; i++) {
    const m = src[i]
    if (!Number.isFinite(m)) {
      lastRef = NaN
      continue
    }
    const t = curve.t0 + i * curve.hop
    while (j + 1 < sorted.length && sorted[j + 1].start <= t) j++
    let ref = NaN
    for (const k of [j, j + 1, j - 1]) {
      const n = sorted[k]
      if (n && t >= n.start - 0.02 && t <= n.start + n.dur + 0.02) {
        ref = n.midi
        break
      }
    }
    if (!Number.isFinite(ref)) ref = lastRef
    if (!Number.isFinite(ref)) {
      let best = 1.5
      for (const k of [j - 1, j, j + 1]) {
        const n = sorted[k]
        if (!n) continue
        const d = t < n.start ? n.start - t : t > n.start + n.dur ? t - (n.start + n.dur) : 0
        if (d < best) {
          best = d
          ref = n.midi
        }
      }
    }
    lastRef = ref
    out[i] = Number.isFinite(ref) ? m + 12 * Math.round((ref - m) / 12) : m
  }
  return out
}

/** 원곡 보컬 음 높이 곡선 전체 (원곡 키 MIDI, 소리 없는 곳은 NaN) — 분석 전이거나 원곡이 없으면 null */
export const realOrigCurve = (): { t0: number; hop: number; midi: Float32Array } | null => {
  const m = (real.SONG as { lastMel?: { hop: number; midi: Float32Array } | null }).lastMel
  return m ? { t0: real.MEL_T0, hop: m.hop, midi: m.midi } : null
}
export const realLevelInfo = (): { orig: number; mr: number } | null => real.levelInfo()

/** 재생에 쓰는 오디오 컨텍스트 (하나를 같이 쓴다) */
export const audioContext = (): AudioContext => real.audioCtx()
export const realHasGuideVocal = (): boolean => real.hasGuideVocal()
export const realSeparatedWav = (kind: 'vocal' | 'inst'): Promise<Blob | null> => real.separatedWav(kind)
/**
 * 노트 비교 듣기: 원곡 보컬 구간 → 지금 노트 음 → 제안 음 (피아노 비슷한 소리) 차례로.
 * onStep(0|1|2)로 지금 뭐가 나오는지, 끝나면 onStep(-1). 돌려주는 함수로 멈춤.
 */
export function compareListen(t0: number, t1: number, midiA: number, midiB: number, onStep: (i: number) => void): () => void {
  const ctx = real.audioCtx() as AudioContext
  void ctx.resume()
  const seg = real.vocalSegment(Math.max(0, t0 - 0.12), t1 + 0.12) as { buf: AudioBuffer } | null
  const out = ctx.createGain()
  out.gain.value = 0.9
  out.connect(ctx.destination)
  const t = ctx.currentTime + 0.05
  const vDur = seg ? Math.min(3.5, seg.buf.duration) : 0
  const nodes: AudioScheduledSourceNode[] = []
  if (seg) {
    const s = ctx.createBufferSource()
    s.buffer = seg.buf
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(1, t + 0.02)
    g.gain.setValueAtTime(1, t + vDur - 0.04)
    g.gain.linearRampToValueAtTime(0, t + vDur)
    s.connect(g).connect(out)
    s.start(t, 0, vDur)
    nodes.push(s)
  }
  const tone = (midi: number, at: number, dur: number) => {
    const f = 440 * Math.pow(2, (midi - 69) / 12)
    for (const [k, amp] of [
      [1, 0.32],
      [2, 0.12],
      [3, 0.05],
      [4, 0.025],
    ] as const) {
      const o = ctx.createOscillator()
      o.frequency.value = f * k
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(amp, at + 0.008)
      g.gain.exponentialRampToValueAtTime(amp * 0.35, at + 0.35)
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
      o.connect(g).connect(out)
      o.start(at)
      o.stop(at + dur + 0.02)
      nodes.push(o)
    }
  }
  const tA = t + vDur + 0.35
  const tB = tA + 1.15
  tone(midiA, tA, 0.95)
  tone(midiB, tB, 0.95)
  const end = tB + 1.0
  const timers = [0, tA, tB, end].map((at, i) => setTimeout(() => onStep(i === 3 ? -1 : i), Math.max(0, (at - ctx.currentTime) * 1000)))
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    timers.forEach(clearTimeout)
    for (const n of nodes) {
      try {
        n.stop()
      } catch {}
    }
    setTimeout(() => out.disconnect(), 50)
    onStep(-1)
  }
}

/** 보컬 소리 크기 곡선 (10ms마다 dB) — 보컬 파일이나 AI 분리가 없으면 null */
export const realVocalEnvelope = (): { t0: number; hop: number; db: Float32Array } | null => real.vocalEnvelope()
/** AI 분리 설정 (그래픽카드 강제 시도) */
export const realSetSepOptions = (o: { forceGpu?: boolean }) => real.setSepOptions(o)
/** 마지막 AI 분리에 쓴 장치와 그래픽카드를 못 쓴 이유 */
export const realSepDiag = (): { ep: string | null; reason: string; gpu: string } => ({ ...(real.sepDiag as { ep: string | null; reason: string; gpu: string }) })

export async function realTrackBuffer(track: 'mr' | 'original' | 'vocal', semitones: number, onProg?: (p: number, eta: string) => void): Promise<AudioBuffer | null> {
  return real.getTrackBuffer(track, semitones, onProg)
}
