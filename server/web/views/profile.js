// Profile kodowania (R5): jak silnik Next koduje kanał. Odpowiednik FFmpeg Profiles + FFmpeg Editor legacy.

import { VIEWS, h, cmd, pl, pill, btn, panel, table, toast, confirmDlg, route, has, cmdNote, enumValues } from '../core.js';
import { form } from '../form.js';
import { crudView } from '../parts.js';

/**
 * Pola tylko dla starego silnika legacy (ThreadCount, PadMode, VideoProfile, VideoPreset, AllowBFrames,
 * VaapiDisplay, QsvExtraHardwareFrames, NormalizeColors) panel pokazuje tylko do odczytu w podpowiedzi –
 * zapis zostawia ich wartości bez zmian (z profilu albo z NewFFmpegProfile).
 */
const profName = (p) => p.Name;
const vid = (v) => v.NormalizeVideo;
const aud = (v) => v.NormalizeAudio;

function hwHint(supported) {
  return (v) => {
    const k = v.HardwareAcceleration;
    const list = `Sprzęt zgłoszony przez ffmpeg legacy: ${supported.map(pl).join(', ')}.`;
    if (!k || k === 'None') return list + ' Bez akceleracji kodowanie idzie na procesorze.';
    if (!supported.includes(k)) return `UWAGA: ffmpeg legacy nie zgłasza ${pl(k)} na tej maszynie – kanały z tym profilem pójdą programowo albo nie wystartują. ` + list;
    return list + (k === 'Vaapi' ? ' VAAPI potrzebuje węzła renderowania (/dev/dri/renderD*) przekazanego do kontenera legacy.' : '');
  };
}

/** Podpowiedź akceleracji wg silnika Next (K5); `probe === false` – Next jeszcze nie sprawdził sprzętu. */
function nextHint(probe, supported) {
  return (v) => {
    const c = nextCheck(v, probe || null);
    if (c.status === 'software') return hwHint(supported)(v);
    const [kind, text] = nextCheckText(v, c);
    const codecs = c.entry ? accelCodecs(c.entry) : null;
    return (kind === 'ok' ? '✓ ' : kind === 'bad' ? '✗ ' : kind === 'warn' ? '⚠ ' : '') + text
      + (codecs ? ` Dekodowanie: ${codecs.dec.join(', ') || '—'}; kodowanie: ${codecs.enc.join(', ') || '—'}.` : '');
  };
}

function loudHint(v) {
  if (v.NormalizeLoudnessMode !== 'LoudNorm') return 'Telewizja w Polsce: −23 LUFS (EBU R128) – włącz loudnorm, żeby kanał nie był głośniejszy od innych.';
  const t = v.TargetLoudness;
  if (t == null) return 'Podaj poziom, dla TV w Polsce −23 LUFS.';
  return t === -23 ? 'Zgodne z EBU R128 (TV w Polsce).' : `Dla TV w Polsce zalecane −23 LUFS (teraz ${t}).`;
}

// ---------- K5: stan silnika Next (GetNextProbe – legacy ≥ 26.12.0) ----------
// Pola opisu Next mają nazwy snake_case (JsonPropertyName w legacy), wyliczenia – nazwy C# z mostu (np. „Available”);
// `nv` czyta oba zapisy, żeby panel nie zależał od serializacji.
const nv = (o, snake, pascal) => (o == null ? undefined : o[snake] ?? o[pascal]);
const ACCEL = { Amf: 'amf', Nvenc: 'cuda', Qsv: 'qsv', Rkmpp: 'rkmpp', Vaapi: 'vaapi', VideoToolbox: 'videotoolbox' };
const DRIVER = { iHD: 'ihd', i965: 'i965', RadeonSI: 'radeonsi' };
export const DEFAULT_VAAPI_DEVICE = '/dev/dri/renderD128';
const available = (a) => String(nv(a, 'status', 'Status') || '').toLowerCase() === 'available';
const encodes = (a, fmt, depth) => (nv(a, 'encode', 'Encode') || []).some((e) => nv(e, 'format', 'Format') === fmt && (nv(e, 'bit_depths', 'BitDepths') || []).map(Number).includes(depth));
/** Akceleracje z opisu sprzętu Next (`NextProbeResult.Capability.accels`). */
export const accels = (probe) => nv(nv(probe, 'Capability', 'capability'), 'accels', 'Accels') || [];

