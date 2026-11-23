/**
 * 가사(줄 단위 시간) → 노트마다 음절 붙이기
 *
 * 한 줄의 시간 범위(이 줄 시작 ~ 다음 줄 시작) 안의 노트들과 그 줄의 음절을 짝짓는다.
 * 짝짓기는 동적 계획법으로 "가장 자연스러운 배분"을 찾는다.
 *   - 짝(노트 1 ↔ 음절 1)          비용 0
 *   - 늘이기(한 음절을 다음 노트까지 끌기, 멜리스마)  — 쉬었다 다시 시작하는 노트면 비싸게
 *   - 몰기(한 노트에 음절 두 개)     — 긴 노트일수록 비싸게
 * 음절: 한글은 한 글자 = 한 음절, 가나는 한 글자 = 한 박(작은 ゃゅょ 등은 앞 글자에 붙임),
 *       영문·숫자는 한 단어를 한 음절로 본다.
 */
import type { Note } from './engine'
import type { LyricLine } from '@/components/studio/studio-types'

export const MELISMA = '~'

const SMALL_KANA = /[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮㇰ-ㇿ]/

export function syllables(text: string): string[] {
  const out: string[] = []
  const t = text.normalize('NFC')
  let word = ''
  const flush = () => {
    if (word) out.push(word)
    word = ''
  }
  for (const ch of t) {
    if (/[A-Za-z0-9'’]/.test(ch)) {
      word += ch
      continue
    }
    flush()
    if (/[가-힣]/.test(ch) || /[぀-ヿ一-鿿]/.test(ch)) {
      if (SMALL_KANA.test(ch) && out.length) out[out.length - 1] += ch
      else if ((ch === 'ー' || ch === 'ッ' || ch === 'っ') && out.length) out.push(ch)
      else out.push(ch)
    }
    // 공백·문장부호는 건너뜀
  }
  flush()
  return out
}

interface Cell {
  cost: number
  from: 0 | 1 | 2 | 3 // 0 시작, 1 짝, 2 늘이기, 3 몰기
}

/** 한 줄 안의 노트들(시간순)에 음절을 배분. 노트별 가사 문자열 배열을 돌려준다 */
export function alignLine(notes: Note[], syl: string[]): string[] {
  const N = notes.length
  const S = syl.length
  const res: string[] = new Array(N).fill('')
  if (!N || !S) return res
  const gapBefore = (i: number) => (i === 0 ? 1 : notes[i].start - (notes[i - 1].start + notes[i - 1].dur))
  const melCost = (i: number) => {
    let c = 0.9
    if (gapBefore(i) > 0.12) c += 1.6 // 쉬었다가 다시 시작 → 새 음절일 가능성이 큼
    if (Math.round(notes[i].midi) === Math.round(notes[i - 1].midi)) c += 0.5 // 같은 음을 다시 치는 건 대개 새 음절
    c += 0.15 * (1 - i / N) // 같은 값이면 줄 끝쪽에서 늘이는 쪽을 고른다 (끝음을 끄는 경우가 많음)
    return c
  }
  const mergeCost = (i: number) => 1.1 + (notes[i].dur > 0.45 ? 0.6 : 0) // 노트 i에 음절을 하나 더

  const D: Cell[][] = Array.from({ length: N + 1 }, () => Array.from({ length: S + 1 }, () => ({ cost: Infinity, from: 0 as const })))
  D[0][0] = { cost: 0, from: 0 }
  for (let i = 0; i <= N; i++)
    for (let j = 0; j <= S; j++) {
      const cur = D[i][j].cost
      if (!Number.isFinite(cur)) continue
      // 짝: 노트 i ↔ 음절 j
      if (i < N && j < S && cur < D[i + 1][j + 1].cost) D[i + 1][j + 1] = { cost: cur, from: 1 }
      // 늘이기: 노트 i가 앞 음절을 이어 부름
      if (i < N && i > 0 && j > 0) {
        const c = cur + melCost(i)
        if (c < D[i + 1][j].cost) D[i + 1][j] = { cost: c, from: 2 }
      }
      // 몰기: 앞 노트(i-1)가 음절 j를 하나 더 부름
      if (i > 0 && j < S) {
        const c = cur + mergeCost(i - 1)
        if (c < D[i][j + 1].cost) D[i][j + 1] = { cost: c, from: 3 }
      }
    }
  // 되짚기
  let i = N
  let j = S
  const parts: string[][] = Array.from({ length: N }, () => [])
  while (i > 0 || j > 0) {
    const f = D[i][j].from
    if (f === 1) {
      parts[i - 1].unshift(syl[j - 1])
      i--
      j--
    } else if (f === 2) {
      parts[i - 1].unshift(MELISMA)
      i--
    } else if (f === 3) {
      parts[i - 1].unshift(syl[j - 1])
      j--
    } else break
  }
  for (let k = 0; k < N; k++) {
    const p = parts[k].filter((x) => x !== MELISMA)
    res[k] = p.length ? p.join('') : parts[k].length ? MELISMA : ''
  }
  return res
}

export interface AttachResult {
  notes: Note[]
  linesUsed: number
  /** 음절 수와 노트 수가 많이 달라서 확인이 필요한 줄 */
  shaky: { t: number; text: string; notes: number; syllables: number }[]
}

/** 전체 가사를 노트에 붙인다 (offset: 가사 표시 보정, 초) */
export function attachLyrics(notes: Note[], lines: LyricLine[], offset: number): AttachResult {
  const sorted = [...notes].sort((a, b) => a.start - b.start)
  const out = sorted.map((n) => ({ ...n, lyric: undefined as string | undefined }))
  const textLines = lines.map((l, i) => ({ ...l, t: l.t + offset, end: (i + 1 < lines.length ? lines[i + 1].t : Infinity) + offset }))
  const shaky: AttachResult['shaky'] = []
  let used = 0
  const EARLY = 0.2 // 가사 줄 시간보다 조금 일찍 시작하는 노트도 그 줄로
  for (const l of textLines) {
    const shown = (l.reading || l.text || '').trim()
    if (!shown) continue
    const idx: number[] = []
    out.forEach((n, k) => {
      if (n.start >= l.t - EARLY && n.start < l.end - EARLY) idx.push(k)
    })
    const syl = syllables(shown)
    if (!idx.length || !syl.length) continue
    const lyr = alignLine(
      idx.map((k) => out[k]),
      syl,
    )
    idx.forEach((k, m) => (out[k].lyric = lyr[m] || undefined))
    used++
    const ratio = idx.length / syl.length
    if (ratio > 1.8 || ratio < 0.6) shaky.push({ t: l.t, text: shown, notes: idx.length, syllables: syl.length })
  }
  return { notes: out, linesUsed: used, shaky }
}

/**
 * 독음 붙여넣기: 시간이 있는 원래 가사(예: 일본어)의 줄에 한국어 독음을 차례로 넣는다 (원문은 그대로 둔다).
 * 빈 줄(간주)은 건너뛰고, 가사가 있는 줄끼리 순서대로 짝짓는다.
 */
export function replaceLineTexts(lines: LyricLine[], pasted: string, from = 0): { lines: LyricLine[]; timed: number; given: number } {
  const given = pasted
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
  let k = 0
  const timed = lines.filter((l, i) => i >= from && l.text).length
  const out = lines.map((l, i) => {
    if (i < from || !l.text) return l
    const r = given[k++]
    return r === undefined ? l : { ...l, reading: r }
  })
  return { lines: out, timed, given: given.length }
}
