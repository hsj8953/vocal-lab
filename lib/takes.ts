/**
 * 곡마다 연습 녹음 보관 (IndexedDB 'vocallab-takes').
 * - 가장 최근 녹음 1개는 자동으로 남는다.
 * - 나머지는 사용자가 ⭐(보관)한 것만 남고, 새로 연습하면 보관 안 한 옛 녹음은 지워진다.
 * 목록을 가볍게 보려고 정보(meta)와 소리·기록(data)을 따로 둔다.
 */
import type { SessionStats } from './engine'

export interface TakeMeta {
  id: string
  songId: string
  at: number
  starred: boolean
  score: number
  keyShift: number
  /** 녹음한 배속 */
  rate: number
  span: { t0: number; t1: number } | null
  /** 녹음 길이(초) */
  dur: number
}

export interface TakeData {
  id: string
  session: SessionStats
  take: { t0: number; sr: number; rate: number; pcm: Int16Array }
  trace: { t: number; midi: number | null; tier: string | null }[] | null
}

const DB = 'vocallab-takes'
let dbP: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if (!dbP)
    dbP = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1)
      r.onupgradeneeded = () => {
        const d = r.result
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' }).createIndex('song', 'songId')
        if (!d.objectStoreNames.contains('data')) d.createObjectStore('data', { keyPath: 'id' })
      }
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
  return dbP
}

function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest | void): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((res, rej) => {
        const t = d.transaction(stores, mode)
        const r = fn(t)
        t.oncomplete = () => res((r ? r.result : undefined) as T)
        t.onerror = () => rej(t.error)
        t.onabort = () => rej(t.error)
      }),
  )
}

export const toPcm = (f: Float32Array): Int16Array => {
  const o = new Int16Array(f.length)
  for (let i = 0; i < f.length; i++) o[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767)))
  return o
}
export const fromPcm = (p: Int16Array): Float32Array => {
  const o = new Float32Array(p.length)
  for (let i = 0; i < p.length; i++) o[i] = p[i] / 32767
  return o
}

/** 곡의 녹음 목록 (최신 먼저) */
export async function listTakes(songId: string): Promise<TakeMeta[]> {
  try {
    const all = await tx<TakeMeta[]>(['meta'], 'readonly', (t) => t.objectStore('meta').index('song').getAll(songId))
    return (all ?? []).sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}

export async function loadTake(id: string): Promise<{ meta: TakeMeta; data: TakeData } | null> {
  try {
    const meta = await tx<TakeMeta | undefined>(['meta'], 'readonly', (t) => t.objectStore('meta').get(id))
    const data = await tx<TakeData | undefined>(['data'], 'readonly', (t) => t.objectStore('data').get(id))
    return meta && data ? { meta, data } : null
  } catch {
    return null
  }
}

/** 새 녹음 저장 — 이 곡에서 보관(⭐) 안 한 다른 녹음은 지운다 */
export async function saveLatest(meta: TakeMeta, data: TakeData): Promise<boolean> {
  try {
    const old = (await listTakes(meta.songId)).filter((m) => m.id !== meta.id && !m.starred)
    await tx(['meta', 'data'], 'readwrite', (t) => {
      t.objectStore('meta').put(meta)
      t.objectStore('data').put(data)
      for (const m of old) {
        t.objectStore('meta').delete(m.id)
        t.objectStore('data').delete(m.id)
      }
    })
    return true
  } catch {
    return false
  }
}

export async function setStar(id: string, starred: boolean): Promise<void> {
  const m = await tx<TakeMeta | undefined>(['meta'], 'readonly', (t) => t.objectStore('meta').get(id))
  if (m) await tx(['meta'], 'readwrite', (t) => void t.objectStore('meta').put({ ...m, starred }))
}

export async function deleteTake(id: string): Promise<void> {
  await tx(['meta', 'data'], 'readwrite', (t) => {
    t.objectStore('meta').delete(id)
    t.objectStore('data').delete(id)
  })
}

export async function deleteSongTakes(songId: string): Promise<void> {
  const list = await listTakes(songId)
  if (!list.length) return
  await tx(['meta', 'data'], 'readwrite', (t) => {
    for (const m of list) {
      t.objectStore('meta').delete(m.id)
      t.objectStore('data').delete(m.id)
    }
  })
}
