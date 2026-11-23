// @ts-nocheck
/**
 * CREPE (Kim et al., 2018) — 노래·악기 단선율용으로 학습된 음 높이 추정 신경망.
 * 공식 가중치(github.com/marl/crepe, MIT)를 TensorFlow.js 형식으로 변환해 /public/models 에 넣었다.
 *
 * 입력: 16 kHz 모노. 출력 프레임은 기본 분석기(melody.js)와 같은 간격(256 샘플 = 16 ms)과
 * 같은 중심(프레임 i → 샘플 i·256 + 1024)을 쓴다. 그래서 두 결과를 프레임 단위로 바로 비교할 수 있다.
 */
import { loadTf } from './tf'

export const CREPE_MODELS = {
  tiny: { label: '아주 가벼움', path: '/models/crepe-tiny/model.json', mb: 2 },
  small: { label: '가벼움', path: '/models/crepe-small/model.json', mb: 6.5 },
  medium: { label: '정밀', path: '/models/crepe-medium/model.json', mb: 23.5 },
}

const models = {}
async function getModel(name) {
  const tf = await loadTf('crepe')
  const k = name + '@' + tf.getBackend()
  if (!models[k]) models[k] = tf.loadLayersModel(CREPE_MODELS[name].path)
  return { tf, model: await models[k] }
}

const CENTS0 = 1997.3794084376191 // bin 0 (≈ C1), bin 간격 20 cents, 기준 10 Hz

/**
 * @param x Float32Array 16 kHz 모노 (원곡 시간축)
 * @returns { midi: Float32Array(NaN=없음), conf: Float32Array }
 */
export async function runCrepe(x, name = 'small', onProg) {
  const { tf, model } = await getModel(name)
  const HOP = 256
  const N = Math.max(0, Math.floor((x.length - 2048) / HOP) + 1)
  const midi = new Float32Array(N).fill(NaN)
  const conf = new Float32Array(N)
  const B = 128
  const buf = new Float32Array(B * 1024)
  for (let s = 0; s < N; s += B) {
    const n = Math.min(B, N - s)
    let any = 0
    for (let k = 0; k < n; k++) {
      const o = (s + k) * HOP + 512
      let m = 0
      for (let i = 0; i < 1024; i++) m += x[o + i] || 0
      m /= 1024
      let v = 0
      for (let i = 0; i < 1024; i++) {
        const d = (x[o + i] || 0) - m
        v += d * d
      }
      const sd = Math.sqrt(v / 1024)
      if (sd > 1e-5) any++
      const inv = sd > 1e-8 ? 1 / sd : 0
      for (let i = 0; i < 1024; i++) buf[k * 1024 + i] = ((x[o + i] || 0) - m) * inv
    }
    if (any) {
      const out = tf.tidy(() => model.predict(tf.tensor2d(buf.subarray(0, n * 1024), [n, 1024])))
      const a = await out.data()
      out.dispose()
      for (let k = 0; k < n; k++) {
        const r = k * 360
        let am = 0
        for (let i = 1; i < 360; i++) if (a[r + i] > a[r + am]) am = i
        let ws = 0
        let cs = 0
        for (let i = Math.max(0, am - 4); i <= Math.min(359, am + 4); i++) {
          ws += a[r + i]
          cs += a[r + i] * (CENTS0 + i * 20)
        }
        conf[s + k] = a[r + am]
        const hz = 10 * Math.pow(2, cs / ws / 1200)
        midi[s + k] = 69 + 12 * Math.log2(hz / 440)
      }
    }
    onProg && onProg(Math.min(1, (s + n) / N))
    await new Promise((r) => setTimeout(r, 0))
  }
  return { midi, conf }
}
