/**
 * 연습 기록 — 곡마다 연습 리포트 요약을 브라우저(localStorage)에 저장한다.
 * 같은 곡의 지난 기록과 비교하고 점수 변화를 그래프로 보여 줄 때 쓴다.
 */
import type { Report } from './report'

export interface HistoryEntry {
  at: number
  shift: number
  score: number
  nums: Record<string, number>
  phrases: { start: number; score: number }[]
  /** 음 높이별 기록 (음역 다시 분석용) */
  pitch?: [number, number, number, number, number][]
}

const KEY = 'vocallab-history'
const MAX_PER_SONG = 40

type Store = Record<string, HistoryEntry[]>

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Store) : {}
  } catch {
    return {}
  }
}

function write(st: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(st))
  } catch {
    /* 저장 공간이 없으면 조용히 넘긴다 */
  }
}

/** 곡을 구분하는 키 — 제목과 길이 */
export const songKey = (title: string, duration: number) => `${title}|${Math.round(duration)}`

export function loadHistory(key: string): HistoryEntry[] {
  return read()[key] ?? []
}

export function saveHistory(key: string, shift: number, r: Report): HistoryEntry[] {
  const st = read()
  const list = st[key] ?? []
  list.push({ at: Date.now(), shift, score: r.score, nums: r.keyNums, phrases: r.phrases.map((p) => ({ start: Math.round(p.start * 100) / 100, score: p.score })), pitch: r.pitchStats.map((c) => [c[0], c[1], c[2], c[3], Math.round(c[4])] as [number, number, number, number, number]) })
  st[key] = list.slice(-MAX_PER_SONG)
  write(st)
  return st[key]
}

export function clearHistory(key: string) {
  const st = read()
  delete st[key]
  write(st)
}

/** 지난 기록에서 같은 소절(시작 시간이 0.5초 안)의 점수 */
export function phraseDelta(prev: HistoryEntry | undefined, start: number, score: number): number | null {
  if (!prev) return null
  const p = prev.phrases.find((x) => Math.abs(x.start - start) < 0.5)
  return p ? score - p.score : null
}
