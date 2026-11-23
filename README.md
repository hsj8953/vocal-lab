# VOCAL·LAB

원곡에서 보컬 멜로디를 노트로 뽑고, 내 음역에 맞는 키를 찾아, 부르는 동안 실시간으로 음정을 비교하는 보컬 트레이닝 웹앱.

- 화면: v0로 만든 Next.js + Tailwind + shadcn/ui
- 분석 엔진: `lib/real/` (브라우저에서 전부 처리, 서버로 파일을 보내지 않음)

## 실행

```bash
pnpm install
pnpm dev   # http://localhost:3000
```

마이크는 `https://` 주소나 `localhost`에서만 켜져요. (v0 미리보기 창 안에서는 막힐 수 있어요. 배포 주소를 새 탭에서 여세요.)

## 입력 파일과 분석 방식

| 넣은 파일 | 분석 방식 |
| --- | --- |
| 원곡만 | 원곡 전체에서 가장 두드러진 멜로디 (반주가 섞일 수 있음) |
| 원곡 + MR | MR과 시간을 맞춘 뒤, MR에는 없고 원곡에만 있는 소리(=보컬) 구간만 |
| 원곡 + 분리된 보컬 | 보컬 음 높이 + Basic Pitch AI 노트 경계 + 음절 나누기 + 실제 발음 길이 맞추기 |
| 원곡만 + "AI로 분리하기" 켬 | 브라우저에서 UVR5 Kim_Vocal_2로 보컬을 분리한 뒤 위와 같이 분석. 반주(원곡 − 보컬)는 MR로 재생 |
| + 노트 파일(.mid / Tony .csv) | 파일 노트를 그대로 쓰고, 시간·옥타브를 자동으로 맞추고, 빈 곳은 분석 결과로 채움 |

직접 편집한 노트는 원곡 파일별로 브라우저(IndexedDB)에 자동 저장되고, 같은 파일을 다시 열면 복원돼요.
AI 결과(Basic Pitch, CREPE)도 곡마다 처음 한 번만 계산하고 저장해요.

## 엔진 구조 (`lib/real/`)

| 파일 | 내용 |
| --- | --- |
| `core.js` | FFT, 위상 보코더 키 변경, YIN, 멜로디 추출(배음 합산 + Viterbi + 옥타브 보정), MR/원곡 정렬, Basic Pitch 결합, MIDI/Tony 파서, 음절 경계 |
| `song.js` | 전체 파이프라인, 디코딩·결과 캐시, MR 시간 맞춤, 원곡/MR 음량 맞춤, 편집 저장 |
| `crepe.js` | CREPE 신경망 음 높이 추정 (tiny / small / medium) |
| `basic-pitch.js` | Spotify Basic Pitch 노트 경계 |
| `separate.js` | UVR5 MDX-Net 보컬 분리 (onnxruntime-web, WebGPU → WASM). STFT/iSTFT는 UVR5와 같은 방식(파이썬 원본과 상관계수 0.99999998로 일치 확인) |

`lib/engine.ts`는 UI가 쓰는 인터페이스예요. 데모 곡은 목업, 사용자 파일은 `lib/real/`로 처리해요.

## 모델 (`public/models/`)

- `basic-pitch/` — Spotify Basic Pitch (Apache-2.0)
- `uvr/Kim_Vocal_2.onnx` — Ultimate Vocal Remover(UVR5, MIT, github.com/Anjok07/ultimatevocalremovergui)의 MDX-Net 보컬 모델. 모델 제작 Kimberley Jensen · UVR 팀
- `crepe-tiny/`, `crepe-small/`, `crepe-medium/` — CREPE (MIT, github.com/marl/crepe). 공식 Keras 가중치를 TensorFlow.js 형식으로 변환

## 크레딧

- Ultimate Vocal Remover GUI — Anjok07, aufr33 외 (MIT)
- Kim_Vocal_2 모델 — Kimberley Jensen
- CREPE — Jong Wook Kim 외 (MIT)
- Basic Pitch — Spotify (Apache-2.0)
- onnxruntime-web — Microsoft (MIT), TensorFlow.js — Google (Apache-2.0)

마이크와 AI 분리 속도를 위해 사이트는 cross-origin isolation 헤더(COOP/COEP)를 보내요 (`next.config.mjs`).
