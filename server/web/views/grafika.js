// Widok „Grafika kanału” (R9); Sloty na żywo i Audycje LIVE – views/live.js.
// Dane VizRS CG Playout przez pośrednika serwera /api/cg/… (token CG zostaje w serwerze).

import { VIEWS, S, h, head, panel, pill, btn, table, toast, api, cmd, cmdNote, confirmDlg, dialog, has, route, dateTime, vizrsPreview, onChannel } from '../core.js';

/** Zapytanie do CG Playout przez serwer panelu; zwraca `result` albo rzuca ApiError. */
export async function cg(path, method = 'GET', body) {
  return (await api('/api/cg/' + path, { method, body: body == null ? undefined : JSON.stringify(body) })).result;
}

const cgMissing = () => h('div', { class: 'note' },
  'VizRS CG Playout nie jest podłączony. Uruchom panel z --cg-url http://<cg>:7700 i --cg-token <panel_token CG Playout> ' +
  '(VIZRS_LIVE_CG_URL, VIZRS_LIVE_CG_TOKEN); w CG Playout ustaw panel_token (VIZRS_PANEL_TOKEN).');

const cgError = (e) => h('div', { class: 'note err', 'data-cg-error': '' }, 'VizRS CG Playout: ' + e.message);

const sec = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);

// ---------- Grafika kanału ----------
VIEWS.grafika = async () => {
  const [elements, health, live] = await Promise.all([
    has('GetAllGraphicsElements') ? cmd('GetAllGraphicsElements') : [],
    S.status.cg ? cg('health').catch((e) => e) : null,
    S.status.cg ? cg('live/state').catch(() => null) : null,
  ]);
  const channels = live?.channels || [];

  const refresh = has('RefreshGraphicsElements') ? btn('Wczytaj pliki elementów', async () => {
    try { await cmd('RefreshGraphicsElements'); toast('Legacy wczytał elementy graficzne z dysku'); route(true); } catch (e) { toast(e.message, 'bad'); }
  }) : null;

  // strony VizRS kanału (GET /etv/pages?channel=N)
  const pagesBox = h('div', { class: 'pad', 'data-cg-pages': '' });
  const pick = h('select', { 'aria-label': 'Kanał stron VizRS', id: 'cg-pages-channel' },
    channels.map((c) => h('option', { value: c.number }, `${c.number} · ${c.name || 'kanał'}`)));
  const loadPages = async () => {
    if (!pick.value) return pagesBox.replaceChildren(h('div', { class: 'empty' }, 'CG Playout nie zna jeszcze żadnego kanału.'));
    try {
      const r = await cg('pages/' + encodeURIComponent(pick.value));
      pagesBox.replaceChildren(table(r?.pages || [], [['number', 'Nr', { class: 'num' }], ['name', 'Strona'], [(p) => (p.playout ? pill('własny playout', 'info') : '—'), 'Playout']],
        { empty: 'Show VizRS nie ma stron dla tego kanału (albo CG Playout nie widzi VizRS).' }));
    } catch (e) { pagesBox.replaceChildren(cgError(e)); }
  };
  // kanał z paska górnego jako domyślny wybór stron (i anteny podglądu)
  if (S.channel && channels.some((c) => onChannel(c.number))) pick.value = S.channel;
  pick.addEventListener('change', loadPages);
  if (S.status.cg && !(health instanceof Error)) loadPages();

  const cgPanel = !S.status.cg ? cgMissing() : health instanceof Error ? cgError(health) : [
    panel('Stan VizRS CG Playout', h('span', null, pill('połączony', 'ok')),
      h('dl', { class: 'kv' },
        h('dt', null, 'Sesje elementu VizRS'), h('dd', { 'data-cg-sessions': '' }, String(health.sessions ?? 0)),
        h('dt', null, 'Nakładka ffmpeg'), h('dd', null, (health.overlay || []).length ? (health.overlay || []).map((c) => pill('kanał ' + c, 'info')) : '—'),
        h('dt', null, 'Live ingest'), h('dd', null, health.ingest == null ? pill('wyłączony') : pill('włączony', 'ok'))),
      table(health.captures || [], [['channel', 'Kanał'], ['size', 'Rozmiar'], ['fps', 'kl./s'], ['mode', 'Tryb'], ['drawn_by', 'Rysuje'], ['status', 'Stan']],
        { empty: 'Brak przechwytywania grafiki – żaden kanał nie gra teraz pozycji z elementem VizRS.' }),
      cmdNote('CG Playout GET /health')),
    panel('Strony VizRS kanału', h('span', null, pick), pagesBox, cmdNote('CG Playout GET /etv/pages?channel=N')),
  ];

  return [
    head('Grafika kanału', 'Kiedy jaka strona VizRS wchodzi na antenę (reguły CG Playout), stan VizRS CG Playout, strony VizRS, podgląd anteny i elementy graficzne legacy.', refresh),
    S.status.cg && !(health instanceof Error) ? await rulesPanel() : null,
    h('div', { class: 'split wide' },
      h('div', { class: 'cols' }, cgPanel,
        panel('Elementy graficzne legacy', null,
          table(elements, [['Name', 'Nazwa'], [(g) => h('span', { class: 'mono' }, g.FileName), 'Plik']],
            { empty: 'Brak elementów. Element VizRS (vizrs.yml) zakłada CG Playout przy synchronizacji z legacy.' }),
          cmdNote('GetAllGraphicsElements', 'RefreshGraphicsElements'))),
      h('div', { class: 'cols' },
        vizrsPreview('Podgląd anteny VizRS (/output)', [], channels.length ? pick : null)
          || h('div', { class: 'note' }, 'Podgląd /output i Trio: uruchom panel z --vizrs-url (VIZRS_LIVE_VIZRS_URL), VizRS z tokenem – także z --vizrs-output-token.'))),
  ];
};

