export interface StretchNode extends AudioWorkletNode {
  schedule(o: { output?: number; active?: boolean; input?: number; rate?: number; semitones?: number; tonalityHz?: number; formantSemitones?: number; formantCompensation?: boolean; formantBaseHz?: number }): void
  start(when?: number): void
  stop(when?: number): void
  latency(): Promise<number>
  configure(o: { blockMs?: number | null; intervalMs?: number; splitComputation?: boolean; preset?: string }): void
}
export type SignalsmithStretchFn = (ctx: BaseAudioContext, opts?: AudioWorkletNodeOptions) => Promise<StretchNode>

/** 번들러가 건드리면 깨지는 코드라 public/vendor 원본을 실행할 때 불러온다 */
export async function loadSignalsmithStretch(): Promise<SignalsmithStretchFn> {
  const url = '/vendor/signalsmith-stretch.mjs'
  const m = (await import(/* webpackIgnore: true */ /* @vite-ignore */ url)) as { default: SignalsmithStretchFn }
  return m.default
}
