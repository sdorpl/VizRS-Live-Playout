// VizRS Live – panel kanału. Dane: komendy ErsatzTV legacy przez most (POST /api/cmd/{Nazwa}).
// Cały tekst trafia do DOM przez textContent (dane z legacy są obce).

const main = document.getElementById('main');
let STATUS = null;          // /api/status
let META = new Map();       // nazwa komendy -> {parameters, kind}
let timers = [];            // odświeżanie bieżącego widoku

// ---------- narzędzia DOM ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const pill = (text, kind) => h('span', { class: 'pill' + (kind ? ' ' + kind : '') }, text);
const btn = (text, onclick, cls) => h('button', { class: cls, onclick }, text);

function head(title, desc, ...buttons) {
  return h('div', { class: 'head' }, h('h1', null, title), h('span', { class: 'grow' }), buttons, desc ? h('p', null, desc) : null);
}
function panel(title, extras, ...body) {
  return h('div', { class: 'panel' }, h('header', null, h('h2', null, title), extras), body);
}
function cmdNote(...names) {
  return h('div', { class: 'cmd' }, 'Pod spodem: ', names.flatMap((n, i) => [i ? ', ' : '', h('b', null, n)]));
}

function fmt(v) {
  if (v == null || v === '') return '—';
  if (v === true) return 'tak';
  if (v === false) return 'nie';
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) return dateTime(v);
  if (typeof v === 'object') return Array.isArray(v) ? `${v.length} poz.` : (v.Name ?? JSON.stringify(v));
  return String(v);
}
function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
const pad2 = (n) => String(n).padStart(2, '0');
const hm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const hms = (d) => `${hm(d)}:${pad2(d.getSeconds())}`;
function dateTime(s) {
  const d = new Date(s);
  if (isNaN(d)) return s;
  const today = new Date();
  return d.toDateString() === today.toDateString() ? hms(d) : `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} ${hm(d)}`;
}
function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
  return (hh ? hh + ':' + pad2(mm) : mm) + ':' + pad2(ss);
}

/** Tabela: cols = [[klucz|funkcja, nagłówek, {class}]]; onRow(row) – kliknięcie wiersza. */
function table(rows, cols, opts = {}) {
  if (!rows || !rows.length) return h('div', { class: 'empty' }, opts.empty || 'Brak pozycji.');
  if (!cols) cols = Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== 'object').slice(0, 8).map((k) => [k, k]);
  const body = rows.map((r) => {
    const tr = h('tr', { class: [opts.onRow ? 'click' : '', opts.selected && opts.selected(r) ? 'sel' : ''].join(' ').trim() || null },
      cols.map(([k, , o]) => {
        const v = typeof k === 'function' ? k(r) : get(r, k);
        return h('td', { class: o && o.class }, v instanceof Node ? v : fmt(v));
      }));
    if (opts.onRow) tr.addEventListener('click', (e) => { if (!e.target.closest('button,a')) opts.onRow(r, tr); });
    return tr;
  });
  return h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, cols.map(([, t]) => h('th', null, t)))), h('tbody', null, body)));
}

// ---------- komunikaty ----------
let toastTimer;
function toast(msg, kind) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), kind === 'bad' ? 7000 : 3000);
}
function dialog(title, body, buttons) {
  const ov = document.getElementById('overlay');
  document.getElementById('dlg-title').textContent = title;
  document.getElementById('dlg-body').replaceChildren(body);
  return new Promise((resolve) => {
    const close = (v) => { ov.hidden = true; resolve(v); };
    document.getElementById('dlg-buttons').replaceChildren(...buttons.map(([t, v, cls]) => btn(t, () => close(v), cls)));
    ov.hidden = false;
    const first = ov.querySelector('input, button.acc, button.danger');
    if (first) first.focus();
  });
}
const confirmDlg = (title, text, okText = 'Tak', cls = 'danger') =>
  dialog(title, h('p', null, text), [['Anuluj', false], [okText, true, cls]]);

// ---------- API ----------
class ApiError extends Error {}
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'X-VizRS-Live': '1', ...(opts.body != null ? { 'Content-Type': opts.type || 'application/json' } : {}) },
    body: opts.body,
    credentials: 'same-origin',
  });
  let data;
  try { data = await res.json(); } catch { throw new ApiError(`odpowiedź ${res.status} bez JSON`); }
  if (res.status === 401 && path !== '/api/login') { await login(); throw new ApiError('wymagane logowanie'); }
  if (!data.ok) throw new ApiError(data.error || `błąd ${res.status}`);
  return data;
}
/** Komenda albo zapytanie legacy; zwraca wynik albo rzuca ApiError z komunikatem legacy. */
async function cmd(name, args = {}) {
  const d = await api('/api/cmd/' + name, { method: 'POST', body: JSON.stringify(args) });
  return d.queued ? { queued: d.queued } : d.result;
}
/** Tylko pola, które komenda przyjmuje (wg /vizrs-bridge/commands). */
function argsFor(name, obj) {
  const m = META.get(name);
  if (!m) return obj;
  const out = {};
  for (const p of m.parameters) if (p.name in obj) out[p.name] = obj[p.name];
  return out;
}
const enumValues = (name, param) => (META.get(name)?.parameters.find((p) => p.name === param)?.values) || [];

