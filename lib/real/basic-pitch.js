// @ts-nocheck
/* Spotify Basic Pitch — 노트 시작/끝(경계)을 찾는 AI. 결과는 [시작, 끝, midi, 세기] 배열
 * 계산은 Web Worker(bp.worker.js)에서 해서 화면이 멈추지 않게 한다. */

export async function runBasicPitch(audioBuffer, onProg) {
  const len = Math.ceil(audioBuffer.duration * 22050)
  const oc = new OfflineAudioContext(1, len, 22050)
  const s = oc.createBufferSource()
  s.buffer = audioBuffer
  s.connect(oc.destination)
  s.start()
  const mono = new Float32Array((await oc.startRendering()).getChannelData(0))
  const worker = new Worker(new URL('./bp.worker.js', import.meta.url), { type: 'module' })
  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        const m = e.data
        if (m.type === 'progress') onProg && onProg(m.p)
        else if (m.type === 'backend') console.info('[VOCAL·LAB] Basic Pitch backend (worker):', m.backend)
        else if (m.type === 'done') resolve(m.ev)
        else if (m.type === 'error') reject(new Error(m.message))
      }
      worker.onerror = (e) => reject(new Error(e.message || 'Basic Pitch worker error'))
      worker.postMessage({ audio: mono, modelUrl: new URL('/models/basic-pitch/model.json', location.href).href }, [mono.buffer])
    })
  } finally {
    worker.terminate()
  }
}