// ---------- Reguły grafiki (CG Playout GET/PUT /api/live/graphics) ----------
// Puste pole = dziedzicz (wartość globalna), „-” = wyłączone (pusty tekst w CG Playout).
const toField = (v) => (v == null ? '' : v === '' ? '-' : String(v));
const fromField = (v) => { const t = v.trim(); return t === '' ? null : t === '-' ? '' : t; };
const numField = (v) => { const t = String(v).trim(); return t === '' ? null : Number(t); };

const firstLine = (t) => { const l = String(t).split('\n').map((x) => x.trim()).filter(Boolean); return l.length > 1 ? `${l[0]}  (+${l.length - 1})` : l[0] || ''; };
/** Wiersze streszczenia „Kiedy / Co / Ile” z reguł CG Playout (stan zapisany). focus = selektor pola w edytorze obok. */
function ruleRows(r) {
  const rows = [];
  const end = (x) => x.end_seconds ?? r.end_seconds ?? 60;
  const what = (v) => (v == null ? null : v === '' || v === '-' ? '-' : v); // brak = jak globalnie, '' = wyłączone
  const add = (scope, x, focus, global) => {
    const ad = [r.ad_match?.path && `ścieżka ~ ${r.ad_match.path}`, r.ad_match?.title && `tytuł ~ ${r.ad_match.title}`].filter(Boolean).join(', ');
    const list = [
      ['on_clip', 'start pozycji', 'wg strony VizRS'],
      ['on_end', `${end(x)} s przed końcem audycji`, `ostatnie ${end(x)} s`],
      ['on_ad', 'przerwa reklamowa' + (global && ad ? ` (${ad})` : ''), 'na czas przerwy'],
    ];
    for (const [key, when, len] of list) {
      const v = what(x[key]);
      if (v == null) continue;
      rows.push({ scope, when, key, cmd: v, len, focus: focus(key) });
    }
  };
  add('wszystkie kanały', r, (k) => `#gr-${k}`, true);
  (r.shows || []).forEach((x, i) => add(`audycja ~ ${x.show_title}`, x, (k) => `[data-rules-shows] input[aria-label="${k} ${i + 1}"]`));
  Object.entries(r.channels || {}).filter(([n]) => onChannel(n)).forEach(([n, x], i) => {
    add(`kanał ${n}`, x, (k) => `[data-rules-channels] input[aria-label="${k} ${i + 1}"]`);
    (x.shows || []).forEach((y) => add(`kanał ${n}, audycja ~ ${y.show_title}`, y, () => null));
  });
  return rows;
}

