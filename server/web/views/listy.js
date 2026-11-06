// Kolekcje (R4): zwykłe (z pozycjami), inteligentne (zapytanie z liczbą wyników), wielokolekcje (składniki)
// i powtórki. Odpowiednik Collections, Smart Collections, Multi Collections i Rerun Collections w legacy.
// Playlisty: views/playlisty.js. Pozycje do kolekcji zwykłej dodaje się w Przeglądarce mediów.

import { VIEWS, h, btn, panel, cmd, pl, table, toast, confirmDlg, route, cmdNote } from '../core.js';
import { form } from '../form.js';
import { crudView, itemsEditor, contentPicker } from '../parts.js';

const TAB = { i: 0 };

// ---------- zwykłe ----------
/** Karty pozycji kolekcji (GetCollectionCards) spłaszczone do jednej listy z rodzajem. */
const CARD_KINDS = [
  ['MovieCards', 'Movie'], ['ShowCards', 'TelevisionShow'], ['SeasonCards', 'TelevisionSeason'], ['EpisodeCards', 'Episode'],
  ['ArtistCards', 'Artist'], ['MusicVideoCards', 'MusicVideo'], ['OtherVideoCards', 'OtherVideo'], ['SongCards', 'Song'],
  ['ImageCards', 'Image'], ['RemoteStreamCards', 'RemoteStream'],
];
const cards = (r) => CARD_KINDS.flatMap(([k, kind]) => (r?.[k] || []).map((c) => ({ ...c, Kind: kind })));

function collectionItems(col, items) {
  const picked = new Set();
  const remove = async () => {
    if (!picked.size) return toast('Zaznacz pozycje do usunięcia z kolekcji.', 'bad');
    if (!(await confirmDlg('Usuń z kolekcji', `Usunąć ${picked.size} poz. z kolekcji „${col.Name}”? Pliki i pozycje w bibliotece zostają.`, 'Usuń'))) return;
    try {
      await cmd('RemoveItemsFromCollection', { MediaCollectionId: col.Id, MediaItemIds: [...picked] });
      toast('Usunięto z kolekcji.', 'ok');
      route(true);
    } catch (e) { toast('Legacy odrzucił usunięcie: ' + e.message, 'bad'); }
  };
  const cols = [
    [(c) => { const b = h('input', { type: 'checkbox', 'aria-label': `Zaznacz ${c.Title}` }); b.addEventListener('change', () => (b.checked ? picked.add(c.MediaItemId) : picked.delete(c.MediaItemId))); return b; }, ''],
    ['Title', 'Tytuł', { class: 'w' }], [(c) => pl(c.Kind), 'Rodzaj'], ['Subtitle', 'Opis / plik'], ['MediaItemId', 'Id', { class: 'num' }]];
  return panel(`Pozycje kolekcji „${col.Name}”`, h('span', { class: 'dim' }, String(items.length)),
    h('div', { id: 'col-items' }, table(items, cols, { empty: 'Kolekcja jest pusta. Dodaj pozycje w Przeglądarce mediów (zaznacz i „Dodaj do…”).' })),
    h('div', { class: 'bar pad' }, items.length ? btn('Usuń zaznaczone z kolekcji', remove, 'danger') : null, btn('Dodaj z Przeglądarki mediów…', () => (location.hash = '#przegladarka'))),
    cmdNote('GetCollectionCards', 'RemoveItemsFromCollection', 'AddItemsToCollection'));
}

