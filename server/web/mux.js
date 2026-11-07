// Przepakowanie segmentów HLS (MPEG-TS z H.264 + AAC) na fragmenty MP4 dla Media Source Extensions.
// Bez kodowania – tylko zmiana opakowania, więc podgląd kanału kosztuje przeglądarkę tyle, co zwykły odtwarzacz.
// Moduł bez DOM (test w Node: tests/e2e.cjs).

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
const TS = 90000; // zegar MPEG-TS i ścieżki obrazu

// ---------- MPEG-TS ----------

function pesTime(b, i) {
  return (b[i] & 0x0e) * 536870912 + b[i + 1] * 4194304 + (b[i + 2] & 0xfe) * 16384 + b[i + 3] * 128 + (b[i + 4] >> 1);
}

/** Pakiety PES obrazu i dźwięku z jednego segmentu: {video: [{pts, dts, data}], audio: [...], videoType, audioType}. */
export class TsDemuxer {
  constructor() { this.pmt = -1; this.vpid = -1; this.apid = -1; this.videoType = 0; this.audioType = 0; }

  parse(buf) {
    const out = { video: [], audio: [] };
    const open = new Map();
    let off = buf.indexOf(0x47);
    while (off >= 0 && off + 188 <= buf.length) {
      if (buf[off] !== 0x47) { off = buf.indexOf(0x47, off + 1); continue; }
      const start = buf[off + 1] & 0x40;
      const pid = ((buf[off + 1] & 0x1f) << 8) | buf[off + 2];
      const afc = (buf[off + 3] >> 4) & 3;
      let p = off + 4;
      if (afc & 2) p += 1 + buf[off + 4];
      const payload = afc & 1 && p < off + 188 ? buf.subarray(p, off + 188) : null;
      off += 188;
      if (!payload) continue;
      if (pid === 0) { if (start) this.pat(payload); continue; }
      if (pid === this.pmt) { if (start) this.pmtTable(payload); continue; }
      if (pid !== this.vpid && pid !== this.apid) continue;
      let pes = open.get(pid);
      if (start) {
        if (pes) this.flush(pid, pes, out);
        pes = { chunks: [], len: 0 };
        open.set(pid, pes);
      }
      if (pes) { pes.chunks.push(payload); pes.len += payload.length; }
    }
    for (const [pid, pes] of open) this.flush(pid, pes, out);
    out.videoType = this.videoType;
    out.audioType = this.audioType;
    return out;
  }

  pat(d) {
    const q = d[0] + 1, end = q + 3 + (((d[q + 1] & 0x0f) << 8) | d[q + 2]) - 4;
    for (let i = q + 8; i + 4 <= end; i += 4) {
      if ((d[i] << 8 | d[i + 1]) !== 0) { this.pmt = ((d[i + 2] & 0x1f) << 8) | d[i + 3]; return; }
    }
  }

  pmtTable(d) {
    const q = d[0] + 1, end = q + 3 + (((d[q + 1] & 0x0f) << 8) | d[q + 2]) - 4;
    let i = q + 12 + (((d[q + 10] & 0x0f) << 8) | d[q + 11]);
    while (i + 5 <= end) {
      const type = d[i], pid = ((d[i + 1] & 0x1f) << 8) | d[i + 2];
      if (this.vpid < 0 && (type === 0x1b || type === 0x24)) { this.vpid = pid; this.videoType = type; }
      if (this.apid < 0 && (type === 0x0f || type === 0x11 || type === 0x81)) { this.apid = pid; this.audioType = type; }
      i += 5 + (((d[i + 3] & 0x0f) << 8) | d[i + 4]);
    }
  }

  flush(pid, pes, out) {
    if (pes.len < 9) return;
    const b = new Uint8Array(pes.len);
    let o = 0;
    for (const c of pes.chunks) { b.set(c, o); o += c.length; }
    if (b[0] !== 0 || b[1] !== 0 || b[2] !== 1) return;
    const declared = (b[4] << 8) | b[5];
    if (declared && declared + 6 > b.length) return; // ucięty na końcu segmentu
    const flags = b[7] >> 6, hdr = 9 + b[8];
    if (!(flags & 2) || hdr > b.length) return;
    const pts = pesTime(b, 9);
    const dts = flags === 3 ? pesTime(b, 14) : pts;
    const data = b.subarray(hdr, declared ? declared + 6 : b.length);
    (pid === this.vpid ? out.video : out.audio).push({ pts, dts, data });
  }
}

