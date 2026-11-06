// Kalendarz tygodnia playoutu blokowego (R6): szablony dnia przypisane do dni (z szablonem deco) i deco domyślne.
// Odpowiednik Playout Templates Editor i Block Playout Editor (deco domyślne) w legacy. Wybór szablonu na dzień –
// jak w legacy: pierwsza pasująca pozycja wg kolejności (when.js). Zmiany wchodzą na antenę po przebudowie playoutu.

import { h, btn, panel, cmd, pad2, cmdNote } from '../core.js';
import { form } from '../form.js';
import { itemsEditor, dayBar, minutesOf } from '../parts.js';
import { fromWhen, newWhen, whenEditor, pickFor, daysText, rangeText, monthsText, dateRangeText, DAYS } from '../when.js';

export const CAL_COMMANDS = ['GetPlayoutTemplates', 'ReplacePlayoutTemplateItems', 'GetDecoByPlayoutId', 'UpdateDefaultDeco', 'GetAllTemplates', 'GetTemplateItems',
  'GetAllBlocks', 'GetAllDecoTemplateGroups', 'GetDecoTemplatesByDecoTemplateGroupId', 'GetDecoTemplateItems', 'GetAllDecoGroups', 'GetDecosByDecoGroupId'];

const fromVm = (t) => ({ Id: t.Id, TemplateId: t.Template?.Id ?? null, DecoTemplateId: t.DecoTemplate?.Id ?? null, ...fromWhen(t) });
const weekStart = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

/** Dane kalendarza dla playoutu blokowego (dołożone do ctx edytora playoutu). */
export async function loadCalendar(p) {
  const [pts, templates, blocks, dtGroups, decoGroups, deco] = await Promise.all([
    cmd('GetPlayoutTemplates', { PlayoutId: p.PlayoutId }), cmd('GetAllTemplates'), cmd('GetAllBlocks'), cmd('GetAllDecoTemplateGroups'), cmd('GetAllDecoGroups'),
    cmd('GetDecoByPlayoutId', { PlayoutId: p.PlayoutId }).catch(() => null)]);
  const [dts, decos] = await Promise.all([
    Promise.all(dtGroups.map((g) => cmd('GetDecoTemplatesByDecoTemplateGroupId', { DecoTemplateGroupId: g.Id }))).then((l) => l.flat()),
    Promise.all(decoGroups.map((g) => cmd('GetDecosByDecoGroupId', { DecoGroupId: g.Id }))).then((l) => l.flat())]);
  const [tItems, dtItems] = await Promise.all([
    Promise.all(templates.map((t) => cmd('GetTemplateItems', { TemplateId: t.Id }).then((r) => [t.Id, r]))).then((l) => new Map(l)),
    Promise.all(dts.map((t) => cmd('GetDecoTemplateItems', { DecoTemplateId: t.Id }).then((r) => [t.Id, r]))).then((l) => new Map(l))]);
  const items = [...pts].sort((a, b) => a.Index - b.Index).map(fromVm);
  const defaultDeco = deco?.Id ?? null;
  return { cal: { items, before: JSON.stringify(items), templates, blocks, dts, decos, tItems, dtItems, defaultDeco, week: weekStart(new Date()) } };
}

