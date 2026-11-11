#!/usr/bin/env node
/**
 * Headless verification of the bench console.
 * Uses the playwright already cached in ~/.npm/_npx (no download needed).
 */
import { chromium } from '/home/lijing/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
import { mkdirSync } from 'fs';

const BASE = process.env.BASE_URL || 'http://localhost:3200';
const OUT = process.env.SHOT_DIR || 'shots';
mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// 1. Nav
check('nav brand', await page.locator('.brand-name').innerText() === 'Arch/Dx Bench');
check('nav tabs', (await page.locator('.nav-item').count()) === 2);
// Exactly one view switcher: the redundant in-page segmented control is gone.
check('single view switcher (no seg-view)', (await page.locator('#seg-view').count()) === 0);

// 2. Run bar buttons
for (const sel of ['#btn-setup', '#btn-arena', '#btn-run', '#btn-grade', '#btn-rank', '#btn-kill']) {
  check(`button ${sel}`, (await page.locator(sel).count()) === 1);
}

// 3. Main table rows
const rowCount = await page.locator('#main-table tbody tr').count();
check('pack table rows = 6', rowCount === 6, `got ${rowCount}`);

// 4. Column headers
const headers = await page.locator('#main-table thead th').allInnerTexts();
const hs = headers.map(h => h.replace(/[▲▼]/g, '').trim().toLowerCase());
check('has Rank Spread', hs.some(h => h.includes('rank spread')), hs.join('|'));
check('has Rating', hs.some(h => h.includes('rating')));
check('has 95% CI', hs.some(h => h.includes('95% ci')));
check('has Win Rate', hs.some(h => h.includes('win rate')));

// 5. First row content
const firstRow = await page.locator('#main-table tbody tr').first().innerText();
check('first row = mine', firstRow.includes('mine'), firstRow.replace(/\n/g, ' | '));

// 6. Sorting by Rating — first click must put the highest rating first
await page.locator('#main-table thead button', { hasText: 'Rating' }).click();
await page.waitForTimeout(300);
const afterSort = await page.locator('#main-table tbody tr').first().innerText();
check('sort by Rating descending', afterSort.includes('mine') && afterSort.includes('+648'), afterSort.replace(/\n/g, ' | '));
// second click flips to ascending
await page.locator('#main-table thead button', { hasText: 'Rating' }).click();
await page.waitForTimeout(300);
const afterSort2 = await page.locator('#main-table tbody tr').first().innerText();
check('sort by Rating flips ascending', afterSort2.includes('baseline'), afterSort2.replace(/\n/g, ' | '));
// back to descending for the rest of the checks
await page.locator('#main-table thead button', { hasText: 'Rating' }).click();
await page.waitForTimeout(300);

// 7. Column picker
await page.locator('#btn-cols').click();
await page.waitForTimeout(200);
const colMenuVisible = await page.locator('#col-menu').isVisible();
check('column menu opens', colMenuVisible);
await page.screenshot({ path: `${OUT}/cols-menu.png` });
const colItems = await page.locator('#col-menu .col-item').count();
check('column menu lists columns', colItems >= 8, `${colItems} items`);
// hide "Avg Tokens"
await page.locator('#col-menu .col-item', { hasText: 'Avg Tokens' }).click();
await page.waitForTimeout(250);
const headersAfter = await page.locator('#main-table thead th').allInnerTexts();
check('hide column works', !headersAfter.some(h => h.includes('Avg Tokens')));
// restore
await page.locator('#col-menu .col-item', { hasText: 'Avg Tokens' }).click();
await page.waitForTimeout(200);
await page.keyboard.press('Escape');
await page.mouse.click(800, 60);
await page.waitForTimeout(200);

// 8. Search
await page.locator('#search').fill('mine');
await page.waitForTimeout(300);
const searchRows = await page.locator('#main-table tbody tr').count();
check('search filters to 1', searchRows === 1, `got ${searchRows}`);
await page.locator('#search').fill('');
await page.waitForTimeout(250);

