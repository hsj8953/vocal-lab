// @ts-nocheck
/* 아주 작은 IndexedDB 래퍼 — AI 결과 캐시와 직접 편집한 노트 저장용 */
const STORES = ['bp', 'ai', 'edits']
let dbP = null
function open() {
  if (!dbP)
    dbP = new Promise((res, rej) => {
      const r = indexedDB.open('vocallab-next', 1)
      r.onupgradeneeded = () => STORES.forEach((s) => r.result.objectStoreNames.contains(s) || r.result.createObjectStore(s))
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
  return dbP
}
const req = (r) => new Promise((res) => {
  r.onsuccess = () => res(r.result ?? null)
  r.onerror = () => res(null)
})
export const idb = {
  async get(store, k) {
    try {
      return await req((await open()).transaction(store).objectStore(store).get(k))
    } catch (e) {
      return null
    }
  },
  async set(store, k, v) {
    try {
      return await req((await open()).transaction(store, 'readwrite').objectStore(store).put(v, k))
    } catch (e) {
      return null
    }
  },
  async del(store, k) {
    try {
      return await req((await open()).transaction(store, 'readwrite').objectStore(store).delete(k))
    } catch (e) {
      return null
    }
  },
}
