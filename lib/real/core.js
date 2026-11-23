// @ts-nocheck
/* VOCAL·LAB 실제 분석 엔진 (기존 사이트에서 이식). 16 kHz 기준. */
/* eslint-disable */

// ===================== dsp.js =====================
// ===== DSP: FFT, phase-vocoder pitch shift, YIN pitch detection, WAV encoding =====
function makeFFT(N) {
  const lg = Math.round(Math.log2(N));
  const rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    let r = 0, x = i;
    for (let b = 0; b < lg; b++) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  const cs = new Float64Array(N / 2), sn = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) { cs[k] = Math.cos(2 * Math.PI * k / N); sn[k] = Math.sin(2 * Math.PI * k / N); }
  return function (re, im) {
    for (let i = 0; i < N; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= N; size <<= 1) {
      const h = size >> 1, step = N / size;
      for (let i = 0; i < N; i += size) {
        for (let j = 0, k = 0; j < h; j++, k += step) {
          const a = i + j, b = a + h;
          const tr = re[b] * cs[k] + im[b] * sn[k];
          const ti = im[b] * cs[k] - re[b] * sn[k];
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  };
}

// Pitch-shift channels by `semis` semitones, keeping tempo.
// Phase vocoder (identity phase locking, stereo-coherent via mid phase) + resampling.
async function pitchShiftChannels(ins, semis, onProg) {
  const L = ins[0].length, chs = ins.length;
  if (semis === 0) return ins.map(a => a.slice());
  const alpha = Math.pow(2, semis / 12);
  const N = 2048, Hs = 512, Ha = Hs / alpha, half = N / 2 + 1, TWO_PI = 2 * Math.PI;
  const fft = makeFFT(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(TWO_PI * i / N);
  const outLen = Math.ceil(L * alpha) + 2 * N;
  const outs = ins.map(() => new Float32Array(outLen));
  const cRe = ins.map(() => new Float64Array(N)), cIm = ins.map(() => new Float64Array(N));
  const zRe = new Float64Array(N), zIm = new Float64Array(N);
  const mag = new Float64Array(half), ph = new Float64Array(half), prevPh = new Float64Array(half);
  let synth = new Float64Array(half), nsynth = new Float64Array(half);
  const instF = new Float64Array(half);
  const peaks = new Int32Array(half);
  const frames = Math.max(1, Math.floor((L - 1) / Ha) + 1);
  const gain = 1 / 1.5; // Hann^2 OLA at 75% overlap
  let prevTa = 0;
  for (let m = 0; m < frames; m++) {
    const ta = Math.round(m * Ha), ts = m * Hs;
    // analysis (stereo packed into one complex FFT: z = l + i r)
    if (chs === 2) {
      const l = ins[0], r = ins[1];
      for (let i = 0; i < N; i++) {
        const idx = ta + i;
        zRe[i] = (idx < L ? l[idx] : 0) * win[i];
        zIm[i] = (idx < L ? r[idx] : 0) * win[i];
      }
      fft(zRe, zIm);
      for (let k = 0; k < half; k++) {
        const nk = (N - k) & (N - 1);
        const ar = zRe[k], ai = zIm[k], br = zRe[nk], bi = -zIm[nk]; // b = conj(Z[N-k])
        const lr = 0.5 * (ar + br), li = 0.5 * (ai + bi);           // L = (Z + conj)/2
        const rr = 0.5 * (ai - bi), ri = -0.5 * (ar - br);          // R = (Z - conj)/(2i)
        cRe[0][k] = lr; cIm[0][k] = li; cRe[1][k] = rr; cIm[1][k] = ri;
        const mr = 0.5 * (lr + rr), mi = 0.5 * (li + ri);
        mag[k] = Math.hypot(mr, mi); ph[k] = Math.atan2(mi, mr);
      }
    } else {
      for (let c = 0; c < chs; c++) {
        for (let i = 0; i < N; i++) { const idx = ta + i; cRe[c][i] = (idx < L ? ins[c][idx] : 0) * win[i]; cIm[c][i] = 0; }
        fft(cRe[c], cIm[c]);
      }
      for (let k = 0; k < half; k++) {
        let mr = 0, mi = 0;
        for (let c = 0; c < chs; c++) { mr += cRe[c][k]; mi += cIm[c][k]; }
        mr /= chs; mi /= chs;
        mag[k] = Math.hypot(mr, mi); ph[k] = Math.atan2(mi, mr);
      }
    }
    if (m === 0) {
      for (let k = 0; k < half; k++) nsynth[k] = ph[k];
    } else {
      const dHa = ta - prevTa;
      for (let k = 0; k < half; k++) {
        const omega = TWO_PI * k / N;
        let d = ph[k] - prevPh[k] - omega * dHa;
        d -= TWO_PI * Math.round(d / TWO_PI);
        instF[k] = omega + d / dHa;
      }
      // peak picking
      let np = 0;
      for (let k = 2; k < half - 2; k++) {
        const v = mag[k];
        if (v > mag[k - 1] && v > mag[k - 2] && v >= mag[k + 1] && v >= mag[k + 2]) peaks[np++] = k;
      }
      if (np === 0) {
        for (let k = 0; k < half; k++) nsynth[k] = synth[k] + Hs * instF[k];
      } else {
        for (let p = 0; p < np; p++) { const k = peaks[p]; nsynth[k] = synth[k] + Hs * instF[k]; }
        // identity phase locking: bins follow nearest peak
        let start = 0;
        for (let p = 0; p < np; p++) {
          const pk = peaks[p];
          const end = p < np - 1 ? ((pk + peaks[p + 1]) >> 1) : half - 1;
          const base = nsynth[pk] - ph[pk];
          for (let k = start; k <= end; k++) if (k !== pk) nsynth[k] = base + ph[k];
          start = end + 1;
        }
      }
    }
    // keep phases bounded
    for (let k = 0; k < half; k++) nsynth[k] -= TWO_PI * Math.round(nsynth[k] / TWO_PI);
    prevPh.set(ph);
    // synthesis
    for (let c = 0; c < chs; c++) {
      const re = cRe[c], im = cIm[c];
      for (let k = 0; k < half; k++) {
        const mc = Math.hypot(re[k], im[k]);
        const pc = chs > 1 ? Math.atan2(im[k], re[k]) - ph[k] : 0;
        const phase = nsynth[k] + pc;
        re[k] = mc * Math.cos(phase); im[k] = mc * Math.sin(phase);
      }
      im[0] = 0; im[N / 2] = 0;
    }
    if (chs === 2) {
      // S = Lout + i*Rout over full spectrum, one inverse FFT gives l + i r
      const lr = cRe[0], li = cIm[0], rr = cRe[1], ri = cIm[1];
      for (let k = 0; k < half; k++) { zRe[k] = lr[k] - ri[k]; zIm[k] = li[k] + rr[k]; }
      for (let k = 1; k < N / 2; k++) { // conj-symmetric halves: L[N-k]=conj(L[k])
        zRe[N - k] = lr[k] + ri[k]; zIm[N - k] = -li[k] + rr[k];
      }
      fft(zIm, zRe);
      const o0 = outs[0], o1 = outs[1];
      for (let i = 0; i < N; i++) { const w = win[i] * gain / N; o0[ts + i] += zRe[i] * w; o1[ts + i] += zIm[i] * w; }
    } else {
      for (let c = 0; c < chs; c++) {
        const re = cRe[c], im = cIm[c];
        for (let k = 1; k < N / 2; k++) { re[N - k] = re[k]; im[N - k] = -im[k]; }
        fft(im, re);
        const out = outs[c];
        for (let i = 0; i < N; i++) out[ts + i] += re[i] / N * win[i] * gain;
      }
    }
    const t = synth; synth = nsynth; nsynth = t;
    prevTa = ta;
    if (onProg && (m & 63) === 63) { onProg(0.95 * m / frames); await new Promise(r => setTimeout(r, 0)); }
  }
  // resample back to original length -> pitch shift
  const res = outs.map(() => new Float32Array(L));
  let peak = 0;
  for (let c = 0; c < chs; c++) {
    const s = outs[c], d = res[c];
    for (let i = 0; i < L; i++) {
      const pos = i * alpha, i0 = Math.floor(pos), fr = pos - i0;
      const v = s[i0] * (1 - fr) + s[i0 + 1] * fr;
      d[i] = v;
      const a = v < 0 ? -v : v; if (a > peak) peak = a;
    }
  }
  if (peak > 0.99) { const g = 0.99 / peak; for (const d of res) for (let i = 0; i < L; i++) d[i] *= g; }
  if (onProg) onProg(1);
  return res;
}

// YIN pitch detection. Returns Hz or -1.
function yinPitch(buf, sr) {
  const W = Math.floor(buf.length / 2);
  const tauMin = Math.max(2, Math.floor(sr / 1200)), tauMax = Math.min(W - 1, Math.floor(sr / 60));
  const d = yinPitch._d && yinPitch._d.length >= tauMax + 2 ? yinPitch._d : (yinPitch._d = new Float32Array(tauMax + 2));
  d[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x; }
    run += s;
    d[tau] = run > 0 ? s * tau / run : 1;
  }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < 0.15) {
      while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
      tau = t; break;
    }
  }
  if (tau < 0) return -1;
  let bt = tau;
  if (tau > 1 && tau < tauMax) {
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const den = a - 2 * b + c;
    if (den !== 0) bt = tau + 0.5 * (a - c) / den;
  }
  return sr / bt;
}