// ---------- H.264 ----------

/** Jednostki NAL z zapisu Annex B (kody startu 00 00 01 / 00 00 00 01). */
export function nalUnits(d) {
  const units = [];
  let start = -1;
  for (let i = 0; i + 2 < d.length;) {
    if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 1) {
      if (start >= 0) { let e = i; while (e > start && d[e - 1] === 0) e--; units.push(d.subarray(start, e)); }
      i += 3; start = i;
    } else i++;
  }
  if (start >= 0 && start < d.length) units.push(d.subarray(start));
  return units;
}

class Bits {
  constructor(nal) {
    const b = [];
    for (let i = 1; i < nal.length; i++) { // bez nagłówka NAL i bajtów 03 chroniących przed kodem startu
      if (i >= 3 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue;
      b.push(nal[i]);
    }
    this.b = b; this.p = 0;
  }
  u(n) { let v = 0; for (let k = 0; k < n; k++) { v = v * 2 + ((this.b[this.p >> 3] >> (7 - (this.p & 7))) & 1); this.p++; } return v; }
  ue() { let z = 0; while (this.u(1) === 0 && z < 32) z++; return 2 ** z - 1 + this.u(z); }
  se() { const v = this.ue(); return v & 1 ? (v + 1) / 2 : -v / 2; }
}

/** Rozmiar obrazu z SPS (z przycięciem). */
export function spsSize(sps) {
  const r = new Bits(sps);
  const profile = r.u(8); r.u(16); r.ue();
  let chroma = 1;
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
    chroma = r.ue();
    if (chroma === 3) r.u(1);
    r.ue(); r.ue(); r.u(1);
    if (r.u(1)) {
      for (let i = 0; i < (chroma === 3 ? 12 : 8); i++) {
        if (!r.u(1)) continue;
        let last = 8, next = 8;
        for (let j = 0; j < (i < 6 ? 16 : 64); j++) {
          if (next) next = (last + r.se() + 256) % 256;
          last = next || last;
        }
      }
    }
  }
  r.ue();
  const poc = r.ue();
  if (poc === 0) r.ue();
  else if (poc === 1) { r.u(1); r.se(); r.se(); for (let n = r.ue(); n > 0; n--) r.se(); }
  r.ue(); r.u(1);
  const w = r.ue() + 1, hgt = r.ue() + 1, frameOnly = r.u(1);
  if (!frameOnly) r.u(1);
  r.u(1);
  let cl = 0, cr = 0, ct = 0, cb = 0;
  if (r.u(1)) { cl = r.ue(); cr = r.ue(); ct = r.ue(); cb = r.ue(); }
  const ux = chroma === 1 || chroma === 2 ? 2 : 1;
  const uy = (chroma === 1 ? 2 : 1) * (2 - frameOnly);
  return { width: w * 16 - (cl + cr) * ux, height: (2 - frameOnly) * hgt * 16 - (ct + cb) * uy };
}

const hex2 = (n) => n.toString(16).padStart(2, '0');

// ---------- MP4 ----------

function box(type, ...parts) {
  const flat = parts.flat(Infinity);
  let size = 8;
  for (const p of flat) size += p.length;
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let o = 8;
  for (const p of flat) { out.set(p, o); o += p.length; }
  return out;
}
const u8 = (...v) => Uint8Array.from(v);
const u16 = (v) => u8(v >> 8 & 255, v & 255);
const u32 = (v) => u8(v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255);
const u64 = (v) => [u32(Math.floor(v / 4294967296)), u32(v % 4294967296 >>> 0)];
const zeros = (n) => new Uint8Array(n);
const str = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const full = (type, version, flags, ...parts) => box(type, u32((version << 24) | flags), ...parts);
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32);

