// Widoki grupy „Antena”: Na antenie, Przewodnik EPG.

import { openMonitor } from '../player.js';
import { S, VIEWS, h, btn, pill, head, panel, cmdNote, toast, confirmDlg, cmd, api, route, pl, hm, dur, isFiller, trioLink, vizrsPreview, vizrsUrl, onChannel } from '../core.js';

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
  // Ramka VizRS w karcie kanału tylko przy antenach kanałów (--vizrs-channels); inaczej jedna wspólna po prawej.
  const multi = !!(S.status?.vizrsUrl && S.status.vizrsChannels);
  const load = async () => {
    const [allChannels, playouts, cgState] = await Promise.all([
      cmd('GetAllChannels', { ShowDisabled: false }),
      cmd('GetPagedPlayouts', { Query: '', PageNum: 0, PageSize: 500 }),
      S.status?.cg ? api('/api/cg/live/state').then((r) => r.result).catch((e) => e) : null]);
    const channels = allChannels.filter((c) => onChannel(c.Number));
    const byNumber = new Map((playouts?.Page || []).map((p) => [p.ChannelNumber, p]));
    const items = await Promise.all(channels.map(async (c) => {
      const p = byNumber.get(c.Number);
      if (!p) return [];
      try { return (await cmd('GetFuturePlayoutItemsById', { PlayoutId: p.PlayoutId, ShowFiller: true, PageNum: 0, PageSize: 8 }))?.Page || []; }
      catch { return []; }
    }));
    return { channels, byNumber, items, cgState };
  };
  let d = await load();
  const key = (x) => x.channels.map((c) => c.Number).join(',');

  // karty: szkielet (z ramką VizRS) raz, treść podmieniana przy odświeżeniu
  let progressEls = [];
  const slots = d.channels.map((c) => {
    const state = h('span');
    const body = h('div', { class: 'chan-dyn' });
    const frame = multi ? h('iframe', { class: 'preview', title: `Grafika VizRS kanału ${c.Number}`, 'data-vizrs-output': '', src: vizrsUrl('/output', c.Number) }) : null;
    return { c, state, body, el: panel(`${c.Number} · ${c.Name}`, state, h('div', { class: 'chan' }, frame, body)) };
  });
  const eventsBox = h('div');
  const notesBox = h('div');

  const fill = () => {
    const now = Date.now();
    progressEls = [];
    slots.forEach(({ c, state, body }, i) => {
      const p = d.byNumber.get(c.Number);
      const list = d.items[i];
      const cur = list.find((it) => new Date(it.Start) <= now && now < new Date(it.Finish));
      const next = list.filter((it) => new Date(it.Start) > now).slice(0, 3);
      const bar = h('i');
      const left = h('span', { class: 'num' });
      if (cur) progressEls.push({ bar, left, start: +new Date(cur.Start), finish: +new Date(cur.Finish) });
      state.replaceChildren(!p ? pill('brak playoutu', 'warn') : cur ? pill('W RAMÓWCE', 'on') : pill('przerwa w ramówce', 'warn'));
      const stream = S.status.streamUrl ? h('a', { href: `${S.status.streamUrl}/iptv/channel/${encodeURIComponent(c.Number)}.m3u8`, target: '_blank', rel: 'noopener' }, 'Strumień ↗') : null;
      body.replaceChildren(
        cur
          ? h('div', { class: 'np' },
            h('div', { class: 'now' }, h('b', null, cur.Title), h('span', { class: 'dim num' }, `${hm(new Date(cur.Start))}–${hm(new Date(cur.Finish))}`), h('span', { class: 'grow' }), left),
            h('div', { class: 'prog' }, bar))
          : h('div', { class: 'dim' }, p ? 'Teraz nic nie jest zaplanowane – leci wypełniacz zapasowy kanału.' : 'Kanał nie ma playoutu – załóż go w widoku Playouty.'),
        next.length ? h('div', { class: 'dim' }, 'Następnie: ', next.map((n, j) => [j ? ' · ' : '', h('span', { class: 'num' }, hm(new Date(n.Start))), ' ', n.Title])) : null,
        h('div', { class: 'bar' },
          btn('Podgląd ▶', () => openMonitor(c.Number)),
          p ? btn('Przebuduj', () => build(p, 'Refresh')) : null,
          p ? btn('Od nowa', () => build(p, 'Reset'), 'danger') : null,
          stream,
          trioLink(c.Number)));
    });
    const ev = upcoming(d);
    eventsBox.replaceChildren(ev.length
      ? h('div', { class: 'tl' }, ev.map((e) => h('div', { class: 'ev' }, h('span', { class: 'num' }, hm(new Date(e.t))), pill(e.ch),
        h('span', null, e.live ? [pill('LIVE', 'on'), ' '] : null, e.title, e.filler ? h('span', { class: 'dim' }, ' (wypełniacz)') : null))))
      : h('div', { class: 'empty' }, 'Brak zaplanowanych pozycji.'));
    const ns = notes(d);
    notesBox.replaceChildren(ns.length
      ? h('div', { 'data-notes': '' }, ns.map(([kind, who, text, link]) => h('div', { class: 'alert' }, pill(who, kind), h('span', { class: 'w' }, text, link ? [' ', link] : null))))
      : h('div', { class: 'empty', 'data-notes': '' }, 'Bez uwag – wszystkie kanały mają ramówkę.'));
    tick();
  };
  const tick = () => {
    const now = Date.now();
    for (const e of progressEls) {
      e.bar.style.width = Math.min(100, Math.max(0, ((now - e.start) / (e.finish - e.start)) * 100)) + '%';
      e.left.textContent = '−' + dur(e.finish - now);
    }
  };
  const refresh = async () => {
    if (!slots.length && !d.channels.length) return route(true);
    let nd;
    try { nd = await load(); } catch (e) { return toast('Odświeżenie: ' + e.message, 'bad'); }
    if (key(nd) !== key(d)) return route(true);  // inne kanały – nowe karty
    d = nd;
    fill();
  };
  fill();
  S.timers.push(setInterval(tick, 1000), setInterval(refresh, 30000));

  return [
    head('Na antenie', 'Co teraz idzie w ramówce każdego kanału, co następne i na co uważać. Dane z playoutów legacy i VizRS CG Playout, odświeżane co 30 s.',
      btn('Odśwież', () => refresh())),
    h('div', { class: 'split wide' },
      h('div', { class: 'cols' }, slots.length ? slots.map((x) => x.el) : h('div', { class: 'note' }, 'Brak włączonych kanałów. Dodaj kanał w widoku Kanały.')),
      h('div', { class: 'cols' },
        multi ? null : vizrsPreview('Grafika VizRS (/output)', d.channels.map((c) => [String(c.Number), `${c.Number} · ${c.Name}`])),
        panel('Najbliższe zdarzenia', null, eventsBox),
        panel('Uwagi', null, notesBox))),
    panel('Most', null, cmdNote('GetAllChannels', 'GetPagedPlayouts', 'GetFuturePlayoutItemsById', 'BuildPlayout', 'CG Playout GET /api/live/state')),
  ];
};

