'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SegOption<T extends string | number> {
  value: T
  label: ReactNode
  title?: string
}

export function Seg<T extends string | number>({
  options,
  value,
  onChange,
  label,
  className,
  size = 'md',
}: {
  options: SegOption<T>[]
  value: T
  onChange: (v: T) => void
  label: string
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-lg bg-muted/60 p-0.5', className)}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex-1 rounded-md font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
              on ? 'bg-foreground text-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Section({ title, hint, action, children, className }: { title: string; hint?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('border-b border-border px-4 py-4 last:border-b-0', className)}>
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h3>
        {action ?? (hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null)}
      </header>
      {children}
    </section>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{children}</kbd>
}
