#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIVE_IDS = ['9b8fa6a4', 'bae92e25', 'b5601d9b'];
const TOGETHER_IDS = ['e497175d', '247e5f9e', '4d8fbc8e'];
const EXPECTED = {
  '9b8fa6a4': {
    cash: 6314011, day: 500, bankrupt: false, session: '834ef2316e2f',
    subscribers: 44, enterpriseSeats: 0, sourceDay: 497,
    volume: 'ceobench-kimi-k3-modal-max-20260731-rep1',
  },
  'bae92e25': {
    cash: 0, day: 158, bankrupt: true, session: 'e757e3654576',
    subscribers: 8798, enterpriseSeats: 0, sourceDay: 158,
    volume: 'ceobench-kimi-k3-modal-max-20260731-rep2',
  },
  'b5601d9b': {
    cash: 22148357, day: 500, bankrupt: false, session: 'f9b3e7a86b8d',
    subscribers: 43664, enterpriseSeats: 0, sourceDay: 497,
    volume: 'ceobench-kimi-k3-modal-max-20260731-rep2',
  },
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

function readAssignment(relativePath) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  const equals = source.indexOf('=');
  check(equals >= 0, `${relativePath}: missing assignment`);
  return JSON.parse(source.slice(equals + 1).trim().replace(/;$/, ''));
}

function assertExactIds(actual, expected, label) {
  check(actual.length === expected.length, `${label}: expected ${expected.length} IDs, got ${actual.length}`);
  check(new Set(actual).size === actual.length, `${label}: duplicate run IDs`);
  for (const id of expected) check(actual.includes(id), `${label}: missing ${id}`);
  for (const id of actual) check(expected.includes(id), `${label}: unexpected ${id}`);
}

function assertPlot(points, label) {
  check(Array.isArray(points) && points.length >= 2, `${label}: missing plot points`);
  check(Number(points[0][0]) === 0 && Number(points[0][1]) === 1000000,
    `${label}: must start at [0, 1000000]`);
  for (let index = 1; index < points.length; index += 1) {
    check(Number(points[index][0]) > Number(points[index - 1][0]),
      `${label}: days must be strictly increasing and unique`);
  }
  const firstZero = points.findIndex((point, index) => index > 0 && Number(point[1]) <= 0);
  if (firstZero >= 0) {
    check(firstZero === points.length - 1, `${label}: points continue after bankruptcy`);
    check(Number(points[firstZero][1]) === 0, `${label}: bankruptcy must display exactly $0`);
  } else {
    check(Number(points[points.length - 1][0]) === 500, `${label}: successful series must end at day 500`);
  }
}

function normalizeViewerCash(series, run) {
  const byDay = new Map();
  for (const point of series || []) {
    const day = Number(point.day);
    const cash = Number(point.cash);
    if (Number.isFinite(day) && Number.isFinite(cash) && day >= 0) byDay.set(day, cash);
  }
  byDay.set(0, 1000000);
  let points = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
  const zeroIndex = points.findIndex((point, index) => index > 0 && point[1] <= 0);
  if (zeroIndex >= 0) {
    points = points.slice(0, zeroIndex + 1);
    points[points.length - 1][1] = 0;
    return points;
  }
  if (run.bankrupt) {
    const terminalDay = Math.min(Number(run.current_day || run.survival_days || 0), 500);
    points = points.filter((point) => point[0] <= terminalDay);
    if (points.at(-1)[0] === terminalDay) points.at(-1)[1] = 0;
    else points.push([terminalDay, 0]);
    return points;
  }
  points = points.filter((point) => point[0] <= 500);
  if (points.at(-1)[0] < 500) points.push([500, points.at(-1)[1]]);
  return points;
}

function sumGroupCounts(series, day) {
  return (series || [])
    .filter((point) => Number(point.day) === Number(day))
    .reduce((sum, point) => sum + Number(point.count || 0), 0);
}

function groupSnapshot(series, day) {
  return (series || [])
    .filter((point) => Number(point.day) === Number(day))
    .map((point) => [point.group_id, Number(point.count || 0)])
    .sort(([left], [right]) => left.localeCompare(right));
}

