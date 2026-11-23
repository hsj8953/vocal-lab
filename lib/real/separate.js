// @ts-nocheck
/* eslint-disable */
/**
 * AI 보컬 / 반주 분리 — Ultimate Vocal Remover(UVR5)의 MDX-Net 모델 'Kim_Vocal_2'
 *   UVR5: https://github.com/Anjok07/ultimatevocalremovergui (MIT) · 모델: Kimberley Jensen / UVR 팀
 *
 * UVR5의 MDX 분리 과정을 그대로 옮겼다.
 *   44.1 kHz 스테레오 → 261,120 샘플 조각(25% 겹침) → STFT(n_fft 7680, hop 1024, hann, center)
 *   → 아래쪽 3072개 주파수만 모델에 넣음 [1, 4(L실수,L허수,R실수,R허수), 3072, 256]
 *   → 나온 스펙트럼을 iSTFT → 조각마다 hann 창으로 이어 붙임 → ×1.009(모델 보정값)
 * 모델 실행은 onnxruntime-web (WebGPU가 있으면 WebGPU, 없으면 WebAssembly).
 */

export const SEP_MODEL = {
  id: 'kim_vocal_2',
  label: 'UVR5 · Kim_Vocal_2',
  url: '/models/uvr/Kim_Vocal_2.onnx',
  mb: 64,
  compensate: 1.009,
  nfft: 7680,
  hop: 1024,
  dimF: 3072,
  dimT: 256,
  sr: 44100,
}

const ORT_VER = '1.31.1'

/* ------------------------------------------------------------------ */
/* 임의 길이 FFT (혼합 기수 2·3·4·5) — 7680 = 4⁴·2·3·5                     */
/* ------------------------------------------------------------------ */

function makeFFTN(n) {
  const factors = []
  let r = n
  for (const p of [4, 2, 3, 5]) {
    while (r % p === 0) {
      factors.push(p)
      r /= p
    }
  }
  if (r !== 1) throw new Error('FFT size not supported: ' + n)
  // [p0, m0, p1, m1, ...]  (kissfft 방식)
  const fac = []
  let m = n
  for (const p of factors) {
    m /= p
    fac.push(p, m)
  }
  const twr = new Float64Array(n)
  const twi = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    twr[k] = Math.cos((-2 * Math.PI * k) / n)
    twi[k] = Math.sin((-2 * Math.PI * k) / n)
  }
  const sr = new Float64Array(8)
  const si = new Float64Array(8)

  function bfly2(oR, oI, o, fstride, m) {
    for (let k = 0; k < m; k++) {
      const a = o + k
      const b = a + m
      const wr = twr[k * fstride]
      const wi = twi[k * fstride]
      const tr = oR[b] * wr - oI[b] * wi
      const ti = oR[b] * wi + oI[b] * wr
      oR[b] = oR[a] - tr
      oI[b] = oI[a] - ti
      oR[a] += tr
      oI[a] += ti
    }
  }
  function bfly4(oR, oI, o, fstride, m, inv) {
    for (let k = 0; k < m; k++) {
      const i0 = o + k
      const i1 = i0 + m
      const i2 = i1 + m
      const i3 = i2 + m
      const w1r = twr[k * fstride], w1i = twi[k * fstride]
      const w2r = twr[2 * k * fstride], w2i = twi[2 * k * fstride]
      const w3r = twr[3 * k * fstride], w3i = twi[3 * k * fstride]
      const s0r = oR[i1] * w1r - oI[i1] * w1i, s0i = oR[i1] * w1i + oI[i1] * w1r
      const s1r = oR[i2] * w2r - oI[i2] * w2i, s1i = oR[i2] * w2i + oI[i2] * w2r
      const s2r = oR[i3] * w3r - oI[i3] * w3i, s2i = oR[i3] * w3i + oI[i3] * w3r
      const s5r = oR[i0] - s1r, s5i = oI[i0] - s1i
      const a0r = oR[i0] + s1r, a0i = oI[i0] + s1i
      const s3r = s0r + s2r, s3i = s0i + s2i
      const s4r = s0r - s2r, s4i = s0i - s2i
      oR[i2] = a0r - s3r
      oI[i2] = a0i - s3i
      oR[i0] = a0r + s3r
      oI[i0] = a0i + s3i
      // 순방향: Fout[m] = s5 - i*s4, Fout[3m] = s5 + i*s4
      oR[i1] = s5r + s4i
      oI[i1] = s5i - s4r
      oR[i3] = s5r - s4i
      oI[i3] = s5i + s4r
    }
  }
  function bflyG(oR, oI, o, fstride, m, p) {
    for (let u = 0; u < m; u++) {
      let k = u
      for (let q = 0; q < p; q++) {
        sr[q] = oR[o + k]
        si[q] = oI[o + k]
        k += m
      }
      k = u
      for (let q1 = 0; q1 < p; q1++) {
        let tw = 0
        let ar = sr[0]
        let ai = si[0]
        for (let q = 1; q < p; q++) {
          tw += fstride * k
          if (tw >= n) tw -= n
          ar += sr[q] * twr[tw] - si[q] * twi[tw]
          ai += sr[q] * twi[tw] + si[q] * twr[tw]
        }
        oR[o + k] = ar
        oI[o + k] = ai
        k += m
      }
    }
  }
  function work(oR, oI, o, iR, iI, ii, fstride, fi) {
    const p = fac[fi]
    const m = fac[fi + 1]
    if (m === 1) {
      for (let k = 0; k < p; k++) {
        oR[o + k] = iR[ii + k * fstride]
        oI[o + k] = iI[ii + k * fstride]
      }
    } else {
      for (let k = 0; k < p; k++) work(oR, oI, o + k * m, iR, iI, ii + k * fstride, fstride * p, fi + 2)
    }
    if (p === 2) bfly2(oR, oI, o, fstride, m)
    else if (p === 4) bfly4(oR, oI, o, fstride, m)
    else bflyG(oR, oI, o, fstride, m, p)
  }
  /** 순방향 FFT (out-of-place) */
  return (iR, iI, oR, oI) => work(oR, oI, 0, iR, iI, 0, 1, 0)
}