async function login() {
  const input = h('input', { type: 'password', id: 'login-token', autocomplete: 'current-password', 'aria-label': 'Token panelu' });
  for (;;) {
    const ok = await dialog('Logowanie do VizRS Live', h('div', null, h('label', { for: 'login-token' }, 'Token panelu (VIZRS_LIVE_TOKEN)'), input), [['Zaloguj', true, 'acc']]);
    if (!ok) continue;
    try {
      await api('/api/login', { method: 'POST', body: input.value, type: 'text/plain' });
      location.reload();
      return;
    } catch (e) { toast(e.message, 'bad'); }
  }
}

// ---------- etykiety po polsku ----------
const PL = {
  HttpLiveStreamingSegmenter: 'HLS Segmenter', HttpLiveStreamingDirect: 'HLS Direct', TransportStream: 'MPEG-TS', TransportStreamHybrid: 'MPEG-TS (hybryda)',
  Continuous: 'ciągły', OnDemand: 'na żądanie', Generated: 'własny playout', Mirror: 'kanał lustrzany',
  StopOnDisconnect: 'zatrzymaj, gdy nikt nie ogląda', KeepRunning: 'nadawaj zawsze',
  None: 'brak', Forced: 'tylko wymuszone', Default: 'domyślne', Any: 'dowolne', Burn: 'wypalaj', Convert: 'konwertuj',
  Classic: 'klasyczny', Block: 'blokowy', Sequential: 'sekwencyjny (YAML)', Scripted: 'skryptowy', ExternalJson: 'zewnętrzny JSON',
  Refresh: 'odśwież', Reset: 'od nowa', Continue: 'kontynuuj',
  Pass: 'OK', Warning: 'uwaga', Error: 'błąd', Info: 'info',
  Next: 'Next', Legacy: 'Legacy', Software: 'programowo', Qsv: 'QSV', Nvenc: 'NVENC', Vaapi: 'VAAPI', VideoToolbox: 'VideoToolbox', Amf: 'AMF', V4l2m2m: 'V4L2', Rkmpp: 'RKMPP',
  Permanent: 'stały', Intermittent: 'przerywany', OpacityExpression: 'wyrażenie krycia',
  PreRoll: 'przed (pre-roll)', MidRoll: 'w trakcie (mid-roll)', PostRoll: 'po (post-roll)', Tail: 'ogon', Fallback: 'zapasowy', DeadAir: 'martwe powietrze',
  Count: 'liczba', Duration: 'czas', Pad: 'dopełnienie', RandomCount: 'losowa liczba',
  Movies: 'filmy', Shows: 'seriale', MusicVideos: 'teledyski', OtherVideos: 'inne wideo', Songs: 'muzyka', Images: 'obrazy', RemoteStreams: 'strumienie zdalne',
};
const isFiller = (it) => it.FillerKind != null && it.FillerKind !== 'None';
const pl = (v) => (v == null ? '—' : PL[v] ?? String(v));

// ---------- widoki ----------
const VIEWS = {};

