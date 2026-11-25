/**
 * 녹음한 내 노래에 거는 효과.
 *
 * - 미리 계산하는 효과 (값을 바꾸면 다시 계산): 노이즈 게이트, 오토튠, 자동 화음, 더블링
 *   음 높이를 바꾸는 효과는 PSOLA(음 높이 주기 단위로 잘라 붙이기)로 처리한다.
 *   내 음 높이는 연습할 때 이미 잰 값(연습 기록)을 쓰고, 목표 음은 노트에서 가져온다.
 * - 바로 바뀌는 효과 (Web Audio 노드): EQ, 컴프레서, 리버브, 에코
 */
import type { Note, SessionStats } from './engine'

/* ------------------------------------------------------------------ */
/* 설정 · 프리셋                                                         */
/* ------------------------------------------------------------------ */

export type ReverbType = 'room' | 'karaoke' | 'hall'
export type HarmonyType = 'off' | 'up3' | 'down3' | 'both'

export interface FxParams {
  /** 오토튠 세기 0~1 (0 = 끔) */
  tune: number
  /** 오토튠 속도(ms) — 0이면 바로 붙는 로봇 느낌, 클수록 자연스러움 (실시간 방식에서만) */
  tuneSpeed: number
  /** note: 노트마다 평균적으로 어긋난 만큼만 통째로 옮김 (자연스러움, 표현 유지) · live: 순간순간 따라가며 보정 (오토튠 효과) */
  tuneMode: 'note' | 'live'
  /** 노이즈 게이트 0~1 */
  gate: number
  /** EQ (dB) */
  low: number
  mid: number
  high: number
  /** 컴프레서 0~1 */
  comp: number
  reverbType: ReverbType
  /** 리버브 양 0~1 */
  reverb: number
  /** 에코 간격(ms) */
  echoTime: number
  /** 에코 반복 0~0.85 */
  echoFeedback: number
  /** 에코 양 0~1 */
  echo: number
  /** 더블링 양 0~1 */
  double: number
  harmony: HarmonyType
  /** 화음 양 0~1 */
  harmonyMix: number
}

export const FX_OFF: FxParams = {
  tune: 0,
  tuneSpeed: 80,
  tuneMode: 'note',
  gate: 0,
  low: 0,
  mid: 0,
  high: 0,
  comp: 0,
  reverbType: 'karaoke',
  reverb: 0,
  echoTime: 300,
  echoFeedback: 0.3,
  echo: 0,
  double: 0,
  harmony: 'off',
  harmonyMix: 0.4,
}

export interface FxPreset {
  id: string
  label: string
  desc: string
  fx: FxParams
}

export const FX_PRESETS: FxPreset[] = [
  { id: 'raw', label: '원본', desc: '효과 없이 녹음 그대로', fx: FX_OFF },
  { id: 'clean', label: '깔끔한 녹음', desc: '잡음을 줄이고 또렷하게, 살짝 울림', fx: { ...FX_OFF, gate: 0.5, low: -2, mid: 2, high: 2, comp: 0.5, reverbType: 'room', reverb: 0.18 } },
  { id: 'karaoke', label: '노래방', desc: '넓은 울림과 에코', fx: { ...FX_OFF, gate: 0.4, mid: 1, comp: 0.6, reverbType: 'karaoke', reverb: 0.38, echo: 0.28, echoTime: 280, echoFeedback: 0.3 } },
  { id: 'ballad', label: '발라드', desc: '티 안 나는 음정 보정, 홀 울림', fx: { ...FX_OFF, tune: 0.8, tuneMode: 'note', gate: 0.4, high: 1.5, comp: 0.5, reverbType: 'hall', reverb: 0.28 } },
  { id: 'chorus', label: '풍성한 코러스', desc: '목소리 겹치기와 자동 화음', fx: { ...FX_OFF, tune: 0.8, tuneMode: 'note', gate: 0.4, comp: 0.5, high: 2, reverbType: 'hall', reverb: 0.3, double: 0.5, harmony: 'up3', harmonyMix: 0.35 } },
  { id: 'autotune', label: '오토튠 힙합', desc: '음에 딱 붙는 로봇 느낌', fx: { ...FX_OFF, tune: 1, tuneMode: 'live', tuneSpeed: 0, gate: 0.5, mid: 2, high: 2, comp: 0.7, reverbType: 'room', reverb: 0.2, echo: 0.15, echoTime: 220, echoFeedback: 0.2, double: 0.35 } },
]

