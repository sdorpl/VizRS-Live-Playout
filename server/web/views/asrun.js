// Dziennik emisji (as-run, K14; wzorzec Vizrt C – Run Status): co faktycznie poszło na antenę kanału.
// Zapis prowadzi VizRS CG Playout (JSONL z rotacją); panel czyta GET /api/live/asrun?channel=&day= przez pośrednika
// i eksportuje CSV w przeglądarce. Kontrakt: DOKUMENTACJA §3 „Kontrakt CG Playout (K12–K17)”.

import { VIEWS, S, h, head, panel, pill, btn, table, toast, api, hms, pad2, cmdNote, onChannel } from '../core.js';

const KIND = {
  item_start: ['start pozycji', 'on'], item_end: ['koniec pozycji', ''], take: ['TAKE strony', 'info'], continue: ['CONTINUE', 'info'], out: ['OUT strony', 'warn'],
  live_on: ['studio na antenie', 'on'], live_off: ['studio zdjęte', 'warn'], hold: ['ZDEJMIJ (studio)', 'warn'], release: ['WPUŚĆ (studio)', 'ok'],
  graphics_off: ['grafika zdjęta', 'bad'], graphics_on: ['grafika przywrócona', 'ok'],
};
const AS = { channel: '', day: '' };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

/** Pole CSV: cudzysłów, gdy jest separator, cudzysłów albo nowa linia. */
export const csvCell = (v) => { const s = v == null ? '' : String(v); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function exportCsv(rows, ch, day) {
  const head_ = ['czas', 'zdarzenie', 'tytuł', 'strona', 'warstwa', 'operator', 'szczegóły'];
  const lines = [head_.join(';'), ...rows.map((e) => [new Date(e.t).toISOString(), e.kind, e.title, e.page, e.layer, e.operator, e.detail].map(csvCell).join(';'))];
  const blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `dziennik-emisji-${ch}-${day}.csv` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

VIEWS.asrun = async () => {
  const title = 'Dziennik emisji';
  const desc = 'Co faktycznie poszło na antenę: start i koniec pozycji, wprowadzone i zdjęte strony grafiki, przejęcia studia, zdjęcie całej grafiki. Zapis prowadzi VizRS CG Playout; eksport do CSV.';
  if (!S.status.cg) return [head(title, desc), h('div', { class: 'note' }, 'VizRS CG Playout nie jest podłączony (VIZRS_LIVE_CG_URL) – dziennik emisji prowadzi CG Playout.')];
  let st;
  try { st = (await api('/api/cg/live/state')).result; } catch (e) { return [head(title, desc), h('div', { class: 'note err' }, 'VizRS CG Playout: ' + e.message)]; }
  const channels = (st.channels || []).filter((c) => onChannel(c.number));
  if (!Array.isArray(st.features) || !st.features.includes('asrun')) {
    return [head(title, desc), h('div', { class: 'note', 'data-asrun-missing': '' }, 'Ta wersja VizRS CG Playout nie prowadzi dziennika emisji (brak „asrun” w features stanu /api/live/state). Zaktualizuj CG Playout – kontrakt w DOKUMENTACJA §3.')];
  }
  if (!channels.some((c) => String(c.number) === AS.channel)) AS.channel = String(channels[0]?.number ?? '');
  AS.day ||= today();
  const sel = h('select', { id: 'asrun-ch', 'aria-label': 'Kanał' }, channels.map((c) => h('option', { value: c.number }, `${c.number} · ${c.name || ''}`)));
  sel.value = AS.channel;
  const day = h('input', { id: 'asrun-day', type: 'date', value: AS.day, 'aria-label': 'Dzień' });
  const filter = h('input', { id: 'asrun-q', type: 'search', placeholder: 'filtr: tytuł, strona, operator…', 'aria-label': 'Filtr' });
  const box = h('div', { 'data-asrun': '' });
  let rows = [];
  const draw = () => {
    const q = filter.value.trim().toLocaleLowerCase('pl');
    const shown = q ? rows.filter((e) => [e.title, e.page, e.operator, e.detail, KIND[e.kind]?.[0]].some((x) => String(x || '').toLocaleLowerCase('pl').includes(q))) : rows;
    box.replaceChildren(table(shown, [
      [(e) => hms(new Date(e.t)), 'Czas', { class: 'num' }],
      [(e) => { const [t, k] = KIND[e.kind] || [e.kind, '']; return pill(t, k); }, 'Zdarzenie'],
      [(e) => e.title || '', 'Pozycja', { class: 'w' }],
      [(e) => (e.page ? `${e.page}${e.layer != null ? ' · W' + e.layer : ''}` : ''), 'Strona'],
      [(e) => e.operator || '', 'Operator'], [(e) => e.detail || '', 'Szczegóły'],
    ], { empty: 'Brak wpisów w tym dniu.' }));
  };
  const load = async () => {
    AS.channel = sel.value; AS.day = day.value || today();
    box.replaceChildren(h('div', { class: 'dim pad' }, 'Wczytuję…'));
    try {
      const r = (await api(`/api/cg/live/asrun/${encodeURIComponent(AS.channel)}/${AS.day}`)).result;
      rows = (r?.entries || []).slice().sort((a, b) => a.t - b.t);
      draw();
    } catch (e) { rows = []; box.replaceChildren(h('div', { class: 'note err' }, 'VizRS CG Playout: ' + e.message)); }
  };
  sel.addEventListener('change', load);
  day.addEventListener('change', load);
  filter.addEventListener('input', draw);
  load();
  return [
    head(title, desc, btn('Eksport CSV', () => { if (!rows.length) return toast('Brak wpisów do eksportu.', 'bad'); exportCsv(rows, AS.channel, AS.day); }, 'acc')),
    panel('Wpisy', h('span', { class: 'bar asrun-bar' }, sel, day, filter), box, cmdNote('CG Playout GET /api/live/asrun?channel=&day=')),
  ];
};