VIEWS.antena = async () => {
  const [channels, playouts] = await Promise.all([cmd('GetAllChannels', { ShowDisabled: false }), cmd('GetPagedPlayouts', { Query: '', PageNum: 0, PageSize: 500 })]);
  const byNumber = new Map((playouts?.Page || []).map((p) => [p.ChannelNumber, p]));
  const items = await Promise.all(channels.map(async (c) => {
    const p = byNumber.get(c.Number);
    if (!p) return [];
    try { return (await cmd('GetFuturePlayoutItemsById', { PlayoutId: p.PlayoutId, ShowFiller: true, PageNum: 0, PageSize: 8 }))?.Page || []; }
    catch { return []; }
  }));

  const progressEls = [];
  const cards = channels.map((c, i) => {
    const p = byNumber.get(c.Number);
    const list = items[i];
    const now = Date.now();
    const cur = list.find((it) => new Date(it.Start) <= now && now < new Date(it.Finish));
    const next = list.filter((it) => new Date(it.Start) > now).slice(0, 3);
    const bar = h('i');
    const left = h('span', { class: 'num' });
    if (cur) progressEls.push({ bar, left, start: +new Date(cur.Start), finish: +new Date(cur.Finish) });
    const state = !p ? pill('brak playoutu', 'warn') : cur ? pill('W RAMÓWCE', 'on') : pill('przerwa w ramówce', 'warn');
    const stream = STATUS.streamUrl ? h('a', { href: `${STATUS.streamUrl}/iptv/channel/${encodeURIComponent(c.Number)}.m3u8`, target: '_blank', rel: 'noopener' }, 'Strumień ↗') : null;
    return panel(`${c.Number} · ${c.Name}`, state,
      h('div', { class: 'chan' },
        cur
          ? h('div', { class: 'np' },
            h('div', { class: 'now' }, h('b', null, cur.Title), h('span', { class: 'dim num' }, `${hm(new Date(cur.Start))}–${hm(new Date(cur.Finish))}`), h('span', { class: 'grow' }), left),
            h('div', { class: 'prog' }, bar))
          : h('div', { class: 'dim' }, p ? 'Teraz nic nie jest zaplanowane – leci wypełniacz zapasowy kanału.' : 'Kanał nie ma playoutu: załóż go w legacy albo w kolejnym etapie VizRS Live.'),
        next.length ? h('div', { class: 'dim' }, 'Następnie: ', next.map((n, j) => [j ? ' · ' : '', h('span', { class: 'num' }, hm(new Date(n.Start))), ' ', n.Title])) : null,
        h('div', { class: 'bar' },
          p ? btn('Przebuduj', () => build(p, 'Refresh')) : null,
          p ? btn('Od nowa', () => build(p, 'Reset'), 'danger') : null,
          stream,
          STATUS.vizrsUrl ? h('a', { href: STATUS.vizrsUrl + '/trio', target: '_blank', rel: 'noopener' }, 'Trio ↗') : null)));
  });

  const events = channels.flatMap((c, i) => items[i].filter((it) => new Date(it.Start) > Date.now()).map((it) => ({ c, it })))
    .sort((a, b) => new Date(a.it.Start) - new Date(b.it.Start)).slice(0, 12);

  const tick = () => {
    const now = Date.now();
    for (const e of progressEls) {
      e.bar.style.width = Math.min(100, Math.max(0, ((now - e.start) / (e.finish - e.start)) * 100)) + '%';
      e.left.textContent = '−' + dur(e.finish - now);
    }
  };
  tick();
  timers.push(setInterval(tick, 1000), setInterval(() => route(true), 30000));

  return [
    head('Na antenie', 'Co teraz idzie w ramówce każdego kanału i co następne. Dane z playoutów legacy, odświeżane co 30 s.',
      btn('Odśwież', () => route(true))),
    h('div', { class: 'split wide' },
      h('div', { class: 'cols' }, cards.length ? cards : h('div', { class: 'note' }, 'Brak włączonych kanałów. Dodaj kanał w widoku Kanały.')),
      h('div', { class: 'cols' },
        STATUS.vizrsUrl ? panel('Grafika VizRS (/output)', null, h('div', { class: 'pad' }, h('iframe', { class: 'preview', src: STATUS.vizrsUrl + '/output', title: 'Podgląd grafiki VizRS' }))) : null,
        panel('Najbliższe pozycje', null,
          events.length
            ? h('div', { class: 'tl' }, events.map(({ c, it }) => h('div', { class: 'ev' }, h('span', { class: 'num' }, hm(new Date(it.Start))), pill(c.Name), h('span', null, it.Title, isFiller(it) ? h('span', { class: 'dim' }, ' (wypełniacz)') : null))))
            : h('div', { class: 'empty' }, 'Brak zaplanowanych pozycji.')))),
    panel('Most', null, cmdNote('GetAllChannels', 'GetPagedPlayouts', 'GetFuturePlayoutItemsById', 'BuildPlayout')),
  ];
};

async function build(p, mode) {
  if (mode === 'Reset' && !(await confirmDlg('Playout od nowa', `Zbudować playout kanału ${p.ChannelNumber} · ${p.ChannelName} od nowa? Ramówka zostanie ułożona ponownie od teraz.`, 'Buduj od nowa'))) return;
  try {
    await cmd('BuildPlayout', { PlayoutId: p.PlayoutId, Mode: mode });
    toast(`Playout ${p.ChannelName}: zlecono (${pl(mode)}). Legacy buduje go w tle.`, 'ok');
    setTimeout(() => route(true), 2500);
  } catch (e) { toast(e.message, 'bad'); }
}

// --- kanały: pełna edycja ---
const CHANNEL_DEFAULTS = {
  Name: '', Number: '', Group: 'VizRS', Categories: '', FFmpegProfileId: 0, SlugSeconds: null,
  Logo: { Path: '', ContentType: '' }, StreamSelectorMode: 'Default', StreamSelector: '', PreferredAudioLanguageCode: '', PreferredAudioTitle: '',
  PlayoutSource: 'Generated', PlayoutMode: 'Continuous', MirrorSourceChannelId: null, PlayoutOffset: null, StreamingEngine: 'Next',
  NextEngineTextSubtitleMode: 'Burn', StreamingMode: 'HttpLiveStreamingSegmenter', WatermarkId: null, FallbackFillerId: null,
  PreferredSubtitleLanguageCode: '', SubtitleMode: 'None', MusicVideoCreditsMode: 'None', MusicVideoCreditsTemplate: '',
  SongVideoMode: 'Default', TranscodeMode: 'OnDemand', IdleBehavior: 'StopOnDisconnect', IsEnabled: true, ShowInEpg: true,
};
let selChannel = null;

