/**
 * 마스터링: 반주와 섞인 완성본 전체를 마지막으로 다듬는다.
 * 묶어 주는 컴프레서 → 음량 올리기 → 리미터(찢어짐 막기) → 부드러운 클리퍼.
 * 재생(실시간)과 저장(오프라인)에 같은 노드 구성을 써서 들리는 그대로 저장된다.
 */

export type MasterPreset = 'off' | 'natural' | 'release' | 'youtube'

export interface MasterPresetInfo {
  id: MasterPreset
  label: string
  desc: string
  /** 목표 음량 (LUFS) */
  target: number
  /** 묶어 주는 컴프레서 */
  glue: { threshold: number; ratio: number }
}

export const MASTER_PRESETS: MasterPresetInfo[] = [
  { id: 'natural', label: '자연스럽게', desc: '원래 느낌 그대로, 크기만 알맞게 맞춰요', target: -16, glue: { threshold: -18, ratio: 1.5 } },
  { id: 'release', label: '음원처럼', desc: '멜론에서 듣는 노래처럼 꽉 차고 크게', target: -10, glue: { threshold: -22, ratio: 2.5 } },
  { id: 'youtube', label: '유튜브·SNS', desc: '올렸을 때 소리가 작아지지 않는 크기로', target: -14, glue: { threshold: -20, ratio: 2 } },
]

export const masterInfo = (id: MasterPreset) => MASTER_PRESETS.find((p) => p.id === id) ?? null

export interface MasterChain {
  input: AudioNode
  output: AudioNode
  /** 음량 올리는 양 (dB) */
  setGain: (db: number) => void
  /** 비교용 출력 조절 (dB) — '같은 크기로 비교'에서 후를 전 크기로 내린다 */
  setTrim: (db: number) => void
}

const dbToGain = (db: number) => Math.pow(10, db / 20)

/** 마지막 안전장치: 0.9를 넘는 부분만 부드럽게 눌러 1을 넘지 않게 */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 4096
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    const ax = Math.abs(x)
    c[i] = ax <= 0.9 ? x : Math.sign(x) * (0.9 + 0.08 * Math.tanh((ax - 0.9) / 0.08))
  }
  return c
}

export function createMasterChain(ctx: BaseAudioContext, preset: MasterPresetInfo, gainDb: number): MasterChain {
  const input = ctx.createGain()
  const glue = ctx.createDynamicsCompressor()
  glue.threshold.value = preset.glue.threshold
  glue.ratio.value = preset.glue.ratio
  glue.knee.value = 8
  glue.attack.value = 0.02
  glue.release.value = 0.25
  const makeup = ctx.createGain()
  makeup.gain.value = dbToGain(gainDb)
  const lim = ctx.createDynamicsCompressor()
  lim.threshold.value = -1.5
  lim.knee.value = 0
  lim.ratio.value = 20
  lim.attack.value = 0.001
  lim.release.value = 0.08
  const clip = ctx.createWaveShaper()
  clip.curve = softClipCurve()
  clip.oversample = '2x'
  const trim = ctx.createGain()
  input.connect(glue).connect(makeup).connect(lim).connect(clip).connect(trim)
  return {
    input,
    output: trim,
    setGain: (db) => makeup.gain.setTargetAtTime(dbToGain(db), (ctx as AudioContext).currentTime ?? 0, 0.03),
    setTrim: (db) => trim.gain.setTargetAtTime(dbToGain(db), (ctx as AudioContext).currentTime ?? 0, 0.03),
  }
}

/* ------------------------------------------------------------------ */
/* 음량 재기 (LUFS, ITU-R BS.1770 방식을 간단히)                           */
/* ------------------------------------------------------------------ */

/** 2차 필터 계수 (RBJ) */
function biquad(type: 'highshelf' | 'highpass', f: number, sr: number, q: number, gainDb = 0) {
  const A = Math.pow(10, gainDb / 40)
  const w = (2 * Math.PI * f) / sr
  const cs = Math.cos(w)
  const sn = Math.sin(w)
  const al = sn / (2 * q)
  let b0, b1, b2, a0, a1, a2
  if (type === 'highshelf') {
    const sq = 2 * Math.sqrt(A) * al
    b0 = A * (A + 1 + (A - 1) * cs + sq)
    b1 = -2 * A * (A - 1 + (A + 1) * cs)
    b2 = A * (A + 1 + (A - 1) * cs - sq)
    a0 = A + 1 - (A - 1) * cs + sq
    a1 = 2 * (A - 1 - (A + 1) * cs)
    a2 = A + 1 - (A - 1) * cs - sq
  } else {
    b0 = (1 + cs) / 2
    b1 = -(1 + cs)
    b2 = (1 + cs) / 2
    a0 = 1 + al
    a1 = -2 * cs
    a2 = 1 - al
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0]
}

function filt(x: Float32Array, c: number[]): Float32Array {
  const [b0, b1, b2, a1, a2] = c
  const y = new Float32Array(x.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x[i]
    y2 = y1
    y1 = v
    y[i] = v
  }
  return y
}

/** 통합 음량 (LUFS). 조용한 구간은 빼고 잰다 */
export function measureLufs(buf: AudioBuffer): number {
  const sr = buf.sampleRate
  const kShelf = biquad('highshelf', 1681.97, sr, 0.7072, 4)
  const kHp = biquad('highpass', 38.13, sr, 0.5003)
  const chans: Float32Array[] = []
  for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chans.push(filt(filt(buf.getChannelData(c), kShelf), kHp))
  const block = Math.round(sr * 0.4)
  const step = Math.round(sr * 0.1)
  const powers: number[] = []
  for (let s = 0; s + block <= buf.length; s += step) {
    let p = 0
    for (const ch of chans) {
      let acc = 0
      for (let i = s; i < s + block; i++) acc += ch[i] * ch[i]
      p += acc / block
    }
    powers.push(p)
  }
  const lk = (p: number) => -0.691 + 10 * Math.log10(p + 1e-12)
  const abs = powers.filter((p) => lk(p) > -70)
  if (!abs.length) return -70
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
  const rel = lk(mean(abs)) - 10
  const gated = abs.filter((p) => lk(p) > rel)
  return lk(mean(gated.length ? gated : abs))
}

/** 가장 큰 순간 값 (dB) */
export function peakDb(buf: AudioBuffer): number {
  let m = 0
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]))
  }
  return 20 * Math.log10(m + 1e-12)
}
