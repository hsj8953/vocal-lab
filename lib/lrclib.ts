/**
 * LRCLIB (https://lrclib.net) — 무료로 공개된 싱크 가사 데이터베이스
 * 브라우저에서 바로 부를 수 있다 (Access-Control-Allow-Origin: *).
 * 권장 사항대로 앱 이름을 알리는 헤더를 보내고, 막히면 헤더 없이 다시 시도한다.
 */

export interface LrclibRecord {
  id: number
  trackName: string
  artistName: string
  albumName: string | null
  duration: number
  instrumental: boolean
  syncedLyrics: string | null
  plainLyrics: string | null
}

const BASE = 'https://lrclib.net/api'
const CLIENT = 'VOCAL-LAB v1 (https://github.com/hsj8953/vocal-lab)'

async function call(url: string): Promise<Response> {
  try {
    return await fetch(url, { headers: { 'Lrclib-Client': CLIENT } })
  } catch {
    // 브라우저가 사용자 지정 헤더를 막으면 헤더 없이
    return fetch(url)
  }
}

export async function searchLrclib(query: { q?: string; track?: string; artist?: string }): Promise<LrclibRecord[]> {
  const p = new URLSearchParams()
  if (query.q) p.set('q', query.q)
  if (query.track) p.set('track_name', query.track)
  if (query.artist) p.set('artist_name', query.artist)
  const res = await call(`${BASE}/search?${p}`)
  if (res.status === 429) throw new Error('LRCLIB 요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요.')
  if (!res.ok) throw new Error(`LRCLIB 검색에 실패했어요. (${res.status})`)
  return (await res.json()) as LrclibRecord[]
}

/** 곡 길이와 가까운 것, 싱크 가사가 있는 것을 먼저 */
export function rankRecords(list: LrclibRecord[], songDuration?: number): LrclibRecord[] {
  const score = (r: LrclibRecord) => {
    let s = 0
    if (r.syncedLyrics) s += 100
    if (r.instrumental) s -= 200
    if (songDuration) s -= Math.min(60, Math.abs(r.duration - songDuration)) * 2
    return s
  }
  return [...list].sort((a, b) => score(b) - score(a))
}

/** 파일 이름에서 검색어 만들기: 괄호, [MV], (COVER) 같은 꼬리표를 빼고 '-' 앞뒤를 가수/제목으로 */
export function guessQuery(fileTitle: string): string {
  return fileTitle
    .replace(/\.[^.]+$/, '')
    .replace(/[\[(【（][^\])】）]*[\])】）]/g, ' ')
    .replace(/\b(official|mv|m\/v|lyrics?|audio|cover|karaoke|instrumental|inst|vocals?|feat\.?.*)\b/gi, ' ')
    .replace(/[_|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
