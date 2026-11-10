// Atrapa mostu VizRS Bridge (bez Dockera i bez legacy) – do zrzutów UI i szybkiego sprawdzenia ekranów.
// Nie zastępuje stosu testowego (tests/stack.sh + e2e): dane są stałe, zapisy tylko w pamięci.
//
//   node tests/mock-bridge.cjs [port=18409] [token=test-token-0123456789]
//   LEGACY_SRC=<klon ErsatzTV/legacy> – metadane komend (parametry, wyliczenia) z rekordów MediatR jak /vizrs-bridge/commands;
//   bez niego – same nazwy z bridge/commands.txt (formularze bez list wyboru).
// Panel: server/target/…/vizrs-live --bridge http://127.0.0.1:18409 --bridge-token <token> --web server/web
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2] || 18409);
const TOKEN = process.argv[3] || 'test-token-0123456789';
const ROOT = path.join(__dirname, '..');
const allowed = fs.readFileSync(path.join(ROOT, 'bridge/commands.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

// ---------- metadane z rekordów legacy ----------
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/^(bin|obj|\.git|node_modules)$/.test(e.name)) walk(p, out); } else if (e.name.endsWith('.cs')) out.push(p);
  }
  return out;
}
function splitTop(s) {
  const out = []; let d = 0, cur = '';
  for (const ch of s) {
    if ('<([{'.includes(ch)) d++;
    if ('>)]}'.includes(ch)) d--;
    if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
const PRIM = { int: 'Int32', long: 'Int64', string: 'String', bool: 'Boolean', double: 'Double', float: 'Single', decimal: 'Decimal', 'byte[]': 'Byte[]' };
function typeName(t, enums) {
  t = t.trim();
  let m = t.match(/^Option<(.+)>$/);
  if (m) return typeName(m[1], enums) + '?';
  if (t.endsWith('?')) return typeName(t.slice(0, -1), enums) + '?';
  m = t.match(/^([A-Za-z]+)<(.+)>$/);
  if (m) return `${m[1]}<${splitTop(m[2]).map((x) => typeName(x, enums)).join(', ')}>`;
  return PRIM[t] || t;
}
function loadMeta() {
  const src = process.env.LEGACY_SRC;
  if (!src || !fs.existsSync(src)) return allowed.map((name) => ({ name, kind: /^(Get|Query|Search|Count)/.test(name) ? 'query' : 'command', parameters: [] }));
  const files = walk(src).filter((f) => !/Tests/.test(f));
  const enums = {}, records = {};
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/public enum (\w+)\s*(?::\s*\w+\s*)?\{([^}]*)\}/g)) {
      enums[m[1]] = m[2].replace(/\/\/[^\n]*/g, '').replace(/\[[^\]]*\]/g, '').split(',').map((x) => x.split('=')[0].trim()).filter((x) => /^\w+$/.test(x));
    }
    // rekordy z białej listy (także dziedziczące, np. CreateClassicPlayout : CreatePlayout)
    for (const m of s.matchAll(/public (?:sealed )?record (\w+)\s*(\(([^;{]*?)\))?\s*[:;{]/gs)) {
      if (allowed.includes(m[1]) && !records[m[1]]) records[m[1]] = { params: m[3] || '', query: /[\\/]Queries[\\/]/.test(f) };
    }
  }
  return allowed.filter((n) => records[n]).map((name) => {
    const r = records[name];
    const parameters = splitTop(r.params).map((p) => {
      p = p.replace(/\[[^\]]*\]/g, '').trim();
      const def = p.includes('=');
      const [decl] = p.split('=');
      const parts = decl.trim().split(/\s+/);
      const pname = parts.pop();
      const raw = parts.join(' ');
      const type = typeName(raw, enums);
      const base = raw.replace(/^Option<(.+)>$/, '$1').replace(/\?$/, '');
      return { name: pname, type, optional: def || type.endsWith('?'), values: enums[base] || null };
    }).filter((p) => p.name);
    return { name, kind: r.query ? 'query' : 'command', parameters };
  });
}
const META = loadMeta();
const KNOWN = new Set(META.map((m) => m.name));

