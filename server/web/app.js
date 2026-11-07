// VizRS Live – panel kanału. Wejście UI: start, stan mostu w pasku górnym, router.
// Dane: komendy ErsatzTV legacy przez most (POST /api/cmd/{Nazwa}); moduły:
//   core.js (DOM, API, komunikaty, router, PL) · form.js (formularz z metadanych)
//   parts.js („lista + edytor”, edytor pozycji, wybór treści, grupy, oś doby) · when.js (dni, miesiące, zakres dat)
//   · views/*.js (ekrany po grupach menu)

import { S, main, h, btn, head, api, cmd, ApiError, route, hms, dialog, operatorName } from './core.js';
import './views/antena.js';
import './views/kanaly.js';
import './views/profile.js';
import './views/znaki.js';
import './views/media.js';
import './views/zrodla.js';
import './views/listy.js';
import './views/playlisty.js';
import './views/wypelniacze.js';
import './views/bloki.js';
import './views/deco.js';
import './views/playouty.js';
import './views/harmonogramy.js';
import './views/grafika.js';
import './views/live.js';
import './views/system.js';

async function refreshStatus() {
  const d = await api('/api/status');
  S.status = d.result;
  const b = S.status.bridge?.result;
  const sb = document.getElementById('st-bridge');
  const sl = document.getElementById('st-legacy');
  sb.textContent = b ? `most ${b.bridge}: OK` : 'most: brak połączenia';
  sb.className = 'pill ' + (b ? 'ok' : 'bad');
  sb.title = S.status.bridgeError || '';
  sl.textContent = b ? `legacy ${b.legacy}` : 'legacy: ?';
  sl.className = 'pill ' + (b ? 'info' : '');
  document.getElementById('logout').hidden = !S.status.auth;
  refreshWarnings();
}

/** Licznik playoutów, których legacy nie zbudował (jak licznik ostrzeżeń w menu legacy). */
async function refreshWarnings() {
  const w = document.getElementById('st-warn');
  if (!S.meta.has('GetPlayoutWarningsCount')) return;
  try {
    const n = await cmd('GetPlayoutWarningsCount');
    w.textContent = `playouty z błędem: ${n}`;
    w.hidden = !n;
  } catch { w.hidden = true; }
}

/** Wskaźnik „studio na antenie” w pasku górnym (VizRS CG Playout), widoczny na każdym ekranie. */
async function refreshStudio() {
  const el = document.getElementById('st-studio');
  if (!S.status?.cg) { el.hidden = true; return; }
  try {
    const st = (await api('/api/cg/live/state')).result;
    const air = (st.channels || []).filter((c) => c.on_air).map((c) => c.number);
    const held = (st.channels || []).filter((c) => c.hold).map((c) => c.number);
    el.textContent = air.length ? `studio na antenie: ${air.join(', ')}` : held.length ? `studio wstrzymane: ${held.join(', ')}` : 'studio: ramówka';
    el.className = 'pill ' + (air.length ? 'on' : held.length ? 'warn' : '');
    el.hidden = false;
  } catch { el.textContent = 'CG Playout: brak połączenia'; el.className = 'pill bad'; el.hidden = false; }
}

function operatorButton() {
  const b = document.getElementById('st-operator');
  const show = () => (b.textContent = `operator: ${operatorName() || '–'}`);
  show();
  b.addEventListener('click', async () => {
    const input = h('input', { id: 'op-name', maxlength: 40, value: operatorName() });
    const body = h('div', { class: 'form' }, h('label', { for: 'op-name' }, 'Stanowisko / operator'), input,
      h('span'), h('span', { class: 'dim' }, 'Trafia do dziennika zdarzeń CG Playout (ZDEJMIJ, WPUŚĆ, audycje). Pamiętane w tej przeglądarce.'));
    if (await dialog('Nazwa stanowiska', body, [['Anuluj', false], ['Zapisz', true, 'acc']])) {
      operatorName(input.value.trim().slice(0, 40));
      show();
    }
  });
}

function clock() {
  const c = document.getElementById('clock');
  const tick = () => (c.textContent = hms(new Date()));
  tick();
  setInterval(tick, 1000);
}

async function start() {
  clock();
  operatorButton();
  document.getElementById('logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST', body: '' }); location.reload(); });
  try {
    await refreshStatus();
    if (S.status.bridge) {
      const c = await api('/api/commands');
      S.meta = new Map(c.result.map((x) => [x.name, x]));
      refreshWarnings();
    }
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
  }
  setInterval(() => refreshStatus().catch(() => {}), 15000);
  window.addEventListener('hashchange', () => route());
  if (!S.status?.bridge) {
    main.replaceChildren(head('Brak połączenia z mostem'), h('div', { class: 'note err' }, S.status?.bridgeError || 'Serwer panelu nie odpowiada.'),
      h('div', { class: 'note' }, 'Sprawdź, czy ErsatzTV legacy działa z mostem (obraz vizrs-live-legacy) i czy VIZRS_LIVE_BRIDGE_TOKEN = VIZRS_BRIDGE_TOKEN.'),
      btn('Spróbuj ponownie', () => location.reload()));
    return;
  }
  route();
  refreshStudio();
  setInterval(refreshStudio, 5000);
}

start();
