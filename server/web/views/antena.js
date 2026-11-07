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
  // audycje LIVE zawsze na liście (najwyżej jedna na kanał), resztę miejsc biorą najbliższe pozycje ramówki
  const live = out.filter((e) => e.live);
  return [...out.filter((e) => !e.live).sort((a, b) => a.t - b.t).slice(0, Math.max(0, 12 - live.length)), ...live].sort((a, b) => a.t - b.t);
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

// Okno przewodnika: przesunięcie od „teraz” w krokach po 4 h (legacy podaje tylko przyszłe pozycje – wstecz się nie da).
let epgStep = 0;
const EPG_SPAN = 4 * 3600e3;
const EPG_MIN = 0.015;     // pozycja węższa niż 1,5 % okna (3,6 min) idzie do bloku „pierwsza +N”
const EPG_GROUP = 30 * 60e3; // blok krótkich pozycji najwyżej 30 min

/** Pozycje w oknie [t0, t1) jako bloki do narysowania: długie osobno, krótkie sklejone (z listą w podpowiedzi). */
function epgBlocks(list, t0, t1, liveAt) {
  const out = [];
  let grp = null;
  const flush = () => {
    if (!grp) return;
    const one = grp.items.length === 1;
    out.push({ s: grp.s, e: grp.e, label: one ? grp.items[0].Title : `${grp.items[0].Title} +${grp.items.length - 1}`, grp: !one,
      title: `${hm(new Date(grp.s))}–${hm(new Date(grp.e))}\n` + grp.items.map((it) => `${hm(new Date(it.Start))} ${it.Title}`).join('\n'),
      fill: grp.items.every(isFiller), live: grp.items.some((it) => liveAt(+new Date(it.Start))) });
    grp = null;
  };
  for (const it of list) {
    const s = +new Date(it.Start), e = +new Date(it.Finish);
    if (e <= t0 || s >= t1) continue;
    if (e - s < EPG_MIN * (t1 - t0)) {
      if (grp && (s - grp.e > 60e3 || e - grp.s > EPG_GROUP)) flush();
      if (!grp) grp = { s, e, items: [] };
      grp.items.push(it);
      grp.e = e;
      continue;
    }
    flush();
    out.push({ s, e, label: it.Title, title: `${hm(new Date(s))}–${hm(new Date(e))} ${it.Title}`, fill: isFiller(it), live: liveAt(s) });
  }
  flush();
  return out;
}

VIEWS.epg = async () => {
  const t0d = new Date(); t0d.setMinutes(t0d.getMinutes() < 30 ? 0 : 30, 0, 0);
  const t0 = +t0d + epgStep * EPG_SPAN, t1 = t0 + EPG_SPAN;
  const [allChannels, res, cgState] = await Promise.all([
    cmd('GetAllChannels', { ShowDisabled: false }),
    cmd('GetPagedPlayouts', { Query: '', PageNum: 0, PageSize: 500 }),
    S.status?.cg ? api('/api/cg/live/state').then((r) => r.result).catch(() => null) : null]);
  const channels = allChannels.filter((c) => onChannel(c.Number)).sort((a, b) => (parseFloat(a.Number) || 0) - (parseFloat(b.Number) || 0));
  const byNumber = new Map((res?.Page || []).map((p) => [p.ChannelNumber, p]));
  // dość pozycji, żeby sięgnąć końca okna przy krótkich pozycjach (2 min → 120 na 4 h)
  const pageSize = Math.min(1000, 160 * (epgStep + 1));
  const lists = await Promise.all(channels.map((c) => {
    const p = byNumber.get(c.Number);
    return p ? cmd('GetFuturePlayoutItemsById', { PlayoutId: p.PlayoutId, ShowFiller: true, PageNum: 0, PageSize: pageSize }).then((r) => r?.Page || []).catch(() => []) : null;
  }));
  const x = (t) => ((t - t0) / EPG_SPAN) * 100;
  const ruler = h('div', { class: 'ruler' }, [0, 1, 2, 3].map((k) => { const s = h('span', null, hm(new Date(t0 + k * 3600e3))); s.style.left = k * 25 + '%'; return s; }));
  const nowLine = () => { const l = h('div', { class: 'nowl' }); l.style.left = x(Date.now()) + '%'; return l; };
  const grid = h('div', { class: 'epg' }, h('div', { class: 'ch dim' }, 'kanał'), ruler);
  channels.forEach((c, i) => {
    grid.append(h('div', { class: 'ch' }, h('span', { class: 'num dim' }, c.Number), c.Name));
    const row = h('div', { class: 'row', 'data-epg-channel': String(c.Number) });
    if (!lists[i]) {
      row.append(h('div', { class: 'none' }, 'brak playoutu – ', h('a', { href: '#playouty' }, 'załóż w Playoutach')));
      grid.append(row);
      return;
    }
    // audycje LIVE z ramówki CG Playout (guide) – ta sama godzina startu co pozycja legacy
    const guide = (cgState?.guide?.[String(c.Number)] || []).filter((g) => g.live);
    const liveAt = (s) => guide.some((g) => Math.abs(g.start - s) < 90e3);
    const now = Date.now();
    for (const b of epgBlocks(lists[i], t0, t1, liveAt)) {
      const el = h('div', { class: 'p' + (b.s <= now && now < b.e ? ' now' : '') + (b.fill ? ' fill' : '') + (b.grp ? ' grp' : '') + (b.live ? ' lv' : ''), title: b.title },
        b.live ? '● ' : '', b.label);
      el.style.left = Math.max(0, x(b.s)) + '%';
      el.style.width = `calc(${Math.min(100, x(b.e)) - Math.max(0, x(b.s))}% - 2px)`;
      row.append(el);
    }
    if (now >= t0 && now < t1) row.append(nowLine());
    grid.append(row);
  });
  const go = (d) => { epgStep = d === 0 ? 0 : Math.max(0, epgStep + d); route(true); };
  const back = btn('← 4 h', () => go(-1));
  back.disabled = !epgStep;  // legacy podaje tylko przyszłe pozycje
  const day = new Date(t0).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
  return [
    head('Przewodnik EPG', 'Ramówka wszystkich kanałów na osi czasu, tak jak zobaczy ją widz. Krótkie pozycje są sklejone w bloki – lista w podpowiedzi.',
      h('span', { class: 'bar' },
        back, btn('teraz', () => go(0)), btn('4 h →', () => go(1)),
        S.status.streamUrl ? h('a', { href: S.status.streamUrl + '/iptv/xmltv.xml', target: '_blank', rel: 'noopener' }, 'xmltv.xml ↗') : null)),
    panel(`${day} · ${hm(new Date(t0))}–${hm(new Date(t1))}`, epgStep ? pill(`+${epgStep * 4} h`, 'info') : pill('teraz', 'on'),
      channels.length ? h('div', { class: 'tw' }, grid) : h('div', { class: 'empty' }, 'Brak włączonych kanałów.'),
      cmdNote('GetAllChannels', 'GetPagedPlayouts', 'GetFuturePlayoutItemsById', 'CG Playout GET /api/live/state (audycje LIVE)')),
  ];
};
