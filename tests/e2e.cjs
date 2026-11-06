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

  const views = ['antena', 'epg', 'kanaly', 'profile', 'znaki', 'media', 'przegladarka', 'kosz', 'kolekcje', 'playlisty', 'wypelniacze',
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
  check(rows.length === 2 && /dynamicznie \| wyszukiwanie: Wszystko \| kilka \(2\)/.test(rows[0]) && /06:00 \| kolekcja inteligentna: Archiwum INFO24 \| wypełnij/.test(rows[1]),
    `harmonogram: założony z pozycjami w nowej kolejności (${rows.join(' / ')})`);
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
  await page.setInputFiles('#f-image', { name: 'logo.png', mimeType: 'image/png', buffer: PNG });
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
  const shot = (n) => (process.env.E2E_SHOTS ? page.screenshot({ path: `${process.env.E2E_SHOTS}/${n}.png`, fullPage: true }) : null);
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
  check(!(await page.$(`td:text-is("${decoName}")`)), 'deco usunięte');
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
  await tab('ustawienia', 'Przewodnik XMLTV');
  const xmlDays = Number(await page.inputValue('#s-xmltv-DaysToBuild'));
  await page.fill('#s-xmltv-DaysToBuild', '0');
  await page.click('.panel header button:has-text("Zapisz")');
  await page.waitForSelector('#toast.bad');
  check(/co najmniej 1/.test(await page.textContent('#toast')), 'ustawienia: 0 dni XMLTV odrzucone przez panel (legacy tego nie sprawdza)');
  const poDays = (await api('GetPlayoutSettings')).result.DaysToBuild;
  await page.fill('#s-xmltv-DaysToBuild', String(poDays + 1));
  await page.click('.panel header button:has-text("Zapisz")');
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
    await rerender(() => page.click(`.page-tabs button:has-text("${t}")`));
    check(!!(await page.inputValue(id)), `ustawienia: sekcja „${t}” wczytana z legacy`);
  }

  // logi: poziom Debug z panelu → „Zwolnij pamięć” (Diagnostyka) → wpis w Logach
  const logStart = Date.now() - 2000;
  await tab('ustawienia', 'Poziomy logów');
  await page.selectOption('#s-logi-DefaultMinimumLogLevel', 'Debug');
  await saveSettings('Poziomy logów');
  check((await api('GetLoggingSettings')).result.DefaultMinimumLogLevel === 'Debug', 'ustawienia: domyślny poziom logów = Debug');
  await tab('diagnostyka');
  check(/v\d+\./.test(await page.textContent('.panel:has(h2:text-is("Wersje i sprzęt"))')), 'diagnostyka: wersja legacy i sprzęt');
  const hls = await page.getAttribute('#pt-hls', 'href');
  check(/\/iptv\/channel\/[^/]+\.m3u8$/.test(hls || ''), `test odtwarzania: odnośnik do strumienia (${hls})`);
  await page.click('#maint button:has-text("Zwolnij pamięć")');
  await page.click('#dlg-buttons button:has-text("Zwolnij pamięć")');
  await page.waitForSelector('#toast.ok');
  check(/w tle/.test(await page.textContent('#toast')), 'konserwacja: zadanie zlecone w tle legacy');
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
  await tab('ustawienia', 'Poziomy logów');
  await page.selectOption('#s-logi-DefaultMinimumLogLevel', 'Information');
  await saveSettings('Poziomy logów');
  check((await api('GetLoggingSettings')).result.DefaultMinimumLogLevel === 'Information', 'ustawienia: poziom logów przywrócony');

  check(errors.length === 0, 'brak błędów JS' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failed ? `\n${failed} błędów` : '\nwszystko zielone');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