/** Panele kalendarza pod edytorem playoutu. */
export function calendarPanels(p, ctx) {
  const c = ctx.cal;
  const tName = (id) => { const t = c.templates.find((x) => x.Id === id); return t ? `${t.GroupName} / ${t.Name}` : id == null ? '—' : `szablon ${id}`; };
  const dtName = (id) => { const t = c.dts.find((x) => x.Id === id); return t ? `${t.GroupName} / ${t.Name}` : id == null ? '—' : `szablon deco ${id}`; };
  const short = (list, id) => list.find((x) => x.Id === id)?.Name ?? String(id);
  const week = h('div', { class: 'week', id: 'cal-week' });
  const title = h('span', { class: 'dim', id: 'cal-range' });

  const drawWeek = (items) => {
    const today = new Date().toDateString();
    const rows = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(c.week); d.setDate(d.getDate() + i);
      const k = pickFor(items, d);
      const it = items[k];
      const blocks = it ? (c.tItems.get(it.TemplateId) || []).map((x) => {
        const s = minutesOf(x.StartTime);
        const len = c.blocks.find((b) => b.Id === x.BlockId)?.Minutes ?? Math.max(1, minutesOf(x.EndTime) - s);
        return { start: s, end: s + len, label: x.BlockName };
      }) : [];
      const decos = it && it.DecoTemplateId != null ? (c.dtItems.get(it.DecoTemplateId) || []).map((x) => {
        const s = minutesOf(x.StartTime); let e = minutesOf(x.EndTime); if (e <= s) e += 1440;
        return { start: s, end: e, label: x.DecoName, cls: 'deco' };
      }) : [];
      rows.push(
        h('div', { class: 'day' + (d.toDateString() === today ? ' today' : '') },
          h('b', null, `${DAYS[i][1]} ${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`),
          h('span', { class: it ? null : 'err', title: it ? tName(it.TemplateId) : null }, it ? `${k + 1}. ${short(c.templates, it.TemplateId)}` : 'brak szablonu'),
          it && it.DecoTemplateId != null ? h('span', { class: 'dim', title: dtName(it.DecoTemplateId) }, 'deco: ' + short(c.dts, it.DecoTemplateId)) : null),
        h('div', { class: 'bars' },
          dayBar(blocks, { label: `Bloki ${DAYS[i][1]}`, empty: it ? 'szablon bez bloków' : 'nic nie zaplanowane – martwe powietrze' }),
          dayBar(decos, { cls: 'thin', ruler: false, label: `Deco ${DAYS[i][1]}`, empty: c.defaultDeco != null ? 'deco domyślne' : 'bez deco' })));
    }
    const end = new Date(c.week); end.setDate(end.getDate() + 6);
    title.textContent = `${pad2(c.week.getDate())}.${pad2(c.week.getMonth() + 1)} – ${pad2(end.getDate())}.${pad2(end.getMonth() + 1)}.${end.getFullYear()}`;
    week.replaceChildren(...rows);
  };
  const shift = (n) => { c.week = new Date(c.week); c.week.setDate(c.week.getDate() + 7 * n); drawWeek(ctx.calEd.value()); };

  ctx.calEd = itemsEditor({
    items: c.items,
    copy: true,
    addText: '+ Dodaj szablon dnia',
    empty: 'Brak szablonów – playout blokowy nic nie nada. Dodaj szablon dnia (np. „robocze” i osobny na weekend).',
    onChange: drawWeek,
    cols: [[(t) => tName(t.TemplateId), 'Szablon dnia', { class: 'w' }], [(t) => dtName(t.DecoTemplateId), 'Szablon deco'],
      [(t) => daysText(t.DaysOfWeek), 'Dni tygodnia'], [(t) => rangeText(t.DaysOfMonth, 31), 'Dni miesiąca'], [(t) => monthsText(t.MonthsOfYear), 'Miesiące'], [dateRangeText, 'Zakres dat']],
    newItem: () => ({ Id: 0, TemplateId: c.templates[0]?.Id ?? null, DecoTemplateId: null, ...newWhen() }),
    edit: (t) => whenEditor(t, [
      { key: 'TemplateId', label: 'Szablon dnia', options: c.templates.map((x) => [x.Id, `${x.GroupName} / ${x.Name}`]), optional: false,
        hint: c.templates.length ? null : 'Najpierw załóż szablon dnia (Bloki i szablony → Szablony dnia).' },
      { key: 'DecoTemplateId', label: 'Szablon deco', kind: 'pick', options: c.dts.map((x) => [x.Id, `${x.GroupName} / ${x.Name}`]), none: 'bez szablonu deco (deco domyślne)' },
    ], 'pt-'),
  });
  const decoForm = form('UpdateDefaultDeco', [
    { key: 'DecoId', label: 'Deco domyślne', kind: 'pick', options: c.decos.map((d) => [d.Id, `${d.DecoGroupName} / ${d.Name}`]), none: 'bez deco',
      hint: 'Obowiązuje w godzinach, których nie pokrywa szablon deco dnia.' },
  ], { DecoId: c.defaultDeco }, { idPrefix: 'cal-' });
  ctx.calDeco = decoForm;
  drawWeek(c.items);
  return [
    panel(`Kalendarz tygodnia · ${p.ChannelName}`, [title, btn('‹ tydzień', () => shift(-1)), btn('dziś', () => { c.week = weekStart(new Date()); drawWeek(ctx.calEd.value()); }), btn('tydzień ›', () => shift(1))],
      week, h('div', { class: 'hint pad' }, 'Górny pasek – bloki szablonu dnia, dolny – deco z szablonu deco. Podgląd liczy się z bieżących (także niezapisanych) przypisań.'),
      cmdNote('GetPlayoutTemplates', 'GetTemplateItems', 'GetDecoTemplateItems')),
    panel('Szablony dni', h('span', { class: 'dim' }, 'pierwszy pasujący wygrywa; zapis razem z playoutem („Zapisz”), na antenie po przebudowie'),
      ctx.calEd.el, decoForm.el, cmdNote('ReplacePlayoutTemplateItems', 'GetDecoByPlayoutId', 'UpdateDefaultDeco')),
  ];
}

/** Zapis kalendarza (po „Zapisz” playoutu); zwraca true, gdy coś się zmieniło. */
export async function saveCalendar(id, ctx) {
  const c = ctx.cal;
  let changed = false;
  const items = ctx.calEd.value();
  if (JSON.stringify(items) !== c.before) {
    if (items.some((t) => t.TemplateId == null)) throw new Error('Kalendarz: każda pozycja musi mieć szablon dnia.');
    try { await cmd('ReplacePlayoutTemplateItems', { PlayoutId: id, Items: items.map((t, i) => ({ ...t, Index: i })) }); }
    catch (e) { throw new Error('Legacy odrzucił kalendarz szablonów: ' + e.message); }
    changed = true;
  }
  const deco = ctx.calDeco.read().DecoId;
  if (deco !== c.defaultDeco) {
    try { await cmd('UpdateDefaultDeco', { PlayoutId: id, DecoId: deco }); }
    catch (e) { throw new Error('Legacy odrzucił deco domyślne: ' + e.message); }
    changed = true;
  }
  return changed;
}