VIEWS.kanaly = async () => {
  const [channels, profiles, watermarks, fillers] = await Promise.all([
    cmd('GetAllChannels', { ShowDisabled: true }), cmd('GetAllFFmpegProfiles'), cmd('GetAllWatermarks'), cmd('GetAllFillerPresets')]);
  const current = selChannel === 'new' ? null : channels.find((c) => c.Id === selChannel) || channels[0] || null;
  if (selChannel !== 'new') selChannel = current?.Id ?? 'new';
  const profName = (id) => profiles.find((p) => p.Id === id)?.Name;

  const list = panel('Kanały', h('span', { class: 'dim' }, `${channels.length}`),
    table(channels, [
      ['Number', 'Nr', { class: 'num' }], ['Name', 'Nazwa'], ['Group', 'Grupa'],
      [(c) => profName(c.FFmpegProfileId), 'Profil'], [(c) => pl(c.StreamingMode), 'Strumień'],
      [(c) => (c.IsEnabled ? pill('włączony', 'ok') : pill('wyłączony')), 'Stan'],
    ], { onRow: (c) => { selChannel = c.Id; route(true); }, selected: (c) => c.Id === selChannel }));

  return [
    head('Kanały', 'Lista kanałów i edycja jednego. Odpowiednik Channels i Channel Editor w ErsatzTV legacy; zapis idzie wprost do legacy.',
      btn('+ Nowy kanał', () => { selChannel = 'new'; route(true); }, 'acc'),
      STATUS.streamUrl ? h('a', { href: STATUS.streamUrl + '/iptv/channels.m3u', target: '_blank', rel: 'noopener' }, 'channels.m3u ↗') : null),
    h('div', { class: 'split' }, list, channelEditor(current, channels, profiles, watermarks, fillers)),
  ];
};

function channelEditor(ch, channels, profiles, watermarks, fillers) {
  const isNew = !ch;
  const base = { ...CHANNEL_DEFAULTS, ...(ch || {}), FFmpegProfileId: ch?.FFmpegProfileId ?? profiles[0]?.Id ?? 0 };
  if (isNew) base.Number = String(Math.max(0, ...channels.map((c) => parseFloat(c.Number) || 0)) + 1);
  const f = {};
  const input = (key, attrs = {}) => (f[key] = h('input', { id: 'f-' + key, value: base[key] ?? '', ...attrs }));
  const select = (key, options, numeric) => {
    const s = h('select', { id: 'f-' + key }, options.map(([v, t]) => h('option', { value: v == null ? '' : String(v) }, t)));
    s.value = base[key] == null ? '' : String(base[key]);
    s.dataset.numeric = numeric ? '1' : '';
    return (f[key] = s);
  };
  const enumSel = (key) => select(key, enumValues('CreateChannel', key).map((v) => [v, pl(v)]));
  const check = (key, text) => h('label', { class: 'chk' }, (f[key] = h('input', { type: 'checkbox', id: 'f-' + key, checked: base[key] })), text);
  const row = (label, key, el) => [h('label', { for: 'f-' + key }, label), el];
  f.LogoPath = h('input', { id: 'f-LogoPath', value: base.Logo?.Path || '', placeholder: 'https://…/logo.png' });

  const form = h('div', { class: 'form' },
    h('div', { class: 'sec' }, 'Ogólne'),
    row('Numer', 'Number', input('Number')),
    row('Nazwa', 'Name', input('Name')),
    row('Grupa', 'Group', input('Group')),
    row('Kategorie', 'Categories', input('Categories', { placeholder: 'np. wiadomości, publicystyka' })),
    row('Logo (adres URL)', 'LogoPath', f.LogoPath),
    h('label', null, 'Widoczność'), h('div', { class: 'bar' }, check('IsEnabled', 'włączony'), check('ShowInEpg', 'w przewodniku EPG')),
    h('div', { class: 'sec' }, 'Nadawanie'),
    row('Profil kodowania', 'FFmpegProfileId', select('FFmpegProfileId', profiles.map((p) => [p.Id, p.Name]), true)),
    row('Tryb strumienia', 'StreamingMode', enumSel('StreamingMode')),
    row('Źródło playoutu', 'PlayoutSource', enumSel('PlayoutSource')),
    row('Kanał lustrzany', 'MirrorSourceChannelId', select('MirrorSourceChannelId', [[null, '—'], ...channels.filter((c) => c.Id !== ch?.Id).map((c) => [c.Id, `${c.Number} · ${c.Name}`])], true)),
    row('Tryb playoutu', 'PlayoutMode', enumSel('PlayoutMode')),
    row('Gdy nikt nie ogląda', 'IdleBehavior', enumSel('IdleBehavior')),
    h('div', { class: 'sec' }, 'Treść'),
    row('Znak wodny', 'WatermarkId', select('WatermarkId', [[null, 'brak'], ...watermarks.map((w) => [w.Id, w.Name])], true)),
    row('Wypełniacz awaryjny', 'FallbackFillerId', select('FallbackFillerId', [[null, 'brak'], ...fillers.map((x) => [x.Id, x.Name])], true)),
    row('Język audio', 'PreferredAudioLanguageCode', input('PreferredAudioLanguageCode', { placeholder: 'pol' })),
    row('Napisy', 'SubtitleMode', enumSel('SubtitleMode')),
    row('Język napisów', 'PreferredSubtitleLanguageCode', input('PreferredSubtitleLanguageCode', { placeholder: 'pol' })),
    row('Napisy tekstowe (Next)', 'NextEngineTextSubtitleMode', enumSel('NextEngineTextSubtitleMode')),
  );

  const collect = () => {
    const out = { ...base };
    for (const [k, el] of Object.entries(f)) {
      if (k === 'LogoPath') continue;
      if (el.type === 'checkbox') out[k] = el.checked;
      else if (el.dataset.numeric) out[k] = el.value === '' ? null : Number(el.value);
      else out[k] = el.value;
    }
    const logo = f.LogoPath.value.trim();
    out.Logo = logo === (base.Logo?.Path || '') ? (base.Logo || { Path: '', ContentType: '' }) : { Path: logo, ContentType: '' };
    out.Logo = { Path: out.Logo.Path || '', ContentType: out.Logo.ContentType || '' };
    return out;
  };

  const save = async () => {
    const data = collect();
    if (!data.Number.trim() || !data.Name.trim()) return toast('Podaj numer i nazwę kanału.', 'bad');
    try {
      if (isNew) {
        const r = await cmd('CreateChannel', argsFor('CreateChannel', data));
        selChannel = r?.ChannelId ?? null;
        toast(`Kanał ${data.Number} · ${data.Name} założony.`, 'ok');
      } else {
        await cmd('UpdateChannel', argsFor('UpdateChannel', { ...data, ChannelId: ch.Id }));
        toast(`Kanał ${data.Number} · ${data.Name} zapisany.`, 'ok');
      }
      route(true);
    } catch (e) { toast('Legacy odrzucił zapis: ' + e.message, 'bad'); }
  };
  const remove = async () => {
    if (!(await confirmDlg('Usuń kanał', `Usunąć kanał ${ch.Number} · ${ch.Name} razem z jego playoutem? Tego nie da się cofnąć.`, 'Usuń'))) return;
    try { await cmd('DeleteChannel', { ChannelId: ch.Id }); selChannel = null; toast('Kanał usunięty.', 'ok'); route(true); }
    catch (e) { toast(e.message, 'bad'); }
  };

  return panel(isNew ? 'Nowy kanał' : `Kanał ${ch.Number} · ${ch.Name}`,
    [!isNew ? btn('Usuń', remove, 'danger') : null, btn(isNew ? 'Załóż kanał' : 'Zapisz', save, 'acc')],
    form, cmdNote(isNew ? 'CreateChannel' : 'UpdateChannel', 'DeleteChannel'));
}

