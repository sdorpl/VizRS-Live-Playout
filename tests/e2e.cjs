// Test e2e panelu VizRS Live na działającym panelu + legacy z mostem (np. po tests/stack.sh up).
// Użycie: PLAYWRIGHT_DIR=<katalog z node_modules/playwright> node tests/e2e.cjs [http://127.0.0.1:18090]
// Zakłada kanał przez formularz, zmienia go, usuwa; przechodzi przez wszystkie widoki bez błędów JS.

const path = require('path');
const dir = process.env.PLAYWRIGHT_DIR;
if (!dir) {
  console.error('Ustaw PLAYWRIGHT_DIR (katalog z node_modules/playwright).');
  process.exit(2);
}
const { chromium } = require(path.join(dir, 'node_modules', 'playwright'));
const BASE = process.argv[2] || 'http://127.0.0.1:18090';

let failed = 0;
function check(cond, msg) {
  console.log((cond ? 'ok   ' : 'BŁĄD ') + msg);
  if (!cond) failed++;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.request().method()} ${r.url()}`));


  // ---------- R9: atrapa VizRS CG Playout (127.0.0.1:18700, panel uruchomiony z --cg-url przez tests/stack.sh) ----------
  // Stan jak w CG Playout: kanały z sygnałem studia, wstrzymanie, audycje LIVE; sprawdza token panelu CG i brak Origin.
  const CG_TOKEN = 'test-cg-token-0123456789';
  const cgSeen = [];
  const vizrsSeen = [];
  const T0 = Date.now(); // ramówka atrapy stała w czasie, jak EPG prawdziwego CG Playout
  const CG = {
    hold: false, anytime: true, library: null, operators: [],
    graphics: { rules: { on_clip: 'TAKE 4001 headline={title}', on_ad: '', ad_match: { path: '/reklamy/', title: '' }, on_end: '', end_seconds: 60, shows: [], channels: { 24: { on_end: '', shows: [{ show_title: 'x', on_clip: 'TAKE 9' }] } } }, source: 'config', store: true },
    shows: [{ id: '24-poranek-na-zywo', channel: '24', title: 'Poranek na żywo', duration: '01:00:00', plot: '', collection: true, collection_name: 'LIVE · Poranek na żywo', next: null }],
  };
  const cgServer = require('http').createServer((q, r) => {
    let raw = '';
    q.on('data', (d) => (raw += d));
    q.on('end', () => {
      const send = (code, b) => { r.writeHead(code, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(b)); };
      // atrapa VizRS CG System na tym samym porcie (panel: --vizrs-url :18700): /output z tokenem wyjścia jak w VizRS
      const vu = new URL(q.url, 'http://x');
      if (vu.pathname === '/output' || vu.pathname === '/trio') {
        vizrsSeen.push(q.url);
        if (vu.pathname === '/trio' || vu.searchParams.get('token') !== 'e2e-vizrs-output') return send(401, { error: 'wymagany token' });
        r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return r.end(`<!doctype html><title>VizRS output</title><body data-bus="${vu.searchParams.get('bus') || 'program'}">VizRS</body>`);
      }
      if (q.headers['x-operator']) CG.operators.push(Buffer.from(q.headers['x-operator'], 'latin1').toString('utf8')); // jak CG Playout: nagłówek w UTF-8
      cgSeen.push(`${q.method} ${q.url} ${q.headers.authorization === 'Bearer ' + CG_TOKEN ? 'token' : 'BEZ TOKENU'}${q.headers.origin ? ' origin' : ''}`);
      if (q.headers.authorization !== 'Bearer ' + CG_TOKEN) return send(401, { error: 'zły token panelu' });
      const body = raw ? JSON.parse(raw) : {};
      const now = Date.now();
      const u = q.url;
      if (u === '/health') return send(200, { sessions: 1, overlay: ['24'], ingest: { channels: ['24'] }, captures: [{ channel: '24', size: '1280x720', fps: 25, mode: 'frames', drawn_by: 'native', status: 'capturing' }] });
      if (u === '/etv/pages?channel=24') return send(200, { pages: [{ number: 1001, name: 'Belka tytułowa' }, { number: 3001, name: 'Wracamy po reklamie' }] });
      if (u === '/api/live/state') return send(200, {
        ingest: true, now,
        channels: [{ number: '24', name: 'INFO24', source: { live: true, audio: true, video: 'h264', seconds: 75 }, on_air: !CG.hold && CG.anytime, hold: CG.hold, anytime: CG.anytime,
          now: { title: 'Wiadomosci', start: T0 - 60000, stop: T0 + 60000, live: false }, next_live: { title: 'Poranek na żywo', start: T0 + 3600000, stop: T0 + 7200000, live: true },
          inputs: [{ kind: 'rtmp', host: 'tv.example.pl', port: 1936, app: '/live', key: 'studio-klucz', passphrase: '', streamid: '' },
            { kind: 'srt', host: '', port: 9000, app: '', key: '', passphrase: 'tajne haslo', streamid: '' }] }],
        events: [{ at: T0 - 5000, channel: '24', text: 'nadawca połączony' }],
        version: '0.9.0-test', etv: { configured: true, ok: true, error: null }, settings: { library: null, store: true, graphics_off: !!CG.graphicsOff },
        guide: { 24: [{ title: 'Wiadomosci', start: T0 - 60000, stop: T0 + 60000, live: false }, { title: 'Poranek na żywo', start: T0 + 3600000, stop: T0 + 7200000, live: true }] },
      });
      if (u === '/api/live/shows' && q.method === 'GET') return send(200, { shows: CG.shows, error: null, channels: [{ number: '24', name: 'INFO24' }], guide_known: true, max: 50,
        etv: { configured: true, ok: true, error: null }, settings: { library: CG.library, store: true } });
      if (u === '/api/live/settings' && q.method === 'PUT') { CG.library = body.library; return send(200, { library: CG.library, store: true }); }
      if (u === '/api/live/shows' && q.method === 'POST') {
        if (!/[\p{L}\d]/u.test(body.title || '')) return send(400, { error: 'tytuł: 1–200 znaków, choć jedna litera albo cyfra' });
        const show = { id: `${body.channel}-${body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, channel: body.channel, title: body.title, duration: body.duration, plot: body.plot, collection: true, collection_name: 'LIVE · ' + body.title, next: null, file_ok: true, airings: 0 };
        CG.shows.push(show);
        return send(200, { show, steps: [{ step: 'file', ok: true, detail: 'vizrs-live/x.yml' }, { step: 'collection', ok: true, detail: '' }] });
      }
      let m;
      if ((m = u.match(/^\/api\/live\/shows\/([\w.-]+)$/)) && q.method === 'DELETE') { CG.shows = CG.shows.filter((x) => x.id !== m[1]); return send(200, { ok: true }); }
      if ((m = u.match(/^\/api\/live\/channels\/24\/(hold|release)$/))) { CG.hold = m[1] === 'hold'; return send(200, { ok: true }); }
      if (u === '/api/live/channels/24' && q.method === 'PUT') { CG.anytime = body.anytime; return send(200, { ok: true }); }
      if (u === '/api/live/inputs' && q.method === 'GET') {
        return send(200, { listeners: CG.inputs || [{ channel: '24', url: 'rtmp://0.0.0.0:1936/live/studio-klucz' }], from: CG.inputs ? 'panel' : 'env', store: true, ingest: true, ports: { rtmp: [1936, 1943], srt: [9000, 9007] } });
      }
      if (u === '/api/live/inputs' && q.method === 'PUT') { CG.inputs = body.listeners; return send(200, { listeners: CG.inputs, from: 'panel' }); }
      if ((u === '/api/live/graphics/off' || u === '/api/live/graphics/on') && q.method === 'POST') {
        CG.graphicsOff = u.endsWith('/off');
        return send(200, { library: null, store: true, graphics_off: CG.graphicsOff });
      }
      if (u === '/api/live/graphics' && q.method === 'GET') return send(200, CG.graphics);
      if (u === '/api/live/graphics' && q.method === 'PUT') {
        // jak CG Playout: wyrażenie, które się nie kompiluje, = 400 i nic się nie zmienia
        for (const x of body.shows || []) { try { new RegExp(x.show_title); } catch { return send(400, { error: `reguły grafiki: shows show_title "${x.show_title}" is not a valid regular expression` }); } }
        CG.graphics = { rules: body, source: 'file', store: true };
        return send(200, CG.graphics);
      }
      send(404, { error: 'nie ma' });
    });
  });
  await new Promise((ok) => cgServer.listen(18700, '127.0.0.1', ok));

  const views = ['antena', 'epg', 'kanaly', 'profile', 'znaki', 'media', 'zrodla', 'przegladarka', 'kosz', 'kolekcje', 'playlisty', 'wypelniacze',
    'harmonogramy', 'bloki', 'deco', 'playouty', 'grafika', 'live', 'ustawienia', 'logi', 'diagnostyka'];
  for (const v of views) {
    await page.goto(`${BASE}/#${v}`);
    await page.waitForSelector(`main[data-view="${v}"]`);
    const title = await page.textContent('main .head h1');
    check(title && title !== 'Błąd', `widok #${v}: ${title}`);
  }


  // kanał: załóż, zmień, usuń – przez formularz
  const name = 'E2E ' + Date.now().toString(36);
  // czeka na kolejne przerysowanie widoku po akcji
  const rerender = async (action) => {
    const n = await page.getAttribute('main', 'data-render');
    await action();
    await page.waitForFunction((m) => document.querySelector('main').dataset.render !== m && document.querySelector('main').dataset.view, n);
  };
  // M1: liczniki w menu, wybór kanału w pasku górnym (filtr ekranów kanałowych)
  await page.waitForSelector('.side a[href="#kanaly"] .n');
  await page.waitForSelector('.side a[href="#playouty"] .n');
  const nCh = await page.textContent('.side a[href="#kanaly"] .n');
  const chOpts = await page.$$eval('#st-channel option', (os) => os.map((o) => o.value));
  check(+nCh === chOpts.length - 1 && chOpts[0] === '' && chOpts.includes('24'), `menu: licznik kanałów ${nCh} = lista wyboru kanału (${chOpts.join(',')})`);
  check(/^\d+$/.test(await page.textContent('.side a[href="#kolekcje"] .n') || ''), 'menu: licznik kolekcji');
  await page.goto(`${BASE}/#antena`);
  await page.waitForSelector('main[data-view="antena"]');
  const cardTitles = () => page.$$eval('main .panel header h2', (hs) => hs.map((x) => x.textContent).filter((t) => /^\d+ · /.test(t)));
  check((await cardTitles()).length >= 2, 'antena: wszystkie kanały bez wyboru');
  await rerender(() => page.selectOption('#st-channel', '24'));
  const only = await cardTitles();
  check(only.length === 1 && /^24 · /.test(only[0]) && await page.getAttribute('#st-channel', 'class') === 'on', `antena: tylko kanał 24 z paska (${only.join(' / ')})`);
  await page.goto(`${BASE}/#epg`);
  await page.waitForSelector('main[data-view="epg"]');
  await page.reload();
  await page.waitForSelector('main[data-view="epg"]');
  check(await page.inputValue('#st-channel') === '24', 'wybór kanału pamiętany w przeglądarce');
  await page.goto(`${BASE}/#antena`);
  await page.waitForSelector('main[data-view="antena"]');
  await rerender(() => page.selectOption('#st-channel', ''));
  check((await cardTitles()).length >= 2, 'antena: „Wszystkie kanały” przywraca listę');
  // M3: EPG – wszystkie kanały (też bez playoutu), okno po 4 h, krótkie pozycje w blokach
  await page.goto(`${BASE}/#epg`);
  await page.waitForSelector('main[data-view="epg"]');
  check(/brak playoutu/.test(await page.textContent('[data-epg-channel="1"]')) && await page.$('[data-epg-channel="24"] .p.grp') !== null,
    'epg: kanał bez playoutu w wierszu, krótkie pozycje sklejone w bloki');
  check(await page.isDisabled('main .head button:has-text("← 4 h")'), 'epg: wstecz od „teraz” niedostępne');
  const epgTitle = await page.textContent('main .panel header h2');
  await rerender(() => page.click('main .head button:has-text("4 h →")'));
  check(await page.textContent('main .panel header h2') !== epgTitle && await page.isEnabled('main .head button:has-text("← 4 h")'), 'epg: następne 4 h');
  await rerender(() => page.click('main .head button:has-text("teraz")'));

  await page.goto(`${BASE}/#kanaly`);
  await page.waitForSelector('main[data-view="kanaly"]');
  await rerender(() => page.click('text=+ Nowy kanał'));
  await page.fill('#f-Name', name);
  await page.fill('#f-Group', 'Test');
  await page.click('button:has-text("Załóż kanał")');
  await page.waitForSelector(`td:has-text("${name}")`);
  check(true, `kanał „${name}” założony`);

  await rerender(() => page.click(`td:has-text("${name}")`));
  await page.fill('#f-Name', name + ' zm');
  await page.selectOption('#f-IdleBehavior', 'KeepRunning');
  await page.click('button:has-text("Zapisz")');
  await page.waitForSelector(`td:has-text("${name} zm")`);
  const idle = await page.inputValue('#f-IdleBehavior');
  check(idle === 'KeepRunning', `zmiana zapisana w legacy (IdleBehavior=${idle})`);

  await page.click('button:has-text("Usuń")');
  await page.click('#dlg-buttons button:has-text("Usuń")');
  await page.waitForSelector(`td:has-text("${name}")`, { state: 'detached' });
  check(true, 'kanał usunięty');

  // błąd legacy wraca do UI (zdublowany numer)
  await rerender(() => page.click('text=+ Nowy kanał'));
  const firstNumber = await page.evaluate(() => document.querySelector('tbody td.num')?.textContent);
  await page.fill('#f-Number', firstNumber || '1');
  await page.fill('#f-Name', 'Duplikat');
  await page.click('button:has-text("Załóż kanał")');
  await page.waitForSelector('#toast.bad');
  check(/odrzucił/.test(await page.textContent('#toast')), 'walidacja legacy pokazana operatorowi');

  // formularz z metadanych: pole warunkowe (kanał lustrzany tylko dla źródła „Mirror”)
  await page.goto(`${BASE}/#kanaly`);
  await page.waitForSelector('main[data-view="kanaly"]');
  await rerender(() => page.click('text=+ Nowy kanał'));
  const mirrorHidden = !(await page.isVisible('#f-MirrorSourceChannelId'));
  await page.selectOption('#f-PlayoutSource', 'Mirror');
  check(mirrorHidden && (await page.isVisible('#f-MirrorSourceChannelId')), 'formularz: pole „Kanał lustrzany” pokazuje się dla źródła Mirror');
  const opts = await page.$$eval('#f-StreamingMode option', (o) => o.map((x) => x.value));
  check(opts.includes('HttpLiveStreamingSegmenter'), `formularz: wartości wyliczenia z mostu (${opts.length})`);

  // wybór treści (Diagnostyka): wyszukiwanie w legacy i pola treści pozycji
  await page.goto(`${BASE}/#diagnostyka`);
  await page.waitForSelector('main[data-view="diagnostyka"]');
  await page.selectOption('#cp-kind', 'SmartCollection');
  await page.fill('#cp-q', 'INFO');
  await page.click('.picks button:has-text("Archiwum INFO24")');
  await page.waitForSelector('.picked b:has-text("Archiwum INFO24")');
  let out = JSON.parse(await page.textContent('#cp-out'));
  check(out.CollectionType === 'SmartCollection' && out.SmartCollectionId > 0, `wybór treści: kolekcja inteligentna → SmartCollectionId=${out.SmartCollectionId}`);
  await page.selectOption('#cp-kind', 'Collection');
  await page.fill('#cp-q', 'nie-ma-takiej-kolekcji');
  await page.waitForSelector('.picks:has-text("Nic nie znaleziono")');
  check(true, 'wybór treści: brak wyników opisany');
  await page.selectOption('#cp-kind', 'RerunFirstRun');
  await page.waitForSelector('#cp .picks:not(:has-text("Szukam"))');
  check(!(await page.$('.picker .missing')), 'wybór treści: powtórki wyszukiwane w legacy (SearchRerunCollections na białej liście od R4)');
  await page.selectOption('#cp-kind', 'SearchQuery');
  await page.fill('#cp-query', 'type:other_video');
  out = JSON.parse(await page.textContent('#cp-out'));
  check(out.CollectionType === 'SearchQuery' && out.SearchQuery === 'type:other_video', 'wybór treści: zapytanie wyszukiwania');

  // edytor listy pozycji (parts.js; pierwszy ekran z nim to R1) – zamontowany wprost w stronie
  await page.evaluate(async () => {
    const { itemsEditor } = await import('/parts.js');
    const { form } = await import('/form.js');
    const ed = itemsEditor({
      items: [{ Name: 'A', Minutes: 10 }, { Name: 'B', Minutes: 20 }, { Name: 'C', Minutes: 30 }],
      cols: [[(it) => it.Name, 'Nazwa'], [(it) => it.Minutes, 'Min']],
      newItem: () => ({ Name: 'Nowa', Minutes: 5 }),
      edit: (it) => form('', [{ key: 'Name', label: 'Nazwa', required: true }, { key: 'Minutes', label: 'Minuty', kind: 'number', optional: false }], it, { idPrefix: 'it-' }),
    });
    window.__items = ed;
    document.getElementById('main').replaceChildren(ed.el);
  });
  const names = () => page.evaluate(() => window.__items.value().map((x) => x.Name + x.Minutes).join(','));
  await page.click('button[aria-label="Pozycja 1 w dół"]');
  check((await names()) === 'B20,A10,C30', 'edytor pozycji: w dół');
  await page.click('button[aria-label="Pozycja 3 w górę"]');
  check((await names()) === 'B20,C30,A10', 'edytor pozycji: w górę');
  await page.click('.items tbody tr:nth-child(2) td:nth-child(2)');
  await page.fill('#it-Name', 'C2');
  await page.fill('#it-Minutes', '');
  await page.click('.items-side button:has-text("Zastosuj")');
  await page.waitForSelector('#toast.bad');
  check(/Minuty/.test(await page.textContent('#toast')), 'edytor pozycji: walidacja pola w panelu bocznym');
  await page.fill('#it-Minutes', '45');
  await page.click('.items-side button:has-text("Zastosuj")');
  check((await names()) === 'B20,C245,A10' && !(await page.$('.items-side')), 'edytor pozycji: edycja wiersza w panelu bocznym');
  await page.click('button[aria-label="Usuń pozycję 1"]');
  await page.click('.items button:has-text("+ Dodaj pozycję")');
  check((await names()) === 'C245,A10,Nowa5' && (await page.inputValue('#it-Name')) === 'Nowa', 'edytor pozycji: usuń i dodaj (nowa otwarta do edycji)');

  // harmonogram (R1): dwie pozycje, zmiana kolejności, zapis, ponowne otwarcie, walidacja legacy, usunięcie
  const sched = 'E2E harm ' + Date.now().toString(36);
  const itemRows = () => page.$$eval('.items tbody tr', (trs) => trs.map((tr) => [...tr.querySelectorAll('td')].slice(1, 4).map((td) => td.textContent).join(' | ')));
  await page.goto(`${BASE}/#harmonogramy`);
  await page.waitForSelector('main[data-view="harmonogramy"]');
  await rerender(() => page.click('text=+ Nowy harmonogram'));
  await page.fill('#f-Name', sched);
  await page.click('.items button:has-text("+ Dodaj pozycję")');
  await page.selectOption('#si-StartType', 'Fixed');
  await page.fill('#si-StartTime', '6:00');
  await page.selectOption('#si-cp-kind', 'SmartCollection');
  await page.fill('#si-cp-q', 'INFO');
  await page.click('.items-side .picks button:has-text("Archiwum INFO24")');
  await page.selectOption('#si-PlayoutMode', 'Flood');
  check(!(await page.isVisible('#si-MultipleCount')) && (await page.isVisible('#si-FixedStartTimeBehavior')), 'harmonogram: pola warunkowe pozycji (stała godzina, tryb)');
  await page.click('.items-side button:has-text("Zastosuj")');
  await page.click('.items button:has-text("+ Dodaj pozycję")');
  await page.selectOption('#si-cp-kind', 'SearchQuery');
  await page.fill('#si-cp-title', 'Wszystko');
  await page.fill('#si-cp-query', 'type:other_video');
  await page.selectOption('#si-PlayoutMode', 'Multiple');
  await page.fill('#si-MultipleCount', '2');
  await page.click('.items-side button:has-text("Zastosuj")');
  await page.click('button[aria-label="Pozycja 2 w górę"]');
  await rerender(() => page.click('button:has-text("Załóż harmonogram")'));
  await page.waitForSelector(`td:has-text("${sched}")`);
  let rows = await itemRows();
  check(rows.length === 2 && /po poprzedniej \| wyszukiwanie: Wszystko \| kilka \(2\)/.test(rows[0]) && /06:00 stała \| kolekcja inteligentna: Archiwum INFO24 \| wypełnij/.test(rows[1]),
    `harmonogram: założony z pozycjami w nowej kolejności (${rows.join(' / ')})`);
  const daySegs = await page.$$eval('.day-preview .daybar .seg', (xs) => xs.map((x) => x.textContent));
  check(daySegs.length >= 1 && daySegs.every((t) => t === 'Archiwum INFO24 +1'), `harmonogram: podgląd 24 h – stała 06:00 z pozycją „po poprzedniej” (${daySegs.join(' / ')})`);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/r1-harmonogram.png`, fullPage: true });
  await page.click('.items tbody tr:nth-child(2) td:nth-child(3)');
  check((await page.inputValue('#si-StartTime')) === '06:00:00' && (await page.inputValue('#si-PlayoutMode')) === 'Flood'
    && /Archiwum INFO24/.test(await page.textContent('.items-side .picked')), 'harmonogram: ponowne otwarcie – te same wartości pozycji');
  await page.click('.items-side button:has-text("Anuluj")');
  await page.click('.items tbody tr:nth-child(1) td:nth-child(3)');
  check((await page.inputValue('#si-MultipleCount')) === '2', 'harmonogram: liczba trybu „kilka” wraca z legacy (podtyp pozycji)');

  // walidacja legacy: reszta czasu = wypełniacz bez wypełniacza ogona
  await page.selectOption('#si-PlayoutMode', 'Duration');
  await page.fill('#si-PlayoutDuration', '0:30');
  await page.selectOption('#si-TailMode', 'Filler');
  await page.click('main .panel header button:has-text("Zapisz")');
  await page.waitForSelector('#toast.bad');
  const terr = await page.textContent('#toast');
  check(/odrzucił pozycje/.test(terr) && /Tail Filler/.test(terr), `harmonogram: błąd legacy z polskim wstępem (${terr})`);
  await page.goto(`${BASE}/#antena`);
  await page.waitForSelector('main[data-view="antena"]');
  await page.goto(`${BASE}/#harmonogramy`);
  await page.waitForSelector('main[data-view="harmonogramy"]');
  await rerender(() => page.click(`td:has-text("${sched}")`));
  rows = await itemRows();
  check(/kilka \(2\)/.test(rows[0] || ''), 'harmonogram: odrzucone pozycje nie zmieniły harmonogramu');

  await rerender(() => page.click('main .panel header button:has-text("Kopiuj")').then(() => page.click('#dlg-buttons button:has-text("Kopiuj")')));
  await page.waitForSelector(`main .panel header h2:has-text("${sched} (kopia)")`);
  check((await itemRows()).length === 2, 'harmonogram: kopia z pozycjami');
  await page.click('main .panel header button:has-text("Usuń")');
  await page.click('#dlg-buttons button:has-text("Usuń")');
  await page.waitForSelector(`td:has-text("${sched} (kopia)")`, { state: 'detached' });
  await rerender(() => page.click(`td:has-text("${sched}")`));
  await page.click('main .panel header button:has-text("Usuń")');
  await page.click('#dlg-buttons button:has-text("Usuń")');
  await page.waitForSelector(`td:has-text("${sched}")`, { state: 'detached' });
  check(true, 'harmonogram usunięty');

  // playouty (R2): kanał i harmonogram przez API, playout przez panel
  const api = (name, args = {}) => page.evaluate(async ([n, a]) => {
    const r = await fetch('/api/cmd/' + n, { method: 'POST', headers: { 'X-VizRS-Live': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(a) });
    return r.json();
  }, [name, args]);
  const tag = Date.now().toString(36);
  const chans = (await api('GetAllChannels', { ShowDisabled: true })).result;
  const chNum = String(Math.max(...chans.map((c) => parseFloat(c.Number) || 0)) + 1);
  const chName = 'E2E playout ' + tag;
  const chId = (await api('CreateChannel', { Name: chName, Number: chNum, Group: 'Test', Categories: '', FFmpegProfileId: 1, Logo: { Path: '', ContentType: '' },
    StreamingEngine: 'Next', StreamingMode: 'HttpLiveStreamingSegmenter', PlayoutSource: 'Generated', PlayoutMode: 'Continuous', StreamSelectorMode: 'Default',
    IdleBehavior: 'StopOnDisconnect', SubtitleMode: 'None', IsEnabled: true, ShowInEpg: true })).result.ChannelId;
  const psName = 'E2E playout ' + tag;
  const psId = (await api('CreateProgramSchedule', { Name: psName, FixedStartTimeBehavior: 'Strict' })).result.ProgramScheduleId;
  const sc = (await api('SearchSmartCollections', { Query: 'INFO' })).result[0].Id;
  await api('ReplaceProgramScheduleItems', { ProgramScheduleId: psId, Items: [{ Index: 1, StartType: 'Dynamic', PlayoutMode: 'Flood', CollectionType: 'SmartCollection',
    SmartCollectionId: sc, PlaybackOrder: 'Chronological', MultipleCount: '1', SearchTitle: '', SearchQuery: '', CustomTitle: '', WatermarkIds: [], GraphicsElementIds: [] }] });
  check(chId > 0 && psId > 0, `playout: kanał ${chNum} i harmonogram przygotowane przez API`);

  await page.goto(`${BASE}/#playouty`);
  await page.waitForSelector('main[data-view="playouty"]');
  await rerender(() => page.click('text=+ Nowy playout'));
  const freeCh = await page.$$eval('#f-ChannelId option', (o) => o.map((x) => x.textContent));
  check(freeCh.includes(`${chNum} · ${chName}`) && !freeCh.some((t) => t.startsWith('24 ·')), 'playout: wybór tylko kanałów bez playoutu');
  await page.selectOption('#f-Kind', 'Sequential');
  const seqHint = await page.textContent('#f-ScheduleFile ~ .hint');
  check((await page.isVisible('#f-ScheduleFile')) && !(await page.isVisible('#f-ProgramScheduleId')) && /kontenerze legacy/.test(seqHint),
    'playout: sekwencyjny – ścieżka pliku z podpowiedzią, bez harmonogramu');
  await page.selectOption('#f-ChannelId', String(chId));
  await page.fill('#f-ScheduleFile', '/config/nie-ma/e2e.yml');
  await page.click('button:has-text("Załóż playout")');
  await page.waitForSelector('#toast.bad');
  check(/Sequential schedule does not exist/.test(await page.textContent('#toast')), 'playout: brak pliku YAML – błąd legacy pokazany');
  await page.selectOption('#f-Kind', 'Classic');
  await page.selectOption('#f-ProgramScheduleId', String(psId));
  await rerender(() => page.click('button:has-text("Załóż playout")'));
  await page.waitForSelector(`main .panel header h2:has-text("Playout ${chNum} · ${chName}")`);
  check(true, `playout klasyczny założony dla kanału ${chNum}`);

  await page.click('.maint button:has-text("Przebuduj")');
  await page.waitForSelector('#toast.ok');
  check(true, 'playout: przebudowa zlecona');
  let onAir = false;
  for (let i = 0; i < 30 && !onAir; i++) {
    await page.goto(`${BASE}/#antena`);
    await page.waitForSelector('main[data-view="antena"]');
    onAir = !!(await page.$(`.panel:has(h2:text-is("${chNum} · ${chName}")) .now`));
    if (!onAir) await page.waitForTimeout(2000);
  }
  check(onAir, 'playout: pozycje kanału widoczne w „Na antenie”');
  // Trio i podgląd VizRS na antenie kanału (panel z --vizrs-channels)
  check(await page.getAttribute(`.panel:has(h2:text-is("${chNum} · ${chName}")) a[data-trio]`, 'href') === `http://127.0.0.1:18700/trio?channel=${chNum}`,
    'antena: „Trio ↗” otwiera antenę kanału');
  // M2: przy antenach kanałów ramka VizRS w karcie kanału, „Odśwież” podmienia dane bez przebudowy kart
  const cardFrame = `.panel:has(h2:text-is("${chNum} · ${chName}")) iframe[data-vizrs-output]`;
  check(await page.getAttribute(cardFrame, 'src') === `http://127.0.0.1:18700/output?token=e2e-vizrs-output&bus=ch-${chNum}`,
    'antena: ramka VizRS w karcie kanału na jego antenie');
  check(!(await page.$('select[data-vizrs-channel]')), 'antena: przy antenach kanałów bez wspólnej ramki');
  await page.$eval(cardFrame, (f) => { f.dataset.mark = '1'; });
  await page.click('main .head button:has-text("Odśwież")');
  await page.waitForTimeout(1500);
  check(await page.$eval(cardFrame, (f) => f.dataset.mark) === '1', 'antena: odświeżenie nie przeładowuje ramki VizRS');
  check(/nie ma playoutu/.test(await page.textContent('[data-notes]')), 'antena: uwaga – kanał bez playoutu');
  check(/Poranek na żywo/.test(await page.textContent('main .panel:has(h2:text-is("Najbliższe zdarzenia"))')), 'antena: audycja LIVE z CG w najbliższych zdarzeniach');
  check(/LIVE \d\d:\d\d · Poranek na żywo/.test(await page.textContent('.panel:has(h2:text-is("24 · INFO24")) [data-cg-state]') || ''),
    'antena: stan studia z CG na karcie kanału (najbliższy slot LIVE)');
  check(/\d+\/\d+ kanał(ów)? w ramówce/.test(await page.textContent('main .head')), 'antena: licznik kanałów w ramówce w nagłówku');
  check(/^\d\d:\d\d:\d\d$/.test(await page.textContent('main .panel:has(h2:text-is("Najbliższe zdarzenia")) .ev .num')), 'antena: zdarzenia z sekundami');

  // harmonogram zastępczy na sobotę + codzienna przebudowa
  await page.goto(`${BASE}/#playouty`);
  await page.waitForSelector('main[data-view="playouty"]');
  await rerender(() => page.click(`td:text-is("${chName}")`));
  await page.click('.items button:has-text("+ Dodaj harmonogram zastępczy")');
  await page.selectOption('#alt-ProgramScheduleId', { label: 'INFO24 dzień' });
  await page.click('#alt-DaysOfWeek button:has-text("żaden")');
  await page.click('.items-side button:has-text("Zastosuj")');
  await page.waitForSelector('#toast.bad');
  check(/Dni tygodnia/.test(await page.textContent('#toast')), 'harmonogram zastępczy: bez dni – walidacja w panelu');
  await page.check('#alt-DaysOfWeek label:has-text("sob") input');
  await page.click('.items-side button:has-text("Zastosuj")');
  await page.fill('#f-DailyRebuildTime', '5:00');
  await rerender(() => page.click('main .panel header button:has-text("Zapisz")'));
  await page.waitForSelector(`main .panel header h2:has-text("Playout ${chNum} · ${chName}")`);
  const altRows = await page.$$eval('.items tbody tr', (trs) => trs.map((tr) => tr.textContent));
  const pid = (await api('GetPlayoutIdByChannelNumber', { ChannelNumber: chNum })).result;
  const alts = (await api('GetPlayoutAlternateSchedules', { PlayoutId: pid })).result.sort((a, b) => a.Index - b.Index);
  check(altRows.length === 1 && /INFO24 dzień/.test(altRows[0]) && /sob/.test(altRows[0])
    && alts.length === 2 && alts[0].DaysOfWeek.join() === 'Saturday' && alts[1].ProgramScheduleId === psId,
  `harmonogram zastępczy: sobota zapisana w legacy, harmonogram główny bez zmian (${altRows.join(' / ')})`);
  check((await page.textContent(`tr:has(td:text-is("${chName}"))`)).includes('05:00') && (await page.inputValue('#f-DailyRebuildTime')) === '05:00:00',
    'playout: codzienna przebudowa 05:00 zapisana');

  await page.click('.maint button:has-text("Wyczyść pozycje i historię")');
  await page.click('#dlg-buttons button:has-text("Wyczyść pozycje i historię")');
  await page.waitForSelector('#toast.ok:has-text("wyczyszczono pozycje i historię")');
  check(true, 'playout: wyczyszczenie pozycji i historii');

  await page.click('main .head button:has-text("Resetuj wszystkie")');
  await page.click('#dlg-buttons button:has-text("Resetuj wszystkie")');
  await page.waitForSelector('#toast.ok:has-text("wszystkich playoutów")');
  check(true, 'playouty: „Resetuj wszystkie” zlecone');
  await page.waitForTimeout(2600);

  await page.click('main .panel header button:has-text("Usuń")');
  await page.click('#dlg-buttons button:has-text("Usuń")');
  await page.waitForSelector(`td:text-is("${chName}")`, { state: 'detached' });
  const left = (await api('GetPagedPlayouts', { Query: '', PageNum: 0, PageSize: 500 })).result.Page.filter((p) => p.ChannelNumber === chNum);
  check(left.length === 0, 'playout usunięty');
  await api('DeleteChannel', { ChannelId: chId });
  await api('DeleteProgramSchedule', { ProgramScheduleId: psId });
  check(await page.isHidden('#st-warn'), 'pasek górny: brak playoutów z błędem (licznik ukryty)');

  // media (R3): biblioteka z seed, wyszukiwarka, karta pozycji, nowa biblioteka ze ścieżką
  await page.goto(`${BASE}/#media`);
  await page.waitForSelector('main[data-view="media"]');
  const libRow = page.locator('tbody tr', { hasText: 'Archiwum INFO24' }).first();
  check((await libRow.locator('td.num').textContent()).trim() === '3', 'biblioteka „Archiwum INFO24”: 3 pozycje');
  await rerender(() => libRow.click());
  check(await page.inputValue('#lib-paths input') === '/config/media/info24', 'biblioteka: ścieżka w kontenerze legacy');
  const libName = 'E2E bib ' + Date.now().toString(36);
  await rerender(() => page.click('text=+ Nowa biblioteka'));
  await page.fill('#lib-Name', libName);
  await page.click('button:has-text("Załóż bibliotekę")');
  await page.waitForSelector('#toast.bad');
  check(/ścieżk/.test(await page.textContent('#toast')), 'biblioteka bez ścieżki: komunikat');
  await page.click('text=+ Dodaj ścieżkę');
  await page.fill('#lib-paths input', '/config/media/e2e');
  await page.click('button:has-text("Załóż bibliotekę")');
  await page.waitForSelector(`td:text-is("${libName}")`);
  await rerender(() => page.click(`td:text-is("${libName}")`));
  check(await page.inputValue('#lib-paths input') === '/config/media/e2e', 'nowa biblioteka zapisana ze ścieżką');
  await page.click('main button:has-text("Usuń")');
  await page.click('#dlg-buttons button:has-text("Usuń")');
  await page.waitForSelector(`td:text-is("${libName}")`, { state: 'detached' });
  check(true, 'biblioteka usunięta');

  await page.goto(`${BASE}/#przegladarka`);
  await page.waitForSelector('main[data-view="przegladarka"]');
  await page.fill('#media-q', 'Pogoda');
  await rerender(() => page.press('#media-q', 'Enter'));
  const hits = await page.locator('main tbody tr').count();
  check(hits === 1 && /Pogoda/.test(await page.textContent('main tbody tr')), `wyszukiwanie „Pogoda”: ${hits} pozycja`);
  await page.click('main tbody tr');
  await page.waitForSelector('#item-card');
  check(/H\.264/.test(await page.textContent('#item-card')), 'karta pozycji: strumień H.264');
  await page.click('#dlg-buttons button:has-text("Zamknij")');
  // M4: kafle (pamiętane), karta z kafla, „Zapisz jako kolekcję inteligentną” z zapytania
  await rerender(() => page.click('main .panel header button:has-text("Kafle")'));
  check(await page.locator('[data-media-tiles] .mc').count() === 1 && /Pogoda/.test(await page.textContent('[data-media-tiles]')), 'przeglądarka: kafle z wynikiem wyszukiwania');
  await page.click('[data-media-tiles] .mc');
  await page.waitForSelector('#item-card');
  await page.click('#dlg-buttons button:has-text("Zamknij")');
  const smartName = 'E2E inteligentna ' + Date.now().toString(36);
  await page.click('button:has-text("Zapisz jako kolekcję inteligentną")');
  await page.fill('#smart-name', smartName);
  await page.click('#dlg-buttons button:has-text("Zapisz")');
  await page.waitForSelector('main[data-view="kolekcje"]');
  const smartOk = await page.evaluate(async (n) => {
    const call = (c, b) => fetch('/api/cmd/' + c, { method: 'POST', headers: { 'X-VizRS-Live': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json());
    const s = ((await call('GetAllSmartCollections')).result || []).find((x) => x.Name === n);
    if (s) await call('DeleteSmartCollection', { SmartCollectionId: s.Id });
    return s?.Query;
  }, smartName);
  check(smartOk === 'Pogoda', `przeglądarka: zapytanie zapisane jako kolekcja inteligentna (${smartOk}), potem usunięta`);
  await page.goto(`${BASE}/#przegladarka`);
  await page.waitForSelector('[data-media-tiles]');
  await rerender(() => page.click('main .panel header button:has-text("Tabela")'));
  await page.fill('#media-q', 'Pogoda');
  await rerender(() => page.press('#media-q', 'Enter'));
  // M0: okno zamyka się przy zmianie ekranu (wcześniej zostawało nad kolejnymi ekranami)
  await page.click('main tbody tr');
  await page.waitForSelector('#item-card');
  await page.goto(`${BASE}/#kosz`);
  await page.waitForSelector('main[data-view="kosz"]');
  check(await page.isHidden('#overlay'), 'okno karty pozycji zamknięte po przejściu na inny ekran');

  await page.goto(`${BASE}/#kosz`);
  await page.waitForSelector('main[data-view="kosz"]');
  check(/Kosz jest pusty/.test(await page.textContent('main')), 'kosz pusty');

  // R5: profile kodowania – nowy 720p z loudnorm, kopia, usunięcie
  const profName = 'E2E 720p ' + tag;
  await page.goto(`${BASE}/#profile`);
  await page.waitForSelector('main[data-view="profile"]');
  await rerender(() => page.click('text=+ Nowy profil'));
  await page.fill('#f-Name', profName);
  await page.selectOption('#f-ResolutionId', { label: '1280x720' });
  await page.selectOption('#f-NormalizeLoudnessMode', 'LoudNorm');
  check(/−23 LUFS/.test(await page.textContent('main .form')), 'profil: podpowiedź −23 LUFS');
  await page.fill('#f-TargetLoudness', '-23');
  await page.click('button:has-text("Załóż profil")');
  await page.waitForSelector(`td:text-is("${profName}")`);
  const prof = (await api('GetAllFFmpegProfiles')).result.find((x) => x.Name === profName);
  check(prof && prof.Resolution.Name === '1280x720' && prof.NormalizeLoudnessMode === 'LoudNorm' && prof.TargetLoudness === -23, 'profil 720p zapisany (rozdzielczość, −23 LUFS)');
  await rerender(() => page.click(`td:text-is("${profName}")`));
  await page.click('main .panel header button:has-text("Kopiuj")');
  await page.click('#dlg-buttons button:has-text("Kopiuj")');
  await page.waitForSelector(`td:text-is("${profName} (kopia)")`);
  check(true, 'profil skopiowany');
  for (const n of [profName + ' (kopia)', profName]) {
    await rerender(() => page.click(`td:text-is("${n}")`));
    await page.click('main .panel header button:has-text("Usuń")');
    await page.click('#dlg-buttons button:has-text("Usuń")');
    await page.waitForSelector(`td:text-is("${n}")`, { state: 'detached' });
  }
  check(true, 'profil i kopia usunięte');

  // R5: znak wodny z wgranym PNG, przypisany do kanału; logo kanału wgrane
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAAXElEQVR4nO3QMREAIBDAsJeCdCTiAGRkoEP2XufsdX82OkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAO0BIgN5PBkUl+sAAAAASUVORK5CYII=', 'base64');
  const wmName = 'E2E znak ' + tag;
  await page.goto(`${BASE}/#znaki`);
  await page.waitForSelector('main[data-view="znaki"]');
  await rerender(() => page.click('text=+ Nowy znak'));
  await page.fill('#f-Name', wmName);
  // formularz może się jeszcze przerysować po „+ Nowy znak” – wgrywanie ponawiane, aż legacy potwierdzi
  for (let i = 0; i < 5 && !(await page.isVisible('#toast.ok:has-text("Obraz wgrany")')); i++) {
    if (!(await page.inputValue('#f-Name').catch(() => ''))) await page.fill('#f-Name', wmName);
    await page.setInputFiles('#f-image', { name: 'logo.png', mimeType: 'image/png', buffer: PNG }, { timeout: 5000 }).catch(() => {});
    await page.waitForSelector('#toast.ok:has-text("Obraz wgrany")', { timeout: 5000 }).catch(() => {});
  }
  await page.waitForSelector('#toast.ok:has-text("Obraz wgrany")');
  await page.click('button[aria-label="Położenie: lewy górny"]');
  await page.fill('#f-Width', '20');
  const mark = await page.evaluate(() => { const m = document.querySelector('.wm-mark'); return { left: m.style.left, top: m.style.top, w: m.style.width, img: m.querySelector('img').src.slice(0, 15) }; });
  check(mark.left === '5%' && mark.top === '5%' && mark.w === '20%' && mark.img === 'data:image/png;', `podgląd znaku na makiecie (${JSON.stringify(mark)})`);
  await page.click('button:has-text("Załóż znak")');
  await page.waitForSelector(`td:text-is("${wmName}")`);
  const wm = (await api('GetAllWatermarks')).result.find((x) => x.Name === wmName);
  check(wm && /^[0-9A-F]{32}$/.test(wm.Image.Path) && wm.Image.ContentType === 'image/png' && wm.Location === 'TopLeft' && wm.Width === 20, 'znak wodny zapisany z wgranym PNG');

  const wmCh = String(Math.max(...(await api('GetAllChannels', { ShowDisabled: true })).result.map((c) => parseFloat(c.Number) || 0)) + 1);
  const wmChName = 'E2E znak kanał ' + tag;
  const profiles = (await api('GetAllFFmpegProfiles')).result;
  await api('CreateChannel', { Name: wmChName, Number: wmCh, Group: 'Test', FFmpegProfileId: profiles[0].Id, Logo: { Path: '', ContentType: '' }, StreamingEngine: 'Next', StreamingMode: 'HttpLiveStreamingSegmenter', PlayoutSource: 'Generated', PlayoutMode: 'Continuous', IsEnabled: true, ShowInEpg: true });
  await page.goto(`${BASE}/#kanaly`);
  await page.waitForSelector('main[data-view="kanaly"]');
  await rerender(() => page.click(`td:text-is("${wmChName}")`));
  await page.selectOption('#f-WatermarkId', { label: wmName });
  await page.setInputFiles('#f-LogoFile', { name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForSelector('#toast.ok:has-text("Obraz wgrany")');
  await page.click('main .panel header button:has-text("Zapisz")');
  await page.waitForSelector('#toast.ok:has-text("zapisano")');
  const wmChan = (await api('GetAllChannels', { ShowDisabled: true })).result.find((c) => c.Name === wmChName);
  check(wmChan?.WatermarkId === wm.Id, 'znak wodny przypisany do kanału');
  check(/^iptv\/logos\/[0-9A-F]{32}$/.test(wmChan?.Logo?.Path || '') && wmChan.Logo.ContentType === 'image/png', `logo kanału wgrane (${wmChan?.Logo?.Path})`);
  await api('DeleteChannel', { ChannelId: wmChan.Id });
  await page.goto(`${BASE}/#znaki`);
  await page.waitForSelector('main[data-view="znaki"]');
  await rerender(() => page.click(`td:text-is("${wmName}")`));
  check(await page.isVisible('img.thumb.sm'), 'lista znaków: miniatura z legacy');
  await page.click('main .panel header button:has-text("Usuń")');
  await page.click('#dlg-buttons button:has-text("Usuń")');
  await page.waitForSelector(`td:text-is("${wmName}")`, { state: 'detached' });
  check(true, 'znak wodny usunięty');

  // R5: wgrywanie – zły typ i za duży plik odrzucone (poza przeglądarką, żeby 4xx nie liczyły się jako błąd strony)
  const up = (kind, type, body) => fetch(`${BASE}/api/upload/${kind}`, { method: 'POST', headers: { 'X-VizRS-Live': '1', 'Content-Type': type }, body }).then((r) => r.status);
  check(await up('Watermark', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>') === 415, 'wgrywanie: SVG odrzucony (415)');
  check(await up('Watermark', 'image/png', 'GIF89a nie png') === 415, 'wgrywanie: treść niezgodna z typem (415)');
  check(await up('Watermark', 'image/png', Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)])).catch(() => 413) === 413, 'wgrywanie: plik > 10 MB odrzucony (413)');
  check(await up('Poster', 'image/png', PNG) === 400, 'wgrywanie: zły rodzaj obrazu (400)');

  // R5: wypełniacz „dopełnij do 30 min”
  const fpName = 'E2E dopełnienie ' + tag;
  await page.goto(`${BASE}/#wypelniacze`);
  await page.waitForSelector('main[data-view="wypelniacze"]');
  await rerender(() => page.click('text=+ Nowy wypełniacz'));
  await page.fill('#f-Name', fpName);
  await page.selectOption('#f-FillerKind', 'PostRoll');
  await page.selectOption('#f-FillerMode', 'Pad');
  await page.selectOption('#f-PadToNearestMinute', '30');
  await page.click('#fp-cp .picks button:has-text("Archiwum INFO24")');
  await page.click('button:has-text("Załóż wypełniacz")');
  await page.waitForSelector(`td:text-is("${fpName}")`);
  const fp = (await api('GetAllFillerPresets')).result.find((x) => x.Name === fpName);
  check(fp && fp.FillerKind === 'PostRoll' && fp.FillerMode === 'Pad' && fp.PadToNearestMinute === 30 && fp.CollectionType === 'SmartCollection' && fp.SmartCollectionId > 0 && fp.Count == null, 'wypełniacz „dopełnij do 30 min” zapisany');
  await rerender(() => page.click(`td:text-is("${fpName}")`));
  check(await page.isDisabled('#f-FillerKind') && /Archiwum INFO24/.test(await page.textContent('#fp-cp .picked')), 'wypełniacz: miejsce zablokowane, treść z nazwą');
  await page.click('main .panel header button:has-text("Usuń")');
  await page.click('#dlg-buttons button:has-text("Usuń")');
  await page.waitForSelector(`td:text-is("${fpName}")`, { state: 'detached' });
  check(true, 'wypełniacz usunięty');

  // R4: kolekcja zwykła z 2 pozycjami dodanymi w przeglądarce
  const colName = 'E2E kolekcja ' + tag;
  await page.goto(`${BASE}/#kolekcje`);
  await page.waitForSelector('main[data-view="kolekcje"]');
  // M5: „Wszystkie” – jedna lista rodzajów, „+ Nowa kolekcja” przełącza na zwykłe
  check(/Wszystkie kolekcje/.test(await page.textContent('main')) && await page.isVisible('.page-tabs button.on:has-text("Wszystkie")'), 'kolekcje: domyślnie przegląd wszystkich rodzajów');
  await rerender(() => page.click('text=+ Nowa kolekcja'));
  await page.fill('#col-Name', colName);
  await page.click('button:has-text("Załóż kolekcję")');
  await page.waitForSelector(`td:text-is("${colName}")`);
  await page.goto(`${BASE}/#przegladarka`);
  await page.waitForSelector('main[data-view="przegladarka"]');
  await page.fill('#media-q', '');
  await rerender(() => page.press('#media-q', 'Enter'));
  await page.check('input[aria-label="Zaznacz Pogoda"]');
  await page.check('input[aria-label="Zaznacz Reportaz"]');
  check((await page.textContent('#media-sel')) === 'zaznaczono 2 poz.', 'przeglądarka: zaznaczono 2 pozycje (bez otwierania karty)');
  await page.click('button:has-text("Dodaj zaznaczone do…")');
  await page.selectOption('#add-target', { label: 'Kolekcja: ' + colName });
  await rerender(() => page.click('#dlg-buttons button:has-text("Dodaj")'));
  await page.goto(`${BASE}/#kolekcje`);
  await page.waitForSelector('main[data-view="kolekcje"]');
  await rerender(() => page.click(`td:text-is("${colName}")`));
  const colRows = await page.$$eval('#col-items tbody tr', (trs) => trs.map((t) => t.textContent));
  check(colRows.length === 2 && colRows.some((t) => /Pogoda/.test(t)) && colRows.some((t) => /Reportaz/.test(t)), `kolekcja zwykła: 2 pozycje z przeglądarki (${colRows.length})`);
  await page.check('#col-items input[aria-label="Zaznacz Reportaz"]');
  await page.click('button:has-text("Usuń zaznaczone z kolekcji")');
  await rerender(() => page.click('#dlg-buttons button:has-text("Usuń")'));
  check((await page.$$('#col-items tbody tr')).length === 1, 'kolekcja zwykła: pozycja usunięta z kolekcji');
  const colId = (await api('GetAllCollections')).result.find((c) => c.Name === colName)?.Id;

  // R4: kolekcja inteligentna z zapytaniem i liczbą wyników
  const scName = 'E2E inteligentna ' + tag;
  await rerender(() => page.click('.page-tabs button:has-text("Inteligentne")'));
  await rerender(() => page.click('text=+ Nowa inteligentna'));
  await page.fill('#sc-Name', scName);
  await page.fill('#sc-Query', 'title:Pogoda OR title:Wiadomosci');
  await page.click('button:has-text("Sprawdź zapytanie")');
  await page.waitForFunction(() => /pasuje/.test(document.querySelector('#sc-count').textContent));
  check(/^2 poz\./.test(await page.textContent('#sc-count')), `inteligentna: podgląd liczby wyników (${await page.textContent('#sc-count')})`);
  await page.click('button:has-text("Załóż kolekcję")');
  await page.waitForSelector(`td:text-is("${scName}")`);
  const scRow = await page.textContent(`tr:has(td:text-is("${scName}"))`);
  check(/title:Pogoda OR title:Wiadomosci/.test(scRow) && /2$/.test(scRow.trim()), 'inteligentna zapisana z zapytaniem i liczbą 2');
  const scId = (await api('GetAllSmartCollections')).result.find((c) => c.Name === scName)?.Id;

  // R4: wielokolekcja z dwoma składnikami
  const mcName = 'E2E wielokolekcja ' + tag;
  await rerender(() => page.click('.page-tabs button:has-text("Wielokolekcje")'));
  await rerender(() => page.click('text=+ Nowa wielokolekcja'));
  await page.fill('#mc-Name', mcName);
  await page.click('text=+ Dodaj składnik');
  await page.fill('#mc-cp-q', colName);
  await page.click(`#mc-cp .picks button:has-text("${colName}")`);
  await page.click('.items-side button:has-text("Zastosuj")');
  await page.click('text=+ Dodaj składnik');
  await page.selectOption('#mc-cp-kind', 'SmartCollection');
  await page.fill('#mc-cp-q', scName);
  await page.click(`#mc-cp .picks button:has-text("${scName}")`);
  await page.check('#mc-group');
  await page.click('.items-side button:has-text("Zastosuj")');
  await page.click('button:has-text("Załóż wielokolekcję")');
  await page.waitForSelector(`td:text-is("${mcName}")`);
  const mcId = (await api('GetAllMultiCollections')).result.find((m) => m.Name === mcName)?.Id;
  const mc = mcId && (await api('GetMultiCollectionById', { Id: mcId })).result;
  check(mc && mc.Items.length === 1 && mc.Items[0].Collection.Id === colId && mc.SmartItems.length === 1 && mc.SmartItems[0].SmartCollection.Id === scId && mc.SmartItems[0].ScheduleAsGroup,
    'wielokolekcja: kolekcja zwykła + inteligentna jako grupa');

  // R4: powtórki z kolekcji inteligentnej
  const rcName = 'E2E powtórki ' + tag;
  await rerender(() => page.click('.page-tabs button:has-text("Powtórki")'));
  await rerender(() => page.click('text=+ Nowe powtórki'));
  await page.fill('#rc-Name', rcName);
  await page.selectOption('#rc-cp-kind', 'SmartCollection');
  await page.click(`#rc-cp .picks button:has-text("${scName}")`);
  await page.selectOption('#rc-RerunPlaybackOrder', 'Random');
  await page.click('button:has-text("Załóż powtórki")');
  await page.waitForSelector(`td:text-is("${rcName}")`);
  const rc = (await api('GetPagedRerunCollections', { Query: '', PageNum: 0, PageSize: 100 })).result.Page.find((r) => r.Name === rcName);
  const rcFull = rc && (await api('GetRerunCollectionById', { Id: rc.Id })).result;
  check(rcFull && rcFull.CollectionType === 'SmartCollection' && rcFull.SmartCollection?.Id === scId && rcFull.RerunPlaybackOrder === 'Random', 'powtórki zapisane (inteligentna, powtórki losowo)');
  await rerender(() => page.click(`td:text-is("${rcName}")`));
  check(/Wybrano: E2E inteligentna/.test(await page.textContent('#rc-cp .picked')), 'powtórki: po ponownym otwarciu treść z nazwą');

  // R4: playlista z 3 pozycjami i podglądem
  const plgName = 'E2E grupa ' + tag, plName = 'E2E playlista ' + tag;
  await page.goto(`${BASE}/#playlisty`);
  await page.waitForSelector('main[data-view="playlisty"]');
  await page.click('button:has-text("+ Grupa")');
  await page.fill('#plg-name', plgName);
  await rerender(() => page.click('#dlg-buttons button:has-text("Załóż")'));
  await rerender(() => page.click('text=+ Nowa playlista'));
  await page.selectOption('#pls-PlaylistGroupId', { label: plgName });
  await page.fill('#pls-Name', plName);
  await page.click('button:has-text("Załóż playlistę")');
  await page.waitForSelector(`td:text-is("${plName}")`);
  await rerender(() => page.click(`td:text-is("${plName}")`));
  // pozycja 1: kolekcja zwykła, wszystkie; pozycje 2–3: pliki z przeglądarki
  await page.click('text=+ Dodaj pozycję');
  await page.fill('#pl-cp-q', colName);
  await page.click(`#pl-cp .picks button:has-text("${colName}")`);
  await page.check('#pl-PlayAll');
  await page.click('.items-side button:has-text("Zastosuj")');
  await rerender(() => page.click('main .panel header button:has-text("Zapisz")'));
  await page.goto(`${BASE}/#przegladarka`);
  await page.waitForSelector('main[data-view="przegladarka"]');
  await page.fill('#media-q', '');
  await rerender(() => page.press('#media-q', 'Enter'));
  await page.check('input[aria-label="Zaznacz Wiadomosci"]');
  await page.check('input[aria-label="Zaznacz Reportaz"]');
  await page.click('button:has-text("Dodaj zaznaczone do…")');
  await page.selectOption('#add-target', { label: `Playlista: ${plgName} / ${plName}` });
  await rerender(() => page.click('#dlg-buttons button:has-text("Dodaj")'));
  await page.goto(`${BASE}/#playlisty`);
  await page.waitForSelector('main[data-view="playlisty"]');
  await rerender(() => page.click(`td:text-is("${plName}")`));
  const plRows = await page.$$eval('.items tbody tr', (trs) => trs.map((t) => t.textContent));
  check(plRows.length === 3 && /kolekcja.*wszystkie/.test(plRows[0]), `playlista: 3 pozycje (${plRows.length})`);
  await page.click('button:has-text("Zapisz i pokaż podgląd")');
  await page.waitForSelector('#pl-preview table');
  const prev = await page.$$eval('#pl-preview tbody tr', (trs) => trs.map((t) => t.textContent));
  check(prev.length >= 3 && /Pogoda/.test(prev[0]) && /00:00:00/.test(prev[0]), `playlista: podgląd playoutu (${prev.length} poz.)`);
  // kolejność: ostatnia pozycja na górę, zapis, ponowne otwarcie
  await page.click('button[aria-label="Pozycja 3 w górę"]');
  await page.click('button[aria-label="Pozycja 2 w górę"]');
  await rerender(() => page.click('main .panel header button:has-text("Zapisz")'));
  const plId = (await api('GetPlaylistsByPlaylistGroupId', { PlaylistGroupId: (await api('GetAllPlaylistGroups')).result.find((g) => g.Name === plgName).Id })).result[0].Id;
  const items = (await api('GetPlaylistItems', { PlaylistId: plId })).result.sort((a, b) => a.Index - b.Index);
  check(items.length === 3 && items[0].CollectionType === 'OtherVideo' && items[1].CollectionType === 'Collection' && items[1].PlayAll, 'playlista: zmiana kolejności zapisana');

  // sprzątanie R4 (przez UI: playlista, grupa; reszta przez UI kolekcji)
  await page.click('main .panel header button:has-text("Usuń")');
  await rerender(() => page.click('#dlg-buttons button:has-text("Usuń")'));
  await page.click('button:has-text("Usuń grupę…")');
  await page.selectOption('#plg-del', { label: `${plgName} (0 playlist)` });
  await rerender(() => page.click('#dlg-buttons button:has-text("Usuń")'));
  check(!(await api('GetAllPlaylistGroups')).result.some((g) => g.Name === plgName), 'playlista i grupa usunięte');
  await page.goto(`${BASE}/#kolekcje`);
  await page.waitForSelector('main[data-view="kolekcje"]');
  await rerender(() => page.click('.page-tabs button:has-text("Wszystkie")'));
  const allRows = await page.$$eval('main tbody tr', (trs) => trs.map((t) => t.textContent));
  check([[colName, 'zwykła'], [scName, 'inteligentna'], [mcName, 'wielokolekcja'], [rcName, 'powtórki']].every(([n, k]) => allRows.some((t) => t.includes(n) && t.includes(k))),
    'kolekcje: przegląd – cztery rodzaje w jednej liście z pigułką rodzaju');
  await rerender(() => page.click(`td:text-is("${scName}")`));
  check(await page.isVisible('.page-tabs button.on:has-text("Inteligentne")') && /E2E/.test(await page.textContent('main .split .panel:nth-child(2) header h2')),
    'kolekcje: klik w przeglądzie otwiera edytor w zakładce rodzaju');
  for (const [tab, nm] of [['Powtórki', rcName], ['Wielokolekcje', mcName], ['Inteligentne', scName], ['Zwykłe', colName]]) {
    await rerender(() => page.click(`.page-tabs button:has-text("${tab}")`));
    await rerender(() => page.click(`td:text-is("${nm}")`));
    await page.click('main .panel header button:has-text("Usuń")');
    await rerender(() => page.click('#dlg-buttons button:has-text("Usuń")'));
    check(!(await page.$(`td:text-is("${nm}")`)), `${tab.toLowerCase()}: usunięto „${nm}”`);
  }

  // ---------- R6: bloki, szablony dnia, deco, playout blokowy z kalendarzem tygodnia ----------
  const r6 = 'E2E ' + tag;
  // zrzuty ekranu nowych widoków do obejrzenia: E2E_SHOTS=<katalog poza repo>
  const shot = (n, p = page) => (process.env.E2E_SHOTS ? p.screenshot({ path: `${process.env.E2E_SHOTS}/${n}.png`, fullPage: true }) : null);
  const bgName = r6 + ' bloki', blkA = r6 + ' blok A', blkB = r6 + ' blok B';
  await page.goto(`${BASE}/#bloki`);
  await page.waitForSelector('main[data-view="bloki"]');
  await page.click('button:has-text("+ Grupa")');
  await page.fill('#bg-name', bgName);
  await rerender(() => page.click('#dlg-buttons button:has-text("Załóż")'));
  await rerender(() => page.click('text=+ Nowy blok'));
  await page.selectOption('#blk-BlockGroupId', { label: bgName });
  await page.fill('#blk-Name', blkA);
  await page.fill('#blk-Minutes', '30');
  await page.click('button:has-text("Załóż blok")');
  await page.waitForSelector(`td:text-is("${blkA}")`);
  await rerender(() => page.click(`td:text-is("${blkA}")`));
  // 3 pozycje: inteligentna chronologicznie, wyszukiwanie, inteligentna losowo
  await page.click('text=+ Dodaj pozycję');
  await page.selectOption('#bi-cp-kind', 'SmartCollection');
  await page.click('#bi-cp .picks button:has-text("Archiwum INFO24")');
  await page.click('.items-side button:has-text("Zastosuj")');
  await page.click('text=+ Dodaj pozycję');
  await page.selectOption('#bi-cp-kind', 'SearchQuery');
  await page.fill('#bi-cp-title', 'Pogoda');
  await page.fill('#bi-cp-query', 'title:Pogoda');
  await page.click('.items-side button:has-text("Zastosuj")');
  await page.click('text=+ Dodaj pozycję');
  await page.selectOption('#bi-cp-kind', 'SmartCollection');
  await page.click('#bi-cp .picks button:has-text("Archiwum INFO24")');
  await page.selectOption('#bi-PlaybackOrder', 'Random');
  await page.click('.items-side button:has-text("Zastosuj")');
  await rerender(() => page.click('main .panel header button:has-text("Zapisz")'));
  const bA = (await api('GetAllBlocks')).result.find((b) => b.Name === blkA);
  const bItems = (await api('GetBlockItems', { BlockId: bA.Id })).result.sort((a, b) => a.Index - b.Index);
  check(bA.Minutes === 30 && bItems.length === 3 && bItems[1].CollectionType === 'SearchQuery' && bItems[2].PlaybackOrder === 'Random', `blok 30 min z 3 pozycjami (${bA.Minutes} min, ${bItems.length} poz.)`);
  await page.click('button:has-text("Pokaż podgląd")');
  await page.waitForSelector('#blk-preview table');
  check((await page.$$('#blk-preview tbody tr')).length >= 3 && await page.isVisible('#blk-preview .daybar .seg'), 'blok: podgląd wypełnienia');
  await page.click('main .panel header button:has-text("Kopiuj")');
  await page.fill('#copy-name', blkB);
  await rerender(() => page.click('#dlg-buttons button:has-text("Kopiuj")'));
  const bB = (await api('GetAllBlocks')).result.find((b) => b.Name === blkB);
  await shot('r6-blok');
  check(bB && bB.Minutes === 30 && (await api('GetBlockItems', { BlockId: bB.Id })).result.length === 3, 'blok skopiowany z pozycjami');

  // szablon dnia z dwoma blokami; godziny w czasie kontenera legacy (UTC – stack.sh nie ustawia TZ), tuż po teraz
  const nowUtc = new Date();
  let s0 = Math.ceil((nowUtc.getUTCHours() * 60 + nowUtc.getUTCMinutes() + 10) / 5) * 5;
  if (s0 > 1440 - 60) s0 = 0;
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const tgName = r6 + ' szablony', tplName = r6 + ' dzień';
  await rerender(() => page.click('.page-tabs button:has-text("Szablony dnia")'));
  await page.click('button:has-text("+ Grupa")');
  await page.fill('#tg-name', tgName);
  await rerender(() => page.click('#dlg-buttons button:has-text("Załóż")'));
  await rerender(() => page.click('text=+ Nowy szablon'));
  await page.selectOption('#tpl-TemplateGroupId', { label: tgName });
  await page.fill('#tpl-Name', tplName);
  await page.click('button:has-text("Załóż szablon")');
  await page.waitForSelector(`td:text-is("${tplName}")`);
  await rerender(() => page.click(`td:text-is("${tplName}")`));
  for (const [b, m] of [[blkA, s0], [blkB, s0 + 30]]) {
    await page.click('text=+ Dodaj blok');
    await page.selectOption('#ti-BlockId', { label: `${bgName} / ${b} (30 min)` });
    await page.fill('#ti-StartTime', hhmm(m));
    await page.click('.items-side button:has-text("Zastosuj")');
  }
  check((await page.$$('#tpl-bar .seg')).length === 2, 'szablon: dwa bloki na osi doby');
  await rerender(() => page.click('main .panel header button:has-text("Zapisz")'));
  const tpl = (await api('GetAllTemplates')).result.find((t) => t.Name === tplName);
  const tItems = (await api('GetTemplateItems', { TemplateId: tpl.Id })).result;
  check(tItems.length === 2 && tItems.some((i) => i.BlockId === bA.Id) && tItems.some((i) => i.BlockId === bB.Id), `szablon dnia z dwoma blokami (od ${hhmm(s0)} UTC)`);
  // nakładanie bloków – legacy odrzuca, panel pokazuje błąd
  await page.click('text=+ Dodaj blok');
  await page.fill('#ti-StartTime', hhmm(s0 + 10));
  await page.click('.items-side button:has-text("Zastosuj")');
  await shot('r6-szablon');
  check((await page.$$('#tpl-bar .seg.bad')).length >= 1, 'szablon: nakładanie zaznaczone na czerwono');
  await page.click('main .panel header button:has-text("Zapisz")');
  await page.waitForSelector('#toast.bad');
  check((await api('GetTemplateItems', { TemplateId: tpl.Id })).result.length === 2, 'szablon: nakładanie odrzucone przez legacy');

  // deco z przerwą (playlista na początku bloku) i bez znaku wodnego
  const brkGroup = r6 + ' przerwy', brkName = r6 + ' reklamy';
  await api('CreatePlaylistGroup', { Name: brkGroup });
  const brkGid = (await api('GetAllPlaylistGroups')).result.find((g) => g.Name === brkGroup).Id;
  const brkPl = (await api('CreatePlaylist', { PlaylistGroupId: brkGid, Name: brkName })).result;
  const dgName = r6 + ' deco', decoName = r6 + ' oprawa';
  await page.goto(`${BASE}/#deco`);
  await page.waitForSelector('main[data-view="deco"]');
  await rerender(() => page.click('.page-tabs button:has-text("Deco")'));
  await page.click('button:has-text("+ Grupa")');
  await page.fill('#dg-name', dgName);
  await rerender(() => page.click('#dlg-buttons button:has-text("Załóż")'));
  await rerender(() => page.click('text=+ Nowe deco'));
  await page.selectOption('#deco-DecoGroupId', { label: dgName });
  await page.fill('#deco-Name', decoName);
  await page.click('button:has-text("Załóż deco")');
  await page.waitForSelector(`td:text-is("${decoName}")`);
  await rerender(() => page.click(`td:text-is("${decoName}")`));
  await page.selectOption('#deco-WatermarkMode', 'Disable');
  check(!(await page.isVisible('#deco-breaks')), 'deco: treść przerw ukryta przy „dziedzicz”');
  await page.selectOption('#deco-BreakContentMode', 'Override');
  await page.click('#deco-breaks button:has-text("+ Dodaj treść przerwy")');
  await page.click(`#brk-cp .picks button:has-text("${brkName}")`);
  await page.click('#deco-breaks .items-side button:has-text("Zastosuj")');
  await page.selectOption('#deco-DeadAirFallbackMode', 'Override');
  await page.selectOption('#dair-cp-kind', 'SmartCollection');
  await page.click('#dair-cp .picks button:has-text("Archiwum INFO24")');
  await rerender(() => page.click('main .panel header button:has-text("Zapisz")'));
  const decoId = (await api('GetDecosByDecoGroupId', { DecoGroupId: (await api('GetAllDecoGroups')).result.find((g) => g.Name === dgName).Id })).result[0]?.Id;
  const decoRow = (await api('GetDecoById', { DecoId: decoId })).result;
  check(decoRow && decoRow.WatermarkMode === 'Disable' && decoRow.BreakContentMode === 'Override' && decoRow.BreakContent.length === 1 && decoRow.BreakContent[0].Playlist?.Id === brkPl.Id
    && decoRow.DeadAirFallbackMode === 'Override' && decoRow.DeadAirFallbackSmartCollection?.Name === 'Archiwum INFO24', 'deco z przerwą (playlista) i martwym powietrzem zapisane');
  await rerender(() => page.click(`td:text-is("${decoName}")`));
  check(/Archiwum INFO24/.test(await page.textContent('#dair-cp .picked')) && (await page.$$('#deco-breaks tbody tr')).length === 1, 'deco: po ponownym otwarciu treść z nazwą');
  await shot('r6-deco');
  await rerender(() => page.click('main .panel header button:has-text("Zapisz")'));
  const deco2 = (await api('GetDecoById', { DecoId: decoId })).result;
  check(deco2.BreakContent[0]?.Playlist?.Id === brkPl.Id && deco2.DeadAirFallbackSmartCollection?.Name === 'Archiwum INFO24', 'deco: ponowny zapis nie gubi treści przerw i martwego powietrza');

  // szablon deco: deco na całą dobę
  const dtgName = r6 + ' szablony deco', dtName = r6 + ' doba';
  await rerender(() => page.click('.page-tabs button:has-text("Szablony deco")'));
  await page.click('button:has-text("+ Grupa")');
  await page.fill('#dtg-name', dtgName);
  await rerender(() => page.click('#dlg-buttons button:has-text("Załóż")'));
  await rerender(() => page.click('text=+ Nowy szablon deco'));
  await page.selectOption('#dt-DecoTemplateGroupId', { label: dtgName });
  await page.fill('#dt-Name', dtName);
  await page.click('button:has-text("Załóż szablon")');
  await page.waitForSelector(`td:text-is("${dtName}")`);
  await rerender(() => page.click(`td:text-is("${dtName}")`));
  await page.click('text=+ Dodaj deco');
  await page.selectOption('#dti-DecoId', { label: `${dgName} / ${decoName}` });
  await page.fill('#dti-StartTime', '00:00');
  await page.fill('#dti-EndTime', '23:59');
  await page.click('.items-side button:has-text("Zastosuj")');
  await rerender(() => page.click('main .panel header button:has-text("Zapisz")'));
  const dt = (await api('GetDecoTemplatesByDecoTemplateGroupId', { DecoTemplateGroupId: (await api('GetAllDecoTemplateGroups')).result.find((g) => g.Name === dtgName).Id })).result[0];
  check(dt && (await api('GetDecoTemplateItems', { DecoTemplateId: dt.Id })).result.length === 1, 'szablon deco z jednym deco');

  // playout blokowy: szablon dnia na cały tydzień, szablon deco, deco domyślne; przebudowa i EPG
  const bCh = String(Math.max(...(await api('GetAllChannels', { ShowDisabled: true })).result.map((c) => parseFloat(c.Number) || 0)) + 1);
  const bChName = r6 + ' kanał blokowy';
  await api('CreateChannel', { Name: bChName, Number: bCh, Group: 'Test', FFmpegProfileId: profiles[0].Id, Logo: { Path: '', ContentType: '' }, StreamingEngine: 'Next', StreamingMode: 'HttpLiveStreamingSegmenter', PlayoutSource: 'Generated', PlayoutMode: 'Continuous', IsEnabled: true, ShowInEpg: true });
  await page.goto(`${BASE}/#playouty`);
  await page.waitForSelector('main[data-view="playouty"]');
  await rerender(() => page.click('text=+ Nowy playout'));
  await page.selectOption('#f-Kind', 'Block');
  await page.selectOption('#f-ChannelId', { label: `${bCh} · ${bChName}` });
  await page.click('button:has-text("Załóż playout")');
  await page.waitForSelector(`td:text-is("${bChName}")`);
  await rerender(() => page.click(`td:text-is("${bChName}")`));
  check(/brak szablonu/.test(await page.textContent('#cal-week')), 'kalendarz: pusty playout – dni bez szablonu');
  await page.click('text=+ Dodaj szablon dnia');
  await page.selectOption('#pt-TemplateId', { label: `${tgName} / ${tplName}` });
  await page.selectOption('#pt-DecoTemplateId', { label: `${dtgName} / ${dtName}` });
  await page.click('.items-side button:has-text("Zastosuj")');
  await page.selectOption('#cal-DecoId', { label: `${dgName} / ${decoName}` });
  const weekText = await page.textContent('#cal-week');
  check(weekText.split(tplName).length - 1 === 7 && (await page.$$('#cal-week .daybar:not(.thin) .seg')).length >= 14, 'kalendarz tygodnia: szablon dnia w każdym dniu, bloki na osi');
  // M7: siatka godziny × dni (domyślny widok) – bloki w każdym dniu, deco z prawej, pigułka szablonu „pon–nd”; przełącznik na paski
  check(await page.isVisible('#cal-grid') && (await page.$$('#cal-grid .gday')).length === 7 && (await page.$$('#cal-grid .gblk')).length >= 14
    && (await page.$$('#cal-grid .gdeco')).length >= 7 && (await page.textContent('#cal-tpl')).includes('pon–nd'), 'kalendarz: siatka tygodnia z blokami, deco i pigułką szablonu');
  check(/^tydzień \d+ \(/.test(await page.textContent('#cal-range')), 'kalendarz: tytuł z numerem tygodnia');
  await page.click('#cal-grid .gblk >> nth=0');
  await page.waitForFunction(() => { const t = document.querySelector('#cal-block')?.textContent || ''; return t.includes('Blok „') && !t.includes('wczytuję'); });
  check((await page.textContent('#cal-block')).includes('Pozycje'), 'kalendarz: klik w blok – szczegóły bloku z pozycjami');
  await page.click('main .panel header button:text-is("Paski")');
  check(await page.isVisible('#cal-week') && !(await page.isVisible('#cal-grid')), 'kalendarz: przełącznik Siatka → Paski');
  await page.click('main .panel header button:text-is("Siatka")');
  await rerender(() => page.click('main .panel header button:has-text("Zapisz")'));
  const bPo = (await api('GetPagedPlayouts', { Query: '', PageNum: 0, PageSize: 500 })).result.Page.find((p) => p.ChannelName === bChName);
  const pts = (await api('GetPlayoutTemplates', { PlayoutId: bPo.PlayoutId })).result;
  const defDeco = (await api('GetDecoByPlayoutId', { PlayoutId: bPo.PlayoutId })).result;
  check(pts.length === 1 && pts[0].Template.Id === tpl.Id && pts[0].DecoTemplate?.Id === dt.Id && pts[0].DaysOfWeek.length === 7 && defDeco?.Id === decoRow.Id,
    'playout blokowy: kalendarz i deco domyślne zapisane');
  await page.click('main button:has-text("Od nowa")');
  await page.click('#dlg-buttons button:has-text("Buduj od nowa")');
  let bFut = [];
  for (let i = 0; i < 30 && !bFut.length; i++) {
    await page.waitForTimeout(1000);
    bFut = (await api('GetFuturePlayoutItemsById', { PlayoutId: bPo.PlayoutId, ShowFiller: false, PageNum: 0, PageSize: 50 })).result?.Page || [];
  }
  check(bFut.length >= 2, `playout blokowy zbudowany (${bFut.length} poz.)`);
  await page.goto(`${BASE}/#epg`);
  await page.waitForSelector('main[data-view="epg"]');
  const epgRow = await page.evaluate((n) => {
    const ch = [...document.querySelectorAll('.epg .ch')].find((c) => c.textContent.includes(n));
    return ch ? ch.nextElementSibling.querySelectorAll('.p').length : -1;
  }, bChName);
  check(epgRow > 0, `pozycje playoutu blokowego w EPG (${epgRow})`);
  await page.goto(`${BASE}/#playouty`);
  await page.waitForSelector('main[data-view="playouty"]');
  await rerender(() => page.click(`td:text-is("${bChName}")`));
  // M6: „Zbudowany do” i „Przebuduj” w wierszu, kolumna „Blok” w najbliższych pozycjach
  const bRow = await page.evaluate((n) => {
    const tr = [...document.querySelectorAll('main tr')].find((r) => [...r.cells].some((c) => c.textContent === n));
    const ths = [...tr.closest('table').querySelectorAll('th')].map((t) => t.textContent);
    return { until: tr.cells[ths.indexOf('Zbudowany do')].textContent, btn: !!tr.querySelector('button') };
  }, bChName);
  check(/\d/.test(bRow.until) && bRow.btn, `playouty: „Zbudowany do” w wierszu (${bRow.until}) i przycisk przebudowy`);
  const blkCol = await page.evaluate(() => {
    const t = [...document.querySelectorAll('main .panel')].find((p) => /najbliższe pozycje/.test(p.querySelector('h2')?.textContent || ''))?.querySelector('table');
    const i = [...t.querySelectorAll('th')].map((x) => x.textContent).indexOf('Blok');
    return i < 0 ? [] : [...t.querySelectorAll('tbody tr')].map((r) => r.cells[i]?.textContent);
  });
  check(blkCol.some((b) => b === blkA || b === blkB), `playout blokowy: kolumna „Blok” z nazwą bloku (${[...new Set(blkCol)].join(', ')})`);
  await shot('r6-kalendarz');

  // sprzątanie R6 (UI: playout, szablony, deco, bloki; reszta przez API)
  await page.click('main .panel header button:has-text("Usuń")');
  await rerender(() => page.click('#dlg-buttons button:has-text("Usuń")'));
  await api('DeleteChannel', { ChannelId: bPo.ChannelId ?? (await api('GetAllChannels', { ShowDisabled: true })).result.find((c) => c.Name === bChName).Id });
  await page.goto(`${BASE}/#deco`);
  await page.waitForSelector('main[data-view="deco"]');
  await rerender(() => page.click(`td:text-is("${dtName}")`));
  await page.click('main .panel header button:has-text("Usuń")');
  await rerender(() => page.click('#dlg-buttons button:has-text("Usuń")'));
  await page.click('button:has-text("Usuń grupę…")');
  await page.selectOption('#dtg-del', { label: `${dtgName} (0 szabl.)` });
  await rerender(() => page.click('#dlg-buttons button:has-text("Usuń")'));
  await rerender(() => page.click('.page-tabs button:has-text("Deco")'));
  await rerender(() => page.click(`td:text-is("${decoName}")`));
  await page.click('main .panel header button:has-text("Usuń")');
  await rerender(() => page.click('#dlg-buttons button:has-text("Usuń")'));
  // lista może się przerysować drugi raz (odświeżenie po usunięciu) – czekamy, aż wiersz zniknie
  check(await page.waitForSelector(`td:text-is("${decoName}")`, { state: 'detached', timeout: 10000 }).then(() => true, () => false), 'deco usunięte');
  await page.click('button:has-text("Usuń grupę…")');
  await page.selectOption('#dg-del', { label: `${dgName} (0 deco)` });
  await rerender(() => page.click('#dlg-buttons button:has-text("Usuń")'));
  await page.goto(`${BASE}/#bloki`);
  await page.waitForSelector('main[data-view="bloki"]');
  await rerender(() => page.click(`td:text-is("${tplName}")`));
  await page.click('main .panel header button:has-text("Usuń")');
  await rerender(() => page.click('#dlg-buttons button:has-text("Usuń")'));
  await api('DeleteTemplateGroup', { TemplateGroupId: tpl.TemplateGroupId });
  await rerender(() => page.click('.page-tabs button:has-text("Bloki")'));
  for (const b of [blkB, blkA]) {
    await rerender(() => page.click(`td:text-is("${b}")`));
    await page.click('main .panel header button:has-text("Usuń")');
    await rerender(() => page.click('#dlg-buttons button:has-text("Usuń")'));
  }
  check(!(await page.$(`td:text-is("${blkA}")`)) && !(await page.$(`td:text-is("${blkB}")`)), 'bloki usunięte');
  await page.click('button:has-text("Usuń grupę…")');
  await page.selectOption('#bg-del', { label: bgName });
  await rerender(() => page.click('#dlg-buttons button:has-text("Usuń")'));
  await api('DeletePlaylistGroup', { PlaylistGroupId: brkGid });
  const r6left = [(await api('GetAllBlockGroups')).result, (await api('GetAllTemplateGroups')).result, (await api('GetAllDecoGroups')).result, (await api('GetAllDecoTemplateGroups')).result]
    .flat().filter((g) => g.Name.startsWith(r6));
  check(!r6left.length, 'R6: grupy posprzątane');

  // ---------- R7: ustawienia legacy, logi, konserwacja, test odtwarzania
  const tab = async (view, label) => {
    await page.goto(`${BASE}/#${view}`);
    await page.waitForSelector(`main[data-view="${view}"]`);
    if (label) await rerender(() => page.click(`.page-tabs button:has-text("${label}")`));
  };
  const saveSettings = (title) => rerender(() => page.click(`.panel:has(h2:text-is("${title}")) header button:has-text("Zapisz")`));
  await tab('ustawienia');
  // M9: sekcje ustawień jako panele obok siebie (bez zakładek)
  check((await page.$$('main [data-set]')).length >= 6 && !(await page.$('main .page-tabs')), 'ustawienia: sekcje legacy jako panele obok siebie');
  const xmlDays = Number(await page.inputValue('#s-xmltv-DaysToBuild'));
  await page.fill('#s-xmltv-DaysToBuild', '0');
  await page.click('.panel:has(h2:text-is("Przewodnik XMLTV")) header button:has-text("Zapisz")');
  await page.waitForSelector('#toast.bad');
  check(/co najmniej 1/.test(await page.textContent('#toast')), 'ustawienia: 0 dni XMLTV odrzucone przez panel (legacy tego nie sprawdza)');
  const poDays = (await api('GetPlayoutSettings')).result.DaysToBuild;
  await page.fill('#s-xmltv-DaysToBuild', String(poDays + 1));
  await page.click('.panel:has(h2:text-is("Przewodnik XMLTV")) header button:has-text("Zapisz")');
  await page.waitForFunction(() => /cannot be greater/.test(document.querySelector('#toast.bad')?.textContent || ''));
  check(true, 'ustawienia: walidacja legacy (XMLTV dłuższy niż playout) pokazana operatorowi');
  const xmlNew = xmlDays > 1 ? xmlDays - 1 : xmlDays + 1;
  await page.fill('#s-xmltv-DaysToBuild', String(xmlNew));
  await saveSettings('Przewodnik XMLTV');
  let xs = (await api('GetXmltvSettings')).result;
  check(xs.DaysToBuild === xmlNew && (await page.inputValue('#s-xmltv-DaysToBuild')) === String(xmlNew), `ustawienia: dni XMLTV ${xmlDays} → ${xs.DaysToBuild} zapisane w legacy`);
  await shot('r7-ustawienia');
  await page.fill('#s-xmltv-DaysToBuild', String(xmlDays));
  await saveSettings('Przewodnik XMLTV');
  xs = (await api('GetXmltvSettings')).result;
  check(xs.DaysToBuild === xmlDays && xs.TimeZone && xs.BlockBehavior, `ustawienia: dni XMLTV przywrócone (${xs.DaysToBuild})`);
  for (const [t, id] of [['FFmpeg i strumienie', '#s-ffmpeg-FFmpegPath'], ['Playouty', '#s-playout-DaysToBuild'], ['Skaner i HDHomeRun', '#s-skaner-TunerCount'], ['Web GUI legacy', '#s-gui-IsDarkMode']]) {
    check(!!(await page.inputValue(id)), `ustawienia: sekcja „${t}” wczytana z legacy`);
  }

  // logi: poziom Debug z panelu → „Zwolnij pamięć” (Diagnostyka) → wpis w Logach
  const logStart = Date.now() - 2000;
  await tab('ustawienia');
  await page.selectOption('#s-logi-DefaultMinimumLogLevel', 'Debug');
  await saveSettings('Poziomy logów');
  check((await api('GetLoggingSettings')).result.DefaultMinimumLogLevel === 'Debug', 'ustawienia: domyślny poziom logów = Debug');
  await tab('diagnostyka');
  check(/v\d+\./.test(await page.textContent('.panel:has(h2:text-is("Wersje i sprzęt"))')), 'diagnostyka: wersja legacy i sprzęt');
  const stack = await page.textContent('[data-stack]');
  check(/OK\s*legacy/.test(stack) && /most/.test(stack) && /kontrole legacy/.test(stack) && /CG Playout/.test(stack), `diagnostyka: „Stan” stosu na górze (${stack.slice(0, 120)})`);
  const hls = await page.getAttribute('#pt-hls', 'href');
  check(/\/iptv\/channel\/[^/]+\.m3u8$/.test(hls || ''), `test odtwarzania: odnośnik do strumienia (${hls})`);
  await page.click('#maint button:has-text("Zwolnij pamięć")');
  await page.click('#dlg-buttons button:has-text("Zwolnij pamięć")');
  // czeka na komunikat tej akcji (poprzedni zielony toast może jeszcze wisieć)
  check(await page.waitForFunction(() => /w tle/.test(document.querySelector('#toast.ok')?.textContent || '')).then(() => true, () => false), 'konserwacja: zadanie zlecone w tle legacy');
  await shot('r7-diagnostyka');
  await tab('logi');
  await page.selectOption('#log-level', 'Debug');
  await page.waitForSelector('main[data-view="logi"] #log-level');
  let found = false;
  for (let i = 0; i < 10 && !found; i++) {
    await page.fill('#log-q', 'garbage collection');
    await rerender(() => page.click('.logbar button:has-text("Szukaj")'));
    const r = (await api('GetRecentLogEntries', { PageNum: 0, PageSize: 5, Filter: 'Completed garbage collection' })).result.Page;
    found = r.some((e) => Date.parse(e.Timestamp) >= logStart) && (await page.isVisible('td.log:has-text("garbage collection")'));
    if (!found) await page.waitForTimeout(1000);
  }
  check(found, 'logi: wpis po akcji z panelu (zwolnienie pamięci) widoczny w Logach');
  await shot('r7-logi');
  await tab('ustawienia');
  await page.selectOption('#s-logi-DefaultMinimumLogLevel', 'Information');
  await saveSettings('Poziomy logów');
  check((await api('GetLoggingSettings')).result.DefaultMinimumLogLevel === 'Information', 'ustawienia: poziom logów przywrócony');

  // ---------- R8: źródła zewnętrzne (Jellyfin przez atrapę serwera, Plex PIN przez podstawiony adres) ----------
  // Atrapa Jellyfin/Emby: kilka odpowiedzi API, których legacy potrzebuje do połączenia i listy bibliotek.
  const http = require('http');
  const fake = http.createServer((q, r) => {
    const u = q.url.split('?')[0];
    const b = u.endsWith('/System/Info') ? { ServerName: 'Atrapa E2E', OperatingSystem: 'Linux', Id: 'e2e' }
      : u.endsWith('/Users') ? [{ Id: 'u1', Name: 'admin', Policy: { IsAdministrator: true } }]
        : u.endsWith('/Library/VirtualFolders') ? [{ Name: 'Filmy E2E', CollectionType: 'movies', ItemId: 'lib1', Locations: ['/media/filmy'] }]
          : { Items: [], TotalRecordCount: 0 };
    r.writeHead(200, { 'Content-Type': 'application/json' });
    r.end(JSON.stringify(b));
  });
  await new Promise((ok) => fake.listen(18096, '0.0.0.0', ok));
  // legacy (w kontenerze) widzi gospodarza pod bramą sieci Dockera
  let gw = process.env.E2E_FAKE_HOST;
  if (!gw) {
    try { gw = require('child_process').execSync("docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}'").toString().trim(); } catch { gw = '172.17.0.1'; }
  }
  const FAKE = `http://${gw}:18096`;
  const KEY = 'e2e-tajny-klucz-' + Date.now().toString(36);
  for (const K of ['Jellyfin', 'Emby']) await api(`Disconnect${K}`);
  await tab('zrodla', 'Jellyfin');
  check(await page.isVisible('#src-Jellyfin-apikey[type="password"]'), 'źródła: klucz API w polu hasła');
  await page.fill('#src-Jellyfin-address', 'jellyfin:8096');
  await page.fill('#src-Jellyfin-apikey', KEY);
  await page.click('button:text-is("Połącz")');
  await page.waitForSelector('#toast.bad');
  check(/http:\/\//.test(await page.textContent('#toast')), 'źródła: adres bez http:// odrzucony przez panel');
  await page.fill('#src-Jellyfin-address', 'http://127.0.0.1:1');
  await page.click('button:text-is("Połącz")');
  await page.waitForFunction(() => /nie połączył/.test(document.querySelector('#toast.bad')?.textContent || ''));
  check(true, 'źródła: błąd połączenia z legacy pokazany operatorowi');
  check((await api('GetAllJellyfinMediaSources')).result.length === 0, 'źródła: nieudane połączenie nic nie zapisało');
  await page.fill('#src-Jellyfin-address', FAKE);
  await page.fill('#src-Jellyfin-apikey', KEY);
  await page.click('button:text-is("Połącz")');
  await page.waitForSelector('[data-source^="Jellyfin-"]', { timeout: 20000 });
  check(true, `źródła: połączono z atrapą Jellyfin (${FAKE})`);
  const sec = (await api('GetJellyfinSecrets')).result;
  check(sec.ApiKey === '********' && sec.Address === FAKE, 'źródła: klucz API zamaskowany przez serwer panelu (tylko zapis)');
  check(!(await page.content()).includes(KEY) && (await page.inputValue('#src-Jellyfin-apikey')) === '', 'źródła: klucz nie wraca do przeglądarki');
  const jsrc = (await api('GetAllJellyfinMediaSources')).result[0];
  for (let i = 0; i < 10 && !(await page.isVisible('label:has-text("Filmy E2E")')); i++) {
    await page.waitForTimeout(1000);
    await rerender(() => page.click('.page-tabs button:has-text("Jellyfin")'));
  }
  await page.check(`[data-source="Jellyfin-${jsrc.Id}"] input[aria-label="Synchronizuj Filmy E2E"]`);
  await rerender(() => page.click('button:has-text("Zapisz wybór bibliotek")'));
  const jl = (await api('GetJellyfinLibrariesBySourceId', { JellyfinMediaSourceId: jsrc.Id })).result;
  check(jl.length === 1 && jl[0].ShouldSyncItems === true, 'źródła: biblioteka Jellyfin włączona do synchronizacji');
  // widok może się jeszcze przerysować po zapisie bibliotek – klik ponawiany, aż wiersz się pojawi
  const addPath = `[data-source="Jellyfin-${jsrc.Id}"] button:has-text("+ Dodaj zamianę")`;
  for (let i = 0; i < 10 && !(await page.isVisible('input[aria-label="Ścieżka w Jellyfin 1"]')); i++) {
    await page.click(addPath, { timeout: 5000 }).catch(() => {});
    await page.waitForSelector('input[aria-label="Ścieżka w Jellyfin 1"]', { timeout: 2000 }).catch(() => {});
  }
  await page.fill('input[aria-label="Ścieżka w Jellyfin 1"]', '/media/filmy');
  await page.fill('input[aria-label="Ścieżka w legacy 1"]', '/config/media/filmy');
  await rerender(() => page.click('button:has-text("Zapisz zamiany ścieżek")'));
  const pr = (await api('GetJellyfinPathReplacementsBySourceId', { JellyfinMediaSourceId: jsrc.Id })).result;
  check(pr.length === 1 && pr[0].JellyfinPath === '/media/filmy' && pr[0].LocalPath === '/config/media/filmy', 'źródła: zamiana ścieżki zapisana');
  check(await page.inputValue('input[aria-label="Ścieżka w legacy 1"]') === '/config/media/filmy', 'źródła: zamiana ścieżki po ponownym otwarciu');
  await shot('r8-jellyfin');
  await page.click('button:has-text("Rozłącz Jellyfin")');
  await rerender(() => page.click('#dlg-buttons button:has-text("Rozłącz")'));
  check((await api('GetAllJellyfinMediaSources')).result.length === 0 && !(await page.isVisible('[data-source^="Jellyfin-"]')), 'źródła: Jellyfin rozłączony (z potwierdzeniem)');
  fake.close();

  // Plex: PIN – legacy daje adres app.plex.tv; w teście podstawiony, żeby nie zależeć od plex.tv
  await tab('zrodla', 'Plex');
  check(!(await page.isVisible('button:has-text("Wyloguj z Plex")')), 'Plex: bez serwerów nie ma „Wyloguj”');
  const PIN = 'https://app.plex.tv/auth#?clientID=e2e&code=e2e-pin';
  await page.route('**/api/cmd/StartPlexPinFlow', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, result: PIN }) }));
  await page.evaluate(() => { window.open = (u) => { window.__opened = u; return null; }; });
  await rerender(() => page.click('button:has-text("Zaloguj do Plex")'));
  check(await page.evaluate(() => window.__opened) === PIN && await page.getAttribute('#plex-pin a', 'href') === PIN, 'Plex: logowanie PIN otwiera stronę Plex i pokazuje odnośnik');
  await shot('r8-plex');
  await page.unroute('**/api/cmd/StartPlexPinFlow');
  await tab('zrodla', 'Strumienie zdalne');
  check(/is_live/.test(await page.textContent('main pre')), 'strumienie zdalne: przykład pliku .yml');
  await shot('r8-strumienie');
  await tab('antena');


  // ---------- R9: grafika VizRS i sloty na żywo (atrapa CG Playout) ----------
  await page.goto(`${BASE}/#grafika`);
  await page.waitForSelector('main[data-view="grafika"] [data-cg-sessions]');
  check(await page.textContent('[data-cg-sessions]') === '1', 'grafika: stan CG Playout (sesje elementu VizRS)');
  await page.waitForSelector('[data-cg-pages] td:has-text("Belka tytułowa")');
  check(true, 'grafika: strony VizRS kanału 24 z /etv/pages');
  // VizRS CG System: podgląd /output z tokenem wyjścia i anteną kanału (bus=ch-N), Trio z ?channel=N
  const vizrsBus = async () => {
    const f = await (await page.waitForSelector('iframe[data-vizrs-output]')).contentFrame();
    return (await f.waitForSelector('body[data-bus]')).getAttribute('data-bus');
  };
  const vsrc = await page.getAttribute('iframe[data-vizrs-output]', 'src');
  check(vsrc === 'http://127.0.0.1:18700/output?token=e2e-vizrs-output&bus=ch-24' && await vizrsBus() === 'ch-24',
    `grafika: podgląd VizRS – host panelu, token wyjścia, antena kanału 24 (${vsrc})`);
  check(await page.getAttribute('main .panel a[data-trio]', 'href') === 'http://127.0.0.1:18700/trio?channel=24', 'grafika: odnośnik do Trio na antenę kanału');
  check(!vizrsSeen.some((u) => /\/trio/.test(u)) && !(await page.content()).includes(CG_TOKEN), 'grafika: Trio bez tokenu operatora, token CG nie trafia do strony');
  check(await page.isVisible('button:has-text("Wczytaj pliki elementów")'), 'grafika: przycisk RefreshGraphicsElements (komenda na liście mostu)');
  await rerender(() => page.click('button:has-text("Wczytaj pliki elementów")'));
  check(/wczytał/.test(await page.textContent('#toast')), 'grafika: RefreshGraphicsElements wykonane w legacy');
  // Na antenie: emisja kanału (sesje legacy przez most) i cała grafika (CG Playout /api/live/graphics/off|on)
  await page.goto(`${BASE}/#antena`);
  await page.waitForSelector('main[data-view="antena"] [data-graphics] button');
  check(/emisja/.test(await page.textContent('main .cols')), 'antena: stan emisji kanału (sesje legacy)');
  const ses = await page.evaluate(() => fetch('/api/sessions').then((r) => r.json()));
  check(ses.ok && Array.isArray(ses.result), `antena: GET /api/sessions przez most (${JSON.stringify(ses).slice(0, 120)})`);
  await page.click('[data-graphics] button:has-text("Zdejmij grafikę")');
  await page.click('#dlg-buttons button:has-text("Zdejmij grafikę")');
  await page.waitForSelector('[data-graphics] button:has-text("Przywróć grafikę")');
  check(CG.graphicsOff === true && /GRAFIKA ZDJĘTA/.test(await page.textContent('[data-graphics]')), 'antena: Zdejmij grafikę → CG Playout graphics/off');
  await page.click('[data-graphics] button:has-text("Przywróć grafikę")');
  await page.waitForSelector('[data-graphics] button:has-text("Zdejmij grafikę")');
  check(CG.graphicsOff === false, 'antena: Przywróć grafikę → CG Playout graphics/on');
  const badSes = await page.evaluate(() => fetch('/api/session/24/kill', { method: 'POST', headers: { 'X-VizRS-Live': '1' } }).then((r) => r.status));
  check(badSes === 404, 'antena: sesja – tylko start, stop, restart');

  // reguły grafiki (CG Playout GET/PUT /api/live/graphics) – z powrotem na ekranie Grafika kanału
  await page.goto(`${BASE}/#grafika`);
  await page.waitForSelector('[data-rules] #gr-on_clip');
  check(await page.inputValue('#gr-on_clip') === 'TAKE 4001 headline={title}' && await page.inputValue('input[aria-label="on_end 1"]') === '-', 'reguły grafiki: odczyt z CG Playout („-” = wyłączone)');
  // M8: streszczenie „Kiedy / Co / Ile” – globalne, reklama wyłączona = OUT, reguła kanału 24 („-”); klik w wiersz → pole edytora
  const sum = await page.textContent('[data-rules-summary]');
  check(/start pozycji/.test(sum) && sum.includes('TAKE 4001 headline={title}') && /OUT – grafika schodzi/.test(sum) && /kanał 24/.test(sum) && /wyłączone/.test(sum),
    'reguły grafiki: tabela Kiedy / Co / Ile z regułą globalną, reklamą i regułą kanału');
  await page.click('[data-rules-summary] tr:has-text("TAKE 4001")');
  check(await page.evaluate(() => document.activeElement?.id) === 'gr-on_clip', 'reguły grafiki: klik w wiersz streszczenia przenosi do pola edytora');
  await page.fill('#gr-on_end', 'TAKE 1405 programs={next_title}');
  await page.fill('#gr-end_seconds', '45');
  await page.click('button:has-text("+ Reguła audycji")');
  await page.fill('input[aria-label="Audycja (regex tytułu) 1"]', '(');
  await page.click('button:has-text("Zapisz reguły grafiki")');
  await page.waitForSelector('#toast.bad');
  check(/odrzucił reguły.*regular expression/.test(await page.textContent('#toast')) && CG.graphics.source === 'config', 'reguły grafiki: błąd walidacji CG Playout pokazany, nic nie zapisane');
  await page.fill('input[aria-label="Audycja (regex tytułu) 1"]', '^Wiadomo');
  await page.fill('input[aria-label="on_clip 1"]', 'TAKE 1001 headline={title}');
  await rerender(() => page.click('button:has-text("Zapisz reguły grafiki")'));
  const gr = CG.graphics.rules;
  check(gr.on_end === 'TAKE 1405 programs={next_title}' && gr.end_seconds === 45 && gr.shows.length === 1 && gr.shows[0].show_title === '^Wiadomo' && gr.shows[0].on_clip === 'TAKE 1001 headline={title}' && !('on_end' in gr.shows[0]),
    'reguły grafiki: zapis globalnych i reguły audycji (puste = dziedzicz)');
  check(gr.channels['24'].on_end === '' && gr.channels['24'].shows?.[0]?.on_clip === 'TAKE 9', 'reguły grafiki: reguła kanału zachowana („-”, reguły audycji kanału bez zmian)');
  check(await page.isVisible('[data-rules] >> xpath=.. >> text=z panelu') || /z panelu/.test(await page.textContent('main')), 'reguły grafiki: źródło „z panelu” po zapisie');
  await shot('r9-grafika');

  await page.goto(`${BASE}/#live`);
  await page.waitForSelector('main[data-view="live"] [data-live-channel="24"]');
  await page.click('[data-live-channel="24"] details.how summary');
  // jak nadawać: serwer i klucz RTMP (klucz ukryty, „Pokaż”), SRT z hasłem; host z panelu, gdy CG go nie zna
  check(await page.inputValue('input[aria-label="Serwer RTMP 24-1"]') === 'rtmp://tv.example.pl:1936/live', 'sloty: serwer RTMP dla OBS');
  check(await page.getAttribute('input[aria-label="Klucz RTMP 24-1"]', 'type') === 'password' && await page.inputValue('input[aria-label="Klucz RTMP 24-1"]') === 'studio-klucz', 'sloty: klucz strumienia (ukryty)');
  await page.click('[data-inputs="24"] .input:first-child button:has-text("Pokaż")');
  check(await page.getAttribute('input[aria-label="Klucz RTMP 24-1"]', 'type') === 'text', 'sloty: „Pokaż” odsłania klucz');
  check(await page.inputValue('input[aria-label="Adres SRT 24-2"]') === 'srt://127.0.0.1:9000?mode=caller&passphrase=tajne%20haslo', 'sloty: adres SRT z hasłem (host z panelu)');
  check(/NA ANTENIE/.test(await page.textContent('main')), 'sloty: kanał 24 z sygnałem studia NA ANTENIE');
  const inTab = await page.textContent('[data-inputs-table]');
  check(inTab.includes('rtmp://tv.example.pl:1936/live') && /nadaje/.test(inTab) && /h264 · z dźwiękiem/.test(inTab) && !inTab.includes('studio-klucz') && !inTab.includes('tajne'),
    'sloty: tabela wejść – adres bez klucza i hasła, stan, obraz');
  // wejścia studia ustawiane z panelu (CG Playout GET/PUT /api/live/inputs)
  await page.click('button:has-text("Ustaw wejścia…")');
  await page.waitForSelector('[data-inputs-edit]');
  check(await page.inputValue('input[aria-label="Klucz wejścia 1"]') === 'studio-klucz', 'wejścia: bieżące z CG Playout (klucz RTMP)');
  await page.click('[data-inputs-edit] button:has-text("+ Wejście")');
  await page.selectOption('select[aria-label="Rodzaj wejścia 2"]', 'srt');
  await page.fill('input[aria-label="Hasło wejścia 2"]', 'haslo-studia-2');
  await page.click('#dlg-buttons button:has-text("Zapisz")');
  await page.waitForSelector('#overlay', { state: 'hidden' });
  const saved = JSON.stringify(CG.inputs || []);
  check(saved.includes('rtmp://0.0.0.0:1936/live/studio-klucz') && saved.includes('srt://0.0.0.0:9000?passphrase=haslo-studia-2'), 'wejścia: zapis listy do CG Playout (RTMP 1936, SRT 9000 z hasłem)');
  // M9: logi ze źródłem – zdarzenia VizRS CG Playout
  await page.goto(`${BASE}/#logi`);
  await page.waitForSelector('main[data-view="logi"] #log-src');
  await rerender(() => page.selectOption('#log-src', 'cg'));
  check(/nadawca połączony/.test(await page.textContent('main')) && /kanał 24/.test(await page.textContent('main')), 'logi: źródło VizRS CG Playout – zdarzenia z /api/live/state');
  await rerender(() => page.selectOption('#log-src', 'legacy'));
  await page.goto(`${BASE}/#live`);
  await page.waitForSelector('main[data-view="live"] [data-live-channel="24"]');
  check(/LIVE/.test(await page.textContent('[data-guide="24"]')) && /Poranek na żywo/.test(await page.textContent('[data-guide="24"]')), 'sloty: ramówka EPG z audycją LIVE');
  check(/odbiór sygnałów: 1/.test(await page.textContent('[data-live-status]')) && /CG Playout 0\.9\.0-test/.test(await page.textContent('[data-live-status]')), 'sloty: lampki CG, ErsatzTV, odbioru');
  const since1 = await page.textContent('[data-live-channel="24"] [data-since]');
  await page.waitForTimeout(1600);
  check(/^00:01:\d\d$/.test(since1) && since1 !== await page.textContent('[data-live-channel="24"] [data-since]'), `sloty: licznik sygnału studia tyka (${since1})`);
  await page.waitForSelector('#st-studio:has-text("studio na antenie: 24")');
  check(true, 'pasek górny: studio na antenie');
  // nazwa stanowiska w dzienniku CG (X-Operator, polskie litery)
  await page.click('#st-operator');
  await page.fill('#op-name', 'MCR Łódź');
  await page.click('#dlg-buttons button:has-text("Zapisz")');
  await page.click('button:has-text("■ ZDEJMIJ")');
  await page.waitForSelector('button:has-text("■ POTWIERDŹ ZDJĘCIE")');
  check(CG.hold === false, 'sloty: pierwsze kliknięcie ZDEJMIJ tylko uzbraja');
  await rerender(() => page.click('button:has-text("■ POTWIERDŹ ZDJĘCIE")'));
  await page.waitForSelector('button:has-text("▶ WPUŚĆ")');
  check(CG.hold === true && /WSTRZYMANY/.test(await page.textContent('main')), 'sloty: ZDEJMIJ (dwa kliknięcia) wstrzymuje studio w CG Playout');
  check(CG.operators.includes('VizRS Live · MCR Łódź'), `sloty: nazwa stanowiska trafia do CG Playout (${CG.operators.slice(-1)})`);
  await rerender(() => page.click('button:has-text("▶ WPUŚĆ")'));
  check(CG.hold === false, 'sloty: WPUŚĆ');
  await rerender(() => page.click('input[aria-label="Studio poza audycjami 24"]'));
  check(CG.anytime === false, 'sloty: „poza audycjami” zapisane w CG Playout');
  await rerender(() => page.click('input[aria-label="Studio poza audycjami 24"]'));
  await shot('r12-sloty');
  // Audycje LIVE: nowa audycja – najpierw błąd walidacji CG wraca do operatora, potem poprawna z kreatorem
  await page.goto(`${BASE}/#audycje`);
  await page.waitForSelector('main[data-view="audycje"]');
  check(/Poranek na żywo/.test(await page.textContent('main')), 'audycje: audycja LIVE na liście');
  check(/nie ma w ramówce/.test(await page.textContent('main')), 'audycje: brak w ramówce z „jak dodać?”');
  await page.selectOption('select[aria-label="Biblioteka audycji LIVE"]', { label: 'Remote Streams (ID 7)' });
  await rerender(() => page.click('button:has-text("Zapisz bibliotekę")'));
  check(CG.library === 7, 'audycje: biblioteka Remote Streams z legacy zapisana w CG Playout');
  await page.click('button:has-text("+ Nowa audycja LIVE")');
  await page.fill('#ls-title', '***');
  await rerender(() => page.click('#dlg-buttons button:has-text("Utwórz w ErsatzTV")'));
  check(/tytuł/.test(await page.textContent('#toast')) && (await page.getAttribute('#toast', 'class')).includes('bad'), 'sloty: błąd walidacji CG Playout pokazany operatorowi');
  await page.click('button:has-text("+ Nowa audycja LIVE")');
  await page.fill('#ls-title', 'Debata E2E');
  await page.fill('#ls-duration', '00:30:00');
  await page.click('#dlg-buttons button:has-text("Utwórz w ErsatzTV")');
  await page.waitForSelector('#overlay:not([hidden]) [data-wizard]');
  check(/Audycja zapisana/.test(await page.textContent('[data-wizard]')) && /LIVE · Debata E2E/.test(await page.textContent('[data-wizard]')), 'audycje: kreator – kroki CG i pozycja w Harmonogramach');
  await shot('r12-kreator');
  await page.click('#dlg-buttons button:has-text("Gotowe")');
  await page.waitForSelector('td:has-text("Debata E2E")');
  check(CG.shows.some((x) => x.title === 'Debata E2E' && x.duration === '00:30:00' && x.channel === '24'), 'sloty: audycja LIVE założona w CG Playout');
  await shot('r12-audycje');
  await page.click('tr:has(td:has-text("Debata E2E")) button:has-text("🗑")');
  await rerender(() => page.click('#dlg-buttons button:has-text("Usuń")'));
  check(!CG.shows.some((x) => x.title === 'Debata E2E'), 'sloty: audycja LIVE usunięta (z potwierdzeniem)');
  check(cgSeen.length > 0 && cgSeen.every((x) => x.endsWith('token')), 'CG Playout: każde żądanie z tokenem z serwera panelu, bez Origin przeglądarki');
  check(!(await page.content()).includes(CG_TOKEN), 'CG Playout: token nie trafia do przeglądarki');
  const cgBad = (await fetch(`${BASE}/api/cg/live/settings`, { method: 'DELETE', headers: { 'X-VizRS-Live': '1' }, body: '{}' })).status;
  check(cgBad === 404, 'CG Playout: adres spoza białej listy odrzucony (404)');
  await tab('antena');

  // ---------- R10: web GUI legacy zamknięte (proxy na 18410 – tests/stack.sh), lista pokrycia ----------
  const st10 = (await (await fetch(`${BASE}/api/status`)).json()).result;
  const exp = (await (await fetch(`${BASE}/api/exposure`)).json()).result;
  const code = (p) => exp.probes.find((x) => x.path === p)?.status;
  check(/:18410$/.test(st10.streamUrl), `widzowie dostają adres proxy (${st10.streamUrl})`);
  check(code('/') === 403 && code('/channels') === 403 && code('/vizrs-bridge/health') === 403, `proxy: web GUI legacy i most zamknięte (${JSON.stringify(exp.probes)})`);
  check(code('/iptv/channels.m3u') === 200, 'proxy: M3U dostępne dla widzów');
  const viaProxy = await fetch(`${st10.streamUrl}/iptv/xmltv.xml`);
  check(viaProxy.status === 200 && /<tv/.test(await viaProxy.text()), 'proxy: XMLTV przez proxy');
  await tab('diagnostyka');
  await page.waitForSelector('#exp-verdict .pill');
  check(await page.$('#exp-verdict .pill.ok') !== null, 'diagnostyka: web GUI legacy oceniony jako zamknięty');
  const cov = await page.$$eval('.panel:has(h2:text-is("Pokrycie web GUI legacy")) tbody tr', (rows) => rows.map((r) => ({
    link: r.querySelector('td:nth-child(2) a')?.getAttribute('href') || null, note: r.querySelector('td:nth-child(3)')?.textContent.trim() || '' })));
  check(cov.length >= 20 && cov.every((r) => r.link || /pominięte/.test(r.note)), `pokrycie: każdy ekran legacy ma odpowiednik albo uzasadnione pominięcie (${cov.length})`);
  const navViews = await page.$$eval('nav a[href^="#"]', (as) => as.map((a) => a.getAttribute('href')));
  check(cov.every((r) => !r.link || navViews.includes(r.link)), 'pokrycie: odnośniki prowadzą do ekranów z menu panelu');
  await shot('r10-diagnostyka');
  await rerender(() => page.click('.panel:has(h2:text-is("Pokrycie web GUI legacy")) a[href="#harmonogramy"]'));
  check(await page.$('main[data-view="harmonogramy"]') !== null, 'pokrycie: przejście do ekranu panelu');


  // ---------- Podgląd strumienia kanału (player.js + mux.js, pośrednik /api/stream/…) ----------
  // Prawdziwy strumień legacy (silnik Next) kanału 24 z seed: MSE w Chromium, obraz równany do zegara anteny.
  {
    const master = await fetch(`${BASE}/api/stream/24.m3u8`);
    const mtext = await master.text();
    check(master.ok && /^\/api\/stream\/session\/24\/[^\s]+\.m3u8$/m.test(mtext) && !/http:\/\//.test(mtext) && Number(master.headers.get('x-vizrs-now')) > 0,
      'podgląd: playlista kanału przez panel, adresy sesji przepisane na /api/stream, zegar serwera');
    check((await fetch(`${BASE}/api/stream/session/24/..%2F..%2Fetc.ts`)).status === 404 && (await fetch(`${BASE}/api/stream/24.ts`)).status === 404,
      'podgląd: pośrednik przepuszcza tylko HLS kanału (biała lista)');
    await tab('antena');
    await page.click('.panel:has(h2:text-is("24 · INFO24")) button:has-text("Podgląd")');
    await page.waitForSelector('#monitor:not([hidden])');
    const playing = await page.waitForFunction(() => {
      const v = document.querySelector('#mon-video');
      return v.currentTime > 0 && !v.paused && v.videoWidth > 0 && document.querySelector('#mon-state').textContent === 'NA ŻYWO';
    }, null, { timeout: 40000 }).then(() => true, () => false);
    check(playing, `podgląd: kanał 24 gra w panelu (${await page.textContent('#mon-state')} · ${await page.textContent('#mon-info')})`);
    check(await page.inputValue('#mon-ch') === '24', 'podgląd: wybrany kanał z karty Na antenie');
    const t1 = await page.evaluate(() => document.querySelector('#mon-video').currentTime);
    await tab('kanaly');
    await page.waitForTimeout(5000);
    const st = await page.evaluate(() => {
      const v = document.querySelector('#mon-video');
      return { t: v.currentTime, w: v.videoWidth, h: v.videoHeight, dropped: v.getVideoPlaybackQuality().droppedVideoFrames, info: document.querySelector('#mon-info').textContent };
    });
    check(st.t - t1 > 4 && st.w === 1920 && st.h === 1080, `podgląd: gra dalej po zmianie ekranu, przez granice segmentów (${(st.t - t1).toFixed(1)} s, ${st.w}×${st.h}, zgubione klatki: ${st.dropped})`);
    check(/zgodnie z zegarem anteny|opóźnienie 0\.\d s/.test(st.info) && /H\.264 · AAC/.test(st.info), `podgląd: obraz równo z zegarem anteny, H.264 i AAC (${st.info})`);
    await shot('podglad');
    await page.click('#mon-close');
    check(await page.evaluate(() => document.querySelector('#monitor').hidden && !document.querySelector('#mon-video').getAttribute('src')), 'podgląd: zamknięcie odłącza strumień');
  }

  // ---------- R11: wydanie 1.0 – przegląd bezpieczeństwa (osobny panel z tokenem na 18091) ----------
  check(st10.panel === '1.2.6' && st10.bridge?.result?.bridge === '1.2.6', `wersja 1.2.6: panel ${st10.panel}, most ${st10.bridge?.result?.bridge}`);
  const SEC = 'http://127.0.0.1:18091', PTOK = 'e2e-panel-token-0123456789';
  const secProc = require('child_process').spawn(path.join(__dirname, '..', 'server', 'target', 'release', 'vizrs-live'),
    ['--port', '18091', '--bridge', 'http://127.0.0.1:18409', '--bridge-token', 'test-token-0123456789', '--token', PTOK], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`${SEC}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
    const root = await fetch(`${SEC}/`);
    const csp = root.headers.get('content-security-policy') || '';
    check(/script-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp) && root.headers.get('x-frame-options') === 'DENY',
      'bezpieczeństwo: CSP bez inline, bez ramek i obiektów; X-Frame-Options');
    const apiCsp = (await fetch(`${SEC}/api/status`)).headers.get('content-security-policy');
    check(!!apiCsp, 'bezpieczeństwo: CSP także w odpowiedziach API');
    check((await fetch(`${SEC}/api/status`)).status === 401, 'bezpieczeństwo: API bez logowania = 401');
    check((await fetch(`${SEC}/api/stream/24.m3u8`)).status === 401, 'bezpieczeństwo: podgląd strumienia bez logowania = 401');
    check((await fetch(`${SEC}/api/login`, { method: 'POST', body: PTOK })).status === 403, 'bezpieczeństwo: POST bez X-VizRS-Live (CSRF) = 403');
    check((await fetch(`${SEC}/api/cmd/GetAllChannels`, { method: 'POST', headers: { 'X-VizRS-Live': '1', Origin: 'http://zla.strona' }, body: '{}' })).status === 401,
      'bezpieczeństwo: komenda bez sesji odrzucona');
    // logowanie w UI: zły token, potem dobry
    const sp = await browser.newPage();
    await sp.goto(`${SEC}/#antena`);
    await sp.waitForSelector('#login-token');
    await shot('r11-logowanie', sp);
    await sp.fill('#login-token', 'zly-token-0123456789');
    await sp.click('#dlg-buttons button:has-text("Zaloguj")');
    await sp.waitForSelector('#toast.bad');
    check(/zły token/.test(await sp.textContent('#toast')), 'logowanie: zły token – komunikat');
    await sp.waitForSelector('#login-token');
    await sp.fill('#login-token', PTOK);
    await sp.click('#dlg-buttons button:has-text("Zaloguj")');
    await sp.waitForSelector('main[data-view="antena"] .head h1');
    const ck = (await sp.context().cookies(SEC)).find((c) => c.name === 'vizrs_live');
    check(ck && ck.httpOnly && ck.sameSite === 'Strict', 'logowanie: ciasteczko HttpOnly, SameSite=Strict');
    await sp.close();
    // limit nieudanych logowań (10 na minutę, wspólny)
    const tries = await Promise.all(Array.from({ length: 10 }, () => fetch(`${SEC}/api/login`, { method: 'POST', headers: { 'X-VizRS-Live': '1' }, body: 'zle' }).then((r) => r.status)));
    const after = (await fetch(`${SEC}/api/login`, { method: 'POST', headers: { 'X-VizRS-Live': '1' }, body: PTOK })).status;
    check(tries.filter((x) => x === 401).length >= 9 && after === 429, `logowanie: po 10 nieudanych próbach 429 nawet dla dobrego tokenu (${after})`);
  } finally { secProc.kill(); }

  cgServer.close(); // dopiero na końcu: pasek górny co 5 s pyta CG Playout o studio na antenie
  check(errors.length === 0, 'brak błędów JS' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failed ? `\n${failed} błędów` : '\nwszystko zielone');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