// 9. Filters sidebar — pack-dimension sections visible in pack mode
const visibleFsecs = async () =>
  await page.locator('.filters .fsec:not(.hidden)').count();
check('filter sections in pack mode = 4', (await visibleFsecs()) === 4, `got ${await visibleFsecs()}`);
await page.locator('#filter-packs .cat', { hasText: 'superpowers' }).click();
await page.waitForTimeout(300);
const filteredRows = await page.locator('#main-table tbody tr').count();
check('pack filter works', filteredRows === 1, `got ${filteredRows}`);
await page.locator('#filter-packs .cat', { hasText: 'superpowers' }).click();
await page.waitForTimeout(250);

// 10. Per-case matrix
const matrixRows = await page.locator('#matrix-table tbody tr').count();
const matrixCols = await page.locator('#matrix-table thead th').count();
check('matrix 6 rows × 6 cols', matrixRows === 6 && matrixCols === 6, `${matrixRows}×${matrixCols}`);

// 11. Methodology note
const note = (await page.locator('#method-note').innerText()).toLowerCase();
check('methodology note', note.includes('bradley-terry') && note.includes('rank spread'), note.slice(0, 60));

// 12. Screenshot packs view
const packViewMeta = await page.locator('#view-meta').innerText();
check('pack view names the arena board of the measured model',
  /Model tier\s+.+?\s+\((?:LMArena · HF dataset|arena\.ai)\s+\S+\s+#\d+ — /.test(packViewMeta),
  packViewMeta.replace(/\n/g, ' '));
await page.screenshot({ path: `${OUT}/packs.png`, fullPage: true });

// 13. Model Landscape view — should land on the board the bench ran against
await page.locator('.nav-item', { hasText: 'Model Landscape' }).click();
await page.waitForTimeout(900);

// The arena catalogue is the authority for what the view should show: every
// count below is derived from the data the console actually serves, so a
// richer snapshot set can never silently invalidate a hard-coded expectation.
//
// The catalogue is served without model rows (seventy boards, hundreds of rows
// each), and a board is fetched when it is opened. The verification therefore
// asks the catalogue for the board tree and fetches the handful of boards it
// inspects.
const api = await page.evaluate(async () => {
  const [catalog, results] = await Promise.all([
    fetch('/api/arena?catalog=1').then(r => r.json()),
    fetch('/api/results').then(r => r.json()),
  ]);
  return { catalog, results };
});
const boardMeta = api.catalog.catalog ?? {};
const boardSlugs = Object.keys(boardMeta);
const ref = api.results.arena_reference;
const alt = api.results.arena_alternate;
const benchBoard = ref?.arena;

// The board the bench ran against, with its snapshots.
const loadBoard = async (slug) => {
  const r = await page.evaluate(async (s) => {
    const res = await fetch(`/api/arena?board=${encodeURIComponent(s)}`);
    return res.json();
  }, slug);
  return r.snapshots ?? [];
};
const benchSnaps = benchBoard ? await loadBoard(benchBoard) : [];
const benchSnap = benchSnaps.find(s => s.meta.data_date === (ref?.arena_date ?? ref?.data_date)) ?? benchSnaps[0];
const totalSnaps = Object.values(boardMeta).reduce((n, m) => n + (m.dates?.length ?? 0), 0);

check('arena catalogue holds every arena board', boardSlugs.length >= 70, `${boardSlugs.length} boards`);
check('arena catalogue keeps a real snapshot history', totalSnaps >= 400, `${totalSnaps} snapshots`);
check('the catalogue nests boards under a category',
  boardSlugs.some(s => boardMeta[s].level === 'main') && boardSlugs.some(s => boardMeta[s].level === 'sub'),
  `${boardSlugs.filter(s => boardMeta[s].level === 'main').length} main / ${boardSlugs.filter(s => boardMeta[s].level === 'sub').length} sub`);
check('every sub board names its parent',
  boardSlugs.filter(s => boardMeta[s].level === 'sub').every(s => !!boardMeta[s].parent),
  `${boardSlugs.filter(s => boardMeta[s].level === 'sub' && !boardMeta[s].parent).length} orphans`);
check('cross-reference names an arena board', !!benchBoard, String(benchBoard));
check('cross-reference carries a second anchor', !!alt, alt ? `${alt.arena} ${alt.data_date} ${alt.model}` : 'none');
check('cross-reference names the board by title', !!ref?.arena_title, String(ref?.arena_title));

// 13a. Category + board + snapshot pickers (arena.ai's three-level tree)
check('board picker visible', await page.locator('#board-select').isVisible());
check('category picker visible', await page.locator('#board-group').isVisible());
const groupOpts = await page.locator('#board-group option').allInnerTexts();
const groups = [...new Set(boardSlugs.map(s => boardMeta[s].group))];
check('category picker lists every category', groupOpts.length === groups.length, groupOpts.join(' | '));

// The board picker shows the boards of the category that is open, so the
// expected count comes from the catalogue, not from a hard-coded number.
const curGroup = boardMeta[benchBoard]?.group;
const boardsInGroup = boardSlugs.filter(s => boardMeta[s].group === curGroup);
const boardOpts = await page.locator('#board-select option').allInnerTexts();
check('board picker lists every board of the open category',
  boardOpts.length === boardsInGroup.length, `${boardOpts.length} vs ${boardsInGroup.length}`);
check('board picker shows model counts', boardOpts.every(o => /\d+ models/.test(o)), boardOpts[0]);
// A headline board that carries category boards is an optgroup of its own.
const optgroups = await page.locator('#board-select optgroup').allInnerTexts();
check('nested boards are grouped under their headline board', optgroups.length > 0, optgroups.join(' | '));

const metaText = await page.locator('#view-meta').innerText();
check('entering model view lands on the bench board', metaText.includes(benchBoard), metaText.replace(/\n/g, ' '));
check('meta names benchmark model', metaText.includes('Benchmark model'), metaText.replace(/\n/g, ' '));
check('meta discloses the second arena anchor', !!alt && metaText.includes(alt.model), metaText.replace(/\n/g, ' '));

// 13a1. The breadcrumb states where the board sits in the tree
const crumb = await page.locator('#view-crumb').innerText();
check('the breadcrumb names the board path',
  crumb.includes(boardMeta[benchBoard]?.title ?? '') && crumb.includes('LMArena'),
  crumb.replace(/\n/g, ' '));


// The arena data comes from a third-party crawl that can stop, so the header
// has to say how old the freshest snapshot is instead of passing a stale date
// off as live data.
const newestAny = Object.values(boardMeta).flatMap(m => m.dates ?? [])
  .reduce((m, d) => (d > m ? d : m), '');
const ageDays = Math.floor((Date.now() - Date.parse(newestAny + 'T00:00:00Z')) / 86400000);
if (ageDays >= 2) {
  check('the header states how old the freshest snapshot is',
    metaText.includes(newestAny) && new RegExp(ageDays + ' days? old').test(metaText),
    `newest ${newestAny} (${ageDays}d) · ${metaText.replace(/\n/g, ' ').slice(0, 180)}`);
} else {
  check('the header states how old the freshest snapshot is', true, `newest ${newestAny} is current`);
}
const matrixH = (await page.locator('#matrix-h').innerText()).toLowerCase();
check('model view ties the pack matrix to the measured model',
  matrixH.includes(String(api.results.model ?? '').toLowerCase()), matrixH);

const modelRows = await page.locator('#main-table tbody tr').count();
check('bench board row count matches the catalogue', modelRows === benchSnap.models.length, `${modelRows} rows vs ${benchSnap.models.length}`);

const modelHeaders = await page.locator('#main-table thead th').allInnerTexts();
const mhs = modelHeaders.map(h => h.replace(/[▲▼]/g, '').trim().toLowerCase());
check('model table has Arena Score', mhs.some(h => h.includes('arena score')), mhs.join('|'));
check('model table has 95% CI', mhs.some(h => h.includes('95% ci')));
check('model table has Votes', mhs.some(h => h.includes('votes')));
check('model table has Rank Spread', mhs.some(h => h.includes('rank spread')), mhs.join('|'));

// 13b. Rank spread computed locally on the arena mirror
const spreadCells = await page.locator('#main-table tbody tr .spread').allInnerTexts();
check('model rank spread populated', spreadCells.length === modelRows && spreadCells.every(s => /^\d+·\d+$/.test(s.trim())), spreadCells.slice(0, 3).join(' '));

// 13b2. The benchmarked model is marked on the arena board
const benchMarks = await page.locator('#main-table .mark-bench').allInnerTexts();
check('benchmarked model marked', benchMarks.length === 1, benchMarks.join(','));

// 13b3. The confidence interval is printed as arena.ai prints it: the two
// halves of the interval, not a symmetric ± the source never publishes.
// Only the LMArena/HF family publishes both bounds, so this is checked on the
// board the bench ran against.
{
  const cells = await page.locator('#main-table tbody tr .ci-delta').allInnerTexts();
  check('the CI column prints the interval as two asymmetric halves',
    cells.length > 0 && cells.every(c => /\+\s*[\d.]+/.test(c) && /−\s*[\d.]+/.test(c)),
    cells.slice(0, 3).join(' | '));
  // The numbers come from the snapshot, not from a rounded constant.
  const top = benchSnap.models[0];
  const up = Math.round((top.score_upper - top.score) * 10) / 10;
  const dn = Math.round((top.score - top.score_lower) * 10) / 10;
  const head = await page.locator('#main-table tbody tr').first().innerText();
  check('the printed interval matches the published bounds',
    head.includes(`+${up}`) && head.includes(`−${dn}`), head.replace(/\n/g, ' | '));
  // The shot shows the interval column next to the board header.
  await page.locator('#main-table').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/arena-delta.png` });
}

// 13c. Filter sidebar switches to model-dimension sections
const modelFsecs = await visibleFsecs();
check('filter sections in model mode = 4', modelFsecs === 4, `got ${modelFsecs}`);
const vendorCats = await page.locator('#filter-vendor .cat').count();
check('vendor filter populated', vendorCats > 0, `${vendorCats} vendors`);
// 13d. Vendor filter actually filters
const anthropicExpected = benchSnap.models.filter(m => m.vendor === 'Anthropic').length;
await page.locator('#filter-vendor .cat', { hasText: 'Anthropic' }).click();
await page.waitForTimeout(300);
const anthropicRows = await page.locator('#main-table tbody tr').count();
check('vendor filter works', anthropicRows === anthropicExpected, `${anthropicRows} rows vs ${anthropicExpected}`);
await page.locator('#filter-vendor .cat', { hasText: 'Anthropic' }).click();
await page.waitForTimeout(250);

// 13d2. The benchmark footprint — where the measured model stands across the
// whole board tree. The server scans the newest snapshot of every board, so
// the row count is derived from the corpus, not hard-coded.
check('footprint card visible in the model view', await page.locator('#footprint-card').isVisible());
await page.waitForTimeout(1500);
const fpRows = await page.locator('#footprint-table tbody tr').count();
const fpSub = await page.locator('#footprint-sub').innerText();
check('footprint lists every board that ranks the model', fpRows >= 20, `${fpRows} boards · ${fpSub}`);
check('footprint names the model it scanned', fpSub.includes('claude-sonnet-4-20250514'), fpSub);
const fpCells = await page.locator('#footprint-table tbody tr td:nth-child(3)').allInnerTexts();
check('footprint states the rank on each board', fpCells.length === fpRows && fpCells.every(c => /^\d+$/.test(c.trim())), fpCells.slice(0, 3).join(' '));
// The footprint is a navigation: clicking a row opens that board.
const fpFirst = await page.locator('#footprint-table tbody tr').first().getAttribute('data-board');
await page.locator('#footprint-table tbody tr').first().click();
await page.waitForTimeout(900);
const fpMeta = await page.locator('#view-meta').innerText();
check('clicking a footprint row opens that board', fpMeta.includes(fpFirst), `${fpFirst} · ${fpMeta.replace(/\n/g, ' ').slice(0, 140)}`);
// …and the board picker followed it into the right category.
const fpGroup = boardMeta[fpFirst]?.group;
check('the board picker followed the footprint row into its category',
  (await page.locator('#board-group').inputValue()) === fpGroup,
  `${await page.locator('#board-group').inputValue()} vs ${fpGroup}`);
// Back to the bench board for the checks that follow.
await page.selectOption('#board-group', curGroup);
await page.waitForTimeout(500);
await page.selectOption('#board-select', benchBoard);
await page.waitForTimeout(800);

await page.screenshot({ path: `${OUT}/arena.png`, fullPage: true });

// 13e. Switch to the code board — the single-score (Elo) layout
const codeSnaps = await loadBoard('code');
const codeSnap = codeSnaps[0];
await page.selectOption('#board-group', 'arena.ai');
await page.waitForTimeout(500);
await page.selectOption('#board-select', 'code');
await page.waitForTimeout(900);
const codeRows = await page.locator('#main-table tbody tr').count();
check('code board loads', codeRows === codeSnap.models.length, `${codeRows} rows vs ${codeSnap.models.length}`);
check('snapshot picker visible for a multi-snapshot board', await page.locator('#snap-select').isVisible());
const codeMeta = await page.locator('#view-meta').innerText();
check('code board meta shows its data date', codeMeta.includes(codeSnap.meta.data_date), codeMeta.replace(/\n/g, ' '));
check('board switch resets the vendor filter', await page.locator('#filter-vendor .cat.on').count() === 0);
await page.locator('#main-table').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/arena-code.png` });