/** 다시 계산이 필요한 값이 바뀌었는지 */
export const renderKey = (p: FxParams) => [p.tune > 0 ? p.tune.toFixed(2) : 0, p.tune > 0 ? p.tuneMode : '', p.tune > 0 && p.tuneMode === 'live' ? p.tuneSpeed : 0, p.gate.toFixed(2), p.double > 0 ? 1 : 0, p.harmony].join('|')

/* ------------------------------------------------------------------ */
/* 음 높이 곡선 (연습 기록에서)                                            */
/* ------------------------------------------------------------------ */

export const HOP = 0.005 // 5ms

export interface PitchCurve {
  /** 내 음 (MIDI, 없으면 NaN) */
  user: Float32Array
  /** 목표 음 (MIDI, 없으면 NaN) */
  target: Float32Array
  /** 그 순간의 노트 id 순번 (화음 계산용, 없으면 -1) */
  noteIdx: Int32Array
}

/**
 * 연습 기록(노트별 [시간, 센트])을 녹음 시간축의 5ms 곡선으로 만든다.
 * @param t0 녹음 첫 샘플이 곡의 몇 초인지
 * @param dur 녹음 길이(초)
 */
export function pitchCurve(session: SessionStats, t0: number, dur: number): PitchCurve {
  const n = Math.ceil(dur / HOP) + 1
  const user = new Float32Array(n).fill(NaN)
  const target = new Float32Array(n).fill(NaN)
  const noteIdx = new Int32Array(n).fill(-1)
  session.perNote.forEach((nr, k) => {
    const s = nr.samples
    // 노트 범위 전체에 목표 음
    const a = Math.max(0, Math.floor((nr.start - t0) / HOP))
    const b = Math.min(n - 1, Math.ceil((nr.start + nr.dur - t0) / HOP))
    for (let i = a; i <= b; i++) {
      target[i] = nr.midi
      noteIdx[i] = k
    }
    // 내 음: 측정한 프레임 사이(60ms 안)는 이어서 채운다
    for (let j = 0; j < s.length; j++) {
      const ta = nr.start + s[j][0] - t0
      const ma = nr.midi + s[j][1] / 100
      const nx = s[j + 1]
      const tb = nx && nx[0] - s[j][0] <= 0.06 ? nr.start + nx[0] - t0 : ta + 0.02
      const mb = nx && nx[0] - s[j][0] <= 0.06 ? nr.midi + nx[1] / 100 : ma
      const ia = Math.max(0, Math.round(ta / HOP))
      const ib = Math.min(n - 1, Math.round(tb / HOP))
      for (let i = ia; i <= ib; i++) user[i] = ma + ((mb - ma) * (i - ia)) / Math.max(1, ib - ia)
    }
  })
  fillGaps(user, 16)
  return { user, target, noteIdx }
}

/** 마이크가 음을 놓친 짧은 틈(maxHops × 5ms 이하)은 앞뒤 값으로 잇는다 — 보정이 껐다 켜졌다 하지 않게 */
export function fillGaps(u: Float32Array, maxHops: number) {
  let last = -1
  for (let i = 0; i < u.length; i++) {
    if (!Number.isFinite(u[i])) continue
    if (last >= 0 && i - last > 1 && i - last <= maxHops + 1 && Math.abs(u[i] - u[last]) < 1.5) {
      for (let k = last + 1; k < i; k++) u[k] = u[last] + ((u[i] - u[last]) * (k - last)) / (i - last)
    }
    last = i
  }
}

/* ------------------------------------------------------------------ */
/* 조성 추정 · 화음                                                       */
/* ------------------------------------------------------------------ */

const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
const SCALE_MAJ = [0, 2, 4, 5, 7, 9, 11]
const SCALE_MIN = [0, 2, 3, 5, 7, 8, 10]

