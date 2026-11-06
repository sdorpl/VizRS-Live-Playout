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

  // playout: przebudowa przez kolejkę legacy
  await page.goto(`${BASE}/#playouty`);
  await page.waitForSelector('main[data-view="playouty"]');
  const hasPlayout = await page.$('button:has-text("Przebuduj")');
  if (hasPlayout) {
    await hasPlayout.click();
    await page.waitForSelector('#toast.ok');
    check(true, 'przebudowa playoutu zlecona');
  } else {
    console.log('pomijam przebudowę: brak playoutu');
  }

  check(errors.length === 0, 'brak błędów JS' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failed ? `\n${failed} błędów` : '\nwszystko zielone');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
