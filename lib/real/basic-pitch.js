// @ts-nocheck
/* Spotify Basic Pitch — 노트 시작/끝(경계)을 찾는 AI. 결과는 [시작, 끝, midi, 세기] 배열 */
import { loadTf } from './tf'

const modelP = {}

export async function runBasicPitch(audioBuffer, onProg) {
  const tf = await loadTf('bp')
  const { BasicPitch, outputToNotesPoly, noteFramesToTime } = await import('@spotify/basic-pitch')
  const k = tf.getBackend()
  if (!modelP[k]) modelP[k] = tf.loadGraphModel('/models/basic-pitch/model.json')
  const len = Math.ceil(audioBuffer.duration * 22050)
  const oc = new OfflineAudioContext(1, len, 22050)
  const s = oc.createBufferSource()
  s.buffer = audioBuffer
  s.connect(oc.destination)
  s.start()
  const mono = (await oc.startRendering()).getChannelData(0)
  const bp = new BasicPitch(modelP[k])
  const frames = []
  const onsets = []
  await bp.evaluateModel(
    mono,
    (f, o) => {
      frames.push(...f)
      onsets.push(...o)
    },
    (p) => onProg && onProg(p),
  )
  const notes = noteFramesToTime(outputToNotesPoly(frames, onsets, 0.5, 0.3, 7, true, 1600, 100, true))
  return notes.map((n) => [n.startTimeSeconds, n.startTimeSeconds + n.durationSeconds, n.pitchMidi, n.amplitude])
}