// ---------- dane ----------
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const res = [
  { Id: 1, Name: '1920x1080', Width: 1920, Height: 1080, IsCustom: false },
  { Id: 2, Name: '1280x720', Width: 1280, Height: 720, IsCustom: false },
  { Id: 3, Name: '720x576', Width: 720, Height: 576, IsCustom: false },
  { Id: 9, Name: '1024x576', Width: 1024, Height: 576, IsCustom: true },
];
const profile = (Id, Name, r, hw, extra = {}) => ({
  Id, Name, ThreadCount: 0, NormalizeAudio: true, NormalizeVideo: true, HardwareAcceleration: hw, VaapiDisplay: 'drm', VaapiDriver: 'Default', VaapiDevice: '',
  QsvExtraHardwareFrames: 64, Resolution: res[r], ScalingBehavior: 'ScaleAndPad', PadMode: 'Software', VideoFormat: 'H264', VideoProfile: 'high', VideoPreset: 'veryfast',
  AllowBFrames: false, BitDepth: 'EightBit', VideoBitrate: 4000, VideoBufferSize: 8000, TonemapAlgorithm: 'Linear', AudioFormat: 'Aac', AudioBitrate: 192, AudioBufferSize: 384,
  NormalizeLoudnessMode: 'LoudNorm', TargetLoudness: -23, AudioChannels: 2, AudioSampleRate: 48, NormalizeFramerate: false, NormalizeColors: true, DeinterlaceVideo: true, ...extra,
});
const DB = {
  resolutions: res,
  profiles: [profile(1, '1080p H.264 (NVENC)', 0, 'Nvenc'), profile(2, '720p H.264', 1, 'None', { VideoBitrate: 2500 }), profile(3, 'SD 576i VAAPI', 2, 'Vaapi', { VaapiDriver: 'iHD', VaapiDevice: '/dev/dri/renderD128' })],
  channels: [
    ['24', 'INFO24', 'Informacje', 1, 1], ['25', 'Muzyka VizRS', 'Muzyka', 2, 2], ['26', 'Kino Klasyka', 'Filmy', 2, 3], ['27', 'Sport Extra', 'Sport', 1, 4],
  ].map(([Number, Name, Group, FFmpegProfileId, Id]) => ({
    Id, Number, Name, Group, Categories: Group.toLowerCase(), FFmpegProfileId, SlugSeconds: null, Logo: { Path: '', ContentType: '' }, StreamSelectorMode: 'Default', StreamSelector: '',
    PreferredAudioLanguageCode: 'pol', PreferredAudioTitle: '', PlayoutSource: 'Generated', PlayoutMode: 'Continuous', MirrorSourceChannelId: null, PlayoutOffset: null, StreamingEngine: 'Next',
    NextEngineTextSubtitleMode: 'Burn', StreamingMode: 'HttpLiveStreamingSegmenter', WatermarkId: Id === 1 ? 1 : null, FallbackFillerId: 1, PlayoutCount: Id < 4 ? 1 : 0,
    PreferredSubtitleLanguageCode: 'pol', SubtitleMode: 'None', MusicVideoCreditsMode: 'None', MusicVideoCreditsTemplate: '', SongVideoMode: 'Default', TranscodeMode: 'OnDemand',
    IdleBehavior: 'StopOnDisconnect', IsEnabled: true, ShowInEpg: true,
  })),
  playouts: [
    { PlayoutId: 1, ScheduleKind: 'Classic', ChannelName: 'INFO24', ChannelNumber: '24', PlayoutMode: 'Continuous', ScheduleName: 'INFO24 – dzień', ScheduleFile: null, DbDailyRebuildTime: null, BuildStatus: { Success: true, Message: '' } },
    { PlayoutId: 2, ScheduleKind: 'Block', ChannelName: 'Muzyka VizRS', ChannelNumber: '25', PlayoutMode: 'Continuous', ScheduleName: '', ScheduleFile: null, DbDailyRebuildTime: '04:00:00', BuildStatus: { Success: true, Message: '' } },
    { PlayoutId: 3, ScheduleKind: 'Classic', ChannelName: 'Kino Klasyka', ChannelNumber: '26', PlayoutMode: 'Continuous', ScheduleName: 'Kino – wieczór', ScheduleFile: null, DbDailyRebuildTime: null, BuildStatus: { Success: false, Message: 'Collection "Westerny" is empty' } },
  ],
  watermarks: [{ Id: 1, Name: 'Logo INFO24', Image: '', ImageSource: 'ChannelLogo', Mode: 'Permanent', Location: 'TopRight', Size: 'Scaled', WidthPercent: 12, HorizontalMarginPercent: 4, VerticalMarginPercent: 5, FrequencyMinutes: 15, DurationSeconds: 15, Opacity: 90, PlaceWithinSourceContent: false, ZIndex: 0 }],
  fillers: [{ Id: 1, Name: 'Plansza zapasowa', FillerKind: 'Fallback', FillerMode: 'None' }, { Id: 2, Name: 'Zapowiedzi', FillerKind: 'MidRoll', FillerMode: 'Count' }],
};
const TITLES = {
  1: ['Serwis informacyjny', 'Pogoda', 'Rozmowa dnia', 'Serwis informacyjny', 'Magazyn regionalny', 'Pogoda', 'Gość VizRS', 'Serwis informacyjny'],
  2: ['Lista przebojów', 'Teledyski non-stop', 'Koncert w studiu', 'Nocne granie', 'Teledyski non-stop', 'Lista przebojów', 'Nowości', 'Teledyski non-stop'],
  3: ['Zapowiedzi', 'Rejs (1970)', 'Miś (1981)', 'Zapowiedzi', 'Seksmisja (1984)', 'Vabank (1981)', 'Zapowiedzi', 'Kingsajz (1987)'],
};
function items(pid, n = 8) {
  const titles = TITLES[pid] || [];
  const out = []; let t = now - 12 * 60000;
  for (let i = 0; i < n; i++) {
    const len = pid === 3 ? (i % 3 === 0 ? 3 : 95) : pid === 1 ? [30, 5, 25][i % 3] : 20;
    if (pid === 3 && i === 4) t += 7 * 60000; // dziura w ramówce (K9)
    out.push({ Title: titles[i % titles.length], Start: iso(t), Finish: iso(t + len * 60000), Duration: `${String(Math.floor(len / 60)).padStart(2, '0')}:${String(len % 60).padStart(2, '0')}:00`, SchedulingContext: '', FillerKind: titles[i % titles.length] === 'Zapowiedzi' ? 'PreRoll' : null });
    t += len * 60000;
  }
  return out;
}
const probe = {
  Capability: {
    accels: [
      { accel: 'cuda', configured: true, device: null, driver: null, status: 'Available', error: null, decode: [{ format: 'h264', pixel_formats: ['yuv420p'] }, { format: 'hevc', pixel_formats: ['yuv420p', 'yuv420p10le'] }], encode: [{ format: 'h264', bit_depths: [8] }, { format: 'hevc', bit_depths: [8, 10] }] },
      { accel: 'vaapi', configured: true, device: '/dev/dri/renderD128', driver: 'ihd', status: 'ProbeFailed', error: 'vaInitialize failed with error code -1', decode: [], encode: [] },
      { accel: 'qsv', configured: false, device: null, driver: null, status: 'Skipped', error: null, decode: [], encode: [] },
    ],
    ffmpeg: { hwaccels: ['cuda', 'vaapi', 'qsv'], path: '/usr/local/bin/ffmpeg', version: '7.1.1' },
  },
  Json: '{}', FFmpegPath: '/usr/local/bin/ffmpeg', ProbedAt: iso(now - 3600e3),
};
const logs = () => [
  { Timestamp: iso(now - 20e3), Level: 'Information', Message: 'Checking for overlapping playout items in 3 playouts', Properties: '' },
  { Timestamp: iso(now - 18e3), Level: 'Warning', Message: 'Playout 3 has overlapping playout items: "Miś (1981)" and "Zapowiedzi"', Properties: '' },
  { Timestamp: iso(now - 60e3), Level: 'Information', Message: 'Building playout 1 for channel 24 - INFO24', Properties: '' },
];