function assertActiveSeries(detail, expected, label) {
  check(Array.isArray(detail.sub_series) && detail.sub_series.length > 0,
    `${label}: missing subscriber series`);
  check(Array.isArray(detail.seat_series) && detail.seat_series.length === detail.sub_series.length,
    `${label}: subscriber and seat series lengths differ`);

  const seatsByDay = new Map(detail.seat_series.map((point) => [Number(point.day), point]));
  for (const point of detail.sub_series) {
    const day = Number(point.day);
    const subscribers = Number(point.subscribers);
    const seats = seatsByDay.get(day);
    check(seats, `${label}: missing seat point for day ${day}`);
    check(Number(seats.individual) === subscribers,
      `${label}: day ${day} subscriber total differs from individual seats`);
    check(sumGroupCounts(detail.customer_series_by_group, day) === subscribers,
      `${label}: day ${day} customer groups do not sum to active subscribers`);
    check(sumGroupCounts(detail.seat_series_by_group, day)
      === subscribers + Number(seats.enterprise_seats || 0),
    `${label}: day ${day} seat groups do not sum to active individual plus enterprise seats`);
    check(sumGroupCounts(detail.seat_series_by_group_detailed, day)
      === subscribers + Number(seats.enterprise_seats || 0),
    `${label}: day ${day} detailed seat groups do not sum to active seats`);
  }

  const terminalSubs = detail.sub_series.at(-1);
  const terminalSeats = detail.seat_series.at(-1);
  check(Number(terminalSubs.day) === expected.day
    && Number(terminalSubs.subscribers) === expected.subscribers,
  `${label}: terminal active subscriber count mismatch`);
  check(Number(terminalSeats.day) === expected.day
    && Number(terminalSeats.individual) === expected.subscribers
    && Number(terminalSeats.enterprise_seats) === expected.enterpriseSeats,
  `${label}: terminal active seat count mismatch`);

  if (!expected.bankrupt) {
    const sourceSubs = detail.sub_series.find((point) => Number(point.day) === expected.sourceDay);
    const sourceSeats = detail.seat_series.find((point) => Number(point.day) === expected.sourceDay);
    check(sourceSubs && Number(sourceSubs.subscribers) === expected.subscribers,
      `${label}: source-day subscriber count mismatch`);
    check(sourceSeats && Number(sourceSeats.individual) === expected.subscribers
      && Number(sourceSeats.enterprise_seats) === expected.enterpriseSeats,
    `${label}: source-day seat count mismatch`);
    check(JSON.stringify(groupSnapshot(detail.customer_series_by_group, expected.sourceDay))
      === JSON.stringify(groupSnapshot(detail.customer_series_by_group, expected.day)),
    `${label}: day-500 customer groups must carry forward from the final simulated day`);
    check(JSON.stringify(groupSnapshot(detail.seat_series_by_group, expected.sourceDay))
      === JSON.stringify(groupSnapshot(detail.seat_series_by_group, expected.day)),
    `${label}: day-500 seat groups must carry forward from the final simulated day`);
  }
}

const summaries = readJson('assets/runs.json');
const summariesJs = readAssignment('assets/runs-data.js');
check(JSON.stringify(summaries) === JSON.stringify(summariesJs), 'assets/runs.json and runs-data.js differ');
for (const entry of summaries) assertPlot(entry.points, `main plot ${entry.pretty}`);

const kimiSummary = summaries.filter((entry) => entry.model === 'kimi-k3');
check(kimiSummary.length === 1, 'main plot must contain exactly one Kimi K3 summary');
check(kimiSummary[0].pretty === 'Kimi K3', 'live summary label must be Kimi K3');
check(kimiSummary[0].final_cash === 22148357, 'main plot best Kimi cash mismatch');

const grid = readAssignment('assets/figures/runs-by-model.js');
check(Array.isArray(grid['Kimi K3']), 'grid is missing Kimi K3');
assertExactIds(grid['Kimi K3'].map((run) => run.run_id), LIVE_IDS, 'grid Kimi runs');
for (const [model, runs] of Object.entries(grid)) {
  for (const run of runs) assertPlot(run.points, `grid ${model}/${run.run_id}`);
}
const bestGrid = grid['Kimi K3'].find((run) => run.run_id === 'b5601d9b');
check(JSON.stringify(bestGrid.points) === JSON.stringify(kimiSummary[0].points),
  'main Kimi points must match best grid run b5601d9b');

const manifest = readJson('trajectory-viewer/data/runs/manifest.json');
const kimiModels = manifest.models.filter((model) => model.model === 'kimi-k3');
check(kimiModels.length === 1, 'live manifest must contain exactly one Kimi K3 model');
check(kimiModels[0].model_display === 'Kimi K3', 'live manifest label must be Kimi K3');
assertExactIds(kimiModels[0].runs.map((run) => run.run_id), LIVE_IDS, 'manifest Kimi runs');
const kimiManifestRuns = new Map(kimiModels[0].runs.map((run) => [run.run_id, run]));

for (const model of manifest.models) {
  for (const summary of model.runs) {
    const detailPath = path.join(ROOT, 'trajectory-viewer/data/runs', `${summary.run_id}.json`);
    check(fs.existsSync(detailPath), `missing viewer detail ${summary.run_id}.json`);
    const detail = JSON.parse(fs.readFileSync(detailPath, 'utf8'));
    check(detail.run_id === summary.run_id, `${summary.run_id}: detail ID mismatch`);
    check(Boolean(detail.bankrupt) === Boolean(summary.bankrupt), `${summary.run_id}: bankruptcy mismatch`);
    check(Number(detail.cash) === Number(summary.cash), `${summary.run_id}: cash mismatch`);
    assertPlot(normalizeViewerCash(detail.cash_series, detail), `viewer ${summary.run_id}`);
  }
}