/** 노트들의 음 분포로 조성 추정 (Krumhansl) */
export function estimateKey(notes: { midi: number; dur: number }[]): { tonic: number; minor: boolean } {
  const h = new Array(12).fill(0)
  for (const n of notes) h[((Math.round(n.midi) % 12) + 12) % 12] += n.dur
  const corr = (prof: number[], t: number) => {
    const x = h.map((_, i) => h[(i + t) % 12])
    const mx = x.reduce((a, b) => a + b, 0) / 12
    const mp = prof.reduce((a, b) => a + b, 0) / 12
    let num = 0
    let dx = 0
    let dp = 0
    for (let i = 0; i < 12; i++) {
      num += (x[i] - mx) * (prof[i] - mp)
      dx += (x[i] - mx) ** 2
      dp += (prof[i] - mp) ** 2
    }
    return num / Math.sqrt(dx * dp || 1)
  }
  let best = { tonic: 0, minor: false, r: -Infinity }
  for (let t = 0; t < 12; t++) {
    const a = corr(MAJ, t)
    const b = corr(MIN, t)
    if (a > best.r) best = { tonic: t, minor: false, r: a }
    if (b > best.r) best = { tonic: t, minor: true, r: b }
  }
  return { tonic: best.tonic, minor: best.minor }
}

/** 조성 안에서 steps 칸(3도 = ±2칸) 떨어진 음 */
export function diatonic(midi: number, key: { tonic: number; minor: boolean }, steps: number): number {
  const sc = key.minor ? SCALE_MIN : SCALE_MAJ
  const m = Math.round(midi)
  const rel = (((m - key.tonic) % 12) + 12) % 12
  // 음계 안의 가장 가까운 아래 음
  let idx = 0
  for (let i = 0; i < 7; i++) if (sc[i] <= rel) idx = i
  const octBase = m - rel // 이 옥타브의 으뜸음
  const off = rel - sc[idx] // 음계 밖 음이면 그만큼 유지
  const j = idx + steps
  const oct = Math.floor(j / 7)
  const jj = ((j % 7) + 7) % 7
  return octBase + sc[jj] + 12 * oct + off
}

/* ------------------------------------------------------------------ */
/* PSOLA 음 높이 바꾸기                                                   */
/* ------------------------------------------------------------------ */

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12)

/**
 * @param x 입력
 * @param sr 샘플레이트
 * @param f0At i번째 5ms 칸의 음 높이(Hz, 모르면 0)
 * @param ratioAt i번째 5ms 칸에서 음 높이를 몇 배로 할지 (1 = 그대로)
 */
