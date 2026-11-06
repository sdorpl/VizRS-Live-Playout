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

  const views = ['antena', 'epg', 'kanaly', 'profile', 'znaki', 'media', 'kolekcje', 'playlisty', 'wypelniacze',
    'harmonogramy', 'bloki', 'deco', 'playouty', 'grafika', 'live', 'ustawienia', 'diagnostyka'];
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
  const miss = await page.textContent('.picker .missing');
  check(/SearchRerunCollections/.test(miss) && /białej liście/.test(miss), 'wybór treści: brakująca komenda opisana (SearchRerunCollections)');
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
  for (let i = 0; i < 15 && !onAir; i++) {
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

  check(errors.length === 0, 'brak błędów JS' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failed ? `\n${failed} błędów` : '\nwszystko zielone');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
