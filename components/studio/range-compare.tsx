'use client'

import { noteName, type Notation } from '@/lib/music'

interface Span {
  label: string
  low: number
  high: number
  coreLow?: number
  coreHigh?: number
  tone: 'ice' | 'voice'
}

/** 두 개 이상의 음역 막대를 같은 눈금 위에 나란히 보여준다 */
export function RangeCompare({ spans, notation, note }: { spans: Span[]; notation: Notation; note?: string }) {
  const lo = Math.floor(Math.min(...spans.map((s) => s.low)) - 1)
  const hi = Math.ceil(Math.max(...spans.map((s) => s.high)) + 1)
  const pct = (m: number) => ((m - lo) / (hi - lo)) * 100
  const ticks: number[] = []
  for (let m = Math.ceil(lo / 12) * 12; m <= hi; m += 12) ticks.push(m)
  for (let m = Math.ceil((lo - 7) / 12) * 12 + 7; m <= hi; m += 12) if (m >= lo) ticks.push(m)

  return (
    <div>
      <div className="relative">
        {ticks.map((m) => (
          <div key={m} className="absolute top-0 bottom-5 w-px bg-border" style={{ left: `${pct(m)}%` }}>
            <span className="absolute top-full mt-1 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] text-muted-foreground">{noteName(m, notation)}</span>
          </div>
        ))}
        <ul className="relative flex flex-col gap-3 pb-6">
          {spans.map((sp) => (
            <li key={sp.label} className="relative">
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="font-medium text-foreground">{sp.label}</span>
                <span className="font-mono text-[11px] text-muted-foreground tabular">
                  {noteName(sp.low, notation)} – {noteName(sp.high, notation)} · {Math.round(sp.high - sp.low)}반음
                </span>
              </div>
              <div className="relative h-4 rounded-full bg-muted/50">
                <div
                  className={`absolute inset-y-0 rounded-full ${sp.tone === 'voice' ? 'bg-voice/35' : 'bg-foreground/25'}`}
                  style={{ left: `${pct(sp.low)}%`, width: `${pct(sp.high) - pct(sp.low)}%` }}
                />
                {sp.coreLow !== undefined && sp.coreHigh !== undefined ? (
                  <div
                    className={`absolute inset-y-0.5 rounded-full ${sp.tone === 'voice' ? 'bg-voice' : 'bg-foreground'}`}
                    style={{ left: `${pct(sp.coreLow)}%`, width: `${Math.max(1, pct(sp.coreHigh) - pct(sp.coreLow))}%` }}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
      {note ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{note}</p> : null}
    </div>
  )
}