const plain = crudView({
  title: 'Kolekcje',
  desc: 'Zbiory treści, z których buduje się ramówkę. Odpowiednik Collections, Smart Collections, Multi Collections i Rerun Collections w legacy.',
  listCmd: 'GetAllCollections',
  needs: ['GetCollectionCards', 'RemoveItemsFromCollection'],
  commands: { create: 'CreateCollection', update: 'UpdateCollection', delete: 'DeleteCollection' },
  noun: { list: 'Kolekcje zwykłe', new: 'Nowa kolekcja', add: '+ Nowa kolekcja', create: 'Załóż kolekcję', one: (c) => c.Name, title: (c) => c.Name },
  load: async () => {
    const rows = await cmd('GetAllCollections');
    const counts = await Promise.all(rows.map((c) => cmd('GetCollectionCards', { Id: c.Id }).then((r) => cards(r).length).catch(() => null)));
    rows.forEach((c, i) => (c.Count = counts[i]));
    return { rows };
  },
  loadOne: async (c) => ({ items: c ? cards(await cmd('GetCollectionCards', { Id: c.Id })) : [] }),
  id: (c) => c.Id,
  cols: [['Name', 'Nazwa', { class: 'w' }], [(c) => c.Count ?? '?', 'Pozycje', { class: 'num' }]],
  editor: (c) => form('CreateCollection', [{ key: 'Name', label: 'Nazwa', required: true, placeholder: 'np. Reportaże' }], { Name: c?.Name || '' }, { idPrefix: 'col-' }),
  create: (d) => ({ Name: d.Name.trim() }),
  createdId: (r) => r?.Id,
  update: (d, c) => ({ CollectionId: c.Id, Name: d.Name.trim() }),
  del: (c) => ({ CollectionId: c.Id }),
  confirmDelete: (c) => `Usunąć kolekcję „${c.Name}”? Pozycje w bibliotece zostają, ale ramówki korzystające z tej kolekcji stracą treść. Tego nie da się cofnąć.`,
  below: (c, ctx) => (c ? collectionItems(c, ctx.items) : null),
});

// ---------- inteligentne ----------
/** Liczba pozycji pasujących do zapytania (QuerySearchIndexAllItems zwraca listy id po rodzajach). */
async function countQuery(q) {
  const r = await cmd('QuerySearchIndexAllItems', { Query: q });
  return Object.values(r || {}).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
}

const smart = crudView({
  title: 'Kolekcje',
  desc: 'Kolekcja inteligentna to zapisane zapytanie wyszukiwarki legacy – zawsze aktualna lista pasujących pozycji.',
  listCmd: 'GetAllSmartCollections',
  needs: ['QuerySearchIndexAllItems'],
  commands: { create: 'CreateSmartCollection', update: 'UpdateSmartCollection', delete: 'DeleteSmartCollection' },
  noun: { list: 'Kolekcje inteligentne', new: 'Nowa kolekcja inteligentna', add: '+ Nowa inteligentna', create: 'Załóż kolekcję', one: (s) => s.Name, title: (s) => s.Name },
  load: async () => {
    const rows = await cmd('GetAllSmartCollections');
    const counts = await Promise.all(rows.map((s) => countQuery(s.Query).catch(() => null)));
    rows.forEach((s, i) => (s.Count = counts[i]));
    return { rows };
  },
  id: (s) => s.Id,
  cols: [['Name', 'Nazwa'], [(s) => h('span', { class: 'mono' }, s.Query), 'Zapytanie', { class: 'w' }], [(s) => s.Count ?? '?', 'Wyników', { class: 'num' }]],
  editor: (s) => {
    const f = form('CreateSmartCollection', [
      { key: 'Name', label: 'Nazwa', required: true, placeholder: 'np. Archiwum INFO24' },
      { key: 'Query', label: 'Zapytanie', required: true, attrs: { class: 'mono' }, placeholder: 'np. type:other_video AND tag:info',
        hint: 'Składnia wyszukiwarki legacy (jak w Przeglądarce mediów): pola title:, type:, tag:, genre:, library_name:, minutes:…; AND / OR / NOT.' },
    ], { Name: s?.Name || '', Query: s?.Query || '' }, { idPrefix: 'sc-' });
    const out = h('span', { id: 'sc-count', class: 'dim' }, s ? `${s.Count ?? '?'} poz. pasuje do zapisanego zapytania` : '');
    const check = async () => {
      const q = f.peek().Query.trim();
      if (!q) return (out.textContent = 'Podaj zapytanie.');
      out.textContent = 'Liczę…';
      try { const n = await countQuery(q); out.textContent = `${n} poz. pasuje do zapytania`; }
      catch (e) { out.textContent = 'Legacy odrzucił zapytanie: ' + e.message; }
    };
    return { el: h('div', null, f.el, h('div', { class: 'bar pad' }, btn('Sprawdź zapytanie', check), out)), read: f.read };
  },
  create: (d) => ({ Name: d.Name.trim(), Query: d.Query.trim() }),
  createdId: (r) => r?.Id ?? r?.SmartCollectionId,
  update: (d, s) => ({ Id: s.Id, Name: d.Name.trim(), Query: d.Query.trim() }),
  del: (s) => ({ SmartCollectionId: s.Id }),
});