// 13e0a. The same interval rendering on a second family board, so the shot
// shows that the asymmetric form is not a one-board accident.
{
  const hfCode = boardSlugs.find(s => boardMeta[s].group === 'Code' && boardMeta[s].level === 'main');
  if (hfCode) {
    await page.selectOption('#board-group', 'Code');
    await page.waitForTimeout(500);
    await page.selectOption('#board-select', hfCode);
    await page.waitForTimeout(900);
    const cells = await page.locator('#main-table tbody tr .ci-delta').allInnerTexts();
    check('a second board prints the same asymmetric interval',
      cells.length > 0 && cells.every(c => /\+\s*[\d.]+/.test(c) && /−\s*[\d.]+/.test(c)),
      `${hfCode} · ${cells.slice(0, 2).join(' | ')}`);
    await page.locator('#main-table').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/arena-delta-code.png` });
    // Back to the arena.ai family for the movement-column check.
    await page.selectOption('#board-group', 'arena.ai');
    await page.waitForTimeout(500);
    await page.selectOption('#board-select', 'code');
    await page.waitForTimeout(800);
  }
}

// 13e0. The arena.ai family publishes a single symmetric interval, so the
// board falls back to the symmetric form instead of inventing asymmetry.
{
  const cells = await page.locator('#main-table tbody tr .ci').allInnerTexts();
  check('a board without published bounds keeps the symmetric interval',
    cells.length > 0 && cells.every(c => /^±\s*[\d.]+$/.test(c.trim())), cells.slice(0, 3).join(' | '));
}

// 13e1. Rank movement against the previous snapshot
// arena.ai shows how a model moved since the last update. The expected values
// are derived from the two snapshots the console actually serves.
{
  const list = codeSnaps;
  if (list.length >= 2) {
    const cur = list[0], prev = list[1];
    const before = new Map(prev.models.map(m => [m.id ?? m.model, m.rank]));
    const moved = cur.models
      .map(m => ({ id: m.id ?? m.model, d: before.has(m.id ?? m.model) ? before.get(m.id ?? m.model) - m.rank : undefined }))
      .filter(x => x.d !== undefined && x.d !== 0);
    const heads = await page.locator('#main-table thead th').allInnerTexts();
    const di = heads.findIndex(h => h.includes('Δ'));
    check('the movement column names the snapshot it is measured against',
      di >= 0 && heads[di].includes(prev.meta.data_date), heads.join('|'));
    if (moved.length) {
      const best = moved.sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
      const cell = await page.locator(`#main-table tbody tr[data-mid="${best.id}"] td:nth-child(${di + 1})`).innerText();
      check('the movement cell matches the previous snapshot',
        cell.includes(String(Math.abs(best.d))) && (best.d > 0 ? cell.includes('▲') : cell.includes('▼')),
        `${best.id} ${best.d > 0 ? '+' : ''}${best.d} → "${cell.trim()}"`);
    } else {
      check('the movement cell matches the previous snapshot', true, 'no model moved');
    }
  }
}

