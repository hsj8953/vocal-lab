/**
 * 연습 리포트 — 연습 기록(노트별 [시간, 센트] 샘플)으로 자세한 수치와 코칭을 만든다.
 *
 * 수치는 모두 "현재 키로 보여 준 노트"를 기준으로 잰다.
 * 원곡 가수가 같은 자리에서 일부러 끌어올리거나 내리면(창법) 그 노트는 습관 판단에서 뺀다.
 */
import type { Note, NoteResult, SessionStats, UserRange } from './engine'

export type Status = 'good' | 'ok' | 'bad' | 'info'

export interface Metric {
  id: string
  label: string
  /** 화면에 크게 보여 줄 값 */
  value: string
  status: Status
  /** 이 수치가 무엇인지 한 줄 설명 */
  help: string
  /** 좋음 기준 */
  target?: string
  /** 기록 비교용 숫자 */
  num?: number
  /** 1: 클수록 좋음, -1: 작을수록 좋음 (num 기준) */
  dir?: 1 | -1
}

export interface MetricGroup {
  id: string
  title: string
  metrics: Metric[]
}

export interface Example {
  id: string
  start: number
  midi: number
  lyric?: string
  value: string
}

export interface Coaching {
  id: string
  title: string
  /** 근거 수치 한 줄 */
  evidence: string
  /** 왜 생기는지 */
  why: string
  /** 연습 방법 */
  how: string[]
  /** 다음 목표 */
  goal: string
  confidence: 'high' | 'mid' | 'low'
  severity: number
  examples: Example[]
}

export interface PhraseScore {
  start: number
  end: number
  score: number
  /** 소절 안 노트 중 부른 비율 */
  sung: number
  lyric: string
  notes: number
}

export interface NoteRow {
  id: string
  start: number
  dur: number
  midi: number
  lyric?: string
  /** 0~100, 부르지 않았으면 null */
  acc: number | null
  /** 노트 가운데 부분의 대표 음 차이(센트) */
  cents: number | null
  tags: string[]
}

export interface RangeCell {
  midi: number
  notes: number
  /** 맞은 노트 비율 0~1 */
  acc: number
  cents: number
}

export interface Report {
  /** 분석에 쓸 기록이 충분한지 */
  enough: boolean
  score: number
  grade: string
  summary: string
  parts: { pitch: number; timing: number; coverage: number }
  groups: MetricGroup[]
  coaching: Coaching[]
  /** 잘한 점 */
  strengths: string[]
  phrases: PhraseScore[]
  rows: NoteRow[]
  range: RangeCell[]
  /** 음 높이별 기록 [음(MIDI, 실제 부른 높이), 노트 수, 부른 수, 맞은 수, 센트 합] — 음역 다시 분석용 */
  pitchStats: [number, number, number, number, number][]
  notesInRange: number
  notesSung: number
  comparedWithOriginal: boolean
  /** 기록 저장용 요약 */
  keyNums: Record<string, number>
}