/* ------------------------------------------------------------------ */
/* STFT / iSTFT (torch.stft center=True, periodic hann 과 동일)             */
/* ------------------------------------------------------------------ */

function makeStft(M) {
  const { nfft: N, hop, dimF, dimT } = M
  const fft = makeFFTN(N)
  const win = new Float64Array(N)
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)
  const zr = new Float64Array(N)
  const zi = new Float64Array(N)
  const Zr = new Float64Array(N)
  const Zi = new Float64Array(N)
  const half = N / 2

  /** L, R 조각(길이 chunk) → 모델 입력 [4, dimF, dimT] */
  function forward(L, R, chunk, out) {
    const pad = half
    const at = (x, j) => {
      // reflect padding
      let k = j - pad
      if (k < 0) k = -k
      else if (k >= chunk) k = 2 * (chunk - 1) - k
      return x[k]
    }
    const plane = dimF * dimT
    for (let t = 0; t < dimT; t++) {
      const s = t * hop
      for (let i = 0; i < N; i++) {
        zr[i] = at(L, s + i) * win[i]
        zi[i] = at(R, s + i) * win[i]
      }
      fft(zr, zi, Zr, Zi)
      for (let f = 0; f < dimF; f++) {
        const g = f === 0 ? 0 : N - f
        // L = (Z[f] + conj(Z[N-f]))/2 , R = (Z[f] - conj(Z[N-f]))/(2i)
        const lr = 0.5 * (Zr[f] + Zr[g])
        const li = 0.5 * (Zi[f] - Zi[g])
        const rr = 0.5 * (Zi[f] + Zi[g])
        const ri = -0.5 * (Zr[f] - Zr[g])
        const idx = f * dimT + t
        out[idx] = lr
        out[plane + idx] = li
        out[2 * plane + idx] = rr
        out[3 * plane + idx] = ri
      }
    }
  }

  /** 모델 출력 [4, dimF, dimT] → L, R 파형(길이 chunk) */
  function inverse(spec, chunk, outL, outR, wsum) {
    const plane = dimF * dimT
    const total = N + hop * (dimT - 1)
    const accL = new Float64Array(total)
    const accR = new Float64Array(total)
    wsum.fill(0)
    for (let t = 0; t < dimT; t++) {
      // 전체 스펙트럼 Z = L + iR (에르미트 확장), IFFT = conj(FFT(conj(Z)))/N
      Zr.fill(0)
      Zi.fill(0)
      for (let f = 0; f < dimF; f++) {
        const idx = f * dimT + t
        const lr = spec[idx], li = spec[plane + idx], rr = spec[2 * plane + idx], ri = spec[3 * plane + idx]
        // Z[f] = L[f] + i R[f]
        Zr[f] = lr - ri
        Zi[f] = li + rr
        if (f > 0) {
          // Z[N-f] = conj(L[f]) + i conj(R[f])
          Zr[N - f] = lr + ri
          Zi[N - f] = -li + rr
        }
      }
      for (let i = 0; i < N; i++) Zi[i] = -Zi[i]
      fft(Zr, Zi, zr, zi)
      const s = t * hop
      for (let i = 0; i < N; i++) {
        const w = win[i] / N
        accL[s + i] += zr[i] * w
        accR[s + i] -= zi[i] * w
        wsum[s + i] += win[i] * win[i]
      }
    }
    for (let i = 0; i < chunk; i++) {
      const w = wsum[i + half] > 1e-8 ? wsum[i + half] : 1e-8
      outL[i] = accL[i + half] / w
      outR[i] = accR[i + half] / w
    }
  }
  return { forward, inverse, wsumLen: N + hop * (dimT - 1) }
}