export function psola(x: Float32Array, sr: number, f0At: (h: number) => number, ratioAt: (h: number) => number): Float32Array {
  const N = x.length
  const y = new Float32Array(N)
  const w = new Float32Array(N)
  const hopS = HOP * sr
  const period = (i: number) => {
    const f = f0At(Math.min(Math.floor(i / hopS), 1e9))
    return f > 60 && f < 1500 ? sr / f : sr / 200
  }
  const voicedAt = (i: number) => f0At(Math.floor(i / hopS)) > 60
  // 소수점 위치의 샘플 (Catmull-Rom 보간)
  const at = (p: number) => {
    const i = Math.floor(p)
    if (i < 1 || i + 2 >= N) return i >= 0 && i < N ? x[i] : 0
    const t = p - i
    const a = x[i - 1]
    const b = x[i]
    const c = x[i + 1]
    const d = x[i + 2]
    return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)))
  }

  // 분석 위치: 음 높이 주기마다. 소리 있는 곳에서는 바로 앞 조각과 파형이 가장 비슷한 자리를
  // 소수점 단위까지 찾는다 (정수 자리로만 맞추면 주기마다 반 샘플씩 흔들려 거친 소리가 난다)
  const marks: number[] = []
  let t = 0
  while (t < N) {
    marks.push(t)
    const P = Math.max(16, period(t))
    let nx = t + P
    const ti = Math.round(t)
    if (voicedAt(nx) && voicedAt(t)) {
      const r = Math.round(P * 0.25)
      const half = Math.round(P / 2)
      const score = (c: number) => {
        let num = 0
        let e = 0
        for (let j = -half; j <= half; j += 2) {
          const a = ti + j
          const bb = c + j
          if (a < 0 || bb < 0 || bb >= N) continue
          num += x[a] * x[bb]
          e += x[bb] * x[bb]
        }
        return num / Math.sqrt(e + 1e-9)
      }
      let best = Math.round(nx)
      let bv = -Infinity
      const lo = Math.max(ti + 8, Math.round(nx) - r)
      const hi = Math.min(N - 2 - half, Math.round(nx) + r)
      for (let c = lo; c <= hi; c++) {
        const v = score(c)
        if (v > bv) {
          bv = v
          best = c
        }
      }
      // 포물선으로 소수점 자리 찾기
      if (best > lo && best < hi) {
        const s0 = score(best - 1)
        const s2 = score(best + 1)
        const den = s0 - 2 * bv + s2
        const d = den < 0 ? (0.5 * (s0 - s2)) / den : 0
        nx = best + Math.max(-0.5, Math.min(0.5, d))
        // 앞 조각의 소수점 위치만큼 같이 옮긴다
        nx += t - ti
      } else nx = best + (t - ti)
    } else if (voicedAt(nx)) {
      // 소리가 시작되는 곳: 첫 주기 안의 봉우리로
      const s0 = Math.round(nx)
      let best = s0
      let bv = -Infinity
      const P2 = Math.max(16, Math.round(period(nx)))
      for (let i = s0; i < Math.min(N, s0 + P2); i++) {
        if (x[i] > bv) {
          bv = x[i]
          best = i
        }
      }
      nx = best
    }
    if (nx <= t + 4) nx = t + P
    t = nx
  }

  // 합성: 분석 조각을 하나씩 차례로 쓰고, 간격만 음 높이 비율만큼 줄이거나 늘린다.
  // 합성 위치와 분석 위치가 반 주기 넘게 벌어졌을 때만 조각을 한 번 건너뛰거나 반복한다.
  const nextOf = (i: number) => (i + 1 < marks.length ? marks[i + 1] - marks[i] : Math.max(16, period(marks[i])))
  const prevOf = (i: number) => (i > 0 ? marks[i] - marks[i - 1] : nextOf(i))
  let k = 0
  let ts = marks[0] ?? 0
  while (ts < N && marks.length > 1 && k < marks.length) {
    const ta = marks[k]
    const nextI = nextOf(k)
    const prevI = prevOf(k)
    const h = Math.floor(ts / hopS)
    const r = f0At(h) > 0 && f0At(Math.floor(ta / hopS)) > 0 ? Math.max(0.5, Math.min(2, ratioAt(h))) : 1
    const d0 = Math.max(0, Math.ceil(ts - prevI))
    const d1 = Math.min(N - 1, Math.floor(ts + nextI))
    for (let di = d0; di <= d1; di++) {
      const j = di - ts
      const L = j < 0 ? prevI : nextI
      const win = 0.5 + 0.5 * Math.cos((Math.PI * j) / (L + 0.5))
      y[di] += at(ta + j) * win
      w[di] += win
    }
    ts += Math.max(8, nextI / r)
    let nk = k + 1
    while (nk + 1 < marks.length && ts - marks[nk] > nextOf(nk) / 2) nk++
    if (nk < marks.length && marks[nk] - ts > prevOf(nk) / 2) nk = k
    k = nk
  }
  for (let i = 0; i < N; i++) y[i] = w[i] > 1e-3 ? y[i] / w[i] : 0
  // 끝부분이 모자라 생긴 아주 작은 창 가중치는 원래 소리로
  for (let i = 0; i < N; i++) if (w[i] < 0.25) y[i] = x[i] * (w[i] / 0.25) + y[i] * (1 - w[i] / 0.25)
  return y
}

/* ------------------------------------------------------------------ */
/* 노이즈 게이트                                                         */
/* ------------------------------------------------------------------ */

