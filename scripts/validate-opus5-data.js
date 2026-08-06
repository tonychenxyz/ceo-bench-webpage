#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RUN_ID = '5a26f818';
const MODEL_KEY = 'claude-opus-5';
const MODEL_DISPLAY = 'Claude Opus 5';
const FINAL_CASH = 39339850.35;
const DISPLAY_CASH = 39339850;
const SUBSCRIBERS = 1905;

function check(condition, message) {
  if (!condition) throw new Error(message);
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

function validatePoints(points, label) {
  check(Array.isArray(points) && points.length === 501, `${label}: expected 501 daily points`);
  check(Number(points[0][0]) === 0 && Number(points[0][1]) === 1000000,
    `${label}: must start at day 0 with $1M`);
  check(Number(points.at(-1)[0]) === 500 && Number(points.at(-1)[1]) === FINAL_CASH,
    `${label}: terminal point mismatch`);
  points.forEach((point, index) => {
    check(Number(point[0]) === index, `${label}: missing or duplicate day ${index}`);
    check(Number(point[1]) > 0, `${label}: successful run cannot cross bankruptcy`);
  });
}

const summaries = readJson('assets/runs.json');
const summariesJs = readAssignment('assets/runs-data.js');
check(JSON.stringify(summaries) === JSON.stringify(summariesJs),
  'assets/runs.json and assets/runs-data.js differ');
const summaryMatches = summaries.filter((entry) => entry.model === MODEL_KEY);
check(summaryMatches.length === 1, 'main plot must contain exactly one Claude Opus 5 summary');
check(summaries[0].model === MODEL_KEY, 'Claude Opus 5 must rank first in the main plot');
check(summaryMatches[0].pretty === MODEL_DISPLAY, 'main plot label mismatch');
check(Number(summaryMatches[0].final_cash) === FINAL_CASH, 'main plot cash mismatch');
validatePoints(summaryMatches[0].points, 'main plot');

const grid = readAssignment('assets/figures/runs-by-model.js');
check(Array.isArray(grid[MODEL_DISPLAY]) && grid[MODEL_DISPLAY].length === 1,
  'grid must contain exactly one Claude Opus 5 run');
check(grid[MODEL_DISPLAY][0].run_id === RUN_ID, 'grid run ID mismatch');
check(grid[MODEL_DISPLAY][0].status === 'complete', 'grid status mismatch');
check(JSON.stringify(grid[MODEL_DISPLAY][0].points) === JSON.stringify(summaryMatches[0].points),
  'grid and main plot points differ');

const manifest = readJson('trajectory-viewer/data/runs/manifest.json');
const manifestMatches = manifest.models.filter((model) => model.model === MODEL_KEY);
check(manifestMatches.length === 1 && manifestMatches[0].runs.length === 1,
  'viewer manifest must contain one Claude Opus 5 run');
check(manifest.models[0].model === MODEL_KEY, 'Claude Opus 5 must rank first in viewer manifest');
const manifestRun = manifestMatches[0].runs[0];
check(manifestRun.run_id === RUN_ID, 'viewer manifest run ID mismatch');
check(Number(manifestRun.cash) === DISPLAY_CASH, 'viewer manifest cash mismatch');
check(Number(manifestRun.subscribers) === SUBSCRIBERS, 'viewer manifest subscribers mismatch');
check(Number(manifestRun.agent_turns) === 466, 'viewer manifest agent turns mismatch');
check(Number(manifestRun.action_count) === 262, 'viewer manifest action count mismatch');

const detail = readJson(`trajectory-viewer/data/runs/${RUN_ID}.json`);
check(detail.run_id === RUN_ID && detail.model === MODEL_KEY, 'detail identity mismatch');
check(detail.model_display === MODEL_DISPLAY, 'detail model display mismatch');
check(detail.current_day === 500 && detail.total_days === 500, 'detail horizon mismatch');
check(detail.bankrupt === false && detail.status === 'complete', 'detail status mismatch');
check(Number(detail.raw_final_cash) === FINAL_CASH, 'detail raw final cash mismatch');
check(Number(detail.cash) === DISPLAY_CASH, 'detail displayed cash mismatch');
check(Number(detail.subscribers) === SUBSCRIBERS, 'detail subscribers mismatch');
check(detail.provider === 'Anthropic' && detail.harness === 'Claude Code',
  'detail provider or harness mismatch');
check(detail.model_id === 'claude-opus-5' && detail.reasoning_effort === 'max',
  'detail model or reasoning metadata mismatch');
check(detail.seed === 42 && detail.session_id === 'ab4c7c0396bc',
  'detail seed or session mismatch');
check(detail.volume_name === 'ceobench-opus5-plain-20260805-175929',
  'detail volume mismatch');
check(detail.simulator_llm === 'Amazon Bedrock', 'detail simulator LLM mismatch');
check(detail.source_current_day === 504, 'detail source-day provenance mismatch');
validatePoints(detail.cash_series.map((point) => [point.day, point.cash]), 'viewer detail');

check(Array.isArray(detail.sub_series) && detail.sub_series.at(-1).day === 500,
  'subscriber series must end at day 500');
check(Number(detail.sub_series.at(-1).subscribers) === SUBSCRIBERS,
  'subscriber series terminal count mismatch');
const seatsByDay = new Map(detail.seat_series.map((point) => [Number(point.day), point]));
for (const point of detail.sub_series) {
  const day = Number(point.day);
  const groupSubscribers = detail.customer_series_by_group
    .filter((entry) => Number(entry.day) === day)
    .reduce((sum, entry) => sum + Number(entry.count || 0), 0);
  const groupSeats = detail.seat_series_by_group_detailed
    .filter((entry) => Number(entry.day) === day)
    .reduce((sum, entry) => sum + Number(entry.count || 0), 0);
  const seats = seatsByDay.get(day);
  check(groupSubscribers === Number(point.subscribers),
    `day ${day}: customer groups do not sum to subscribers`);
  check(groupSeats === Number(seats.individual) + Number(seats.enterprise_seats),
    `day ${day}: group seats do not sum to total seats`);
}
check(Array.isArray(detail.days['500'].actions) && detail.days['500'].actions.length === 0,
  'day 500 must not contain post-horizon actions');

const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
check(index.includes('<th scope="row">Claude Opus 5</th>'), 'leaderboard row missing');
check(index.includes('<td>$39,339,850</td>'), 'leaderboard cash missing');
check(index.includes(`trajectory-viewer/run.html?run=${RUN_ID}`), 'trajectory card link missing');

console.log(`Validated Claude Opus 5 trajectory ${RUN_ID} through day 500.`);
