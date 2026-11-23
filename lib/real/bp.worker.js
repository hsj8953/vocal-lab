// @ts-nocheck
/* eslint-disable */
/**
 * Basic Pitch를 별도 스레드(Web Worker)에서 돌린다.
 * 메인 스레드에서 돌리면 계산하는 동안 화면이 멈추고, 크롬이 "응답 없음"을 띄울 수 있다.
 * 그래픽카드(WebGL, OffscreenCanvas)를 쓸 수 있으면 쓰고, 안 되면 CPU로 계산한다.
 */
// TensorFlow.js 3.x 일부 코드가 워커 안에서도 window·screen을 찾아서, 라이브러리를 불러오기 전에 대체값을 넣는다
// (Next.js가 'typeof window'를 미리 'object'로 바꿔 버리므로 'in' 검사로 확인한다)
if (!('window' in globalThis)) {
  self.window = self
  if (!self.devicePixelRatio) self.devicePixelRatio = 1
  if (!self.screen) self.screen = { width: 1920, height: 1080 }
}

self.onmessage = async (e) => {
  const { audio, modelUrl } = e.data
  try {
    const tf = await import('@tensorflow/tfjs')
    const { BasicPitch, outputToNotesPoly, noteFramesToTime } = await import('@spotify/basic-pitch')
    let ok = false
    if (typeof OffscreenCanvas !== 'undefined') {
      try {
        ok = await tf.setBackend('webgl')
      } catch (err) {
        ok = false
      }
    }
    if (!ok) await tf.setBackend('cpu')
    await tf.ready()
    self.postMessage({ type: 'backend', backend: tf.getBackend() })
    const model = tf.loadGraphModel(modelUrl)
    const bp = new BasicPitch(model)
    const frames = []
    const onsets = []
    await bp.evaluateModel(
      audio,
      (f, o) => {
        for (const x of f) frames.push(x)
        for (const x of o) onsets.push(x)
      },
      (p) => self.postMessage({ type: 'progress', p }),
    )
    const notes = noteFramesToTime(outputToNotesPoly(frames, onsets, 0.5, 0.3, 7, true, 1600, 100, true))
    self.postMessage({ type: 'done', ev: notes.map((n) => [n.startTimeSeconds, n.startTimeSeconds + n.durationSeconds, n.pitchMidi, n.amplitude]) })
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) })
  }
}