// --- widoki listowe (prototyp: odczyt; edycja w kolejnych krokach) ---
function listView(title, desc, sources, footer) {
  return async () => {
    const results = await Promise.all(sources.map((s) => cmd(s.cmd, s.args || {}).then((r) => (s.pick ? s.pick(r) : r))));
    let tab = 0;
    const box = h('div');
    const render = () => {
      const s = sources[tab];
      box.replaceChildren(
        sources.length > 1 ? h('div', { class: 'tabs' }, sources.map((x, i) => h('button', { class: i === tab ? 'on' : null, onclick: () => { tab = i; render(); } }, `${x.title} (${results[i]?.length ?? 0})`))) : null,
        table(results[tab], s.cols, { empty: s.empty }));
    };
    render();
    return [
      head(title, desc),
      panel(sources.length > 1 ? 'Pozycje' : sources[0].title, null, box, cmdNote(...sources.map((s) => s.cmd))),
      footer ? h('div', { class: 'note' }, footer) : null,
    ];
  };
}
const READONLY = 'Prototyp: ten ekran tylko czyta dane z legacy. Edycja dojdzie, gdy jej komendy trafią na białą listę mostu (bridge/commands.txt) i dostaną formularz – bez zmian w kodzie C#.';

VIEWS.profile = listView('Profile kodowania', 'Jak Next koduje kanał. Odpowiednik FFmpeg Profiles.', [{
  title: 'Profile', cmd: 'GetAllFFmpegProfiles', cols: [
    ['Name', 'Nazwa'], ['Resolution.Name', 'Rozdzielczość'], [(p) => `${p.VideoFormat ?? ''} · ${p.BitDepth ?? ''}`, 'Obraz'],
    [(p) => (p.VideoBitrate ? p.VideoBitrate + ' kb/s' : '—'), 'Bitrate'], [(p) => `${p.AudioFormat ?? ''} ${p.AudioBitrate ? p.AudioBitrate + 'k' : ''}`, 'Dźwięk'],
    [(p) => pl(p.HardwareAcceleration), 'Akceleracja'], ['NormalizeAudio', 'Normalizacja dźwięku']],
}], READONLY);

VIEWS.znaki = listView('Znaki wodne', 'Proste logo rysowane przez Next. Gdy kanał ma grafikę VizRS, logo zwykle daje VizRS. Odpowiednik Watermarks.', [{
  title: 'Znaki', cmd: 'GetAllWatermarks', cols: [['Name', 'Nazwa'], [(w) => pl(w.Mode), 'Tryb'], ['Location', 'Położenie'], ['Size', 'Rozmiar'], [(w) => (w.Opacity != null ? w.Opacity + ' %' : '—'), 'Krycie']],
}], READONLY);

VIEWS.media = listView('Biblioteki', 'Skąd biorą się pliki. Odpowiednik Media Sources i Libraries (biblioteki lokalne).', [{
  title: 'Biblioteki lokalne', cmd: 'GetAllLocalLibraries', cols: [['Name', 'Nazwa'], [(l) => pl(l.MediaKind), 'Rodzaj'], ['Id', 'Id', { class: 'num' }]],
}], READONLY);

