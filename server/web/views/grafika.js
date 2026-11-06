// Widoki grupy „Grafika i live”: Grafika kanału, Sloty na żywo.

import { VIEWS, h, head } from '../core.js';
import { listView } from '../parts.js';

VIEWS.grafika = listView('Grafika kanału', 'Elementy graficzne legacy (pliki YAML), w tym element VizRS z VizRS CG Playout.', [{
  title: 'Elementy graficzne', cmd: 'GetAllGraphicsElements', cols: [['Name', 'Nazwa'], [(g) => h('span', { class: 'mono' }, g.FileName), 'Plik']],
}], 'Reguły „kiedy która strona VizRS wchodzi na antenę” (makieta) przyjdą w kolejnym etapie razem z VizRS CG Playout.');

VIEWS.live = async () => [
  head('Sloty na żywo', 'Wejścia studia (RTMP, SRT) i audycje na żywo jako pozycje ramówki. Funkcja VizRS CG Playout.'),
  h('div', { class: 'note' }, 'Kolejny etap: panel pokaże stan /ingest i /ingest/state z VizRS CG Playout oraz pozycje Remote Stream z legacy. W prototypie ten ekran jest pusty, żeby nie udawać danych.'),
];