/**
 * Czy profil zakoduje się sprzętowo w silniku Next – ta sama logika co `NextHardware.Check` legacy (FFmpeg Editor 26.12).
 * Wynik: { status: 'software'|'not-probed'|'unsupported'|'not-on-platform'|'device-not-probed'|'unavailable'|'software-encode'|'hardware', entry, working }.
 */
export function nextCheck(v, probe) {
  const kind = v.HardwareAcceleration;
  if (!kind || kind === 'None') return { status: 'software', working: [] };
  const accel = ACCEL[kind];
  if (!accel) return { status: 'unsupported', working: [] };
  if (!probe) return { status: 'not-probed', working: [] };
  const fmt = v.VideoFormat === 'Hevc' ? 'hevc' : v.VideoFormat === 'Mpeg2Video' ? 'mpeg2video' : 'h264';
  const depth = fmt !== 'mpeg2video' && v.BitDepth === 'TenBit' ? 10 : 8;
  const same = accels(probe).filter((a) => nv(a, 'accel', 'Accel') === accel);
  if (!same.length) return { status: 'not-on-platform', working: [] };
  const dev = (v.VaapiDevice || '').trim() || DEFAULT_VAAPI_DEVICE;
  const drv = DRIVER[v.VaapiDriver] ?? null;
  const entry = accel === 'vaapi' ? same.find((a) => nv(a, 'device', 'Device') === dev && (nv(a, 'driver', 'Driver') ?? null) === drv) : same[0];
  const working = same.filter((a) => a !== entry && available(a) && encodes(a, fmt, depth));
  if (!entry) return { status: 'device-not-probed', working, fmt, depth };
  const status = available(entry) ? (encodes(entry, fmt, depth) ? 'hardware' : 'software-encode') : 'unavailable';
  return { status, entry, working, fmt, depth };
}

/** Opis wyniku `nextCheck` po polsku – jak komunikaty edytora profilu legacy. */
export function nextCheckText(v, c) {
  const k = pl(v.HardwareAcceleration);
  const what = c.fmt ? `${c.fmt} ${c.depth}-bit` : '';
  const alt = c.working?.length ? ` Działa: ${c.working.map((a) => [nv(a, 'accel', 'Accel'), nv(a, 'device', 'Device'), nv(a, 'driver', 'Driver')].filter(Boolean).join(' ')).join(', ')}.` : '';
  const err = c.entry && nv(c.entry, 'error', 'Error') ? ` (${nv(c.entry, 'error', 'Error')})` : '';
  return {
    software: ['', ''],
    'not-probed': ['info', 'Silnik Next nie sprawdził jeszcze sprzętu – profilu nie da się ocenić (Diagnostyka → Silnik Next → „Sprawdź ponownie”).'],
    unsupported: ['warn', `Silnik Next nie obsługuje ${k} – kanały pójdą programowo.`],
    'not-on-platform': ['warn', `Silnik Next nie użyje ${k} na tej maszynie – kanały pójdą programowo.`],
    'device-not-probed': ['warn', `Next nie sprawdził tego urządzenia / sterownika VAAPI – nie wiadomo, czy zadziała.${alt}`],
    unavailable: ['bad', `Kanały pójdą programowo na tej maszynie${err}.${alt}`],
    'software-encode': ['warn', `${k} nie zakoduje ${what} na tej maszynie – dekodowanie i filtry sprzętowo, kodowanie programowo.${alt}`],
    hardware: ['ok', `Działa: ${k} koduje ${what} sprzętowo w silniku Next.`],
  }[c.status];
}

