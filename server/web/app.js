// VizRS Live – panel kanału. Wejście UI: start, stan mostu w pasku górnym, router.
// Dane: komendy ErsatzTV legacy przez most (POST /api/cmd/{Nazwa}); moduły:
//   core.js (DOM, API, komunikaty, router, PL) · form.js (formularz z metadanych)
//   parts.js („lista + edytor”, edytor pozycji, wybór treści) · views/*.js (ekrany po grupach menu)

import { S, main, h, btn, head, api, cmd, ApiError, route, hms } from './core.js';
import './views/antena.js';
import './views/kanaly.js';
import './views/profile.js';
import './views/znaki.js';
import './views/media.js';
import './views/listy.js';
import './views/playlisty.js';
import './views/wypelniacze.js';
import './views/ramowka.js';
import './views/playouty.js';
import './views/harmonogramy.js';
import './views/grafika.js';
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

function clock() {
  const c = document.getElementById('clock');
  const tick = () => (c.textContent = hms(new Date()));
  tick();
  setInterval(tick, 1000);
}

async function start() {
  clock();
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
}

start();