function sampleEntry(t) {
  if (t.kind === 'video') {
    const avcC = box('avcC', u8(1, t.sps[1], t.sps[2], t.sps[3], 0xff, 0xe1), u16(t.sps.length), t.sps, u8(1), u16(t.pps.length), t.pps);
    return box('avc1', zeros(6), u16(1), zeros(16), u16(t.width), u16(t.height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x18), u16(0xffff), avcC);
  }
  const asc = u16((t.object << 11) | (t.rateIndex << 7) | (t.channels << 3));
  const dcd = [u8(4, 17, 0x40, 0x15, 0, 0, 0), u32(0), u32(0), u8(5, 2), asc];
  const esds = full('esds', 0, 0, u8(3, 25), u16(t.id), u8(0), dcd, u8(6, 1, 2));
  return box('mp4a', zeros(6), u16(1), zeros(8), u16(t.channels), u16(16), zeros(4), u32(t.rate * 65536), esds);
}

/** Segment inicjujący (ftyp + moov) jednej ścieżki. */
export function initSegment(t) {
  const video = t.kind === 'video';
  const empty = (type) => full(type, 0, 0, u32(0));
  const trak = box('trak',
    full('tkhd', 0, 3, u32(0), u32(0), u32(t.id), u32(0), u32(0), zeros(8), u16(0), u16(0), u16(video ? 0 : 0x0100), u16(0), MATRIX,
      u32((video ? t.width : 0) * 65536), u32((video ? t.height : 0) * 65536)),
    box('mdia',
      full('mdhd', 0, 0, u32(0), u32(0), u32(t.timescale), u32(0), u16(0x55c4), u16(0)),
      full('hdlr', 0, 0, u32(0), str(video ? 'vide' : 'soun'), zeros(12), str(video ? 'VideoHandler\0' : 'SoundHandler\0')),
      box('minf',
        video ? full('vmhd', 0, 1, zeros(8)) : full('smhd', 0, 0, zeros(4)),
        box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
        box('stbl', full('stsd', 0, 0, u32(1), sampleEntry(t)), empty('stts'), empty('stsc'), full('stsz', 0, 0, u32(0), u32(0)), empty('stco')))));
  const moov = box('moov',
    full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(0), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(0xffffffff)),
    trak,
    box('mvex', full('trex', 0, 0, u32(t.id), u32(1), u32(0), u32(0), u32(0))));
  return concat([box('ftyp', str('isom'), u32(1), str('isomiso6avc1mp41')), moov]);
}

/** Fragment (moof + mdat): samples = [{data, duration, cts, key}], base = czas dekodowania pierwszej próbki. */
export function fragment(t, seq, base, samples) {
  const trunLen = 12 + 8 + samples.length * 16;
  const moofLen = 8 + 16 + 8 + 16 + 20 + trunLen;
  const rows = samples.map((s) => [u32(s.duration), u32(s.data.length), u32(s.key ? 0x02000000 : 0x01010000), u32(s.cts | 0)]);
  const moof = box('moof',
    full('mfhd', 0, 0, u32(seq)),
    box('traf',
      full('tfhd', 0, 0x020000, u32(t.id)),
      full('tfdt', 1, 0, u64(base)),
      full('trun', 1, 0xf01, u32(samples.length), u32(moofLen + 8), rows)));
  return concat([moof, box('mdat', samples.map((s) => s.data))]);
}

export function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const sameBytes = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);

// ---------- przepakowanie segmentów ----------

/**
 * Segment po segmencie: push(ts, {pdt, disc}) → {video, audio, start, end, error}.
 * video/audio = {codec, init?, data} (init tylko przy pierwszym segmencie i zmianie parametrów).
 * Oś czasu: gdy playlista ma PROGRAM-DATE-TIME, czas w MSE = (pdt − epoch) s, czyli zegar anteny.
 */
export class Transmuxer {
  constructor() {
    this.demux = new TsDemuxer();
    this.offset = null;   // przesunięcie znaczników PES → oś odtwarzacza (90 kHz)
    this.epoch = null;    // ms; początek osi odtwarzacza przy PROGRAM-DATE-TIME
    this.end = 0;         // koniec poprzedniego segmentu na osi (90 kHz)
    this.v = { kind: 'video', id: 1, timescale: TS, seq: 0, dur: 3600, started: false };
    this.a = { kind: 'audio', id: 2, seq: 0 };
  }

