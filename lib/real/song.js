// @ts-nocheck
/* eslint-disable */
/**
 * VOCAL·LAB 실제 분석 파이프라인 (브라우저 전용)
 *
 * 원곡 / MR / 분리된 보컬 / 노트 파일을 받아서
 *   디코딩 → MR·보컬 시간 정렬 → 피치 트래킹(기본 / CREPE) → 노트 분할
 *   → AI 노트 경계(Basic Pitch) 결합 → 빈 구간 채우기 → 노트 파일 적용
 *   → 음절 나누기 → 노트 길이를 실제 발음에 맞추기 → 직접 편집한 노트 복원
 * 을 수행한다. 무거운 결과(디코딩, AI 결과)는 메모리와 IndexedDB에 캐시한다.
 */
import * as core from './core'
import { runCrepe, CREPE_MODELS } from './crepe'
import { runBasicPitch } from './basic-pitch'
import { idb } from './idb'
import { separateVocals, SEP_MODEL } from './separate'

export const SR = 16000
export const MEL_T0 = 1024 / 16000 // 분석 프레임 중심

/* ------------------------------------------------------------------ */
/* 오디오 컨텍스트 · 디코딩                                               */
/* ------------------------------------------------------------------ */

let actx = null
export function audioCtx() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' })
  if (actx.state === 'suspended') actx.resume().catch(() => {})
  return actx
}

export const fileKey = (f) => (f ? `${f.name}|${f.size}` : '')

const decoded = new Map() // fileKey -> { file, buf, L, R, M, loud }

async function to16k(buf) {
  const len = Math.ceil(buf.duration * SR)
  const oc = new OfflineAudioContext(2, len, SR)
  const s = oc.createBufferSource()
  s.buffer = buf
  s.connect(oc.destination)
  s.start()
  const r = await oc.startRendering()
  const L = r.getChannelData(0)
  const R = r.getChannelData(1)
  const M = new Float32Array(len)
  for (let i = 0; i < len; i++) M[i] = 0.5 * (L[i] + R[i])
  return { L, R, M }
}

/** 게이트 RMS (LUFS 비슷한 방식) — 원곡과 MR 음량 맞추기용 */
function loudness(x) {
  const B = 6400
  const en = []
  for (let i = 0; i + B <= x.length; i += B / 2) {
    let s = 0
    for (let j = i; j < i + B; j++) s += x[j] * x[j]
    en.push(s / B)
  }
  let g = en.filter((e) => e > 1e-5)
  if (!g.length) return 1e-3
  const mean = g.reduce((a, b) => a + b, 0) / g.length
  g = g.filter((e) => e > mean * 0.1)
  return Math.sqrt(g.reduce((a, b) => a + b, 0) / g.length)
}

async function decode(file) {
  const k = fileKey(file)
  if (decoded.has(k)) return decoded.get(k)
  let buf
  try {
    buf = await audioCtx().decodeAudioData(await file.arrayBuffer())
  } catch (e) {
    throw new Error(`‘${file.name}’ 파일을 열 수 없어요. mp3 · wav · m4a · flac 파일인지 확인해 주세요.`)
  }
  const { L, R, M } = await to16k(buf)
  const d = { file, buf, L, R, M, loud: loudness(M) }
  decoded.set(k, d)
  if (decoded.size > 6) decoded.delete(decoded.keys().next().value)
  return d
}

function shiftArr(a, sec, len) {
  // 원곡 시간축으로 옮긴다: out[t] = a[t + sec]
  if (!sec) return a.length === len ? a : shiftArr(a, 1e-9, len)
  const d = Math.round(sec * SR)
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const j = i + d
    if (j >= 0 && j < a.length) out[i] = a[j]
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 현재 곡 상태                                                          */
/* ------------------------------------------------------------------ */

export const SONG = {
  orig: null,
  mr: null,
  voc: null,
  /** MR이 원곡보다 늦게 시작하면 + (초). 원곡 시간 t ↔ MR 시간 t + offset */
  mrAlign: null, // { offset, conf, manual, key }
  vocOffset: 0,
  noteFile: null, // { key, name, all, notes, lag, oct, sc, track, ntr }
  melCache: new Map(),
  lastInfo: null,
  /** AI로 분리한 보컬 { key, voc, sr, L, R, meta } */
  sep: null,
}

export function hasRealSong() {
  return !!SONG.orig || !!SONG.mr
}

export function resetSong() {
  SONG.orig = SONG.mr = SONG.voc = null
  SONG.mrAlign = null
  SONG.vocOffset = 0
  SONG.noteFile = null
  SONG.sep = null
  SONG.lastMel = null
  SONG.melCache.clear()
  trackCache.clear()
}

/* ------------------------------------------------------------------ */
/* AI 보컬 분리 결과를 '분리된 보컬 파일'처럼 쓰기                           */
/* ------------------------------------------------------------------ */

const toI16 = (f) => {
  const o = new Int16Array(f.length)
  for (let i = 0; i < f.length; i++) o[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767)))
  return o
}
const toF32 = (a) => {
  const o = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) o[i] = a[i] / 32767
  return o
}

