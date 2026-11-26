'use client'

import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { realSepDiag } from '@/lib/engine'
import { useStudio } from './studio-provider'

/** AI 분리가 CPU로 도는 이유 + 그래픽카드 이름 + 복사 버튼 + 강제 시도 스위치 */
export function SepReason({ running }: { running?: boolean }) {
  const { s, a } = useStudio()
  const d = realSepDiag()
  const [copied, setCopied] = useState(false)
  const ran = d.ep !== null
  const cpu = ran && d.ep !== 'webgpu'
  const copy = async () => {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
    const text = [`분리 장치: ${!ran ? '아직 안 함' : d.ep === 'webgpu' ? '그래픽카드' : 'CPU'}`, `그래픽카드: ${d.gpu || '알 수 없음'}`, `이유: ${d.reason || '없음'}`, `그래픽카드 강제 시도: ${s.analysis.forceGpu ? '켬' : '끔'}`, `브라우저: ${ua}`].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      a.notify('복사하지 못했어요. 글자를 직접 드래그해서 복사해 주세요.')
    }
  }
  return (
    <div className="rounded-lg border border-border p-2.5 text-[11px] leading-relaxed">
      <p className="font-medium text-foreground">
        분리 장치:{' '}
        {!ran ? <span className="text-muted-foreground">이번에 연 뒤로 아직 분리하지 않았어요</span> : d.ep === 'webgpu' ? <span className="text-voice">그래픽카드 (빠름)</span> : <span className="text-caution">CPU (느림)</span>}
      </p>
      {d.gpu ? <p className="break-words text-muted-foreground">그래픽카드: {d.gpu}</p> : null}
      {cpu && d.reason ? <p className="mt-1 break-words whitespace-pre-wrap text-caution">이유: {d.reason}</p> : null}
      {ran && d.ep === 'webgpu' && d.reason ? <p className="mt-1 break-words text-muted-foreground">{d.reason}</p> : null}
      {ran ? (
        <Button size="xs" variant="outline" className="mt-2" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />} {copied ? '복사했어요' : '이유 복사'}
        </Button>
      ) : null}
      <label htmlFor={running ? 'forcegpu-run' : 'forcegpu'} className="mt-2 flex items-center justify-between gap-3 text-muted-foreground">
        <span>
          그래픽카드로 강제 시도
          <span className="block text-[10px]">
            소프트웨어 그래픽으로 판단돼 CPU를 쓸 때 켜 보세요. 오류가 나면 자동으로 CPU로 돌아가요.{running ? ' 지금 분리가 끝난 뒤 다음 분리부터 적용돼요.' : ''}
          </span>
        </span>
        <Switch id={running ? 'forcegpu-run' : 'forcegpu'} checked={s.analysis.forceGpu} onCheckedChange={(v) => a.setForceGpu(!!v)} />
      </label>
    </div>
  )
}