function rulesSummary(r) {
  const rows = ruleRows(r);
  const go = (row) => {
    const el = row.focus && document.querySelector(row.focus);
    if (!el) return toast('Ta reguła (audycja w regule kanału) jest tylko w config.json CG Playout – panel jej nie edytuje.');
    el.scrollIntoView({ block: 'center' }); el.focus();
  };
  return panel(S.channel ? `Reguły · kanał ${S.channel}` : 'Reguły · wszystkie kanały', h('span', { class: 'dim' }, 'kliknij wiersz, by edytować'),
    h('div', { class: 'tw', 'data-rules-summary': '' }, table(rows, [
      [(x) => h('span', null, x.when, h('br'), h('span', { class: 'dim' }, x.scope)), 'Kiedy', { class: 'w' }],
      [(x) => (x.cmd === '-' ? (x.key === 'on_ad' ? pill('OUT – grafika schodzi') : pill('wyłączone')) : h('span', { class: 'mono', title: x.cmd }, firstLine(x.cmd))), 'Co', { class: 'w' }],
      [(x) => (x.cmd === '-' && x.key !== 'on_ad' ? '—' : x.len), 'Ile'],
    ], { onRow: go, empty: 'Brak reguł – grafika nie zmienia się sama.' })),
    h('div', { class: 'hint pad' }, 'Stan zapisany w CG Playout. Reguła audycji (pierwsza pasująca wg tytułu) i reguła kanału zastępują regułę globalną; „wyłączone” – w tym zakresie nic nie wchodzi.'),
    cmdNote('CG Playout GET /api/live/graphics'));
}