async function getSeparated(orig, prog) {
  const key = 'sep|' + SEP_MODEL.id + '|' + fileKey(orig.file)
  if (SONG.sep && SONG.sep.key === key) return SONG.sep.voc
  let L, R, sr, meta
  const saved = await idb.get('ai', key)
  if (saved) {
    sr = saved.sr
    L = toF32(saved.L)
    R = toF32(saved.R)
    meta = { ...saved.meta, cached: true }
  } else {
    prog('AI 보컬 분리 준비 중', 0)
    const r = await separateVocals(orig.buf, (p, stage) => prog(stage, p))
    ;({ L, R, sr } = r)
    meta = { ep: r.ep, seconds: r.seconds, cached: false }
    idb.set('ai', key, { sr, L: toI16(L), R: toI16(R), meta })
  }
  const ab = audioCtx().createBuffer(2, L.length, sr)
  ab.copyToChannel(L, 0)
  ab.copyToChannel(R, 1)
  const d = await to16k(ab)
  const file = { name: 'AI 분리 보컬 · ' + orig.file.name, size: orig.file.size }
  const voc = { file, buf: ab, L: d.L, R: d.R, M: d.M, loud: loudness(d.M), separated: true }
  SONG.sep = { key, voc, sr, L, R, meta }
  return voc
}

/** 원곡 − AI 보컬 = 반주 (MR 파일이 없을 때 재생용) */
async function instrumentalBuffer() {
  const s = SONG.sep
  const len = s.L.length
  const oc = new OfflineAudioContext(2, len, s.sr)
  const src = oc.createBufferSource()
  src.buffer = SONG.orig.buf
  src.connect(oc.destination)
  src.start()
  const r = await oc.startRendering()
  const out = audioCtx().createBuffer(2, len, s.sr)
  for (let c = 0; c < 2; c++) {
    const x = r.getChannelData(c)
    const v = c ? s.R : s.L
    const o = new Float32Array(len)
    for (let i = 0; i < len; i++) o[i] = x[i] - v[i]
    out.copyToChannel(o, c)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 노트 만들기 (기존 사이트와 동일)                                        */
/* ------------------------------------------------------------------ */

function buildNotes(mel) {
  const m = mel.midi
  const n = m.length
  const W = 4
  const sm = new Float32Array(n).fill(NaN)
  for (let i = 0; i < n; i++) {
    if (isNaN(m[i])) continue
    const a = []
    for (let j = i - W; j <= i + W; j++) if (j >= 0 && j < n && !isNaN(m[j])) a.push(m[j])
    a.sort((x, y) => x - y)
    sm[i] = a[a.length >> 1]
  }
  const runs = []
  let cur = null
  for (let i = 0; i <= n; i++) {
    const v = i < n && !isNaN(sm[i]) ? Math.round(sm[i]) : null
    if (cur && v === cur.m && i - cur.e <= 1) {
      cur.e = i + 1
      continue
    }
    if (cur) runs.push(cur)
    cur = v === null ? null : { m: v, s: i, e: i + 1 }
  }
  const MIN = 6
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i]
      if (r.e - r.s >= MIN) continue
      const p = runs[i - 1]
      const q = runs[i + 1]
      const pj = p && r.s - p.e <= 1 && Math.abs(p.m - r.m) <= 2
      const qj = q && q.s - r.e <= 1 && Math.abs(q.m - r.m) <= 2
      if (pj && (!qj || p.e - p.s >= q.e - q.s)) {
        p.e = r.e
        runs.splice(i--, 1)
      } else if (qj) {
        q.s = r.s
        runs.splice(i--, 1)
      }
    }
  const out = []
  for (const r of runs) {
    const l = out[out.length - 1]
    if (l && l.m === r.m && r.s - l.e <= 3) l.e = r.e
    else if (r.e - r.s >= 6) out.push({ ...r })
  }
  return out.map((r) => ({ m: r.m, t0: r.s * mel.hop + MEL_T0, t1: r.e * mel.hop + MEL_T0 }))
}

/** 피치 트랙에 소리가 있는데 노트가 없는 구간을 노트로 채운다 */
function fillFromTrack(notes, mel) {
  const n = mel.midi.length
  const mask = new Float32Array(mel.midi)
  for (const x of notes) {
    const a = Math.max(0, Math.round((x.t0 - MEL_T0) / mel.hop))
    const b = Math.min(n, Math.round((x.t1 - MEL_T0) / mel.hop))
    for (let i = a; i < b; i++) mask[i] = NaN
  }
  const extra = buildNotes({ hop: mel.hop, midi: mask })
  extra.forEach((e) => (e.fill = true))
  return notes.concat(extra).sort((a, b) => a.t0 - b.t0)
}

