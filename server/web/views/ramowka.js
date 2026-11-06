// Widoki grupy „Ramówka”: Bloki i szablony, Deco, Playouty (Harmonogramy – views/harmonogramy.js).

import { VIEWS, h, btn, head, panel, cmdNote, table, cmd, route, pl, dateTime, isFiller } from '../core.js';
import { listView, READONLY } from '../parts.js';
import { build } from './antena.js';

VIEWS.bloki = listView('Bloki i szablony', 'Bloki o stałej długości układane w szablony dnia. Odpowiednik Blocks i Templates.', [
  { title: 'Bloki', cmd: 'GetAllBlocks', cols: [['GroupName', 'Grupa'], ['Name', 'Blok'], [(b) => b.Minutes + ' min', 'Długość']] },
  { title: 'Szablony', cmd: 'GetAllTemplates', cols: [['GroupName', 'Grupa'], ['Name', 'Szablon']] },
], READONLY);

VIEWS.deco = listView('Wystrój (deco)', 'Oprawa bloku: znak wodny, grafika, przerwy, wypełniacz. Odpowiednik Decos.', [{
  title: 'Grupy deco', cmd: 'GetAllDecoGroups', cols: [['Name', 'Grupa'], ['DecoCount', 'Deco']],
}], READONLY);

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