/** Kodeki dekodowania i kodowania sprzętowego akceleracji (do podpowiedzi i Diagnostyki). */
export function accelCodecs(a) {
  const dec = (nv(a, 'decode', 'Decode') || []).map((d) => nv(d, 'format', 'Format'));
  const enc = (nv(a, 'encode', 'Encode') || []).map((e) => `${nv(e, 'format', 'Format')} ${(nv(e, 'bit_depths', 'BitDepths') || []).join('/')}-bit`);
  return { dec, enc };
}

// ---------- K4: własne rozdzielczości (CreateCustomResolution, DeleteCustomResolution) ----------
/** Szerokość i wysokość własnej rozdzielczości: liczby parzyste 16–7680 × 16–4320 (kodery wymagają parzystych). */
export function checkResolution(w, hgt, existing) {
  const W = Number(w), H = Number(hgt);
  if (!Number.isInteger(W) || !Number.isInteger(H)) return 'podaj szerokość i wysokość w pikselach (liczby całkowite)';
  if (W < 16 || W > 7680 || H < 16 || H > 4320) return 'zakres: szerokość 16–7680, wysokość 16–4320';
  if (W % 2 || H % 2) return 'szerokość i wysokość muszą być parzyste (wymóg koderów H.264/HEVC)';
  if (existing.some((r) => r.Width === W && r.Height === H)) return `rozdzielczość ${W}x${H} już jest`;
  return null;
}

function resolutionsPanel(resolutions, profiles) {
  const canAdd = has('CreateCustomResolution'), canDel = has('DeleteCustomResolution');
  const w = h('input', { id: 'res-w', type: 'number', min: 16, max: 7680, step: 2, placeholder: 'szer.', 'aria-label': 'Szerokość' });
  const hh = h('input', { id: 'res-h', type: 'number', min: 16, max: 4320, step: 2, placeholder: 'wys.', 'aria-label': 'Wysokość' });
  const add = async () => {
    const e = checkResolution(w.value, hh.value, resolutions);
    if (e) { toast('Rozdzielczość: ' + e, 'bad'); return; }
    try { await cmd('CreateCustomResolution', { Width: Number(w.value), Height: Number(hh.value) }); toast(`Dodano ${w.value}x${hh.value}`, 'ok'); route(true); } catch (err) { toast('Legacy odrzucił rozdzielczość: ' + err.message, 'bad'); }
  };
  const del = async (r) => {
    const used = profiles.filter((p) => p.Resolution?.Id === r.Id);
    if (!(await confirmDlg('Usuń rozdzielczość', used.length ? `Rozdzielczość ${r.Name} mają profile: ${used.map((p) => p.Name).join(', ')}. Legacy może odmówić. Usunąć?` : `Usunąć własną rozdzielczość ${r.Name}?`, 'Usuń'))) return;
    try { await cmd('DeleteCustomResolution', { ResolutionId: r.Id }); toast(`Usunięto ${r.Name}`, 'ok'); route(true); } catch (err) { toast('Legacy odrzucił usunięcie: ' + err.message, 'bad'); }
  };
  return panel('Rozdzielczości', h('span', { class: 'dim' }, String(resolutions.length)),
    table(resolutions, [['Name', 'Nazwa'], [(r) => `${r.Width} × ${r.Height}`, 'Piksele', { class: 'num' }],
      [(r) => (r.IsCustom ? pill('własna', 'info') : h('span', { class: 'dim' }, 'wbudowana')), 'Rodzaj'],
      [(r) => profiles.filter((p) => p.Resolution?.Id === r.Id).length || '—', 'Profile', { class: 'num' }],
      [(r) => (r.IsCustom && canDel ? btn('Usuń', () => del(r), 'danger sm') : ''), '']]),
    canAdd ? h('div', { class: 'bar pad res-add' }, w, h('span', null, '×'), hh, btn('+ Dodaj rozdzielczość', add, 'acc')) : null,
    cmdNote('GetAllResolutions', 'CreateCustomResolution', 'DeleteCustomResolution'));
}