export function noiseGate(x: Float32Array, sr: number, amount: number): Float32Array {
  if (amount <= 0) return x
  const win = Math.round(sr * 0.01)
  const nb = Math.ceil(x.length / win)
  const env = new Float32Array(nb)
  for (let b = 0; b < nb; b++) {
    let s = 0
    const a = b * win
    const e = Math.min(x.length, a + win)
    for (let i = a; i < e; i++) s += x[i] * x[i]
    env[b] = 10 * Math.log10(s / Math.max(1, e - a) + 1e-12)
  }
  const sorted = Array.from(env).sort((a, b) => a - b)
  const loud = sorted[Math.floor(sorted.length * 0.95)]
  const thr = loud - (52 - 28 * amount)
  const floor = 0.25 * (1 - amount)
  const out = new Float32Array(x.length)
  let g = 1
  let hold = 0
  const att = 1 - Math.exp(-1 / (0.004 * sr))
  const rel = 1 - Math.exp(-1 / (0.12 * sr))
  for (let b = 0; b < nb; b++) {
    const open = env[b] > thr
    if (open) hold = 8
    else if (hold > 0) hold--
    const want = open || hold > 0 ? 1 : floor
    const a = b * win
    const e = Math.min(x.length, a + win)
    for (let i = a; i < e; i++) {
      g += (want - g) * (want > g ? att : rel)
      out[i] = x[i] * g
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 레이어 계산                                                           */
/* ------------------------------------------------------------------ */

export interface RenderedLayers {
  /** 게이트만 건 원래 목소리 */
  raw: Float32Array
  /** 오토튠 (tune이 0이면 null) */
  tuned: Float32Array | null
  /** 화음 (끄면 null) */
  harmony: Float32Array | null
  /** 더블링 [왼쪽, 오른쪽] (끄면 null) */
  double: [Float32Array, Float32Array] | null
}

const tick = () => new Promise((r) => setTimeout(r, 0))

export async function renderLayers(take: { data: Float32Array; sr: number }, curve: PitchCurve, notes: Note[], shift: number, p: FxParams, onProg?: (r: number) => void): Promise<RenderedLayers> {
  const { sr } = take
  onProg?.(0.05)
  await tick()
  const raw = noiseGate(take.data, sr, p.gate)
  const nH = curve.user.length
  const f0At = (h: number) => (h < nH && Number.isFinite(curve.user[h]) ? midiHz(curve.user[h]) : 0)

  // 오토튠 보정량 (반음, 5ms마다) — 목표 음과 2.5반음 넘게 다르면 다른 음을 부른 것으로 보고 손대지 않는다
  const corr = new Float32Array(nH)
  if (p.tune > 0 && p.tuneMode === 'note') {
    // 노트마다: 가운데 부분에서 평균적으로 어긋난 만큼만 통째로 옮긴다 (비브라토·꺾기는 그대로)
    const spans = new Map<number, { a: number; b: number }>()
    for (let h = 0; h < nH; h++) {
      const k = curve.noteIdx[h]
      if (k < 0) continue
      const sp = spans.get(k)
      if (sp) sp.b = h
      else spans.set(k, { a: h, b: h })
    }
    const want = new Float32Array(nH)
    for (const { a, b } of spans.values()) {
      const d: number[] = []
      const lo = a + Math.floor((b - a) * 0.2)
      const hi = b - Math.floor((b - a) * 0.2)
      for (let h = lo; h <= hi; h++) if (Number.isFinite(curve.user[h]) && Number.isFinite(curve.target[h])) d.push(curve.target[h] - curve.user[h])
      if (d.length < 6) continue
      d.sort((x, y) => x - y)
      const med = d[d.length >> 1]
      if (Math.abs(med) > 2.5) continue
      for (let h = a; h <= b; h++) want[h] = med * p.tune
    }
    // 노트가 바뀔 때 보정량이 튀지 않게 앞뒤로 부드럽게 (약 30ms)
    const al = 1 - Math.exp(-5 / 30)
    let c = 0
    for (let h = 0; h < nH; h++) corr[h] = c += (want[h] - c) * al
    c = 0
    for (let h = nH - 1; h >= 0; h--) corr[h] = c += (corr[h] - c) * al
  } else if (p.tune > 0) {
    // 실시간 방식: 가장 빨라도 10ms에 걸쳐 따라간다 (계단 소리 방지)
    const a = 1 - Math.exp(-(HOP * 1000) / Math.max(10, p.tuneSpeed))
    const dec = 1 - Math.exp(-(HOP * 1000) / 30)
    let c = 0
    for (let h = 0; h < nH; h++) {
      const u = curve.user[h]
      const t = curve.target[h]
      let want = 0
      if (Number.isFinite(u) && Number.isFinite(t) && Math.abs(t - u) <= 2.5) want = (t - u) * p.tune
      // 음을 못 잰 곳에서는 보정을 바로 끊지 않고 서서히 0으로
      c += (want - c) * (Number.isFinite(u) ? a : dec)
      corr[h] = c
    }
  }
  const corrAt = (h: number) => (h < nH ? corr[h] : 0)

  onProg?.(0.15)
  await tick()
  const tuned = p.tune > 0 ? psola(raw, sr, f0At, (h) => 2 ** (corrAt(h) / 12)) : null
  onProg?.(0.4)
  await tick()

  let harmony: Float32Array | null = null
  if (p.harmony !== 'off') {
    const sorted = [...notes].sort((a, b) => a.start - b.start)
    const key = estimateKey(sorted.map((n) => ({ midi: n.midi + shift, dur: n.dur })))
    const make = (steps: number) =>
      psola(raw, sr, f0At, (h) => {
        const t = h < nH ? curve.target[h] : NaN
        if (!Number.isFinite(t)) return 1
        return 2 ** ((diatonic(t, key, steps) - t + corrAt(h)) / 12)
      })
    if (p.harmony === 'both') {
      const a = make(2)
      await tick()
      const b = make(-2)
      harmony = new Float32Array(a.length)
      for (let i = 0; i < a.length; i++) harmony[i] = 0.7 * (a[i] + b[i])
    } else harmony = make(p.harmony === 'up3' ? 2 : -2)
    // 화음은 내 음 높이를 안 쟀던 곳(노트 밖)에선 소리를 내지 않는다
    const hopS = HOP * sr
    let g = 0
    for (let i = 0; i < harmony.length; i++) {
      const h = Math.floor(i / hopS)
      const on = h < nH && Number.isFinite(curve.target[h]) && Number.isFinite(curve.user[h]) ? 1 : 0
      g += (on - g) * 0.002
      harmony[i] *= g
    }
  }
  onProg?.(0.75)
  await tick()

  let double: [Float32Array, Float32Array] | null = null
  if (p.double > 0) {
    const src = tuned ?? raw
    const shiftTo = (cents: number, delayMs: number) => {
      const r = 2 ** (cents / 1200)
      const z = psola(src, sr, f0At, () => r)
      const d = Math.round((delayMs / 1000) * sr)
      const out = new Float32Array(z.length)
      out.set(z.subarray(0, z.length - d), d)
      return out
    }
    double = [shiftTo(9, 23), shiftTo(-9, 31)]
  }
  onProg?.(1)
  return { raw, tuned, harmony, double }
}

/* ------------------------------------------------------------------ */
/* 바로 바뀌는 효과 체인 (EQ · 컴프레서 · 리버브 · 에코)                      */
/* ------------------------------------------------------------------ */

const REVERB_SEC: Record<ReverbType, number> = { room: 0.7, karaoke: 1.6, hall: 2.8 }

function impulse(ctx: BaseAudioContext, type: ReverbType): AudioBuffer {
  const sec = REVERB_SEC[type]
  const sr = ctx.sampleRate
  const n = Math.floor(sr * sec)
  const b = ctx.createBuffer(2, n, sr)
  let seed = type.length * 9301
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1
  const pre = Math.floor(sr * (type === 'hall' ? 0.025 : 0.012))
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch)
    let lp = 0
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr
      // 뒤로 갈수록 고음이 빨리 줄어드는 울림
      const damp = 0.25 + 0.6 * Math.min(1, t / sec)
      lp += (rnd() - lp) * (1 - damp)
      d[i] = lp * Math.exp((-6.9 * t) / sec)
    }
  }
  return b
}