function notesStats(ns) {
  const cnt = {}
  const tot = {}
  for (const n of ns) {
    const d = n.t1 - n.t0
    if (d < 0.15) continue
    cnt[n.m] = (cnt[n.m] || 0) + 1
    tot[n.m] = (tot[n.m] || 0) + d
  }
  const ok = Object.keys(cnt)
    .map(Number)
    .filter((m) => cnt[m] >= 2 || tot[m] >= 0.5)
  if (!ok.length) return null
  return { lo: Math.min(...ok), hi: Math.max(...ok) }
}

/* ------------------------------------------------------------------ */
/* CREPE 결합                                                            */
/* ------------------------------------------------------------------ */

/**
 * 기본 트래커(유성/무성 판단, 옥타브 판단이 튼튼함)와 CREPE(음 높이가 정밀함)를 합친다.
 * 실제 곡(Tony 노트와 비교)으로 재 보니 CREPE의 옥타브 판단은 기본 트래커보다 자주 틀려서
 * (한 옥타브 높게 2~4%), 옥타브는 기본 트래커를 따르고 CREPE는 같은 음 안의 정밀한 값에만 쓴다.
 * - 1반음 안에서 일치 → CREPE 값
 * - 한 옥타브 차이 → 기본 트래커 값
 * - 그 밖에 크게 다름 → CREPE가 아주 확실할 때만 CREPE
 * - 기본 트래커가 놓친 구간 → CREPE가 아주 확실하고 소리가 클 때만 살림
 */
function mergeCrepe(classic, cr) {
  const n = classic.midi.length
  const out = new Float32Array(n).fill(NaN)
  let used = 0
  for (let i = 0; i < n; i++) {
    const c = classic.midi[i]
    const p = i < cr.midi.length ? cr.midi[i] : NaN
    const conf = i < cr.conf.length ? cr.conf[i] : 0
    if (isNaN(c)) {
      if (!isNaN(p) && conf > 0.85 && cr.loud[i]) {
        out[i] = p
        used++
      }
      continue
    }
    if (isNaN(p) || conf < 0.2) {
      out[i] = c
      continue
    }
    const d = p - c
    if (Math.abs(d) <= 1) {
      out[i] = p
      used++
    } else if (Math.abs(Math.abs(d) - 12) <= 1) out[i] = c
    else out[i] = conf > 0.75 ? p : c
  }
  return { ...classic, midi: out, crepeUsed: used / n }
}

/* ------------------------------------------------------------------ */
/* 노트 파일 (MIDI / Tony CSV)                                            */
/* ------------------------------------------------------------------ */

export async function loadNoteFile(file) {
  const k = fileKey(file)
  if (SONG.noteFile && SONG.noteFile.key === k) return SONG.noteFile
  const isCsv = /\.(csv|txt)$/i.test(file.name)
  const all = isCsv ? core.parseNoteCsv(await file.text()) : core.parseMidi(await file.arrayBuffer())
  if (!all.length) throw new Error('노트 파일에서 노트를 찾지 못했어요.')
  SONG.noteFile = { key: k, name: file.name, isCsv, all, notes: all, lag: 0, oct: 0, sc: null, track: 0, ntr: 1, aligned: false }
  return SONG.noteFile
}

function noteFileAlign(nf, mel) {
  const tracks = [...new Set(nf.all.map((n) => n.track))]
  let best = null
  for (const tr of tracks) {
    const ns = nf.all.filter((n) => n.track === tr)
    if (ns.length < 10 && tracks.length > 1) continue
    const a = core.alignMidi(ns, mel, MEL_T0)
    if (!best || a.sc > best.sc) best = { ...a, tr, ns }
  }
  if (!best) return
  Object.assign(nf, { notes: best.ns, lag: best.lag, oct: best.oct, sc: best.sc, track: best.tr, ntr: tracks.length, aligned: true })
}

function noteFileScore(nf, mel) {
  const { hop, midi } = mel
  let ok = 0
  let tot = 0
  for (const x of nf.notes) {
    const a = Math.max(0, Math.round((x.t0 + nf.lag - MEL_T0) / hop))
    const b = Math.min(midi.length, Math.round((x.t1 + nf.lag - MEL_T0) / hop))
    for (let i = a; i < b; i++) {
      if (isNaN(midi[i])) continue
      tot++
      if (Math.abs(midi[i] - x.m - nf.oct) <= 0.5) ok++
    }
  }
  return tot ? ok / tot : null
}

