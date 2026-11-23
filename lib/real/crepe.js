// @ts-nocheck
/**
 * CREPE (Kim et al., 2018) — 노래·악기 단선율용으로 학습된 음 높이 추정 신경망.
 * 공식 가중치(github.com/marl/crepe, MIT)를 TensorFlow.js 형식으로 변환해 /public/models 에 넣었다.
 *
 * 입력: 16 kHz 모노. 출력 프레임은 기본 분석기(melody.js)와 같은 간격(256 샘플 = 16 ms)과
 * 같은 중심(프레임 i → 샘플 i·256 + 1024)을 쓴다. 그래서 두 결과를 프레임 단위로 바로 비교할 수 있다.
 */
import { runAiTask } from './ai-worker-client'

export const CREPE_MODELS = {
  tiny: { label: '아주 가벼움', path: '/models/crepe-tiny/model.json', mb: 2 },
  small: { label: '가벼움', path: '/models/crepe-small/model.json', mb: 6.5 },
  medium: { label: '정밀', path: '/models/crepe-medium/model.json', mb: 23.5 },
}

/**
 * @param x Float32Array 16 kHz 모노 (원곡 시간축)
 * @returns { midi: Float32Array(NaN=없음), conf: Float32Array }
 * 계산은 Web Worker에서 한다 (화면이 멈추지 않게)
 */
export async function runCrepe(x, name = 'small', onProg, onStage) {
  const audio = new Float32Array(x)
  return runAiTask(
    'crepe',
    {
      audio,
      modelUrl: new URL(CREPE_MODELS[name].path, location.href).href,
      wasmBase: new URL('/tfjs/', location.href).href,
    },
    [audio.buffer],
    { onProg, onStage, stallMs: 180000 },
  )
}
