// Widoki grupy „Ramówka”: Bloki i szablony, Deco (Harmonogramy – views/harmonogramy.js, Playouty – views/playouty.js).

import { VIEWS } from '../core.js';
import { listView, READONLY } from '../parts.js';

VIEWS.bloki = listView('Bloki i szablony', 'Bloki o stałej długości układane w szablony dnia. Odpowiednik Blocks i Templates.', [
  { title: 'Bloki', cmd: 'GetAllBlocks', cols: [['GroupName', 'Grupa'], ['Name', 'Blok'], [(b) => b.Minutes + ' min', 'Długość']] },
  { title: 'Szablony', cmd: 'GetAllTemplates', cols: [['GroupName', 'Grupa'], ['Name', 'Szablon']] },
], READONLY);

VIEWS.deco = listView('Wystrój (deco)', 'Oprawa bloku: znak wodny, grafika, przerwy, wypełniacz. Odpowiednik Decos.', [{
  title: 'Grupy deco', cmd: 'GetAllDecoGroups', cols: [['Name', 'Grupa'], ['DecoCount', 'Deco']],
}], READONLY);