export interface VocalChain {
  input: AudioNode
  output: AudioNode
  update: (p: FxParams) => void
}

export function createVocalChain(ctx: BaseAudioContext, p0: FxParams): VocalChain {
  const input = ctx.createGain()
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 80
  const low = ctx.createBiquadFilter()
  low.type = 'lowshelf'
  low.frequency.value = 220
  const mid = ctx.createBiquadFilter()
  mid.type = 'peaking'
  mid.frequency.value = 2800
  mid.Q.value = 0.9
  const high = ctx.createBiquadFilter()
  high.type = 'highshelf'
  high.frequency.value = 8000
  const comp = ctx.createDynamicsCompressor()
  const makeup = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain()
  const revSend = ctx.createGain()
  const conv = ctx.createConvolver()
  const echoSend = ctx.createGain()
  const delay = ctx.createDelay(2)
  const fb = ctx.createGain()
  const fbLp = ctx.createBiquadFilter()
  fbLp.type = 'lowpass'
  fbLp.frequency.value = 3500
  const echoOut = ctx.createGain()

  input.connect(hp).connect(low).connect(mid).connect(high).connect(comp).connect(makeup)
  makeup.connect(dry).connect(output)
  makeup.connect(revSend).connect(conv).connect(output)
  makeup.connect(echoSend).connect(delay)
  delay.connect(fbLp).connect(fb).connect(delay)
  delay.connect(echoOut).connect(output)
  // 에코에도 살짝 리버브
  echoOut.connect(revSend)

  let revType: ReverbType | null = null
  const update = (p: FxParams) => {
    low.gain.value = p.low
    mid.gain.value = p.mid
    high.gain.value = p.high
    // 컴프레서: 세기에 따라 문턱을 낮추고 비율을 올림, 줄어든 만큼 다시 키움
    comp.threshold.value = -6 - 30 * p.comp
    comp.ratio.value = 1 + 7 * p.comp
    comp.knee.value = 8
    comp.attack.value = 0.006
    comp.release.value = 0.18
    makeup.gain.value = 10 ** ((12 * p.comp) / 20)
    if (p.reverbType !== revType) {
      conv.buffer = impulse(ctx, p.reverbType)
      revType = p.reverbType
    }
    revSend.gain.value = p.reverb * 0.9
    dry.gain.value = 1 - 0.35 * p.reverb
    delay.delayTime.value = Math.max(0.05, p.echoTime / 1000)
    fb.gain.value = Math.min(0.85, p.echoFeedback)
    echoSend.gain.value = p.echo
    echoOut.gain.value = 0.8
  }
  update(p0)
  return { input, output, update }
}

