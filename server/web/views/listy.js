// Widoki grupy „Listy”: Kolekcje, Playlisty (Wypełniacze: views/wypelniacze.js).

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