  push(ts, { pdt = null, disc = false } = {}) {
    const d = this.demux.parse(ts);
    const res = { video: null, audio: null, start: 0, end: 0, error: null };
    if (d.videoType === 0x24) { res.error = 'HEVC'; return res; }
    const firstV = d.video.length ? d.video[0].pts : null;
    const firstA = d.audio.length ? d.audio[0].pts : null;
    const first = firstV ?? firstA;
    if (first == null) return res;
    if (pdt != null && this.epoch == null) this.epoch = pdt - 10000;
    const want = pdt != null ? (pdt - this.epoch) * 90 : this.end || TS;
    if (this.offset == null || disc || Math.abs(first + this.offset - want) > TS / 2) this.offset = Math.round(want - first);
    res.video = this.videoFragment(d.video);
    res.audio = d.audioType === 0x0f ? this.audioFragment(d.audio) : null;
    res.start = (first + this.offset) / TS;
    res.end = this.end / TS;
    return res;
  }

  videoFragment(list) {
    const t = this.v;
    const samples = [];
    for (const pes of list) {
      const nals = [];
      let key = false;
      for (const n of nalUnits(pes.data)) {
        const type = n[0] & 0x1f;
        if (type === 7) { if (!sameBytes(n, t.sps)) { t.sps = n.slice(); t.changed = true; } continue; }
        if (type === 8) { if (!sameBytes(n, t.pps)) { t.pps = n.slice(); t.changed = true; } continue; }
        if (type === 9 || type === 12) continue;
        if (type === 5) key = true;
        nals.push(u32(n.length), n);
      }
      if (!nals.length) continue;
      samples.push({ dts: pes.dts + this.offset, pts: pes.pts + this.offset, key, data: concat(nals) });
    }
    if (!t.sps || !t.pps) return null;
    if (!t.started) {
      const k = samples.findIndex((s) => s.key);
      if (k < 0) return null;
      samples.splice(0, k);
      t.started = true;
    }
    if (!samples.length) return null;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (i + 1 < samples.length) t.dur = Math.max(1, samples[i + 1].dts - s.dts);
      s.duration = t.dur;
      s.cts = s.pts - s.dts;
    }
    const out = { codec: 'avc1.' + hex2(t.sps[1]) + hex2(t.sps[2]) + hex2(t.sps[3]) };
    if (t.changed) { Object.assign(t, spsSize(t.sps)); out.init = initSegment(t); t.changed = false; }
    const base = Math.max(0, samples[0].dts);
    out.data = fragment(t, ++t.seq, base, samples);
    this.end = Math.max(this.end, samples[samples.length - 1].dts + t.dur);
    return out;
  }

  audioFragment(list) {
    const t = this.a;
    const frames = [];
    let conf = null;
    for (const pes of list) {
      const d = pes.data;
      for (let i = 0; i + 7 <= d.length;) {
        if (d[i] !== 0xff || (d[i + 1] & 0xf6) !== 0xf0) { i++; continue; }
        const hdr = d[i + 1] & 1 ? 7 : 9;
        const len = ((d[i + 3] & 3) << 11) | (d[i + 4] << 3) | (d[i + 5] >> 5);
        if (len <= hdr || i + len > d.length) break;
        conf = { object: (d[i + 2] >> 6) + 1, rateIndex: (d[i + 2] >> 2) & 15, channels: ((d[i + 2] & 1) << 2) | (d[i + 3] >> 6) };
        frames.push({ pts: frames.length ? null : pes.pts, data: d.subarray(i + hdr, i + len) });
        i += len;
      }
    }
    if (!conf || !frames.length || !AAC_RATES[conf.rateIndex]) return null;
    const out = { codec: 'mp4a.40.' + conf.object };
    if (t.object !== conf.object || t.rateIndex !== conf.rateIndex || t.channels !== conf.channels) {
      Object.assign(t, conf, { rate: AAC_RATES[conf.rateIndex], timescale: AAC_RATES[conf.rateIndex] });
      out.init = initSegment(t);
    }
    const base = Math.max(0, Math.round((list[0].pts + this.offset) * t.rate / TS));
    out.data = fragment(t, ++t.seq, base, frames.map((f) => ({ data: f.data, duration: 1024, cts: 0, key: true })));
    return out;
  }
}
