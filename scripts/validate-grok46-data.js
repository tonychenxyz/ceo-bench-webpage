#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODEL_ID = 'grok-4.6';
const MODEL_DISPLAY = 'Grok 4.6';
const RUN_IDS = ['c0c3c96b', '92baff83', 'bd13680c'];
const EXPECTED = {
  c0c3c96b: {bankrupt: false, day: 500, cash: 246418.91, raw: 246418.91, actions: 2332, days: 77, subscribers: 6758, reasoning: 1054},
  '92baff83': {bankrupt: true, day: 283, cash: 0, raw: -683, actions: 2116, days: 45, subscribers: 6822, reasoning: 885},
  bd13680c: {bankrupt: false, day: 500, cash: 60489.48, raw: 60489.48, actions: 2560, days: 73, subscribers: 12552, reasoning: 1050},
};

function fail(message) {
  throw new Error(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function readAssignment(relativePath, prefix) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8').trim();
  check(source.startsWith(prefix) && source.endsWith(';'), `${relativePath}: invalid wrapper`);
  return JSON.parse(source.slice(prefix.length, -1));
}

function equalMoney(actual, expected) {
  return Math.abs(Number(actual) - expected) < 0.005;
}

function assertPlot(points, bankrupt, label) {
  check(Array.isArray(points) && points.length >= 2, `${label}: missing points`);
  check(Number(points[0][0]) === 0 && Number(points[0][1]) === 1_000_000,
    `${label}: must start at day 0 / $1M`);
  for (let index = 1; index < points.length; index += 1) {
    check(Number(points[index][0]) > Number(points[index - 1][0]),
      `${label}: days must be strictly increasing`);
  }
  const last = points.at(-1);
  if (bankrupt) {
    check(Number(last[1]) === 0, `${label}: bankrupt run must end at $0`);
    check(!points.slice(1, -1).some((point) => Number(point[1]) <= 0),
      `${label}: points continue after bankruptcy`);
  } else {
    check(Number(last[0]) === 500, `${label}: non-bankrupt run must end at day 500`);
  }
}

function tableRows(homepage) {
  const table = homepage.match(/<table class="results-table">([\s\S]*?)<\/table>/)?.[1] || '';
  const rows = new Map();
  for (const match of table.matchAll(/<tr(?: [^>]*)?>([\s\S]*?)<\/tr>/g)) {
    const cells = [...match[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)]
      .map((cell) => cell[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&plusmn;/g, '±')
        .replace(/\s+/g, ' ')
        .trim());
    if (cells.length >= 6) rows.set(cells[0], cells.slice(1));
  }
  return rows;
}

const master = readJson('assets/runs.json');
const masterJs = readAssignment('assets/runs-data.js', 'window.CEOBENCH_RUNS = ');
check(JSON.stringify(master) === JSON.stringify(masterJs), 'master JSON and JavaScript differ');
check(!master.some((row) => row.model === 'claude-opus-5'), 'Opus 5 remains in master plot');
for (const row of master) assertPlot(row.points, Boolean(row.bankrupt), `master ${row.pretty}`);

const masterRows = master.filter((row) => row.model === MODEL_ID);
check(masterRows.length === 1, 'master plot must contain one Grok 4.6 best run');
const masterRun = masterRows[0];
check(masterRun.pretty === MODEL_DISPLAY && masterRun.bankrupt === 0 && masterRun.max_day === 500,
  'master Grok completion metadata is wrong');
check(equalMoney(masterRun.final_cash, 246418.91), 'master Grok cash is wrong');
check(JSON.stringify(masterRun.points.at(-1)) === JSON.stringify([500, 246418.91]),
  'master Grok endpoint is wrong');

const grid = readAssignment('assets/figures/runs-by-model.js', 'const RUNS_BY_MODEL =');
check(!grid['Claude Opus 5'], 'Opus 5 remains in the grid');
for (const [model, runs] of Object.entries(grid)) {
  for (const run of runs) assertPlot(run.points, run.status === 'bankrupt', `grid ${model}/${run.run_id}`);
}
const gridRuns = grid[MODEL_DISPLAY] || [];
check(JSON.stringify(gridRuns.map((run) => run.run_id)) === JSON.stringify(RUN_IDS),
  'grid must contain all three Grok runs in replica order');
check(JSON.stringify(gridRuns[0].points.at(-1)) === JSON.stringify([500, 246418.91]),
  'grid Grok run 1 endpoint is wrong');
check(gridRuns[1].status === 'bankrupt' && JSON.stringify(gridRuns[1].points.at(-1)) === JSON.stringify([283, 0]),
  'grid Grok run 2 endpoint is wrong');
check(JSON.stringify(gridRuns[2].points.at(-1)) === JSON.stringify([500, 60489.48]),
  'grid Grok run 3 endpoint is wrong');

const manifest = readJson('trajectory-viewer/data/runs/manifest.json');
check(!manifest.models.some((entry) => entry.model === 'claude-opus-5'), 'Opus 5 remains in viewer manifest');
for (const summary of manifest.models.flatMap((model) => model.runs)) {
  if (!summary.bankrupt) {
    check(summary.current_day === 500 && summary.survival_days === 500,
      `${summary.run_id}: successful manifest run must survive 500 days`);
  }
}
const manifestModels = manifest.models.filter((entry) => entry.model === MODEL_ID);
check(manifestModels.length === 1, 'viewer manifest must contain one Grok model entry');
check(JSON.stringify(manifestModels[0].runs.map((run) => run.run_id)) === JSON.stringify(RUN_IDS),
  'viewer manifest must publish all three Grok trajectories');

for (const summary of manifestModels[0].runs) {
  const expected = EXPECTED[summary.run_id];
  check(Boolean(summary.bankrupt) === expected.bankrupt, `${summary.run_id}: manifest bankruptcy is wrong`);
  check(summary.current_day === expected.day && summary.survival_days === expected.day,
    `${summary.run_id}: manifest terminal day is wrong`);
  check(equalMoney(summary.cash, expected.cash), `${summary.run_id}: manifest cash is wrong`);
  check(summary.action_count === expected.actions && summary.days_count === expected.days,
    `${summary.run_id}: manifest counts are wrong`);
  check(summary.subscribers === expected.subscribers, `${summary.run_id}: manifest subscribers are wrong`);
  check(summary.reasoning_effort === 'xhigh' && summary.harness === 'Bash Agent',
    `${summary.run_id}: manifest runtime settings are wrong`);

  const detail = readJson(`trajectory-viewer/data/runs/${summary.run_id}.json`);
  check(detail.model === MODEL_ID && detail.run_id === summary.run_id, `${summary.run_id}: detail identity is wrong`);
  check(Boolean(detail.bankrupt) === expected.bankrupt && detail.current_day === expected.day,
    `${summary.run_id}: detail terminal state is wrong`);
  check(equalMoney(detail.cash, expected.cash) && equalMoney(detail.raw_final_cash, expected.raw),
    `${summary.run_id}: detail cash is wrong`);
  check(detail.provider === 'xAI' && detail.reasoning_effort === 'xhigh' && detail.harness === 'Bash Agent',
    `${summary.run_id}: detail model settings are wrong`);
  check(detail.simulator_llm === 'Amazon Bedrock', `${summary.run_id}: simulator setting is wrong`);
  check(detail.days_list.length === expected.days, `${summary.run_id}: detail day count is wrong`);
  const actions = Object.values(detail.days).flatMap((day) => day.actions || []);
  check(actions.length === expected.actions && detail.action_count === expected.actions,
    `${summary.run_id}: detail action count is wrong`);
  check(actions.filter((action) => action.tool === '_reasoning').length === expected.reasoning,
    `${summary.run_id}: detail reasoning count is wrong`);
  assertPlot(detail.cash_series.map((point) => [point.day, point.cash]), expected.bankrupt,
    `viewer ${summary.run_id}`);
}

const homepage = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
check(!homepage.includes('Claude Opus 5') && !homepage.includes('5a26f818'),
  'Opus 5 remains visible on homepage');
const rows = tableRows(homepage);
const masterByDisplay = new Map(master.map((run) => [run.pretty, run]));
for (const [model, runs] of Object.entries(grid)) {
  const row = rows.get(model);
  check(row, `${model}: leaderboard row is missing`);
  const survival = runs.map((run) => Number(run.points.at(-1)[0]));
  const bankruptcies = runs.filter((run) => run.status === 'bankrupt').length;
  const bestCash = masterByDisplay.has(model)
    ? Math.round(Number(masterByDisplay.get(model).final_cash))
    : null;
  const mean = survival.reduce((sum, day) => sum + day, 0) / survival.length;
  const std = Math.sqrt(survival.reduce((sum, day) => sum + (day - mean) ** 2, 0) / survival.length);
  check(row[0] === `${bankruptcies}/${runs.length}`, `${model}: table bankruptcy count is wrong`);
  if (bestCash !== null) {
    check(Number(row[1].replace(/[$,]/g, '')) === bestCash, `${model}: table best cash is wrong`);
  }
  check(Number(row[2]) === Math.max(...survival), `${model}: table max survival is wrong`);
  check(row[3] === `${mean.toFixed(1)} ± ${std.toFixed(1)}`, `${model}: table mean survival is wrong`);
}
check(rows.get(MODEL_DISPLAY)[4] === '22.92', 'Grok table turns/week is wrong');
for (const runId of RUN_IDS) {
  check(!homepage.includes(`trajectory-viewer/run.html?run=${runId}`),
    `${runId}: Grok must not appear in Watch the Models at Work`);
}
check(homepage.includes('assets/runs-data.js?v=17') && homepage.includes('script.js?v=29'),
  'homepage plot cache versions are wrong');
check(homepage.includes('cash-trajectories-grid.html?v=22'), 'homepage grid cache version is wrong');

const gridHtml = fs.readFileSync(path.join(ROOT, 'assets/figures/cash-trajectories-grid.html'), 'utf8');
check(!gridHtml.includes('Claude Opus 5'), 'Opus 5 remains in grid order/palette');
check(gridHtml.includes("'Grok 4.6':          {c:'#a16207'}"), 'grid Grok color is missing');
check(gridHtml.includes('runs-by-model.js?v=17'), 'grid data cache version is wrong');

const mainScript = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
check(!mainScript.includes('Claude Opus 5'), 'Opus 5 remains in master palette');
check(mainScript.includes('"Grok 4.6": "#a16207"'), 'master Grok color is missing');
const render = fs.readFileSync(path.join(ROOT, 'trajectory-viewer/js/render.js'), 'utf8');
const viewerIndex = fs.readFileSync(path.join(ROOT, 'trajectory-viewer/index.html'), 'utf8');
const viewerRun = fs.readFileSync(path.join(ROOT, 'trajectory-viewer/run.html'), 'utf8');
check(render.includes('const DATA_VERSION = 18;'), 'viewer data cache version is wrong');
check(viewerIndex.includes('manifest.json?v=18') && viewerIndex.includes('run.html?run=${r.run_id}&v=18'),
  'viewer index cache version is wrong');
check(viewerRun.includes('render.js?v=18'), 'viewer run page cache version is wrong');
check(!fs.existsSync(path.join(ROOT, 'trajectory-viewer/data/runs/5a26f818.json')),
  'Opus 5 detail file still exists');

console.log(`Validated ${master.length} main series, ${Object.values(grid).flat().length} grid runs, all leaderboard survival fields, and 3 Grok details.`);
