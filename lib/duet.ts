/**
 * 듀엣 모드: 한 사람이 부른 곡을 '원곡 가수 / 나 / 같이' 파트로 나눈다.
 * 파트는 곡 시간 위의 연속된 구간들. 소절(가사 줄 또는 숨 쉬는 곳)과
 * 절(3초 가까이 쉬는 곳)을 찾고, 여러 번 반복되는 가사 줄로 후렴을 찾는다.
 */

export type DuetWho = 'orig' | 'me' | 'both'
export type DuetStyle = 'section' | 'phrase' | 'chorus'

export interface DuetPart {
  t0: number
  t1: number
  who: DuetWho
}

export interface DuetState {
  on: boolean
  style: DuetStyle
  parts: DuetPart[]
}

export const DUET_STYLES: { id: DuetStyle; label: string; desc: string }[] = [
  { id: 'section', label: '절마다 주고받기', desc: '1절은 원곡 가수, 2절은 나, 후렴은 같이' },
  { id: 'phrase', label: '소절마다 주고받기', desc: '한 소절씩 번갈아 대화하듯' },
  { id: 'chorus', label: '후렴만 내가', desc: '절은 원곡 가수, 후렴은 내가' },
]

export const WHO_LABEL: Record<DuetWho, string> = { orig: '원곡 가수', me: '나', both: '같이' }

interface NoteLike {
  start: number
  dur: number
}
interface LineLike {
  t: number
  text: string
  reading?: string
}

interface Phrase {
  t0: number
  t1: number
  /** 이 소절의 가사(정리한 글자) — 후렴 찾기용 */
  key: string
}

const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')

/** 노트 사이가 gap초 넘게 비면 끊는다 → [시작, 끝] 덩어리 */
function groupNotes(notes: NoteLike[], gap: number): [number, number][] {
  const ns = [...notes].sort((a, b) => a.start - b.start)
  const out: [number, number][] = []
  for (const n of ns) {
    const last = out[out.length - 1]
    if (last && n.start - last[1] < gap) last[1] = Math.max(last[1], n.start + n.dur)
    else out.push([n.start, n.start + n.dur])
  }
  return out
}

/** 덩어리가 maxLen초보다 길면 그 안에서 가장 길게 쉬는 곳(minGap초 이상)에서 계속 나눈다 */
function splitLong(groups: [number, number][], notes: NoteLike[], maxLen: number, minGap: number): [number, number][] {
  const ns = [...notes].sort((a, b) => a.start - b.start)
  const out: [number, number][] = []
  const rec = (a: number, b: number) => {
    if (b - a <= maxLen) return void out.push([a, b])
    const inside = ns.filter((n) => n.start >= a - 1e-6 && n.start + n.dur <= b + 1e-6)
    let best = -1
    let bestGap = minGap
    let end = -Infinity
    for (let i = 0; i < inside.length - 1; i++) {
      end = Math.max(end, inside[i].start + inside[i].dur)
      const g = inside[i + 1].start - end
      // 가운데쯤에서 나누는 걸 조금 더 좋아한다
      const mid = (end + inside[i + 1].start) / 2
      const bias = 1 - Math.abs((mid - a) / (b - a) - 0.5) * 0.6
      if (g * bias > bestGap) {
        bestGap = g * bias
        best = i
      }
    }
    if (best < 0) return void out.push([a, b])
    let e1 = -Infinity
    for (let i = 0; i <= best; i++) e1 = Math.max(e1, inside[i].start + inside[i].dur)
    rec(a, e1)
    rec(inside[best + 1].start, b)
  }
  for (const [a, b] of groups) rec(a, b)
  return out
}