/* ------------------------------------------------------------------ */
/* onnxruntime-web                                                       */
/* ------------------------------------------------------------------ */

let ortP = null
async function loadOrt() {
  if (!ortP)
    ortP = (async () => {
      const ort = await import('onnxruntime-web/webgpu')
      ort.env.wasm.wasmPaths = (typeof window !== 'undefined' && window.__ORT_WASM_PATH) || `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`
      ort.env.wasm.numThreads = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1
      return ort
    })()
  return ortP
}

/** 진짜 그래픽카드가 있는 WebGPU인지 (소프트웨어 렌더러면 WASM이 훨씬 빠르다) */
async function realGpu() {
  try {
    if (typeof window !== 'undefined' && window.__ORT_EP === 'wasm') return false
    if (typeof navigator === 'undefined' || !navigator.gpu) return false
    const ad = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!ad) return false
    const info = ad.info || (ad.requestAdapterInfo ? await ad.requestAdapterInfo() : {})
    if (ad.isFallbackAdapter || info.isFallbackAdapter) return false
    const desc = [info.vendor, info.architecture, info.device, info.description].join(' ')
    return !/swiftshader|llvmpipe|software|microsoft basic/i.test(desc)
  } catch (e) {
    return false
  }
}

let sessP = null
let sessEp = null
async function getSession(onStage) {
  const ort = await loadOrt()
  if (!sessP)
    sessP = (async () => {
      onStage && onStage(`분리 모델 내려받는 중 (${SEP_MODEL.mb}MB, 처음 한 번만)`)
      let model
      try {
        const cache = await caches.open('vocallab-models')
        let res = await cache.match(SEP_MODEL.url)
        if (!res) {
          await cache.add(SEP_MODEL.url)
          res = await cache.match(SEP_MODEL.url)
        }
        model = new Uint8Array(await res.arrayBuffer())
      } catch (e) {
        model = new Uint8Array(await (await fetch(SEP_MODEL.url)).arrayBuffer())
      }
      onStage && onStage('분리 모델 준비 중')
      const eps = (await realGpu()) ? ['webgpu', 'wasm'] : ['wasm']
      for (const ep of eps) {
        try {
          const s = await ort.InferenceSession.create(model, { executionProviders: [ep], graphOptimizationLevel: 'all' })
          sessEp = ep
          return s
        } catch (e) {
          console.warn('[VOCAL·LAB] ORT', ep, 'failed', e)
        }
      }
      throw new Error('보컬 분리 모델을 실행할 수 없는 브라우저예요.')
    })().catch((e) => {
      sessP = null
      throw e
    })
  return { ort, session: await sessP }
}

