import type { LyricLine, LyricWord } from '@/components/studio/studio-types'

const TS = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g
const WORD = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g

const toSec = (m: string, s: string) => Number(m) * 60 + Number(s.replace(':', '.'))

/**
 * LRC 가사 파서
 * - [mm:ss.xx]가사  (한 줄에 시간이 여러 개여도 됨)
 * - 확장 LRC: [mm:ss.xx]<mm:ss.xx>단어 <mm:ss.xx>단어 …  → 단어별 강조
 * - [offset:+300] (ms, +면 가사가 그만큼 빨리 나옴)
 */
export function parseLrc(text: string): LyricLine[] {
  let offset = 0
  const out: LyricLine[] = []
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const off = line.match(/^\[offset:\s*([+-]?\d+)\s*\]$/i)
    if (off) {
      offset = Number(off[1]) / 1000
      continue
    }
    const times: number[] = []
    let m: RegExpExecArray | null
    TS.lastIndex = 0
    let rest = line
    while ((m = /^\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/.exec(rest))) {
      times.push(toSec(m[1], m[2]))
      rest = rest.slice(m[0].length)
    }
    if (!times.length) continue // [ar:], [ti:] 같은 정보 줄
    let words: LyricWord[] | undefined
    if (WORD.test(rest)) {
      words = []
      WORD.lastIndex = 0
      const parts = rest.split(WORD)
      // parts: [앞부분, m, s, 단어, m, s, 단어 ...]
      for (let i = 1; i + 2 < parts.length + 1; i += 3) {
        const t = toSec(parts[i], parts[i + 1])
        const w = parts[i + 2] ?? ''
        if (w) words.push({ t, text: w })
      }
      rest = rest.replace(WORD, '')
    }
    const textOnly = rest.replace(/\s+/g, ' ').trim()
    for (const t of times) out.push({ t: t - offset, text: textOnly, words: words?.map((w) => ({ t: w.t - offset + (t - times[0]), text: w.text })) })
  }
  out.sort((a, b) => a.t - b.t)
  return out
}

/** t 시점에 보여줄 줄 번호 (없으면 -1) */
export function lineAt(lines: LyricLine[], t: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].t <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}
