/**
 * 실제로 부른 기록으로 음역을 다시 분석한다.
 * 음 높이별로 [음, 노트 수, 부른 수, 맞은 수, 센트 합]을 모아서
 * 안정적으로 맞힌 가장 높은/낮은 음과, 그 너머에서 계속 틀린 증거가 있는지 본다.
 */

export type PitchStat = [number, number, number, number, number]

export interface EdgeAdvice {
  /** 안정적으로 맞힌 끝 음 (MIDI) */
  okMidi: number
  /** 그 너머에서 계속 틀렸는가 (= 한계를 확인함) */
  limited: boolean
  /** 그 너머 노트 수 · 부른 수 · 맞은 수 · 평균 센트 */
  beyond: { notes: number; sung: number; ok: number; cents: number }
}

export interface RangeAdvice {
  /** 판단할 만큼 기록이 있는가 */
  enough: boolean
  /** 판단 못 한 이유 — few: 기록이 적음, shaky: 전체적으로 음정이 흔들려 높이별 차이를 못 봄 */
  why?: 'few' | 'shaky'
  /** '안정적'의 기준 정확도 (0~1) — 전체 정확도가 낮으면 기준도 조금 낮춘다 */
  okBar: number
  /** 합친 연습 횟수 */
  sessions: number
  /** 음 높이를 잰 노트 수 */
  measured: number
  high: EdgeAdvice | null
  low: EdgeAdvice | null
  /** 실제 기록으로 고친 음역 (측정값과 1반음 이상 다를 때만) */
  suggest: { low: number; high: number } | null
}

/** 여러 번의 기록을 음 높이별로 합친다 */
export function mergeStats(list: PitchStat[][]): PitchStat[] {
  const m = new Map<number, PitchStat>()
  for (const st of list)
    for (const c of st) {
      const v = m.get(c[0]) ?? [c[0], 0, 0, 0, 0]
      v[1] += c[1]
      v[2] += c[2]
      v[3] += c[3]
      v[4] += c[4]
      m.set(c[0], v)
    }
  return [...m.values()].sort((a, b) => a[0] - b[0])
}

export function analyzeRange(stats: PitchStat[], measured: { low: number; high: number }, sessions: number): RangeAdvice {
  const total = stats.reduce((a, c) => a + c[1], 0)
  const sungAll = stats.reduce((a, c) => a + c[2], 0)
  const sungRatio = total ? sungAll / total : 0
  const base = { sessions, measured: sungAll }
  const overall = sungAll ? stats.reduce((a, c) => a + c[3], 0) / sungAll : 0
  // 전체 정확도가 낮은 사람은 기준을 낮춰서 '그 사람 기준으로' 잘 된 음과 안 된 음을 나눈다
  const okBar = Math.min(0.6, Math.max(0.35, overall))
  if (sungAll < 10) return { ...base, enough: false, why: 'few', okBar, high: null, low: null, suggest: null }

  const acc = (c: PitchStat) => (c[2] ? c[3] / c[2] : 0)
  // 맞힌 음: 2번 이상 불러서 기준 이상 맞음
  const good = (c: PitchStat) => c[2] >= 2 && acc(c) >= okBar
  // 힘든 음: 불렀는데 기준의 3/4 미만으로 맞음, 또는 (곡 대부분은 따라 불렀는데) 이 높이에서만 거의 안 부름
  const bad = (c: PitchStat) => (c[2] >= 2 && acc(c) < okBar * 0.75) || (c[1] >= 2 && c[2] / c[1] < 0.35 && sungRatio >= 0.7)

  const goods = stats.filter(good)
  if (!goods.length) return { ...base, enough: false, why: 'shaky', okBar, high: null, low: null, suggest: null }

  const edge = (okMidi: number, beyondCells: PitchStat[]): EdgeAdvice => {
    const notes = beyondCells.reduce((a, c) => a + c[1], 0)
    const sung = beyondCells.reduce((a, c) => a + c[2], 0)
    const ok = beyondCells.reduce((a, c) => a + c[3], 0)
    const cents = sung ? beyondCells.reduce((a, c) => a + c[4], 0) / sung : 0
    const badNotes = beyondCells.filter(bad).reduce((a, c) => a + c[1], 0)
    // 너머 노트가 3개 이상이고 그 절반 이상이 힘든 음이면 한계를 확인한 것
    const limited = notes >= 3 && badNotes >= notes * 0.5
    return { okMidi, limited, beyond: { notes, sung, ok, cents } }
  }
  const hiOk = goods[goods.length - 1][0]
  const loOk = goods[0][0]
  // 잘 된 음이 5반음도 안 되는 좁은 곳에만 있으면 음역을 판단할 근거가 부족하다
  if (hiOk - loOk < 5) return { ...base, enough: false, why: 'shaky', okBar, high: null, low: null, suggest: null }
  const high = edge(hiOk, stats.filter((c) => c[0] > hiOk))
  const low = edge(loOk, stats.filter((c) => c[0] < loOk))

  // 한계를 확인했으면 그 음까지, 아니면 측정값보다 더 낸 만큼만 넓힌다
  let nh = high.limited ? hiOk : Math.max(measured.high, hiOk)
  let nl = low.limited ? loOk : Math.min(measured.low, loOk)
  nh = Math.round(nh)
  nl = Math.round(nl)
  const changed = Math.abs(nh - measured.high) >= 1 || Math.abs(nl - measured.low) >= 1
  const suggest = changed && nh - nl >= 5 ? { low: Math.abs(nl - measured.low) >= 1 ? nl : measured.low, high: Math.abs(nh - measured.high) >= 1 ? nh : measured.high } : null
  return { ...base, enough: true, okBar, high, low, suggest }
}
