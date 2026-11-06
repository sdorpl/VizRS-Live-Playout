// Widoki grupy „Media”: Biblioteki.

import { VIEWS, pl } from '../core.js';
import { listView, READONLY } from '../parts.js';

VIEWS.media = listView('Biblioteki', 'Skąd biorą się pliki. Odpowiednik Media Sources i Libraries (biblioteki lokalne).', [{
  title: 'Biblioteki lokalne', cmd: 'GetAllLocalLibraries', cols: [['Name', 'Nazwa'], [(l) => pl(l.MediaKind), 'Rodzaj'], ['Id', 'Id', { class: 'num' }]],
}], READONLY);