// 13e2. Model history — the trajectory across every snapshot of this board
check('history panel hidden before a model is picked', !(await page.locator('#history-card').isVisible()));
const histTarget = codeSnap.models.find(m => m.model === 'claude-opus-5-high') ?? codeSnap.models[0];
const histExpect = codeSnaps.filter(s => s.models.some(m => m.model === histTarget.model)).length;
const histRow = page.locator(`#main-table tbody tr[data-mid="${histTarget.id}"]`);
await histRow.locator('td').first().click();
await page.waitForTimeout(500);
check('history panel opens on row click', await page.locator('#history-card').isVisible());
check('the picked row is highlighted', await page.locator('#main-table tbody tr.sel').count() === 1);
const histRows = await page.locator('#history-table tbody tr').count();
check('history lists every snapshot the model appears in', histRows === histExpect, `${histRows} of ${histExpect} snapshots`);
const histPts = await page.locator('#history-chart polyline').getAttribute('points');
check('history chart plots the trajectory', !!histPts && histPts.split(' ').length === histExpect, `${histPts?.split(' ').length} points vs ${histExpect}`);
const histSub = await page.locator('#history-sub').innerText();
check('history header names the model and the range', histSub.includes(histTarget.model) && histSub.includes('snapshots'), histSub);
// The content pane scrolls internally, so bring the panel into view before the shot.
await page.locator('#history-card').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/model-history.png` });
// clicking the same row again closes the panel
await histRow.locator('td').first().click();
await page.waitForTimeout(300);
check('history panel closes on a second click', !(await page.locator('#history-card').isVisible()));

// 13f. The agent board — arena.ai scores it on several axes at once
const agentSnaps = await loadBoard('agent');
const agentSnap = agentSnaps[0];
await page.selectOption('#board-group', 'arena.ai');
await page.waitForTimeout(500);
await page.selectOption('#board-select', 'agent');
await page.waitForTimeout(900);
const agentRows = await page.locator('#main-table tbody tr').count();
check('agent board loads', agentRows === agentSnap.models.length, `${agentRows} rows vs ${agentSnap.models.length}`);
const agentHeaders = await page.locator('#main-table thead th').allInnerTexts();
const ahs = agentHeaders.map(h => h.replace(/[▲▼]/g, '').trim());
const AXES = ['net improvement', 'confirmed success', 'praise vs complaint',
              'steerability', 'bash recovery', 'tool hallucination'];
check('agent board has one column per axis',
  AXES.every(a => ahs.some(h => h.toLowerCase().startsWith(a))), ahs.join('|'));
check('an axis that tracks the ranking carries no marker',
  ahs.some(h => h.toLowerCase() === 'net improvement'), ahs.join('|'));
check('axes that do not track the ranking are marked ◇',
  ahs.filter(h => h.includes('◇')).length === 3, ahs.join('|'));
check('agent board replaces the Elo columns',
  !ahs.some(h => h.toLowerCase().includes('arena score')) && ahs.some(h => h.toLowerCase().includes('sessions')),
  ahs.join('|'));
const dimCells = await page.locator('#main-table tbody tr .dim').count();
check('dimension cells rendered with value + CI', dimCells === agentRows * 6, `${dimCells} cells`);
await page.screenshot({ path: `${OUT}/arena-agent.png`, fullPage: true });

// 13g. Snapshot switching — older snapshots of the same board stay reachable
const snapOpts = await page.locator('#snap-select option').allInnerTexts();
check('snapshot picker lists dated snapshots', snapOpts.length === agentSnaps.length, `${snapOpts.length} snapshots`);
const olderIdx = agentSnaps.length - 1;
const olderDate = agentSnaps[olderIdx].meta.data_date;
await page.selectOption('#snap-select', String(olderIdx));
await page.waitForTimeout(600);
const olderMeta = await page.locator('#view-meta').innerText();
check('snapshot switch changes the data date', olderMeta.includes(olderDate), olderMeta.replace(/\n/g, ' '));

// 13h. "Benchmark this model instead" — the arena board becomes a bench input
const origModel = (await page.evaluate(() => fetch('/api/config').then(r => r.json()))).model;
check('bench config exposes the current target', !!origModel, String(origModel));
// The board is still showing the snapshot switched to in 13g, so the expected
// button count comes from the rows that are on screen right now.
const agentRowsNow = await page.locator('#main-table tbody tr').count();
const pickCount = await page.locator('#main-table tbody tr .pick').count();
check('every row offers a benchmark-target button', pickCount === agentRowsNow, `${pickCount} buttons vs ${agentRowsNow} rows`);
const pickedId = await page.locator('#main-table tbody tr .pick').first().getAttribute('data-model');
await page.locator('#main-table tbody tr .pick').first().click();
await page.waitForTimeout(900);
const afterModel = (await page.evaluate(() => fetch('/api/config').then(r => r.json()))).model;
check('picking a model rewrites the bench target', afterModel === pickedId, `${pickedId} -> ${afterModel}`);
const targetBadges = await page.locator('#main-table .mark-target').count();
check('the chosen model is marked as the benchmark target', targetBadges === 1, `${targetBadges} badges`);

// 13i. The pack view now flags that the results no longer match the target
await page.locator('.nav-item', { hasText: 'Packs' }).click();
await page.waitForTimeout(700);
const packMeta = await page.locator('#view-meta').innerText();
check('pack view warns that the results are stale', packMeta.includes('re-run to measure'), packMeta.replace(/\n/g, ' '));
check('pack view discloses the second arena anchor', !!alt && packMeta.includes(alt.model), packMeta.replace(/\n/g, ' '));
await page.screenshot({ path: `${OUT}/packs-stale.png`, fullPage: true });

// 13j. Restore the original target so the project is left exactly as found
await page.evaluate(async (m) => {
  await fetch('/api/benchmark-model', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: m }),
  });
}, origModel);
await page.waitForTimeout(400);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
const restored = (await page.evaluate(() => fetch('/api/config').then(r => r.json()))).model;
check('bench target restored', restored === origModel, `${restored}`);
const restoredMeta = await page.locator('#view-meta').innerText();
check('no stale warning after restore', !restoredMeta.includes('re-run to measure'), restoredMeta.replace(/\n/g, ' '));

// 14. Model search
await page.locator('.nav-item', { hasText: 'Model Landscape' }).click();
await page.waitForTimeout(800);
check('model view still lands on the bench board', (await page.locator('#view-meta').innerText()).includes(benchBoard));
await page.locator('#search').fill('claude');
await page.waitForTimeout(400);
const claudeRows = await page.locator('#main-table tbody tr').count();
check('model search filters', claudeRows > 0 && claudeRows < modelRows, `${claudeRows} of ${modelRows} rows`);
await page.locator('#search').fill('');
await page.waitForTimeout(250);

// 14b. The second anchor lives on its own board and its own snapshot
if (alt) {
  const altSnaps = await loadBoard(alt.arena);
  const altIdx = altSnaps.findIndex(s => s.meta.data_date === (alt.arena_date ?? alt.data_date));
  // The board may live in another category, so the category comes first.
  const altGroup = boardMeta[alt.arena]?.group;
  if (altGroup && altGroup !== curGroup) {
    await page.selectOption('#board-group', altGroup);
    await page.waitForTimeout(500);
  }
  await page.selectOption('#board-select', alt.arena);
  await page.waitForTimeout(800);
  // A board with a single snapshot has no snapshot picker — the console hides
  // it rather than offering a choice that does not exist.
  if (altIdx > 0 && await page.locator('#snap-select').isVisible()) {
    await page.selectOption('#snap-select', String(altIdx));
    await page.waitForTimeout(700);
  }
  const altMarks = await page.locator('#main-table .mark-bench').allInnerTexts();
  // The second anchor is either the benchmarked model itself (exact) or its
  // closest relative (family); the badge says which one it is.
  const altExpect = alt.match === 'exact' ? /benchmarked/ : /same-family ref/;
  check('the second anchor is marked on its own board',
    altMarks.length === 1 && altExpect.test(altMarks[0]),
    `${alt.match} · ${altMarks.join(',')}`);
  const altMeta = await page.locator('#view-meta').innerText();
  check('the view discloses both anchors at once', altMeta.includes(ref.model) && altMeta.includes(alt.model), altMeta.replace(/\n/g, ' '));
  // Bring the marked row into view so the shot shows the badge, not the top.
  await page.locator('#main-table .mark-bench').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/arena-alt-anchor.png` });
}

