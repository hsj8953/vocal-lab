import type { Tier } from '@/lib/engine'

/** globals.css의 토큰과 같은 값 (캔버스는 CSS 변수를 직접 못 읽으므로 복제) */
export const PAL = {
  stage: 'oklch(0.158 0.03 254)',
  gutter: 'oklch(0.19 0.03 253)',
  laneBlack: 'oklch(1 0 0 / 0.028)',
  laneLine: 'oklch(1 0 0 / 0.045)',
  laneC: 'oklch(1 0 0 / 0.13)',
  barLine: 'oklch(1 0 0 / 0.06)',
  text: 'oklch(0.955 0.012 240)',
  textDim: 'oklch(0.74 0.028 248)',
  textFaint: 'oklch(0.56 0.03 250)',
  ice: 'oklch(0.93 0.02 235)',
  iceDim: 'oklch(0.93 0.02 235 / 0.34)',
  ink: 'oklch(0.2 0.03 252)',
  voice: 'oklch(0.82 0.125 205)',
  caution: 'oklch(0.83 0.15 80)',
  miss: 'oklch(0.7 0.17 25)',
  missTint: 'oklch(0.86 0.08 25)',
  rangeFill: 'oklch(0.82 0.125 205 / 0.06)',
  outFill: 'oklch(0.7 0.17 25 / 0.045)',
} as const

export const TIER_COLOR: Record<Tier, string> = {
  great: PAL.voice,
  ok: PAL.caution,
  off: PAL.miss,
}

export const SANS = '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif'

export function monoFamily(el: HTMLElement): string {
  const v = getComputedStyle(el).getPropertyValue('--font-jetbrains').trim()
  return `${v ? `${v}, ` : ''}ui-monospace, "SF Mono", "D2Coding", Menlo, Consolas, ${SANS}`
}

export interface CanvasBox {
  ctx: CanvasRenderingContext2D
  w: number
  h: number
}

/** 컨테이너 크기·DPR에 맞춰 캔버스를 세팅하고 그리기 컨텍스트를 돌려준다 */
export function fitCanvas(canvas: HTMLCanvasElement): CanvasBox | null {
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (!w || !h) return null
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const pw = Math.round(w * dpr)
  const ph = Math.round(h * dpr)
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw
    canvas.height = ph
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, w, h }
}

export function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = Math.min(h / 2, w / 2)
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}
