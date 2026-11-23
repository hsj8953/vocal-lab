'use client'

import { ArrowDown, ArrowUp, Download, Merge, MousePointer2, Plus, Redo2, Scissors, Trash2, Undo2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useStudio } from './studio-provider'
import { Kbd, Section, Seg } from './ui-bits'

export function RailEdit() {
  const { s, a } = useStudio()
  const n = s.selection.length

  return (
    <div>
      <Section title="도구">
        <Seg
          label="편집 도구"
          className="w-full"
          value={s.tool}
          onChange={(v) => a.setTool(v)}
          options={[
            { value: 'select', label: <Tool icon={<MousePointer2 />} text="선택" k="V" /> },
            { value: 'add', label: <Tool icon={<Plus />} text="추가" k="A" /> },
            { value: 'cut', label: <Tool icon={<Scissors />} text="자르기" k="C" /> },
          ]}
        />
        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
          {s.tool === 'select' && '노트를 눌러 선택하고 끌어서 옮겨요. 양 끝을 끌면 길이가 바뀌어요. Shift+클릭으로 여러 개 선택.'}
          {s.tool === 'add' && '빈 곳을 끌어서 새 노트를 그려요. 클릭만 하면 0.4초 노트가 만들어져요.'}
          {s.tool === 'cut' && '자를 노트 위를 클릭하세요. 클릭한 지점에서 둘로 나뉘어요.'}
        </p>
      </Section>

      <Section title="선택한 노트" hint={n ? `${n}개 선택됨` : '선택 없음'}>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" disabled={!n} onClick={() => a.nudgeSelected({ pitch: 1 })}>
            <ArrowUp /> 반음 올리기
          </Button>
          <Button variant="outline" size="sm" disabled={!n} onClick={() => a.nudgeSelected({ pitch: -1 })}>
            <ArrowDown /> 반음 내리기
          </Button>
          <Button variant="outline" size="sm" disabled={!n} onClick={() => a.nudgeSelected({ dur: 0.1 })}>
            길이 +0.1초
          </Button>
          <Button variant="outline" size="sm" disabled={!n} onClick={() => a.nudgeSelected({ dur: -0.1 })}>
            길이 −0.1초
          </Button>
          <Button variant="outline" size="sm" disabled={n < 2} onClick={a.mergeSelected}>
            <Merge /> 합치기 <Kbd>M</Kbd>
          </Button>
          <Button variant="outline" size="sm" onClick={a.splitAtPlayhead}>
            <Scissors /> 재생 위치에서 자르기
          </Button>
        </div>
        {n === 1 ? <LyricInput key={s.selection[0]} /> : null}
        <Button variant="destructive" size="sm" className="mt-2 w-full" disabled={!n} onClick={a.deleteSelected}>
          <Trash2 /> 삭제 <Kbd>Del</Kbd>
        </Button>
      </Section>

      <Section title="기록">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="sm" disabled={!s.past.length} onClick={a.undo}>
            <Undo2 /> 되돌리기
          </Button>
          <Button variant="secondary" size="sm" disabled={!s.future.length} onClick={a.redo}>
            <Redo2 /> 다시 실행
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          <Kbd>Ctrl</Kbd> + <Kbd>Z</Kbd> / <Kbd>Shift</Kbd> + <Kbd>Z</Kbd> · 변경 {s.past.length}회
        </p>
      </Section>

      <Section title="저장">
        <Button className="w-full" onClick={a.exportCsv}>
          <Download /> 노트 CSV로 저장
        </Button>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Tony 형식(시작초, 주파수Hz, 길이초, 가사)이라 다시 불러오거나 다른 도구에서 열 수 있어요.</p>
      </Section>
    </div>
  )
}

function Tool({ icon, text, k }: { icon: ReactNode; text: string; k: string }) {
  return (
    <span className="flex items-center justify-center gap-1.5 [&_svg]:size-3.5">
      {icon}
      {text}
      <span className="hidden font-mono text-[9px] opacity-60 sm:inline">{k}</span>
    </span>
  )
}

/** 선택한 노트 하나의 가사 고치기 */
function LyricInput() {
  const { s, a } = useStudio()
  const note = s.notes.find((x) => x.id === s.selection[0])
  const [v, setV] = useState(note?.lyric ?? '')
  if (!note) return null
  return (
    <form
      className="mt-2 flex gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        a.setNoteLyric(note.id, v.trim())
      }}
    >
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v.trim() !== (note.lyric ?? '') && a.setNoteLyric(note.id, v.trim())}
        placeholder="이 노트의 가사 (예: 로, ~)"
        aria-label="노트 가사"
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background/60 px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Button type="submit" size="sm" variant="secondary">
        가사 저장
      </Button>
    </form>
  )
}