async function rulesPanel() {
  let doc;
  try { doc = await cg('live/graphics'); } catch (e) {
    return panel('Reguły grafiki', null, h('div', { class: 'pad' },
      h('p', { class: 'dim' }, 'Ta wersja VizRS CG Playout nie ma API reguł grafiki (GET/PUT /api/live/graphics) – reguły zmienia się w jego config.json. Zaktualizuj CG Playout.'),
      cgError(e)));
  }
  const r = doc.rules || {};
  const input = (id, label, value, opts = {}) => {
    const el = opts.area ? h('textarea', { id, rows: 2, class: 'mono', 'aria-label': label, placeholder: opts.placeholder || '' })
      : h('input', { id, class: opts.num ? 'num' : 'mono', value: value ?? '', 'aria-label': label, placeholder: opts.placeholder || '' });
    if (opts.area) el.value = value ?? '';
    return el;
  };
  const g = {
    on_clip: input('gr-on_clip', 'Na start pozycji (on_clip)', r.on_clip, { area: true, placeholder: 'TAKE 4001 headline={title}|sub=Potem: {next_title} o {next_start}' }),
    on_end: input('gr-on_end', 'Przed końcem audycji (on_end)', r.on_end, { area: true, placeholder: 'TAKE 1405 next=Za chwilę|programs={next_title}' }),
    end_seconds: input('gr-end_seconds', 'Sekund przed końcem', r.end_seconds ?? 60, { num: true }),
    on_ad: input('gr-on_ad', 'Na przerwę reklamową (on_ad)', r.on_ad, { area: true, placeholder: 'puste = grafika schodzi na czas reklam' }),
    ad_path: input('gr-ad_path', 'Reklama: ścieżka (regex)', r.ad_match?.path, { placeholder: '/reklamy/' }),
    ad_title: input('gr-ad_title', 'Reklama: tytuł (regex)', r.ad_match?.title),
  };
  const shows = (r.shows || []).map((x) => ({ ...x }));
  const channels = Object.entries(r.channels || {}).map(([channel, x]) => ({ channel, ...x }));
  const showsBox = h('div', { 'data-rules-shows': '' });
  const chBox = h('div', { 'data-rules-channels': '' });
  const row = (list, i, fields, render) => h('div', { class: 'rule-row' },
    ...fields.map(([key, label, num]) => h('input', {
      value: num ? (list[i][key] ?? '') : (key === 'show_title' || key === 'channel' ? list[i][key] ?? '' : toField(list[i][key])),
      class: num ? 'num' : 'mono', placeholder: label, 'aria-label': `${label} ${i + 1}`,
      oninput: (e) => { list[i][key] = num ? numField(e.target.value) : key === 'show_title' || key === 'channel' ? e.target.value.trim() : fromField(e.target.value); },
    })),
    h('button', { type: 'button', class: 'danger', 'aria-label': `Usuń regułę ${i + 1}`, onclick: () => { list.splice(i, 1); render(); } }, '✕'));
  const SHOW = [['show_title', 'Audycja (regex tytułu)'], ['on_clip', 'on_clip'], ['on_end', 'on_end'], ['end_seconds', 's przed końcem', true], ['on_ad', 'on_ad']];
  const CH = [['channel', 'Kanał'], ['on_clip', 'on_clip'], ['on_end', 'on_end'], ['end_seconds', 's przed końcem', true], ['on_ad', 'on_ad']];
  const renderShows = () => showsBox.replaceChildren(...(shows.length ? shows.map((_, i) => row(shows, i, SHOW, renderShows)) : [h('div', { class: 'empty' }, 'Brak reguł audycji.')]),
    h('div', { class: 'bar' }, btn('+ Reguła audycji', () => { shows.push({ show_title: '' }); renderShows(); })));
  const renderCh = () => chBox.replaceChildren(...(channels.length ? channels.map((_, i) => row(channels, i, CH, renderCh)) : [h('div', { class: 'empty' }, 'Wszystkie kanały na regułach globalnych.')]),
    h('div', { class: 'bar' }, btn('+ Reguła kanału', () => { channels.push({ channel: '' }); renderCh(); })));
  renderShows(); renderCh();

  const save = async () => {
    if (shows.some((x) => !x.show_title)) return toast('Reguła audycji wymaga wzorca tytułu.', 'bad');
    if (channels.some((x) => !x.channel)) return toast('Reguła kanału wymaga numeru kanału.', 'bad');
    const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && !(typeof v === 'number' && Number.isNaN(v))));
    const body = {
      on_clip: g.on_clip.value, on_end: g.on_end.value, on_ad: g.on_ad.value,
      end_seconds: numField(g.end_seconds.value) ?? 60,
      ad_match: { path: g.ad_path.value.trim(), title: g.ad_title.value.trim() },
      shows: shows.map(clean),
      channels: Object.fromEntries(channels.map(({ channel, ...x }) => [channel, clean(x)])),
    };
    try { await cg('live/graphics', 'PUT', body); toast('Reguły grafiki zapisane w CG Playout – działają od następnej pozycji'); route(true); } catch (e) { toast('CG Playout odrzucił reguły: ' + e.message, 'bad'); }
  };
  const lbl = (el, text) => [h('label', { for: el.id }, text), el];
  return h('div', { class: 'split' }, rulesSummary(r), panel('Edytor reguł', h('span', null, doc.source === 'file' ? pill('z panelu', 'ok') : pill('z config.json')),
    h('div', { class: 'pad', 'data-rules': '' },
      h('p', { class: 'dim' }, 'Komendy VizRS (TAKE, OUT…) z polami {title}, {next_title}, {next_start}, {show_title}… Kilka komend – w osobnych liniach. ' +
        'W regułach audycji i kanałów puste pole = jak globalnie, „-” = wyłączone. Zmiana działa od następnej pozycji, bez restartu CG Playout.'),
      h('div', { class: 'form' }, ...lbl(g.on_clip, 'Na start pozycji'), ...lbl(g.on_end, 'Przed końcem audycji'), ...lbl(g.end_seconds, 'Sekund przed końcem'),
        ...lbl(g.on_ad, 'Na przerwę reklamową'), ...lbl(g.ad_path, 'Reklama – ścieżka (regex)'), ...lbl(g.ad_title, 'Reklama – tytuł (regex)')),
      h('h3', null, 'Reguły audycji (pierwsza pasująca)'), showsBox,
      h('h3', null, 'Reguły kanałów'), chBox,
      doc.store ? null : h('div', { class: 'note' }, 'CG Playout nie ma etv_config – reguł nie zapisze.'),
      h('div', { class: 'bar' }, btn('Zapisz reguły grafiki', save, 'acc'))),
    cmdNote('CG Playout GET/PUT /api/live/graphics')));
}
