// Widoki grupy „System”: Ustawienia, Diagnostyka.

import { S, VIEWS, h, btn, pill, head, panel, cmdNote, table, cmd, pl } from '../core.js';
import { contentPicker } from '../parts.js';

VIEWS.ustawienia = async () => {
  const st = S.status;
  const b = st.bridge?.result;
  return [
    head('Ustawienia', 'Konfiguracja panelu (opcje i zmienne VIZRS_LIVE_*). Ustawienia legacy dojdą razem z ich komendami na białej liście.'),
    h('div', { class: 'cols' },
      panel('Panel', null, table([
        { k: 'Wersja panelu', v: st.panel }, { k: 'Most (legacy)', v: st.bridgeUrl }, { k: 'Strumienie dla widzów', v: st.streamUrl || '— (VIZRS_LIVE_STREAM_URL)' },
        { k: 'VizRS CG System', v: st.vizrsUrl || '— (VIZRS_LIVE_VIZRS_URL)' }, { k: 'Token panelu', v: st.auth ? 'tak' : 'nie (tylko lokalnie)' },
      ], [['k', 'Ustawienie'], ['v', 'Wartość', { class: 'w' }]])),
      panel('Most', null, b ? table([
        { k: 'Wersja mostu', v: b.bridge }, { k: 'Wersja legacy', v: b.legacy }, { k: 'Komend znanych w legacy', v: b.commandsKnown },
        { k: 'Dozwolonych (biała lista)', v: b.commandsAllowed }, { k: 'Z listy, ale nieznanych w tej wersji', v: b.commandsMissing?.join(', ') || 'brak' },
      ], [['k', 'Pole'], ['v', 'Wartość', { class: 'w' }]]) : h('div', { class: 'empty err' }, st.bridgeError || 'most nieosiągalny'))),
  ];
};

VIEWS.diagnostyka = async () => {
  const health = await cmd('GetAllHealthCheckResults', { Refresh: false }).catch((e) => ({ error: e.message }));
  const kind = { Pass: 'ok', Warning: 'warn', Error: 'bad', Info: 'info' };
  const commands = [...S.meta.values()];
  const sel = h('select', { id: 'con-cmd' }, commands.map((c) => h('option', { value: c.name }, `${c.name} (${c.kind === 'query' ? 'zapytanie' : 'komenda'})`)));
  const args = h('textarea', { id: 'con-args', rows: 8 });
  const out = h('pre', { class: 'out' }, '—');
  const template = () => {
    const m = S.meta.get(sel.value);
    const o = {};
    for (const p of m?.parameters || []) o[p.name] = p.values ? p.values[0] : p.type.startsWith('Int') ? 0 : p.type === 'Boolean' ? false : p.type === 'String' ? '' : null;
    args.value = JSON.stringify(o, null, 2);
  };
  sel.addEventListener('change', template);
  if (commands.length) template();
  const send = async () => {
    let body;
    try { body = JSON.parse(args.value || '{}'); } catch (e) { out.textContent = 'To nie jest JSON: ' + e.message; return; }
    out.textContent = '…';
    try { out.textContent = JSON.stringify(await cmd(sel.value, body), null, 2); }
    catch (e) { out.textContent = 'Błąd: ' + e.message; }
  };

  // wybór treści: pola treści pozycji (id kolekcji, serialu…) do użycia w konsoli
  const picked = h('pre', { class: 'out', id: 'cp-out' }, '—');
  const picker = contentPicker(null, { optional: true });
  const showPicked = () => (picked.textContent = JSON.stringify(Object.fromEntries(Object.entries(picker.peek()).filter(([, v]) => v != null && v !== '')), null, 2));
  picker.el.addEventListener('change', showPicked);
  picker.el.addEventListener('input', showPicked);
  showPicked();

  return [
    head('Diagnostyka', 'Stan legacy i mostu, kontrole zdrowia legacy oraz konsola komend z białej listy.'),
    h('div', { class: 'split' },
      panel('Kontrole legacy', null, health.error ? h('div', { class: 'empty err' }, health.error)
        : table(health, [[(r) => pill(pl(r.Status), kind[r.Status]), 'Stan'], ['Title', 'Kontrola'], [(r) => r.BriefMessage || r.Message, 'Opis', { class: 'w' }]]),
      cmdNote('GetAllHealthCheckResults')),
      panel('Konsola komend', btn('Wyślij', send, 'acc'),
        h('div', { class: 'form' }, h('label', { for: 'con-cmd' }, 'Komenda'), sel, h('label', { for: 'con-args' }, 'Argumenty (JSON)'), args),
        h('div', { class: 'pad' }, out),
        h('div', { class: 'cmd' }, 'Tylko komendy z białej listy mostu. Komendy zmieniają dane legacy naprawdę.'))),
    panel('Wybór treści', null,
      h('div', { class: 'split pad' }, picker.el, h('div', null, h('p', { class: 'dim' }, 'Pola treści pozycji (do konsoli komend):'), picked)),
      cmdNote('SearchCollections', 'SearchSmartCollections', 'SearchMultiCollections', 'GetAllPlaylistGroups', 'GetPlaylistsByPlaylistGroupId', 'SearchTelevisionShows', 'SearchTelevisionSeasons', 'SearchArtists')),
  ];
};
