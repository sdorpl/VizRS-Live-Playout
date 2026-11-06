// Widok „Playouty” (grupa Ramówka): zbudowana ramówka kanału – zakładanie wszystkich rodzajów, edycja,
// usuwanie, harmonogramy zastępcze, przebudowa i konserwacja. Odpowiednik Playouts, Add Playout,
// edytorów playoutów (Classic/Block/Sequential/Scripted) i Alternate Schedules w legacy.
//
// Harmonogramy zastępcze: GetPlayoutAlternateSchedules zwraca też harmonogram główny playoutu jako
// ostatnią pozycję (Id = −1, najwyższy Index); ReplacePlayoutAlternateScheduleItems zapisuje pozycję
// o najwyższym Index jako harmonogram główny. Panel pokazuje harmonogram główny jako osobne pole edytora.

import { VIEWS, h, btn, panel, pill, cmd, pl, pad2, table, toast, confirmDlg, route, dateTime, isFiller, cmdNote } from '../core.js';
import { form } from '../form.js';
import { crudView, itemsEditor } from '../parts.js';
import { build } from './antena.js';

const CREATE = {
  Classic: 'CreateClassicPlayout', Block: 'CreateBlockPlayout', Sequential: 'CreateSequentialPlayout',
  Scripted: 'CreateScriptedPlayout', ExternalJson: 'CreateExternalJsonPlayout',
};
const UPDATE_FILE = { Sequential: 'UpdateSequentialPlayout', Scripted: 'UpdateScriptedPlayout', ExternalJson: 'UpdateExternalJsonPlayout' };
const KIND_TEXT = {
  Classic: 'klasyczny (harmonogram)', Block: 'blokowy (bloki i szablony)', Sequential: 'sekwencyjny (plik YAML)',
  Scripted: 'skryptowy (skrypt)', ExternalJson: 'zewnętrzny JSON (dizqueTV)',
};
const FILE_LABEL = { Sequential: 'Plik YAML', Scripted: 'Skrypt', ExternalJson: 'Plik JSON' };
const FILE_HINT = {
  Sequential: 'Pełna ścieżka pliku YAML w kontenerze legacy, np. /config/schedules/kanal.yml (na serwerze: katalog ETV_CONFIG/schedules). Plik musi już istnieć – panel go nie tworzy.',
  Scripted: 'Ścieżka skryptu w kontenerze legacy i ewentualnie argumenty, np. /config/scripts/kanal.py --dni 2. Skrypt musi już istnieć – panel go nie tworzy.',
  ExternalJson: 'Pełna ścieżka pliku JSON (eksport dizqueTV) w kontenerze legacy, np. /config/schedules/kanal.json. Plik musi już istnieć.',
};
const hasFile = (kind) => kind in UPDATE_FILE;
const chanName = (p) => `${p.ChannelNumber} · ${p.ChannelName}`;

// ---------- harmonogramy zastępcze ----------
const DAYS = [['Monday', 'pon'], ['Tuesday', 'wt'], ['Wednesday', 'śr'], ['Thursday', 'czw'], ['Friday', 'pt'], ['Saturday', 'sob'], ['Sunday', 'nd']];
const ALL_DAYS = DAYS.map(([d]) => d);
const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const ALL_MDAYS = range(1, 31);
const ALL_MONTHS = range(1, 12);

/** „1-5, 7, 9-10” z listy liczb; `każdy`, gdy są wszystkie. */
function rangeText(nums, all) {
  const l = [...new Set(nums)].sort((a, b) => a - b);
  if (l.length === all) return 'każdy';
  if (!l.length) return 'żaden';
  const out = [];
  for (let i = 0; i < l.length; i++) {
    const s = l[i];
    while (i < l.length - 1 && l[i + 1] === l[i] + 1) i++;
    out.push(s === l[i] ? String(s) : `${s}-${l[i]}`);
  }
  return out.join(', ');
}
const daysText = (d) => (d.length === 7 ? 'każdy' : d.length ? DAYS.filter(([k]) => d.includes(k)).map(([, t]) => t).join(', ') : 'żaden');
const monthsText = (m) => (m.length === 12 ? 'każdy' : m.length ? [...m].sort((a, b) => a - b).map((x) => MONTHS[x - 1]).join(', ') : 'żaden');
const dayMonth = (d, m, y) => `${d}.${pad2(m)}${y ? '.' + y : ''}`;
const dateRangeText = (a) => (a.LimitToDateRange ? `${dayMonth(a.StartDay, a.StartMonth, a.StartYear)} – ${dayMonth(a.EndDay, a.EndMonth, a.EndYear)}` : '—');

