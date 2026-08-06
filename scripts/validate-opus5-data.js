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
const ACTION_COUNT = 217;
const WORKSPACE_WRITE_COUNT = 37;

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
check(Number(manifestRun.action_count) === ACTION_COUNT,
  'viewer manifest action count mismatch');

const detailRelativePath = `trajectory-viewer/data/runs/${RUN_ID}.json`;
const detailSource = fs.readFileSync(path.join(ROOT, detailRelativePath), 'utf8');
const forbiddenCredentialPatterns = [
  ['AWS access key', /(?:AKIA|ASIA)[A-Z0-9]{16}/],
  ['Anthropic token', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI token', /sk-(?:proj-)?[A-Za-z0-9_-]{30,}/],
  ['Modal credential', /(?:wk|ws)-[A-Za-z0-9]{12,}/],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{20,}/],
  ['Slack token', /xox[baprs]-[A-Za-z0-9-]{20,}/],
  ['bearer token', /Bearer\s+[A-Za-z0-9._-]{30,}/i],
  ['private key', /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/],
];
for (const [label, pattern] of forbiddenCredentialPatterns) {
  check(!pattern.test(detailSource), `detail contains a publishable ${label}`);
}
const detail = JSON.parse(detailSource);
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
const actions = detail.days_list.flatMap((day) => detail.days[String(day)].actions);
check(detail.action_count === ACTION_COUNT && detail.tool_calls_count === ACTION_COUNT,
  'detail action counts mismatch');
check(actions.length === ACTION_COUNT, 'daily action total mismatch');
actions.forEach((action, index) => {
  check(action.turn === index + 1, `action ${index}: turn sequence mismatch`);
  check(detail.days_list.includes(action.day), `action ${index}: unmapped day ${action.day}`);
  check(typeof action.result === 'string', `action ${index}: result must be text`);
});
const toolCounts = actions.reduce((counts, action) => {
  counts[action.tool] = (counts[action.tool] || 0) + 1;
  return counts;
}, {});
check(toolCounts.bash === 174 && toolCounts.read_file === 6,
  'Claude Code Bash/Read counts mismatch');
check(toolCounts.write_file === WORKSPACE_WRITE_COUNT,
  'workspace Write count mismatch');

const workspaceWrites = actions.filter((action) => action.tool === 'write_file');
workspaceWrites.forEach((action, index) => {
  const filePath = action.arguments && action.arguments.file_path;
  check(typeof filePath === 'string' && filePath.length > 0,
    `workspace write ${index}: missing file path`);
  check(!filePath.startsWith('/') && !filePath.includes('/data/workspace/'),
    `workspace write ${index}: path must be workspace-relative`);
  check(typeof action.arguments.content === 'string',
    `workspace write ${index}: missing file content`);
});
const workspaceDays = new Set(workspaceWrites.map((action) => action.day));
check(workspaceDays.size === 29, 'workspace writes must span 29 simulation days');
check(detail.days['0'].actions.filter((action) => action.tool === 'write_file').length === 5,
  'day 0 must contain five workspace writes');
const environmentAction = actions.find((action) => action.turn === 22);
check(environmentAction && environmentAction.result.includes('AWS_ACCESS_KEY_ID=<redacted>'),
  'day-0 AWS access-key output must be redacted');
check(environmentAction.result.includes('AWS_SECRET_ACCESS_KEY=<redacted>'),
  'day-0 AWS secret-key output must be redacted');
check(detail.days['378'].actions.some((action) =>
  action.tool === 'write_file' && action.arguments.file_path === 's2.py'),
  'day 378 workspace write is missing');
check(Array.isArray(detail.days['500'].actions) && detail.days['500'].actions.length === 2,
  'day 500 must contain the two terminal Claude Code checks');

const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
check(index.includes('<th scope="row">Claude Opus 5</th>'), 'leaderboard row missing');
check(index.includes('<td>$39,339,850</td>'), 'leaderboard cash missing');
check(index.includes(`trajectory-viewer/run.html?run=${RUN_ID}&amp;v=16`),
  'versioned trajectory card link missing');
const homepageRunLinks = [...index.matchAll(/trajectory-viewer\/run\.html\?run=[^"']+/g)]
  .map((match) => match[0]);
check(homepageRunLinks.length > 0 && homepageRunLinks.every((link) => link.endsWith('&amp;v=16')),
  'every homepage trajectory link must use cache version 16');
check(index.includes('survived 500d · 217 actions · 1,905 subs'),
  'trajectory card action count mismatch');

const viewer = fs.readFileSync(path.join(ROOT, 'trajectory-viewer/js/render.js'), 'utf8');
check(viewer.includes('Day ${day} Workspace file edits'),
  'trajectory viewer workspace-edit panel is missing');
check(viewer.includes('const DATA_VERSION = 16;'),
  'trajectory renderer cache version mismatch');
const viewerIndex = fs.readFileSync(path.join(ROOT, 'trajectory-viewer/index.html'), 'utf8');
check(viewerIndex.includes('manifest.json?v=16'),
  'trajectory manifest cache version mismatch');
check(viewerIndex.includes('run.html?run=${r.run_id}&v=16'),
  'trajectory-index run link cache version mismatch');
const viewerRunPage = fs.readFileSync(path.join(ROOT, 'trajectory-viewer/run.html'), 'utf8');
check(viewerRunPage.includes('render.js?v=16'),
  'trajectory run-page cache version mismatch');

console.log(`Validated Claude Opus 5 trajectory ${RUN_ID} with ${WORKSPACE_WRITE_COUNT} workspace writes.`);
