// @ts-nocheck
/**
 * TensorFlow.js를 필요할 때만 불러온다.
 * 그래픽카드(WebGL)가 있으면 WebGL, 소프트웨어 렌더러(그래픽 가속 꺼짐, 가상 머신 등)면
 * WebAssembly가 훨씬 빨라서 WASM을 쓴다. 둘 다 안 되면 CPU.
 */

function softwareGpu() {
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') || c.getContext('webgl')
    if (!gl) return true
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const r = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    return /swiftshader|llvmpipe|software|basic render/i.test(r)
  } catch (e) {
    return true
  }
}

let tfMod = null
let wasmReady = null

/** kind: 'crepe' (레이어 모델, WASM 지원) / 'bp' (그래프 모델, WebGL·CPU만) */
export async function loadTf(kind = 'crepe') {
  if (!tfMod) tfMod = await import('@tensorflow/tfjs')
  const tf = tfMod
  const soft = softwareGpu()
  const order = kind === 'bp' ? ['webgl', 'cpu'] : soft ? ['wasm', 'webgl', 'cpu'] : ['webgl', 'wasm', 'cpu']
  for (const b of order) {
    try {
      if (b === 'wasm') {
        if (!wasmReady)
          wasmReady = import('@tensorflow/tfjs-backend-wasm').then((w) => {
            w.setWasmPaths('/tfjs/')
          })
        await wasmReady
      }
      if (tf.getBackend() === b || (await tf.setBackend(b))) {
        await tf.ready()
        break
      }
    } catch (e) {
      console.warn('tfjs backend', b, 'failed', e)
    }
  }
  console.info('[VOCAL·LAB] TensorFlow.js backend (' + kind + '):', tf.getBackend())
  return tf
}