/** Pozycja z GetPlayoutAlternateSchedules w kształcie ReplacePlayoutAlternateSchedule. */
const fromLegacy = (a) => ({
  Id: a.Id, ProgramScheduleId: a.ProgramScheduleId,
  DaysOfWeek: [...(a.DaysOfWeek || [])], DaysOfMonth: [...(a.DaysOfMonth || [])], MonthsOfYear: [...(a.MonthsOfYear || [])],
  LimitToDateRange: !!a.LimitToDateRange, StartMonth: a.StartMonth || 1, StartDay: a.StartDay || 1, StartYear: a.StartYear ?? null,
  EndMonth: a.EndMonth || 12, EndDay: a.EndDay || 31, EndYear: a.EndYear ?? null,
});
/** Nowa pozycja – jak AddAlternateSchedule w legacy: każdy dzień i miesiąc, bez zakresu dat. */
const newAlternate = (scheduleId) => fromLegacy({
  Id: 0, ProgramScheduleId: scheduleId, DaysOfWeek: ALL_DAYS, DaysOfMonth: ALL_MDAYS, MonthsOfYear: ALL_MONTHS,
  StartMonth: 1, StartDay: 1, EndMonth: 1, EndDay: 1,
});

/** Grupa pól wyboru ze skrótami (np. „robocze”, „weekend”); read() wymaga co najmniej jednej wartości. */
function checks(id, label, options, value, shortcuts, tight) {
  const set = new Set(value || []);
  const boxes = options.map(([v, t]) => {
    const c = h('input', { type: 'checkbox', value: String(v), checked: set.has(v) });
    return [v, c, h('label', { class: 'chk' }, c, t)];
  });
  const el = h('div', { id, role: 'group', 'aria-label': label });
  const setAll = (vals) => {
    for (const [v, c] of boxes) c.checked = vals.includes(v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  el.append(h('div', { class: 'multi' + (tight ? ' tight' : '') }, boxes.map((b) => b[2])),
    h('div', { class: 'bar' }, shortcuts.map(([t, vals]) => btn(t, () => setAll(vals)))));
  const peek = () => boxes.filter((b) => b[1].checked).map((b) => b[0]);
  return {
    el,
    peek,
    read() {
      const v = peek();
      if (!v.length) {
        boxes[0][1].focus();
        throw new Error(`Pole „${label}”: zaznacz co najmniej jedną wartość – inaczej harmonogram zastępczy nigdy się nie włączy.`);
      }
      return v;
    },
  };
}

function alternateEditor(item, schedules) {
  const monthOpts = MONTHS.map((m, i) => [i + 1, m]);
  const f = form('', [
    { key: 'ProgramScheduleId', label: 'Harmonogram', options: schedules.map((s) => [s.Id, s.Name]), optional: false },
    { sec: 'Kiedy' },
    { key: 'DaysOfWeek', label: 'Dni tygodnia', render: (v) => checks('alt-DaysOfWeek', 'Dni tygodnia', DAYS, v,
      [['wszystkie', ALL_DAYS], ['robocze', ALL_DAYS.slice(0, 5)], ['weekend', ALL_DAYS.slice(5)], ['żaden', []]]) },
    { key: 'DaysOfMonth', label: 'Dni miesiąca', render: (v) => checks('alt-DaysOfMonth', 'Dni miesiąca', ALL_MDAYS.map((d) => [d, String(d)]), v,
      [['wszystkie', ALL_MDAYS], ['żaden', []]], true) },
    { key: 'MonthsOfYear', label: 'Miesiące', render: (v) => checks('alt-MonthsOfYear', 'Miesiące', monthOpts, v, [['wszystkie', ALL_MONTHS], ['żaden', []]]) },
    { key: 'LimitToDateRange', label: 'Zakres dat', kind: 'check', text: 'tylko w zakresie dat' },
    { label: 'Od', show: (v) => v.LimitToDateRange, group: [
      { key: 'StartDay', label: 'Od: dzień', kind: 'number', step: 1, optional: false, attrs: { min: 1, max: 31, 'aria-label': 'Od: dzień' } },
      { key: 'StartMonth', label: 'Od: miesiąc', options: monthOpts, optional: false, attrs: { 'aria-label': 'Od: miesiąc' } },
      { key: 'StartYear', label: 'Od: rok', kind: 'number', step: 1, placeholder: 'rok', attrs: { 'aria-label': 'Od: rok' } }] },
    { label: 'Do', show: (v) => v.LimitToDateRange, hint: 'Bez roku zakres powtarza się co roku (może przechodzić przez Nowy Rok). Rok podaj w obu polach albo w żadnym.', group: [
      { key: 'EndDay', label: 'Do: dzień', kind: 'number', step: 1, optional: false, attrs: { min: 1, max: 31, 'aria-label': 'Do: dzień' } },
      { key: 'EndMonth', label: 'Do: miesiąc', options: monthOpts, optional: false, attrs: { 'aria-label': 'Do: miesiąc' } },
      { key: 'EndYear', label: 'Do: rok', kind: 'number', step: 1, placeholder: 'rok', attrs: { 'aria-label': 'Do: rok' } }] },
  ], item, { idPrefix: 'alt-' });
  return {
    el: f.el,
    read() {
      const v = f.read();
      if (v.LimitToDateRange) {
        for (const k of ['StartDay', 'EndDay']) if (!(v[k] >= 1 && v[k] <= 31)) throw new Error('Zakres dat: dzień od 1 do 31.');
        if ((v.StartYear == null) !== (v.EndYear == null)) throw new Error('Zakres dat: podaj rok w obu polach albo w żadnym.');
      }
      return v;
    },
  };
}

// ---------- utrzymanie playoutu ----------
async function maintenance(p, command, title, text, done) {
  if (text && !(await confirmDlg(title, text, title))) return;
  try {
    const r = await cmd(command, { PlayoutId: p.PlayoutId });
    toast(r?.queued ? `${chanName(p)}: ${done} (zlecone – legacy robi to w tle).` : `${chanName(p)}: ${done}.`, 'ok');
    setTimeout(() => route(true), 1500);
  } catch (e) { toast(`Legacy odrzucił: ${e.message}`, 'bad'); }
}

function buildState(p) {
  const b = p.BuildStatus;
  if (!b) return pill('nie budowany');
  return b.Success ? pill('OK', 'ok') : pill('błąd budowy', 'bad');
}

// ---------- ekran ----------
VIEWS.playouty = crudView({
  title: 'Playouty',
  desc: 'Zbudowana ramówka kanału: z harmonogramu, bloków, pliku YAML, skryptu albo JSON. Kanał ma najwyżej jeden playout. Odpowiednik Playouts w legacy.',
  listCmd: 'GetPagedPlayouts',
  needs: ['GetAllChannels', 'GetAllProgramSchedules', 'GetFuturePlayoutItemsById', 'BuildPlayout', 'ResetAllPlayouts',
    ...Object.values(CREATE), ...Object.values(UPDATE_FILE), 'ErasePlayoutItems', 'ErasePlayoutHistory', 'CheckForOverlappingPlayoutItems',
    'GetPlayoutAlternateSchedules', 'ReplacePlayoutAlternateScheduleItems'],
  commands: { create: 'CreateClassicPlayout', update: 'UpdatePlayout', delete: 'DeletePlayout' },
  createCmd: (data) => CREATE[data.Kind],
  noun: {
    list: 'Playouty', new: 'Nowy playout', add: '+ Nowy playout', create: 'Załóż playout',
    one: (p) => (p.ChannelName ? `Playout ${chanName(p)}` : 'Playout'), title: (p) => `Playout ${chanName(p)}`,
  },
  empty: 'Brak playoutów. Załóż pierwszy przyciskiem „+ Nowy playout”.',
  load: async () => {
    const [res, channels, schedules] = await Promise.all([
      cmd('GetPagedPlayouts', { Query: '', PageNum: 0, PageSize: 500 }), cmd('GetAllChannels', { ShowDisabled: true }), cmd('GetAllProgramSchedules')]);
    const rows = (res?.Page || []).sort((a, b) => (parseFloat(a.ChannelNumber) || 0) - (parseFloat(b.ChannelNumber) || 0));
    channels.sort((a, b) => (parseFloat(a.Number) || 0) - (parseFloat(b.Number) || 0));
    schedules.sort((a, b) => a.Name.localeCompare(b.Name, 'pl'));
    return { rows, channels, schedules };
  },
  loadOne: async (p) => {
    if (!p) return { alternates: [], main: null, items: [] };
    const [alts, items] = await Promise.all([
      p.ScheduleKind === 'Classic' ? cmd('GetPlayoutAlternateSchedules', { PlayoutId: p.PlayoutId }) : [],
      cmd('GetFuturePlayoutItemsById', { PlayoutId: p.PlayoutId, ShowFiller: true, PageNum: 0, PageSize: 50 }).then((r) => r?.Page || []).catch(() => []),
    ]);
    const sorted = [...alts].sort((a, b) => a.Index - b.Index);
    const main = sorted.pop() || null;  // najwyższy Index = harmonogram główny
    return { alternates: sorted.map(fromLegacy), main, items };
  },
  id: (p) => p.PlayoutId,
  cols: [
    ['ChannelNumber', 'Kanał', { class: 'num' }], ['ChannelName', 'Nazwa'], [(p) => pl(p.ScheduleKind), 'Rodzaj'],
    [(p) => p.ScheduleName || p.ScheduleFile, 'Źródło', { class: 'w' }],
    [(p) => (p.DbDailyRebuildTime ? p.DbDailyRebuildTime.slice(0, 5) : '—'), 'Od nowa o', { class: 'num' }],
    [buildState, 'Budowa'],
  ],
  editor: (p, ctx) => {
    ctx.current = p;
    const free = ctx.channels.filter((c) => !c.PlayoutCount);
    const kind = p?.ScheduleKind;
    const base = p
      ? { ScheduleFile: p.ScheduleFile || '', ProgramScheduleId: ctx.main?.ProgramScheduleId ?? null, DailyRebuildTime: p.DbDailyRebuildTime ?? null }
      : { Kind: 'Classic', ChannelId: free[0]?.Id ?? null, ProgramScheduleId: ctx.schedules[0]?.Id ?? null, ScheduleFile: '', DailyRebuildTime: null };
    const is = (...k) => (v) => k.includes(p ? kind : v.Kind);
    const f = form(p ? 'UpdatePlayout' : 'CreateClassicPlayout', [
      !p && { key: 'Kind', label: 'Rodzaj', options: Object.keys(CREATE).map((k) => [k, KIND_TEXT[k]]), optional: false,
        hint: (v) => (v.Kind === 'Block' ? 'Playout blokowy startuje pusty: szablony dni i deco przypisuje się w ekranie Bloki i szablony (kolejny etap panelu).' : null) },
      !p && { key: 'ChannelId', label: 'Kanał', options: free.map((c) => [c.Id, `${c.Number} · ${c.Name}`]), optional: false,
        hint: free.length ? 'Tylko kanały bez playoutu.' : 'Wszystkie kanały mają już playout – najpierw załóż kanał w widoku Kanały.' },
      (!p || kind === 'Classic') && { key: 'ProgramScheduleId', label: p ? 'Harmonogram główny' : 'Harmonogram', options: ctx.schedules.map((s) => [s.Id, s.Name]),
        optional: false, show: is('Classic'), hint: p ? 'Obowiązuje w dni, w które nie pasuje żaden harmonogram zastępczy.' : 'Harmonogram musi mieć pozycje (legacy sprawdza to przy zakładaniu).' },
      (!p || hasFile(kind)) && { key: 'ScheduleFile', label: p ? FILE_LABEL[kind] : 'Plik', required: true, placeholder: '/config/…',
        show: (v) => hasFile(p ? kind : v.Kind), hint: (v) => FILE_HINT[p ? kind : v.Kind] },
      { key: 'DailyRebuildTime', label: 'Codziennie od nowa o', kind: 'time', placeholder: 'gg:mm',
        hint: 'O tej godzinie legacy co dzień buduje playout od nowa (puste = nie). Bez tego legacy tylko dokłada ramówkę na bieżąco.' },
    ].filter(Boolean), base);
    if (!p) return f;
    const b = p.BuildStatus;
    const info = h('dl', { class: 'kv' },
      h('dt', null, 'Kanał'), h('dd', null, chanName(p)),
      h('dt', null, 'Rodzaj'), h('dd', null, KIND_TEXT[kind] || pl(kind)),
      h('dt', null, 'Ostatnia budowa'), h('dd', null, b ? `${dateTime(b.LastBuild)} · ` : '', buildState(p)));
    const err = b && !b.Success && b.Message ? h('div', { class: 'note err' }, 'Legacy nie zbudował playoutu: ', b.Message) : null;
    if (kind === 'Classic') {
      ctx.altEd = itemsEditor({
        items: ctx.alternates,
        cols: [[(a) => ctx.schedules.find((s) => s.Id === a.ProgramScheduleId)?.Name ?? `id ${a.ProgramScheduleId}`, 'Harmonogram', { class: 'w' }],
          [(a) => daysText(a.DaysOfWeek), 'Dni tygodnia'], [(a) => rangeText(a.DaysOfMonth, 31), 'Dni miesiąca'],
          [(a) => monthsText(a.MonthsOfYear), 'Miesiące'], [dateRangeText, 'Zakres dat']],
        newItem: () => newAlternate((ctx.schedules.find((s) => s.Id !== ctx.main?.ProgramScheduleId) || ctx.schedules[0])?.Id ?? null),
        edit: (a) => alternateEditor(a, ctx.schedules),
        addText: '+ Dodaj harmonogram zastępczy',
        empty: 'Brak harmonogramów zastępczych – każdego dnia obowiązuje harmonogram główny.',
      });
      ctx.altBefore = JSON.stringify(ctx.alternates);
    }
    return { el: h('div', null, info, err, f.el), read: f.read, peek: f.peek };
  },
  footer: (p) => {
    if (!p) return null;
    const k = p.ScheduleKind;
    return h('div', { class: 'maint' },
      h('h3', null, 'Budowa i konserwacja'),
      h('div', { class: 'bar' },
        k === 'Classic' ? btn('Przebuduj', () => build(p, 'Refresh')) : null,
        btn('Od nowa', () => build(p, 'Reset'), 'danger'),
        ['Block', 'Sequential', 'Scripted'].includes(k) ? btn('Wyczyść pozycje', () => maintenance(p, 'ErasePlayoutItems', 'Wyczyść pozycje',
          `Usunąć przyszłe pozycje playoutu kanału ${chanName(p)}? Historia odtwarzania do teraz zostaje; kanał będzie bez ramówki do przebudowy.`, 'wyczyszczono pozycje'), 'danger') : null,
        k !== 'ExternalJson' ? btn('Wyczyść pozycje i historię', () => maintenance(p, 'ErasePlayoutHistory', 'Wyczyść pozycje i historię',
          `Usunąć pozycje i całą historię playoutu kanału ${chanName(p)}? Następna budowa ułoży ramówkę od zera (nowe losowanie).`, 'wyczyszczono pozycje i historię'), 'danger') : null,
        btn('Sprawdź nakładanie pozycji', () => maintenance(p, 'CheckForOverlappingPlayoutItems', null, null, 'sprawdzanie nakładania; wynik w logach legacy'))));
  },
  below: (p, ctx) => {
    if (!p) return null;
    const alt = p.ScheduleKind !== 'Classic' ? null : p.PlayoutMode === 'OnDemand'
      ? panel('Harmonogramy zastępcze', null, h('div', { class: 'note' }, 'Kanał nadaje w trybie „na żądanie” – legacy nie pozwala na harmonogramy zastępcze.'))
      : panel(`Harmonogramy zastępcze · ${p.ChannelName}`, h('span', { class: 'dim' }, 'pierwszy pasujący wygrywa; zapis razem z playoutem („Zapisz”)'),
        ctx.altEd.el, cmdNote('GetPlayoutAlternateSchedules', 'ReplacePlayoutAlternateScheduleItems'));
    const items = panel(`${p.ChannelName} · najbliższe pozycje`, null,
      table(ctx.items, [[(i) => dateTime(i.Start), 'Start', { class: 'num' }], [(i) => dateTime(i.Finish), 'Koniec', { class: 'num' }],
        [(i) => (isFiller(i) ? h('span', { class: 'dim' }, i.Title + ' (wypełniacz)') : i.Title), 'Pozycja', { class: 'w' }], ['Duration', 'Czas']],
      { empty: 'Brak przyszłych pozycji – przebuduj playout.' }),
      cmdNote('GetFuturePlayoutItemsById', 'BuildPlayout'));
    return [alt, items];
  },
  beforeSave: (ctx) => {
    if (ctx.altEd) {
      try { ctx.altEd.commit(); } catch (e) { throw new Error('Harmonogram zastępczy w edycji: ' + e.message); }
    }
  },
  create: (data) => ({ ChannelId: data.ChannelId, ProgramScheduleId: data.ProgramScheduleId, ScheduleFile: (data.ScheduleFile || '').trim() }),
  createdId: (r) => r?.PlayoutId,
  update: (data, p) => ({ PlayoutId: p.PlayoutId, DailyRebuildTime: data.DailyRebuildTime }),
  afterSave: async (id, ctx, data) => {
    const p = ctx.current;
    if (!p) {
      if (data.DailyRebuildTime) {
        try { await cmd('UpdatePlayout', { PlayoutId: id, DailyRebuildTime: data.DailyRebuildTime }); }
        catch (e) { throw new Error('Playout założony, ale legacy odrzucił godzinę przebudowy: ' + e.message); }
      }
      return;
    }
    const k = p.ScheduleKind;
    if (hasFile(k) && data.ScheduleFile.trim() !== (p.ScheduleFile || '')) {
      try { await cmd(UPDATE_FILE[k], { PlayoutId: id, ScheduleFile: data.ScheduleFile.trim() }); }
      catch (e) { throw new Error('Godzina przebudowy zapisana, ale legacy odrzucił ścieżkę pliku: ' + e.message); }
    }
    if (k === 'Classic' && ctx.main) {
      const alts = ctx.altEd ? ctx.altEd.value() : ctx.alternates;
      if (JSON.stringify(alts) === ctx.altBefore && data.ProgramScheduleId === ctx.main.ProgramScheduleId) return;
      const items = [...alts.map((a, i) => ({ ...a, Index: i + 1 })),
        { ...fromLegacy(ctx.main), Id: ctx.main.Id, ProgramScheduleId: data.ProgramScheduleId, Index: alts.length + 1 }];
      try { await cmd('ReplacePlayoutAlternateScheduleItems', { PlayoutId: id, Items: items }); }
      catch (e) { throw new Error('Godzina przebudowy zapisana, ale legacy odrzucił harmonogramy: ' + e.message); }
    }
  },
  del: (p) => ({ PlayoutId: p.PlayoutId }),
  confirmDelete: (p) => `Usunąć playout kanału ${chanName(p)}? Kanał zostanie bez ramówki (harmonogram, pliki i kanał zostają). Tego nie da się cofnąć.`,
  headExtra: () => btn('Resetuj wszystkie', resetAll, 'danger'),
});

async function resetAll() {
  if (!(await confirmDlg('Resetuj wszystkie playouty',
    'Zbudować od nowa playouty wszystkich kanałów? Klasyczne legacy odświeża, pozostałe buduje od zera. Ramówki na antenie mogą się zmienić.', 'Resetuj wszystkie'))) return;
  try {
    await cmd('ResetAllPlayouts');
    toast('Zlecono przebudowę wszystkich playoutów. Legacy robi to w tle.', 'ok');
    setTimeout(() => route(true), 2500);
  } catch (e) { toast('Legacy odrzucił: ' + e.message, 'bad'); }
}
