// Profile kodowania (R5): jak silnik Next koduje kanał. Odpowiednik FFmpeg Profiles + FFmpeg Editor legacy.

import { VIEWS, h, cmd, pl, pill, enumValues } from '../core.js';
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

function loudHint(v) {
  if (v.NormalizeLoudnessMode !== 'LoudNorm') return 'Telewizja w Polsce: −23 LUFS (EBU R128) – włącz loudnorm, żeby kanał nie był głośniejszy od innych.';
  const t = v.TargetLoudness;
  if (t == null) return 'Podaj poziom, dla TV w Polsce −23 LUFS.';
  return t === -23 ? 'Zgodne z EBU R128 (TV w Polsce).' : `Dla TV w Polsce zalecane −23 LUFS (teraz ${t}).`;
}

VIEWS.profile = crudView({
  title: 'Profile kodowania',
  desc: 'Jak silnik Next koduje kanał: rozdzielczość, obraz, dźwięk, akceleracja sprzętowa. Odpowiednik FFmpeg Profiles w legacy. Zmiana działa od następnego startu strumienia kanału.',
  listCmd: 'GetAllFFmpegProfiles',
  needs: ['NewFFmpegProfile', 'GetAllResolutions', 'GetSupportedHardwareAccelerationKinds', 'GetAllChannels'],
  commands: { create: 'CreateFFmpegProfile', update: 'UpdateFFmpegProfile', delete: 'DeleteFFmpegProfile', copy: 'CopyFFmpegProfile' },
  noun: { list: 'Profile', new: 'Nowy profil', add: '+ Nowy profil', create: 'Załóż profil', one: profName, title: profName },
  load: async () => {
    const [rows, resolutions, supported, fresh, channels] = await Promise.all([
      cmd('GetAllFFmpegProfiles'), cmd('GetAllResolutions'), cmd('GetSupportedHardwareAccelerationKinds'), cmd('NewFFmpegProfile'),
      cmd('GetAllChannels', { ShowDisabled: true })]);
    return { rows, resolutions, supported, fresh, channels };
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
  editor: (p, { resolutions, supported, fresh }) => {
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
      { key: 'HardwareAcceleration', label: 'Akceleracja sprzętowa', options: hw, show: vid, hint: hwHint(supported) },
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