/* ------------------------------------------------------------------ */

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
const median = (a: number[]) => {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  return s[s.length >> 1]
}
const sd = (a: number[]) => {
  if (a.length < 2) return NaN
  const m = mean(a)
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)))
}
const pctl = (a: number[], p: number) => {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]
}
/** 받침에 따라 은/는 */
const eunNeun = (w: string) => {
  const c = w.charCodeAt(w.length - 1)
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '은' : '는'
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const db = (x: number) => 20 * Math.log10(Math.max(1e-5, x))
const sign = (x: number) => (x > 0 ? '+' : '')
const r0 = (x: number) => Math.round(x)
const fmtT = (sec: number) => {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec - m * 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function inRange(samples: [number, number][], a: number, b: number) {
  const out: number[] = []
  for (const [t, c] of samples) if (t >= a && t <= b) out.push(c)
  return out
}

/** 선형 추세를 뺀 흔들림 + 규칙적인 떨림(바이브레이션) 판단 */
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
  const dev = Math.sqrt(mean(r.map((x) => x * x)))
  const span = pts[n - 1][0] - pts[0][0]
  const dt = span / Math.max(1, n - 1)
  const e = r.reduce((x, y) => x + y * y, 0) || 1
  const ac = (L: number) => {
    let v = 0
    for (let i = 0; i + L < n; i++) v += r[i] * r[i + L]
    return v / e
  }
  let rate = 0
  let best = 0
  for (let hz = 3.5; hz <= 8; hz += 0.25) {
    const L = Math.round(1 / hz / dt)
    const H = Math.round(0.5 / hz / dt)
    if (L < 2 || L >= n - 2 || H < 1) continue
    const v = ac(L)
    if (v > 0.35 && ac(H) < -0.3 && v > best) {
      best = v
      rate = hz
    }
  }
  // 비브라토 폭: 추세를 뺀 값의 진폭 ≈ RMS × √2
  return { sd: dev, periodic: rate > 0, rate, extent: dev * Math.SQRT2 }
}

interface NA {
  n: NoteResult
  note: Note
  frames: number
  cov: number
  sung: boolean
  pitchAcc: number
  midMed: number
  accurate: boolean
  startDelta: number
  reachMs: number
  endDelta: number
  hold: number
  wob: ReturnType<typeof wobble>
  levelDb: number
  phraseStart: boolean
  entry: number
  legatoIn: boolean
  legatoOut: boolean
  tags: string[]
}

export interface ReportInput {
  session: SessionStats
  notes: Note[]
  /** 현재 키 (반음) */
  shift: number
  userRange: UserRange
  /** 원곡 보컬 음 높이 (원곡 키 MIDI) */
  origAt?: (t: number) => number
  /** 연습한 구간 (없으면 기록이 있는 노트 범위) */
  span?: { t0: number; t1: number }
  /** 마이크 소리 크기를 믿을 수 있는지 (데모 보컬이면 false) */
  realMic: boolean
}

const STATUS_RANK: Record<Status, number> = { bad: 2, ok: 1, good: 0, info: 0 }

/** 작을수록 좋은 값 */
const lowGood = (v: number, good: number, ok: number): Status => (!Number.isFinite(v) ? 'info' : v <= good ? 'good' : v <= ok ? 'ok' : 'bad')
/** 클수록 좋은 값 */
const highGood = (v: number, good: number, ok: number): Status => (!Number.isFinite(v) ? 'info' : v >= good ? 'good' : v >= ok ? 'ok' : 'bad')

export function buildReport(inp: ReportInput): Report {
  const { session, shift, userRange, origAt, realMic } = inp
  const byId = new Map(session.perNote.map((n) => [n.id, n]))
  const sorted = [...inp.notes].sort((a, b) => a.start - b.start)

  // 연습 구간
  let t0 = inp.span?.t0
  let t1 = inp.span?.t1
  if (t0 === undefined || t1 === undefined) {
    const rec = session.perNote.filter((n) => n.great + n.ok + n.off > 0)
    t0 = rec.length ? Math.min(...rec.map((n) => n.start)) : 0
    t1 = rec.length ? Math.max(...rec.map((n) => n.start + n.dur)) : 0
  }
  const inSpan = sorted.filter((n) => n.start >= t0! - 0.05 && n.start + n.dur <= t1! + 0.3)

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

  // 프레임 간격 (마이크는 0.02초) — 기록에서 직접 잰다
  const diffs: number[] = []
  for (const n of session.perNote) for (let k = 1; k < n.samples.length && diffs.length < 4000; k++) {
    const dd = n.samples[k][0] - n.samples[k - 1][0]
    if (dd > 0 && dd < 0.2) diffs.push(dd)
  }
  const frameSec = diffs.length >= 20 ? Math.max(0.01, Math.min(0.1, median(diffs))) : 0.02

  /* ---------------- 노트별 분석 ---------------- */
  const na: NA[] = []
  for (let i = 0; i < inSpan.length; i++) {
    const note = inSpan[i]
    const p = inSpan[i - 1]
    const q = inSpan[i + 1]
    const gapBefore = p ? note.start - (p.start + p.dur) : Infinity
    const gapAfter = q ? q.start - (note.start + note.dur) : Infinity
    const n: NoteResult = byId.get(note.id) ?? {
      id: note.id,
      start: note.start,
      dur: note.dur,
      midi: note.midi + shift,
      lyric: note.lyric,
      great: 0,
      ok: 0,
      off: 0,
      meanCents: 0,
      orig: note.midi,
      samples: [],
      levels: [],
    }
    const frames = n.great + n.ok + n.off
    const cov = clamp01((frames * frameSec) / Math.max(0.05, note.dur))
    const sung = frames >= 3 && cov >= 0.25
    const d = note.dur
    const s = n.samples
    const mid = inRange(s, 0.3 * d, 0.7 * d)
    const midAll = mid.length >= 2 ? mid : s.map((x) => x[1])
    const midMed = sung && midAll.length ? median(midAll) : NaN
    const a: NA = {
      n,
      note,
      frames,
      cov,
      sung,
      pitchAcc: frames ? (n.great + 0.5 * n.ok) / frames : 0,
      midMed,
      accurate: Number.isFinite(midMed) && Math.abs(midMed) <= 50,
      startDelta: NaN,
      reachMs: NaN,
      endDelta: NaN,
      hold: NaN,
      wob: null,
      levelDb: NaN,
      phraseStart: gapBefore >= 0.25,
      entry: NaN,
      legatoIn: gapBefore < 0.08 && !!p && p.midi < note.midi - 0.5,
      legatoOut: gapAfter < 0.08 && !!q && q.midi < note.midi - 0.5,
      tags: [],
    }
    if (sung && s.length >= 4) {
      const first = s[0][0]
      if (a.phraseStart) a.entry = first - 0.03 // 감지 지연 보정
      if (d >= 0.3 && Number.isFinite(midMed)) {
        const st = inRange(s, first, first + Math.min(0.12, 0.25 * d))
        if (st.length >= 2 && !a.legatoIn) {
          const delta = mean(st) - midMed
          const o = origRel(n, 0, Math.min(0.12, 0.25 * d)) - origRel(n, 0.3 * d, 0.7 * d)
          if (!(o < -40)) a.startDelta = delta
        }
        // 목표 음(±50센트)에 3프레임 연속 들어오기까지 걸린 시간
        if (!a.legatoIn) {
          let reach = NaN
          for (let k = 0; k + 2 < s.length; k++) {
            if (Math.abs(s[k][1]) <= 50 && Math.abs(s[k + 1][1]) <= 50 && Math.abs(s[k + 2][1]) <= 50) {
              reach = s[k][0] - first
              break
            }
          }
          a.reachMs = Number.isFinite(reach) ? reach * 1000 : (s[s.length - 1][0] - first) * 1000
        }
      }
      if (d >= 0.35 && Number.isFinite(midMed) && !a.legatoOut) {
        const tail = Math.max(0.1, 0.2 * d)
        const en = inRange(s, d - tail, d)
        if (en.length >= 2) {
          const o = origRel(n, d - tail, d) - origRel(n, 0.3 * d, 0.7 * d)
          if (!(o < -40)) a.endDelta = mean(en) - midMed
        }
      }
      if (d >= 0.4) a.hold = clamp01((s[s.length - 1][0] - first + frameSec) / Math.max(0.1, d - Math.max(0, first)))
      if (d >= 0.6) a.wob = wobble(s, 0.2 * d, 0.8 * d)
      const lv = (n.levels ?? []).filter((x) => x > 0)
      if (lv.length) a.levelDb = db(mean(lv))
    }
    if (sung) {
      if (Number.isFinite(midMed) && midMed < -50) a.tags.push('낮음')
      if (Number.isFinite(midMed) && midMed > 50) a.tags.push('높음')
      if (a.startDelta < -60) a.tags.push('끌어올림')
      if (a.endDelta < -60) a.tags.push('끝 처짐')
      if (a.wob && !a.wob.periodic && a.wob.sd > 25) a.tags.push('흔들림')
      if (a.entry > 0.15) a.tags.push('늦게 시작')
      if (a.entry < -0.12) a.tags.push('일찍 시작')
    } else a.tags.push('안 부름')
    na.push(a)
  }

  const sungNA = na.filter((x) => x.sung)
  const enough = sungNA.length >= 6
  const totalDur = na.reduce((x, y) => x + y.note.dur, 0)
  const coverage = totalDur ? na.reduce((x, y) => x + y.note.dur * Math.min(1, y.cov / 0.8), 0) / totalDur : 0

  /* ---------------- 소절 ---------------- */
  const phrases: { list: NA[] }[] = []
  for (const x of na) {
    if (!phrases.length || x.phraseStart && x.note.start - (phrases[phrases.length - 1].list.at(-1)!.note.start + phrases[phrases.length - 1].list.at(-1)!.note.dur) >= 0.35) phrases.push({ list: [x] })
    else phrases[phrases.length - 1].list.push(x)
  }
  const noteScore = (x: NA) => (x.sung ? x.pitchAcc * Math.min(1, x.cov / 0.8) : 0)
  const phraseScores: PhraseScore[] = phrases.map(({ list }) => {
    const w = list.reduce((a, x) => a + x.note.dur, 0) || 1
    return {
      start: list[0].note.start,
      end: list.at(-1)!.note.start + list.at(-1)!.note.dur,
      score: r0((list.reduce((a, x) => a + noteScore(x) * x.note.dur, 0) / w) * 100),
      sung: list.filter((x) => x.sung).length / list.length,
      lyric: list.map((x) => x.note.lyric ?? '').join(''),
      notes: list.length,
    }
  })

  /* ---------------- 수치 ---------------- */
  // 음정
  const sungDur = sungNA.reduce((a, x) => a + x.note.dur, 0) || 1
  const pitchFrame = sungNA.reduce((a, x) => a + x.pitchAcc * x.note.dur, 0) / sungDur
  const withMid = sungNA.filter((x) => Number.isFinite(x.midMed))
  const notePct = withMid.length ? (withMid.filter((x) => x.accurate).length / withMid.length) * 100 : NaN
  const midVals: number[] = []
  for (const x of sungNA) midVals.push(...inRange(x.n.samples, 0.25 * x.note.dur, 0.75 * x.note.dur))
  const meanAbs = mean(midVals.map(Math.abs))
  const bias = mean(midVals)
  const longs = sungNA.filter((x) => x.wob)
  const unstableList = longs.filter((x) => !x.wob!.periodic && x.wob!.sd > 25)
  const steadyDev = mean(longs.filter((x) => !x.wob!.periodic).map((x) => x.wob!.sd))

  // 음 시작
  const reach = sungNA.filter((x) => Number.isFinite(x.reachMs))
  const reachMed = median(reach.map((x) => x.reachMs))
  const starts = sungNA.filter((x) => Number.isFinite(x.startDelta))
  const scoopList = starts.filter((x) => x.startDelta < -60)
  const scoopRate = starts.length ? scoopList.length / starts.length : NaN
  const scoopDepth = mean(scoopList.map((x) => x.startDelta))

  // 음 유지
  const ends = sungNA.filter((x) => Number.isFinite(x.endDelta))
  const fallList = ends.filter((x) => x.endDelta < -60)
  const fallRate = ends.length ? fallList.length / ends.length : NaN
  const fallDepth = mean(fallList.map((x) => x.endDelta))
  const holds = sungNA.filter((x) => Number.isFinite(x.hold))
  const holdPct = mean(holds.map((x) => x.hold)) * 100

  // 리듬
  const entries = sungNA.filter((x) => Number.isFinite(x.entry))
  const entryMean = mean(entries.map((x) => x.entry)) * 1000
  const entrySd = sd(entries.map((x) => x.entry)) * 1000

  // 비브라토
  const vibs = longs.filter((x) => x.wob!.periodic && x.wob!.sd < 90)
  const vibRate = mean(vibs.map((x) => x.wob!.rate))
  const vibExt = mean(vibs.map((x) => x.wob!.extent))
  const vibPct = longs.length ? (vibs.length / longs.length) * 100 : NaN

  // 음 이동
  const leaps: { x: NA; up: boolean; size: number }[] = []
  for (const { list } of phrases)
    for (let i = 1; i < list.length; i++) {
      const p = list[i - 1]
      const x = list[i]
      const size = x.note.midi - p.note.midi
      if (Math.abs(size) >= 3 && x.sung && p.sung && Number.isFinite(x.midMed)) leaps.push({ x, up: size > 0, size: Math.abs(size) })
    }
  const leapAcc = (l: typeof leaps) => (l.length ? (l.filter((v) => v.x.accurate).length / l.length) * 100 : NaN)
  const upLeaps = leaps.filter((l) => l.up)
  const downLeaps = leaps.filter((l) => !l.up)
  const bigUp = upLeaps.filter((l) => l.size >= 5)

  // 지구력: 긴 소절의 앞 절반 vs 뒤 절반
  const drifts: { d: number; start: number }[] = []
  for (const { list } of phrases) {
    const sl = list.filter((x) => Number.isFinite(x.midMed))
    const span = list.at(-1)!.note.start + list.at(-1)!.note.dur - list[0].note.start
    if (sl.length < 6 || span < 4) continue
    const h = sl.length >> 1
    drifts.push({ d: mean(sl.slice(h).map((x) => Math.abs(x.midMed))) - mean(sl.slice(0, h).map((x) => Math.abs(x.midMed))), start: list[0].note.start })
  }
  const drift = mean(drifts.map((x) => x.d))

  // 소리 크기 (상대값)
  const lvNotes = sungNA.filter((x) => Number.isFinite(x.levelDb))
  const dynRange = realMic && lvNotes.length >= 8 ? pctl(lvNotes.map((x) => x.levelDb), 0.9) - pctl(lvNotes.map((x) => x.levelDb), 0.1) : NaN
  const endDrops: { d: number; x: NA }[] = []
  if (realMic)
    for (const { list } of phrases) {
      const sl = list.filter((x) => Number.isFinite(x.levelDb))
      if (sl.length < 4) continue
      const last = sl.at(-1)!
      endDrops.push({ d: last.levelDb - median(sl.slice(0, -1).map((x) => x.levelDb)), x: last })
    }
  const endDrop = mean(endDrops.map((x) => x.d))

  // 음역별
  const rangeMap = new Map<number, { n: number; ok: number; c: number[] }>()
  for (const x of withMid) {
    const m = Math.round(x.n.midi)
    const v = rangeMap.get(m) ?? { n: 0, ok: 0, c: [] }
    v.n++
    if (x.accurate) v.ok++
    v.c.push(x.midMed)
    rangeMap.set(m, v)
  }
  const psMap = new Map<number, [number, number, number, number, number]>()
  for (const x of na) {
    const m = Math.round(x.n.midi)
    const v = psMap.get(m) ?? [m, 0, 0, 0, 0]
    v[1]++
    if (Number.isFinite(x.midMed)) {
      v[2]++
      if (x.accurate) v[3]++
      v[4] += x.midMed
    }
    psMap.set(m, v)
  }
  const pitchStats = [...psMap.values()].sort((a, b) => a[0] - b[0])
  const range: RangeCell[] = [...rangeMap.entries()].sort((a, b) => a[0] - b[0]).map(([midi, v]) => ({ midi, notes: v.n, acc: v.ok / v.n, cents: mean(v.c) }))
  const byPitch = [...withMid].sort((a, b) => b.n.midi - a.n.midi)
  const high = byPitch.slice(0, Math.max(3, Math.round(withMid.length * 0.25)))
  const rest = byPitch.slice(high.length)
  const highBias = mean(high.map((x) => x.midMed))
  const restBias = mean(rest.map((x) => x.midMed))
  const highAcc = high.length ? (high.filter((x) => x.accurate).length / high.length) * 100 : NaN
  const aboveRange = na.filter((x) => x.n.midi > userRange.high + 0.5)
  const aboveAcc = aboveRange.length ? (aboveRange.filter((x) => x.accurate).length / aboveRange.length) * 100 : NaN

  /* ---------------- 점수 ---------------- */
  const timing = Number.isFinite(entryMean) ? clamp01(1 - Math.max(0, Math.abs(entryMean) - 40) / 260 - Math.max(0, (Number.isFinite(entrySd) ? entrySd : 0) - 50) / 350) : pitchFrame
  const parts = { pitch: r0(pitchFrame * 100), timing: r0(timing * 100), coverage: r0(coverage * 100) }
  const score = enough ? r0(0.6 * parts.pitch + 0.15 * parts.timing + 0.25 * parts.coverage) : 0
  const grade = score >= 90 ? '아주 좋아요' : score >= 80 ? '좋아요' : score >= 70 ? '괜찮아요' : score >= 55 ? '조금 더 연습해요' : '연습이 필요해요'

  /* ---------------- 수치 묶음 ---------------- */
  const pc = (v: number) => (Number.isFinite(v) ? `${r0(v)}%` : '—')
  const ct = (v: number, signed = false) => (Number.isFinite(v) ? `${signed ? sign(v) : ''}${r0(v)}센트` : '—')
  const ms = (v: number, signed = false) => (Number.isFinite(v) ? `${signed ? sign(v) : ''}${r0(v)}ms` : '—')
  const groups: MetricGroup[] = [
    {
      id: 'pitch',
      title: '음정',
      metrics: [
        { id: 'notePct', label: '맞은 노트', value: pc(notePct), status: highGood(notePct, 80, 60), help: '노트 가운데 부분의 대표 음이 반음의 절반(±50센트) 안에 들어온 노트 비율', target: '80% 이상', dir: 1, num: notePct },
        { id: 'meanAbs', label: '평균 오차', value: ct(meanAbs), status: lowGood(meanAbs, 25, 45), help: '노트 가운데 부분에서 목표 음과 평균적으로 얼마나 떨어졌는지 (100센트 = 반음)', target: '25센트 이하', dir: -1, num: meanAbs },
        { id: 'bias', label: '치우침', value: Number.isFinite(bias) ? (Math.abs(bias) < 8 ? '고른 편' : bias > 0 ? `높게 ${ct(bias, true)}` : `낮게 ${ct(bias, true)}`) : '—', status: lowGood(Math.abs(bias), 12, 25), help: '전체적으로 목표보다 높게(+) 또는 낮게(−) 부르는 경향', target: '±12센트 안', dir: -1, num: Math.abs(bias) },
        { id: 'steady', label: '긴 음 흔들림', value: Number.isFinite(steadyDev) ? `±${r0(steadyDev)}센트` : '—', status: lowGood(steadyDev, 15, 25), help: '0.6초 넘는 음을 낼 때 음이 흔들린 정도 (바이브레이션은 빼고 계산)', target: '±15센트 이하', dir: -1, num: steadyDev },
      ],
    },
    {
      id: 'onset',
      title: '음 시작',
      metrics: [
        { id: 'reach', label: '목표 음까지 걸린 시간', value: ms(reachMed), status: lowGood(reachMed, 120, 220), help: '소리를 낸 뒤 목표 음(±50센트)에 안정적으로 들어오기까지 걸린 시간 (중앙값)', target: '120ms 이하', dir: -1, num: reachMed },
        { id: 'scoop', label: '아래에서 끌어올림', value: Number.isFinite(scoopRate) ? `${r0(scoopRate * 100)}%${scoopList.length ? ` · 평균 ${r0(scoopDepth)}센트` : ''}` : '—', status: lowGood(scoopRate * 100, 15, 30), help: '음을 목표보다 60센트 넘게 낮게 시작해서 올라간 노트 비율 (앞 음에서 이어 올라오는 노트, 원곡 창법은 제외)', target: '15% 이하', dir: -1, num: scoopRate * 100 },
      ],
    },
    {
      id: 'sustain',
      title: '음 유지',
      metrics: [
        { id: 'fall', label: '끝음 처짐', value: Number.isFinite(fallRate) ? `${r0(fallRate * 100)}%${fallList.length ? ` · 평균 ${r0(fallDepth)}센트` : ''}` : '—', status: lowGood(fallRate * 100, 15, 30), help: '음 끝부분이 60센트 넘게 떨어진 노트 비율 (원곡 창법은 제외)', target: '15% 이하', dir: -1, num: fallRate * 100 },
        { id: 'hold', label: '끝까지 유지', value: pc(holdPct), status: highGood(holdPct, 90, 75), help: '0.4초 넘는 노트에서 노트 길이 끝까지 소리를 낸 비율 (평균)', target: '90% 이상', dir: 1, num: holdPct },
        { id: 'endurance', label: '소절 후반 음정', value: Number.isFinite(drift) ? (drift <= 3 ? '유지돼요' : `${r0(drift)}센트 더 어긋남`) : '—', status: lowGood(drift, 5, 12), help: '긴 소절(4초 넘게, 노트 6개 이상)에서 뒤 절반이 앞 절반보다 얼마나 더 어긋나는지', target: '5센트 이하', dir: -1, num: drift },
      ],
    },
    {
      id: 'rhythm',
      title: '리듬',
      metrics: [
        { id: 'entry', label: '소절 첫 음 타이밍', value: Number.isFinite(entryMean) ? (Math.abs(entryMean) < 30 ? '정확해요' : entryMean > 0 ? `${ms(entryMean)} 늦음` : `${ms(-entryMean)} 빠름`) : '—', status: lowGood(Math.abs(entryMean), 60, 120), help: '쉬었다가 다시 들어가는 노트에서 노트 시작보다 얼마나 늦게(빠르게) 소리를 냈는지 (평균)', target: '±60ms 안', dir: -1, num: Math.abs(entryMean) },
        { id: 'entrySd', label: '타이밍 들쭉날쭉', value: Number.isFinite(entrySd) ? `±${r0(entrySd)}ms` : '—', status: lowGood(entrySd, 60, 100), help: '들어가는 타이밍이 매번 얼마나 다른지 (편차). 작을수록 박이 안정적이에요', target: '±60ms 이하', dir: -1, num: entrySd },
      ],
    },
    {
      id: 'move',
      title: '음 이동',
      metrics: [
        { id: 'leapUp', label: '크게 올라갈 때', value: upLeaps.length ? `${pc(leapAcc(upLeaps))} (${upLeaps.length}번)` : '—', status: highGood(leapAcc(upLeaps), 75, 55), help: '3반음 넘게 올라간 다음 음을 정확히(±50센트) 잡은 비율', target: '75% 이상', dir: 1, num: leapAcc(upLeaps) },
        { id: 'leapDown', label: '크게 내려갈 때', value: downLeaps.length ? `${pc(leapAcc(downLeaps))} (${downLeaps.length}번)` : '—', status: highGood(leapAcc(downLeaps), 75, 55), help: '3반음 넘게 내려간 다음 음을 정확히 잡은 비율', target: '75% 이상', dir: 1, num: leapAcc(downLeaps) },
        { id: 'high', label: '고음 정확도', value: Number.isFinite(highAcc) ? `${pc(highAcc)} · 평균 ${ct(highBias, true)}` : '—', status: highGood(highAcc, 75, 55), help: '이 곡에서 가장 높은 음 25%만 따로 본 정확도와 치우침', target: '75% 이상', dir: 1, num: highAcc },
      ],
    },
    {
      id: 'expr',
      title: '표현',
      metrics: [
        { id: 'vibrato', label: '바이브레이션', value: vibs.length ? `${r0(vibPct)}% · ${vibRate.toFixed(1)}회/초 · ±${r0(vibExt)}센트` : '거의 없어요', status: 'info', help: '0.6초 넘는 음에서 규칙적으로 떨린 비율, 속도, 폭. 보통 5~7회/초, ±30~80센트면 자연스러워요', num: vibPct },
        { id: 'dynamics', label: '셈여림 폭', value: Number.isFinite(dynRange) ? `${r0(dynRange)}dB` : '—', status: 'info', help: '작게 부른 음과 크게 부른 음의 차이 (마이크 거리에 따라 달라져서 참고용)', num: dynRange },
        { id: 'endDrop', label: '소절 끝 음량', value: Number.isFinite(endDrop) ? (endDrop > -2 ? '유지돼요' : `${r0(endDrop)}dB 작아짐`) : '—', status: Number.isFinite(endDrop) ? highGood(endDrop, -4, -8) : 'info', help: '소절 마지막 음이 그 소절의 다른 음보다 얼마나 작아지는지. 많이 작아지면 숨이 부족한 경우가 많아요', target: '−4dB 안', dir: 1, num: endDrop },
      ],
    },
    {
      id: 'cover',
      title: '소화',
      metrics: [
        { id: 'coverage', label: '부른 비율', value: pc(coverage * 100), status: highGood(coverage * 100, 85, 65), help: '연습한 구간의 노트 길이 중 실제로 소리를 낸 비율', target: '85% 이상', dir: 1, num: coverage * 100 },
        { id: 'above', label: '내 음역보다 높은 음', value: aboveRange.length ? `${aboveRange.length}개 · 정확도 ${pc(aboveAcc)}` : '없어요', status: aboveRange.length ? highGood(aboveAcc, 70, 45) : 'good', help: '측정한 내 최고음보다 높은 노트 수와 그 노트들의 정확도', dir: 1, num: aboveAcc },
      ],
    },
  ]

  /* ---------------- 코칭 ---------------- */
  const ex = (x: NA, value: string): Example => ({ id: x.note.id, start: x.note.start, midi: x.n.midi, lyric: x.note.lyric, value })
  const exCents = (x: NA, v: number) => ex(x, `${sign(v)}${r0(v)}센트`)
  const coaching: Coaching[] = []
  const add = (c: Omit<Coaching, 'examples'> & { examples: Example[] }) => {
    if (c.severity > 0) coaching.push(c)
  }
  const sev = (v: number, good: number, bad: number) => (Number.isFinite(v) ? Math.max(0, (v - good) / Math.max(1e-6, bad - good)) : 0)

  if (Number.isFinite(highBias) && high.length >= 3 && highBias <= -25 && highBias - restBias <= -15)
    add({
      id: 'highFlat',
      title: '고음에서 음이 덜 올라가요',
      evidence: `고음 평균 ${r0(highBias)}센트 (나머지 음 ${ct(restBias, true)}) · 고음 정확도 ${pc(highAcc)}`,
      why: '고음 직전에 숨이 부족하거나, 목에 힘이 들어가서 소리가 눌리면 음이 덜 올라가요.',
      how: ['고음이 나오는 소절 직전에 숨을 미리 충분히 채우기', '턱을 내리고 입을 세로로 열어서 소리 길 만들기', "'아' 대신 '어'에 가깝게 살짝 어둡게 내 보기", '계속 어렵다면 키를 1~2 내려서 정확하게 부르는 연습부터'],
      goal: `고음 평균 ${r0(highBias)} → ${Math.min(-10, r0(highBias / 2))}센트`,
      confidence: 'high',
      severity: sev(-highBias, 15, 50) + 0.4,
      examples: [...high].sort((a, b) => a.midMed - b.midMed).slice(0, 4).map((x) => exCents(x, x.midMed)),
    })
  else if (Number.isFinite(bias) && Math.abs(bias) >= 15 && midVals.length >= 30) {
    const flat = bias < 0
    add({
      id: flat ? 'flat' : 'sharp',
      title: flat ? '전체적으로 조금 낮게 불러요' : '전체적으로 조금 높게 불러요',
      evidence: `노트 가운데 부분 평균 ${ct(bias, true)} · 맞은 노트 ${pc(notePct)}`,
      why: flat ? '반주 소리에 비해 내 목소리가 잘 안 들리거나, 소리를 뒤로 삼키듯 내면 음이 낮아지기 쉬워요.' : '힘을 주거나 크게 부르려고 하면 음이 뜨기 쉬워요.',
      how: flat
        ? ['이어폰 한쪽을 빼서 내 목소리가 잘 들리게 하기', '가이드 보컬을 조금 올리고 같이 불러 기준 잡기', '음을 "위에서 잡는다"는 느낌으로 소리를 앞으로 밝게 내기']
        : ['한 단계 작게, 힘을 빼고 불러 보기', '가이드 보컬과 같이 부르며 높이 맞추기', '어깨와 목에 힘이 들어가지 않았는지 확인'],
      goal: `평균 ${ct(bias, true)} → ±10센트 안`,
      confidence: 'high',
      severity: sev(Math.abs(bias), 12, 40) + 0.3,
      examples: [...withMid].sort((a, b) => (flat ? a.midMed - b.midMed : b.midMed - a.midMed)).slice(0, 4).map((x) => exCents(x, x.midMed)),
    })
  }

  if (Number.isFinite(scoopRate) && scoopList.length >= 3 && scoopRate >= 0.2)
    add({
      id: 'scoop',
      title: '음을 아래에서 끌어올려 시작해요',
      evidence: `노트 ${r0(scoopRate * 100)}%에서 · 시작이 평균 ${r0(scoopDepth)}센트 낮음 · 목표 음까지 ${ms(reachMed)}`,
      why: '목표 음을 미리 떠올리지 않고 소리부터 내면, 낮은 데서 시작해 음을 찾아 올라가게 돼요.',
      how: ['들어가기 직전에 목표 음을 머릿속으로 먼저 울려 보기', "자음을 짧게 하고 모음을 바로 그 높이에 '꽂듯이' 시작하기", '문제 노트를 반복 구간으로 걸고, 첫소리만 여러 번 맞춰 보기'],
      goal: `끌어올림 ${r0(scoopRate * 100)}% → 15% 이하`,
      confidence: hasOrig ? 'mid' : 'low',
      severity: sev(scoopRate * 100, 15, 50),
      examples: [...scoopList].sort((a, b) => a.startDelta - b.startDelta).slice(0, 4).map((x) => exCents(x, x.startDelta)),
    })

  if (Number.isFinite(fallRate) && fallList.length >= 3 && fallRate >= 0.2)
    add({
      id: 'fall',
      title: '끝음이 처져요',
      evidence: `노트 ${r0(fallRate * 100)}%에서 · 끝이 평균 ${r0(fallDepth)}센트 떨어짐${Number.isFinite(endDrop) && endDrop < -4 ? ` · 소절 끝 음량 ${r0(endDrop)}dB` : ''}`,
      why: '음 끝에서 숨의 힘이 빠지면 음도 같이 떨어져요. 소절 끝에서 소리가 작아지는 것도 같은 원인인 경우가 많아요.',
      how: ['노트가 끝날 때까지 배에 힘을 유지하기', "마지막 음을 '조금 높게 끝낸다'는 느낌으로 내기", '긴 음을 고른 크기로 8초 유지하는 연습 (스~ 소리로 먼저)'],
      goal: `끝 처짐 ${r0(fallRate * 100)}% → 15% 이하`,
      confidence: hasOrig ? 'mid' : 'low',
      severity: sev(fallRate * 100, 15, 50),
      examples: [...fallList].sort((a, b) => a.endDelta - b.endDelta).slice(0, 4).map((x) => exCents(x, x.endDelta)),
    })

  if (unstableList.length >= 2 && Number.isFinite(steadyDev) && steadyDev > 18)
    add({
      id: 'unstable',
      title: '길게 낼 때 음이 흔들려요',
      evidence: `긴 음 흔들림 평균 ±${r0(steadyDev)}센트 · 흔들린 긴 음 ${unstableList.length}개 / ${longs.length}개`,
      why: '숨을 일정하게 내보내지 못하면 긴 음에서 음 높이도 같이 출렁여요. 바이브레이션과 달리 불규칙하게 흔들려요.',
      how: ["'스~' 소리로 10초 동안 고르게 숨 내쉬기", '같은 음을 작은 소리로 5초 유지 → 점점 크게', '긴 음이 나오는 소절을 반복 구간으로 걸고 끝까지 일정하게'],
      goal: `±${r0(steadyDev)} → ±15센트 이하`,
      confidence: 'mid',
      severity: sev(steadyDev, 15, 35),
      examples: [...unstableList].sort((a, b) => b.wob!.sd - a.wob!.sd).slice(0, 4).map((x) => ex(x, `±${r0(x.wob!.sd)}센트`)),
    })

  if (Number.isFinite(entryMean) && entries.length >= 4 && Math.abs(entryMean) > 70) {
    const late = entryMean > 0
    const lst = entries.filter((x) => (late ? x.entry > 0.1 : x.entry < -0.08))
    add({
      id: late ? 'late' : 'early',
      title: late ? '소절 첫 음에 늦게 들어가요' : '소절 첫 음에 빨리 들어가요',
      evidence: `평균 ${ms(Math.abs(entryMean))} ${late ? '늦음' : '빠름'} · 편차 ±${r0(entrySd)}ms (소절 ${entries.length}개)`,
      why: late ? '들어가기 직전에 숨을 쉬느라 늦어지거나, 가사를 떠올리느라 반 박 늦게 시작하는 경우가 많아요.' : '반주를 듣기보다 기억으로 앞서 나가면 빨라져요.',
      how: late
        ? ['앞 소절이 끝나자마자 바로 숨을 들이마시기', '반주의 박을 발로 세면서 그 박에 맞춰 시작', '먼저 탭으로 싱크를 맞춰서 측정이 정확한지 확인']
        : ['들어가기 전에 반주의 박을 2박 세고 시작', '가이드 보컬과 같이 부르며 첫소리를 맞추기'],
      goal: `${ms(Math.abs(entryMean))} → 60ms 안`,
      confidence: 'low',
      severity: sev(Math.abs(entryMean), 60, 200),
      examples: [...lst].sort((a, b) => (late ? b.entry - a.entry : a.entry - b.entry)).slice(0, 4).map((x) => ex(x, `${sign(x.entry)}${r0(x.entry * 1000)}ms`)),
    })
  }

  if (upLeaps.length >= 4 && leapAcc(upLeaps) < 65 && leapAcc(upLeaps) < notePct - 10) {
    const bad = (bigUp.length ? bigUp : upLeaps).filter((l) => !l.x.accurate)
    add({
      id: 'leap',
      title: '크게 올라가는 음을 잘 못 잡아요',
      evidence: `3반음 넘게 올라갈 때 정확도 ${pc(leapAcc(upLeaps))} (전체 노트 ${pc(notePct)})`,
      why: '도약할 음 높이를 미리 준비하지 않으면 중간 어딘가에 떨어지기 쉬워요.',
      how: ['도약 두 음만 떼어서 천천히 "음-음" 반복', '도착 음을 먼저 길게 내 본 뒤 출발 음에서 점프', '도약 직전에 입 모양과 숨을 미리 준비'],
      goal: `도약 정확도 ${pc(leapAcc(upLeaps))} → 75% 이상`,
      confidence: 'mid',
      severity: sev(100 - leapAcc(upLeaps), 25, 60),
      examples: bad.slice(0, 4).map((l) => exCents(l.x, l.x.midMed)),
    })
  }

  if (Number.isFinite(drift) && drifts.length >= 2 && drift > 8)
    add({
      id: 'endurance',
      title: '긴 소절 뒷부분에서 음정이 흐트러져요',
      evidence: `긴 소절 뒤 절반이 앞 절반보다 평균 ${r0(drift)}센트 더 어긋남`,
      why: '소절 앞에서 숨을 많이 써 버리면 뒤로 갈수록 소리를 받쳐 줄 힘이 모자라요.',
      how: ['소절 앞부분을 조금 작게 불러 숨 아끼기', '가사 사이에 짧게 숨 쉴 자리를 미리 정해 두기', '긴 소절을 반복 구간으로 걸고 끝까지 같은 힘으로'],
      goal: `${r0(drift)} → 5센트 이하`,
      confidence: 'mid',
      severity: sev(drift, 5, 25),
      examples: drifts
        .sort((a, b) => b.d - a.d)
        .slice(0, 3)
        .map((d) => {
          const x = na.find((v) => v.note.start === d.start)!
          return ex(x, `+${r0(d.d)}센트`)
        }),
    })

  if (Number.isFinite(endDrop) && endDrops.length >= 3 && endDrop < -6 && !coaching.some((c) => c.id === 'fall'))
    add({
      id: 'breath',
      title: '소절 끝에서 소리가 작아져요',
      evidence: `소절 마지막 음이 평균 ${r0(endDrop)}dB 작아짐`,
      why: '소절 끝까지 쓸 숨이 남지 않으면 마지막 음에서 소리가 힘없이 줄어요.',
      how: ['소절 시작 전에 숨을 충분히 채우기', '마지막 음까지 같은 크기를 유지한다고 생각하며 부르기', '숨 쉴 자리를 가사에 표시해 두기'],
      goal: `${r0(endDrop)}dB → −4dB 안`,
      confidence: 'low',
      severity: sev(-endDrop, 4, 14),
      examples: endDrops
        .sort((a, b) => a.d - b.d)
        .slice(0, 4)
        .map((d) => ex(d.x, `${r0(d.d)}dB`)),
    })

  const missed = na.filter((x) => !x.sung)
  if (coverage < 0.8 && missed.length >= 3)
    add({
      id: 'coverage',
      title: '부르지 않은 노트가 많아요',
      evidence: `부른 비율 ${pc(coverage * 100)} · 안 부른 노트 ${missed.length}개 / ${na.length}개`,
      why: '가사를 놓치거나 숨이 모자라서 빠진 부분이에요. 마이크가 목소리를 못 잡은 경우일 수도 있어요.',
      how: ['가사 줄을 보면서 먼저 가사를 입에 붙이기', '빠진 부분을 반복 구간으로 걸어 따로 연습', '마이크와 거리를 가깝게, 입력 레벨 확인'],
      goal: `부른 비율 ${pc(coverage * 100)} → 85% 이상`,
      confidence: 'mid',
      severity: sev(100 - coverage * 100, 15, 50),
      examples: missed.slice(0, 4).map((x) => ex(x, '안 부름')),
    })

  if (aboveRange.length >= 3 && Number.isFinite(aboveAcc) && aboveAcc < 50)
    add({
      id: 'key',
      title: '내 음역보다 높은 음이 힘들어요',
      evidence: `내 최고음보다 높은 노트 ${aboveRange.length}개 · 정확도 ${pc(aboveAcc)}`,
      why: '지금 키에서는 일부 음이 내 편한 음역 밖에 있어요. 무리해서 부르면 음정과 목 둘 다 상하기 쉬워요.',
      how: ['키 탭에서 추천 키로 낮춰서 부르기', '낮춘 키에서 정확도가 올라가면 반 키씩 다시 올려 보기'],
      goal: '높은 음 정확도 70% 이상 (편한 키에서)',
      confidence: 'high',
      severity: sev(100 - aboveAcc, 50, 100) + 0.2,
      examples: aboveRange.slice(0, 4).map((x) => ex(x, x.sung ? `${sign(x.midMed)}${r0(x.midMed)}센트` : '안 부름')),
    })

  coaching.sort((a, b) => b.severity - a.severity)

  /* ---------------- 잘한 점 ---------------- */
  const strengths: string[] = []
  for (const g of groups)
    for (const m of g.metrics) {
      if (m.status !== 'good' || m.value === '—' || m.id === 'above') continue
      // '끝음 처짐 4% · 평균 −80센트' 같은 값은 앞부분만
      const v = m.value.split(' · ')[0]
      strengths.push(m.id === 'scoop' || m.id === 'fall' ? `${m.label} 적음 (${v})` : `${m.label} ${v}`)
    }

  /* ---------------- 한 줄 요약 ---------------- */
  // 그 영역의 평가 수치가 모두 '좋음'인 영역만 잘한 영역으로 본다
  const goodAreas = groups.filter((g) => {
    const ms = g.metrics.filter((m) => m.status !== 'info' && m.value !== '—')
    return ms.length > 0 && ms.every((m) => m.status === 'good')
  })
  const bestArea = goodAreas.slice(0, 2).map((g) => g.title).join('·')
  const summary = !enough
    ? '분석하기엔 기록이 짧아요. 한 소절 이상 불러 주세요.'
    : coaching.length
      ? `${bestArea ? `${bestArea}${eunNeun(bestArea)} 좋아요. ` : ''}가장 먼저 고칠 점은 '${coaching[0].title}'예요.`
      : '크게 고칠 점이 없어요. 지금처럼 부르면 돼요!'

  const rows: NoteRow[] = na.map((x) => ({
    id: x.note.id,
    start: x.note.start,
    dur: x.note.dur,
    midi: x.n.midi,
    lyric: x.note.lyric,
    acc: x.sung ? r0(noteScore(x) * 100) : null,
    cents: Number.isFinite(x.midMed) ? r0(x.midMed) : null,
    tags: x.tags,
  }))

  const keyNums: Record<string, number> = { score, pitch: parts.pitch, timing: parts.timing, coverage: parts.coverage }
  for (const g of groups) for (const m of g.metrics) if (m.num !== undefined && Number.isFinite(m.num)) keyNums[m.id] = Math.round(m.num * 10) / 10

  return {
    enough,
    score,
    grade,
    summary,
    parts,
    groups,
    coaching: coaching.slice(0, 3),
    strengths: strengths.slice(0, 4),
    phrases: phraseScores,
    rows,
    range,
    pitchStats,
    notesInRange: na.length,
    notesSung: sungNA.length,
    comparedWithOriginal: hasOrig,
    keyNums,
  }
}

/** 상태 순서 (나쁨이 먼저) */
export const statusRank = (s: Status) => STATUS_RANK[s]
export { fmtT }