VIEWS.profile = crudView({
  title: 'Profile kodowania',
  desc: 'Jak silnik Next koduje kanał: rozdzielczość, obraz, dźwięk, akceleracja sprzętowa. Odpowiednik FFmpeg Profiles w legacy. Zmiana działa od następnego startu strumienia kanału.',
  listCmd: 'GetAllFFmpegProfiles',
  needs: ['NewFFmpegProfile', 'GetAllResolutions', 'GetSupportedHardwareAccelerationKinds', 'GetAllChannels'],
  commands: { create: 'CreateFFmpegProfile', update: 'UpdateFFmpegProfile', delete: 'DeleteFFmpegProfile', copy: 'CopyFFmpegProfile' },
  noun: { list: 'Profile', new: 'Nowy profil', add: '+ Nowy profil', create: 'Załóż profil', one: profName, title: profName },
  load: async () => {
    const [rows, resolutions, supported, fresh, channels, probe] = await Promise.all([
      cmd('GetAllFFmpegProfiles'), cmd('GetAllResolutions'), cmd('GetSupportedHardwareAccelerationKinds'), cmd('NewFFmpegProfile'),
      cmd('GetAllChannels', { ShowDisabled: true }),
      // K5: stan sprzętu wg Next – starsze legacy bez komendy = brak (podpowiedź z ffmpeg jak dotąd)
      has('GetNextProbe') ? cmd('GetNextProbe').catch(() => null) : null]);
    return { rows, resolutions, supported, fresh, channels, probe: has('GetNextProbe') ? (probe ?? false) : undefined };
  },
  id: (p) => p.Id,
  cols: ({ channels }) => [
    ['Name', 'Nazwa'], ['Resolution.Name', 'Rozdzielczość'],
    [(p) => `${pl(p.VideoFormat)} · ${pl(p.BitDepth)}`, 'Obraz'], [(p) => (p.VideoBitrate ? p.VideoBitrate + ' kb/s' : '—'), 'Bitrate', { class: 'num' }],
    [(p) => `${pl(p.AudioFormat)} ${p.AudioBitrate ? p.AudioBitrate + ' kb/s' : ''}`, 'Dźwięk'],
    [(p) => (p.HardwareAcceleration === 'None' ? 'programowo' : pl(p.HardwareAcceleration)), 'Akceleracja'],
    [(p) => (p.NormalizeLoudnessMode === 'LoudNorm' ? `${p.TargetLoudness ?? '?'} LUFS` : '—'), 'Głośność'],
    [(p) => { const n = channels.filter((c) => c.FFmpegProfileId === p.Id).length; return n ? pill(String(n), 'info') : '—'; }, 'Kanały'],
  ],
  editor: (p, { resolutions, supported, fresh, probe }) => {
    const base = { ...fresh, ...(p || {}), ResolutionId: (p || fresh).Resolution?.Id ?? resolutions[0]?.Id };
    if (!p) base.Name = '';
    const hw = enumValues('CreateFFmpegProfile', 'HardwareAcceleration')
      .filter((k) => k !== 'V4l2m2m')
      .map((k) => [k, k === 'None' ? 'brak (programowo)' : supported.includes(k) ? pl(k) : `${pl(k)} – sprzęt nie zgłasza`]);
    return form(p ? 'UpdateFFmpegProfile' : 'CreateFFmpegProfile', [
      { sec: 'Ogólne' },
      { key: 'Name', label: 'Nazwa', required: true, placeholder: 'np. 720p H.264' },
      { label: 'Normalizacja', group: [{ key: 'NormalizeVideo', kind: 'check', text: 'obrazu' }, { key: 'NormalizeAudio', kind: 'check', text: 'dźwięku' }],
        hint: (v) => (!v.NormalizeVideo || !v.NormalizeAudio ? 'Bez normalizacji Next kopiuje strumień bez zmian (ze znacznikami czasu) – większość odbiorników sobie z tym nie radzi.' : '') },
      { key: 'ResolutionId', label: 'Rozdzielczość', options: resolutions.map((r) => [r.Id, r.Name]) },
      { key: 'ScalingBehavior', label: 'Dopasowanie obrazu', show: vid },
      { sec: 'Obraz' },
      { key: 'VideoFormat', label: 'Kodek', show: vid, hint: (v) => (v.VideoFormat === 'Copy' ? 'Obraz kopiowany bez zmian – zwykle powoduje problemy w odbiornikach.' : '') },
      { key: 'BitDepth', label: 'Głębia', show: vid },
      { key: 'VideoBitrate', label: 'Bitrate', unit: 'kb/s', show: vid },
      { key: 'VideoBufferSize', label: 'Bufor', unit: 'kb', show: vid },
      { key: 'HardwareAcceleration', label: 'Akceleracja sprzętowa', options: hw, show: vid, hint: probe === undefined ? hwHint(supported) : nextHint(probe, supported) },
      { key: 'VaapiDriver', label: 'Sterownik VAAPI', show: (v) => vid(v) && v.HardwareAcceleration === 'Vaapi' },
      { key: 'VaapiDevice', label: 'Urządzenie VAAPI', placeholder: '/dev/dri/renderD128', show: (v) => vid(v) && v.HardwareAcceleration === 'Vaapi' },
      { key: 'TonemapAlgorithm', label: 'Mapowanie HDR → SDR', show: vid },
      { label: 'Obróbka', group: [{ key: 'NormalizeFramerate', kind: 'check', text: 'stała liczba klatek' }, { key: 'DeinterlaceVideo', kind: 'check', text: 'usuwaj przeplot' }], show: vid },
      { sec: 'Dźwięk' },
      { key: 'AudioFormat', label: 'Kodek', show: aud, hint: (v) => (v.AudioFormat === 'AacLatm' ? 'AAC LATM tylko dla DVB-C; w pozostałych przypadkach AAC.' : v.AudioFormat === 'Copy' ? 'Dźwięk kopiowany bez zmian – zwykle powoduje problemy w odbiornikach.' : '') },
      { key: 'AudioBitrate', label: 'Bitrate', unit: 'kb/s', show: aud },
      { key: 'AudioBufferSize', label: 'Bufor', unit: 'kb', show: aud },
      { key: 'AudioChannels', label: 'Kanały', show: aud },
      { key: 'AudioSampleRate', label: 'Próbkowanie', unit: 'kHz', show: aud },
      { key: 'NormalizeLoudnessMode', label: 'Normalizacja głośności', show: aud, hint: loudHint },
      { key: 'TargetLoudness', label: 'Poziom docelowy', unit: 'LUFS', step: 0.5, placeholder: '-23', show: (v) => aud(v) && v.NormalizeLoudnessMode === 'LoudNorm' },
    ], base);
  },
  beforeSave: (ctx, d) => {
    if (d.NormalizeAudio && d.NormalizeLoudnessMode === 'LoudNorm' && d.TargetLoudness == null) throw new Error('Pole „Poziom docelowy”: podaj poziom w LUFS (TV w Polsce: −23).');
  },
  footer: (p, { fresh }) => h('div', { class: 'hint pad dim' },
    'Ustawienia tylko dla starego silnika legacy (wątki, preset, profil H.264, B-klatki, wyświetlacz VAAPI) panel zostawia bez zmian',
    p ? '.' : ` (nowy profil: wartości domyślne legacy, np. profil ${fresh.VideoProfile || '—'}).`),
  below: (cur, { resolutions, rows }) => resolutionsPanel(resolutions, rows),
  create: (d) => d,
  update: (d, p) => ({ ...d, FFmpegProfileId: p.Id }),
  createdId: (r) => r?.FFmpegProfileId,
  del: (p) => ({ FFmpegProfileId: p.Id }),
  confirmDelete: (p, { channels }) => {
    const used = channels.filter((c) => c.FFmpegProfileId === p.Id);
    return used.length
      ? `Profil „${p.Name}” mają kanały: ${used.map((c) => `${c.Number} · ${c.Name}`).join(', ')}. Legacy może odmówić usunięcia. Usunąć?`
      : `Usunąć profil „${p.Name}”? Tego nie da się cofnąć.`;
  },
  copy: (p, name) => ({ FFmpegProfileId: p.Id, Name: name }),
  copiedId: (r) => r?.Id,
});
