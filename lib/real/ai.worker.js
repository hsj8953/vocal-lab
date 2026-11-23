// @ts-nocheck
/* eslint-disable */
/**
 * AI 계산 전용 Web Worker — Basic Pitch(노트 경계)와 CREPE(음 높이)
 * 메인 스레드에서 돌리면 계산하는 동안 화면이 멈추고, 크롬이 "응답 없음"을 띄울 수 있다.
 * 백엔드: 그래픽카드(WebGL, OffscreenCanvas) → WebAssembly(스레드 없이) → CPU
 */

// TensorFlow.js 3.x 일부 코드가 워커 안에서도 window·screen을 찾아서, 라이브러리를 불러오기 전에 대체값을 넣는다
// (Next.js가 'typeof window'를 미리 'object'로 바꿔 버리므로 'in' 검사로 확인한다)
if (!('window' in globalThis)) {
  self.window = self
  if (!self.devicePixelRatio) self.devicePixelRatio = 1
  if (!self.screen) self.screen = { width: 1920, height: 1080 }
}

/** 진짜 그래픽카드인지 (소프트웨어 렌더러면 WebGL이 CPU보다 훨씬 느리다) */
function realGpu() {
  try {
    if (typeof OffscreenCanvas === 'undefined') return false
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2') || new OffscreenCanvas(1, 1).getContext('webgl')
    if (!gl) return false
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const r = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    return !/swiftshader|llvmpipe|software|basic render/i.test(r)
  } catch (e) {
    return false
  }
}

let tfP = null
async function getTf(allowWasm, wasmBase) {
  if (!tfP)
    tfP = (async () => {
      const tf = await import('@tensorflow/tfjs')
      return tf
    })()
  const tf = await tfP
  const order = ['webgl', ...(allowWasm ? ['wasm'] : []), 'cpu']
  for (const b of order) {
    try {
      if (b === 'webgl' && !realGpu()) continue
      if (b === 'wasm') {
        const w = await import('@tensorflow/tfjs-backend-wasm')
        // 스레드판 WASM은 번들 환경에서 내부 워커가 깨지므로 단일 스레드(SIMD)판을 쓴다
        tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT', false)
        w.setWasmPaths(wasmBase)
      }
      if (tf.getBackend() === b || (await tf.setBackend(b))) {
        await tf.ready()
        return tf
      }
    } catch (err) {
      // 다음 백엔드로
    }
  }
  await tf.setBackend('cpu')
  await tf.ready()
  return tf
}

async function runBasicPitch(msg) {
  const tf = await getTf(false)
  self.postMessage({ type: 'backend', backend: tf.getBackend() })
  const { BasicPitch, outputToNotesPoly, noteFramesToTime } = await import('@spotify/basic-pitch')
  const bp = new BasicPitch(tf.loadGraphModel(msg.modelUrl))
  const frames = []
  const onsets = []
  await bp.evaluateModel(
    msg.audio,
    (f, o) => {
      for (const x of f) frames.push(x)
      for (const x of o) onsets.push(x)
    },
    (p) => self.postMessage({ type: 'progress', p }),
  )
  const notes = noteFramesToTime(outputToNotesPoly(frames, onsets, 0.5, 0.3, 7, true, 1600, 100, true))
  return notes.map((n) => [n.startTimeSeconds, n.startTimeSeconds + n.durationSeconds, n.pitchMidi, n.amplitude])
}

const CENTS0 = 1997.3794084376191 // CREPE bin 0 (≈ C1), 20 cents 간격, 기준 10 Hz

async function runCrepe(msg) {
  const tf = await getTf(true, msg.wasmBase)
  self.postMessage({ type: 'backend', backend: tf.getBackend() })
  self.postMessage({ type: 'stage', stage: 'model' })
  const model = await tf.loadLayersModel(msg.modelUrl)
  const x = msg.audio
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
      // 프레임 i의 중심 = 샘플 i·256 + 1024 (기본 분석기와 같은 위치)
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
        midi[s + k] = 69 + 12 * Math.log2((10 * Math.pow(2, cs / ws / 1200)) / 440)
      }
    }
    self.postMessage({ type: 'progress', p: Math.min(1, (s + n) / N) })
  }
  return { midi, conf }
}

self.onmessage = async (e) => {
  const msg = e.data
  try {
    const result = msg.task === 'crepe' ? await runCrepe(msg) : await runBasicPitch(msg)
    self.postMessage({ type: 'done', result }, result && result.midi ? [result.midi.buffer, result.conf.buffer] : [])
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) })
  }
}