// 14c. A snapshot without scores must not invent zeros
// Older agent-board snapshots list models that arena.ai had not scored yet.
// A zero would claim a bottom rank the source never made, so those rows have
// to show a dash — and the header has to say so.
{
  const unscoredIdx = agentSnaps.findIndex(s =>
    s.models.length > 0 && s.models.every(m => m.score === undefined && !(m.dimensions?.length)));
  if (unscoredIdx >= 0) {
    await page.selectOption('#board-group', 'arena.ai');
    await page.waitForTimeout(400);
    await page.selectOption('#board-select', 'agent');
    await page.waitForTimeout(700);
    await page.selectOption('#snap-select', String(unscoredIdx));
    await page.waitForTimeout(700);
    const cols = await page.locator('#main-table thead th').allInnerTexts();
    const si = cols.findIndex(h => /arena score/i.test(h));
    const cells = si >= 0
      ? await page.locator(`#main-table tbody tr td:nth-child(${si + 1})`).allInnerTexts()
      : [];
    check('an unscored snapshot shows a dash instead of a zero score',
      cells.length > 0 && cells.every(c => c.trim() === '—'),
      `${agentSnaps[unscoredIdx].meta.data_date}: ${cells.slice(0, 4).join(' ')}`);
    const um = await page.locator('#view-meta').innerText();
    check('the header flags a snapshot without scores', um.includes('without a score'), um.replace(/\n/g, ' ').slice(0, 180));
    await page.screenshot({ path: `${OUT}/arena-unscored.png` });
  } else {
    check('an unscored snapshot shows a dash instead of a zero score', false, 'no unscored agent snapshot in the catalogue');
  }
}

// 15. The log drawer — the console's narration of what it is doing. The
// drawer is opened and closed here rather than by triggering a live fetch:
// a fetch rewrites the corpus, and the verification must not change the data
// it is verifying.
check('the log drawer is collapsed by default', !(await page.locator('#log-stream').isVisible()));
await page.locator('#btn-log-toggle').click();
await page.waitForTimeout(300);
check('the log drawer opens on demand', await page.locator('#log-stream').isVisible());
await page.keyboard.press('Escape');
await page.locator('#btn-log-toggle').click();
await page.waitForTimeout(300);

// 16. Back to packs, console errors
await page.locator('.nav-item', { hasText: 'Packs' }).click();
await page.waitForTimeout(400);
check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' ; '));

await browser.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFAILED:');
  failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`));
  process.exit(1);
}