// ---------- wielokolekcje ----------
/** Składniki wielokolekcji z GetMultiCollectionById: zwykłe i inteligentne w jednej liście. */
const parts = (m) => [
  ...(m?.Items || []).map((i) => ({ CollectionType: 'Collection', CollectionId: i.Collection?.Id, SmartCollectionId: null, Name: i.Collection?.Name, ScheduleAsGroup: i.ScheduleAsGroup })),
  ...(m?.SmartItems || []).map((i) => ({ CollectionType: 'SmartCollection', CollectionId: null, SmartCollectionId: i.SmartCollection?.Id, Name: i.SmartCollection?.Name, ScheduleAsGroup: i.ScheduleAsGroup })),
];

const multi = crudView({
  title: 'Kolekcje',
  desc: 'Wielokolekcja łączy kilka kolekcji zwykłych i inteligentnych; składnik „jako grupa” gra w całości, po kolei.',
  listCmd: 'GetAllMultiCollections',
  needs: ['GetMultiCollectionById', 'SearchCollections', 'SearchSmartCollections'],
  commands: { create: 'CreateMultiCollection', update: 'UpdateMultiCollection', delete: 'DeleteMultiCollection' },
  noun: { list: 'Wielokolekcje', new: 'Nowa wielokolekcja', add: '+ Nowa wielokolekcja', create: 'Załóż wielokolekcję', one: (m) => m.Name, title: (m) => m.Name },
  load: async () => ({ rows: await cmd('GetAllMultiCollections') }),
  loadOne: async (m) => ({ parts: m ? parts(await cmd('GetMultiCollectionById', { Id: m.Id })) : [] }),
  id: (m) => m.Id,
  cols: [['Name', 'Nazwa', { class: 'w' }], [(m) => (m.Items?.length || 0) + (m.SmartItems?.length || 0), 'Składników', { class: 'num' }]],
  editor: (m, ctx) => {
    const f = form('CreateMultiCollection', [{ key: 'Name', label: 'Nazwa', required: true, placeholder: 'np. Publicystyka' }], { Name: m?.Name || '' }, { idPrefix: 'mc-' });
    ctx.items = itemsEditor({
      items: ctx.parts,
      addText: '+ Dodaj składnik',
      empty: 'Brak składników. Dodaj kolekcję zwykłą albo inteligentną.',
      cols: [[(p) => pl(p.CollectionType), 'Rodzaj'], [(p) => p.Name || '—', 'Kolekcja', { class: 'w' }], [(p) => (p.ScheduleAsGroup ? 'jako grupa' : 'pojedynczo'), 'Planowanie']],
      newItem: () => ({ CollectionType: 'Collection', CollectionId: null, SmartCollectionId: null, Name: '', ScheduleAsGroup: false }),
      edit: (p) => {
        const pick = contentPicker(p, { idPrefix: 'mc-cp-', kinds: ['Collection', 'SmartCollection'], label: p.Name });
        const grp = h('input', { type: 'checkbox', id: 'mc-group', checked: p.ScheduleAsGroup });
        return {
          el: h('div', { class: 'form' }, h('label', null, 'Kolekcja'), pick.el,
            h('label', { class: 'chk' }, grp, 'planuj jako grupę (wszystkie pozycje po kolei, chronologicznie)')),
          read: () => { const c = pick.read(); return { ...c, Name: pick.label().replace(/^[^:]*: /, ''), ScheduleAsGroup: grp.checked }; },
        };
      },
    });
    return { el: h('div', null, f.el, h('div', { class: 'form' }, h('div', { class: 'sec' }, 'Składniki')), ctx.items.el), read: () => { ctx.items.commit(); return { ...f.read(), Items: ctx.items.value() }; } };
  },
  beforeSave: (ctx, d) => {
    const keys = d.Items.map((p) => p.CollectionType + ':' + (p.CollectionId ?? p.SmartCollectionId));
    if (new Set(keys).size !== keys.length) throw new Error('Ta sama kolekcja jest w wielokolekcji dwa razy.');
  },
  create: (d) => ({ Name: d.Name.trim(), Items: multiItems(d.Items) }),
  createdId: (r) => r?.Id,
  update: (d, m) => ({ MultiCollectionId: m.Id, Name: d.Name.trim(), Items: multiItems(d.Items) }),
  del: (m) => ({ MultiCollectionId: m.Id }),
});
/** Składnik jak w MultiCollectionEditor legacy: grupa gra chronologicznie (kolejność legacy ustala sam). */
const multiItems = (items) => items.map((p) => ({
  CollectionId: p.CollectionType === 'Collection' ? p.CollectionId : null,
  SmartCollectionId: p.CollectionType === 'SmartCollection' ? p.SmartCollectionId : null,
  ScheduleAsGroup: !!p.ScheduleAsGroup, PlaybackOrder: 'Chronological',
}));

