// Widoki grupy „Antena”: Na antenie, Przewodnik EPG.

import { S, VIEWS, h, btn, pill, head, panel, cmdNote, toast, confirmDlg, cmd, route, pl, hm, dur, isFiller } from '../core.js';

/** Przebudowa playoutu przez kolejkę legacy (też w widoku Playouty). */
export async function build(p, mode) {
  if (mode === 'Reset' && !(await confirmDlg('Playout od nowa', `Zbudować playout kanału ${p.ChannelNumber} · ${p.ChannelName} od nowa? Ramówka zostanie ułożona ponownie od teraz.`, 'Buduj od nowa'))) return;
  try {
    await cmd('BuildPlayout', { PlayoutId: p.PlayoutId, Mode: mode });
    toast(`Playout ${p.ChannelName}: zlecono (${pl(mode)}). Legacy buduje go w tle.`, 'ok');
    setTimeout(() => route(true), 2500);
  } catch (e) { toast(e.message, 'bad'); }
}

VIEWS.antena = async () => {
  const [channels, playouts] = await Promise.all([cmd('GetAllChannels', { ShowDisabled: false }), cmd('GetPagedPlayouts', { Query: '', PageNum: 0, PageSize: 500 })]);
  const byNumber = new Map((playouts?.Page || []).map((p) => [p.ChannelNumber, p]));
  const items = await Promise.all(channels.map(async (c) => {
    const p = byNumber.get(c.Number);
    if (!p) return [];
    try { return (await cmd('GetFuturePlayoutItemsById', { PlayoutId: p.PlayoutId, ShowFiller: true, PageNum: 0, PageSize: 8 }))?.Page || []; }
    catch { return []; }
  }));

  const progressEls = [];
  const cards = channels.map((c, i) => {
    const p = byNumber.get(c.Number);
    const list = items[i];
    const now = Date.now();
    const cur = list.find((it) => new Date(it.Start) <= now && now < new Date(it.Finish));
    const next = list.filter((it) => new Date(it.Start) > now).slice(0, 3);
    const bar = h('i');
    const left = h('span', { class: 'num' });
    if (cur) progressEls.push({ bar, left, start: +new Date(cur.Start), finish: +new Date(cur.Finish) });
    const state = !p ? pill('brak playoutu', 'warn') : cur ? pill('W RAMÓWCE', 'on') : pill('przerwa w ramówce', 'warn');
    const stream = S.status.streamUrl ? h('a', { href: `${S.status.streamUrl}/iptv/channel/${encodeURIComponent(c.Number)}.m3u8`, target: '_blank', rel: 'noopener' }, 'Strumień ↗') : null;
    return panel(`${c.Number} · ${c.Name}`, state,
      h('div', { class: 'chan' },
        cur
          ? h('div', { class: 'np' },
            h('div', { class: 'now' }, h('b', null, cur.Title), h('span', { class: 'dim num' }, `${hm(new Date(cur.Start))}–${hm(new Date(cur.Finish))}`), h('span', { class: 'grow' }), left),
            h('div', { class: 'prog' }, bar))
          : h('div', { class: 'dim' }, p ? 'Teraz nic nie jest zaplanowane – leci wypełniacz zapasowy kanału.' : 'Kanał nie ma playoutu – załóż go w widoku Playouty.'),
        next.length ? h('div', { class: 'dim' }, 'Następnie: ', next.map((n, j) => [j ? ' · ' : '', h('span', { class: 'num' }, hm(new Date(n.Start))), ' ', n.Title])) : null,
        h('div', { class: 'bar' },
          p ? btn('Przebuduj', () => build(p, 'Refresh')) : null,
          p ? btn('Od nowa', () => build(p, 'Reset'), 'danger') : null,
          stream,
          S.status.vizrsUrl ? h('a', { href: S.status.vizrsUrl + '/trio', target: '_blank', rel: 'noopener' }, 'Trio ↗') : null)));
  });

  const events = channels.flatMap((c, i) => items[i].filter((it) => new Date(it.Start) > Date.now()).map((it) => ({ c, it })))
    .sort((a, b) => new Date(a.it.Start) - new Date(b.it.Start)).slice(0, 12);

  const tick = () => {
    const now = Date.now();
    for (const e of progressEls) {
      e.bar.style.width = Math.min(100, Math.max(0, ((now - e.start) / (e.finish - e.start)) * 100)) + '%';
      e.left.textContent = '−' + dur(e.finish - now);
    }
  };
  tick();
  S.timers.push(setInterval(tick, 1000), setInterval(() => route(true), 30000));

  return [
    head('Na antenie', 'Co teraz idzie w ramówce każdego kanału i co następne. Dane z playoutów legacy, odświeżane co 30 s.',
      btn('Odśwież', () => route(true))),
    h('div', { class: 'split wide' },
      h('div', { class: 'cols' }, cards.length ? cards : h('div', { class: 'note' }, 'Brak włączonych kanałów. Dodaj kanał w widoku Kanały.')),
      h('div', { class: 'cols' },
        S.status.vizrsUrl ? panel('Grafika VizRS (/output)', null, h('div', { class: 'pad' }, h('iframe', { class: 'preview', src: S.status.vizrsUrl + '/output', title: 'Podgląd grafiki VizRS' }))) : null,
        panel('Najbliższe pozycje', null,
          events.length
            ? h('div', { class: 'tl' }, events.map(({ c, it }) => h('div', { class: 'ev' }, h('span', { class: 'num' }, hm(new Date(it.Start))), pill(c.Name), h('span', null, it.Title, isFiller(it) ? h('span', { class: 'dim' }, ' (wypełniacz)') : null))))
            : h('div', { class: 'empty' }, 'Brak zaplanowanych pozycji.')))),
    panel('Most', null, cmdNote('GetAllChannels', 'GetPagedPlayouts', 'GetFuturePlayoutItemsById', 'BuildPlayout')),
  ];
};