function encodeWav(chs, sr) {
  const n = chs[0].length, c = chs.length, bytes = n * c * 2;
  const buf = new ArrayBuffer(44 + bytes), v = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, c, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * c * 2, true); v.setUint16(32, c * 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let ch = 0; ch < c; ch++) {
    let s = chs[ch][i]; s = s < -1 ? -1 : s > 1 ? 1 : s;
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
  }
  return buf;
}


// ===================== melody.js =====================
// ===== Melody extraction (predominant vocal pitch) + MR/original alignment =====
// Expects 16 kHz audio. Uses makeFFT from dsp.js.

const MEL = { SR: 16000, N: 2048, HOP: 256, MIN: 45, MAX: 93, STEP: 0.2 };

// Extract predominant (vocal) melody. L, R: Float32Array at 16 kHz (R may equal L).
// Returns { hop (s), midi: Float32Array (NaN = unvoiced), sal: Float32Array }
async function extractMelody(L, R, onProg, opt = {}) {
  const { N, HOP, MIN, MAX, STEP, SR } = MEL;
  const fft = makeFFT(N);
  const half = N / 2;
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const len = L.length;
  const frames = Math.max(1, Math.floor((len - N) / HOP) + 1);
  const NB = Math.round((MAX - MIN) / STEP) + 1;
  const K = 5;
  const candM = new Float32Array(frames * K).fill(NaN), candV = new Float32Array(frames * K), candR = new Float32Array(frames * K);
  const MO = new Float64Array(half);
  const frameTot = new Float32Array(frames), frameDb = new Float32Array(frames);
  const zr = new Float64Array(N), zi = new Float64Array(N);
  const M = new Float64Array(half), sal = new Float64Array(NB);
  const kLo = Math.floor(80 * N / SR), kHi = Math.ceil(5000 * N / SR);
  const pk = [];
  // optional MR subtraction: residual = |orig| - beta * g * |MR| (time-aligned)
  const MRx = opt.mr || null, offS = Math.round((opt.offset || 0) * SR);
  const mrRe = new Float64Array(N), mrIm = new Float64Array(N), MRmag = new Float64Array(half);
  const hw = [1, 0.8, 0.64, 0.512, 0.41, 0.328, 0.262, 0.21, 0.168, 0.134];
  // band layout for vocal-activity detection (200-5000 Hz, 24 log bands)
  const NBD = 24, bandOf = new Int8Array(half).fill(-1);
  for (let k = 1; k < half; k++) { const f = k * SR / N; if (f >= 200 && f < 5000) bandOf[k] = Math.min(NBD - 1, Math.floor(Math.log(f / 200) / Math.log(25) * NBD)); }
  const bandO = MRx ? new Float32Array(frames * NBD) : null, bandM = MRx ? new Float32Array(frames * NBD) : null;
  const beta = opt.beta !== undefined ? opt.beta : 0;
  const bandGain = new Float64Array(NBD).fill(1);
  if (MRx && beta > 0) {
    // per-band level match (EQ differences between mixes): median of |orig|/|MR| per band
    const rs = Array.from({ length: NBD }, () => []);
    for (let t = 0; t < frames; t += 6) {
      const o = t * HOP, om = o + offS;
      if (om < 0 || om + N > MRx.length) continue;
      for (let i = 0; i < N; i++) { zr[i] = 0.5 * (L[o + i] + R[o + i]) * win[i]; zi[i] = MRx[om + i] * win[i]; }
      fft(zr, zi);
      const eo = new Float64Array(NBD), em = new Float64Array(NBD);
      for (let k = 1; k < half; k++) {
        const b = bandOf[k]; if (b < 0) continue; const nk = N - k;
        const ar = 0.5 * (zr[k] + zr[nk]), ai = 0.5 * (zi[k] - zi[nk]), br = 0.5 * (zi[k] + zi[nk]), bi = -0.5 * (zr[k] - zr[nk]);
        eo[b] += ar * ar + ai * ai; em[b] += br * br + bi * bi;
      }
      for (let b = 0; b < NBD; b++) if (eo[b] > 1e-9 && em[b] > 1e-9) rs[b].push(Math.sqrt(eo[b] / em[b]));
    }
    for (let b = 0; b < NBD; b++) { const a = rs[b].sort((x, y) => x - y); if (a.length) bandGain[b] = a[Math.floor(a.length * 0.3)]; }
  }
  for (let t = 0; t < frames; t++) {
    const o = t * HOP;
    let e2 = 0;
    for (let i = 0; i < N; i++) { const a = L[o + i], b = R[o + i]; e2 += a * a + b * b; zr[i] = a * win[i]; zi[i] = b * win[i]; }
    frameDb[t] = 10 * Math.log10(e2 / (2 * N) + 1e-12);
    fft(zr, zi);
    if (MRx) {
      const om = o + offS;
      for (let i = 0; i < N; i++) { const j = om + i; mrRe[i] = (j >= 0 && j < MRx.length ? MRx[j] : 0) * win[i]; mrIm[i] = 0; }
      fft(mrRe, mrIm);
      const bo = t * NBD;
      for (let k = 1; k < half; k++) {
        const mg = Math.hypot(mrRe[k], mrIm[k]); const b = bandOf[k];
        MRmag[k] = mg * (b >= 0 ? bandGain[b] : 1);
        if (b >= 0) bandM[bo + b] += mg * mg;
      }
    }
    let mx = 0;
    for (let k = kLo; k <= kHi; k++) {
      const nk = N - k;
      const lr = 0.5 * (zr[k] + zr[nk]), li = 0.5 * (zi[k] - zi[nk]);
      const rr = 0.5 * (zi[k] + zi[nk]), ri = -0.5 * (zr[k] - zr[nk]);
      const pl = lr * lr + li * li, pr = rr * rr + ri * ri;
      let sim = (pl + pr) > 1e-12 ? 2 * (lr * rr + li * ri) / (pl + pr) : 0; // 1 = centered
      if (sim < 0) sim = 0;
      const mr = 0.5 * (lr + rr), mi = 0.5 * (li + ri);
      let v = Math.sqrt(mr * mr + mi * mi);
      MO[k] = v;
      if (MRx) {
        const b = bandOf[k]; if (b >= 0) bandO[t * NBD + b] += v * v;
        if (beta > 0) { v -= beta * MRmag[k]; if (v < 0) v = 0; }
        v *= Math.sqrt(sim);
      } else if (!opt.isolated) v *= sim * sim;
      M[k] = v; if (v > mx) mx = v;
    }
    // peaks
    pk.length = 0;
    const floor = mx * 0.01;
    for (let k = kLo + 1; k < kHi; k++) {
      const v = M[k];
      if (v > floor && v > M[k - 1] && v >= M[k + 1]) {
        const a = Math.log(M[k - 1] + 1e-12), b = Math.log(v + 1e-12), c = Math.log(M[k + 1] + 1e-12);
        const den = a - 2 * b + c; const d = den !== 0 ? 0.5 * (a - c) / den : 0;
        pk.push([(k + d) * SR / N, Math.sqrt(v)]);
      }
    }
    if (pk.length > 60) { pk.sort((x, y) => y[1] - x[1]); pk.length = 60; }
    sal.fill(0);
    let tot = 0;
    for (const [f, a] of pk) {
      tot += a;
      for (let h = 1; h <= 10; h++) {
        const m0 = 69 + 12 * Math.log2(f / h / 440);
        if (m0 < MIN - 0.4) break;
        if (m0 > MAX + 0.4) continue;
        const idx = (m0 - MIN) / STEP, w = a * hw[h - 1];
        const j0 = Math.max(0, Math.ceil(idx - 2)), j1 = Math.min(NB - 1, Math.floor(idx + 2));
        for (let j = j0; j <= j1; j++) {
          const d = Math.abs(j - idx) * STEP;
          if (d < 0.4) { const g = Math.cos(Math.PI / 2 * d / 0.4); sal[j] += w * g * g; }
        }
      }
    }
    frameTot[t] = tot;
    // amplitude of the strongest spectral peak within ±40 cents of f
    const ampAt = f => { let a = 0; const lo = f * 0.977, hi = f * 1.0234; for (const p of pk) if (p[0] >= lo && p[0] <= hi && p[1] > a) a = p[1]; return a; };
    // top-K salience peaks
    let n = 0;
    for (let j = 1; j < NB - 1; j++) {
      const v = sal[j];
      if (v > 0 && v > sal[j - 1] && v >= sal[j + 1]) {
        const a = sal[j - 1], c = sal[j + 1], den = a - 2 * v + c;
        const d = den !== 0 ? 0.5 * (a - c) / den : 0;
        const m = MIN + (j + d) * STEP;
        // insert into sorted top-K
        let p = Math.min(n, K - 1);
        if (n < K || v > candV[t * K + K - 1]) {
          if (n < K) n++;
          p = n - 1;
          while (p > 0 && candV[t * K + p - 1] < v) { candV[t * K + p] = candV[t * K + p - 1]; candM[t * K + p] = candM[t * K + p - 1]; p--; }
          candV[t * K + p] = v; candM[t * K + p] = m;
        }
      }
    }
    // octave-down error check: if the candidate's 1st and 3rd harmonics are missing but 2nd/4th are strong,
    // the real pitch is one octave up (e.g. a D6 read as D5)
    for (let i = 0; i < 1; i++) { // only the strongest candidate: weaker ones are often partials of it
      const m = candM[t * K + i]; if (isNaN(m)) continue;
      const f0 = 440 * Math.pow(2, (m - 69) / 12);
      // octave too LOW: 1st and 3rd harmonics missing, 2nd/4th strong -> real pitch is one octave up
      const odd = ampAt(f0) + ampAt(3 * f0), even = ampAt(2 * f0) + ampAt(4 * f0);
      if (m + 12 <= MAX && even > 0 && odd < 0.2 * even) { candM[t * K + i] = m + 12; candV[t * K + i] *= 0.85; continue; }
      // octave too HIGH: clear energy at 1.5x / 2.5x (odd harmonics of f0/2) -> real pitch is one octave down
      if (m - 12 >= MIN) {
        const half = ampAt(1.5 * f0) + ampAt(2.5 * f0), full = ampAt(f0) + ampAt(2 * f0) + ampAt(3 * f0);
        if (full > 0 && half > 0.45 * full && ampAt(1.5 * f0) > 0.3 * ampAt(f0)) candM[t * K + i] = m - 12;
      }
    }
    if (MRx) {
      for (let i = 0; i < K; i++) {
        const m = candM[t * K + i]; if (isNaN(m)) continue;
        const f0 = 440 * Math.pow(2, (m - 69) / 12);
        let eo = 0, er = 0;
        for (let h = 1; h <= 8; h++) {
          const kc = Math.round(f0 * h * N / SR); if (kc + 1 >= half) break;
          let a = 0, bm = 0;
          for (let k = kc - 1; k <= kc + 1; k++) { a = Math.max(a, MO[k]); bm = Math.max(bm, MRmag[k]); }
          const w = hw[h - 1];
          eo += w * a; er += w * Math.max(0, a - 1.2 * bm);
        }
        candR[t * K + i] = eo > 0 ? er / eo : 0; // share of this pitch's harmonics not explained by the MR
      }
    }
    if (onProg && (t & 255) === 255) { onProg(0.85 * t / frames); await new Promise(r => setTimeout(r, 0)); }
  }
  // Viterbi over candidates
  const score = new Float64Array(frames * K).fill(-Infinity), back = new Int8Array(frames * K).fill(-1);
  for (let t = 0; t < frames; t++) {
    const top = candV[t * K] || 1e-9;
    for (let i = 0; i < K; i++) {
      const m = candM[t * K + i]; if (isNaN(m)) continue;
      const e = Math.log(candV[t * K + i] / top + 1e-3) + (MRx ? 2.0 * candR[t * K + i] : 0);
      if (t === 0) { score[i] = e; continue; }
      let best = -Infinity, bi = -1;
      for (let j = 0; j < K; j++) {
        const pm = candM[(t - 1) * K + j]; if (isNaN(pm)) continue;
        const s = score[(t - 1) * K + j] - Math.min(3, 0.35 * Math.abs(m - pm));
        if (s > best) { best = s; bi = j; }
      }
      if (bi < 0) { // previous frame empty: restart from its best score (0)
        let pb = -Infinity; for (let j = 0; j < K; j++) pb = Math.max(pb, score[(t - 1) * K + j]);
        best = isFinite(pb) ? pb : 0;
      }
      score[t * K + i] = best + e; back[t * K + i] = bi;
    }
  }
  const midi = new Float32Array(frames).fill(NaN), sv = new Float32Array(frames), rv = new Float32Array(frames);
  let bi = 0, bs = -Infinity;
  for (let i = 0; i < K; i++) if (score[(frames - 1) * K + i] > bs) { bs = score[(frames - 1) * K + i]; bi = i; }
  for (let t = frames - 1; t >= 0; t--) {
    if (bi < 0 || isNaN(candM[t * K + bi])) {
      // find best candidate in this frame to continue backtrack
      let b = -1, s = -Infinity; for (let i = 0; i < K; i++) if (score[t * K + i] > s) { s = score[t * K + i]; b = i; }
      bi = b; if (bi < 0) continue;
    }
    midi[t] = candM[t * K + bi]; sv[t] = candV[t * K + bi]; rv[t] = candR[t * K + bi];
    bi = back[t * K + bi];
  }
  // contour-level octave check: if a candidate one octave below is consistently stronger, the tracker
  // got stuck an octave high (path inertia) -> move the whole contour down
  for (let pass = 0; pass < 3; pass++) {
    let a = 0;
    for (let t = 1; t <= frames; t++) {
      if (t < frames && !isNaN(midi[t]) && !isNaN(midi[t - 1]) && Math.abs(midi[t] - midi[t - 1]) < 1) continue;
      const b = t; // segment [a, b)
      if (b - a >= 3 && !isNaN(midi[a])) {
        let hits = 0; const alt = new Float32Array(b - a), altV = new Float32Array(b - a);
        for (let u = a; u < b; u++) {
          let bestV = 0, bestM = NaN;
          for (let k = 0; k < K; k++) { const cm = candM[u * K + k]; if (!isNaN(cm) && Math.abs(cm - (midi[u] - 12)) < 0.6 && candV[u * K + k] > bestV) { bestV = candV[u * K + k]; bestM = cm; } }
          alt[u - a] = bestM; altV[u - a] = bestV;
          if (bestV >= 1.05 * sv[u]) hits++;
        }
        if (hits >= 0.5 * (b - a)) for (let u = a; u < b; u++) { midi[u] = isNaN(alt[u - a]) ? midi[u] - 12 : alt[u - a]; if (altV[u - a]) sv[u] = altV[u - a]; }
      }
      a = t;
    }
  }
  if (onProg) onProg(0.9);
  // voicing: salience relative to song-level loudness + harmonic concentration
  const vs = [];
  for (let t = 0; t < frames; t++) if (sv[t] > 0) vs.push(sv[t]);
  vs.sort((a, b) => a - b);
  const ref = vs.length ? vs[Math.floor(vs.length * 0.9)] : 1;
  // local reference (90th pct within ~10 s blocks, max with neighbours) so quiet verses survive
  const BL = Math.round(5 * SR / HOP), nbk = Math.ceil(frames / BL), bref = new Float32Array(nbk);
  for (let b = 0; b < nbk; b++) {
    const a = []; for (let t = b * BL; t < Math.min(frames, (b + 1) * BL); t++) if (sv[t] > 0) a.push(sv[t]);
    a.sort((x, y) => x - y); bref[b] = a.length ? a[Math.floor(a.length * 0.9)] : 0;
  }
  const lref = new Float32Array(frames);
  for (let t = 0; t < frames; t++) { const b = Math.floor(t / BL); lref[t] = Math.max(bref[b], b > 0 ? bref[b - 1] : 0, b < nbk - 1 ? bref[b + 1] : 0); }
  const voiced = new Uint8Array(frames);
  let vad = null;
  if (MRx) {
    // vocal activity: fraction of bands where original is clearly louder than (level-matched) MR
    const med = new Float64Array(NBD);
    const dB = new Float32Array(frames * NBD);
    for (let i = 0; i < frames * NBD; i++) dB[i] = 10 * Math.log10((bandO[i] + 1e-9) / (bandM[i] + 1e-9));
    for (let b = 0; b < NBD; b++) { const a = []; for (let t = 0; t < frames; t += 2) a.push(dB[t * NBD + b]); a.sort((x, y) => x - y); med[b] = a[a.length >> 1]; }
    const raw = new Float32Array(frames);
    for (let t = 0; t < frames; t++) { let c = 0; for (let b = 0; b < NBD; b++) if (dB[t * NBD + b] - med[b] > 4) c++; raw[t] = c / NBD; }
    vad = new Float32Array(frames);
    const Wv = 6; let acc = 0;
    for (let t = 0; t < frames + Wv; t++) { if (t < frames) acc += raw[t]; if (t - 2 * Wv - 1 >= 0) acc -= raw[t - 2 * Wv - 1]; const c = t - Wv; if (c >= 0 && c < frames) vad[c] = acc / (2 * Wv + 1); }
  }
  const sens = opt.sens !== undefined ? opt.sens : 0.5; // 0 strict .. 1 loose
  // separated stems keep faint accompaniment bleed (~20 dB down): gate on loudness relative to the song's loud vocal level
  let dbGate = -999;
  if (opt.isolated) { const d = Array.from(frameDb).sort((a, b) => a - b); dbGate = d[Math.floor(d.length * 0.95)] - (16 + 8 * sens); }
  // song-adaptive baselines (20th percentile ≈ accompaniment-only level) + long-window VAD (~0.5 s) so held notes survive
  const pct = (a, p) => { const x = Array.from(a).sort((u, v) => u - v); return x[Math.floor(x.length * p)]; };
  let vadL = null, vb = 0, rb = 0;
  // smoothed residual ratio of the tracked pitch (~0.1 s)
  const rs = new Float32Array(frames);
  if (MRx) {
    const W2 = 3; for (let t = 0; t < frames; t++) { let a = 0, n = 0; for (let j = Math.max(0, t - W2); j <= Math.min(frames - 1, t + W2); j++) { a += rv[j]; n++; } rs[t] = a / n; }
    vadL = new Float32Array(frames); const W3 = 15; let acc = 0;
    for (let t = 0; t < frames + W3; t++) { if (t < frames) acc += vad[t]; if (t - 2 * W3 - 1 >= 0) acc -= vad[t - 2 * W3 - 1]; const c = t - W3; if (c >= 0 && c < frames) vadL[c] = acc / (2 * W3 + 1); }
    vb = pct(vadL, 0.2); rb = pct(rs, 0.2);
  }
  const vThr = 0.32 - 0.2 * sens;
  for (let t = 0; t < frames; t++) {
    if (vad) voiced[t] = (vadL[t] > vb + 0.07 - 0.04 * sens && rs[t] > rb + 0.06 - 0.03 * sens && sv[t] > lref[t] * (0.3 - 0.2 * sens) && sv[t] > ref * 0.06) ? 1 : 0;
    else if (opt.isolated) voiced[t] = ((frameDb[t] > dbGate && sv[t] > Math.max(lref[t] * (0.3 - 0.15 * sens), ref * (0.08 - 0.04 * sens)))
      || (frameDb[t] > dbGate + 8 && sv[t] > lref[t] * (0.1 - 0.05 * sens))) ? 1 : 0; // clearly loud: trust a weaker pitch
    else voiced[t] = (sv[t] > Math.max(lref[t] * (0.6 - 0.2 * sens), ref * 0.25)) ? 1 : 0;
  }
  // hysteresis: extend voiced regions through weaker frames while the pitch stays continuous (held notes)
  if (opt.isolated) {
    for (let pass = 0; pass < 2; pass++) {
      for (let t = 1; t < frames; t++) if (!voiced[t] && voiced[t - 1] && Math.abs(midi[t] - midi[t - 1]) < 0.8 && sv[t] > lref[t] * 0.1 && frameDb[t] > dbGate - 6) voiced[t] = 1;
      for (let t = frames - 2; t >= 0; t--) if (!voiced[t] && voiced[t + 1] && Math.abs(midi[t] - midi[t + 1]) < 0.8 && sv[t] > lref[t] * 0.1 && frameDb[t] > dbGate - 6) voiced[t] = 1;
    }
  }
  if (vad) {
    const weak = t => vadL[t] > vb + 0.02 && rs[t] > rb + 0.01 && sv[t] > lref[t] * 0.12;
    for (let pass = 0; pass < 2; pass++) {
      for (let t = 1; t < frames; t++) if (!voiced[t] && voiced[t - 1] && Math.abs(midi[t] - midi[t - 1]) < 0.8 && weak(t)) voiced[t] = 1;
      for (let t = frames - 2; t >= 0; t--) if (!voiced[t] && voiced[t + 1] && Math.abs(midi[t] - midi[t + 1]) < 0.8 && weak(t)) voiced[t] = 1;
    }
  }
  // segment into contours; drop short/weak ones; fix octave jumps vs local median
  const segs = [];
  let s0 = -1;
  for (let t = 0; t <= frames; t++) {
    const on = t < frames && voiced[t] && (s0 < 0 || Math.abs(midi[t] - midi[t - 1]) < 1.0);
    if (on && s0 < 0) s0 = t;
    else if (!on && s0 >= 0) { segs.push([s0, t]); s0 = (t < frames && voiced[t]) ? t : -1; }
  }
  const out = new Float32Array(frames).fill(NaN);
  const kept = [];
  for (const [a, b] of segs) {
    if (b - a < (vad ? 5 : 8)) continue;
    let ms = 0; for (let t = a; t < b; t++) ms += sv[t]; ms /= (b - a);
    let lr = 0; for (let t = a; t < b; t++) lr += lref[t]; lr /= (b - a);
    if (!vad && !opt.isolated && ms < Math.max(lr * 0.6, ref * 0.3)) continue;
    let pm = 0; for (let t = a; t < b; t++) pm += midi[t]; pm /= (b - a);
    kept.push({ a, b, pm });
  }
  for (let i = 0; i < kept.length; i++) {
    const sg = kept[i];
    // local median of neighbouring contour means (~6s window)
    const nb = [];
    for (let j = 0; j < kept.length; j++) {
      if (j === i) continue;
      const dt = Math.abs((kept[j].a + kept[j].b) / 2 - (sg.a + sg.b) / 2) * HOP / SR;
      if (dt < 6) nb.push(kept[j].pm);
    }
    let shift = 0;
    if (nb.length >= 3) {
      nb.sort((x, y) => x - y);
      const med = nb[nb.length >> 1];
      const d = sg.pm - med;
      if (d > 9) shift = -12; else if (d < -9) shift = 12;
    }
    for (let t = sg.a; t < sg.b; t++) out[t] = midi[t] + shift;
  }
  if (onProg) onProg(1);
  return { hop: HOP / SR, midi: out, sal: sv, vad, rv: rs };
}

