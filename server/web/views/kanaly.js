// Widoki grupy „Kanały”: Kanały (lista + edytor), Profile kodowania, Znaki wodne.

import { S, VIEWS, h, pill, cmd, pl } from '../core.js';
import { form } from '../form.js';
import { crudView, listView, READONLY } from '../parts.js';

// --- kanały: pełna edycja ---
const CHANNEL_DEFAULTS = {
  Name: '', Number: '', Group: 'VizRS', Categories: '', FFmpegProfileId: 0, SlugSeconds: null,
  Logo: { Path: '', ContentType: '' }, StreamSelectorMode: 'Default', StreamSelector: '', PreferredAudioLanguageCode: '', PreferredAudioTitle: '',
  PlayoutSource: 'Generated', PlayoutMode: 'Continuous', MirrorSourceChannelId: null, PlayoutOffset: null, StreamingEngine: 'Next',
  NextEngineTextSubtitleMode: 'Burn', StreamingMode: 'HttpLiveStreamingSegmenter', WatermarkId: null, FallbackFillerId: null,
  PreferredSubtitleLanguageCode: '', SubtitleMode: 'None', MusicVideoCreditsMode: 'None', MusicVideoCreditsTemplate: '',
  SongVideoMode: 'Default', TranscodeMode: 'OnDemand', IdleBehavior: 'StopOnDisconnect', IsEnabled: true, ShowInEpg: true,
};
const chanName = (c) => `Kanał ${c.Number} · ${c.Name}`;

/** Logo kanału: adres URL; niezmieniony adres zachowuje typ zawartości z legacy. */
function logoField(logo) {
  const before = { Path: logo?.Path || '', ContentType: logo?.ContentType || '' };
  const el = h('input', { id: 'f-LogoPath', value: before.Path, placeholder: 'https://…/logo.png', 'aria-label': 'Logo (adres URL)' });
  const read = () => {
    const p = el.value.trim();
    return p === before.Path ? before : { Path: p, ContentType: '' };
  };
  return { el, read, peek: read };
}