/** Najbliższe zdarzenia: pozycje ramówki legacy wszystkich kanałów + najbliższe audycje LIVE z CG Playout. */
function upcoming(d) {
  const now = Date.now();
  const out = d.channels.flatMap((c, i) => d.items[i].filter((it) => new Date(it.Start) > now)
    .map((it) => ({ t: +new Date(it.Start), ch: c.Name, title: it.Title, filler: isFiller(it) })));
  const cg = d.cgState instanceof Error ? null : d.cgState;
  for (const ch of (cg?.channels || []).filter((x) => onChannel(x.number))) {
    const nl = ch.next_live;
    if (nl && nl.start > now) out.push({ t: nl.start, ch: ch.name || ch.number, title: nl.title, live: true });
  }
  return out.sort((a, b) => a.t - b.t).slice(0, 12);
}

/** Uwagi dla operatora: [rodzaj pigułki, kto, tekst, odnośnik?] – tylko z danych, które panel ma. */
function notes(d) {
  const now = Date.now();
  const link = (href, text) => h('a', { href }, text);
  const out = [];
  d.channels.forEach((c, i) => {
    const p = d.byNumber.get(c.Number);
    const b = p?.BuildStatus;
    if (!p) out.push(['warn', c.Name, 'kanał nie ma playoutu – nic nie nadaje z ramówki.', link('#playouty', 'Załóż playout')]);
    else if (b && !b.Success) out.push(['bad', c.Name, `legacy nie zbudował playoutu${b.Message ? ': ' + b.Message : '.'}`, link('#playouty', 'Playouty')]);
    else if (!d.items[i].some((it) => new Date(it.Start) <= now && now < new Date(it.Finish))) {
      out.push(['warn', c.Name, 'przerwa w ramówce – leci wypełniacz zapasowy kanału.', link('#playouty', 'Przebuduj w Playoutach')]);
    }
  });
  if (d.cgState instanceof Error) out.push(['bad', 'CG Playout', 'nie odpowiada: ' + d.cgState.message, null]);
  else {
    for (const ch of (d.cgState?.channels || []).filter((x) => onChannel(x.number))) {
      const who = ch.name || `kanał ${ch.number}`;
      const nl = ch.next_live;
      if (ch.hold) out.push(['warn', who, 'studio wstrzymane (ZDEJMIJ) – kanał idzie z ramówki.', link('#live', 'Sloty na żywo')]);
      if (nl && nl.start > now && nl.start - now < 3600e3 && !ch.source?.live) {
        out.push(['info', who, `slot na żywo „${nl.title}” o ${hm(new Date(nl.start))} – studio jeszcze nie nadaje.`, link('#live', 'Sloty na żywo')]);
      }
    }
  }
  return out;
}

VIEWS.epg = async () => {
  const res = await cmd('GetPagedPlayouts', { Query: '', PageNum: 0, PageSize: 100 });
  const rows = (res?.Page || []).filter((p) => onChannel(p.ChannelNumber)).sort((a, b) => (parseFloat(a.ChannelNumber) || 0) - (parseFloat(b.ChannelNumber) || 0));
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