/* ------------------------------------------------------------------ */
/* 분리                                                                  */
/* ------------------------------------------------------------------ */

/**
 * @param buf AudioBuffer (원곡)
 * @param onProg (ratio, stage) => void
 * @returns { sr, L, R } 보컬 (원곡과 같은 길이, 44.1 kHz)
 */
export async function separateVocals(buf, onProg) {
  const M = SEP_MODEL
  const len = Math.ceil(buf.duration * M.sr)
  const oc = new OfflineAudioContext(2, len, M.sr)
  const src = oc.createBufferSource()
  src.buffer = buf
  src.connect(oc.destination)
  src.start()
  const r = await oc.startRendering()
  const xL = r.getChannelData(0)
  const xR = r.getChannelData(1)

  const { ort, session } = await getSession((s) => onProg && onProg(0, s))
  const chunk = M.hop * (M.dimT - 1)
  const trim = M.nfft / 2
  const gen = chunk - 2 * trim
  const pad = gen + trim - (len % gen)
  const L = len + trim + pad
  const mixL = new Float32Array(L)
  const mixR = new Float32Array(L)
  mixL.set(xL, trim)
  mixR.set(xR, trim)
  const resL = new Float32Array(L)
  const resR = new Float32Array(L)
  const div = new Float32Array(L)
  const st = makeStft(M)
  const inp = new Float32Array(4 * M.dimF * M.dimT)
  const pL = new Float32Array(chunk)
  const pR = new Float32Array(chunk)
  const oL = new Float32Array(chunk)
  const oR = new Float32Array(chunk)
  const wsum = new Float64Array(st.wsumLen)
  const step = Math.floor(0.75 * chunk)
  const nSteps = Math.ceil(L / step)
  const t0 = performance.now()
  let done = 0
  for (let i = 0; i < L; i += step) {
    const e = Math.min(i + chunk, L)
    const act = e - i
    pL.fill(0)
    pR.fill(0)
    pL.set(mixL.subarray(i, e))
    pR.set(mixR.subarray(i, e))
    st.forward(pL, pR, chunk, inp)
    const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', inp, [1, 4, M.dimF, M.dimT]) }
    const out = await session.run(feeds)
    const spec = out[session.outputNames[0]].data
    st.inverse(spec, chunk, oL, oR, wsum)
    for (let k = 0; k < act; k++) {
      const hw = act > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (act - 1)) : 1
      resL[i + k] += oL[k] * hw
      resR[i + k] += oR[k] * hw
      div[i + k] += hw
    }
    done++
    const p = done / nSteps
    const el = (performance.now() - t0) / 1000
    const left = Math.round(el / p - el)
    onProg && onProg(p, `AI 보컬 분리 중 ${Math.round(p * 100)}% · 약 ${left >= 60 ? Math.round(left / 60) + '분' : left + '초'} 남음 (${sessEp === 'webgpu' ? '그래픽카드' : 'CPU'})`)
    await new Promise((res) => setTimeout(res, 0))
  }
  const vL = new Float32Array(len)
  const vR = new Float32Array(len)
  for (let k = 0; k < len; k++) {
    const d = div[k + trim] > 1e-8 ? div[k + trim] : 1e-8
    vL[k] = (resL[k + trim] / d) * M.compensate
    vR[k] = (resR[k + trim] / d) * M.compensate
  }
  return { sr: M.sr, L: vL, R: vR, ep: sessEp, seconds: (performance.now() - t0) / 1000 }
}

// 테스트용 (Node)
export const __test = { makeFFTN, makeStft }
