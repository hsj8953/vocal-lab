'use client'

import { useState, type ReactElement, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * 되돌릴 수 없는 일(지우기 등)을 하기 전에 한 번 더 묻는 버튼.
 * trigger는 그대로 보이고, 누르면 확인 창이 뜬다. '취소'에 처음 초점이 간다.
 */
export function ConfirmButton({
  trigger,
  title,
  desc,
  confirmLabel = '지우기',
  onConfirm,
  side = 'bottom',
  align = 'end',
}: {
  trigger: ReactElement
  title: string
  desc?: ReactNode
  confirmLabel?: string
  onConfirm: () => void
  side?: 'top' | 'bottom'
  align?: 'start' | 'center' | 'end'
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent side={side} align={align} className="w-72" role="alertdialog" aria-label={title}>
        <p className="text-sm font-semibold">{title}</p>
        {desc ? <p className="text-xs leading-relaxed text-muted-foreground">{desc}</p> : null}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" autoFocus onClick={() => setOpen(false)}>
            취소
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              setOpen(false)
              onConfirm()
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