export function autoParts(notes: NoteLike[], lyrics: { lines: LineLike[]; offset: number } | null, duration: number, style: DuetStyle): DuetPart[] {
  if (!notes.length) return [{ t0: 0, t1: duration, who: 'orig' }]
  // 1) 절: 노래가 2초 넘게 쉬는 곳에서 나누고, 45초 넘게 이어지면 그 안의 긴 쉼에서 더 나눈다
  const sections = splitLong(groupNotes(notes, 2), notes, 45, 0.6)
  // 2) 소절: 가사 줄이 충분하면 가사 줄, 아니면 숨 쉬는 곳(0.35초)
  const lines = (lyrics?.lines ?? []).filter((l) => (l.reading || l.text).trim())
  let phrases: Phrase[]
  if (lines.length >= 4) {
    phrases = lines.map((l, i) => {
      const t0 = l.t + (lyrics?.offset ?? 0)
      const next = lines[i + 1]
      const t1 = next ? next.t + (lyrics?.offset ?? 0) : t0 + 6
      return { t0, t1, key: norm(l.text || l.reading || '') }
    })
    // 노트가 없는 줄(가사만 있는 줄)은 빼고, 실제로 부르는 범위로 줄인다
    phrases = phrases
      .map((p) => {
        const inside = notes.filter((n) => n.start + n.dur / 2 >= p.t0 && n.start + n.dur / 2 < p.t1)
        if (!inside.length) return null
        return { ...p, t0: Math.min(...inside.map((n) => n.start)), t1: Math.max(...inside.map((n) => n.start + n.dur)) }
      })
      .filter((p): p is Phrase => !!p)
  } else phrases = splitLong(groupNotes(notes, 0.35), notes, 8, 0.08).map(([t0, t1]) => ({ t0, t1, key: '' }))
  if (!phrases.length) return [{ t0: 0, t1: duration, who: 'orig' }]
  // 1.2초도 안 되는 짧은 소절은 바로 앞 소절에 붙인다 (혼자 파트가 되면 주고받기가 어색하다)
  phrases = phrases.reduce<Phrase[]>((acc, p) => {
    const last = acc[acc.length - 1]
    if (last && (p.t1 - p.t0 < 1.2 || last.t1 - last.t0 < 1.2) && p.t0 - last.t1 < 1) last.t1 = Math.max(last.t1, p.t1)
    else acc.push({ ...p })
    return acc
  }, [])

  // 3) 후렴: 같은 가사 줄이 두 번 넘게 나오면 반복 줄. 반복 줄이 2줄 넘게 이어지면 후렴 덩어리
  const count = new Map<string, number>()
  for (const p of phrases) if (p.key.length >= 4) count.set(p.key, (count.get(p.key) ?? 0) + 1)
  const rep = phrases.map((p) => p.key.length >= 4 && (count.get(p.key) ?? 0) >= 2)
  const isChorus = rep.map((r, i) => r && (rep[i - 1] || rep[i + 1]))
  // 후렴 사이에 낀 한 줄(가사가 조금 다른 줄)도 후렴으로
  for (let i = 1; i < isChorus.length - 1; i++) if (!isChorus[i] && isChorus[i - 1] && isChorus[i + 1]) isChorus[i] = true
  const hasChorus = isChorus.some(Boolean)
  // 덩어리(블록): 후렴 덩어리와 절 덩어리가 번갈아 나온다. 가사가 없으면 절(긴 쉼) 단위
  const secOf = (p: Phrase) => {
    const m = (p.t0 + p.t1) / 2
    let k = sections.findIndex(([a, b]) => m >= a - 0.05 && m <= b + 0.05)
    if (k < 0) k = sections.reduce((best, [a], i) => (Math.abs(a - m) < Math.abs(sections[best][0] - m) ? i : best), 0)
    return k
  }
  const block: number[] = []
  let blockStart = phrases[0].t0
  phrases.forEach((p, i) => {
    if (i === 0) return void block.push(0)
    const prev = block[i - 1]
    const newSec = secOf(p) !== secOf(phrases[i - 1])
    // 후렴이 바뀌는 곳에서, 또 절이 20초 넘게 이어지면 긴 쉼(절 경계)에서도 끊는다
    const change = hasChorus ? isChorus[i] !== isChorus[i - 1] || (!isChorus[i] && newSec && p.t0 - blockStart >= 20) : newSec
    if (change) blockStart = p.t0
    block.push(change ? prev + 1 : prev)
  })
  const nBlocks = block[block.length - 1] + 1

  // 4) 방식에 따라 소절마다 파트를 정한다
  const whoOf: DuetWho[] = []
  if (style === 'phrase' || nBlocks < 2) {
    phrases.forEach((_, i) => whoOf.push(i % 2 === 0 ? 'orig' : 'me'))
  } else if (style === 'chorus') {
    if (hasChorus) phrases.forEach((_, i) => whoOf.push(isChorus[i] ? 'me' : 'orig'))
    // 후렴을 못 찾으면 뒤쪽 덩어리 절반을 나에게
    else phrases.forEach((_, i) => whoOf.push(block[i] >= Math.floor(nBlocks / 2) ? 'me' : 'orig'))
  } else {
    // 절마다: 절 덩어리를 원곡 → 나 → 원곡 … 순서로, 후렴은 같이 (후렴이 없으면 마지막 덩어리를 같이)
    // 원곡 가수가 먼저 / 내가 먼저 두 가지를 만들어 보고, 내 몫이 절반에 더 가까운 쪽 (같으면 원곡 먼저)
    const make = (first: 0 | 1) => {
      const blockWho = new Map<number, DuetWho>()
      let verse = first
      for (let b = 0; b < nBlocks; b++) {
        const i = block.indexOf(b)
        if (hasChorus && isChorus[i]) blockWho.set(b, 'both')
        else blockWho.set(b, verse++ % 2 === 0 ? 'orig' : 'me')
      }
      if (!hasChorus && nBlocks >= 3) blockWho.set(nBlocks - 1, 'both')
      return phrases.map((_, i) => blockWho.get(block[i])!)
    }
    const shareOf = (ws: DuetWho[]) => {
      let me = 0
      let all = 0
      phrases.forEach((p, i) => {
        const d = p.t1 - p.t0
        all += d
        if (ws[i] === 'me') me += d
        else if (ws[i] === 'both') me += d / 2
      })
      return all ? me / all : 0
    }
    const a0 = make(0)
    const a1 = make(1)
    whoOf.push(...(Math.abs(shareOf(a1) - 0.5) < Math.abs(shareOf(a0) - 0.5) - 0.05 ? a1 : a0))
  }

  // 5) 이어진 구간으로: 소절 사이 빈 곳은 가운데에서 나눈다 (소절 하나하나를 따로 바꿀 수 있게 합치지 않는다)
  return phrases.map((p, i) => {
    const prev = phrases[i - 1]
    const next = phrases[i + 1]
    return { t0: prev ? (prev.t1 + p.t0) / 2 : 0, t1: next ? (p.t1 + next.t0) / 2 : duration, who: whoOf[i] }
  })
}

/** 시각 t의 파트 */
export function partAt(parts: DuetPart[], t: number): DuetWho | null {
  for (const p of parts) if (t >= p.t0 && t < p.t1) return p.who
  return null
}

/** 파트 하나의 담당을 바꾼다 */
export function setPartWho(parts: DuetPart[], idx: number, who: DuetWho): DuetPart[] {
  return parts.map((p, i) => (i === idx ? { ...p, who } : p))
}

/** 내 파트가 차지하는 노래 시간 비율 */
export function myShare(parts: DuetPart[], notes: NoteLike[]): number {
  let me = 0
  let all = 0
  for (const n of notes) {
    const w = partAt(parts, n.start + n.dur / 2)
    all += n.dur
    if (w === 'me') me += n.dur
    else if (w === 'both') me += n.dur / 2
  }
  return all ? me / all : 0
}

/** 듀엣이면 내가 부를 노트만 (채점용) */
export function myNotes<T extends NoteLike>(notes: T[], duet: DuetState): T[] {
  if (!duet.on || !duet.parts.length) return notes
  return notes.filter((n) => partAt(duet.parts, n.start + n.dur / 2) !== 'orig')
}
