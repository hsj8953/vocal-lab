/**
 * 노트 점검 — 원곡 보컬 음 선(흰 선)과 노트를 비교해서
 * 빠진 곳, 소리가 없는 노트, 음이 다른 노트, 너무 짧은 노트를 찾고, 빠진 곳은 선을 따라 노트를 만든다.
 * 모든 음은 원곡 키 MIDI (노트와 같은 기준).
 */

export interface Curve {
  t0: number
  hop: number
  midi: Float32Array
}

interface NoteLike {
  id: string
  start: number
  dur: number
  midi: number
}

export type CheckKind = 'missing' | 'novoice' | 'pitch' | 'short'

export interface CheckItem {
  kind: CheckKind
  start: number
  end: number
  noteId?: string
  /** 노트의 지금 음 (원곡 키) */
  midi?: number
  /** 선이 말하는 음 (원곡 키, 반올림) */
  suggest?: number
  /** 음 다름의 확실도 — high: 선이 노트 내내 다른 음에 평평하게 있음, low: 잠깐 휘거나 흔들림·화음일 수도 */
  conf?: 'high' | 'low'
  /** 판단 근거 (점검용) */
  feat?: { steady: number; halves: boolean; cover: number; diff: number }
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  return s[s.length >> 1]
}

/** 노트가 덮는 프레임 (앞뒤 pad초 여유) */
function coverage(c: Curve, notes: NoteLike[], pad: number) {
  const cov = new Uint8Array(c.midi.length)
  for (const n of notes) {
    const a = Math.max(0, Math.floor((n.start - pad - c.t0) / c.hop))
    const b = Math.min(c.midi.length - 1, Math.ceil((n.start + n.dur + pad - c.t0) / c.hop))
    for (let i = a; i <= b; i++) cov[i] = 1
  }
  return cov
}

/** 보컬 소리 크기 (10ms마다 dB) */
export interface Envelope {
  t0: number
  hop: number
  db: Float32Array
}

export function checkNotes(c: Curve, notes: NoteLike[], env?: Envelope | null): CheckItem[] {
  const out: CheckItem[] = []
  const N = c.midi.length
  const tAt = (i: number) => c.t0 + i * c.hop
  const cov = coverage(c, notes, 0.04)
  const maxGap = Math.round(0.06 / c.hop)

  // 1) 빠진 곳: 선은 있는데 노트가 없는 구간
  let i = 0
  while (i < N) {
    if (!(Number.isFinite(c.midi[i]) && !cov[i])) {
      i++
      continue
    }
    let j = i
    let last = i
    while (j + 1 < N) {
      const k = j + 1
      if (cov[k]) break
      if (Number.isFinite(c.midi[k])) last = k
      else if (k - last > maxGap) break
      j = k
    }
    const vals: number[] = []
    for (let k = i; k <= last; k++) if (Number.isFinite(c.midi[k])) vals.push(c.midi[k])
    const dur = tAt(last) - tAt(i) + c.hop
    if (dur >= 0.18 && vals.length * c.hop >= 0.15) out.push({ kind: 'missing', start: tAt(i), end: tAt(last) + c.hop, suggest: Math.round(median(vals)) })
    i = j + 1
  }

  // 곡 전체 튜닝: 가수가 전체적으로 조금 높게/낮게 부르는 만큼은 틀린 게 아니다
  const diffs: number[] = []
  for (const n of notes) {
    const a = Math.max(0, Math.floor((n.start + n.dur * 0.2 - c.t0) / c.hop))
    const b = Math.min(N - 1, Math.ceil((n.start + n.dur * 0.8 - c.t0) / c.hop))
    for (let k = a; k <= b; k += 2) {
      const d = c.midi[k] - n.midi
      if (Number.isFinite(d) && Math.abs(d) < 0.8) diffs.push(d)
    }
  }
  const tune = diffs.length > 50 ? median(diffs) : 0

  // 보컬 소리 크기 기준: 노래하는 부분의 큰 소리(상위 10%)
  let loud = NaN
  if (env && env.db.length > 100) {
    const s = Array.from(env.db).filter((v) => v > -100).sort((x, y) => x - y)
    loud = s[Math.floor(s.length * 0.9)]
  }
  /** 노트 구간에서 보컬이 가장 크게 난 정도 (dB, 기준 대비) */
  const peakDb = (a: number, b: number) => {
    if (!env || !Number.isFinite(loud)) return NaN
    const i0 = Math.max(0, Math.floor((a - env.t0) / env.hop))
    const i1 = Math.min(env.db.length - 1, Math.ceil((b - env.t0) / env.hop))
    let mx = -200
    for (let i = i0; i <= i1; i++) mx = Math.max(mx, env.db[i])
    return mx - loud
  }

  // 2) 노트별: 소리 없음 · 음 다름 · 너무 짧음
  for (const n of notes) {
    if (n.dur < 0.07) {
      out.push({ kind: 'short', start: n.start, end: n.start + n.dur, noteId: n.id, midi: n.midi })
      continue
    }
    const a = Math.max(0, Math.floor((n.start - c.t0) / c.hop))
    const b = Math.min(N - 1, Math.ceil((n.start + n.dur - c.t0) / c.hop))
    // 선은 작게 부른 소리를 놓치기도 해서, 앞뒤 0.06초까지 봐도 소리가 거의 없을 때만
    const pa = Math.max(0, a - Math.round(0.06 / c.hop))
    const pb = Math.min(N - 1, b + Math.round(0.06 / c.hop))
    let voiced = 0
    for (let k = pa; k <= pb; k++) if (Number.isFinite(c.midi[k])) voiced++
    const frames = Math.max(1, pb - pa + 1)
    // 보컬 소리 크기를 알면 그걸로 (선보다 정확), 모르면 선으로
    const pk = peakDb(n.start, n.start + n.dur)
    if (Number.isFinite(pk) ? pk < -32 : voiced / frames < 0.06) {
      out.push({ kind: 'novoice', start: n.start, end: n.start + n.dur, noteId: n.id, midi: n.midi })
      continue
    }
    const lo = a + Math.floor((b - a) * 0.2)
    const hi = b - Math.floor((b - a) * 0.2)
    const mid: number[] = []
    for (let k = lo; k <= hi; k++) if (Number.isFinite(c.midi[k])) mid.push(c.midi[k])
    if (mid.length >= 5) {
      const m = median(mid) - tune
      if (Math.abs(m - n.midi) >= 0.9) {
        const sg = Math.round(m)
        const dir = Math.sign(m - n.midi)
        // 1) 선이 제안 음 근처(±0.5)에 머문 비율
        const steady = mid.filter((v) => Math.abs(v - tune - m) <= 0.5).length / mid.length
        // 2) 노트 앞쪽 절반·뒤쪽 절반 모두 같은 쪽으로 다른가 (잠깐 휜 게 아니라 내내 다른가)
        const h = mid.length >> 1
        const m1 = median(mid.slice(0, h)) - tune
        const m2 = median(mid.slice(h)) - tune
        const halves = Math.sign(m1 - n.midi) === dir && Math.sign(m2 - n.midi) === dir && Math.abs(m1 - n.midi) >= 0.7 && Math.abs(m2 - n.midi) >= 0.7
        // 3) 노트 가운데에서 선이 잡힌 비율
        const cover = mid.length / Math.max(1, hi - lo + 1)
        const diff = Math.abs(m - n.midi)
        const conf: 'high' | 'low' = steady >= 0.6 && halves && cover >= 0.6 ? 'high' : 'low'
        out.push({ kind: 'pitch', start: n.start, end: n.start + n.dur, noteId: n.id, midi: n.midi, suggest: sg, conf, feat: { steady, halves, cover, diff } })
      }
    }
  }
  return out.sort((x, y) => x.start - y.start)
}

