/**
 * 내 곡 목록 — 곡에 쓴 파일(원곡·MR·보컬·노트 파일·가사)과 곡별 설정을 브라우저(IndexedDB)에 저장한다.
 * 편집한 노트·가사·분석 결과는 원래대로 원곡 파일 기준으로 따로 저장되므로, 같은 파일을 다시 넣으면 그대로 돌아온다.
 */

export type LibKind = 'original' | 'mr' | 'vocal' | 'noteFile' | 'lyrics'

export interface LibFile {
  name: string
  type: string
  lastModified: number
  blob: Blob
}

export interface LibSettings {
  keyShift: number
  /** MR을 손으로 밀었을 때의 오프셋(ms) */
  mrOffsetMs?: number
  /** 듀엣 모드 파트 */
  duet?: { style: 'section' | 'phrase' | 'chorus'; parts: { t0: number; t1: number; who: 'orig' | 'me' | 'both' }[] }
}

export interface LibSong {
  id: string
  /** 목록에 보이는 이름 (바꿀 수 있음) */
  title: string
  /** 연습 기록 키에 쓰는 이름 (원곡 파일 이름) */
  projTitle: string
  duration: number
  created: number
  updated: number
  opened: number
  bytes: number
  files: Partial<Record<LibKind, LibFile>>
  settings: LibSettings
}

const DB = 'vocallab-library'
const STORE = 'songs'
let dbP: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  if (!dbP)
    dbP = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1)
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' })
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

/** 곡 id — 원곡(없으면 노트 파일·MR) 파일 이름과 크기 */
export const songIdOf = (f: { name: string; size: number } | undefined) => (f ? `song|${f.name}|${f.size}` : '')

export async function listSongs(): Promise<LibSong[]> {
  try {
    const all = await run<LibSong[]>('readonly', (s) => s.getAll())
    return (all ?? []).sort((a, b) => b.opened - a.opened)
  } catch {
    return []
  }
}

export async function getSong(id: string): Promise<LibSong | null> {
  try {
    return (await run<LibSong | undefined>('readonly', (s) => s.get(id))) ?? null
  } catch {
    return null
  }
}

export async function putSong(song: LibSong): Promise<void> {
  await run('readwrite', (s) => s.put(song))
}

export async function deleteSong(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id))
}

export async function patchSong(id: string, patch: (s: LibSong) => LibSong): Promise<void> {
  const cur = await getSong(id)
  if (cur) await putSong(patch(cur))
}

export const toLibFile = (f: File): LibFile => ({ name: f.name, type: f.type, lastModified: f.lastModified, blob: f })
export const fromLibFile = (f: LibFile): File => new File([f.blob], f.name, { type: f.type, lastModified: f.lastModified })

/** 브라우저가 공간이 모자랄 때 지우지 않도록 요청 */
export async function requestPersist(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

/** 사이트가 쓰는 저장 공간 */
export async function storageUsage(): Promise<{ used: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.()
    return e ? { used: e.usage ?? 0, quota: e.quota ?? 0 } : null
  } catch {
    return null
  }
}