VIEWS.kolekcje = listView('Kolekcje', 'Zbiory treści, z których buduje się ramówkę. Odpowiednik Collections, Smart Collections i Multi Collections.', [
  { title: 'Zwykłe', cmd: 'GetAllCollections', cols: [['Name', 'Nazwa'], ['CollectionType', 'Rodzaj']] },
  { title: 'Inteligentne', cmd: 'GetAllSmartCollections', cols: [['Name', 'Nazwa'], [(s) => h('span', { class: 'mono' }, s.Query), 'Zapytanie']] },
  { title: 'Wielokolekcje', cmd: 'GetAllMultiCollections', cols: [['Name', 'Nazwa'], [(m) => (m.Items?.length || 0) + (m.SmartItems?.length || 0), 'Składników']] },
], READONLY);

VIEWS.playlisty = listView('Playlisty', 'Ustalona kolejność pozycji z różnych źródeł. Odpowiednik Playlists.', [{
  title: 'Grupy playlist', cmd: 'GetAllPlaylistGroups', cols: [['Name', 'Grupa'], ['PlaylistCount', 'Playlist'], ['IsSystem', 'Systemowa']],
}], READONLY);

VIEWS.wypelniacze = listView('Wypełniacze', 'Co wstawić przed, w trakcie i po pozycji oraz czym dopełnić czas. Odpowiednik Filler Presets.', [{
  title: 'Wypełniacze', cmd: 'GetAllFillerPresets', cols: [['Name', 'Nazwa'], [(x) => pl(x.FillerKind), 'Miejsce'], [(x) => pl(x.FillerMode), 'Tryb'], ['Duration', 'Czas'], ['Count', 'Liczba'], ['PadToNearestMinute', 'Do pełnych min']],
}], READONLY);

VIEWS.harmonogramy = listView('Harmonogramy', 'Ramówka klasyczna: pozycje po kolei, z godzinami stałymi. Odpowiednik Schedules.', [{
  title: 'Harmonogramy', cmd: 'GetAllProgramSchedules', cols: [['Name', 'Nazwa'], ['ShuffleScheduleItems', 'Tasuj pozycje'], ['RandomStartPoint', 'Losowy start'], [(s) => pl(s.FixedStartTimeBehavior), 'Godziny stałe']],
}], READONLY);

VIEWS.bloki = listView('Bloki i szablony', 'Bloki o stałej długości układane w szablony dnia. Odpowiednik Blocks i Templates.', [
  { title: 'Bloki', cmd: 'GetAllBlocks', cols: [['GroupName', 'Grupa'], ['Name', 'Blok'], [(b) => b.Minutes + ' min', 'Długość']] },
  { title: 'Szablony', cmd: 'GetAllTemplates', cols: [['GroupName', 'Grupa'], ['Name', 'Szablon']] },
], READONLY);

VIEWS.deco = listView('Wystrój (deco)', 'Oprawa bloku: znak wodny, grafika, przerwy, wypełniacz. Odpowiednik Decos.', [{
  title: 'Grupy deco', cmd: 'GetAllDecoGroups', cols: [['Name', 'Grupa'], ['DecoCount', 'Deco']],
}], READONLY);

VIEWS.grafika = listView('Grafika kanału', 'Elementy graficzne legacy (pliki YAML), w tym element VizRS z VizRS CG Playout.', [{
  title: 'Elementy graficzne', cmd: 'GetAllGraphicsElements', cols: [['Name', 'Nazwa'], [(g) => h('span', { class: 'mono' }, g.FileName), 'Plik']],
}], 'Reguły „kiedy która strona VizRS wchodzi na antenę” (makieta) przyjdą w kolejnym etapie razem z VizRS CG Playout.');

// --- playouty: lista + najbliższe pozycje ---
let selPlayout = null;
VIEWS.playouty = async () => {
  const res = await cmd('GetPagedPlayouts', { Query: '', PageNum: 0, PageSize: 500 });
  const rows = res?.Page || [];
  const cur = rows.find((p) => p.PlayoutId === selPlayout) || rows[0];
  selPlayout = cur?.PlayoutId ?? null;
  const items = cur ? (await cmd('GetFuturePlayoutItemsById', { PlayoutId: cur.PlayoutId, ShowFiller: true, PageNum: 0, PageSize: 50 }))?.Page || [] : [];
  return [
    head('Playouty', 'Zbudowana ramówka kanału: z harmonogramu, bloków, pliku YAML, skryptu albo JSON. Odpowiednik Playouts.'),
    h('div', { class: 'split' },
      panel('Playouty', h('span', { class: 'dim' }, String(res?.TotalCount ?? rows.length)),
        table(rows, [
          ['ChannelNumber', 'Kanał', { class: 'num' }], ['ChannelName', 'Nazwa'], [(p) => pl(p.ScheduleKind), 'Rodzaj'],
          [(p) => p.ScheduleName || p.ScheduleFile, 'Źródło'],
          [(p) => h('span', { class: 'bar' }, btn('Przebuduj', () => build(p, 'Refresh')), btn('Od nowa', () => build(p, 'Reset'), 'danger')), ''],
        ], { onRow: (p) => { selPlayout = p.PlayoutId; route(true); }, selected: (p) => p.PlayoutId === selPlayout, empty: 'Brak playoutów. W prototypie playout zakłada się w legacy.' })),
      panel(cur ? `${cur.ChannelName} · najbliższe pozycje` : 'Pozycje', null,
        table(items, [[(i) => dateTime(i.Start), 'Start', { class: 'num' }], [(i) => dateTime(i.Finish), 'Koniec', { class: 'num' }],
          [(i) => (isFiller(i) ? h('span', { class: 'dim' }, i.Title + ' (wypełniacz)') : i.Title), 'Pozycja', { class: 'w' }], ['Duration', 'Czas']], { empty: 'Brak przyszłych pozycji.' }),
        cmdNote('GetPagedPlayouts', 'GetFuturePlayoutItemsById', 'BuildPlayout'))),
  ];
};