export function nudgeNoteFile(sec) {
  if (!SONG.noteFile) return
  SONG.noteFile.lag += sec
  SONG.noteFile.manual = true
}
export function autoAlignNoteFile() {
  if (!SONG.noteFile) return
  SONG.noteFile.aligned = false
  SONG.noteFile.manual = false
}
export function clearNoteFile() {
  SONG.noteFile = null
}

/* ------------------------------------------------------------------ */
/* MR 정렬                                                               */
/* ------------------------------------------------------------------ */

export async function alignMrReal(force = false) {
  if (!SONG.orig || !SONG.mr) return null
  const key = fileKey(SONG.orig.file) + '>' + fileKey(SONG.mr.file)
  if (!force && SONG.mrAlign && SONG.mrAlign.key === key) return SONG.mrAlign
  const r = await core.alignOffset(SONG.orig.M, SONG.mr.M)
  SONG.mrAlign = { offset: r.offset, conf: r.conf, manual: false, key }
  trackCache.clear()
  return SONG.mrAlign
}

export function nudgeMrOffset(sec) {
  if (!SONG.mrAlign) return null
  SONG.mrAlign = { ...SONG.mrAlign, offset: SONG.mrAlign.offset + sec, conf: 0, manual: true }
  for (const k of [...trackCache.keys()]) if (k.startsWith('mr|')) trackCache.delete(k)
  return SONG.mrAlign
}

/* ------------------------------------------------------------------ */
/* 직접 편집한 노트 저장 (원곡 파일별)                                      */
/* ------------------------------------------------------------------ */

const editKey = () => (SONG.orig ? 'edit|' + fileKey(SONG.orig.file) : null)
/** 어떤 입력으로 만든 노트를 고쳤는지 — 보컬/노트 파일을 바꾸면 예전 편집본을 쓰지 않는다 */
const editSig = () => [SONG.voc ? fileKey(SONG.voc.file) : '', SONG.noteFile ? SONG.noteFile.key : ''].join('#')

export async function saveEdits(notes) {
  const k = editKey()
  if (!k) return
  await idb.set('edits', k, { at: Date.now(), sig: editSig(), notes: notes.map((n) => ({ start: n.start, dur: n.dur, midi: n.midi, lyric: n.lyric })) })
}
export async function loadEdits() {
  const k = editKey()
  const v = k ? await idb.get('edits', k) : null
  return v && v.sig === editSig() ? v : null
}
/* 가사도 원곡 파일별로 저장 */
export async function saveLyrics(lyrics) {
  if (!SONG.orig) return
  const k = 'lrc|' + fileKey(SONG.orig.file)
  if (lyrics) await idb.set('edits', k, lyrics)
  else await idb.del('edits', k)
}
export async function loadLyrics() {
  if (!SONG.orig) return null
  return await idb.get('edits', 'lrc|' + fileKey(SONG.orig.file))
}

export async function discardEdits() {
  const k = editKey()
  if (k) await idb.del('edits', k)
}

/* ------------------------------------------------------------------ */
/* 분석                                                                  */
/* ------------------------------------------------------------------ */

const eta = (t0, p) => {
  if (p < 0.03) return ''
  const el = (performance.now() - t0) / 1000
  const left = Math.round(el / p - el)
  return ` · 약 ${left >= 60 ? Math.round(left / 60) + '분' : left + '초'} 남음`
}

/**
 * @param inputs { original, mr, vocal, noteFile } — File 또는 null
 * @param opts { sensitivity 0~100, splitSyllables, autofill, pitchModel: 'crepe'|'classic', crepeModel, useEdits }
 * @param prog (stage, ratio) => void
 */
const dbg = (label) => {
  if (typeof window !== 'undefined' && window.__VL_DEBUG) console.log('[VL]', label, Math.round(performance.now()))
}

