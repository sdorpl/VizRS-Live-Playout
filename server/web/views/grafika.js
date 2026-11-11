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
  const [elements, health, live, graphics] = await Promise.all([
    has('GetAllGraphicsElements') ? cmd('GetAllGraphicsElements') : [],
    S.status.cg ? cg('health').catch((e) => e) : null,
    S.status.cg ? cg('live/state').catch(() => null) : null,
    S.status.cg ? cg('live/graphics').catch((e) => e) : null,
  ]);
  const rules = graphics && !(graphics instanceof Error) ? graphics.rules || {} : null;
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
      pagesBox.replaceChildren(whenTable(r?.pages || [], pick.value, rules, elements, loadPages));
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
  ];
  const whenPanel = !S.status.cg || health instanceof Error ? null : panel('Kiedy strona wchodzi na antenę', h('span', null, pick), pagesBox,
      h('div', { class: 'hint pad' }, 'Trzy źródła naraz: czas strony z Trio (⏱ kanał – działa przez element legacy), reguły CG Playout z TAKE tej strony i element legacy przypisany w ramówce. Strona z więcej niż jednym źródłem może wejść dwa razy albo o innej porze, niż się wydaje.'),
      cmdNote('CG Playout GET /etv/pages?channel=N', 'GET /api/live/graphics', 'GetProgramScheduleItems', 'GetBlockItems', 'GetDecoById'));

  return [
    head('Grafika kanału', 'Kiedy jaka strona VizRS wchodzi na antenę (reguły CG Playout), stan VizRS CG Playout, strony VizRS, podgląd anteny i elementy graficzne legacy.', refresh),
    whenPanel,
    S.status.cg && !(health instanceof Error) ? rulesPanel(graphics) : null,
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

// ---------- Kiedy strona wchodzi na antenę: czas z Trio, reguły CG Playout, element legacy w ramówce ----------
/** Numer strony VizRS elementu legacy: plik page-<nr>.yml albo nazwa „Strona (nr)” (synchronizacja CG Playout). */
export const elementPage = (g) => {
  const m = /page-(\d+)\.yml$/.exec(g.FileName || '') || /\((\d+)\)\s*$/.exec(g.Name || '');
  return m ? m[1] : null;
};

/** Czas strony na kanale z Trio (`playout` strony VizRS: at, out, ref). */
export function trioTime(p) {
  const t = p?.playout;
  if (!t || (t.at == null && t.out == null)) return null;
  const end = t.ref === 'programme' ? 'audycji (EPG)' : 'pozycji';
  const parts = [];
  if (t.at != null) parts.push(t.at < 0 ? `wchodzi ${-t.at} s przed końcem ${end}` : `wchodzi ${t.at} s po starcie`);
  if (t.out != null) parts.push(`schodzi ${t.out} s przed końcem`);
  return parts.join(', ');
}

/** Reguły CG Playout, które wprowadzają stronę (TAKE z jej numerem), jako „kiedy · zakres”; kanał spoza reguły – pominięty. */
export function rulesTaking(rules, number, channel) {
  if (!rules) return [];
  const takes = (text) => String(text).split('\n').some((line) => {
    const [verb, targets = ''] = line.trim().split(/\s+/);
    return /^take$/i.test(verb || '') && targets.split(',').includes(String(number));
  });
  return ruleRows(rules)
    .filter((x) => x.cmd !== '-' && takes(x.cmd))
    .filter((x) => !x.scope.startsWith('kanał ') || x.scope.startsWith(`kanał ${channel},`) || x.scope === `kanał ${channel}`)
    .map((x) => `${x.when} · ${x.scope}`);
}

// Przypisania elementów graficznych w ramówce legacy (id elementu → [gdzie]); liczone na żądanie, bo to po zapytaniu na harmonogram, blok i deco.
let USES = null;
async function scanUses() {
  const uses = new Map();
  const add = (list, where) => (list || []).forEach((g) => { if (!uses.has(g.Id)) uses.set(g.Id, []); uses.get(g.Id).push(where); });
  const [schedules, blocks, decoGroups] = await Promise.all([
    has('GetAllProgramSchedules') ? cmd('GetAllProgramSchedules') : [],
    has('GetAllBlocks') ? cmd('GetAllBlocks') : [],
    has('GetAllDecoGroups') ? cmd('GetAllDecoGroups') : [],
  ]);
  await Promise.all([
    ...(has('GetProgramScheduleItems') ? schedules : []).map(async (s) => {
      for (const i of await cmd('GetProgramScheduleItems', { Id: s.Id })) add(i.GraphicsElements, `harmonogram „${s.Name}”, pozycja ${(i.Index ?? 0) + 1}`);
    }),
    ...(has('GetBlockItems') ? blocks : []).map(async (b) => {
      for (const i of await cmd('GetBlockItems', { BlockId: b.Id })) add(i.GraphicsElements, `blok „${b.Name}”, pozycja ${(i.Index ?? 0) + 1}`);
    }),
    ...(has('GetDecosByDecoGroupId') && has('GetDecoById') ? decoGroups : []).map(async (g) => {
      for (const d of await cmd('GetDecosByDecoGroupId', { DecoGroupId: g.Id })) {
        const full = await cmd('GetDecoById', { DecoId: d.Id });
        if (full?.GraphicsElementsMode !== 'Disable') add(full?.GraphicsElements, `deco „${d.Name}”`);
      }
    }),
  ]);
  return uses;
}

function whenTable(pages, channel, rules, elements, redraw) {
  const byPage = new Map();
  for (const g of elements || []) { const n = elementPage(g); if (n) byPage.set(n, [...(byPage.get(n) || []), g]); }
  const scan = btn(USES ? 'Sprawdź przypisania ponownie' : 'Sprawdź przypisania w ramówce', async () => {
    scan.disabled = true; scan.textContent = 'Sprawdzam…';
    try { USES = await scanUses(); } catch (e) { toast('Legacy odrzucił odczyt ramówki: ' + e.message, 'bad'); }
    redraw();
  });
  const sources = (p) => {
    const els = byPage.get(String(p.number)) || [];
    const used = USES ? els.flatMap((g) => USES.get(g.Id) || []) : null;
    return { trio: trioTime(p), rules: rulesTaking(rules, p.number, channel), els, used };
  };
  const rows = pages.map((p) => ({ ...p, src: sources(p) }));
  return h('div', { 'data-cg-when': '' },
    table(rows, [
      ['number', 'Nr', { class: 'num' }], ['name', 'Strona'],
      [(p) => p.src.trio || h('span', { class: 'dim' }, 'start pozycji (domyślnie)'), 'Czas z Trio (⏱ kanał)'],
      [(p) => (p.src.rules.length ? h('div', null, p.src.rules.map((x) => h('div', null, x))) : '—'), 'Reguły CG Playout'],
      [(p) => {
        if (!p.src.els.length) return '—';
        const names = p.src.els.map((g) => g.Name).join(', ');
        if (!p.src.used) return h('span', null, names, h('br'), h('span', { class: 'dim' }, 'przypisania: nie sprawdzono'));
        return h('span', null, names, h('br'), p.src.used.length ? h('span', { class: 'dim' }, p.src.used.join('; ')) : h('span', { class: 'dim' }, 'nieprzypisany w ramówce'));
      }, 'Element legacy w ramówce', { class: 'w' }],
      [(p) => {
        const { rules: r, used, els } = p.src;
        if (r.length && used?.length) return pill('reguła i ramówka – może wejść dwa razy', 'warn');
        if (r.length) return pill('reguła CG', 'info');
        if (used?.length) return pill(p.src.trio ? 'ramówka, czas z Trio' : 'ramówka', 'info');
        if (els.length && !used) return h('span', { class: 'dim' }, '? (sprawdź przypisania)');
        return pill('nie wchodzi sama');
      }, 'Skutek'],
    ], { empty: 'Show VizRS nie ma stron dla tego kanału (albo CG Playout nie widzi VizRS).' }),
    h('div', { class: 'bar pad' }, scan, USES ? h('span', { class: 'dim' }, 'przypisania z harmonogramów, bloków i deco legacy (stan z chwili sprawdzenia)') : null));
}

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

function rulesPanel(doc) {
  if (doc instanceof Error || !doc) {
    const e = doc || new Error('brak odpowiedzi');
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