// --- EPG ---
VIEWS.epg = async () => {
  const res = await cmd('GetPagedPlayouts', { Query: '', PageNum: 0, PageSize: 100 });
  const rows = (res?.Page || []).sort((a, b) => (parseFloat(a.ChannelNumber) || 0) - (parseFloat(b.ChannelNumber) || 0));
  const lists = await Promise.all(rows.map((p) => cmd('GetFuturePlayoutItemsById', { PlayoutId: p.PlayoutId, ShowFiller: true, PageNum: 0, PageSize: 80 }).then((r) => r?.Page || []).catch(() => [])));
  const t0 = new Date(); t0.setMinutes(t0.getMinutes() < 30 ? 0 : 30, 0, 0);
  const span = 4 * 3600e3, t1 = +t0 + span;
  const x = (t) => ((t - t0) / span) * 100;
  const ruler = h('div', { class: 'ruler' }, [0, 1, 2, 3].map((k) => { const s = h('span', null, hm(new Date(+t0 + k * 3600e3))); s.style.left = k * 25 + '%'; return s; }));
  const nowLine = () => { const l = h('div', { class: 'nowl' }); l.style.left = x(Date.now()) + '%'; return l; };
  const grid = h('div', { class: 'epg' }, h('div', { class: 'ch dim' }, 'kanał'), ruler);
  rows.forEach((p, i) => {
    grid.append(h('div', { class: 'ch' }, h('span', { class: 'num dim' }, p.ChannelNumber), p.ChannelName));
    const row = h('div', { class: 'row' });
    for (const it of lists[i]) {
      const s = +new Date(it.Start), e = +new Date(it.Finish);
      if (e <= +t0 || s >= t1) continue;
      const el = h('div', { class: 'p' + (s <= Date.now() && Date.now() < e ? ' now' : '') + (isFiller(it) ? ' fill' : ''), title: `${hm(new Date(s))}–${hm(new Date(e))} ${it.Title}` }, it.Title);
      el.style.left = Math.max(0, x(s)) + '%';
      el.style.width = `calc(${Math.min(100, x(e)) - Math.max(0, x(s))}% - 2px)`;
      row.append(el);
    }
    row.append(nowLine());
    grid.append(row);
  });
  return [
    head('Przewodnik EPG', 'Ramówka kanałów na najbliższe 4 godziny, tak jak zobaczy ją widz.',
      STATUS.streamUrl ? h('a', { href: STATUS.streamUrl + '/iptv/xmltv.xml', target: '_blank', rel: 'noopener' }, 'xmltv.xml ↗') : null),
    panel('Dziś', null, rows.length ? h('div', { class: 'tw' }, grid) : h('div', { class: 'empty' }, 'Brak playoutów.'), cmdNote('GetPagedPlayouts', 'GetFuturePlayoutItemsById')),
  ];
};

// --- live (kolejny etap) ---
VIEWS.live = async () => [
  head('Sloty na żywo', 'Wejścia studia (RTMP, SRT) i audycje na żywo jako pozycje ramówki. Funkcja VizRS CG Playout.'),
  h('div', { class: 'note' }, 'Kolejny etap: panel pokaże stan /ingest i /ingest/state z VizRS CG Playout oraz pozycje Remote Stream z legacy. W prototypie ten ekran jest pusty, żeby nie udawać danych.'),
];

// --- ustawienia i diagnostyka ---
VIEWS.ustawienia = async () => {
  const b = STATUS.bridge?.result;
  return [
    head('Ustawienia', 'Konfiguracja panelu (opcje i zmienne VIZRS_LIVE_*). Ustawienia legacy dojdą razem z ich komendami na białej liście.'),
    h('div', { class: 'cols' },
      panel('Panel', null, table([
        { k: 'Wersja panelu', v: STATUS.panel }, { k: 'Most (legacy)', v: STATUS.bridgeUrl }, { k: 'Strumienie dla widzów', v: STATUS.streamUrl || '— (VIZRS_LIVE_STREAM_URL)' },
        { k: 'VizRS CG System', v: STATUS.vizrsUrl || '— (VIZRS_LIVE_VIZRS_URL)' }, { k: 'Token panelu', v: STATUS.auth ? 'tak' : 'nie (tylko lokalnie)' },
      ], [['k', 'Ustawienie'], ['v', 'Wartość', { class: 'w' }]])),
      panel('Most', null, b ? table([
        { k: 'Wersja mostu', v: b.bridge }, { k: 'Wersja legacy', v: b.legacy }, { k: 'Komend znanych w legacy', v: b.commandsKnown },
        { k: 'Dozwolonych (biała lista)', v: b.commandsAllowed }, { k: 'Z listy, ale nieznanych w tej wersji', v: b.commandsMissing?.join(', ') || 'brak' },
      ], [['k', 'Pole'], ['v', 'Wartość', { class: 'w' }]]) : h('div', { class: 'empty err' }, STATUS.bridgeError || 'most nieosiągalny'))),
  ];
};