const H = {
  GetAllChannels: () => DB.channels,
  GetChannelById: (a) => DB.channels.find((c) => c.Id === a.Id) || null,
  GetAllChannelsForSort: () => DB.channels.map((c) => ({ Id: c.Id, Number: c.Number, Name: c.Name, OriginalNumber: c.Number, HasChanged: false })),
  UpdateChannelNumbers: (a) => { for (const x of a.Channels || []) { const c = DB.channels.find((y) => y.Id === x.Id); if (c) c.Number = x.Number; } return null; },
  GetAllFFmpegProfiles: () => DB.profiles,
  NewFFmpegProfile: () => ({ ...profile(0, 'Nowy profil', 0, 'None'), Id: 0 }),
  GetAllResolutions: () => DB.resolutions,
  CreateCustomResolution: (a) => { DB.resolutions.push({ Id: Math.max(...DB.resolutions.map((r) => r.Id)) + 1, Name: `${a.Width}x${a.Height}`, Width: a.Width, Height: a.Height, IsCustom: true }); return null; },
  DeleteCustomResolution: (a) => { DB.resolutions = DB.resolutions.filter((r) => r.Id !== a.ResolutionId); return null; },
  GetSupportedHardwareAccelerationKinds: () => ['None', 'Nvenc', 'Vaapi', 'Qsv'],
  GetNextVersion: () => '0.2.5',
  GetNextDescribe: () => ({ binary: { version: '0.2.5', commit: 'c5cb065' }, describe_version: 1, contract: { playout_schema: { breaking: 2, compatible: 3, uri: '' }, channel_config_schema: { breaking: 1, compatible: 4, uri: '' }, segment_seconds: 4, keyframe_seconds: 2 }, schema_capability: { video_formats: ['h264', 'hevc', 'mpeg2video'], audio_formats: ['aac', 'ac3'], accels: ['cuda', 'qsv', 'vaapi', 'videotoolbox', 'amf', 'rkmpp'], subtitle_modes: ['burn', 'none'], audio_copy_formats: [] } }),
  GetNextProbe: () => probe,
  RefreshNextProbe: () => probe,
  GetAllWatermarks: () => DB.watermarks,
  GetAllFillerPresets: () => DB.fillers,
  GetPagedPlayouts: () => ({ TotalCount: DB.playouts.length, Page: DB.playouts }),
  GetAllBlockPlayouts: () => DB.playouts.filter((p) => p.ScheduleKind === 'Block'),
  GetFuturePlayoutItemsById: (a) => { const it = items(a.PlayoutId, a.PageSize || 8); return { TotalCount: it.length, Page: it }; },
  GetPlayoutWarningsCount: () => 1,
  GetRecentLogEntries: () => ({ TotalCount: 3, Page: logs() }),
  GetAllHealthCheckResults: () => [
    { Title: 'FFmpeg Version', Status: 'Pass', Message: 'FFmpeg 7.1.1', BriefMessage: 'FFmpeg 7.1.1' },
    { Title: 'Hardware Acceleration', Status: 'Warning', Message: 'VAAPI probe failed', BriefMessage: 'VAAPI: test nieudany' },
    { Title: 'Zero Duration', Status: 'Pass', Message: 'OK', BriefMessage: 'OK' },
  ],
  GetTroubleshootingInfo: () => ({ Version: 'v26.12.0', FFmpegVersion: '7.1.1', NextVersion: '0.2.5', Cpus: [{ Manufacturer: 'ARM', Name: 'Neoverse-N1' }], VideoControllers: [], Channels: DB.channels, FFmpegProfiles: DB.profiles, Watermarks: DB.watermarks }),
  CountMediaItemsByLibrary: () => 0,
  GetBlockPlayoutHistory: () => ({ TotalCount: 2, Page: [
    { Id: 11, When: iso(now - 3 * 3600e3), Finish: iso(now - 2 * 3600e3), Key: '{"b":4,"i":2}', Details: '{"CollectionType":"Collection","Name":"Teledyski"}' },
    { Id: 12, When: iso(now - 2 * 3600e3), Finish: iso(now - 3600e3), Key: '{"b":4,"i":3}', Details: '{"CollectionType":"Collection","Name":"Teledyski"}' }] }),
  DecodePlayoutHistory: () => ({ PlaybackOrder: 'Shuffle', CollectionType: 'Collection', Name: 'Teledyski', MediaItemType: 'MusicVideo', MediaItemTitle: 'Teledysk 17' }),
};