export async function analyzeSong(inputs, opts, prog = () => {}) {
  // prog는 AI 분리 뒤에 남은 단계 비율을 다시 매기려고 바꿔 끼울 수 있다
  const t0 = performance.now()
  const warnings = []
  const sens = Math.max(0, Math.min(1, opts.sensitivity / 100))

  // 1) 디코딩
  if (!inputs.original && !inputs.mr) throw new Error('원곡 파일을 넣어 주세요.')
  if (inputs.original) {
    prog('원곡 디코딩', 0.02)
    const o = await decode(inputs.original)
    if (!SONG.orig || SONG.orig.file !== o.file) {
      SONG.orig = o
      SONG.melCache.clear()
      trackCache.clear()
      SONG.mrAlign = null
    }
  } else SONG.orig = null
  if (inputs.mr) {
    prog('MR 디코딩', 0.06)
    const m = await decode(inputs.mr)
    if (!SONG.mr || SONG.mr.file !== m.file) {
      SONG.mr = m
      SONG.mrAlign = null
      for (const k of [...trackCache.keys()]) if (k.startsWith('mr|')) trackCache.delete(k)
    }
  } else {
    SONG.mr = null
    SONG.mrAlign = null
  }
  if (inputs.vocal) {
    prog('보컬 파일 디코딩', 0.09)
    const v = await decode(inputs.vocal)
    if (!SONG.voc || SONG.voc.file !== v.file) {
      SONG.sep = null
      SONG.voc = v
      SONG.vocOffset = 0
      if (SONG.orig) {
        const r = await core.alignOffset(SONG.orig.M, v.M, 10)
        SONG.vocOffset = r.conf >= 0.35 && Math.abs(r.offset) > 0.03 ? r.offset : 0
      }
    }
  } else if (opts.separate && SONG.orig) {
    const outer = prog
    SONG.voc = await getSeparated(SONG.orig, (stage, p) => outer(stage, 0.1 + p * 0.45))
    SONG.vocOffset = 0
    prog = (stage, r) => outer(stage, 0.55 + r * 0.45)
  } else {
    SONG.voc = null
    SONG.sep = null
  }
  if (inputs.noteFile) {
    prog('노트 파일 읽는 중', 0.1)
    await loadNoteFile(inputs.noteFile)
  } else SONG.noteFile = null

  const base = SONG.orig || SONG.mr
  const duration = base.buf.duration

  // 2) MR 정렬
  if (SONG.orig && SONG.mr) {
    prog('MR 시간 정렬', 0.12)
    await alignMrReal(false)
    if (SONG.mrAlign.conf < 0.35 && !SONG.mrAlign.manual)
      warnings.push('MR 자동 정렬 신뢰도가 낮아서 MR 비교를 하지 않았어요. 편곡이 다른 MR일 수 있어요. 원곡 가이드로 들으며 오프셋을 맞춘 뒤 다시 분석해 보세요.')
  }

  // 원곡 없이 MR만: 노트 파일이 있어야 한다
  if (!SONG.orig) {
    if (!SONG.noteFile) throw new Error('원곡 파일이 있어야 멜로디를 분석할 수 있어요.')
    const notes = SONG.noteFile.notes.map((n) => ({ t0: n.t0 + SONG.noteFile.lag, t1: n.t1 + SONG.noteFile.lag, m: n.m + SONG.noteFile.oct }))
    return finish(notes, { duration, method: 'noteFile', warnings, t0, opts, mel: null })
  }

  const useVoc = !!SONG.voc
  const useMR = !useVoc && !!(SONG.mr && SONG.mrAlign && (SONG.mrAlign.conf >= 0.35 || SONG.mrAlign.manual))
  const useCrepe = useVoc && opts.pitchModel === 'crepe'
  const n = SONG.orig.L.length

  // 3) 피치 트래킹
  const melKey = [useVoc ? 'voc:' + fileKey(SONG.voc.file) + ':' + SONG.vocOffset : '', useMR ? 'mr:' + SONG.mrAlign.offset.toFixed(3) : '', sens.toFixed(2), useCrepe ? opts.crepeModel || 'small' : 'classic'].join('|')
  let mel = SONG.melCache.get(melKey)
  let vM = null
  if (useVoc) vM = shiftArr(SONG.voc.M, SONG.vocOffset, n)
  if (!mel) {
    if (useVoc) {
      const vL = shiftArr(SONG.voc.L, SONG.vocOffset, n)
      const vR = shiftArr(SONG.voc.R, SONG.vocOffset, n)
      prog('보컬 음 높이 분석', 0.14)
      mel = await core.extractMelody(vL, vR, (p) => prog('보컬 음 높이 분석', 0.14 + p * 0.12), { isolated: true, sens })
      if (useCrepe) {
        const model = opts.crepeModel || 'small'
        const ck = 'crepe2|' + model + '|' + fileKey(SONG.voc.file) + '|' + SONG.vocOffset.toFixed(3)
        let cr = await idb.get('ai', ck)
        if (!cr) {
          const tA = performance.now()
          prog(`CREPE AI 음 높이 분석 (${CREPE_MODELS[model].label})`, 0.27)
          try {
            let where = ''
            cr = await runCrepe(
              vM,
              model,
              (p) => prog(`CREPE AI 음 높이 분석 ${Math.round(p * 100)}%${eta(tA, p)}${where}`, 0.27 + p * 0.33),
              (st) => {
                if (st.startsWith('backend:')) where = st.endsWith('webgl') ? ' (그래픽카드)' : ' (CPU)'
                else if (st === 'model') prog(`CREPE 모델 준비 중 (${CREPE_MODELS[model].mb}MB, 처음 한 번만)`, 0.27)
              },
            )
            idb.set('ai', ck, cr)
          } catch (e) {
            console.error(e)
            warnings.push('CREPE AI를 실행하지 못해서 기본 분석기로 분석했어요. (' + (e.message || e) + ')')
            cr = null
          }
        }
        if (cr) {
          // CREPE 프레임은 기본 트래커와 같은 중심/간격으로 계산되어 있다
          const loud = new Uint8Array(mel.midi.length)
          const e = new Float32Array(mel.midi.length)
          let mx = -200
          for (let i = 0; i < mel.midi.length; i++) {
            let s = 0
            const o = i * 256
            for (let k = 0; k < 2048 && o + k < vM.length; k += 4) s += vM[o + k] * vM[o + k]
            e[i] = 10 * Math.log10(s / 512 + 1e-12)
          }
          const sorted = Array.from(e).sort((a, b) => a - b)
          mx = sorted[Math.floor(sorted.length * 0.95)]
          for (let i = 0; i < e.length; i++) loud[i] = e[i] > mx - 22 ? 1 : 0
          mel = mergeCrepe(mel, { midi: cr.midi, conf: cr.conf, loud })
        }
      }
    } else if (useMR) {
      prog('MR과 비교해서 보컬 구간 찾는 중', 0.14)
      mel = await core.extractMelody(SONG.orig.L, SONG.orig.R, (p) => prog('MR과 비교해서 보컬 구간 찾는 중', 0.14 + p * 0.6), { mr: SONG.mr.M, offset: SONG.mrAlign.offset, beta: 0, sens })
    } else {
      prog('보컬 멜로디 추출 중', 0.14)
      mel = await core.extractMelody(SONG.orig.L, SONG.orig.R, (p) => prog('보컬 멜로디 추출 중', 0.14 + p * 0.6), { sens })
    }
    SONG.melCache.set(melKey, mel)
    if (SONG.melCache.size > 6) SONG.melCache.delete(SONG.melCache.keys().next().value)
  }

  const stats = core.melodyStats(mel)
  if (!stats && !SONG.noteFile) throw new Error('보컬 멜로디를 찾지 못했어요. 보컬이 들어간 파일인지, MR 정렬이 맞는지 확인해 주세요.')

  dbg('A before bp')
  // 4) 노트 분할 + AI 노트 경계
  let notes = buildNotes(mel)
  let aiNotes = false
  if (useVoc) {
    const bk = 'v1|' + fileKey(SONG.voc.file)
    let ev = await idb.get('bp', bk)
    if (!ev) {
      const tA = performance.now()
      prog('AI로 노트 경계 찾는 중 (곡마다 처음 한 번만)', 0.6)
      try {
        ev = await runBasicPitch(SONG.voc.buf, (p) => prog(`AI로 노트 경계 찾는 중 ${Math.round(p * 100)}%${eta(tA, p)} (곡마다 처음 한 번만)`, 0.6 + p * 0.36))
        if (ev && ev.length) idb.set('bp', bk, ev)
      } catch (e) {
        console.error(e)
        warnings.push('AI 노트 경계 찾기에 실패해서 피치 분석 결과만 썼어요.')
        ev = []
      }
    }
    if (ev && ev.length) {
      const evs = SONG.vocOffset ? ev.map(([a, b, p, amp]) => [a - SONG.vocOffset, b - SONG.vocOffset, p, amp]) : ev
      notes = core.fuseNotes(mel, evs, notes, MEL_T0)
      notes = fillFromTrack(notes, mel)
      aiNotes = true
    }
  }

  dbg('B before notefile')
  // 5) 노트 파일
  let method = useVoc ? (aiNotes ? (useCrepe ? 'vocal+crepe+ai' : 'vocal+ai') : 'vocal') : useMR ? 'mr' : 'original'
  let fileInfo = null
  if (SONG.noteFile) {
    const nf = SONG.noteFile
    if (!nf.aligned && !nf.manual) {
      prog('노트 파일 시간 맞추는 중', 0.96)
      await new Promise((r) => setTimeout(r, 10))
      noteFileAlign(nf, mel)
      dbg('B2 aligned')
    } else nf.sc = noteFileScore(nf, mel)
    let fileNotes = nf.notes.map((x) => ({ t0: x.t0 + nf.lag, t1: x.t1 + nf.lag, m: x.m + nf.oct })).filter((x) => x.t1 > 0)
    let added = 0
    if (opts.autofill && (useVoc || useMR)) {
      const before = fileNotes.length
      fileNotes = fillFromTrack(fileNotes, mel)
      added = fileNotes.length - before
    }
    notes = fileNotes
    method = nf.isCsv ? 'tony' : 'midi'
    fileInfo = { name: nf.name, lag: nf.lag, oct: nf.oct, score: nf.sc, tracks: nf.ntr, added, autofillActive: !!(opts.autofill && (useVoc || useMR)) }
    if (nf.sc !== null && nf.sc < 0.6) warnings.push('노트 파일과 원곡 보컬의 일치율이 낮아요. 다른 곡의 파일이거나 시간이 많이 어긋났을 수 있어요.')
  }

  dbg('C before syll')
  // 6) 음절 나누기 · 노트 길이를 실제 발음에 맞추기 (분리된 보컬이 있을 때)
  let syllableAdded = 0
  if (useVoc && opts.splitSyllables) {
    const n0 = notes.length
    const bounds = core.syllableBounds(vM, sens)
    notes = core.splitAtSyllables(notes, bounds, mel, MEL_T0)
    syllableAdded = notes.length - n0
  }
  dbg('C2 split done')
  if (useVoc) notes = core.stretchToVoice(notes, vM, mel, MEL_T0)
  if (!useVoc && !SONG.noteFile) {
    if (useMR) warnings.push('분리된 보컬 파일을 넣으면 노트 타이밍과 음절이 훨씬 정확해져요.')
    else warnings.push('원곡만으로 분석해서 반주 멜로디가 노트로 잡힐 수 있어요. MR이나 보컬 파일을 넣으면 보컬 구간만 정확히 골라낼 수 있어요.')
  }

  dbg('D before finish')
  SONG.lastMel = mel
  return finish(notes, { duration, method, warnings, t0, opts, mel, fileInfo, syllableAdded, crepeUsed: mel.crepeUsed })
}