/* ------------------------------------------------------------------ */
/* 레이어 볼륨                                                            */
/* ------------------------------------------------------------------ */

/** 레이어별 볼륨. compare: 'raw'면 튜닝 전 목소리 */
export function layerGains(p: FxParams, has: { tuned: boolean; harmony: boolean; double: boolean }, compare: 'tuned' | 'raw') {
  const useTuned = has.tuned && compare === 'tuned'
  return {
    raw: useTuned ? 0 : 1,
    tuned: useTuned ? 1 : 0,
    harmony: has.harmony ? p.harmonyMix * 0.8 : 0,
    double: has.double ? p.double * 0.7 : 0,
  }
}

/** AudioBuffer → 16비트 WAV */
export function encodeWav(b: AudioBuffer): Blob {
  const nc = b.numberOfChannels
  const n = b.length
  const sr = b.sampleRate
  const ab = new ArrayBuffer(44 + n * nc * 2)
  const dv = new DataView(ab)
  const str = (o: number, t: string) => [...t].forEach((ch, i) => dv.setUint8(o + i, ch.charCodeAt(0)))
  str(0, 'RIFF')
  dv.setUint32(4, 36 + n * nc * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)
  dv.setUint16(22, nc, true)
  dv.setUint32(24, sr, true)
  dv.setUint32(28, sr * nc * 2, true)
  dv.setUint16(32, nc * 2, true)
  dv.setUint16(34, 16, true)
  str(36, 'data')
  dv.setUint32(40, n * nc * 2, true)
  const out = new Int16Array(ab, 44)
  const ch = Array.from({ length: nc }, (_, c) => b.getChannelData(c))
  for (let i = 0, k = 0; i < n; i++)
    for (let c = 0; c < nc; c++, k++) out[k] = Math.round(Math.max(-1, Math.min(1, ch[c][i])) * 32767)
  return new Blob([ab], { type: 'audio/wav' })
}