VIEWS.diagnostyka = async () => {
  const health = await cmd('GetAllHealthCheckResults', { Refresh: false }).catch((e) => ({ error: e.message }));
  const kind = { Pass: 'ok', Warning: 'warn', Error: 'bad', Info: 'info' };
  const commands = [...META.values()];
  const sel = h('select', { id: 'con-cmd' }, commands.map((c) => h('option', { value: c.name }, `${c.name} (${c.kind === 'query' ? 'zapytanie' : 'komenda'})`)));
  const args = h('textarea', { id: 'con-args', rows: 8 });
  const out = h('pre', { class: 'out' }, '—');
  const template = () => {
    const m = META.get(sel.value);
    const o = {};
    for (const p of m?.parameters || []) o[p.name] = p.values ? p.values[0] : p.type.startsWith('Int') ? 0 : p.type === 'Boolean' ? false : p.type === 'String' ? '' : null;
    args.value = JSON.stringify(o, null, 2);
  };
  sel.addEventListener('change', template);
  if (commands.length) template();
  const send = async () => {
    let body;
    try { body = JSON.parse(args.value || '{}'); } catch (e) { out.textContent = 'To nie jest JSON: ' + e.message; return; }
    out.textContent = '…';
    try { out.textContent = JSON.stringify(await cmd(sel.value, body), null, 2); }
    catch (e) { out.textContent = 'Błąd: ' + e.message; }
  };
  return [
    head('Diagnostyka', 'Stan legacy i mostu, kontrole zdrowia legacy oraz konsola komend z białej listy.'),
    h('div', { class: 'split' },
      panel('Kontrole legacy', null, health.error ? h('div', { class: 'empty err' }, health.error)
        : table(health, [[(r) => pill(pl(r.Status), kind[r.Status]), 'Stan'], ['Title', 'Kontrola'], [(r) => r.BriefMessage || r.Message, 'Opis', { class: 'w' }]]),
      cmdNote('GetAllHealthCheckResults')),
      panel('Konsola komend', btn('Wyślij', send, 'acc'),
        h('div', { class: 'form' }, h('label', { for: 'con-cmd' }, 'Komenda'), sel, h('label', { for: 'con-args' }, 'Argumenty (JSON)'), args),
        h('div', { class: 'pad' }, out),
        h('div', { class: 'cmd' }, 'Tylko komendy z białej listy mostu. Komendy zmieniają dane legacy naprawdę.'))),
  ];
};

// ---------- router ----------
async function route(keepScroll) {
  timers.forEach(clearInterval);
  timers = [];
  let name = (location.hash || '#antena').slice(1);
  if (!VIEWS[name]) name = 'antena';
  document.querySelectorAll('.side a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + name));
  const top = main.scrollTop;
  delete main.dataset.view;
  try {
    const nodes = await VIEWS[name]();
    main.replaceChildren(...nodes.filter(Boolean));
  } catch (e) {
    main.replaceChildren(head('Błąd'), h('div', { class: 'note err' }, e.message), btn('Spróbuj ponownie', () => route()));
  }
  main.dataset.view = name; // gotowy widok (testy e2e czekają na main[data-view])
  main.dataset.render = String((+main.dataset.render || 0) + 1);
  if (keepScroll === true) main.scrollTop = top;
}

async function refreshStatus() {
  const d = await api('/api/status');
  STATUS = d.result;
  const b = STATUS.bridge?.result;
  const sb = document.getElementById('st-bridge');
  const sl = document.getElementById('st-legacy');
  sb.textContent = b ? `most ${b.bridge}: OK` : 'most: brak połączenia';
  sb.className = 'pill ' + (b ? 'ok' : 'bad');
  sb.title = STATUS.bridgeError || '';
  sl.textContent = b ? `legacy ${b.legacy}` : 'legacy: ?';
  sl.className = 'pill ' + (b ? 'info' : '');
  document.getElementById('logout').hidden = !STATUS.auth;
}

function clock() {
  const c = document.getElementById('clock');
  const tick = () => (c.textContent = hms(new Date()));
  tick();
  setInterval(tick, 1000);
}

async function start() {
  clock();
  document.getElementById('logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST', body: '' }); location.reload(); });
  try {
    await refreshStatus();
    if (STATUS.bridge) {
      const c = await api('/api/commands');
      META = new Map(c.result.map((x) => [x.name, x]));
    }
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
  }
  setInterval(() => refreshStatus().catch(() => {}), 15000);
  window.addEventListener('hashchange', () => route());
  if (!STATUS?.bridge) {
    main.replaceChildren(head('Brak połączenia z mostem'), h('div', { class: 'note err' }, STATUS?.bridgeError || 'Serwer panelu nie odpowiada.'),
      h('div', { class: 'note' }, 'Sprawdź, czy ErsatzTV legacy działa z mostem (obraz vizrs-live-legacy) i czy VIZRS_LIVE_BRIDGE_TOKEN = VIZRS_BRIDGE_TOKEN.'),
      btn('Spróbuj ponownie', () => location.reload()));
    return;
  }
  route();
}

start();