// Summarize a melody: range from notes held >= minDur seconds.
function melodyStats(mel, minDur = 0.2) {
  const { midi, hop } = mel;
  const need = Math.max(3, Math.round(minDur / hop));
  const held = []; // {note, t}
  let run = 0, ref = NaN, acc = [];
  const flush = (tEnd) => {
    if (run >= need) { acc.sort((a, b) => a - b); held.push({ note: Math.round(acc[acc.length >> 1]), t: (tEnd - run) * hop, dur: run * hop }); }
  };
  for (let t = 0; t <= midi.length; t++) {
    const m = t < midi.length ? midi[t] : NaN;
    if (!isNaN(m) && !isNaN(ref) && Math.abs(m - ref) < 0.6) { run++; acc.push(m); }
    else { flush(t); run = isNaN(m) ? 0 : 1; ref = m; acc = isNaN(m) ? [] : [m]; }
  }
  if (!held.length) return null;
  // robust extremes: a note must be held at least twice (or ~0.5 s total) to count, so one-off glitches are ignored
  const cnt = {}, tot = {};
  for (const h of held) { cnt[h.note] = (cnt[h.note] || 0) + 1; tot[h.note] = (tot[h.note] || 0) + h.dur; }
  const ok = h => cnt[h.note] >= 2 || tot[h.note] >= 0.5;
  const pool = held.filter(ok).length ? held.filter(ok) : held;
  let lo = pool[0], hi = pool[0];
  for (const h of pool) { if (h.note < lo.note) lo = h; if (h.note > hi.note) hi = h; }
  const all = []; for (const m of midi) if (!isNaN(m)) all.push(m);
  all.sort((a, b) => a - b);
  const q = p => Math.round(all[Math.min(all.length - 1, Math.floor(all.length * p))]);
  return { lo: lo.note, loT: lo.t, hi: hi.note, hiT: hi.t, q25: q(0.25), q50: q(0.5), q75: q(0.75), voicedSec: all.length * hop };
}