let uidN = 0
const uid = () => `r${(++uidN).toString(36)}`

async function finish(notes, ctx) {
  let out = notes.filter((n) => n.t1 - n.t0 > 0.02).map((n) => ({ id: uid(), start: n.t0, dur: n.t1 - n.t0, midi: n.m, fill: !!n.fill }))
  let usingEdits = false
  if (ctx.opts.useEdits && SONG.orig) {
    const saved = await loadEdits()
    if (saved && saved.notes && saved.notes.length) {
      out = saved.notes.map((n) => ({ id: uid(), ...n }))
      usingEdits = true
    }
  }
  const info = {
    method: usingEdits ? 'edits' : ctx.method,
    seconds: (performance.now() - ctx.t0) / 1000,
    fileInfo: ctx.fileInfo || null,
    syllableAdded: ctx.syllableAdded || 0,
    crepeUsed: ctx.crepeUsed ?? null,
    vocOffset: SONG.voc ? SONG.vocOffset : null,
    align: SONG.mrAlign ? { offset: SONG.mrAlign.offset, conf: SONG.mrAlign.conf, manual: !!SONG.mrAlign.manual } : null,
    usingEdits,
    separated: SONG.voc && SONG.voc.separated ? { model: SEP_MODEL.label, ...(SONG.sep ? SONG.sep.meta : {}) } : null,
  }
  SONG.lastInfo = info
  return { notes: out, duration: ctx.duration, warnings: ctx.warnings, info }
}