for (const id of LIVE_IDS) {
  const detail = readJson(`trajectory-viewer/data/runs/${id}.json`);
  const expected = EXPECTED[id];
  check(detail.model === 'kimi-k3' && detail.model_display === 'Kimi K3', `${id}: live model metadata mismatch`);
  check(detail.provider === 'Modal', `${id}: provider must be Modal`);
  check(detail.model_id === 'moonshotai/Kimi-K3', `${id}: model ID mismatch`);
  check(detail.reasoning_effort === 'max', `${id}: reasoning effort mismatch`);
  check(detail.seed === 42, `${id}: seed mismatch`);
  check(detail.session_id === expected.session, `${id}: session mismatch`);
  check(detail.volume_name === expected.volume, `${id}: volume mismatch`);
  check(detail.simulator_llm === 'Amazon Bedrock', `${id}: simulator LLM mismatch`);
  check(detail.current_day === expected.day && detail.survival_days === expected.day, `${id}: terminal day mismatch`);
  check(detail.cash === expected.cash && detail.bankrupt === expected.bankrupt, `${id}: terminal state mismatch`);
  check(detail.subscribers === expected.subscribers, `${id}: top-level active subscriber count mismatch`);
  check(Number(kimiManifestRuns.get(id).subscribers) === expected.subscribers,
    `${id}: manifest active subscriber count mismatch`);
  assertActiveSeries(detail, expected, id);
  const rawPoints = detail.cash_series.map((point) => [point.day, point.cash]);
  assertPlot(rawPoints, `raw Kimi viewer ${id}`);
  if (expected.bankrupt) {
    check(Math.round(detail.raw_final_cash) === -1460, `${id}: raw bankruptcy cash mismatch`);
    check(Math.max(...detail.days_list) === 158, `${id}: viewer data continues after bankruptcy`);
  } else {
    check(detail.days['500'] && Array.isArray(detail.days['500'].actions)
      && detail.days['500'].actions.length === 0, `${id}: day 500 must have no actions`);
  }
}

const liveSurfaceFiles = [
  'assets/runs.json',
  'assets/runs-data.js',
  'assets/figures/runs-by-model.js',
  'trajectory-viewer/data/runs/manifest.json',
];
for (const relativePath of liveSurfaceFiles) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  for (const id of TOGETHER_IDS) check(!source.includes(id), `${relativePath}: archived ID ${id} remains live`);
}
for (const id of TOGETHER_IDS) {
  check(!fs.existsSync(path.join(ROOT, 'trajectory-viewer/data/runs', `${id}.json`)), `${id}: archived detail remains live`);
}

const archive = readJson('trajectory-viewer/data/archive/kimi-k3-together/manifest.json');
check(archive.model === 'kimi-k3-together' && archive.model_display === 'Kimi K3 Together',
  'archive manifest metadata mismatch');
check(archive.displayed === false, 'archive manifest must be marked non-displayed');
assertExactIds(archive.runs.map((run) => run.run_id), TOGETHER_IDS, 'archive runs');
for (const id of TOGETHER_IDS) {
  const detail = readJson(`trajectory-viewer/data/archive/kimi-k3-together/${id}.json`);
  check(detail.model === 'kimi-k3-together', `${id}: archived model key mismatch`);
  check(detail.model_display === 'Kimi K3 Together', `${id}: archived display name mismatch`);
}

const renderer = fs.readFileSync(path.join(ROOT, 'trajectory-viewer/js/render.js'), 'utf8');
check(renderer.includes('normalizeCashSeriesForDisplay'), 'viewer renderer is missing shared cash normalization');

const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
check(index.includes('<td>1/3</td>') && index.includes('<td>$22,148,357</td>'),
  'leaderboard is missing updated Kimi metrics');
check(index.includes('386.0 &plusmn; 161.2') && index.includes('<td>14.81</td>'),
  'leaderboard is missing recomputed Kimi survival or turns/week');
check(!index.includes('Kimi K3, and Grok 4.20 bankrupt on all runs'),
  'index still claims Kimi always bankrupts');

console.log(`Validated ${summaries.length} main series, ${Object.values(grid).flat().length} grid runs, and ${manifest.models.reduce((sum, model) => sum + model.runs.length, 0)} viewer runs.`);
console.log('Kimi K3 live IDs:', LIVE_IDS.join(', '));
console.log('Kimi K3 Together archived IDs:', TOGETHER_IDS.join(', '));