// ---------- alignment ----------
// 16 kHz mono -> per-frame feature vectors (12 chroma + 6 band energies), hop 50 ms
function alignFeatures(x) {
  const N = 2048, HOP = 800, SR = 16000, D = 18;
  const fft = makeFFT(N);
  const win = new Float64Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const frames = Math.max(1, Math.floor((x.length - N) / HOP) + 1);
  const F = new Float32Array(frames * D);
  const re = new Float64Array(N), im = new Float64Array(N);
  const pc = new Int8Array(N / 2).fill(-1), band = new Int8Array(N / 2).fill(-1);
  const edges = [30, 120, 300, 700, 1500, 3000, 7000];
  for (let k = 1; k < N / 2; k++) {
    const f = k * SR / N;
    if (f >= 60 && f <= 2500) pc[k] = ((Math.round(12 * Math.log2(f / 440)) + 69) % 12 + 12) % 12;
    for (let b = 0; b < 6; b++) if (f >= edges[b] && f < edges[b + 1]) band[k] = b;
  }
  for (let t = 0; t < frames; t++) {
    const o = t * HOP;
    for (let i = 0; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    const v = F.subarray(t * D, t * D + D);
    for (let k = 1; k < N / 2; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      if (pc[k] >= 0) v[pc[k]] += Math.sqrt(p);
      if (band[k] >= 0) v[12 + band[k]] += p;
    }
    for (let b = 0; b < 6; b++) v[12 + b] = Math.log(1 + v[12 + b] * 1e3);
  }
  // normalise each dimension over time (z-score) then each frame to unit length
  for (let d = 0; d < D; d++) {
    let m = 0, s = 0;
    for (let t = 0; t < frames; t++) m += F[t * D + d]; m /= frames;
    for (let t = 0; t < frames; t++) { const e = F[t * D + d] - m; s += e * e; }
    s = Math.sqrt(s / frames) || 1;
    for (let t = 0; t < frames; t++) F[t * D + d] = (F[t * D + d] - m) / s;
  }
  for (let t = 0; t < frames; t++) {
    let n = 0; for (let d = 0; d < D; d++) n += F[t * D + d] ** 2; n = Math.sqrt(n) || 1;
    for (let d = 0; d < D; d++) F[t * D + d] /= n;
  }
  return { F, frames, D, hop: HOP / SR };
}

// Find offset (seconds) such that mrTime = origTime + offset. Returns { offset, conf }.
async function alignOffset(orig, mr, maxShift = 45) {
  const A = alignFeatures(orig); await new Promise(r => setTimeout(r, 0));
  const B = alignFeatures(mr);
  const D = A.D, maxL = Math.round(maxShift / A.hop);
  const minOverlap = Math.min(A.frames, B.frames, Math.round(20 / A.hop));
  const scores = [];
  for (let lag = -maxL; lag <= maxL; lag++) { // B[t+lag] ~ A[t]
    let s = 0, n = 0;
    const t0 = Math.max(0, -lag), t1 = Math.min(A.frames, B.frames - lag);
    if (t1 - t0 < minOverlap) { scores.push(-1); continue; }
    for (let t = t0; t < t1; t += 2) {
      let d = 0; const a = t * D, b = (t + lag) * D;
      for (let k = 0; k < D; k++) d += A.F[a + k] * B.F[b + k];
      s += d; n++;
    }
    scores.push(s / n);
  }
  let bi = 0; for (let i = 1; i < scores.length; i++) if (scores[i] > scores[bi]) bi = i;
  // second-best peak at least 1 s away
  let sec = -1; for (let i = 0; i < scores.length; i++) if (Math.abs(i - bi) > 1 / A.hop && scores[i] > sec) sec = scores[i];
  // refine with parabola
  let d = 0;
  if (bi > 0 && bi < scores.length - 1) { const a = scores[bi - 1], b = scores[bi], c = scores[bi + 1]; const den = a - 2 * b + c; if (den) d = 0.5 * (a - c) / den; }
  const lag = bi - maxL + d;
  const best = scores[bi];
  const conf = Math.max(0, Math.min(1, (best - Math.max(0, sec)) / 0.15));
  return { offset: lag * A.hop, conf, score: best };
}


// ===================== fuse.js =====================
// Fuse note events (from an onset-aware transcriber) with the frame-level pitch track.
// mel: {hop, midi: Float32Array (NaN = unvoiced)}, t0Off: frame-centre offset (s)
// ev: [[t0, t1, pitch, amp], ...]   fallback: [{t0,t1,m}] notes from the frame track
function fuseNotes(mel, ev, fallback, t0Off) {
  const { hop, midi } = mel;
  const fr = t => Math.round((t - t0Off) / hop);
  const cand = [];
  for (const [t0, t1, p0, amp] of ev) {
    if (t1 - t0 < 0.07 || amp < 0.2) continue;
    const a = Math.max(0, fr(t0)), b = Math.min(midi.length, fr(t1));
    if (b - a < 3) continue;
    let voiced = 0, ok = 0, oct = 0; const near = [];
    for (let i = a; i < b; i++) {
      const m = midi[i]; if (isNaN(m)) continue; voiced++;
      const d = m - p0;
      if (Math.abs(d) <= 1) { ok++; near.push(m); } else if (Math.abs(Math.abs(d) - 12) <= 1) oct++;
    }
    const n = b - a, vf = voiced / n;
    if (vf < 0.35) continue;                       // not sung (bleed, breath, intro…)
    let p = p0, agree = ok / Math.max(1, voiced);
    if (agree < 0.4) {
      if (oct / Math.max(1, voiced) >= 0.5) { // transcriber picked the wrong octave
        let s = 0, c = 0; for (let i = a; i < b; i++) if (!isNaN(midi[i]) && Math.abs(Math.abs(midi[i] - p0) - 12) <= 1) { s += midi[i]; c++; }
        p = Math.round(s / c); agree = oct / voiced;
      } else continue;
    } else if (near.length) { near.sort((x, y) => x - y); const md = Math.round(near[near.length >> 1]); if (Math.abs(md - p0) === 1 && near.filter(x => Math.round(x) === md).length > near.length * 0.6) p = md; }
    cand.push({ t0, t1, m: p, sc: agree * vf * (0.5 + amp) * (t1 - t0) });
  }
  cand.sort((x, y) => x.t0 - y.t0);
  // monophonic: resolve overlaps, keep the stronger note, trim the other
  const out = [];
  for (const c of cand) {
    const l = out[out.length - 1];
    if (l && c.t0 < l.t1 - 0.03) {
      if (c.sc > l.sc) { l.t1 = c.t0; if (l.t1 - l.t0 < 0.07) out.pop(); out.push(c); }
      else { c.t0 = l.t1; if (c.t1 - c.t0 >= 0.07) out.push(c); }
    } else { if (l && c.t0 < l.t1) c.t0 = l.t1; out.push(c); }
  }
  // fill long sung notes the transcriber missed
  for (const f of fallback) {
    if (f.t1 - f.t0 < 0.15) continue;
    let cov = 0; for (const o of out) cov += Math.max(0, Math.min(f.t1, o.t1) - Math.max(f.t0, o.t0));
    if (cov < 0.3 * (f.t1 - f.t0)) {
      // only the uncovered stretch
      let s = f.t0, e = f.t1;
      for (const o of out) { if (o.t1 > s && o.t0 <= s) s = o.t1; if (o.t0 < e && o.t1 >= e) e = o.t0; }
      if (e - s >= 0.12) out.push({ t0: s, t1: e, m: f.m, sc: 0 });
    }
  }
  out.sort((x, y) => x.t0 - y.t0);
  // merge contiguous same-pitch pieces
  const res = [];
  for (const o of out) { const l = res[res.length - 1]; if (l && l.m === o.m && o.t0 - l.t1 < 0.02) l.t1 = Math.max(l.t1, o.t1); else res.push({ t0: o.t0, t1: o.t1, m: o.m }); }
  return res;
}

// ===================== midi.js =====================
// Minimal Standard MIDI File parser -> [{t0, t1, m, vel, track}] (seconds), honours tempo map
function parseMidi(buf) {
  const d = new DataView(buf); let p = 0;
  const str = n => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p + i)); p += n; return s; };
  const u32 = () => { const v = d.getUint32(p); p += 4; return v; }, u16 = () => { const v = d.getUint16(p); p += 2; return v; };
  const vlq = () => { let v = 0, b; do { b = d.getUint8(p++); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  if (str(4) !== 'MThd') throw new Error('MIDI 파일이 아니에요');
  const hl = u32(); const fmt = u16(), ntr = u16(), div = u16(); p += hl - 6;
  if (div & 0x8000) throw new Error('SMPTE 시간 형식은 지원하지 않아요');
  const tempos = [{ tick: 0, us: 500000 }], raw = [];
  for (let tr = 0; tr < ntr && p < buf.byteLength; tr++) {
    const id = str(4), len = u32(), end = p + len;
    if (id !== 'MTrk') { p = end; continue; }
    let tick = 0, rs = 0; const open = {};
    while (p < end) {
      tick += vlq();
      let st = d.getUint8(p);
      if (st & 0x80) p++; else st = rs;
      if (st === 0xff) { const ty = d.getUint8(p++), l = vlq(); if (ty === 0x51 && l === 3) tempos.push({ tick, us: (d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2) }); p += l; continue; }
      if (st === 0xf0 || st === 0xf7) { p += vlq(); continue; }
      rs = st; const ty = st & 0xf0, ch = st & 0x0f;
      const a = d.getUint8(p++), b = (ty === 0xc0 || ty === 0xd0) ? 0 : d.getUint8(p++);
      if (ch === 9) continue; // drums
      const key = ch * 128 + a;
      if (ty === 0x90 && b > 0) { (open[key] = open[key] || []).push({ tick, vel: b }); }
      else if (ty === 0x80 || (ty === 0x90 && b === 0)) { const o = open[key] && open[key].shift(); if (o) raw.push({ s: o.tick, e: tick, m: a, vel: o.vel, track: tr }); }
    }
    p = end;
  }
  tempos.sort((x, y) => x.tick - y.tick);
  const sec = tk => { let s = 0, last = 0, us = 500000; for (const t of tempos) { if (t.tick > tk) break; s += (t.tick - last) * us / div / 1e6; last = t.tick; us = t.us; } return s + (tk - last) * us / div / 1e6; };
  return raw.map(n => ({ t0: sec(n.s), t1: sec(n.e), m: n.m, vel: n.vel, track: n.track })).filter(n => n.t1 > n.t0).sort((a, b) => a.t0 - b.t0);
}
// Find shift (s) and octave so that the MIDI best matches the analysed pitch track.
function alignMidi(notes, mel, t0Off) {
  const { hop, midi } = mel, n = midi.length;
  const best = { sc: -1, lag: 0, oct: 0 };
  for (const oct of [0, -12, 12]) for (let lagI = -150; lagI <= 150; lagI++) {
    const lag = lagI * 0.02; let ok = 0, tot = 0;
    for (const x of notes) {
      const a = Math.max(0, Math.round((x.t0 + lag - t0Off) / hop)), b = Math.min(n, Math.round((x.t1 + lag - t0Off) / hop));
      for (let i = a; i < b; i += 2) { const v = midi[i]; if (isNaN(v)) continue; tot++; if (Math.abs(v - (x.m + oct)) <= 0.5) ok++; }
    }
    const sc = tot ? ok / tot : 0;
    if (sc > best.sc + 1e-9) Object.assign(best, { sc, lag, oct });
  }
  return best;
}
// Tony / Sonic Visualiser note CSV: onset(s), frequency(Hz), duration(s)[, ...]
function parseNoteCsv(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const c = line.split(/[,\t;]/).map(s => parseFloat(s)); if (c.length < 3 || c.slice(0, 3).some(isNaN)) continue;
    const [t, f, d] = c; if (f <= 0 || d <= 0) continue;
    out.push({ t0: t, t1: t + d, m: Math.round(69 + 12 * Math.log2(f / 440)), vel: 100, track: 0 });
  }
  if (!out.length) {
    const two = text.split(/\r?\n/).filter(l => l.split(/[,\t;]/).length === 2).length;
    throw new Error(two ? '음 높이 곡선(Pitch track) 파일이에요. Tony에서 노트(Note track)를 내보내 주세요' : '노트 데이터를 찾지 못했어요');
  }
  return out.sort((a, b) => a.t0 - b.t0);
}