VIEWS.epg = async () => {
  const res = await cmd('GetPagedPlayouts', { Query: '', PageNum: 0, PageSize: 100 });
  const rows = (res?.Page || []).sort((a, b) => (parseFloat(a.ChannelNumber) || 0) - (parseFloat(b.ChannelNumber) || 0));
  const lists = await Promise.all(rows.map((p) => cmd('GetFuturePlayoutItemsById', { PlayoutId: p.PlayoutId, ShowFiller: true, PageNum: 0, PageSize: 80 }).then((r) => r?.Page || []).catch(() => [])));
  const t0 = new Date(); t0.setMinutes(t0.getMinutes() < 30 ? 0 : 30, 0, 0);
  const span = 4 * 3600e3, t1 = +t0 + span;
  const x = (t) => ((t - t0) / span) * 100;
  const ruler = h('div', { class: 'ruler' }, [0, 1, 2, 3].map((k) => { const s = h('span', null, hm(new Date(+t0 + k * 3600e3))); s.style.left = k * 25 + '%'; return s; }));
  const nowLine = () => { const l = h('div', { class: 'nowl' }); l.style.left = x(Date.now()) + '%'; return l; };
  const grid = h('div', { class: 'epg' }, h('div', { class: 'ch dim' }, 'kanał'), ruler);
  rows.forEach((p, i) => {
    grid.append(h('div', { class: 'ch' }, h('span', { class: 'num dim' }, p.ChannelNumber), p.ChannelName));
    const row = h('div', { class: 'row' });
    for (const it of lists[i]) {
      const s = +new Date(it.Start), e = +new Date(it.Finish);
      if (e <= +t0 || s >= t1) continue;
      const el = h('div', { class: 'p' + (s <= Date.now() && Date.now() < e ? ' now' : '') + (isFiller(it) ? ' fill' : ''), title: `${hm(new Date(s))}–${hm(new Date(e))} ${it.Title}` }, it.Title);
      el.style.left = Math.max(0, x(s)) + '%';
      el.style.width = `calc(${Math.min(100, x(e)) - Math.max(0, x(s))}% - 2px)`;
      row.append(el);
    }
    row.append(nowLine());
    grid.append(row);
  });
  return [
    head('Przewodnik EPG', 'Ramówka kanałów na najbliższe 4 godziny, tak jak zobaczy ją widz.',
      S.status.streamUrl ? h('a', { href: S.status.streamUrl + '/iptv/xmltv.xml', target: '_blank', rel: 'noopener' }, 'xmltv.xml ↗') : null),
    panel('Dziś', null, rows.length ? h('div', { class: 'tw' }, grid) : h('div', { class: 'empty' }, 'Brak playoutów.'), cmdNote('GetPagedPlayouts', 'GetFuturePlayoutItemsById')),
  ];
};
