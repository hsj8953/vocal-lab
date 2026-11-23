/**
 * 연습 습관 분석 — 연습 기록(노트별 [시간, 센트 차이] 샘플)으로 반복되는 습관을 찾는다.
 *
 * 원곡 가수가 같은 자리에서 일부러 끌어올리거나(스쿱) 내리면(폴) 창법으로 보고 습관에서 뺀다.
 * 한두 번 나온 것은 습관으로 보지 않고, 같은 모양이 여러 노트에서 반복될 때만 알려준다.
 */
import type { Note, NoteResult, SessionStats } from './engine'

export type HabitId = 'flat' | 'sharp' | 'highFlat' | 'scoop' | 'fall' | 'unstable' | 'late'

export interface HabitExample {
  id: string
  start: number
  midi: number
  lyric?: string
  /** 그 노트에서 잰 값 (센트 또는 초) */
  value: number
}

export interface Habit {
  id: HabitId
  title: string
  /** 숫자로 보여줄 한 줄 */
  stat: string
  /** 고치는 요령 */
  tip: string
  /** 얼마나 믿을 만한지 */
  confidence: 'high' | 'mid' | 'low'
  /** 정렬용 점수 (클수록 먼저) */
  score: number
  examples: HabitExample[]
}

export interface HabitReport {
  habits: Habit[]
  /** 분석에 쓸 만큼 길게 부른 노트 수 */
  notesUsed: number
  /** 원곡 음정 곡선과 비교했는지 */
  comparedWithOriginal: boolean
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
const median = (a: number[]) => {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  return s[s.length >> 1]
}

function slice(samples: [number, number][], a: number, b: number) {
  const out: number[] = []
  for (const [t, c] of samples) if (t >= a && t <= b) out.push(c)
  return out
}

/** 선형 추세를 뺀 뒤의 표준편차와 초당 평균선 교차 수 (바이브레이션 구분용) */
function wobble(samples: [number, number][], a: number, b: number) {
  const pts = samples.filter(([t]) => t >= a && t <= b)
  if (pts.length < 10) return null
  const n = pts.length
  const mt = mean(pts.map((p) => p[0]))
  const mc = mean(pts.map((p) => p[1]))
  let num = 0
  let den = 0
  for (const [t, c] of pts) {
    num += (t - mt) * (c - mc)
    den += (t - mt) * (t - mt)
  }
  const k = den > 0 ? num / den : 0
  const r = pts.map(([t, c]) => c - (mc + k * (t - mt)))
  const sd = Math.sqrt(mean(r.map((x) => x * x)))
  let cross = 0
  for (let i = 1; i < n; i++) if (Math.sign(r[i]) !== Math.sign(r[i - 1])) cross++
  const span = pts[n - 1][0] - pts[0][0]
  // 규칙적인 떨림(바이브레이션)인지: 3.5~8Hz 주기에서 자기상관이 뚜렷하게 양(+)이고 반주기에서 음(−)인지
  const dt = span / Math.max(1, n - 1)
  const e = r.reduce((x, y) => x + y * y, 0) || 1
  const ac = (L: number) => {
    let v = 0
    for (let i = 0; i + L < n; i++) v += r[i] * r[i + L]
    return v / e
  }
  let periodic = false
  for (let hz = 3.5; hz <= 8; hz += 0.25) {
    const L = Math.round(1 / hz / dt)
    const H = Math.round(0.5 / hz / dt)
    if (L < 2 || L >= n - 2 || H < 1) continue
    if (ac(L) > 0.35 && ac(H) < -0.3) {
      periodic = true
      break
    }
  }
  return { sd, crossPerSec: span > 0 ? cross / span : 0, periodic }
}

/**
 * @param session 연습 기록
 * @param notes 곡의 전체 노트 (소절 시작인지 판단용)
 * @param origAt 원곡 보컬 음 높이 (원곡 키 MIDI, 없으면 NaN). 없으면 원곡 비교 없이 분석
 */
export function analyzeHabits(session: SessionStats, notes: Note[], origAt?: (t: number) => number): HabitReport {
  const sorted = [...notes].sort((a, b) => a.start - b.start)
  const prevEnd = new Map<string, number>()
  /** 앞/뒤 노트와 이어져 있고(0.08초 안) 음이 다르면 그 방향 (−1: 앞 음이 더 낮음 / 뒤 음이 더 낮음) */
  const legatoFromBelow = new Set<string>()
  const legatoToBelow = new Set<string>()
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i]
    const p = sorted[i - 1]
    const q = sorted[i + 1]
    prevEnd.set(n.id, p ? p.start + p.dur : -Infinity)
    if (p && n.start - (p.start + p.dur) < 0.08 && p.midi < n.midi - 0.5) legatoFromBelow.add(n.id)
    if (q && q.start - (n.start + n.dur) < 0.08 && q.midi < n.midi - 0.5) legatoToBelow.add(n.id)
  }

  let hasOrig = false
  const origRel = (n: NoteResult, a: number, b: number) => {
    if (!origAt) return NaN
    const v: number[] = []
    for (let t = a; t <= b; t += 0.016) {
      const m = origAt(n.start + t)
      if (Number.isFinite(m)) v.push((m - n.orig) * 100)
    }
    if (v.length >= 2) hasOrig = true
    return v.length >= 2 ? mean(v) : NaN
  }

  const usable = session.perNote.filter((n) => n.samples && n.samples.length >= 8 && n.dur >= 0.25)
  const scoop: HabitExample[] = []
  const fall: HabitExample[] = []
  const unstable: HabitExample[] = []
  const late: HabitExample[] = []
  let scoopElig = 0
  let fallElig = 0
  let unstElig = 0
  let lateElig = 0
  const ex = (n: NoteResult, value: number): HabitExample => ({ id: n.id, start: n.start, midi: n.midi, lyric: n.lyric, value })

  for (const n of usable) {
    const d = n.dur
    const s = n.samples
    const mid = slice(s, 0.3 * d, 0.7 * d)
    if (mid.length < 3) continue
    const midM = median(mid)

    // 들어갈 때 아래에서 끌어올림
    // 낮은 음에서 이어 올라오는 노트는 자연스러운 연결이라 제외
    const st = slice(s, 0, Math.min(0.12, 0.25 * d))
    if (st.length >= 2 && !legatoFromBelow.has(n.id)) {
      scoopElig++
      const delta = mean(st) - midM
      if (delta < -60) {
        const o = origRel(n, 0, Math.min(0.12, 0.25 * d)) - origRel(n, 0.3 * d, 0.7 * d)
        if (!(o < -40)) scoop.push(ex(n, Math.round(delta)))
      }
    }

    // 끝음 처짐
    if (d >= 0.35) {
      const tail = Math.max(0.1, 0.2 * d)
      const en = slice(s, d - tail, d)
      if (en.length >= 2 && !legatoToBelow.has(n.id)) {
        fallElig++
        const delta = mean(en) - midM
        if (delta < -60) {
          const o = origRel(n, d - tail, d) - origRel(n, 0.3 * d, 0.7 * d)
          if (!(o < -40)) fall.push(ex(n, Math.round(delta)))
        }
      }
    }

    // 길게 낼 때 흔들림 (바이브레이션은 제외: 초당 3.5~8번 규칙적으로 오르내리면 바이브레이션)
    if (d >= 0.6) {
      const w = wobble(s, 0.2 * d, 0.8 * d)
      if (w) {
        unstElig++
        const vibrato = w.periodic && w.sd < 80
        if (w.sd > 25 && !vibrato) unstable.push(ex(n, Math.round(w.sd)))
      }
    }

  }

  // 소절 첫 음에 늦게 들어감 (쉬었다가 시작하는 노트만)
  for (const n of session.perNote) {
    if (!n.samples || n.samples.length < 3 || n.dur < 0.3) continue
    const gap = n.start - (prevEnd.get(n.id) ?? -Infinity)
    if (gap < 0.15) continue
    lateElig++
    const first = n.samples[0][0]
    if (first > 0.15) late.push(ex(n, Math.round(first * 100) / 100))
  }

  const habits: Habit[] = []
  const pct = (a: number, b: number) => Math.round((a / Math.max(1, b)) * 100)
  const pickWorst = (arr: HabitExample[], dir: 1 | -1) => [...arr].sort((a, b) => dir * (b.value - a.value)).slice(0, 3)

  // 전체 / 고음 음정 치우침
  const all: number[] = []
  // 시작·끝의 끌어올림/처짐이 섞이지 않게 노트 가운데 부분만 쓴다
  const midOf = (n: NoteResult) => slice(n.samples, 0.25 * n.dur, 0.75 * n.dur)
  for (const n of usable) all.push(...midOf(n))
  if (all.length >= 30) {
    const b = mean(all)
    if (Math.abs(b) >= 20) {
      const flat = b < 0
      habits.push({
        id: flat ? 'flat' : 'sharp',
        title: flat ? '전체적으로 조금 낮게 불러요' : '전체적으로 조금 높게 불러요',
        stat: `평균 ${b > 0 ? '+' : ''}${Math.round(b)}센트`,
        tip: flat ? '음을 "위에서 잡는다"는 느낌으로, 소리를 앞으로 밝게 내 보세요. 가이드 보컬을 조금 올리고 같이 불러 보면 기준 잡기가 쉬워요.' : '힘이 들어가면 음이 뜨기 쉬워요. 목에 힘을 빼고 한 단계 작게 불러 보세요.',
        confidence: 'high',
        score: Math.abs(b) / 10,
        examples: [...usable].sort((x, y) => (flat ? x.meanCents - y.meanCents : y.meanCents - x.meanCents)).slice(0, 3).map((n) => ex(n, Math.round(n.meanCents))),
      })
    }
  }
  if (usable.length >= 8) {
    const byPitch = [...usable].sort((a, b) => b.midi - a.midi)
    const high = byPitch.slice(0, Math.max(3, Math.round(usable.length * 0.25)))
    const rest = byPitch.slice(high.length)
    const hs: number[] = []
    const rs: number[] = []
    for (const n of high) hs.push(...midOf(n))
    for (const n of rest) rs.push(...midOf(n))
    const hb = mean(hs)
    const rb = mean(rs)
    if (hs.length >= 20 && hb <= -25 && hb - rb <= -15) {
      habits.push({
        id: 'highFlat',
        title: '고음에서 음이 못 올라가요',
        stat: `고음 평균 ${Math.round(hb)}센트 (나머지 ${rb > 0 ? '+' : ''}${Math.round(rb)}센트)`,
        tip: '고음 직전에 숨을 미리 채우고, 턱을 내리며 입을 세로로 열어 보세요. 계속 어렵다면 키를 1~2 내려서 연습해도 좋아요.',
        confidence: 'high',
        score: Math.abs(hb) / 8,
        examples: [...high].sort((a, b) => a.meanCents - b.meanCents).slice(0, 3).map((n) => ex(n, Math.round(n.meanCents))),
      })
    }
  }

  const addRate = (id: HabitId, arr: HabitExample[], elig: number, title: string, statFn: (r: number, arr: HabitExample[]) => string, tip: string, confidence: Habit['confidence'], dir: 1 | -1) => {
    if (arr.length >= 3 && arr.length / Math.max(1, elig) >= 0.25) {
      habits.push({ id, title, stat: statFn(pct(arr.length, elig), arr), tip, confidence, score: (arr.length / elig) * 4 + arr.length * 0.05, examples: pickWorst(arr, dir) })
    }
  }
  addRate(
    'scoop',
    scoop,
    scoopElig,
    '음을 아래에서 끌어올려 시작해요',
    (r, a) => `노트 ${r}%에서 · 시작이 평균 ${Math.round(mean(a.map((x) => x.value)))}센트 낮음`,
    '들어가기 직전에 목표 음을 머릿속으로 먼저 떠올리고, 처음부터 그 높이에 "꽂듯이" 시작해 보세요.',
    hasOrig ? 'mid' : 'low',
    -1,
  )
  addRate(
    'fall',
    fall,
    fallElig,
    '끝음이 처져요',
    (r, a) => `노트 ${r}%에서 · 끝이 평균 ${Math.round(mean(a.map((x) => x.value)))}센트 떨어짐`,
    '음을 끝낼 때까지 숨을 끝까지 받쳐 주세요. 마지막 음을 "조금 높게 끝낸다"는 느낌이면 처지지 않아요.',
    hasOrig ? 'mid' : 'low',
    -1,
  )
  addRate(
    'unstable',
    unstable,
    unstElig,
    '길게 낼 때 음이 흔들려요',
    (r, a) => `긴 음 ${r}%에서 · 평균 흔들림 ±${Math.round(mean(a.map((x) => x.value)))}센트`,
    '긴 음은 숨을 일정하게 내보내는 게 핵심이에요. "스~" 소리로 10초 고르게 내쉬는 연습을 먼저 해 보세요.',
    'mid',
    1,
  )
  addRate(
    'late',
    late,
    lateElig,
    '소절 첫 음에 늦게 들어가요',
    (r, a) => `소절 첫 음 ${r}%에서 · 평균 ${mean(a.map((x) => x.value)).toFixed(2)}초 늦음`,
    '앞 박자에서 미리 숨을 들이마시고, 반주의 박을 세면서 들어가 보세요. (싱크를 탭으로 맞춘 뒤에 정확해요)',
    'low',
    1,
  )

  habits.sort((a, b) => b.score - a.score)
  return { habits, notesUsed: usable.length, comparedWithOriginal: hasOrig }
}