/**
 * 구간 [a, b]에서 선을 따라 노트 만들기 (이미 노트가 있는 곳은 건너뜀).
 * 음이 0.7반음 넘게 바뀐 상태가 3프레임 이어지면 새 노트로 나누고, 노트 음은 그 구간 선의 중앙값.
 */
export function fillFromCurve(c: Curve, a: number, b: number, notes: NoteLike[]): { start: number; dur: number; midi: number }[] {
  const N = c.midi.length
  const cov = coverage(c, notes, 0.02)
  const i0 = Math.max(0, Math.floor((a - c.t0) / c.hop))
  const i1 = Math.min(N - 1, Math.ceil((b - c.t0) / c.hop))
  const maxGap = Math.round(0.06 / c.hop)
  const segs: { a: number; b: number; vals: number[] }[] = []
  let cur: { a: number; b: number; vals: number[] } | null = null
  let lastVoiced = -1
  const close = () => {
    if (cur && (cur.b - cur.a + 1) * c.hop >= 0.08) segs.push(cur)
    cur = null
  }
  for (let i = i0; i <= i1; i++) {
    const m = c.midi[i]
    if (cov[i] || !Number.isFinite(m)) {
      if (cov[i] || (cur && i - lastVoiced > maxGap)) close()
      continue
    }
    lastVoiced = i
    if (!cur) {
      cur = { a: i, b: i, vals: [m] }
      continue
    }
    const ref = median(cur.vals.slice(-6))
    if (Math.abs(m - ref) > 0.7) {
      // 바뀐 음이 3프레임 이어지는지
      let far = 1
      for (let k = i + 1; k <= Math.min(i1, i + 3); k++) if (Number.isFinite(c.midi[k]) && Math.abs(c.midi[k] - ref) > 0.7) far++
      if (far >= 3) {
        close()
        cur = { a: i, b: i, vals: [m] }
        continue
      }
    }
    cur.b = i
    cur.vals.push(m)
  }
  close()
  const out = segs.map((s) => ({ start: c.t0 + s.a * c.hop, dur: (s.b - s.a + 1) * c.hop, midi: Math.round(median(s.vals)) }))
  // 같은 음이 거의 붙어 있으면 합친다
  const merged: typeof out = []
  for (const n of out) {
    const p = merged[merged.length - 1]
    if (p && p.midi === n.midi && n.start - (p.start + p.dur) < 0.05) p.dur = n.start + n.dur - p.start
    else merged.push({ ...n })
  }
  return merged
}
