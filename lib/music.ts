export type Notation = 'scientific' | 'korean'

const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const SOLFEGE = ['도', '도♯', '레', '레♯', '미', '파', '파♯', '솔', '솔♯', '라', '라♯', '시']

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440)

/** 반올림한 반음 기준으로 음 이름을 만든다. G4 / 2옥 솔 */
export function noteName(midi: number, notation: Notation = 'scientific'): string {
  const r = Math.round(midi)
  const pc = ((r % 12) + 12) % 12
  const oct = Math.floor(r / 12) - 1
  if (notation === 'scientific') return `${SHARP[pc]}${oct}`
  return `${oct - 2}옥 ${SOLFEGE[pc]}`
}

/** 피아노 건반 눈금용 짧은 이름 (도 / C 만 옥타브 표기) */
export function laneLabel(midi: number, notation: Notation): string | null {
  const r = Math.round(midi)
  const pc = ((r % 12) + 12) % 12
  const oct = Math.floor(r / 12) - 1
  if (notation === 'scientific') {
    if (pc === 0 || pc === 4 || pc === 7) return `${SHARP[pc]}${oct}`
    return null
  }
  if (pc === 0) return `${oct - 2}옥 도`
  if (pc === 4) return '미'
  if (pc === 7) return '솔'
  return null
}

export const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(((Math.round(midi) % 12) + 12) % 12)

export function fmtTime(sec: number, decimals = 0): string {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  const r = s - m * 60
  const rs = decimals > 0 ? r.toFixed(decimals).padStart(3 + decimals - 1, '0') : String(Math.floor(r)).padStart(2, '0')
  return `${m}:${rs}`
}

export function fmtCents(c: number): string {
  const r = Math.round(c)
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r)}c`
}

export function fmtSigned(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0'
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