function reply(res, status, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length });
  res.end(b);
}
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.headers['x-vizrs-token'] !== TOKEN && u.pathname.startsWith('/vizrs-bridge/')) return reply(res, 401, { ok: false, error: 'zły token mostu' });
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const p = u.pathname.replace(/^\/vizrs-bridge/, '');
    if (p === '/health') return reply(res, 200, { ok: true, result: { bridge: 'atrapa', legacy: 'v26.12.0 (atrapa)', commandsAllowed: KNOWN.size, commandsMissing: allowed.filter((n) => !KNOWN.has(n)) } });
    if (p === '/commands') return reply(res, 200, { ok: true, result: META });
    if (p === '/sessions') return reply(res, 200, { ok: true, result: [{ ChannelNumber: '24', State: 'Running', TranscodedUntil: iso(now + 60e3), LastAccess: iso(now), StartedAt: iso(now - 3600e3) }] });
    if (p.startsWith('/session/')) return reply(res, 200, { ok: true, result: true });
    if (p.startsWith('/command/')) {
      const name = p.slice('/command/'.length);
      if (!allowed.includes(name)) return reply(res, 403, { ok: false, error: `komenda '${name}' nie jest dozwolona (biała lista mostu)` });
      let args = {};
      try { args = body ? JSON.parse(body) : {}; } catch { return reply(res, 400, { ok: false, error: 'zły JSON' }); }
      if (/^(Build|Queue|Extract|Check|Refresh(?!NextProbe)|EmptyTrash|DeleteOrphaned|ReleaseMemory|Synchronize)/.test(name)) return reply(res, 202, { ok: true, queued: 'atrapa' });
      const fn = H[name];
      const result = fn ? fn(args) : /^(Get|Query|Search)/.test(name) ? [] : /^Count/.test(name) ? 0 : null;
      return reply(res, 200, { ok: true, result });
    }
    reply(res, 404, { ok: false, error: 'nieznany adres mostu' });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`atrapa mostu: http://127.0.0.1:${PORT}/vizrs-bridge (${META.length} komend z metadanymi${process.env.LEGACY_SRC ? '' : ' – bez LEGACY_SRC'})`));
