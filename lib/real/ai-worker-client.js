// @ts-nocheck
/**
 * AI 워커 실행 도우미 — 진행률을 받고, 일정 시간 동안 아무 진행이 없으면 멈춘 것으로 보고 중단한다
 * (끝없이 "0%"에 멈춰 있는 대신 오류로 알려서 기본 분석기로 넘어가게)
 */
export function runAiTask(task, payload, transfer, { onProg, onStage, stallMs = 120000 } = {}) {
  const worker = new Worker(new URL('./ai.worker.js', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    let timer = null
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        worker.terminate()
        reject(new Error(`${stallMs / 1000}초 동안 진행이 없어서 멈췄어요`))
      }, stallMs)
    }
    const done = (fn, v) => {
      clearTimeout(timer)
      worker.terminate()
      fn(v)
    }
    arm()
    worker.onmessage = (e) => {
      const m = e.data
      if (m.type === 'progress') {
        arm()
        onProg && onProg(m.p)
      } else if (m.type === 'stage') {
        arm()
        onStage && onStage(m.stage)
      } else if (m.type === 'backend') {
        console.info(`[VOCAL·LAB] ${task} backend (worker):`, m.backend)
        onStage && onStage('backend:' + m.backend)
      } else if (m.type === 'done') done(resolve, m.result)
      else if (m.type === 'error') done(reject, new Error(m.message))
    }
    worker.onerror = (e) => done(reject, new Error(e.message || 'AI 워커 오류'))
    worker.postMessage({ task, ...payload }, transfer)
  })
}