/* ------------------------------------------------------------------ */
/* 재생용 버퍼 (키 변경 · MR 시간 맞춤 · 음량 맞춤)                          */
/* ------------------------------------------------------------------ */

const trackCache = new Map()
let building = null

export function srcGain(track) {
  const o = SONG.orig?.loud
  const m = SONG.mr?.loud
  if (!o || !m) return 1
  const ref = Math.min(o, m) * 1.6
  return ref / (track === 'mr' ? m : o)
}

export function levelInfo() {
  if (!SONG.orig?.loud || !SONG.mr?.loud) return null
  const db = (s) => 20 * Math.log10(srcGain(s))
  return { orig: db('original'), mr: db('mr') }
}

/** MR을 원곡 시간축으로 옮긴 버퍼 */
function alignedMrBuffer() {
  const src = SONG.mr.buf
  const off = SONG.mrAlign && SONG.orig ? SONG.mrAlign.offset : 0
  const len = SONG.orig ? Math.round(SONG.orig.buf.duration * src.sampleRate) : src.length
  const d = Math.round(off * src.sampleRate)
  const out = audioCtx().createBuffer(src.numberOfChannels, len, src.sampleRate)
  for (let c = 0; c < src.numberOfChannels; c++) {
    const a = src.getChannelData(c)
    const o = out.getChannelData(c)
    const s0 = Math.max(0, -d)
    const s1 = Math.min(len, a.length - d)
    if (s1 > s0) o.set(a.subarray(s0 + d, s1 + d), s0)
  }
  return out
}