VIEWS.kanaly = crudView({
  title: 'Kanały',
  desc: 'Lista kanałów i edycja jednego. Odpowiednik Channels i Channel Editor w ErsatzTV legacy; zapis idzie wprost do legacy.',
  listCmd: 'GetAllChannels',
  needs: ['GetAllFFmpegProfiles', 'GetAllWatermarks', 'GetAllFillerPresets'],
  commands: { create: 'CreateChannel', update: 'UpdateChannel', delete: 'DeleteChannel' },
  noun: { list: 'Kanały', new: 'Nowy kanał', add: '+ Nowy kanał', create: 'Załóż kanał', one: chanName, title: chanName },
  load: async () => {
    const [rows, profiles, watermarks, fillers] = await Promise.all([
      cmd('GetAllChannels', { ShowDisabled: true }), cmd('GetAllFFmpegProfiles'), cmd('GetAllWatermarks'), cmd('GetAllFillerPresets')]);
    return { rows, profiles, watermarks, fillers };
  },
  id: (c) => c.Id,
  cols: ({ profiles }) => [
    ['Number', 'Nr', { class: 'num' }], ['Name', 'Nazwa'], ['Group', 'Grupa'],
    [(c) => profiles.find((p) => p.Id === c.FFmpegProfileId)?.Name, 'Profil'], [(c) => pl(c.StreamingMode), 'Strumień'],
    [(c) => (c.IsEnabled ? pill('włączony', 'ok') : pill('wyłączony')), 'Stan'],
  ],
  editor: (ch, { rows: channels, profiles, watermarks, fillers }) => {
    const base = { ...CHANNEL_DEFAULTS, ...(ch || {}), FFmpegProfileId: ch?.FFmpegProfileId ?? profiles[0]?.Id ?? 0 };
    if (!ch) base.Number = String(Math.max(0, ...channels.map((c) => parseFloat(c.Number) || 0)) + 1);
    return form(ch ? 'UpdateChannel' : 'CreateChannel', [
      { sec: 'Ogólne' },
      { key: 'Number', label: 'Numer', required: true },
      { key: 'Name', label: 'Nazwa', required: true },
      { key: 'Group', label: 'Grupa' },
      { key: 'Categories', label: 'Kategorie', placeholder: 'np. wiadomości, publicystyka' },
      { key: 'Logo', label: 'Logo (adres URL)', render: logoField },
      { label: 'Widoczność', group: [{ key: 'IsEnabled', kind: 'check', text: 'włączony' }, { key: 'ShowInEpg', kind: 'check', text: 'w przewodniku EPG' }] },
      { sec: 'Nadawanie' },
      { key: 'FFmpegProfileId', label: 'Profil kodowania', options: profiles.map((p) => [p.Id, p.Name]) },
      { key: 'StreamingMode', label: 'Tryb strumienia' },
      { key: 'PlayoutSource', label: 'Źródło playoutu' },
      { key: 'MirrorSourceChannelId', label: 'Kanał lustrzany', options: channels.filter((c) => c.Id !== ch?.Id).map((c) => [c.Id, `${c.Number} · ${c.Name}`]), show: (v) => v.PlayoutSource === 'Mirror' },
      { key: 'PlayoutMode', label: 'Tryb playoutu' },
      { key: 'IdleBehavior', label: 'Gdy nikt nie ogląda' },
      { sec: 'Treść' },
      { key: 'WatermarkId', label: 'Znak wodny', options: watermarks.map((w) => [w.Id, w.Name]), none: 'brak' },
      { key: 'FallbackFillerId', label: 'Wypełniacz awaryjny', options: fillers.map((x) => [x.Id, x.Name]), none: 'brak' },
      { key: 'PreferredAudioLanguageCode', label: 'Język audio', placeholder: 'pol' },
      { key: 'SubtitleMode', label: 'Napisy' },
      { key: 'PreferredSubtitleLanguageCode', label: 'Język napisów', placeholder: 'pol' },
      { key: 'NextEngineTextSubtitleMode', label: 'Napisy tekstowe (Next)' },
    ], base);
  },
  update: (data, ch) => ({ ...data, ChannelId: ch.Id }),
  createdId: (r) => r?.ChannelId,
  del: (ch) => ({ ChannelId: ch.Id }),
  confirmDelete: (ch) => `Usunąć kanał ${ch.Number} · ${ch.Name} razem z jego playoutem? Tego nie da się cofnąć.`,
  headExtra: () => (S.status.streamUrl ? h('a', { href: S.status.streamUrl + '/iptv/channels.m3u', target: '_blank', rel: 'noopener' }, 'channels.m3u ↗') : null),
});

VIEWS.profile = listView('Profile kodowania', 'Jak Next koduje kanał. Odpowiednik FFmpeg Profiles.', [{
  title: 'Profile', cmd: 'GetAllFFmpegProfiles', cols: [
    ['Name', 'Nazwa'], ['Resolution.Name', 'Rozdzielczość'], [(p) => `${p.VideoFormat ?? ''} · ${p.BitDepth ?? ''}`, 'Obraz'],
    [(p) => (p.VideoBitrate ? p.VideoBitrate + ' kb/s' : '—'), 'Bitrate'], [(p) => `${p.AudioFormat ?? ''} ${p.AudioBitrate ? p.AudioBitrate + 'k' : ''}`, 'Dźwięk'],
    [(p) => pl(p.HardwareAcceleration), 'Akceleracja'], ['NormalizeAudio', 'Normalizacja dźwięku']],
}], READONLY);

VIEWS.znaki = listView('Znaki wodne', 'Proste logo rysowane przez Next. Gdy kanał ma grafikę VizRS, logo zwykle daje VizRS. Odpowiednik Watermarks.', [{
  title: 'Znaki', cmd: 'GetAllWatermarks', cols: [['Name', 'Nazwa'], [(w) => pl(w.Mode), 'Tryb'], ['Location', 'Położenie'], ['Size', 'Rozmiar'], [(w) => (w.Opacity != null ? w.Opacity + ' %' : '—'), 'Krycie']],
}], READONLY);