// ===================== syll.js =====================
// Syllable boundary detection on an isolated vocal (16 kHz mono).
// Returns boundary times (s): energy dips between vowel nuclei + consonant onsets.
function syllableBounds(x, sens = 0.5) {
  const SR = 16000, N = 512, H = 160; // 10 ms hop
  const fft = makeFFT(N), win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const F = Math.max(1, Math.floor((x.length - N) / H) + 1);
  const eV = new Float32Array(F), flux = new Float32Array(F);
  const re = new Float64Array(N), im = new Float64Array(N), prev = new Float64Array(N / 2);
  const kV0 = Math.floor(150 * N / SR), kV1 = Math.ceil(1500 * N / SR), kC0 = Math.floor(2000 * N / SR), kC1 = Math.ceil(7000 * N / SR);
  for (let t = 0; t < F; t++) {
    const o = t * H; for (let i = 0; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let ev = 0, fl = 0;
    for (let k = 1; k < N / 2; k++) {
      const m = Math.hypot(re[k], im[k]);
      if (k >= kV0 && k <= kV1) ev += m * m;
      if (k >= kC0 && k <= kC1) { const d = m - prev[k]; if (d > 0) fl += d; }
      prev[k] = m;
    }
    eV[t] = 10 * Math.log10(ev + 1e-10); flux[t] = fl;
  }
  // smooth vowel-band energy (~30 ms)
  const sm = new Float32Array(F);
  for (let t = 0; t < F; t++) { let a = 0, n = 0; for (let j = t - 1; j <= t + 1; j++) if (j >= 0 && j < F) { a += eV[j]; n++; } sm[t] = a / n; }
  const sorted = Array.from(sm).sort((a, b) => a - b), loud = sorted[Math.floor(F * 0.95)];
  const floorDb = loud - 35;
  // normalise flux
  const fs = Array.from(flux).sort((a, b) => a - b), fRef = fs[Math.floor(F * 0.98)] || 1;
  const depth = 4.5 - 2.5 * sens; // dB dip needed between two nuclei
  const out = [];
  // 1) energy dips: local minimum with >= depth dB rise on both sides within 120 ms
  for (let t = 3; t < F - 3; t++) {
    if (!(sm[t] <= sm[t - 1] && sm[t] < sm[t + 1])) continue;
    if (sm[t] < floorDb) continue; // silence handled elsewhere (notes already end)
    let l = -1e9, r = -1e9;
    for (let j = Math.max(0, t - 12); j < t; j++) l = Math.max(l, sm[j]);
    for (let j = t + 1; j <= Math.min(F - 1, t + 12); j++) r = Math.max(r, sm[j]);
    if (l - sm[t] >= depth && r - sm[t] >= depth) out.push({ t: t * H / SR + N / 2 / SR, s: Math.min(l, r) - sm[t], k: 'dip' });
  }
  // 2) consonant bursts: strong high-band flux peak while vowel energy dips a little
  for (let t = 2; t < F - 2; t++) {
    const f = flux[t] / fRef;
    if (f > 0.55 - 0.25 * sens && flux[t] >= flux[t - 1] && flux[t] > flux[t + 1]) {
      let mx = -1e9; for (let j = Math.max(0, t - 8); j < t; j++) mx = Math.max(mx, sm[j]);
      if (sm[t] > floorDb && mx - sm[t] >= 1.5) out.push({ t: t * H / SR + N / 2 / SR, s: Math.min(mx - sm[t], 5.9), k: 'cons' });
    }
  }
  out.sort((a, b) => a.t - b.t);
  // merge boundaries closer than 70 ms (keep strongest)
  const res = [];
  for (const b of out) { const l = res[res.length - 1]; if (l && b.t - l.t < 0.07) { if (b.s > l.s) res[res.length - 1] = b; } else res.push(b); }
  return res;
}
// Split notes at syllable boundaries. A boundary inside a note is accepted only if it is a clear break
// (energy dip >= strongDb) or the pitch track breaks (unvoiced) — so vibrato on long notes is kept whole.
function splitAtSyllables(notes, bounds, mel, t0Off, minLen = 0.08, strongDb = 8) {
  const { hop, midi } = mel;
  const med = (a, b) => { const v = []; for (let i = Math.max(0, a); i < Math.min(midi.length, b); i++) if (!isNaN(midi[i])) v.push(midi[i]); v.sort((x, y) => x - y); return v.length ? v[v.length >> 1] : NaN; };
  const gap = (a, b) => { let n = 0; for (let i = Math.max(0, a); i < Math.min(midi.length, b); i++) if (isNaN(midi[i])) n++; return n; };
  const out = []; let bi = 0;
  for (const n of notes) {
    while (bi < bounds.length && bounds[bi].t < n.t0) bi++;
    let s = n.t0;
    for (let j = bi; j < bounds.length && bounds[j].t < n.t1; j++) {
      const b = bounds[j], t = b.t;
      if (t - s < minLen || n.t1 - t < minLen) continue;
      const i = Math.round((t - t0Off) / hop), w = Math.round(0.06 / hop);
      const before = med(i - w, i - 1), after = med(i + 1, i + w);
      const pitchChange = !isNaN(before) && !isNaN(after) && Math.abs(after - before) >= 0.6;
      const unvoiced = gap(i - 2, i + 3) >= 2;
      if (b.s >= strongDb || unvoiced) { out.push({ ...n, t0: s, t1: t }); s = t; }
    }
    out.push({ ...n, t0: s, t1: n.t1 });
  }
  return out;
}
// Stretch notes to the audible syllable: start at the consonant/attack, end when the sound fades.
// x: isolated vocal (16 kHz mono). Never overlaps neighbours. back/fwd: max extension (s).
function stretchToVoice(notes, x, mel, t0Off, back = 0.15, fwd = 0.2) {
  const SR = 16000, H = 160, F = Math.floor(x.length / H);
  const env = new Float32Array(F);
  for (let i = 0; i < F; i++) { let s = 0; for (let j = i * H; j < i * H + H; j++) s += x[j] * x[j]; env[i] = 10 * Math.log10(s / H + 1e-12); }
  const srt = Array.from(env).sort((a, b) => a - b), gate = srt[Math.floor(F * 0.95)] - 24;
  const pitchAt = t => { const i = Math.round((t - t0Off) / mel.hop); return i >= 0 && i < mel.midi.length ? mel.midi[i] : NaN; };
  const ns = notes.map(n => ({ ...n })).sort((a, b) => a.t0 - b.t0);
  for (let k = 0; k < ns.length; k++) {
    const n = ns[k], prevEnd = k ? ns[k - 1].t1 : 0, nextStart = k < ns.length - 1 ? ns[k + 1].t0 : 1e9;
    // backwards: consonant / attack before the pitched part
    let i = Math.floor(n.t0 * SR / H), lim = Math.max(Math.ceil(prevEnd * SR / H), i - Math.round(back * SR / H));
    while (i - 1 >= lim && env[i - 1] > gate) i--;
    n.t0 = Math.min(n.t0, i * H / SR);
    // forwards: sustain/release while it is still loud and not drifting to another note
    let j = Math.ceil(n.t1 * SR / H), lim2 = Math.min(Math.floor(nextStart * SR / H), j + Math.round(fwd * SR / H), F - 1);
    while (j + 1 <= lim2 && env[j] > gate + 3) { const p = pitchAt(j * H / SR); if (!isNaN(p) && Math.abs(p - n.m) > 1.5) break; j++; }
    n.t1 = Math.max(n.t1, j * H / SR);
  }
  return ns;
}

export { makeFFT, pitchShiftChannels, yinPitch, extractMelody, melodyStats, alignOffset, MEL, fuseNotes, parseMidi, alignMidi, parseNoteCsv, syllableBounds, splitAtSyllables, stretchToVoice }
