// Widoki grupy „Listy”: Kolekcje, Playlisty, Wypełniacze.

import { VIEWS, h, pl } from '../core.js';
import { listView, READONLY } from '../parts.js';

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