/** 보컬(파일 또는 AI 분리)을 원곡 시간축에 맞춘 버퍼 */
function alignedVocalBuffer() {
  const v = SONG.voc
  if (v.separated) return v.buf
  const src = v.buf
  const off = SONG.vocOffset || 0
  const len = SONG.orig ? Math.round(SONG.orig.buf.duration * src.sampleRate) : src.length
  const d = Math.round(off * src.sampleRate)
  const out = audioCtx().createBuffer(src.numberOfChannels, len, src.sampleRate)
  for (let c = 0; c < src.numberOfChannels; c++) {
    const a = src.getChannelData(c)
    const o = out.getChannelData(c)
    const s0 = Math.max(0, -d)
    const s1 = Math.min(len, a.length - d)
    if (s1 > s0) o.set(a.subarray(s0 + d, s1 + d), s0)
  }
  return out
}

export function hasGuideVocal() {
  return !!SONG.voc
}

export async function getTrackBuffer(track, semis, onProg) {
  if (track === 'vocal') return getVocalBuffer(semis, onProg)
  const useMr = track === 'mr' && SONG.mr
  const useInst = track === 'mr' && !SONG.mr && SONG.sep && SONG.voc && SONG.voc.separated && SONG.orig
  if (!useMr && !useInst && !SONG.orig) return null
  const key = `${useMr ? 'mr' : useInst ? 'inst:' + SONG.sep.key : 'orig'}|${semis}|${useMr && SONG.mrAlign ? SONG.mrAlign.offset.toFixed(3) : ''}`
  if (trackCache.has(key)) {
    const v = trackCache.get(key)
    trackCache.delete(key)
    trackCache.set(key, v)
    return v
  }
  while (building) await building.catch(() => {})
  if (trackCache.has(key)) return trackCache.get(key)
  const job = (async () => {
    const baseBuf = useMr ? alignedMrBuffer() : useInst ? await instrumentalBuffer() : SONG.orig.buf
    const g = useInst ? 1 : srcGain(useMr ? 'mr' : 'original')
    let chans = []
    for (let c = 0; c < Math.min(2, baseBuf.numberOfChannels); c++) chans.push(baseBuf.getChannelData(c))
    if (semis !== 0) {
      const t0 = performance.now()
      chans = await core.pitchShiftChannels(chans, semis, (p) => onProg && onProg(p, eta(t0, p)))
    }
    const ab = audioCtx().createBuffer(chans.length, baseBuf.length, baseBuf.sampleRate)
    chans.forEach((d, c) => {
      const o = new Float32Array(d.length)
      for (let i = 0; i < d.length; i++) o[i] = d[i] * g
      ab.copyToChannel(o, c)
    })
    trackCache.set(key, ab)
    while (trackCache.size > 4) trackCache.delete(trackCache.keys().next().value)
    return ab
  })()
  building = job
  try {
    return await job
  } finally {
    if (building === job) building = null
  }
}

async function getVocalBuffer(semis, onProg) {
  if (!SONG.voc) return null
  const key = `voc:${fileKey(SONG.voc.file)}|${semis}|${SONG.vocOffset || 0}`
  if (trackCache.has(key)) return trackCache.get(key)
  while (building) await building.catch(() => {})
  if (trackCache.has(key)) return trackCache.get(key)
  const job = (async () => {
    const baseBuf = alignedVocalBuffer()
    // 원곡 안에 들어 있던 크기 그대로 들리게: 원곡과 같은 음량 보정을 쓴다
    const g = SONG.mr ? srcGain('original') : 1
    let chans = []
    for (let c = 0; c < Math.min(2, baseBuf.numberOfChannels); c++) chans.push(baseBuf.getChannelData(c))
    if (semis !== 0) {
      const t0 = performance.now()
      chans = await core.pitchShiftChannels(chans, semis, (p) => onProg && onProg(p, eta(t0, p)))
    }
    const ab = audioCtx().createBuffer(chans.length, baseBuf.length, baseBuf.sampleRate)
    chans.forEach((d, c) => {
      const o = new Float32Array(d.length)
      for (let i = 0; i < d.length; i++) o[i] = d[i] * g
      ab.copyToChannel(o, c)
    })
    trackCache.set(key, ab)
    while (trackCache.size > 5) trackCache.delete(trackCache.keys().next().value)
    return ab
  })()
  building = job
  try {
    return await job
  } finally {
    if (building === job) building = null
  }
}

/* ------------------------------------------------------------------ */
/* 마이크 피치 (YIN — 기존 사이트와 동일)                                   */
/* ------------------------------------------------------------------ */

export const yinPitch = core.yinPitch

/** 원곡 보컬 음 높이 곡선에서 t초의 값 (원곡 키 MIDI, 없으면 NaN) */
export function origPitchAt(t) {
  const m = SONG.lastMel
  if (!m) return NaN
  const i = Math.round((t - MEL_T0) / m.hop)
  return i >= 0 && i < m.midi.length ? m.midi[i] : NaN
}