// ---------- powtórki ----------
const RERUN_KINDS = ['Collection', 'TelevisionShow', 'TelevisionSeason', 'Artist', 'MultiCollection', 'SmartCollection'];
/** Kolejności jak w RerunCollectionEditor legacy. */
function rerunOrders(type) {
  switch (type) {
    case 'MultiCollection': return ['Shuffle'];
    case 'TelevisionShow': return ['Chronological', 'SeasonEpisode', 'Random', 'Shuffle'];
    default: return ['Chronological', 'Random', 'Shuffle'];
  }
}
const rerunName = (r) => r?.Collection?.Name ?? r?.MultiCollection?.Name ?? r?.SmartCollection?.Name ?? r?.MediaItem?.Name ?? null;

const reruns = crudView({
  title: 'Kolekcje',
  desc: 'Kolekcja powtórek dzieli treść na premiery i powtórki: w ramówce wybiera się „powtórki: premiery” albo „powtórki: powtórki”.',
  listCmd: 'GetPagedRerunCollections',
  needs: ['GetRerunCollectionById'],
  commands: { create: 'CreateRerunCollection', update: 'UpdateRerunCollection', delete: 'DeleteRerunCollection' },
  noun: { list: 'Kolekcje powtórek', new: 'Nowa kolekcja powtórek', add: '+ Nowe powtórki', create: 'Załóż powtórki', one: (r) => r.Name, title: (r) => r.Name },
  load: async () => ({ rows: (await cmd('GetPagedRerunCollections', { Query: '', PageNum: 0, PageSize: 1000 }))?.Page || [] }),
  loadOne: async (r) => ({ full: r ? await cmd('GetRerunCollectionById', { Id: r.Id }) : null }),
  id: (r) => r.Id,
  cols: [['Name', 'Nazwa', { class: 'w' }], [(r) => pl(r.CollectionType), 'Treść'], [(r) => `${pl(r.FirstRunPlaybackOrder)} / ${pl(r.RerunPlaybackOrder)}`, 'Premiery / powtórki']],
  editor: (r, ctx) => {
    const x = ctx.full || r;
    const base = {
      Name: x?.Name || '', FirstRunPlaybackOrder: x?.FirstRunPlaybackOrder || 'Chronological', RerunPlaybackOrder: x?.RerunPlaybackOrder || 'Shuffle',
      CollectionType: x?.CollectionType || 'Collection', CollectionId: x?.Collection?.Id ?? null, MultiCollectionId: x?.MultiCollection?.Id ?? null,
      SmartCollectionId: x?.SmartCollection?.Id ?? null, MediaItemId: x?.MediaItem?.MediaItemId ?? null,
    };
    const orders = (v) => rerunOrders(v._content?.CollectionType).map((o) => [o, pl(o)]);
    let f;
    const build = (v) => form('CreateRerunCollection', [
      { key: 'Name', label: 'Nazwa', required: true, placeholder: 'np. Reportaże – powtórki' },
      { key: '_content', label: 'Treść', render: () => contentPicker(v, { idPrefix: 'rc-cp-', kinds: RERUN_KINDS, label: rerunName(x) }) },
      { key: 'FirstRunPlaybackOrder', label: 'Kolejność premier', options: orders(v) },
      { key: 'RerunPlaybackOrder', label: 'Kolejność powtórek', options: orders(v) },
    ], v, { idPrefix: 'rc-' });
    const box = h('div');
    const render = (v) => { f = build(v); box.replaceChildren(f.el); };
    render(base);
    // zmiana rodzaju treści zmienia listę kolejności
    box.addEventListener('change', (e) => {
      if (e.target.id !== 'rc-cp-kind') return;
      const v = f.peek();
      const ok = rerunOrders(v._content.CollectionType);
      render({ ...v, ...v._content, FirstRunPlaybackOrder: ok.includes(v.FirstRunPlaybackOrder) ? v.FirstRunPlaybackOrder : ok[0], RerunPlaybackOrder: ok.includes(v.RerunPlaybackOrder) ? v.RerunPlaybackOrder : ok[0] });
    });
    return { el: box, read: () => f.read() };
  },
  create: (d) => rerunArgs(d),
  createdId: (r) => r?.Id,
  update: (d, r) => ({ RerunCollectionId: r.Id, ...rerunArgs(d) }),
  del: (r) => ({ RerunCollectionId: r.Id }),
});
/** Legacy oczekuje pełnych obiektów (MediaCollectionViewModel itd.), choć czyta z nich tylko Id. */
function rerunArgs(d) {
  const c = d._content;
  const t = c.CollectionType;
  return {
    Name: d.Name.trim(), CollectionType: t,
    Collection: t === 'Collection' ? { CollectionType: 'Collection', Id: c.CollectionId, Name: '', UseCustomPlaybackOrder: false, State: 'Normal' } : null,
    MultiCollection: t === 'MultiCollection' ? { Id: c.MultiCollectionId, Name: '', Items: [], SmartItems: [] } : null,
    SmartCollection: t === 'SmartCollection' ? { Id: c.SmartCollectionId, Name: '', Query: '' } : null,
    MediaItem: ['TelevisionShow', 'TelevisionSeason', 'Artist'].includes(t) ? { MediaItemId: c.MediaItemId, Name: '' } : null,
    FirstRunPlaybackOrder: d.FirstRunPlaybackOrder, RerunPlaybackOrder: d.RerunPlaybackOrder,
  };
}

// ---------- ekran z zakładkami ----------
const TABS = [['Zwykłe', plain], ['Inteligentne', smart], ['Wielokolekcje', multi], ['Powtórki', reruns]];

VIEWS.kolekcje = async () => {
  const nodes = await TABS[TAB.i][1]();
  const tabs = h('div', { class: 'tabs page-tabs', role: 'tablist' }, TABS.map(([t], i) =>
    h('button', { type: 'button', role: 'tab', class: i === TAB.i ? 'on' : null, 'aria-selected': String(i === TAB.i), onclick: () => { TAB.i = i; route(); } }, t)));
  return [nodes[0], tabs, ...nodes.slice(1)];
};
