/**
 * 새로고침해도 이 탭의 상태를 유지하기 — 탭을 닫으면 사라진다.
 *
 * - 화면·곡·키·배속·재생 위치 같은 작은 값은 sessionStorage (탭마다 따로, 새로고침해도 남음)
 * - 마지막 연습(채점 기록·녹음·다시 보기 선)은 크기가 커서 IndexedDB에 탭 id로 저장하고,
 *   닫힌 탭의 것은 다음에 사이트를 열 때 지운다
 */
import type { SessionStats } from './engine'

const TAB_KEY = 'vocallab-tab'
const ID_KEY = 'vocallab-tab-id'

export function tabId(): string {
  try {
    let id = sessionStorage.getItem(ID_KEY)
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      sessionStorage.setItem(ID_KEY, id)
    }
    return id
  } catch {
    return 'no-session'
  }
}

export interface TabState {
  view: string
  railTab: string
  /** 열어 둔 곡 (내 곡 목록 id), 데모면 null */
  songId: string | null
  keyShift: number
  octaveMode: string | number
  source: string
  speed: number
  pos: number
  loop: { a: number; b: number; label?: string } | null
}

export function readTab(): TabState | null {
  try {
    const v = sessionStorage.getItem(TAB_KEY)
    return v ? (JSON.parse(v) as TabState) : null
  } catch {
    return null
  }
}

export function writeTab(t: TabState) {
  try {
    sessionStorage.setItem(TAB_KEY, JSON.stringify(t))
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
}

/* ------------------------------------------------------------------ */
/* 마지막 연습 (IndexedDB)                                                */
/* ------------------------------------------------------------------ */

export interface PracticeRecord {
  tab: string
  savedAt: number
  songId: string | null
  session: SessionStats
  span: { t0: number; t1: number } | null
  take: { t0: number; sr: number; rate: number; data: Float32Array } | null
  trace: { t: number; midi: number | null; tier: string | null }[] | null
  /** 곡에 저장된 녹음이면 그 id */
  takeId?: string | null
}

const DB = 'vocallab-session'
const STORE = 'practice'
let dbP: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if (!dbP)
    dbP = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1)
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'tab' })
      }
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
  return dbP
}
function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((res, rej) => {
        const tx = d.transaction(STORE, mode)
        const r = fn(tx.objectStore(STORE))
        tx.oncomplete = () => res(r.result as T)
        tx.onerror = () => rej(tx.error)
        tx.onabort = () => rej(tx.error)
      }),
  )
}

export async function savePractice(rec: Omit<PracticeRecord, 'tab' | 'savedAt'>) {
  try {
    await run('readwrite', (s) => s.put({ ...rec, tab: tabId(), savedAt: Date.now() }))
  } catch {
    /* 공간이 없으면 저장하지 않는다 */
  }
}

export async function loadPractice(): Promise<PracticeRecord | null> {
  try {
    return (await run<PracticeRecord | undefined>('readonly', (s) => s.get(tabId()))) ?? null
  } catch {
    return null
  }
}

export async function clearPractice() {
  try {
    await run('readwrite', (s) => s.delete(tabId()))
  } catch {
    /* 무시 */
  }
}

/**
 * 닫힌 탭이 남긴 연습 기록 지우기 — 다른 탭이 열려 있을 수 있으니
 * 이 탭 것이 아니고 하루 넘게 지난 것만 지운다
 */
export async function cleanupPractice() {
  try {
    const me = tabId()
    const all = await run<PracticeRecord[]>('readonly', (s) => s.getAll())
    const old = (all ?? []).filter((r) => r.tab !== me && Date.now() - r.savedAt > 24 * 3600 * 1000)
    for (const r of old) await run('readwrite', (s) => s.delete(r.tab))
  } catch {
    /* 무시 */
  }
}
