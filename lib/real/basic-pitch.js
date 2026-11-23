// @ts-nocheck
/* Spotify Basic Pitch — 노트 시작/끝(경계)을 찾는 AI. 결과는 [시작, 끝, midi, 세기] 배열
 * 계산은 Web Worker(ai.worker.js)에서 해서 화면이 멈추지 않게 한다. */
import { runAiTask } from './ai-worker-client'

export async function runBasicPitch(audioBuffer, onProg) {
  const len = Math.ceil(audioBuffer.duration * 22050)
  const oc = new OfflineAudioContext(1, len, 22050)
  const s = oc.createBufferSource()
  s.buffer = audioBuffer
  s.connect(oc.destination)
  s.start()
  const mono = new Float32Array((await oc.startRendering()).getChannelData(0))
  return runAiTask('bp', { audio: mono, modelUrl: new URL('/models/basic-pitch/model.json', location.href).href }, [mono.buffer], { onProg, stallMs: 180000 })
}
